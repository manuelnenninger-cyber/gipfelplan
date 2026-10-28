// Webcams rund um den Gipfel (über /api/webcams → Windy Webcams API)
import { fetchWithTimeout } from './osm.js';

const MAX_AGE = 8 * 60 * 1000; // Bild-Adressen der kostenlosen API laufen nach ca. 10 Minuten ab
const memo = new Map();

/**
 * @returns {Promise<{ cams: object[], fetchedAt: number } | null>} null, wenn kein Schlüssel eingerichtet ist
 */
export async function fetchWebcams(lat, lng, { radius = 25, fresh = false, signal } = {}) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${radius}`;
  const hit = memo.get(key);
  if (hit && !fresh && Date.now() - hit.fetchedAt < MAX_AGE) return hit;
  const res = await fetchWithTimeout(`/api/webcams?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&r=${radius}`, { timeout: 10000, signal });
  if (res.status === 503 || res.status === 404) return null; // nicht eingerichtet (oder Dev-Server ohne Funktion)
  if (!res.ok) throw new Error(`Webcams: ${res.status}`);
  const data = await res.json();
  memo.set(key, data);
  return data;
}

/** „vor 7 Min.“, „vor 3 Std.“ … */
export function ageText(iso, now = Date.now()) {
  if (!iso) return null;
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min)) return null;
  if (min < 2) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 36) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}
