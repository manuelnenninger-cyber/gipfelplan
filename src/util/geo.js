const R = 6371008.8; // Erdradius in m
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distanz in Metern zwischen [lon, lat]-Paaren */
export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Peilung von a nach b in Grad (0 = Nord, im Uhrzeigersinn) */
export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const DIRS = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'];
const DIRS_SHORT = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
export const compassWord = (b) => DIRS[Math.round(b / 45) % 8];
export const compassShort = (b) => DIRS_SHORT[Math.round(b / 45) % 8];

/** Kumulierte Distanzen (m) entlang einer Koordinatenliste */
export function cumulativeDistances(coords) {
  const out = new Array(coords.length);
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversine(coords[i - 1], coords[i]);
    out[i] = acc;
  }
  return out;
}

/**
 * Auf- und Abstieg mit Hysterese, damit Messrauschen im Höhenmodell
 * nicht als Höhenmeter zählt.
 */
export function ascentDescent(elevations, threshold = 5) {
  let up = 0;
  let down = 0;
  let ref = null;
  for (const e of elevations) {
    if (e == null || Number.isNaN(e)) continue;
    if (ref == null) { ref = e; continue; }
    const d = e - ref;
    if (d >= threshold) { up += d; ref = e; }
    else if (d <= -threshold) { down -= d; ref = e; }
  }
  return { up: Math.round(up), down: Math.round(down) };
}

export function boundsOf(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}

// Web-Mercator-Helfer (für die Wetterraster)
export const latToMercY = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
export const mercYToLat = (y) => deg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);
