import { API } from '../config.js';
import { parseEle } from './search.js';

/** fetch mit Zeitlimit; bricht auch ab, wenn das äußere Signal abbricht */
export async function fetchWithTimeout(url, { timeout = 10000, signal, ...opts } = {}) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(new DOMException('Zeitüberschreitung', 'TimeoutError')), timeout);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    if (ctrl.signal.aborted) throw new Error('Zeitüberschreitung');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const TYPE_LABEL = {
  parking: 'Parkplatz',
  trailhead: 'Ausgangspunkt',
  cablecar: 'Bergbahn',
  station: 'Bahnhof',
  bus: 'Bushaltestelle',
  hut: 'Hütte',
};
export const typeLabel = (t) => TYPE_LABEL[t] || 'Startpunkt';

function classify(tags) {
  if (tags.highway === 'trailhead') return 'trailhead';
  if (tags.aerialway === 'station') return 'cablecar';
  if (tags.railway === 'station' || tags.railway === 'halt') return 'station';
  if (tags.highway === 'bus_stop') return 'bus';
  if (tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut') return 'hut';
  if (tags.amenity === 'parking') return 'parking';
  return null;
}

// ---------------------------------------------------------------------------
// Quelle 1: Overpass – vollständig (auch unbenannte Parkplätze), aber die
// öffentlichen Server sind oft überlastet. Alle Server parallel, mit Zeitlimit.
// ---------------------------------------------------------------------------
async function viaOverpass(peak, radius, signal) {
  const { lat, lng } = peak;
  const around = `(around:${radius},${lat},${lng})`;
  const peakPart = peak.osmType === 'N' && peak.osmId ? `node(id:${peak.osmId});out tags;` : '';
  const q = `[out:json][timeout:15];
${peakPart}
(
  nwr["amenity"="parking"]["access"!~"^(private|no|customers)$"]${around};
  node["highway"="trailhead"]${around};
  node["aerialway"="station"]${around};
  node["railway"~"^(station|halt)$"]${around};
  node["highway"="bus_stop"]["name"]${around};
  nwr["tourism"~"^(alpine_hut|wilderness_hut)$"]${around};
);
out center tags;`;

  const ask = async (endpoint) => {
    const res = await fetchWithTimeout(`${endpoint}?data=${encodeURIComponent(q)}`, { timeout: 9000, signal });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();
    if (data.remark && /runtime error|timeout/i.test(data.remark)) throw new Error('Overpass überlastet');
    return data;
  };
  const data = await Promise.any(API.overpass.map(ask)).catch((e) => {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    throw new Error(e.errors?.[0]?.message || 'Overpass nicht erreichbar');
  });

  let ele = null;
  const places = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    if (el.type === 'node' && String(el.id) === String(peak.osmId) && tags.natural) {
      ele = parseEle(tags.ele);
      continue;
    }
    const type = classify(tags);
    if (!type) continue;
    const plat = el.lat ?? el.center?.lat;
    const plng = el.lon ?? el.center?.lon;
    if (plat == null) continue;
    places.push({
      id: `${el.type}/${el.id}`,
      type,
      name: tags.name || null,
      lat: plat,
      lng: plng,
      ele: parseEle(tags.ele),
      kind: tags.tourism || null,
      tags, // für die Infokarte (Öffnungszeiten, Telefon, Foto …)
    });
  }
  return { ele, places, source: 'overpass' };
}

// ---------------------------------------------------------------------------
// Quelle 2: Photon (Umkreissuche). Schnell und zuverlässig, kennt aber nur
// benannte Orte. Reicht für gute Routenvorschläge.
// ---------------------------------------------------------------------------
const PHOTON_GROUPS = [
  ['amenity:parking', 'highway:trailhead', 'aerialway:station', 'railway:station', 'railway:halt'],
  ['highway:bus_stop'],
  ['tourism:alpine_hut', 'tourism:wilderness_hut'],
];

