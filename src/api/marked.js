// Markierte, benannte Wanderwege aus OpenStreetMap über Waymarked Trails
// (hiking.waymarkedtrails.org, offen und ohne Schlüssel).
import { API } from '../config.js';
import { fetchWithTimeout } from './osm.js';
import { haversine, cumulativeDistances } from '../util/geo.js';

const R = 6378137;
export const toMerc = (lng, lat) => [(lng * Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];
export const fromMerc = (x, y) => [(x / R) * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];

/** Wege eines Routenabschnitts zu einer durchgehenden Linie verbinden (Wege können rückwärts erfasst sein) */
export function chainWays(ways, tol = 40) {
  const lines = ways
    .map((w) => (w.geometry?.coordinates || []).map(([x, y]) => fromMerc(x, y)))
    .filter((l) => l.length >= 2);
  if (!lines.length) return [];
  const near = (a, b) => haversine(a, b) <= tol;
  let out = [...lines[0]];
  // Erste Linie ggf. umdrehen, damit sie an die zweite anschließt
  if (lines[1] && !near(out[out.length - 1], lines[1][0]) && !near(out[out.length - 1], lines[1][lines[1].length - 1])) {
    if (near(out[0], lines[1][0]) || near(out[0], lines[1][lines[1].length - 1])) out.reverse();
  }
  const parts = [];
  for (const l of lines.slice(1)) {
    const end = out[out.length - 1];
    if (near(end, l[0])) out.push(...l.slice(1));
    else if (near(end, l[l.length - 1])) out.push(...[...l].reverse().slice(1));
    else { parts.push(out); out = [...l]; } // Lücke: neuer Teil
  }
  parts.push(out);
  // längsten zusammenhängenden Teil verwenden
  return parts.sort((a, b) => b.length - a.length)[0];
}

function collectLines(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node.ways) && node.ways.length) out.push(chainWays(node.ways));
  for (const k of ['main', 'appendices']) if (Array.isArray(node[k])) node[k].forEach((c) => collectLines(c, out));
  return out;
}

/**
 * Teilstücke eines Weges, die am Gipfel enden: Führt der Weg über den Gipfel hinweg,
 * ergeben sich zwei Anstiege (von beiden Enden).
 */
export function sectionsToSummit(line, peak, { maxGap = 500, minLen = 1500, maxLen = 18000 } = {}) {
  if (!line || line.length < 2) return [];
  let ci = 0, best = Infinity;
  line.forEach((p, i) => { const d = haversine(p, [peak.lng, peak.lat]); if (d < best) { best = d; ci = i; } });
  if (best > maxGap) return [];
  const sections = [line.slice(0, ci + 1), [...line.slice(ci)].reverse()];
  return sections
    .filter((s) => s.length >= 2 && cumulativeDistances(s).at(-1) >= minLen)
    // Weitwanderwege: nur die letzten maxLen Meter vor dem Gipfel verwenden
    .map((s) => {
      const cd = cumulativeDistances(s);
      const total = cd.at(-1);
      if (total <= maxLen) return s;
      const from = cd.findIndex((d) => d >= total - maxLen);
      return s.slice(from);
    });
}

const cleanName = (n) => (n && n !== 'undefined' ? n : null);

/** Markierte Wege im Umkreis, deren Verlauf den Gipfel erreicht */
export async function markedRoutesNear(peak, { signal, radiusKm = 0.8, max = 20 } = {}) {
  const [x, y] = toMerc(peak.lng, peak.lat);
  const k = (radiusKm * 1000) / Math.cos((peak.lat * Math.PI) / 180);
  const url = `${API.waymarked}/list/by_area?bbox=${x - k},${y - k},${x + k},${y + k}&limit=80`;
  const res = await fetchWithTimeout(url, { timeout: 10000, signal });
  if (!res.ok) throw new Error(`Waymarked Trails antwortet mit ${res.status}`);
  // Nur Wege, die durch die nähere Gipfelumgebung laufen – eine Gipfeltour muss den Gipfel erreichen
  const list = ((await res.json()).results || [])
    // Europäische Fernwege (INT) sind riesig und bringen nichts; nationale werden gekürzt
    .filter((r) => r.group !== 'INT')
    .slice(0, max);

  const details = await Promise.all(list.map((c) =>
    fetchWithTimeout(`${API.waymarked}/details/relation/${c.id}`, { timeout: 10000, signal })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)));

  const out = [];
  details.forEach((d, i) => {
    if (!d) return;
    const name = cleanName(d.name) || cleanName(list[i].name) || (d.tags?.ref ? `Weg ${d.tags.ref}` : 'Markierter Weg');
    for (const line of collectLines(d.route)) {
      for (const sec of sectionsToSummit(line, peak)) {
        out.push({
          id: d.id,
          name,
          ref: d.tags?.ref || null,
          symbol: d.symbol_description || d.tags?.symbol || null,
          description: d.tags?.description || null,
          link: `https://hiking.waymarkedtrails.org/#route?id=${d.id}`,
          coords: sec,
        });
      }
    }
  });
  return out;
}
