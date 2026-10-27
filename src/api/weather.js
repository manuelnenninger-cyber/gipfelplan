import { API } from '../config.js';
import { fetchWithTimeout } from './osm.js';
import { cacheGet, cacheSet } from '../util/cache.js';

// Druckflächen und ihre typische Höhe (Standardatmosphäre). Für den Gipfelwind
// ist der Wind auf der passenden Druckfläche aussagekräftiger als der
// 10-m-Wind des Modells, das den Gipfel nur grob aufgelöst kennt.
const LEVELS = [[850, 1460], [800, 1950], [700, 3010], [600, 4200], [500, 5570]];
export function pressureLevelFor(ele) {
  if (ele == null || ele < 1300) return null;
  let best = LEVELS[0];
  for (const l of LEVELS) if (Math.abs(l[1] - ele) < Math.abs(best[1] - ele)) best = l;
  return best[0];
}

// WMO-Wettercodes
const WMO_TEXT = {
  0: 'Klar', 1: 'Überwiegend klar', 2: 'Teils bewölkt', 3: 'Bedeckt',
  45: 'Nebel', 48: 'Nebel mit Reif',
  51: 'Leichter Niesel', 53: 'Niesel', 55: 'Starker Niesel', 56: 'Gefrierender Niesel', 57: 'Gefrierender Niesel',
  61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen', 66: 'Gefrierender Regen', 67: 'Gefrierender Regen',
  71: 'Leichter Schneefall', 73: 'Schneefall', 75: 'Starker Schneefall', 77: 'Schneegriesel',
  80: 'Regenschauer', 81: 'Regenschauer', 82: 'Heftige Schauer', 85: 'Schneeschauer', 86: 'Schneeschauer',
  95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel',
};
export const wmoText = (c) => WMO_TEXT[c] ?? '–';

export function wxKind(code) {
  if (code == null) return 'cloudy';
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

/** 7-Tage-Prognose für den Gipfel, auf Gipfelhöhe umgerechnet */
export async function fetchForecast({ lat, lng, ele }, { signal } = {}) {
  const level = pressureLevelFor(ele);
  const hourly = [
    'temperature_2m', 'apparent_temperature', 'precipitation', 'precipitation_probability',
    'snowfall', 'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m',
    'wind_direction_10m', 'freezing_level_height', 'cape', 'visibility', 'is_day',
  ];
  if (level) hourly.push(`wind_speed_${level}hPa`, `wind_direction_${level}hPa`);
  const daily = [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
    'precipitation_probability_max', 'snowfall_sum', 'wind_gusts_10m_max', 'sunrise', 'sunset',
    'sunshine_duration',
  ];
  const url = new URL(API.openMeteo);
  url.search = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    hourly: hourly.join(','),
    daily: daily.join(','),
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '7',
    wind_speed_unit: 'kmh',
    ...(ele != null ? { elevation: String(ele) } : {}),
  });
  const key = `fc:v2:${url}`;
  const cached = await cacheGet(key, 30 * 60 * 1000);
  if (cached) return buildForecast(cached, level, ele);
  const res = await fetchWithTimeout(url, { timeout: 15000, signal });
  if (!res.ok) await throwApiError(res, 'Wetterdaten nicht verfügbar');
  const json = await res.json();
  cacheSet(key, json);
  return buildForecast(json, level, ele);
}

export function buildForecast(d, level, ele) {
  const H = d.hourly;
  const get = (k, i) => (H[k] ? H[k][i] : null);
  const hours = H.time.map((t, i) => ({
    t: new Date(t * 1000),
    temp: get('temperature_2m', i),
    feels: get('apparent_temperature', i),
    precip: get('precipitation', i) ?? 0,
    prob: get('precipitation_probability', i),
    snow: get('snowfall', i) ?? 0,
    code: get('weather_code', i),
    cloud: get('cloud_cover', i),
    wind: get('wind_speed_10m', i),
    gust: get('wind_gusts_10m', i),
    dir: get('wind_direction_10m', i),
    windSummit: level ? get(`wind_speed_${level}hPa`, i) : get('wind_speed_10m', i),
    dirSummit: level ? get(`wind_direction_${level}hPa`, i) : get('wind_direction_10m', i),
    freezing: get('freezing_level_height', i),
    cape: get('cape', i) ?? 0,
    vis: get('visibility', i),
    isDay: get('is_day', i) !== 0,
  }));

  const D = d.daily;
  const days = D.time.map((t, i) => {
    const start = t * 1000;
    const end = D.time[i + 1] ? D.time[i + 1] * 1000 : start + 86400000;
    const dh = hours.filter((h) => h.t.getTime() >= start && h.t.getTime() < end);
    const day = {
      date: new Date(start),
      code: D.weather_code[i],
      tmax: D.temperature_2m_max[i],
      tmin: D.temperature_2m_min[i],
      precip: D.precipitation_sum[i],
      prob: D.precipitation_probability_max?.[i],
      snow: D.snowfall_sum?.[i] ?? 0,
      gust: D.wind_gusts_10m_max?.[i],
      sunrise: D.sunrise?.[i] ? new Date(D.sunrise[i] * 1000) : null,
      sunset: D.sunset?.[i] ? new Date(D.sunset[i] * 1000) : null,
      sunshineH: D.sunshine_duration?.[i] != null ? D.sunshine_duration[i] / 3600 : null,
      hours: dh,
    };
    day.rating = assessDay(day);
    return day;
  });
  return { ele, level, days, hours, modelElevation: d.elevation };
}