async function viaPhoton(peak, radius, signal) {
  const base = API.photon.replace(/api\/?$/, 'reverse');
  const ask = async (tags) => {
    const url = new URL(base);
    url.searchParams.set('lat', peak.lat.toFixed(5));
    url.searchParams.set('lon', peak.lng.toFixed(5));
    url.searchParams.set('radius', String(Math.round(radius / 1000)));
    url.searchParams.set('limit', '50');
    tags.forEach((t) => url.searchParams.append('osm_tag', t));
    const res = await fetchWithTimeout(url, { timeout: 12000, signal });
    if (!res.ok) throw new Error(`Photon ${res.status}`);
    return (await res.json()).features || [];
  };
  const groups = await Promise.allSettled(PHOTON_GROUPS.map(ask));
  if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  if (groups.every((g) => g.status === 'rejected')) throw groups[0].reason;

  const seen = new Set();
  const places = [];
  for (const g of groups) {
    if (g.status !== 'fulfilled') continue;
    for (const f of g.value) {
      const p = f.properties || {};
      const type = classify({ [p.osm_key]: p.osm_value });
      const id = `${({ N: 'node', W: 'way', R: 'relation' })[p.osm_type] || 'x'}/${p.osm_id}`;
      if (!type || seen.has(id)) continue;
      seen.add(id);
      places.push({
        id,
        type,
        name: p.name || null,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        ele: parseEle(p.extra?.ele),
        kind: p.osm_value,
        tags: null, // Details lädt die Infokarte bei Bedarf nach
      });
    }
  }
  return { ele: null, places, source: 'photon' };
}

/**
 * Lädt mögliche Startpunkte und Hütten rund um den Gipfel.
 * Photon und Overpass laufen gleichzeitig. Liefert Overpass innerhalb des
 * Zeitlimits, nehmen wir dessen vollständigere Daten, sonst Photon.
 */
export async function loadSurroundings(peak, { radius = 9000, signal } = {}) {
  const photonP = viaPhoton(peak, radius, signal);
  const overpassP = viaOverpass(peak, radius, signal);
  photonP.catch(() => {});
  overpassP.catch(() => {});

  // Overpass gewinnt, wenn es schnell genug ist; sonst Photon nach kurzer Gnadenfrist
  const ovpOk = overpassP.then((r) => (r.places.length ? r : Promise.reject(new Error('keine Treffer'))));
  const photonLate = photonP.then((r) => new Promise((res) => setTimeout(() => res(r), 2500)));
  try {
    return await Promise.any([ovpOk, photonLate]);
  } catch {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    return photonP; // wirft den Fehler von Photon weiter, falls beide scheitern
  }
}

/** Gipfelhöhen laut OpenStreetMap (Tag "ele") für mehrere Gipfel in einem Abruf */
export async function osmElevations(items, signal) {
  const ids = items.map((r) => (r.osmType && r.osmId ? `${r.osmType}${r.osmId}` : null));
  const valid = ids.filter(Boolean);
  if (!valid.length) return items.map(() => null);
  const url = `${API.nominatimLookup}?osm_ids=${valid.join(',')}&format=json&extratags=1`;
  const res = await fetchWithTimeout(url, { timeout: 6000, signal });
  if (!res.ok) return items.map(() => null);
  const byId = new Map((await res.json()).map((x) => [`${x.osm_type?.[0]?.toUpperCase()}${x.osm_id}`, parseEle(x.extratags?.ele)]));
  return ids.map((id) => (id ? byId.get(id) ?? null : null));
}

/** Höhen für viele Punkte in einem Abruf (Höhenmodell, ca. 90 m Raster) */
export async function demElevations(points, signal) {
  if (!points.length) return [];
  const url = `${API.openMeteoElevation}?latitude=${points.map((p) => p.lat.toFixed(5)).join(',')}&longitude=${points.map((p) => p.lng.toFixed(5)).join(',')}`;
  const res = await fetchWithTimeout(url, { timeout: 8000, signal });
  if (!res.ok) return points.map(() => null);
  const d = await res.json();
  return (d.elevation || []).map((e) => (Number.isFinite(e) ? Math.round(e) : null));
}

/** Fallback für die Gipfelhöhe aus einem Höhenmodell (90 m Raster) */
export async function demElevation(lat, lng) {
  const url = `${API.openMeteoElevation}?latitude=${lat}&longitude=${lng}`;
  const res = await fetchWithTimeout(url, { timeout: 8000 });
  if (!res.ok) return null;
  const d = await res.json();
  return Math.round(d.elevation?.[0]) || null;
}
