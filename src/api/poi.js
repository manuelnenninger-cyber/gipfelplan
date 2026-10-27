// Details und Foto für Hütten und Parkplätze (OpenStreetMap, Wikidata, Wikimedia Commons)
import { API } from '../config.js';
import { fetchWithTimeout } from './osm.js';
import { parseEle } from './search.js';
import { describeHours } from '../util/openingHours.js';

const OSM_LETTER = { node: 'N', way: 'W', relation: 'R' };

/** OSM-Tags nachladen, falls der Ort aus der Photon-Suche stammt (dort fehlen sie) */
async function fetchTags(place, signal) {
  const [type, id] = place.id.split('/');
  if (!OSM_LETTER[type]) return {};
  const url = `${API.nominatimLookup}?osm_ids=${OSM_LETTER[type]}${id}&format=json&extratags=1&namedetails=1`;
  const res = await fetchWithTimeout(url, { timeout: 6000, signal });
  if (!res.ok) return {};
  const [hit] = await res.json();
  if (!hit) return {};
  return { ...hit.extratags, ...(hit.namedetails?.name && { name: hit.namedetails.name }), [hit.category || hit.class]: hit.type };
}

const first = (v) => (v ? String(v).split(';')[0].trim() : null);
const url = (v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null);

function feeText(tags) {
  const charge = tags.charge && tags.charge
    .replace(/\bEUR\b/g, '€')
    .replace(/\/\s*day\b/gi, '/Tag')
    .replace(/\/\s*(hour|h)\b/gi, '/Std.')
    .replace(/\bday\b/gi, 'Tag');
  if (tags.fee === 'no') return 'kostenlos';
  if (tags.fee === 'yes' || charge) return charge ? `kostenpflichtig, ${charge}` : 'kostenpflichtig';
  return null;
}

/** Wichtigste Angaben in einheitlicher Form */
export async function poiDetails(place, signal) {
  let tags = place.tags;
  if (!tags) tags = await fetchTags(place, signal).catch(() => ({}));
  const hut = place.type === 'hut';
  const kind = tags.tourism || place.kind;
  return {
    tags,
    name: tags['name:de'] || tags.name || place.name,
    label: hut ? (kind === 'wilderness_hut' ? 'Unbewirtschaftete Hütte' : 'Berghütte') : 'Parkplatz',
    ele: parseEle(tags.ele) ?? place.ele ?? null,
    hours: describeHours(tags.opening_hours),
    operator: tags.operator || null,
    beds: hut ? parseInt(tags.beds || tags.capacity, 10) || null : null,
    spaces: !hut ? parseInt(tags.capacity, 10) || null : null,
    fee: !hut ? feeText(tags) : null,
    winterRoom: tags.winter_room === 'yes',
    phone: first(tags.phone || tags['contact:phone']),
    website: url(first(tags.website || tags['contact:website'] || tags.url)),
  };
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------
const commonsFile = (name) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name.replace(/^File:/i, ''))}?width=640`;
const commonsPage = (name) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name.replace(/^File:/i, '').replace(/ /g, '_'))}`;

async function wikidataImage(qid, signal) {
  const u = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(qid)}&property=P18&format=json&origin=*`;
  const res = await fetchWithTimeout(u, { timeout: 6000, signal });
  if (!res.ok) return null;
  const name = (await res.json()).claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return name ? { src: commonsFile(name), href: commonsPage(name), credit: 'Wikimedia Commons' } : null;
}

/** Foto in unmittelbarer Nähe (Wikimedia Commons), wenn der Ort selbst keins verlinkt */
async function nearbyImage(place, radius, signal) {
  const api = 'https://commons.wikimedia.org/w/api.php';
  const geo = `${api}?action=query&list=geosearch&gscoord=${place.lat}|${place.lng}&gsradius=${radius}&gsnamespace=6&gslimit=8&format=json&origin=*`;
  const res = await fetchWithTimeout(geo, { timeout: 6000, signal });
  if (!res.ok) return null;
  const hits = ((await res.json()).query?.geosearch || [])
    .filter((h) => /\.(jpe?g|png|webp)$/i.test(h.title) && !/(karte|map|plan|logo|schild|sign|wappen)/i.test(h.title));
  const h = hits[0]; // nach Entfernung sortiert
  return h ? { src: commonsFile(h.title), href: commonsPage(h.title), credit: 'Foto aus der Nähe · Wikimedia Commons' } : null;
}

export async function poiImage(place, tags, signal) {
  const img = tags.image && first(tags.image);
  if (img) {
    const m = /commons\.wikimedia\.org\/wiki\/(File:.+)$/i.exec(img);
    if (m) return { src: commonsFile(decodeURIComponent(m[1])), href: img, credit: 'Wikimedia Commons' };
    if (/^https?:\/\/.+\.(jpe?g|png|webp)(\?.*)?$/i.test(img)) return { src: img, href: img, credit: new URL(img).hostname };
    if (/^File:/i.test(img)) return { src: commonsFile(img), href: commonsPage(img), credit: 'Wikimedia Commons' };
  }
  if (tags.wikimedia_commons && /^File:/i.test(tags.wikimedia_commons)) {
    return { src: commonsFile(tags.wikimedia_commons), href: commonsPage(tags.wikimedia_commons), credit: 'Wikimedia Commons' };
  }
  if (tags.wikidata) {
    const w = await wikidataImage(tags.wikidata, signal).catch(() => null);
    if (w) return w;
  }
  // Bei Parkplätzen wäre ein „Foto aus der Nähe“ meist irgendetwas anderes
  if (place.type === 'hut') return nearbyImage(place, 120, signal).catch(() => null);
  return null;
}
