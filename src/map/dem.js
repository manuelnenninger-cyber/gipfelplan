// Geländehöhen für Rechnungen im Browser (Sonne/Schatten): Terrarium-Kacheln laden
// und als Funktion (lng, lat) → Höhe anbieten. Dieselben Kacheln wie Relief und 3D,
// der Service Worker hält sie auch ohne Empfang bereit.
import { TERRAIN_TILES } from '../config.js';
import { terrarium } from './slope.js';

export function tileXY(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Bilinear interpolierte Höhe aus Kacheln; getTile(x, y) → Float32Array(256²) oder null */
export function makeSampler(getTile, z, size = 256) {
  const px = (tx, ty, ix, iy) => {
    // Pixel kann in der Nachbarkachel liegen
    const ox = Math.floor(ix / size), oy = Math.floor(iy / size);
    const t = getTile(tx + ox, ty + oy);
    return t ? t[(iy - oy * size) * size + (ix - ox * size)] : null;
  };
  return (lng, lat) => {
    const [fx, fy] = tileXY(lng, lat, z);
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const x = (fx - tx) * size - 0.5, y = (fy - ty) * size - 0.5;
    const ix = Math.floor(x), iy = Math.floor(y);
    const a = px(tx, ty, ix, iy), b = px(tx, ty, ix + 1, iy), c = px(tx, ty, ix, iy + 1), d = px(tx, ty, ix + 1, iy + 1);
    if (a == null || b == null || c == null || d == null) return a ?? b ?? c ?? d ?? null;
    const kx = x - ix, ky = y - iy;
    return (a * (1 - kx) + b * kx) * (1 - ky) + (c * (1 - kx) + d * kx) * ky;
  };
}

async function loadTile(z, x, y, signal) {
  const url = TERRAIN_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const img = await createImageBitmap(await res.blob());
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const out = new Float32Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = terrarium(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  return out;
}

/**
 * Gelände für ein Gebiet laden (mit Rand für den Horizont).
 * @param bounds { w, s, e, n } in Grad
 */
export async function loadDem(bounds, { z = 11, margin = 12000, signal } = {}) {
  const dLat = margin / 111320, dLng = margin / (111320 * Math.cos((((bounds.s + bounds.n) / 2) * Math.PI) / 180));
  const [x0, y0] = tileXY(bounds.w - dLng, bounds.n + dLat, z).map(Math.floor);
  const [x1, y1] = tileXY(bounds.e + dLng, bounds.s - dLat, z).map(Math.floor);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 49) throw new Error('Gebiet zu groß');
  const tiles = new Map();
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    jobs.push(loadTile(z, x, y, signal).then((t) => tiles.set(`${x}/${y}`, t)).catch(() => tiles.set(`${x}/${y}`, null)));
  }
  await Promise.all(jobs);
  if (![...tiles.values()].some(Boolean)) throw new Error('Gelände nicht verfügbar');
  return makeSampler((x, y) => tiles.get(`${x}/${y}`) || null, z);
}
