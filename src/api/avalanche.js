// Lawinenlage aus den Berichten der europäischen Lawinenwarndienste (EAWS).
// Die Daten sammelt das Projekt avalanche.report (LWD Tirol / Euregio) für ganz Europa:
//   – Warnstufen aller Regionen pro Tag:  eaws_bulletins/<Datum>/<Datum>.ratings.json
//   – Berichte je Warndienst:             eaws_bulletins/<Datum>/<Datum>-<Dienst>.de.json
//   – Regionsgrenzen als Vektorkacheln:   eaws-regions.pmtiles
import { fetchWithTimeout } from './osm.js';

export const AVA_BASE = 'https://static.avalanche.report';
export const AVA_PMTILES = `${AVA_BASE}/eaws-regions.pmtiles`;
const LIBS = {
  pmtiles: 'https://cdn.jsdelivr.net/npm/pmtiles@4.3.0/+esm',
  vt: 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.3/+esm',
  pbf: 'https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm',
};

// Offizielle EAWS-Farben
export const LEVEL_COLOR = { 1: '#ccff66', 2: '#ffff00', 3: '#ff9900', 4: '#ff0000', 5: '#1a1a1a' };
export const LEVEL_NAME = { 1: 'gering', 2: 'mäßig', 3: 'erheblich', 4: 'groß', 5: 'sehr groß' };
const MAIN_VALUE = { low: 1, moderate: 2, considerable: 3, high: 4, very_high: 5 };
export const PROBLEM_NAME = {
  new_snow: 'Neuschnee',
  wind_slab: 'Triebschnee',
  persistent_weak_layers: 'Altschnee',
  wet_snow: 'Nassschnee',
  gliding_snow: 'Gleitschnee',
  cornices: 'Wechten',
  favourable_situation: 'Günstige Situation',
  no_distinct_avalanche_problem: 'Kein ausgeprägtes Problem',
};
const ASPECT_DE = { N: 'N', NE: 'NO', E: 'O', SE: 'SO', S: 'S', SW: 'SW', W: 'W', NW: 'NW' };
const ASPECT_ORDER = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const TREELINE = 1800; // grobe Annahme für „Waldgrenze“ in den Alpen (nur für die Stufe am Gipfel)

/** Datum als JJJJ-MM-TT in Ortszeit */
export function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// Vorschau eines anderen Tages (z. B. ?lawinen=2026-02-15 für einen Wintertag):
// alle Lawinen-Abfragen werden um die Differenz zu heute verschoben.
let shiftDays = 0;
try {
  const want = new URLSearchParams(globalThis.location?.search || '').get('lawinen');
  if (want && /^\d{4}-\d{2}-\d{2}$/.test(want)) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    shiftDays = Math.round((new Date(`${want}T12:00:00`) - today) / 86400000);
  }
} catch { /* ohne Vorschau */ }
export const isPreview = () => shiftDays !== 0;

/** Berichtsdatum zu einem Kalendertag (berücksichtigt die Vorschau) */
export function avaKey(d) {
  const x = new Date(d);
  x.setDate(x.getDate() + shiftDays);
  return dayKey(x);
}

/**
 * Welcher Tagesbericht gilt zu einem Zeitpunkt? Berichte gelten von 17 Uhr am Vortag
 * bis 17 Uhr am Ausgabetag. Vormittag/Nachmittag für Stufen, die sich im Tagesverlauf ändern.
 */
export function bulletinFor(time) {
  const t = new Date(time);
  const d = new Date(t);
  if (t.getHours() >= 17) d.setDate(d.getDate() + 1);
  return { date: avaKey(d), period: t.getHours() >= 12 && t.getHours() < 17 ? 'pm' : 'am' };
}

// --- Abrufe (zwischengespeichert) ----------------------------------------------
const memo = new Map();
function once(key, fn) {
  if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw e; }));
  return memo.get(key);
}

