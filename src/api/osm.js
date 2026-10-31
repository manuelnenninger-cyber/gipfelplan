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
  alm: 'Alm',
  bivouac: 'Biwak',
};
export const typeLabel = (t) => TYPE_LABEL[t] || 'Startpunkt';

export function classify(tags) {
  if (tags.highway === 'trailhead') return 'trailhead';
  if (tags.aerialway === 'station') return 'cablecar';
  if (tags.railway === 'station' || tags.railway === 'halt') return 'station';
  if (tags.highway === 'bus_stop') return 'bus';
  if (tags.tourism === 'alpine_hut') return 'hut';
  // Notbiwaks, Biwakschachteln, unbewirtschaftete Hütten und Unterstände am Berg
  if (tags.tourism === 'wilderness_hut') return 'bivouac';
  if (tags.amenity === 'shelter') {
    const t = tags.shelter_type;
    if (t === 'basic_hut' || t === 'rock_shelter' || t === 'lean_to') return 'bivouac';
    if (/biwak|bivacco|notunterkunft|bivouac/i.test(tags.name || '')) return 'bivouac';
    return null;
  }
  // Bewirtschaftete Almen (meist als Gasthaus eingetragen)
  if ((tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'biergarten') && /alm|alpe\b|hütte|huette|stub[ae]n?\b|baude/i.test(tags.name || '')) return 'alm';
  if (tags.amenity === 'parking') return 'parking';
  return null;
}

// ---------------------------------------------------------------------------
// Quelle 1: Overpass – vollständig (auch unbenannte Parkplätze), aber die
// öffentlichen Server sind oft überlastet. Alle Server parallel, mit Zeitlimit.
// ---------------------------------------------------------------------------
/** Overpass-Abfrage an alle Server gleichzeitig; der schnellste gewinnt */
async function runOverpass(q, signal, timeout = 9000) {
  const ask = async (endpoint) => {
    const res = await fetchWithTimeout(`${endpoint}?data=${encodeURIComponent(q)}`, { timeout, signal });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();
    if (data.remark && /runtime error|timeout/i.test(data.remark)) throw new Error('Overpass überlastet');
    return data;
  };
  return Promise.any(API.overpass.map(ask)).catch((e) => {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    throw new Error(e.errors?.[0]?.message || 'Overpass nicht erreichbar');
  });
}

/** OSM-Element → Ort im App-Format (oder null, wenn uninteressant) */
function toPlace(el) {
  const tags = el.tags || {};
  const type = classify(tags);
  if (!type) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null) return null;
  return {
    id: `${el.type}/${el.id}`,
    type,
    name: tags.name || null,
    lat, lng,
    ele: parseEle(tags.ele),
    kind: tags.tourism || null,
    tags, // für die Infokarte (Öffnungszeiten, Telefon, Foto …)
  };
}

// Hütten, Almen und Biwaks (auch für das freie Erkunden der Karte)
const STAY_QUERY = (area) => `
  nwr["tourism"~"^(alpine_hut|wilderness_hut)$"]${area};
  nwr["amenity"="shelter"]["shelter_type"~"^(basic_hut|rock_shelter|lean_to)$"]${area};
  nwr["amenity"="shelter"]["name"~"[Bb]iwak|[Bb]ivacco|[Nn]otunterkunft"]${area};
  nwr["amenity"~"^(restaurant|cafe|biergarten)$"]["name"~"[Aa]lm|[Aa]lpe|[Hh]ütte|[Hh]uette|[Bb]aude"]${area};`;

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
${STAY_QUERY(around)}
);
out center tags;`;

  const data = await runOverpass(q, signal);

  let ele = null;
  const places = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    if (el.type === 'node' && String(el.id) === String(peak.osmId) && tags.natural) {
      ele = parseEle(tags.ele);
      continue;
    }
    const place = toPlace(el);
    if (place) places.push(place);
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
  ['tourism:alpine_hut', 'tourism:wilderness_hut', 'amenity:shelter'],
];

async function viaPhoton(peak, radius, signal, groupsList = PHOTON_GROUPS) {
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
  const groups = await Promise.allSettled(groupsList.map(ask));
  if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  if (groups.every((g) => g.status === 'rejected')) throw groups[0].reason;

  const seen = new Set();
  const places = [];
  for (const g of groups) {
    if (g.status !== 'fulfilled') continue;
    for (const f of g.value) {
      const p = f.properties || {};
      const type = classify({ [p.osm_key]: p.osm_value, name: p.name });
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

/**
 * Hütten, Almen und Biwaks in einem Kartenausschnitt {w,s,e,n} – zum freien Erkunden.
 * Overpass liefert alles; ist es überlastet, springt Photon ein (nur benannte Orte).
 */
export async function staysInBounds(b, signal) {
  const bbox = `(${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)})`;
  const q = `[out:json][timeout:20];(${STAY_QUERY(bbox)}
);
out center tags;`;
  const center = { lat: (b.s + b.n) / 2, lng: (b.w + b.e) / 2 };
  const radius = Math.min(60000, Math.max(5000, (b.n - b.s) * 111000 * 0.75));
  // Beide Quellen gleichzeitig; Overpass (vollständiger) gewinnt, wenn es kurz nach Photon fertig ist
  const ovp = runOverpass(q, signal, 12000).then((d) => (d.elements || []).map(toPlace).filter(Boolean));
  const pho = viaPhoton(center, radius, signal, [PHOTON_GROUPS[2]]).then((r) => r.places);
  ovp.catch(() => {});
  pho.catch(() => {});
  const phoLate = pho.then((p) => new Promise((res) => setTimeout(() => res(p), 3000)));
  try {
    return await Promise.any([ovp, phoLate]);
  } catch {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    return pho;
  }
}
