// Lawinen-Check: Gelände (Steilheit, Hangrichtung, Höhe) mit dem Lawinenlagebericht
// abgleichen – nach dem Grundgedanken der Reduktionsmethode: je höher die Gefahrenstufe,
// desto flacher die Hänge, die man noch betreten sollte; in den Kernzonen des Berichts
// (gefährdete Hangrichtungen und Höhen) gilt die Stufe voll, außerhalb eine Stufe weniger.
// Grobe Planungshilfe – ersetzt weder Lagebericht noch Beurteilung vor Ort.
import { haversine } from '../util/geo.js';

export const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const ASPECT_DE = { N: 'Nord', NE: 'Nordost', E: 'Ost', SE: 'Südost', S: 'Süd', SW: 'Südwest', W: 'West', NW: 'Nordwest' };
/** Bis zu dieser Steilheit (Grad) gilt ein Hang je Gefahrenstufe als vertretbar */
export const THRESH = { 1: 45, 2: 40, 3: 35, 4: 30, 5: 27 };
export const MIN_SLOPE = 28; // flacher lösen sich kaum Schneebrettlawinen
export const MAX_SLOPE = 60; // steiler: Fels, dort hält sich kaum Schnee (kein Anrissgebiet)
const SKIP = new Set(['favourable_situation', 'no_distinct_avalanche_problem']);

/** Hangrichtung (Grad, 0 = Nord) → Index 0–7 */
export const aspectIndex = (deg) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;

/**
 * Kompakte Beschreibung des Berichts für die Rechnung (auch in Kachel-Adressen):
 * { h, l, b, z: [[Richtungsmaske, unten|null, oben|null], …] }
 */
export function dangerSpec(report) {
  if (!report || report.state !== 'rated') return null;
  const zones = (report.problems || [])
    .filter((p) => !SKIP.has(p.type))
    .map((p) => [ASPECTS.reduce((m, a, i) => ((p.aspects || ASPECTS).includes(a) ? m | (1 << i) : m), 0), p.lower ?? null, p.upper ?? null]);
  return { h: report.high || report.level, l: report.low || report.level, b: report.boundM ?? null, z: zones };
}

export const encodeSpec = (spec) => encodeURIComponent(JSON.stringify(spec));
export const decodeSpec = (s) => { try { return JSON.parse(decodeURIComponent(s)); } catch { return null; } };

/** Gilt dieser Hang als Kernzone (Hangrichtung und Höhe aus dem Bericht)? Ohne Angaben: überall. */
export function inCore(spec, aspectDeg, ele) {
  if (!spec.z?.length) return true;
  const bit = 1 << aspectIndex(aspectDeg);
  return spec.z.some(([mask, lo, up]) => (mask & bit) && (lo == null || ele >= lo) && (up == null || ele < up));
}

/** Gefahrenstufe auf einer Höhe */
export const levelAt = (spec, ele) => (spec.b == null ? Math.max(spec.h, spec.l) : ele >= spec.b ? spec.h : spec.l);

/**
 * 0 = unauffällig, 1 = Vorsicht (bis 5° unter der Grenze), 2 = meiden
 */
export function dangerClass(spec, slope, aspectDeg, ele) {
  if (!spec || slope < MIN_SLOPE || slope >= MAX_SLOPE) return 0;
  const lvl = levelAt(spec, ele);
  if (!lvl) return 0;
  const eff = inCore(spec, aspectDeg, ele) ? lvl : Math.max(1, lvl - 1);
  const t = THRESH[eff] ?? 45;
  return slope >= t ? 2 : slope >= t - 5 ? 1 : 0;
}

/** Steilheit und Hangrichtung des Geländes an einem Punkt (Mittelwert über ±step m) */
export function terrainAt(elevAt, lng, lat, step = 20) {
  const dLat = step / 111320, dLng = step / (111320 * Math.cos((lat * Math.PI) / 180));
  const e = elevAt(lng + dLng, lat), w = elevAt(lng - dLng, lat), n = elevAt(lng, lat + dLat), s = elevAt(lng, lat - dLat);
  const h = elevAt(lng, lat);
  if ([e, w, n, s, h].some((v) => v == null)) return null;
  const dzdx = (e - w) / (2 * step), dzdy = (n - s) / (2 * step);
  const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  const aspect = ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360;
  return { slope, aspect, ele: h };
}

/**
 * Tour prüfen: alle ~25 m Gelände bewerten, auffällige Abschnitte zusammenfassen.
 * Steilste Stelle im Umkreis von ~15 m zählt (man quert den Hang, nicht nur die Spur).
 * @returns {{ level: 0|1|2, sections: [...], maxSlope, spec } | null}
 */
export function checkRoute(coords, elevAt, spec, { step = 25 } = {}) {
  const samples = [];
  let d = 0, next = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i) d += haversine(coords[i - 1], coords[i]);
    if (d < next && i !== coords.length - 1) continue;
    next = d + step;
    const [lng, lat] = coords[i];
    let worst = null;
    // steilster (aber nicht felsiger) Hang direkt an der Spur
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = terrainAt(elevAt, lng + (ox * 15) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (oy * 15) / 111320);
      if (t && (!worst || (t.slope < MAX_SLOPE && (worst.slope >= MAX_SLOPE || t.slope > worst.slope)))) worst = t;
    }
    if (!worst) continue;
    samples.push({ d, lng, lat, ...worst, cls: dangerClass(spec, worst.slope, worst.aspect, worst.ele), core: inCore(spec, worst.aspect, worst.ele) });
  }
  if (samples.length < 3) return null; // Gelände nicht bekannt
  const sections = [];
  for (const s of samples) {
    const last = sections[sections.length - 1];
    if (s.cls && last && last.cls === s.cls && s.d - last.to <= step * 1.5) {
      last.to = s.d; last.points.push([s.lng, s.lat]);
      if (s.slope > last.slope) Object.assign(last, { slope: s.slope, aspect: s.aspect, ele: s.ele, core: s.core });
    } else if (s.cls) {
      sections.push({ cls: s.cls, from: s.d, to: s.d, slope: s.slope, aspect: s.aspect, ele: s.ele, core: s.core, points: [[s.lng, s.lat]] });
    }
  }
  // Einzelpunkte zählen erst ab zwei Stichproben (Rauschen des Geländemodells)
  const real = sections.filter((x) => x.points.length >= 2);
  const level = real.some((x) => x.cls === 2) ? 2 : real.length ? 1 : 0;
  return { level, sections: real, maxSlope: Math.max(0, ...samples.map((x) => x.slope)), spec };
}

export const CHECK_LABEL = { 0: 'unauffällig', 1: 'Vorsicht', 2: 'kritisch' };