/** Warnstufen aller Regionen für einen Tag; null, wenn es (noch) keine gibt */
export function fetchRatings(date) {
  return once(`r:${date}`, async () => {
    const res = await fetchWithTimeout(`${AVA_BASE}/eaws_bulletins/${date}/${date}.ratings.json`, { timeout: 10000 });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Lawinendaten: ${res.status}`);
    return (await res.json()).maxDangerRatings || null;
  });
}

/** Berichte eines Warndienstes (z. B. „AT-07“), bevorzugt auf Deutsch */
export function fetchBulletins(service, date) {
  return once(`b:${service}:${date}`, async () => {
    for (const suffix of ['.de.json', '.json']) {
      const res = await fetchWithTimeout(`${AVA_BASE}/eaws_bulletins/${date}/${date}-${service}${suffix}`, { timeout: 10000 });
      if (res.ok) return (await res.json()).bulletins || [];
    }
    return null;
  });
}

// --- In welcher Region liegt ein Punkt? ------------------------------------------
let libs = null;
let archive = null;
function loadLibs() {
  libs ||= Promise.all([import(/* @vite-ignore */ LIBS.pmtiles), import(/* @vite-ignore */ LIBS.vt), import(/* @vite-ignore */ LIBS.pbf)])
    .then(([pm, vt, pbf]) => ({ pm, vt, Pbf: pbf.default || pbf.Pbf }))
    .catch((e) => { libs = null; throw e; });
  return libs;
}
/** PMTiles-Bibliothek (auch für die Kartenebene) */
export async function pmtilesLib() { return (await loadLibs()).pm; }

const validOn = (p, date) => (!p.start_date || p.start_date <= date) && (!p.end_date || p.end_date > date);

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInGeometry(lng, lat, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));
}

/**
 * Region und Warndienst an einer Stelle.
 * @returns {{ id, service, provider: { name, url } | null, threshold } | null}
 */
export function lookupRegion(lat, lng, date = dayKey(new Date())) {
  return once(`l:${lat.toFixed(4)},${lng.toFixed(4)},${date}`, async () => {
    const { pm, vt, Pbf } = await loadLibs();
    archive ||= new pm.PMTiles(AVA_PMTILES);
    const z = 10, n = 2 ** z;
    const x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    const t = await archive.getZxy(z, x, y);
    if (!t?.data) return null;
    const tile = new vt.VectorTile(new Pbf(new Uint8Array(t.data)));
    const hits = (name) => {
      const L = tile.layers[name];
      const out = [];
      for (let i = 0; L && i < L.length; i++) {
        const f = L.feature(i);
        if (validOn(f.properties, date) && pointInGeometry(lng, lat, f.toGeoJSON(x, y, z).geometry)) out.push(f.properties);
      }
      return out;
    };
    const region = hits('micro-regions').sort((a, b) => b.id.length - a.id.length)[0];
    if (!region) return null;
    const outline = hits('outline').find((o) => region.id.startsWith(o.id)) || null;
    let provider = null;
    try {
      const aws = JSON.parse(outline?.aws || '[]')[0];
      if (aws) provider = { name: aws.name, url: aws.url?.de || aws.url?.en || null };
    } catch { /* ohne Anbieterangaben */ }
    const elev = hits('micro-regions_elevation').find((e) => e.id === region.id);
    return { id: region.id, service: outline?.id || region.id.split('-').slice(0, 2).join('-'), provider, threshold: elev?.threshold ?? null };
  });
}

// --- Bericht zusammenfassen ------------------------------------------------------
const boundText = (b) => (b == null ? null : b === 'treeline' ? 'Waldgrenze' : `${Number(b).toLocaleString('de-DE')} m`);
const boundMeters = (b) => (b === 'treeline' ? TREELINE : Number(b));

function aspectsText(list) {
  if (!list?.length || list.length >= 8) return 'alle Hangrichtungen';
  return ASPECT_ORDER.filter((a) => list.includes(a)).map((a) => ASPECT_DE[a]).join(', ');
}

function levelsFrom(ratings, period) {
  const use = ratings.filter((r) => !r.validTimePeriod || r.validTimePeriod === 'all_day' || r.validTimePeriod === (period === 'am' ? 'earlier' : 'later'));
  let high = 0, low = 0, bound = null;
  for (const r of use) {
    const v = MAIN_VALUE[r.mainValue] || 0;
    const lb = r.elevation?.lowerBound, ub = r.elevation?.upperBound;
    if (lb != null) { high = Math.max(high, v); bound ??= lb; }
    else if (ub != null) { low = Math.max(low, v); bound ??= ub; }
    else { high = Math.max(high, v); low = Math.max(low, v); }
  }
  return { high, low, bound, max: Math.max(high, low) };
}

/** Stufe auf einer bestimmten Höhe (z. B. am Gipfel), wenn sich oben und unten unterscheiden */
export function levelAt(report, ele) {
  if (!report || report.state !== 'rated' || !ele || report.boundM == null || report.high === report.low) return null;
  return ele >= report.boundM ? report.high : report.low;
}

/**
 * Alles Wichtige für eine Region und einen Tag.
 * @returns {{ state: 'rated'|'none'|'missing', ... }}
 *   rated   – Warnstufe vorhanden
 *   none    – Bericht/Region bekannt, aber keine Stufe (Sommer, kein Schnee)
 *   missing – für diesen Tag (noch) gar kein Bericht
 */
export async function avalancheReport(region, date) {
  const ratings = await fetchRatings(date).catch(() => null);
  if (!ratings) return { state: 'missing', date, region };
  const r = (k) => ratings[k] ?? null;
  const id = region.id;
  const fromRatings = {
    max: r(id) ?? 0,
    high: r(`${id}:high:am`) ?? r(`${id}:high`) ?? r(id) ?? 0,
    low: r(`${id}:low:am`) ?? r(`${id}:low`) ?? r(id) ?? 0,
    pmMax: Math.max(r(`${id}:high:pm`) ?? 0, r(`${id}:low:pm`) ?? 0, r(`${id}:pm`) ?? 0),
  };
  if (!fromRatings.max) return { state: 'none', date, region };

  const bulletins = await fetchBulletins(region.service, date).catch(() => null);
  const b = bulletins?.find((x) => x.regions?.some((g) => g.regionID === id))
    || bulletins?.find((x) => x.regions?.some((g) => id.startsWith(g.regionID)));
  const am = b ? levelsFrom(b.dangerRatings || [], 'am') : null;
  const pm = b ? levelsFrom(b.dangerRatings || [], 'pm') : null;
  const high = am?.high || fromRatings.high;
  const low = am?.low || fromRatings.low;
  const bound = am?.bound ?? null;
  const de = b?.lang === 'de';

  return {
    state: 'rated',
    date,
    region,
    regionName: b?.regions?.find((g) => g.regionID === id)?.name || null,
    level: Math.max(high, low),
    high, low,
    bound: boundText(bound),
    boundM: bound != null ? boundMeters(bound) : null,
    pmLevel: pm && pm.max > (am?.max || 0) ? pm.max : fromRatings.pmMax > Math.max(high, low) ? fromRatings.pmMax : null,
    problems: (b?.avalancheProblems || [])
      .filter((p) => PROBLEM_NAME[p.problemType])
      .map((p) => ({
        type: p.problemType,
        name: PROBLEM_NAME[p.problemType],
        where: [p.elevation?.lowerBound != null ? `über ${boundText(p.elevation.lowerBound)}` : p.elevation?.upperBound != null ? `unter ${boundText(p.elevation.upperBound)}` : null, aspectsText(p.aspects)].filter(Boolean).join(' · '),
        pm: p.validTimePeriod === 'later',
      }))
      .filter((p, i, all) => all.findIndex((q) => q.type === p.type && q.where === p.where) === i),
    highlights: de ? stripHtml(b?.avalancheActivity?.highlights) : null,
    tendency: { increasing: 'steigend', steady: 'gleichbleibend', decreasing: 'abnehmend' }[b?.tendency?.[0]?.tendencyType] || null,
    validUntil: b?.validTime?.endTime ? new Date(b.validTime.endTime) : null,
    published: b?.publicationTime ? new Date(b.publicationTime) : null,
    provider: region.provider?.name || b?.source?.provider?.name || null,
    url: region.provider?.url || b?.source?.provider?.website || 'https://www.avalanches.org',
  };
}

function stripHtml(s) {
  if (!s) return null;
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null;
}

/** Warnstufe je Teilgebiet (oben/unten) für die Karte: { "AT-07-02-01:high": 3, … } */
export function mapLevels(ratings, period) {
  const out = {};
  if (!ratings) return out;
  for (const k of Object.keys(ratings)) {
    const parts = k.split(':');
    if (parts.length !== 1) continue;
    const id = parts[0];
    for (const e of ['high', 'low']) {
      out[`${id}:${e}`] = ratings[`${id}:${e}:${period}`] ?? ratings[`${id}:${e}`] ?? ratings[id];
    }
  }
  return out;
}
