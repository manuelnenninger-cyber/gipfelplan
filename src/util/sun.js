// Sonnenstand und Sonne/Schatten im Gelände. Reine Rechnung, ohne Browser.
const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J2000 = 10957.5; // Tage von 1970-01-01 bis 2000-01-01 12:00 UTC

/**
 * Sonnenstand (nach den Formeln von SunCalc/NOAA, genau auf ca. 0,5°)
 * @returns {{ alt: number, az: number }} Höhe über dem Horizont und Richtung (0° = Nord, im Uhrzeigersinn), in Grad
 */
export function sunPosition(date, lat, lng) {
  const d = date.getTime() / DAY_MS - J2000;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const e = RAD * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lng - ra;
  const phi = RAD * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { alt: alt / RAD, az: (azSouth / RAD + 540) % 360 };
}

/** Punkt in Entfernung d (m) und Richtung az (Grad) */
export function destination(lng, lat, az, d) {
  const dLat = (d * Math.cos(az * RAD)) / 111320;
  const dLng = (d * Math.sin(az * RAD)) / (111320 * Math.cos(lat * RAD));
  return [lng + dLng, lat + dLat];
}

/**
 * Liegt ein Punkt in der Sonne?
 * @param elevAt (lng, lat) → Höhe in m oder null (Geländemodell)
 * @returns 'sun' | 'shade' | 'night' | null (kein Gelände bekannt)
 */
export function sunState(elevAt, lng, lat, sun, { maxDist = 12000 } = {}) {
  if (sun.alt < -0.8) return 'night';
  const h0 = elevAt(lng, lat);
  if (h0 == null) return null;
  // eigener Hang von der Sonne abgewandt?
  const s = 30;
  const [ex, ey] = [destination(lng, lat, 90, s), destination(lng, lat, 0, s)];
  const [wx, wy] = [destination(lng, lat, 270, s), destination(lng, lat, 180, s)];
  const hE = elevAt(...ex), hW = elevAt(...wx), hN = elevAt(...ey), hS = elevAt(...wy);
  if (hE != null && hW != null && hN != null && hS != null) {
    const dzdx = (hE - hW) / (2 * s), dzdy = (hN - hS) / (2 * s);
    const ca = Math.cos(sun.alt * RAD);
    const dot = -dzdx * Math.sin(sun.az * RAD) * ca - dzdy * Math.cos(sun.az * RAD) * ca + Math.sin(sun.alt * RAD);
    if (dot <= 0) return 'shade';
  }
  // Horizont in Sonnenrichtung abtasten (nah fein, fern grob; Erdkrümmung berücksichtigt)
  const tanAlt = Math.tan(Math.max(sun.alt, -0.8) * RAD);
  const eye = h0 + 2;
  for (let d = 40; d <= maxDist; d = d < 600 ? d + 40 : d * 1.07) {
    const [x, y] = destination(lng, lat, sun.az, d);
    const h = elevAt(x, y);
    if (h == null) continue;
    const drop = (d * d) / (2 * 6371000) * 0.87;
    if ((h - drop - eye) / d > tanAlt) return 'shade';
  }
  return 'sun';
}
