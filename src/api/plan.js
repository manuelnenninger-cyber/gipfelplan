// Tour planen: Zeitplan (wann bin ich wo), Startzeit-Empfehlung aus Gewitter und
// Tageslicht, Wetter zur jeweiligen Uhrzeit, Sonne/Schatten und Schnee entlang der Route.
import { API } from '../config.js';
import { haversine } from '../util/geo.js';
import { hikingTime } from './routing.js';
import { fetchWithTimeout } from './osm.js';
import { cacheGet, cacheSet, cacheGetStale } from '../util/cache.js';
import { sunPosition, sunState } from '../util/sun.js';

const H = 3600000;
const LAPSE = 0.0065; // °C pro Meter

const isRoundTrip = (r) => !(r.kind === 'loop' || r.isLoop || r.oneWay);

/** Index des Gipfels auf der Route: nächster Punkt zum Gipfel, sonst höchster Punkt */
export function summitIndex(coords, peak) {
  if (peak) {
    let best = Infinity, bi = coords.length - 1;
    coords.forEach((c, i) => { const d = haversine(c, [peak.lng, peak.lat]); if (d < best) { best = d; bi = i; } });
    if (best < 400) return bi;
  }
  let bi = 0;
  coords.forEach((c, i) => { if ((c[2] ?? -1e9) > (coords[bi][2] ?? -1e9)) bi = i; });
  return bi;
}

/**
 * Ganze Tour als Zeitreihe: Hin- und Rückweg (bei Touren auf gleichem Weg) mit Gehzeit
 * je Punkt in Stunden. Die DAV-Formel verteilt die bekannten Auf-/Abstiegszeiten.
 * @returns {{ points: {lng,lat,ele,t}[], marks: {kind,name,t,ele,lng,lat}[], total, summitT }}
 */
export function buildItinerary(route, peak) {
  const out = route.coords;
  const round = isRoundTrip(route);
  const si = round ? out.length - 1 : summitIndex(out, peak);
  const trip = round ? [...out, ...out.slice(0, -1).reverse()] : out;
  let lastEle = trip.find((c) => c[2] != null)?.[2] ?? 0;
  const pts = trip.map(([lng, lat, z]) => { if (z != null) lastEle = z; return { lng, lat, ele: lastEle, t: 0 }; });
  const raw = [0];
  for (let i = 1; i < trip.length; i++) {
    const dz = pts[i].ele - pts[i - 1].ele;
    raw.push(raw[i - 1] + hikingTime(haversine(trip[i - 1], trip[i]), Math.max(0, dz), Math.max(0, -dz)));
  }
  const last = trip.length - 1;
  const upT = route.timeUp ?? raw[si];
  const total = route.timeTotal ?? (route.timeDown != null ? upT + route.timeDown : raw[last]);
  const rs = raw[si] || 1, rd = raw[last] - raw[si] || 1;
  pts.forEach((p, i) => { p.t = i <= si ? (raw[i] / rs) * upT : upT + ((raw[i] - raw[si]) / rd) * (total - upT); });

  const mark = (kind, name, i) => ({ kind, name, t: pts[i].t, ele: Math.round(pts[i].ele), lng: pts[i].lng, lat: pts[i].lat });
  const marks = [mark('start', route.start?.name || 'Start', 0)];
  for (const h of route.huts || []) if (h.index != null && h.index < si) marks.push(mark('hut', h.name, h.index));
  marks.push(mark('summit', peak?.name || 'Gipfel', si));
  if (round) for (const h of [...(route.huts || [])].reverse()) if (h.index != null && h.index < si) marks.push(mark('hut', h.name, 2 * si - h.index));
  marks.push(mark('end', round || route.isLoop ? 'Zurück am Start' : 'Ziel', last));
  marks.sort((a, b) => a.t - b.t);
  return { points: pts, marks, total, summitT: upT };
}

/** Position zur Gehzeit t (Stunden) */
export function pointAt(points, t) {
  if (t <= 0) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i].t >= t) {
      const a = points[i - 1], b = points[i];
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      return { lng: a.lng + (b.lng - a.lng) * k, lat: a.lat + (b.lat - a.lat) * k, ele: a.ele + (b.ele - a.ele) * k, t };
    }
  }
  return points[points.length - 1];
}

const atClock = (day, h, m = 0) => { const d = new Date(day.date); d.setHours(h, m, 0, 0); return d; };
const floor15 = (d) => new Date(Math.floor(d.getTime() / (15 * 60000)) * 15 * 60000);
const ceil15 = (d) => new Date(Math.ceil(d.getTime() / (15 * 60000)) * 15 * 60000);
export const isThunder = (h) => h.code >= 95 || h.cape >= 800;

