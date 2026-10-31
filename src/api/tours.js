// Gespeicherte Touren (Supabase-Datenbank, Zeilenrechte: nur eigene Touren)
import { ACCOUNTS } from '../config.js';
import { accessToken } from './auth.js';
import { fetchWithTimeout } from './osm.js';
import { cumulativeDistances } from '../util/geo.js';

const STAT_KEYS = ['color', 'length', 'up', 'down', 'timeUp', 'timeDown', 'timeTotal', 'sac', 'sacShare', 'viaFerrata', 'startEle', 'isLoop', 'oneWay', 'gapToSummit', 'direction', 'subtitle', 'ascentVia', 'descentVia', 'symbol', 'link'];

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Nicht angemeldet');
  const res = await fetchWithTimeout(`${ACCOUNTS.url}/rest/v1/${path}`, {
    method,
    timeout: 15000,
    headers: {
      apikey: ACCOUNTS.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer && { Prefer: prefer }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.message || `Speichern fehlgeschlagen (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

/** Tour → Datenbankzeile (Koordinaten gerundet: ~1 m genau, Höhe auf 1 m) */
export function toRow(tour, peak) {
  const stats = {};
  for (const k of STAT_KEYS) if (tour[k] !== undefined) stats[k] = tour[k];
  if (tour.huts?.length) stats.huts = tour.huts.map((h) => ({ name: h.name, time: h.time }));
  if (tour.start) stats.start = { type: tour.start.type, name: tour.start.name, lat: tour.start.lat, lng: tour.start.lng };
  return {
    title: tour.title.slice(0, 200),
    kind: tour.kind || 'direct',
    peak: peak ? { name: peak.name, lat: peak.lat, lng: peak.lng, ele: peak.ele ?? null, region: peak.region || '' } : null,
    stats,
    coords: tour.coords.map(([x, y, z]) => [+x.toFixed(5), +y.toFixed(5), z == null ? null : Math.round(z)]),
    waypoints: tour.waypoints || null,
  };
}

/** Datenbankzeile → Tour im App-Format */
export function fromRow(row) {
  const s = row.stats || {};
  return {
    ...s,
    id: `saved:${row.id}`,
    savedId: row.id,
    kind: row.kind,
    title: row.title,
    baseTitle: row.title,
    coords: row.coords,
    dist: cumulativeDistances(row.coords),
    start: s.start || { id: row.id, type: 'trailhead', name: null, lat: row.coords[0][1], lng: row.coords[0][0] },
    huts: s.huts || [],
    waypoints: row.waypoints || undefined,
    peak: row.peak,
    savedAt: row.created_at,
  };
}

export async function listTours() {
  const rows = await rest('tours?select=*&order=created_at.desc&limit=200');
  return rows.map(fromRow);
}

export async function saveTour(tour, peak) {
  const [row] = await rest('tours', { method: 'POST', body: toRow(tour, peak), prefer: 'return=representation' });
  return fromRow(row);
}

export async function deleteTour(savedId) {
  await rest(`tours?id=eq.${encodeURIComponent(savedId)}`, { method: 'DELETE' });
}
