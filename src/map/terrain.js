// Weitere Geländeebenen aus den Geländekacheln (wie die Hangneigung, im Browser berechnet):
// – Hangrichtung: wohin ein Hang zeigt (8 Richtungen, wählbar über eine Windrose)
// – Gefahrenstellen: steile Hänge, die laut Lawinenbericht heute gemieden werden sollten
import { terrarium, tileResolution, registerTerrainProtocol } from './slope.js';
import { ASPECTS, aspectIndex, dangerClass, decodeSpec } from '../api/avyCheck.js';

export const ASPECT_PROTOCOL = 'gp-aspect';
export const DANGER_PROTOCOL = 'gp-danger';
export const ASPECT_MIN_SLOPE = 20; // flacher hat die Richtung kaum Bedeutung

// Farbkreis: Nord blau, Ost grün, Süd gelb, West rot
export const ASPECT_COLORS = {
  N: [47, 99, 214], NE: [26, 170, 196], E: [52, 178, 82], SE: [160, 200, 40],
  S: [245, 196, 20], SW: [242, 133, 34], W: [222, 62, 52], NW: [150, 70, 196],
};
export const DANGER_COLORS = { 1: [255, 150, 20], 2: [225, 20, 40] };

/** Steilheit und Hangrichtung je Pixel (Horn-Verfahren) */
export function slopeAspect(elev, size, res) {
  const slope = new Float32Array(size * size), aspect = new Float32Array(size * size);
  const at = (x, y) => elev[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1);
      const d = at(x - 1, y), f = at(x + 1, y);
      const g = at(x - 1, y + 1), h = at(x, y + 1), i = at(x + 1, y + 1);
      const east = (c + 2 * f + i - (a + 2 * d + g)) / (8 * res);
      const north = (a + 2 * b + c - (g + 2 * h + i)) / (8 * res); // Zeilen laufen nach Süden
      const k = y * size + x;
      slope[k] = (Math.atan(Math.hypot(east, north)) * 180) / Math.PI;
      aspect[k] = ((Math.atan2(-east, -north) * 180) / Math.PI + 360) % 360; // Richtung bergab
    }
  }
  return { slope, aspect };
}

const elevation = (rgba, size) => {
  const e = new Float32Array(size * size);
  for (let p = 0; p < size * size; p++) e[p] = terrarium(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  return e;
};

/** Hangrichtung einfärben; mask = Bitmaske der gewählten Richtungen (Bit 0 = N … Bit 7 = NW) */
export function aspectPixels(rgba, size, z, y, mask = 255) {
  const { slope, aspect } = slopeAspect(elevation(rgba, size), size, tileResolution(z, y));
  const out = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < slope.length; p++) {
    if (slope[p] < ASPECT_MIN_SLOPE) continue;
    const i = aspectIndex(aspect[p]);
    if (!(mask & (1 << i))) continue;
    out.set([...ASPECT_COLORS[ASPECTS[i]], slope[p] >= 30 ? 255 : 190], p * 4);
  }
  return out;
}

/** Gefahrenstellen laut Bericht (spec aus dangerSpec) */
export function dangerPixels(rgba, size, z, y, spec) {
  const elev = elevation(rgba, size);
  const { slope, aspect } = slopeAspect(elev, size, tileResolution(z, y));
  const out = new Uint8ClampedArray(size * size * 4);
  if (!spec) return out;
  for (let p = 0; p < slope.length; p++) {
    const c = dangerClass(spec, slope[p], aspect[p], elev[p]);
    if (c) out.set([...DANGER_COLORS[c], 255], p * 4);
  }
  return out;
}

let registered = false;
export function registerTerrainLayers(maplibregl) {
  if (registered) return;
  registered = true;
  registerTerrainProtocol(maplibregl, ASPECT_PROTOCOL, (rgba, size, z, x, y, q) => aspectPixels(rgba, size, z, y, Number(q.get('m') ?? 255)));
  registerTerrainProtocol(maplibregl, DANGER_PROTOCOL, (rgba, size, z, x, y, q) => dangerPixels(rgba, size, z, y, decodeSpec(q.get('s') || '')));
}
