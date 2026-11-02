// Aktuelles Satellitenbild (Sentinel-2/Landsat, ca. 30 m, alle 2–3 Tage) aus NASA GIBS
// (HLS – Harmonized Landsat Sentinel). Zeigt, wo gerade Schnee liegt. Pro Kachel wird
// die neueste Aufnahme genommen; Lücken (kein Überflug) füllen ältere Aufnahmen.

export const HLS_PROTOCOL = 'gp-hls';
export const HLS_MAXZOOM = 12;
const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const PRODUCTS = ['HLS_S30_Nadir_BRDF_Adjusted_Reflectance', 'HLS_L30_Nadir_BRDF_Adjusted_Reflectance'];
const DAYS = 16;
const MAX_LAYERS = 4;

export const hlsUrl = (product, date, z, x, y) => `${BASE}/${product}/default/${date}/GoogleMapsCompatible_Level12/${z}/${y}/${x}.png`;

/** Datumsliste (neueste zuerst) der letzten Tage, ab gestern (heute ist oft noch leer) */
export function recentDates(now = new Date(), days = DAYS) {
  const out = [];
  for (let i = 1; i <= days; i++) out.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10));
  return out;
}

/** Anteil sichtbarer Pixel (0–1) */
export function coverage(rgba) {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) n++;
  return n / (rgba.length / 4);
}

const canvas2d = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const toPng = (c) => (c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((r) => c.toBlob(r, 'image/png')));

async function image(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return createImageBitmap(await res.blob());
}

// Aufnahmen, die es in der Gegend gibt: einmal pro Gebiet über eine grobe Kachel ermittelt
const scenes = new Map(); // "x/y" (Zoom 8) → Promise<[{ product, date, cover }]>
export function scenesFor(lng, lat) {
  const z = 8, n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  const key = `${x}/${y}`;
  if (!scenes.has(key)) {
    scenes.set(key, (async () => {
      const found = [];
      const c = canvas2d(256, 256);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      await Promise.all(recentDates().flatMap((date) => PRODUCTS.map(async (product) => {
        try {
          const img = await image(hlsUrl(product, date, z, x, y));
          if (!img) return;
          ctx.clearRect(0, 0, 256, 256);
          ctx.drawImage(img, 0, 0);
          const cover = coverage(ctx.getImageData(0, 0, 256, 256).data);
          if (cover > 0.05) found.push({ product, date, cover });
        } catch { /* Tag fehlt */ }
      })));
      return found.sort((a, b) => b.date.localeCompare(a.date) || b.cover - a.cover);
    })());
  }
  return scenes.get(key);
}

function tileCenter(z, x, y) {
  const n = 2 ** z;
  const lng = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

/** Zusammengesetzte Kachel (neueste Aufnahme oben) als Canvas */
export async function composeTile(z, x, y, signal) {
  const list = await scenesFor(...tileCenter(z, x, y));
  const c = canvas2d(256, 256);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let layers = 0;
  // neueste Aufnahme oben; ältere füllen nur, was noch durchsichtig ist
  ctx.globalCompositeOperation = 'destination-over';
  for (const s of list) {
    if (layers >= MAX_LAYERS) break;
    const img = await image(hlsUrl(s.product, s.date, z, x, y), signal).catch(() => null);
    if (!img) continue;
    ctx.drawImage(img, 0, 0, 256, 256);
    layers++;
    if (coverage(ctx.getImageData(0, 0, 256, 256).data) > 0.98) break;
  }
  return { canvas: c, ctx, newest: list[0]?.date || null };
}

/**
 * Sieht ein Pixel nach Schnee aus? Hell und farblos (Schnee in der Sonne, aber auch Wolken)
 * oder bläulich-hell (Schnee im Schatten). Wasser und Fels sind dunkler bzw. bräunlich.
 */
export function looksSnowy(r, g, b, a = 255) {
  if (a < 128) return null;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (min > 150 && max - min < 50) return true;
  if (b > 95 && b > r * 1.12 && g > r * 1.02 && r > 55) return true;
  return false;
}

/** Satellitenbild an Punkten auswerten: [{ ...p, snowy: true|false|null }] */
export async function snowFromSatellite(points, { z = 12, signal } = {}) {
  const tiles = new Map();
  const out = [];
  let newest = null;
  for (const p of points) {
    const n = 2 ** z;
    const fx = ((p.lng + 180) / 360) * n;
    const r = (p.lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    const key = `${Math.floor(fx)}/${Math.floor(fy)}`;
    if (!tiles.has(key)) tiles.set(key, composeTile(z, Math.floor(fx), Math.floor(fy), signal).catch(() => null));
    const t = await tiles.get(key);
    if (!t) { out.push({ ...p, snowy: null }); continue; }
    newest ||= t.newest;
    // 3×3 Pixel um den Punkt: Mehrheit entscheidet
    const px = Math.floor((fx % 1) * 256), py = Math.floor((fy % 1) * 256);
    const d = t.ctx.getImageData(Math.max(0, px - 1), Math.max(0, py - 1), 3, 3).data;
    let yes = 0, no = 0;
    for (let i = 0; i < d.length; i += 4) { const v = looksSnowy(d[i], d[i + 1], d[i + 2], d[i + 3]); if (v === true) yes++; else if (v === false) no++; }
    out.push({ ...p, snowy: yes + no === 0 ? null : yes > no });
  }
  return { points: out, date: newest };
}

let registered = false;
export function registerSatelliteProtocol(maplibregl) {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(HLS_PROTOCOL, async (params, abort) => {
    const [z, x, y] = params.url.replace(`${HLS_PROTOCOL}://`, '').split('?')[0].split('/').map(Number);
    const { canvas } = await composeTile(z, x, y, abort.signal);
    const blob = await toPng(canvas);
    return { data: await blob.arrayBuffer() };
  });
}
