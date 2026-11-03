// Touren teilen: Tour in der Datenbank ablegen (ohne Anmeldung) → kurzer Link /t/<id>.
// Der Link zeigt in Messengern eine Vorschau (Karte, Titel, Eckdaten), siehe server/share.js.
import { ACCOUNTS } from '../config.js';
import { accessToken } from './auth.js';
import { fetchWithTimeout } from './osm.js';
import { toRow, fromRow } from './tours.js';

const MAX_POINTS = 1500;

/** Koordinaten ausdünnen (jeder n-te Punkt, Start und Ziel bleiben) */
export function thin(coords, max = MAX_POINTS) {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

export const shareUrl = (id, origin = location.origin) => `${origin}/t/${id}`;

async function rpc(name, body) {
  const token = (await accessToken().catch(() => null)) || ACCOUNTS.anonKey;
  const res = await fetchWithTimeout(`${ACCOUNTS.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    timeout: 15000,
    headers: { apikey: ACCOUNTS.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.message || `Teilen fehlgeschlagen (${res.status})`);
  }
  return res.json();
}

/** Tour teilen → kurze ID */
export async function createShare(tour, peak) {
  const row = toRow({ ...tour, coords: thin(tour.coords) }, peak);
  return rpc('create_share', {
    p_title: row.title, p_kind: row.kind, p_peak: row.peak, p_stats: row.stats, p_coords: row.coords, p_waypoints: row.waypoints,
  });
}

/** Geteilte Tour laden (im App-Format) oder null */
export async function loadShare(id) {
  const rows = await rpc('get_share', { p_id: id });
  if (!rows?.[0]) return null;
  const t = fromRow(rows[0]);
  return { ...t, id: `share:${rows[0].id}`, savedId: undefined, shareId: rows[0].id, shared: true };
}