/**
 * Grobe Tourenampel für einen Tag. Betrachtet das typische Tourenfenster
 * (8–16 Uhr, Gewitter bis 18 Uhr). Ersetzt keine Lawinen- oder Bergwetterberichte.
 */
export function assessDay(day) {
  const hr = (h) => h.t.getHours();
  const win = day.hours.filter((h) => hr(h) >= 8 && hr(h) <= 16);
  const conv = day.hours.filter((h) => hr(h) >= 10 && hr(h) <= 18);
  if (!win.length) return { score: null, level: 'unknown', label: '–', reasons: [] };

  const max = (arr, k) => Math.max(...arr.map((h) => h[k] ?? 0));
  const sum = (arr, k) => arr.reduce((a, h) => a + (h[k] ?? 0), 0);
  const precip = sum(win, 'precip');
  const prob = max(win, 'prob');
  const cape = max(conv, 'cape');
  const thunder = conv.some((h) => h.code >= 95);
  const wind = max(win, 'windSummit');
  const gust = max(win, 'gust');
  const snow = sum(day.hours, 'snow');
  const visMin = Math.min(...win.map((h) => h.vis ?? 99999));
  const cloud = win.reduce((a, h) => a + (h.cloud ?? 0), 0) / win.length;

  let score = 100;
  const reasons = [];
  const hit = (pts, text) => { score -= pts; reasons.push({ pts, text }); };

  if (thunder || cape > 800) hit(40, 'Gewitter am Nachmittag möglich');
  else if (cape > 400) hit(15, 'Leichte Gewitterneigung');
  if (precip > 8) hit(45, 'Viel Niederschlag');
  else if (precip > 2) hit(30, 'Regen oder Schnee');
  else if (precip > 0.2) hit(12, 'Vereinzelt Niederschlag');
  if (prob > 60 && precip <= 2) hit(10, `Niederschlagsrisiko ${Math.round(prob)} %`);
  if (wind > 60 || gust > 80) hit(40, 'Stürmisch am Grat');
  else if (wind > 40 || gust > 60) hit(20, 'Starker Wind in der Höhe');
  if (snow >= 3) hit(20, 'Neuschnee');
  else if (snow >= 0.5) hit(8, 'Etwas Neuschnee');
  if (visMin < 1000) hit(15, 'Nebel, schlechte Sicht');
  else if (cloud > 85) hit(8, 'Gipfel meist in Wolken');
  if (day.tmax != null && day.tmax < -10) hit(10, 'Sehr kalt am Gipfel');

  score = Math.max(0, score);
  reasons.sort((a, b) => b.pts - a.pts);
  const level = score >= 75 ? 'good' : score >= 45 ? 'fair' : 'poor';
  const label = { good: 'Gute Bedingungen', fair: 'Mit Einschränkungen', poor: 'Ungünstig' }[level];
  return {
    score, level, label,
    reasons: reasons.length ? reasons.slice(0, 2).map((r) => r.text) : ['Stabile Bedingungen'],
    thunderRisk: thunder || cape > 800 ? 'hoch' : cape > 400 ? 'mittel' : 'gering',
  };
}

// ---------------------------------------------------------------------------
// Raster für die Wetterkarte (Wolken, Niederschlag, Gewitter, Wind)
// ---------------------------------------------------------------------------
// Genau 10 Variablen: Open-Meteo zählt bis 10 Variablen als einen Abruf pro Punkt.
const GRID_VARS = [
  'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'snowfall', 'cape',
  'wind_speed_10m', 'wind_direction_10m', 'wind_speed_700hPa', 'wind_direction_700hPa',
];
export const GRID_SIZE = 12;     // Regionalraster 12 × 12 über die ganze Ansicht (fein ist das Detailraster)
export const GRID_HOURS = 120;   // 5 Tage stündlich
export const DETAIL_STEP = 0.02; // Detailraster um Gipfel/Routen: ca. 1,5 × 2,2 km (wie ICON-D2)

