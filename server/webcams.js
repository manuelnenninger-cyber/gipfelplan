// Webcams in der Nähe über die Windy Webcams API (v3).
// Läuft auf dem Server (Vercel-Funktion bzw. Vite-Dev-Server), damit der
// API-Schlüssel nicht im Browser landet. Schlüssel: Umgebungsvariable WINDY_WEBCAMS_KEY.
const BASE = 'https://api.windy.com/webcams/api/v3/webcams';

/** „Grainau: Bayerische Zugspitzbahn – …“ → „Bayerische Zugspitzbahn – …“ (der Ort steht extra daneben) */
export function cleanTitle(title, city) {
  const t = (title || '').trim();
  if (!t) return 'Webcam';
  if (city && t.startsWith(city)) {
    const rest = t.slice(city.length).replace(/^\s*[:›»>-]\s*/, '').trim();
    if (rest.length > 3) return rest;
  }
  return t;
}

/** Antwort der Windy-API auf das Nötigste reduzieren */
export function normalizeWebcam(w) {
  const loc = w.location || {};
  const img = w.images || {};
  const lat = Number(loc.latitude ?? w.latitude);
  const lng = Number(loc.longitude ?? w.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: String(w.webcamId ?? w.id),
    title: cleanTitle(w.title, loc.city),
    lat, lng,
    place: [loc.city, loc.region].filter(Boolean).join(', ') || null,
    updated: w.lastUpdatedOn || null,
    preview: img.current?.preview || img.current?.thumbnail || null,
    daylight: img.daylight?.preview || null,
    detail: w.urls?.detail || `https://www.windy.com/webcams/${w.webcamId ?? w.id}`,
    provider: w.urls?.provider || null,
    player: w.player?.day || w.player?.live || null,
  };
}

/**
 * @param {URLSearchParams} params lat, lon, r (Umkreis in km, max. 50)
 * @returns {{ status: number, body: object }}
 */
export async function windyWebcams(params, key) {
  if (!key) return { status: 503, body: { error: 'no-key' } };
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const r = Math.min(50, Math.max(1, Math.round(Number(params.get('r')) || 25)));
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return { status: 400, body: { error: 'lat/lon fehlen' } };
  const url = `${BASE}?nearby=${lat.toFixed(3)},${lon.toFixed(3)},${r}&limit=50&lang=de&include=location,images,urls,player`;
  const res = await fetch(url, { headers: { 'x-windy-api-key': key, accept: 'application/json' } });
  if (!res.ok) return { status: 502, body: { error: `Windy ${res.status}` } };
  const data = await res.json();
  const cams = (data.webcams || [])
    .filter((w) => !w.status || w.status === 'active')
    .map(normalizeWebcam)
    .filter(Boolean);
  return { status: 200, body: { cams, fetchedAt: Date.now() } };
}

// Bilder der kostenlosen API sind nur ca. 10 Minuten gültig → kurz zwischenspeichern
export const CACHE_HEADER = 'public, max-age=120, s-maxage=300';
