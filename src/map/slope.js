// Hangneigung als Kartenebene: Aus denselben Geländekacheln wie Relief und 3D wird je
// Pixel die Neigung berechnet (Horn-Verfahren) und in Klassen eingefärbt – wie auf den
// Lawinen-Hangneigungskarten von swisstopo: ab 30° gelb, 35° orange, 40° rot, 45° violett.
import { TERRAIN_TILES } from '../config.js';

export const SLOPE_PROTOCOL = 'gp-slope';
export const SLOPE_MINZOOM = 11; // darunter ist das Geländemodell zu grob – Hänge wirken flacher
export const SLOPE_CLASSES = [
  { from: 30, color: [242, 214, 0], label: '30°' },
  { from: 35, color: [243, 146, 0], label: '35°' },
  { from: 40, color: [226, 0, 26], label: '40°' },
  { from: 45, color: [140, 40, 160], label: '45°' },
];

/** Terrarium-Kodierung → Höhe in Metern */
export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Bodenauflösung einer 256er-Kachel (Meter pro Pixel) in der Kachelmitte */
export function tileResolution(z, y) {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  const lat = Math.atan(Math.sinh(n));
  return ((2 * Math.PI * 6378137) / (256 * 2 ** z)) * Math.cos(lat);
}

/** Neigung in Grad für jedes Pixel (Horn, 3×3; am Rand wird die Nachbarzeile wiederholt) */
export function slopeDegrees(elev, size, res) {
  const out = new Float32Array(size * size);
  const at = (x, y) => elev[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1);
      const d = at(x - 1, y), f = at(x + 1, y);
      const g = at(x - 1, y + 1), h = at(x, y + 1), i = at(x + 1, y + 1);
      const dx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * res);
      const dy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * res);
      out[y * size + x] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    }
  }
  return out;
}

/** Farbe einer Neigung (RGBA); unter 30° durchsichtig */
export function slopeColor(deg) {
  let cls = null;
  for (const c of SLOPE_CLASSES) if (deg >= c.from) cls = c;
  return cls ? [...cls.color, 255] : [0, 0, 0, 0];
}

/** RGBA-Pixel einer Terrarium-Kachel → RGBA-Pixel der Hangneigungskachel */
export function slopePixels(rgba, size, z, y) {
  const elev = new Float32Array(size * size);
  for (let p = 0; p < size * size; p++) elev[p] = terrarium(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  const deg = slopeDegrees(elev, size, tileResolution(z, y));
  const out = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < deg.length; p++) out.set(slopeColor(deg[p]), p * 4);
  return out;
}

// --- Kacheln im Browser erzeugen (MapLibre-Protokoll gp-slope://z/x/y) -------------
const canvas2d = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};
const toPng = (c) => (c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((r) => c.toBlob(r, 'image/png')));

/**
 * Kachel-Protokoll aus Geländekacheln: draw(rgba, size, z, x, y, query) → RGBA-Pixel.
 * Für Hangneigung, Hangrichtung und Gefahrenstellen.
 */
export function registerTerrainProtocol(maplibregl, name, draw) {
  maplibregl.addProtocol(name, async (params, abort) => {
    const [path, query = ''] = params.url.replace(`${name}://`, '').split('?');
    const [z, x, y] = path.split('/').map(Number);
    const url = TERRAIN_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`Geländekachel ${res.status}`);
    const img = await createImageBitmap(await res.blob());
    const size = img.width;
    const c = canvas2d(size, size);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const src = ctx.getImageData(0, 0, size, size);
    const px = draw(src.data, size, z, x, y, new URLSearchParams(query));
    ctx.putImageData(new ImageData(px, size, size), 0, 0);
    const blob = await toPng(c);
    return { data: await blob.arrayBuffer() };
  });
}

let registered = false;
export function registerSlopeProtocol(maplibregl) {
  if (registered) return;
  registered = true;
  registerTerrainProtocol(maplibregl, SLOPE_PROTOCOL, (rgba, size, z, x, y) => slopePixels(rgba, size, z, y));
}