/**
 * Wann losgehen? Spätestens so, dass man vor möglichen Gewittern und 30 min vor
 * Sonnenuntergang zurück ist; frühestens eine Stunde vor Sonnenaufgang.
 */
export function recommendStart(day, total, { now = new Date() } = {}) {
  const sunrise = day.sunrise || atClock(day, 7), sunset = day.sunset || atClock(day, 18);
  const durMs = total * H;
  const thunderHour = day.hours.find((h) => h.t.getHours() >= 9 && isThunder(h));
  const thunderAt = thunderHour?.t || null;
  const byLight = new Date(sunset.getTime() - 30 * 60000 - durMs);
  const byThunder = thunderAt ? new Date(thunderAt.getTime() - durMs) : null;
  let latest = byThunder && byThunder < byLight ? byThunder : byLight;
  latest = floor15(latest);
  let earliest = ceil15(new Date(sunrise.getTime() - H));
  if (now > earliest && now.toDateString() === day.date.toDateString()) earliest = ceil15(now);
  const eight = atClock(day, 8);
  let suggested = latest < eight ? latest : eight;
  if (suggested < earliest) suggested = earliest;
  const tight = latest < earliest;
  return { sunrise, sunset, thunderAt, latest, earliest, suggested, tight, limitedBy: byThunder && byThunder < byLight ? 'thunder' : 'light' };
}

/** Stunde der Prognose zu einer Uhrzeit */
export function hourAt(hours, date) {
  const t = date.getTime();
  let best = null;
  for (const h of hours) if (h.t.getTime() <= t) best = h; else break;
  return best || hours[0] || null;
}

/** Wetter an einem Punkt der Tour: Temperatur auf dessen Höhe umgerechnet */
export function weatherAt(fc, date, ele, { summit = false } = {}) {
  const h = hourAt(fc.hours, date);
  if (!h) return null;
  const base = fc.ele ?? ele;
  const dz = base - ele;
  return {
    code: h.code, isDay: h.isDay, precip: h.precip, prob: h.prob, cape: h.cape,
    temp: h.temp != null ? h.temp + dz * LAPSE : null,
    feels: h.feels != null ? h.feels + dz * LAPSE : null,
    wind: summit ? h.windSummit : h.wind, gust: h.gust,
    thunder: isThunder(h), freezing: h.freezing,
  };
}

/** Höchster Geländepunkt im Umkreis (Gipfel: man steht oben, nicht am Hang daneben) */
export function localTop(elevAt, lng, lat, radius = 90) {
  let best = { lng, lat, h: elevAt(lng, lat) ?? -Infinity };
  const dLat = 1 / 111320, dLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let dy = -radius; dy <= radius; dy += 15) {
    for (let dx = -radius; dx <= radius; dx += 15) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const q = [lng + dx * dLng, lat + dy * dLat];
      const h = elevAt(...q);
      if (h != null && h > best.h) best = { lng: q[0], lat: q[1], h };
    }
  }
  return best;
}

/** Sonne/Schatten entlang der Tour (alle ~6 Minuten, dazu genau am Gipfel), zu Abschnitten zusammengefasst */
export function sunAlong(points, start, elevAt, { step = 0.1, summitT = null } = {}) {
  const total = points[points.length - 1].t;
  const times = [];
  for (let t = 0; t < total; t += step) times.push(t);
  times.push(total);
  if (summitT != null && summitT > 0 && summitT < total) times.push(summitT);
  times.sort((a, b) => a - b);
  const segs = [];
  times.forEach((t, k) => {
    let p = pointAt(points, t);
    if (summitT != null && Math.abs(t - summitT) < 1e-9) p = localTop(elevAt, p.lng, p.lat);
    const when = new Date(start.getTime() + t * H);
    const st = sunState(elevAt, p.lng, p.lat, sunPosition(when, p.lat, p.lng)) || 'unknown';
    const to = times[k + 1] ?? total;
    const prev = segs[segs.length - 1];
    if (prev && prev.state === st) prev.to = to;
    else segs.push({ state: st, from: t, to });
  });
  if (segs.length > 1 && segs[segs.length - 1].from === segs[segs.length - 1].to) segs.pop();
  return segs;
}

