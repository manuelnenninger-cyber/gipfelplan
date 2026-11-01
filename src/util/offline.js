// Für unterwegs ohne Empfang: die zuletzt angesehenen Gipfel mit ihren Routen und
// Hütten/Parkplätzen bleiben auf dem Gerät (IndexedDB, bis zu 14 Tage).
import { cacheGetStale, cacheSet } from './cache.js';

const MAX_PEAKS = 12;
const INDEX = 'keep:peaks:index';
const keyFor = (p) => `keep:peak:v1:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

/** Route schlank machen: Koordinaten runden, Abstände werden beim Laden neu berechnet */
export function slimRoute(r) {
  const { dist, ...rest } = r;
  return { ...rest, coords: r.coords.map(([x, y, z]) => [+x.toFixed(5), +y.toFixed(5), z == null ? null : Math.round(z)]) };
}

export async function rememberPeak(peak, routes, places = []) {
  if (!routes?.length) return;
  const slimPlaces = places
    .filter((p) => ['hut', 'alm', 'bivouac', 'parking'].includes(p.type))
    .map(({ tags, ...p }) => ({ ...p, tags: tags ? pick(tags) : null }));
  await cacheSet(keyFor(peak), {
    peak: { name: peak.name, lat: peak.lat, lng: peak.lng, ele: peak.ele ?? null, region: peak.region || '' },
    routes: routes.map(slimRoute),
    places: slimPlaces,
  });
  const idx = (await cacheGetStale(INDEX))?.data || [];
  const next = [keyFor(peak), ...idx.filter((k) => k !== keyFor(peak))].slice(0, MAX_PEAKS);
  await cacheSet(INDEX, next);
}

/** gespeicherter Stand für einen Gipfel: { peak, routes, places, at } oder null */
export async function recallPeak(peak) {
  const hit = await cacheGetStale(keyFor(peak));
  if (!hit?.data) return null;
  return { ...hit.data, at: new Date(hit.t) };
}

// Nur die Tags, die die Infokarte braucht
const TAGS = ['name', 'name:de', 'tourism', 'amenity', 'shelter_type', 'opening_hours', 'operator', 'beds', 'capacity', 'winter_room', 'fireplace', 'stove', 'blankets', 'mattress', 'phone', 'contact:phone', 'website', 'contact:website', 'ele', 'fee', 'charge'];
function pick(tags) {
  const out = {};
  for (const k of TAGS) if (tags[k] != null) out[k] = tags[k];
  return out;
}
