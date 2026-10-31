// Freies Erkunden: Ist ein Hervorheben-Knopf aktiv (Hütten & Almen, Notbiwaks, Webcams),
// lädt die App diese Orte für den sichtbaren Kartenausschnitt – auch ohne gewählten Gipfel.
import { staysInBounds } from '../api/osm.js';
import { fetchWebcams } from '../api/webcams.js';

export const EXPLORE_MIN_ZOOM = 9.5;
const WEBCAM_LIMIT = 50; // so viele liefert die Webcam-Schnittstelle höchstens je Abfrage

/**
 * @param onState ({ cat, status }) – status: 'loading' | 'ok' | 'zoom' | 'nokey' | 'error'
 */
export function createExplore({ view, onState }) {
  const map = view.map;
  let active = null;
  const covered = { stays: [], cams: [] }; // bereits geladene Ausschnitte
  const ctrls = {}; // je Gruppe eine laufende Anfrage
  let timer = 0;

  const group = (cat) => (cat === 'webcams' ? 'cams' : 'stays');

  /** sichtbarer Ausschnitt, etwas größer und auf ein Raster gerundet (gleiche Gegend → gleiche Anfrage) */
  function viewBox() {
    const b = map.getBounds();
    const padX = (b.getEast() - b.getWest()) * 0.15;
    const padY = (b.getNorth() - b.getSouth()) * 0.15;
    const step = 0.02;
    return {
      w: Math.floor((b.getWest() - padX) / step) * step,
      e: Math.ceil((b.getEast() + padX) / step) * step,
      s: Math.floor((b.getSouth() - padY) / step) * step,
      n: Math.ceil((b.getNorth() + padY) / step) * step,
    };
  }
  const inside = (b, list) => list.some((x) => x.w <= b.w && x.e >= b.e && x.s <= b.s && x.n >= b.n);

  async function load() {
    const cat = active;
    if (!cat) return;
    if (map.getZoom() < EXPLORE_MIN_ZOOM) { onState?.({ cat, status: 'zoom' }); return; }
    const g = group(cat);
    const box = viewBox();
    if (inside(box, covered[g])) { onState?.({ cat, status: 'ok' }); return; }
    ctrls[g]?.abort();
    const ctrl = new AbortController();
    ctrls[g] = ctrl;
    const { signal } = ctrl;
    onState?.({ cat, status: 'loading' });
    try {
      if (g === 'stays') {
        const places = await staysInBounds(box, signal);
        if (signal.aborted) return;
        view.addExplorePOIs(places);
        covered.stays.push(box);
      } else {
        const lat = (box.s + box.n) / 2, lng = (box.w + box.e) / 2;
        const halfDiagKm = Math.hypot((box.n - box.s) * 111, (box.e - box.w) * 111 * Math.cos((lat * Math.PI) / 180)) / 2;
        const radius = Math.max(5, Math.min(50, Math.round(halfDiagKm)));
        const d = await fetchWebcams(lat, lng, { radius, signal });
        if (signal.aborted) return;
        if (!d) { onState?.({ cat, status: 'nokey' }); return; }
        view.addExploreWebcams(d.cams);
        // Volle Antwort: es gibt wohl mehr – dann gilt nur die nähere Umgebung als erledigt
        const k = d.cams.length >= WEBCAM_LIMIT ? 0.35 : 1;
        const dLat = ((box.n - box.s) / 2) * k, dLng = ((box.e - box.w) / 2) * k;
        covered.cams.push({ w: lng - dLng, e: lng + dLng, s: lat - dLat, n: lat + dLat });
      }
      if (active === cat) onState?.({ cat, status: 'ok' });
    } catch (e) {
      if (e.name === 'AbortError' || signal.aborted) return;
      onState?.({ cat, status: 'error', message: e.message });
    }
  }

  map.on('moveend', () => {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(load, 450);
  });

  return {
    setActive(cat) {
      active = cat;
      clearTimeout(timer);
      if (!cat) return; // laufende Anfragen dürfen fertig laden
      load();
    },
    get active() { return active; },
  };
}
