import { API } from '../config.js';

/**
 * Gipfelsuche über Photon (OpenStreetMap). Ergebnisse in der Nähe des
 * aktuellen Kartenausschnitts werden bevorzugt.
 */
export async function searchPeaks(query, { near, signal } = {}) {
  const url = new URL(API.photon);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '10');
  url.searchParams.set('lang', 'de');
  url.searchParams.append('osm_tag', 'natural:peak');
  if (near) {
    url.searchParams.set('lat', near.lat.toFixed(3));
    url.searchParams.set('lon', near.lng.toFixed(3));
    url.searchParams.set('location_bias_scale', '0.3');
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Suche fehlgeschlagen (${res.status})`);
  const data = await res.json();
  return (data.features || [])
    .filter((f) => f.properties?.name)
    .map((f) => {
      const p = f.properties;
      return {
        name: p.name,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        osmType: p.osm_type, // N, W, R
        osmId: p.osm_id,
        ele: parseEle(p.extra?.ele ?? p.ele),
        region: formatRegion(p),
      };
    });
}

/** "Mieming (Imst), Tirol" – Gemeinde und Bezirk machen gleichnamige Gipfel unterscheidbar */
export function formatRegion(p) {
  const county = (p.county || '').replace(/^(Bezirk|Landkreis|Kreis|Bezirk Verwaltungskreis|Verwaltungskreis|Comunità di|Provincia di)\s+/i, '');
  const place = p.city || p.locality || p.district || null;
  let head = place && county && !county.includes(place) ? `${place} (${county})` : place || county || null;
  const tail = p.countrycode && !['AT', 'DE', 'CH', 'IT'].includes(p.countrycode) ? p.country : p.state;
  return [head, tail].filter(Boolean).join(', ');
}

export function parseEle(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > -500 && n < 9000 ? Math.round(n) : null;
}
