import { API, ROUTE_COLORS } from '../config.js';
import { typeLabel, fetchWithTimeout } from './osm.js';
import { markedRoutesNear } from './marked.js';
import {
  haversine, bearing, compassWord, cumulativeDistances, ascentDescent,
} from '../util/geo.js';

// ---------------------------------------------------------------------------
// 1) Startpunkte wählen: gut erreichbar, sinnvoll weit weg und aus möglichst
//    verschiedenen Himmelsrichtungen, damit echte Alternativen entstehen.
// ---------------------------------------------------------------------------
const BASE_SCORE = { trailhead: 3.2, station: 2.4, parking: 2.2, cablecar: 1.9, bus: 1.6 };
const MAX_PER_TYPE = { cablecar: 2, bus: 2 };

export function pickStarts(peak, places, max = 8, maxKm = 9) {
  const p = [peak.lng, peak.lat];
  const cands = [];
  for (const pl of places) {
    if (!(pl.type in BASE_SCORE)) continue;
    const dKm = haversine(p, [pl.lng, pl.lat]) / 1000;
    const minKm = pl.type === 'cablecar' ? 0.4 : 1.2;
    if (dKm < minKm || dKm > maxKm) continue;
    let score = BASE_SCORE[pl.type];
    if (pl.type === 'parking' && pl.name) score += 0.3;
    if (pl.type === 'parking' && /wanderpark|parkplatz|^p\s|almbahn|hütte|alm\b/i.test(pl.name || '')) score += 0.3;
    if (pl.type === 'cablecar' && /bergstation/i.test(pl.name || '')) score -= 0.6;
    if (pl.type !== 'cablecar' && dKm < 2) score -= (2 - dKm) * 0.6;
    if (dKm > maxKm * 0.66) score -= (dKm - maxKm * 0.66) * 0.45;
    const b = bearing(p, [pl.lng, pl.lat]);
    cands.push({ ...pl, dKm, bearing: b, sector: Math.round(b / 45) % 8, score });
  }

  // Bester Kandidat pro Himmelsrichtung, Bergbahnen/Bushalte begrenzt
  const bySector = new Map();
  for (const c of cands) {
    const cur = bySector.get(c.sector);
    if (!cur || c.score > cur.score) bySector.set(c.sector, c);
  }
  const perType = {};
  const chosen = [...bySector.values()].sort((a, b) => b.score - a.score).filter((c) => {
    perType[c.type] = (perType[c.type] || 0) + 1;
    return perType[c.type] <= (MAX_PER_TYPE[c.type] ?? 99);
  }).slice(0, max);

  // Wenige Richtungen? Dann mit weiteren, nicht zu nahen Kandidaten auffüllen.
  if (chosen.length < 4) {
    const rest = cands.filter((c) => !chosen.includes(c)).sort((a, b) => b.score - a.score);
    for (const c of rest) {
      if (chosen.length >= 4) break;
      if (chosen.filter((o) => o.type === c.type).length >= (MAX_PER_TYPE[c.type] ?? 99)) continue;
      const far = chosen.every((o) => haversine([o.lng, o.lat], [c.lng, c.lat]) > 1500);
      if (far) chosen.push(c);
    }
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// 2) Routing mit BRouter
//    Das Standardprofil "hiking-mountain" sperrt alle Wege über T3. Viele Gipfel
//    (z. B. Ehrwalder Sonnenspitze) sind aber nur über T4–T6 erreichbar. Wir laden
//    deshalb eine Variante hoch, die alle SAC-Stufen erlaubt, leichte Wege aber
//    bevorzugt. Hochgeladene Profile verfallen nach einiger Zeit → bei Bedarf neu.
// ---------------------------------------------------------------------------
let profilePromise = null;

export function makeAlpineProfile(base) {
  return base
    .replace(/assign\s+SAC_scale_limit\s+\d+/, 'assign   SAC_scale_limit          6')
    .replace(/assign\s+SAC_scale_preferred\s+\d+/, 'assign   SAC_scale_preferred      2');
}

async function alpineProfile(signal) {
  if (!profilePromise) {
    profilePromise = (async () => {
      const baseRes = await fetchWithTimeout(`${API.brouter}/profiles2/${API.brouterProfile}.brf`, { timeout: 10000, signal });
      if (!baseRes.ok) throw new Error('Profil nicht ladbar');
      const body = makeAlpineProfile(await baseRes.text());
      const up = await fetchWithTimeout(`${API.brouter}/profile`, { method: 'POST', body, timeout: 10000, signal });
      const id = up.ok ? (await up.json()).profileid : null;
      if (!id) throw new Error('Profil-Upload fehlgeschlagen');
      return id;
    })().catch((e) => {
      profilePromise = null;
      console.warn('Eigenes Profil nicht verfügbar, nutze Standardprofil:', e.message);
      return API.brouterProfile;
    });
  }
  return profilePromise;
}

/** Route über beliebig viele Punkte; alt = 0…3 liefert Alternativen von BRouter */
async function brouter(points, signal, alt = 0, retry = true) {
  const profile = await alpineProfile(signal);
  const lonlats = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join('|');
  const url = `${API.brouter}?lonlats=${encodeURIComponent(lonlats)}&profile=${profile}&alternativeidx=${alt}&format=geojson`;
  const res = await fetchWithTimeout(url, { timeout: 25000, signal });
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 160);
    // Abgelaufenes eigenes Profil → einmal neu hochladen
    if (retry && profile.startsWith('custom_') && /profile|not found|unknown/i.test(msg)) {
      profilePromise = null;
      return brouter(points, signal, alt, false);
    }
    throw new Error(msg || `Routing fehlgeschlagen (${res.status})`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 3) Auswertung: Strecke, Höhenmeter, Gehzeit, Schwierigkeit
// ---------------------------------------------------------------------------
const SAC = {
  hiking: 1,
  mountain_hiking: 2,
  demanding_mountain_hiking: 3,
  alpine_hiking: 4,
  demanding_alpine_hiking: 5,
  difficult_alpine_hiking: 6,
};

/** Gehzeit nach DAV/SAC-Formel (Stunden) */
export function hikingTime(distM, up, down) {
  const h = distM / 1000 / 4; // 4 km/h horizontal
  const v = up / 300 + down / 500; // 300 Hm/h hoch, 500 Hm/h runter
  return Math.max(h, v) + Math.min(h, v) / 2;
}

export function parseWayInfo(messages) {
  const info = { maxSac: 0, sacShare: 0, viaFerrata: false };
  if (!Array.isArray(messages) || messages.length < 2) return info;
  const head = messages[0];
  const iTags = head.indexOf('WayTags');
  const iDist = head.indexOf('Distance');
  if (iTags < 0) return info;
  const distBySac = new Array(7).fill(0);
  let total = 0;
  for (const row of messages.slice(1)) {
    const tags = String(row[iTags] || '');
    const d = iDist >= 0 ? +row[iDist] || 0 : 1;
    total += d;
    const m = tags.match(/sac_scale=([a-z_]+)/);
    const level = m ? SAC[m[1]] || 0 : 0;
    distBySac[level] += d;
    if (level > info.maxSac) info.maxSac = level;
    if (/highway=via_ferrata|via_ferrata_scale=/.test(tags)) info.viaFerrata = true;
  }
  if (info.maxSac && total) info.sacShare = distBySac[info.maxSac] / total;
  return info;
}

export function analyzeRoute(geojson, start, peak) {
  const f = geojson.features?.[0];
  if (!f) throw new Error('Leere Route');
  const coords = f.geometry.coordinates.map((c) => [c[0], c[1], c[2] ?? null]);
  const dist = cumulativeDistances(coords);
  const length = +f.properties?.['track-length'] || dist[dist.length - 1];
  const { up, down } = ascentDescent(coords.map((c) => c[2]));
  const way = parseWayInfo(f.properties?.messages);
  const last = coords[coords.length - 1];
  const gapToSummit = haversine(last, [peak.lng, peak.lat]);
  const startEle = coords.find((c) => c[2] != null)?.[2] ?? start.ele ?? null;

  const timeUp = hikingTime(length, up, down);
  const timeDown = hikingTime(length, down, up);
  const dir = compassWord(start.bearing ?? bearing([peak.lng, peak.lat], [start.lng, start.lat]));

  return {
    id: start.id,
    kind: 'direct',
    start,
    title: start.name || `${typeLabel(start.type)}, ${dir}seite`,
    baseTitle: start.name || `${typeLabel(start.type)}, ${dir}seite`,
    direction: dir,
    coords,
    dist,
    length,
    up,
    down,
    startEle: startEle != null ? Math.round(startEle) : null,
    timeUp,
    timeDown,
    timeTotal: timeUp + timeDown,
    sac: way.maxSac,
    sacShare: way.sacShare,
    viaFerrata: way.viaFerrata,
    gapToSummit,
  };
}

/** Wie viel von Route a verläuft (fast) auf Route b? 0…1 */
export function overlap(a, b, tol = 80) {
  const n = 40;
  const step = Math.max(1, Math.floor(a.coords.length / n));
  const bStep = Math.max(1, Math.floor(b.coords.length / 400));
  let hit = 0, total = 0;
  for (let i = 0; i < a.coords.length; i += step) {
    total++;
    for (let j = 0; j < b.coords.length; j += bStep) {
      if (haversine(a.coords[i], b.coords[j]) < tol) { hit++; break; }
    }
  }
  return total ? hit / total : 0;
}

export function dedupeRoutes(routes) {
  // benannte, markierte Wege zuerst – sie tragen den besseren Namen
  const rank = { marked: 0, direct: 1, hut: 2, alt: 3 };
  const sorted = [...routes].sort((a, b) => (rank[a.kind] ?? 0) - (rank[b.kind] ?? 0) || a.timeUp - b.timeUp);
  const kept = [];
  for (const r of sorted) {
    const dup = kept.some((k) => overlap(r, k) > 0.75 && overlap(k, r) > 0.75);
    if (!dup) kept.push(r);
  }
  return kept;
}

/**
 * Riesenumwege raus. Maßstab ist der schnellste Aufstieg aus dem Tal – nicht von
 * einer Bergbahn, sonst fiele z. B. an der Zugspitze jeder normale Zustieg weg.
 */
export function sensible(routes) {
  if (!routes.length) return routes;
  const valley = routes.filter((r) => r.start?.type !== 'cablecar');
  const fastest = Math.min(...(valley.length ? valley : routes).map((r) => r.timeUp));
  const limit = Math.min(11, Math.max(fastest * 2.2, fastest + 3));
  return routes.filter((r) => r.timeUp <= limit);
}

/** Gleich benannte Startpunkte unterscheiden (z. B. Tal- und Bergstation einer Bahn) */
export function disambiguate(routes) {
  const groups = new Map();
  routes.filter((r) => (r.kind ?? 'direct') === 'direct')
    .forEach((r) => groups.set(r.title, [...(groups.get(r.title) || []), r]));
  for (const [title, list] of groups) {
    if (list.length < 2) continue;
    const byEle = [...list].sort((a, b) => (b.startEle ?? 0) - (a.startEle ?? 0));
    if (list.every((r) => r.start.type === 'cablecar') && list.length === 2) {
      byEle[0].title = `${title}, Bergstation`;
      byEle[1].title = `${title}, Talstation`;
    } else {
      list.forEach((r) => { r.title = `${title}, ${r.direction}seite`; });
    }
  }
  return routes;
}

// ---------------------------------------------------------------------------
// 4) Tourenvarianten: Varianten, Touren über Hütten, Rundtouren
// ---------------------------------------------------------------------------

/** Abschnitt einer Route (Index i bis j): Länge, Höhenmeter, Gehzeit */
function partial(route, j) {
  const pts = route.coords.slice(0, j + 1);
  const { up, down } = ascentDescent(pts.map((c) => c[2]));
  const len = route.dist[j] ?? 0;
  return { len, up, down, time: hikingTime(len, up, down) };
}

/** Hütten am Weg: nächster Punkt der Route höchstens 150 m entfernt */
export function hutsAlong(route, huts, maxDist = 150) {
  const found = [];
  const step = Math.max(1, Math.floor(route.coords.length / 300));
  for (const h of huts) {
    let best = Infinity, bi = -1;
    for (let i = 0; i < route.coords.length; i += step) {
      const d = haversine(route.coords[i], [h.lng, h.lat]);
      if (d < best) { best = d; bi = i; }
    }
    if (best <= maxDist && h.name) found.push({ name: h.name, index: bi, time: partial(route, bi).time });
  }
  return found.sort((x, y) => x.index - y.index);
}

/** Lesbare Bezeichnung eines Teilwegs, z. B. "Ehrwalder Almbahn über Seeben Alm" */
export function legLabel(leg) {
  if (leg.kind === 'hut' && leg.hut?.name) return `${leg.baseTitle} über ${leg.hut.name}`;
  if (leg.kind === 'marked') return leg.startName ? `${leg.startName}, ${leg.baseTitle}` : leg.baseTitle;
  if (leg.kind === 'alt') return `${leg.baseTitle} (Variante)`;
  return leg.baseTitle;
}

/** Rundtour: Aufstieg über a, Abstieg über b (umgekehrt), ggf. Verbindungsstück zurück zum Start von a */
export function makeLoop(a, b, conn = null) {
  const downCoords = [...b.coords].reverse();
  const coords = [...a.coords, ...downCoords.slice(1), ...(conn ? conn.coords.slice(1) : [])];
  const dist = cumulativeDistances(coords);
  const connTime = conn ? conn.timeUp : 0;
  const timeUp = a.timeUp;
  const timeDown = b.timeDown + connTime;
  const sameStart = !conn && a.start.id === b.start.id;
  return {
    id: `loop:${a.id}|${b.id}`,
    kind: 'loop',
    start: a.start,
    title: sameStart
      ? `Rundtour ab ${a.baseTitle}${[a, b].find((l) => l.kind === 'hut') ? ` über ${[a, b].find((l) => l.kind === 'hut').hut.name}` : ''}`
      : `Rundtour ${a.baseTitle} – ${b.baseTitle}`,
    ascentVia: legLabel(a),
    descentVia: legLabel(b),
    direction: a.direction,
    coords,
    dist,
    length: dist[dist.length - 1],
    up: a.up + b.down + (conn ? conn.up : 0),
    down: a.down + b.up + (conn ? conn.down : 0),
    startEle: a.startEle,
    timeUp,
    timeDown,
    timeTotal: timeUp + timeDown,
    connector: conn ? { length: conn.length, time: connTime } : null,
    sac: Math.max(a.sac, b.sac),
    sacShare: Math.max(a.sacShare, b.sacShare),
    viaFerrata: a.viaFerrata || b.viaFerrata,
    gapToSummit: Math.max(a.gapToSummit, b.gapToSummit),
  };
}

/** Kandidaten für Rundtouren: deutlich verschiedene Wege mit nahen Startpunkten */
export function loopCandidates(legs, { maxStartGap = 2500, maxOverlap = 0.78, minDistinct = 1200, max = 4 } = {}) {
  const out = [];
  for (const a of legs) {
    for (const b of legs) {
      if (a === b) continue;
      const gap = haversine(a.coords[0], b.coords[0]);
      if (gap > maxStartGap) continue;
      // Oben teilen sich Wege oft den Normalweg zum Gipfel. Entscheidend ist,
      // dass beide Wege ein ordentliches eigenes Stück haben.
      const oab = overlap(a, b), oba = overlap(b, a);
      if (oab > maxOverlap || oba > maxOverlap) continue;
      if ((1 - oab) * a.length < minDistinct || (1 - oba) * b.length < minDistinct) continue;
      // grobe Gesamtzeit inkl. Rückweg zum Auto (4 km/h)
      const est = a.timeUp + b.timeDown + (gap > 150 ? (gap * 1.3) / 4000 : 0);
      out.push({ a, b, gap, est });
    }
  }
  out.sort((x, y) => x.est - y.est);
  // jede Kombination nur in einer Richtung (die schnellere), jeder Weg höchstens zweimal
  const used = new Map();
  const picked = [];
  for (const c of out) {
    if (picked.some((p) => p.a === c.b && p.b === c.a)) continue;
    if ((used.get(c.a) || 0) >= 2 || (used.get(c.b) || 0) >= 2) continue;
    picked.push(c);
    used.set(c.a, (used.get(c.a) || 0) + 1);
    used.set(c.b, (used.get(c.b) || 0) + 1);
    if (picked.length >= max) break;
  }
  return picked;
}

/** Kleiner Arbeits-Pool: höchstens n Anfragen gleichzeitig an BRouter */
async function pool(jobs, n, onDone) {
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      await job();
      onDone?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
}

/**
 * Berechnet Tourenvorschläge in drei Schritten und meldet Zwischenstände:
 *  1. direkte Wege von Startpunkten aus allen Richtungen
 *  2. Varianten (Alternativwege von BRouter) und Touren über Hütten
 *  3. Rundtouren aus Kombinationen von Auf- und Abstieg
 * onUpdate(routes, { done }) liefert jeweils die aktuelle, sortierte Liste.
 */
export async function suggestRoutes(peak, places, { signal, onProgress, onUpdate } = {}) {
  const maxKm = (peak.ele ?? 0) > 2500 ? 12 : 9;
  const starts = pickStarts(peak, places, 8, maxKm);
  // markierte Wege parallel laden (Fehler sind nicht schlimm)
  const markedP = markedRoutesNear(peak, { signal }).catch((e) => { console.info('Markierte Wege nicht geladen:', e.message); return []; });
  const allHuts = places.filter((p) => p.type === 'hut' && p.name);
  if (!starts.length) { onUpdate?.([], { done: true }); return { routes: [] }; }

  const legs = [];
  let loops = [];
  let done = 0, total = starts.length;
  const tick = () => onProgress?.(++done, total);

  const tryLeg = async (points, start, meta) => {
    try {
      const gj = await brouter(points, signal, meta.alt || 0);
      const r = analyzeRoute(gj, start, peak);
      if (r.gapToSummit >= 600 || r.length <= 300) return null;
      Object.assign(r, meta, { id: `${meta.kind}:${start.id}:${meta.alt || 0}:${meta.hut?.id || ''}` });
      legs.push(r);
      return r;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn('Route nicht berechenbar ab', start.name || start.id, e.message);
      return null;
    }
  };

  const finalize = () => {
    const base = disambiguate(sensible(dedupeRoutes(legs)).map((r) => ({ ...r, title: r.baseTitle })));
    // Varianten und Hüttentouren lesbar benennen
    let variant = {};
    for (const r of base) {
      if (r.kind === 'alt') {
        variant[r.start.id] = (variant[r.start.id] || 1) + 1;
        r.title = `${r.title}, Variante ${variant[r.start.id]}`;
      } else if (r.kind === 'hut') {
        r.title = `Über ${r.hut.name}`;
        r.subtitle = `ab ${r.baseTitle}`;
      } else if (r.kind === 'marked') {
        r.subtitle = r.startName ? `ab ${r.startName}` : 'Einstieg direkt am Weg';
      }
    }
    const list = [...base, ...loops.filter((l) => l.timeTotal <= 12)];
    // Hütten direkt am Gipfel (z. B. Münchner Haus) zählen nicht als Hütte unterwegs
    const wayHuts = allHuts.filter((h) => haversine([h.lng, h.lat], [peak.lng, peak.lat]) > 300);
    for (const r of list) r.huts = hutsAlong(r, wayHuts);
    list.sort((x, y) => x.timeTotal - y.timeTotal);
    return list.map((r, i) => ({ ...r, color: ROUTE_COLORS[i % ROUTE_COLORS.length] }));
  };
  const emit = (isDone) => onUpdate?.(finalize(), { done: isDone });

  // 1) direkte Wege
  await pool(starts.map((s) => () => tryLeg([s, peak], s, { kind: 'direct', baseTitle: titleFor(s, peak) })), 3, tick);
  if (signal?.aborted) return { routes: [] };
  emit(false);

  // 2) Varianten der besten Startpunkte und Touren über Hütten
  const best = sensible(dedupeRoutes(legs.filter((l) => l.kind === 'direct'))).slice(0, 3);
  const jobs = [];
  for (const r of best) {
    for (const alt of [1, 2]) jobs.push(() => tryLeg([r.start, peak], r.start, { kind: 'alt', alt, baseTitle: r.baseTitle }));
  }
  const nearHuts = allHuts
    .map((h) => ({ ...h, dKm: haversine([peak.lng, peak.lat], [h.lng, h.lat]) / 1000 }))
    .filter((h) => h.dKm >= 0.5 && h.dKm <= 5)
    .sort((x, y) => x.dKm - y.dKm)
    .slice(0, 3);
  const okStarts = [...new Set(legs.map((l) => l.start))];
  for (const h of nearHuts) {
    if (!okStarts.length) break;
    const s = okStarts.reduce((m, st) => (haversine([st.lng, st.lat], [h.lng, h.lat]) < haversine([m.lng, m.lat], [h.lng, h.lat]) ? st : m));
    jobs.push(() => tryLeg([s, h, peak], s, { kind: 'hut', hut: h, baseTitle: titleFor(s, peak) }));
  }
  // Markierte Wege: vom nächsten Talort entlang des Weges zum Gipfel routen
  const marked = (await markedP).slice(0, 8);
  const valleyPlaces = places.filter((p) => ['parking', 'trailhead', 'station', 'bus'].includes(p.type));
  for (const m of marked) {
    const s0 = m.coords[0];
    const near = valleyPlaces
      .map((p) => ({ p, d: haversine([p.lng, p.lat], s0) }))
      .filter((x) => x.d < 3000)
      .sort((a, b) => a.d - b.d)[0];
    const startPlace = near && near.d > 250 ? near.p : null;
    const start = startPlace || { id: `wmt${m.id}:${Math.round(s0[0] * 1e4)}`, type: 'trailhead', name: near?.p.name || null, lat: s0[1], lng: s0[0] };
    // Stützpunkte entlang des markierten Weges, damit BRouter ihm folgt
    const cd = cumulativeDistances(m.coords);
    const L = cd.at(-1);
    const via = [0, 0.3, 0.6, 0.85].map((f) => {
      const i = cd.findIndex((d) => d >= f * L);
      const c = m.coords[i < 0 ? m.coords.length - 1 : i];
      return { lng: c[0], lat: c[1] };
    });
    const pts = [...(startPlace ? [startPlace] : []), ...via, peak];
    jobs.push(async () => {
      const r = await tryLeg(pts, start, {
        kind: 'marked', baseTitle: m.name, startName: start.name, link: m.link, symbol: m.symbol, markedId: m.id,
      });
      // nur behalten, wenn die Route dem markierten Weg wirklich folgt
      if (r && overlap({ coords: m.coords }, r, 100) < 0.5) legs.splice(legs.indexOf(r), 1);
      else if (r) r.id = `marked:${m.id}:${Math.round(s0[0] * 1e4)}`;
    });
  }
  total += jobs.length;
  await pool(jobs, 3, tick);
  if (signal?.aborted) return { routes: [] };
  emit(false);

  // 3) Rundtouren
  const kept = sensible(dedupeRoutes(legs));
  const cands = loopCandidates(kept);
  total += cands.filter((c) => c.gap > 150).length;
  loops = [];
  await pool(cands.map((c) => async () => {
    let conn = null;
    if (c.gap > 150) {
      try {
        const gj = await brouter([c.b.start, c.a.start], signal);
        conn = analyzeRoute(gj, c.b.start, { lng: c.a.start.lng, lat: c.a.start.lat });
        tick();
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        return;
      }
    }
    loops.push(makeLoop(c.a, c.b, conn));
  }), 3);
  if (signal?.aborted) return { routes: [] };
  const routes = finalize();
  onUpdate?.(routes, { done: true });
  return { routes };
}

function titleFor(start, peak) {
  const dir = compassWord(start.bearing ?? bearing([peak.lng, peak.lat], [start.lng, start.lat]));
  return start.name || `${typeLabel(start.type)}, ${dir}seite`;
}

export function toGPX(route, peakName) {
  const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' })[c]);
  const pts = route.coords
    .map(([lon, lat, ele]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${ele != null ? `<ele>${ele.toFixed(1)}</ele>` : ''}</trkpt>`)
    .join('\n');
  const name = route.kind === 'loop' ? `${peakName}: ${route.title}` : `${peakName} – ${route.title}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Gipfelplan" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
