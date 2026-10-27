// GPX-Dateien (z. B. aus komoot, Outdooractive, Bergfex, Garmin) einlesen und auswerten.
import { cumulativeDistances, ascentDescent, haversine } from '../util/geo.js';
import { hikingTime } from './routing.js';
import { demElevations } from './osm.js';

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
  return m ? parseFloat(m[1]) : NaN;
};
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();

/** Punkte und Namen aus GPX-Text lesen (Tracks bevorzugt, sonst Routen) */
export function parseGPX(text) {
  const pick = (tag) => {
    const re = new RegExp(`<${tag}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
    const pts = [];
    let m;
    while ((m = re.exec(text))) {
      const open = m[0].slice(0, m[0].indexOf('>') + 1);
      const lat = attr(open, 'lat'), lon = attr(open, 'lon');
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const em = (m[1] || '').match(/<ele>\s*([-\d.]+)\s*<\/ele>/);
      pts.push([lon, lat, em ? parseFloat(em[1]) : null]);
    }
    return pts;
  };
  let coords = pick('trkpt');
  if (coords.length < 2) coords = pick('rtept');
  const nm = text.match(/<(?:trk|rte)>[\s\S]*?<name>([\s\S]*?)<\/name>/) || text.match(/<metadata>[\s\S]*?<name>([\s\S]*?)<\/name>/);
  return { name: nm ? decode(nm[1]) : null, coords };
}

/** Auf höchstens n Punkte ausdünnen (für Karte und Profil reicht das) */
function thin(coords, n = 1500) {
  if (coords.length <= n) return coords;
  const step = coords.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(coords[Math.floor(i * step)]);
  out.push(coords[coords.length - 1]);
  return out;
}

/** Fehlende Höhen aus dem Höhenmodell ergänzen (max. 100 Stützpunkte) */
async function fillElevation(coords) {
  if (coords.filter((c) => c[2] != null).length > coords.length * 0.8) return coords;
  const step = Math.max(1, Math.floor(coords.length / 99));
  const idx = [];
  for (let i = 0; i < coords.length; i += step) idx.push(i);
  if (idx.at(-1) !== coords.length - 1) idx.push(coords.length - 1);
  const eles = await demElevations(idx.map((i) => ({ lng: coords[i][0], lat: coords[i][1] })));
  return coords.map((c, i) => {
    const k = Math.min(idx.length - 1, Math.round(i / step));
    return [c[0], c[1], eles[k] ?? null];
  });
}

/**
 * Tour-Objekt aus Koordinaten bauen – gleiches Format wie die berechneten Touren.
 * Endet die Tour nahe am Start, gilt sie als Rundtour.
 */
export function tourFromCoords(coords, { id, title, peak = null }) {
  const dist = cumulativeDistances(coords);
  const length = dist.at(-1);
  const { up, down } = ascentDescent(coords.map((c) => c[2]));
  const isLoop = haversine(coords[0], coords.at(-1)) < 400;
  // Höchster Punkt (bzw. Gipfelnähe) trennt Auf- und Abstieg
  let top = 0;
  coords.forEach((c, i) => { if ((c[2] ?? -1e9) > (coords[top][2] ?? -1e9)) top = i; });
  const upPart = ascentDescent(coords.slice(0, top + 1).map((c) => c[2]));
  const downPart = ascentDescent(coords.slice(top).map((c) => c[2]));
  const timeUp = isLoop ? hikingTime(dist[top], upPart.up, upPart.down) : hikingTime(length, up, down);
  const timeDown = isLoop ? hikingTime(length - dist[top], downPart.up, downPart.down) : hikingTime(length, down, up);
  const startEle = coords.find((c) => c[2] != null)?.[2];
  return {
    id,
    kind: 'import',
    isLoop,
    title,
    baseTitle: title,
    start: { id, type: 'trailhead', name: null, lat: coords[0][1], lng: coords[0][0] },
    direction: '',
    coords,
    dist,
    length,
    up,
    down,
    startEle: startEle != null ? Math.round(startEle) : null,
    timeUp,
    timeDown,
    timeTotal: timeUp + timeDown,
    sac: 0,
    sacShare: 0,
    viaFerrata: false,
    gapToSummit: peak ? Math.min(...coords.map((c) => haversine(c, [peak.lng, peak.lat]))) : 0,
    huts: [],
  };
}

let counter = 0;
/** Datei einlesen → Tour */
export async function importGPXFile(file, peak) {
  const text = await file.text();
  const { name, coords } = parseGPX(text);
  if (coords.length < 2) throw new Error(`In „${file.name}“ wurde kein Track gefunden.`);
  const filled = await fillElevation(thin(coords));
  const title = name || file.name.replace(/\.gpx$/i, '');
  return tourFromCoords(filled, { id: `import:${++counter}:${file.name}`, title, peak });
}