/** Kurzer Text, z. B. „Aufstieg bis 9:40 im Schatten, Gipfel in der Sonne“ */
export function sunSummary(segs, summitT, start, fmt) {
  const at = (t) => { let hit = null; for (const s of segs) if (s.from <= t + 1e-9) hit = s; return hit?.state; };
  const share = (a, b, st) => segs.reduce((acc, s) => acc + Math.max(0, Math.min(s.to, b) - Math.max(s.from, a)) * (s.state === st), 0) / Math.max(1e-6, b - a);
  const total = segs.length ? segs[segs.length - 1].to : 0;
  const parts = [];
  const upSun = share(0, summitT, 'sun');
  if (upSun > 0.85) parts.push('Aufstieg fast ganz in der Sonne');
  else if (upSun < 0.15) parts.push('Aufstieg fast ganz im Schatten');
  else {
    const firstSun = segs.find((s) => s.state === 'sun' && s.from < summitT);
    if (at(0) !== 'sun' && firstSun) parts.push(`Aufstieg bis ${fmt(new Date(start.getTime() + firstSun.from * H))} im Schatten`);
    else parts.push(`Aufstieg zu ${Math.round(upSun * 100)} % in der Sonne`);
  }
  const top = at(summitT);
  parts.push(top === 'sun' ? 'Gipfel in der Sonne' : top === 'night' ? 'Gipfel bei Dunkelheit' : 'Gipfel im Schatten');
  if (total > summitT + 0.2) {
    const downSun = share(summitT, total, 'sun');
    parts.push(downSun > 0.85 ? 'Abstieg in der Sonne' : downSun < 0.15 ? 'Abstieg im Schatten' : `Abstieg zu ${Math.round(downSun * 100)} % sonnig`);
  }
  if (segs.some((s) => s.state === 'night')) parts.push('teils bei Dunkelheit – Stirnlampe');
  return parts.join(', ');
}

/** Stichproben entlang des Aufstiegs (Start und Gipfel immer dabei) */
export function samplePoints(points, upToT, n = 8) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(pointAt(points, (upToT * k) / (n - 1)));
  return out;
}

/** Schneehöhe laut Wettermodell an mehreren Punkten (ein Abruf, 3 h zwischengespeichert) */
export async function fetchSnowAlong(samples, { signal } = {}) {
  const url = new URL(API.openMeteo);
  url.search = new URLSearchParams({
    latitude: samples.map((p) => p.lat.toFixed(3)).join(','),
    longitude: samples.map((p) => p.lng.toFixed(3)).join(','),
    elevation: samples.map((p) => Math.round(p.ele)).join(','),
    current: 'snow_depth',
    timezone: 'auto',
  });
  const key = `keep:snow:v1:${url}`;
  let data = await cacheGet(key, 3 * H);
  if (!data) {
    try {
      const res = await fetchWithTimeout(url, { timeout: navigator.onLine === false ? 1 : 12000, signal });
      if (!res.ok) throw new Error(`Schneedaten nicht verfügbar (${res.status})`);
      data = await res.json();
      cacheSet(key, data);
    } catch (e) {
      const stale = await cacheGetStale(key);
      if (!stale) throw e;
      data = stale.data;
    }
  }
  const list = Array.isArray(data) ? data : [data];
  return samples.map((p, i) => ({ ...p, depth: list[i]?.current?.snow_depth ?? null }));
}

/** Schneegrenze aus den Stichproben: tiefster Punkt mit mindestens 3 cm */
export function snowSummary(samples) {
  const known = samples.filter((s) => s.depth != null);
  if (!known.length) return null;
  const snowy = known.filter((s) => s.depth >= 0.03).sort((a, b) => a.ele - b.ele);
  const top = [...known].sort((a, b) => b.ele - a.ele)[0];
  return {
    any: snowy.length > 0,
    from: snowy.length ? Math.floor(snowy[0].ele / 50) * 50 : null,
    topDepth: top.depth,
    maxDepth: Math.max(...known.map((s) => s.depth)),
  };
}

/**
 * Schneegrenze aus dem Satellitenbild: tiefste Höhe, ab der die meisten Punkte weiß sind.
 * @param pts [{ ele, snowy }] entlang des Aufstiegs
 */
export function satSnowLine(pts) {
  const known = pts.filter((p) => p.snowy != null).sort((a, b) => a.ele - b.ele);
  if (known.length < 3) return null;
  const share = known.filter((p) => p.snowy).length / known.length;
  // tiefster Punkt, ab dem mindestens 70 % der höheren Punkte weiß sind
  let from = null;
  for (let i = 0; i < known.length; i++) {
    const above = known.slice(i);
    if (above.filter((p) => p.snowy).length / above.length >= 0.7 && known[i].snowy) { from = known[i].ele; break; }
  }
  return { share, from: from == null ? null : Math.floor(from / 50) * 50, top: known[known.length - 1].snowy };
}