/** Fehler, wenn das Minuten-/Tageskontingent von Open-Meteo erschöpft ist */
export class RateLimitError extends Error {
  constructor(msg) { super(msg); this.name = 'RateLimitError'; }
  /** Wartezeit bis zum nächsten sinnvollen Versuch in ms (null = heute nicht mehr) */
  get retryIn() {
    if (/Tag/.test(this.message)) return null;
    if (/Stunde/.test(this.message)) {
      const next = new Date(); next.setMinutes(60, 30, 0);
      return next - Date.now();
    }
    return 65000;
  }
}

export async function fetchGrid(bounds, { nx = GRID_SIZE, ny = GRID_SIZE, hours = GRID_HOURS, signal } = {}) {
  const { w, s, e, n } = bounds;
  const lats = [], lons = [];
  for (let j = 0; j < ny; j++) {
    const lat = n - (j / (ny - 1)) * (n - s); // Zeile 0 = Norden
    for (let i = 0; i < nx; i++) {
      lats.push(lat.toFixed(3));
      lons.push((w + (i / (nx - 1)) * (e - w)).toFixed(3));
    }
  }
  const url = new URL(API.openMeteo);
  url.search = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lons.join(','),
    hourly: GRID_VARS.join(','),
    forecast_hours: String(hours),
    timezone: 'GMT',
    timeformat: 'unixtime',
    wind_speed_unit: 'kmh',
  });
  // Bereits geladene Raster (auch aus früheren Sitzungen) wiederverwenden
  const key = `grid:v2:${url}`;
  const cached = await cacheGet(key, 45 * 60 * 1000);
  if (cached) return cached;
  const res = await fetchWithTimeout(url, { timeout: 20000, signal });
  if (!res.ok) await throwApiError(res, 'Wetterraster nicht verfügbar');
  const json = await res.json();
  const grid = buildGrid(Array.isArray(json) ? json : [json], { w, s, e, n, nx, ny });
  grid.fetchedAt = Date.now();
  cacheSet(key, grid);
  return grid;
}

/** Verständliche Fehlermeldung, v. a. bei erschöpftem Kontingent */
async function throwApiError(res, prefix) {
  let reason = '';
  try { reason = (await res.json()).reason || ''; } catch { /* ignore */ }
  if (res.status === 429 || /limit exceeded/i.test(reason)) {
    throw new RateLimitError(/daily/i.test(reason)
      ? 'Das Tageskontingent des Wetterdienstes ist aufgebraucht. Morgen geht es weiter.'
      : /hourly/i.test(reason) ? 'Stundenkontingent des Wetterdienstes erreicht. Die Wetterkarte lädt zur nächsten vollen Stunde automatisch.'
      : 'Kurz zu viele Abfragen beim Wetterdienst. Neuer Versuch in einer Minute.');
  }
  throw new Error(`${prefix} (${res.status}) ${reason}`.trim());
}

export function buildGrid(locs, { w, s, e, n, nx, ny }) {
  const times = locs[0].hourly.time;
  const T = times.length;
  const size = T * nx * ny;
  const f = () => new Float32Array(size);
  const L = { cl: f(), cm: f(), ch: f(), precip: f(), snow: f(), cape: f(), u10: f(), v10: f(), u700: f(), v700: f() };
  const rad = Math.PI / 180;
  locs.forEach((loc, k) => {
    const h = loc.hourly;
    for (let t = 0; t < T; t++) {
      const idx = t * nx * ny + k;
      L.cl[idx] = h.cloud_cover_low?.[t] ?? 0;
      L.cm[idx] = h.cloud_cover_mid?.[t] ?? 0;
      L.ch[idx] = h.cloud_cover_high?.[t] ?? 0;
      L.precip[idx] = h.precipitation?.[t] ?? 0;
      L.snow[idx] = h.snowfall?.[t] ?? 0;
      L.cape[idx] = h.cape?.[t] ?? 0;
      // Meteorologische Windrichtung = woher der Wind kommt → u/v-Komponenten
      const s10 = h.wind_speed_10m?.[t] ?? 0, d10 = (h.wind_direction_10m?.[t] ?? 0) * rad;
      L.u10[idx] = -s10 * Math.sin(d10);
      L.v10[idx] = -s10 * Math.cos(d10);
      const s7 = h.wind_speed_700hPa?.[t] ?? 0, d7 = (h.wind_direction_700hPa?.[t] ?? 0) * rad;
      L.u700[idx] = -s7 * Math.sin(d7);
      L.v700[idx] = -s7 * Math.cos(d7);
    }
  });
  return { w, s, e, n, nx, ny, times: times.map((x) => x * 1000), layers: L };
}
