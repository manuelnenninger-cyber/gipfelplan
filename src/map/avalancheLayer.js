// Lawinenwarnstufen auf der Karte: Regionen in den EAWS-Farben, getrennt nach
// oberhalb/unterhalb der Höhengrenze (wie auf avalanche.report).
import maplibregl from 'maplibre-gl';
import { AVA_PMTILES, LEVEL_COLOR, LEVEL_NAME, pmtilesLib, fetchRatings, mapLevels, bulletinFor, dayKey } from '../api/avalanche.js';

const SRC = 'gp-wx-aval';
const FILL = 'gp-wx-aval-fill';
const LINE = 'gp-wx-aval-line';
const OUTLINE = 'gp-wx-aval-outline';

let protocolReady = null;
function ensureProtocol() {
  protocolReady ||= pmtilesLib().then((pm) => {
    const protocol = new pm.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
  }).catch((e) => { protocolReady = null; throw e; });
  return protocolReady;
}

const validFilter = (date) => ['all',
  ['any', ['!', ['has', 'start_date']], ['<=', ['get', 'start_date'], date]],
  ['any', ['!', ['has', 'end_date']], ['>', ['get', 'end_date'], date]],
];

/**
 * @param map MapLibre-Karte
 * @param onState ({ date, period, count }) – wie viele Regionen eine Stufe haben
 */
export function createAvalancheLayer(map, { beforeId, onState } = {}) {
  let on = false;
  let current = { date: null, period: 'am' };
  let levels = {};
  let req = 0;

  function paint() {
    if (!map.getLayer(FILL)) return;
    const key = ['concat', ['get', 'id'], ':', ['get', 'elevation']];
    const lvl = ['coalesce', ['get', key, ['literal', levels]], 0];
    map.setPaintProperty(FILL, 'fill-color', ['match', lvl, 1, LEVEL_COLOR[1], 2, LEVEL_COLOR[2], 3, LEVEL_COLOR[3], 4, LEVEL_COLOR[4], 5, LEVEL_COLOR[5], 'rgba(0,0,0,0)']);
    const f = validFilter(current.date || dayKey(new Date()));
    map.setFilter(FILL, f);
    map.setFilter(LINE, f);
  }

  async function attach() {
    await ensureProtocol();
    if (!on) return;
    if (!map.getSource(SRC)) {
      map.addSource(SRC, {
        type: 'vector', url: `pmtiles://${AVA_PMTILES}`,
        attribution: 'Lawinenwarnstufen © <a href="https://www.avalanches.org">EAWS</a> / <a href="https://avalanche.report">avalanche.report</a>',
      });
    }
    const before = beforeId?.();
    if (!map.getLayer(FILL)) {
      map.addLayer({ id: FILL, type: 'fill', source: SRC, 'source-layer': 'micro-regions_elevation', paint: { 'fill-opacity': 0.62, 'fill-antialias': false } }, before);
      map.addLayer({
        id: LINE, type: 'line', source: SRC, 'source-layer': 'micro-regions',
        paint: { 'line-color': 'rgba(255,255,255,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 10, 1.1] },
      }, before);
      map.addLayer({
        id: OUTLINE, type: 'line', source: SRC, 'source-layer': 'outline',
        paint: { 'line-color': 'rgba(255,255,255,0.85)', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2] },
      }, before);
    }
    paint();
  }

  function detach() {
    for (const id of [OUTLINE, LINE, FILL]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
  }

  return {
    get on() { return on; },
    async show(visible) {
      on = visible;
      if (visible) await attach(); else detach();
    },
    /** nach Stilwechsel wieder einhängen */
    reattach() { if (on) attach(); },

    /** Zeitpunkt der Zeitleiste → passender Tagesbericht (Vor-/Nachmittag) */
    async setTime(time) {
      const next = bulletinFor(time);
      if (next.date === current.date && next.period === current.period) return;
      current = next;
      const my = ++req;
      const ratings = await fetchRatings(next.date).catch(() => null);
      if (my !== req) return;
      levels = mapLevels(ratings, next.period);
      // Zählt nur Alpenländer – im Herbst geben z. B. Norwegen oder die Tatra schon Stufen aus
      const count = Object.entries(levels).filter(([k, v]) => v > 0 && /^(AT|DE|CH|IT|FR|SI|LI)-/.test(k)).length;
      paint();
      onState?.({ ...next, count, available: !!ratings });
    },

    /** Für die Anzeige unter dem Mauszeiger */
    probe(point) {
      if (!map.getLayer(FILL)) return null;
      const f = map.queryRenderedFeatures(point, { layers: [FILL] })[0];
      if (!f) return null;
      const lvl = levels[`${f.properties.id}:${f.properties.elevation}`] || 0;
      const other = levels[`${f.properties.id}:${f.properties.elevation === 'high' ? 'low' : 'high'}`] || 0;
      return { id: f.properties.id, elevation: f.properties.elevation, level: lvl, other, name: LEVEL_NAME[lvl] || null };
    },
    get state() { return current; },
  };
}
