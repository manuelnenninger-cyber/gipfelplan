import { API } from '../config.js';

/**
 * Radar der letzten 2 Stunden (10-Minuten-Schritte) von RainViewer.
 * Seit 2026 liefert die freie Schnittstelle nur noch vergangene Bilder,
 * ein Farbschema (Universal Blue) und Kacheln bis Zoom 7.
 */
export async function fetchRadarFrames() {
  const res = await fetch(API.rainviewer);
  if (!res.ok) throw new Error(`Radar nicht verfügbar (${res.status})`);
  const d = await res.json();
  const past = d.radar?.past || [];
  return past.map((f) => ({
    time: f.time * 1000,
    // Pfad unverändert aus der API übernehmen; 2 = Universal Blue, 1_1 = geglättet + Schnee
    tiles: `${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
  }));
}
