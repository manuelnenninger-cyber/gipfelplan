// Kartenebenen für draußen: Höhenlinien, deutliche Wanderwege und Gipfel.
// Funktioniert für alle Grundkarten (Standard, Topo, Satellit).
import maplibregl from 'maplibre-gl';
import { TERRAIN_TILES } from '../config.js';

// maplibre-contour berechnet Höhenlinien im Browser aus denselben Geländedaten wie
// das 3D-Gelände. Die Bibliothek wird beim ersten Bedarf aus dem CDN geladen.
const CONTOUR_LIB = 'https://cdn.jsdelivr.net/npm/maplibre-contour@0.1.1/dist/index.mjs';
const OMT_URL = 'https://tiles.openfreemap.org/planet';
const FONT_REGULAR = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

// Diese Ebenen werden bei jedem Stilwechsel neu aufgebaut (Quelle kann wechseln)
export const REBUILT = /^gp-(omt|paths|tracks|peaks|contour)/;

let contourUrl = null;
function contourTiles() {
  contourUrl ||= import(/* @vite-ignore */ CONTOUR_LIB)
    .then((m) => {
      const mlc = m.default || m;
      const dem = new mlc.DemSource({ url: TERRAIN_TILES, encoding: 'terrarium', maxzoom: 13, worker: true });
      dem.setupMaplibre(maplibregl);
      return dem.contourProtocolUrl({
        // Zoomstufe: [Abstand, Abstand der kräftigen Zähllinien] in Metern
        thresholds: { 11: [100, 500], 12: [50, 250], 13: [20, 100], 15: [10, 50] },
        elevationKey: 'ele',
        levelKey: 'level',
        contourLayer: 'contours',
      });
    })
    .catch((e) => {
      console.warn('Höhenlinien nicht verfügbar:', e.message);
      contourUrl = null;
      return null;
    });
  return contourUrl;
}

/** Vektordaten (OpenMapTiles): in der Standardkarte vorhanden, sonst eigene Quelle */
function omtSource(map) {
  if (map.getSource('openmaptiles')) return 'openmaptiles';
  if (!map.getSource('gp-omt')) map.addSource('gp-omt', { type: 'vector', url: OMT_URL });
  return 'gp-omt';
}

const POI_FILL = { 'gp-hut': '#9a4f1c', 'gp-alm': '#4d7c0f', 'gp-bivouac': '#e8590c', 'gp-parking': '#2463d6' };

/** Kartensymbole (scharf auf Retina). Auch für „styleimagemissing“ nach Stilwechseln. */
export function addMapIcon(map, id) {
  if (map.hasImage(id)) return true;
  const r = 2;
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  if (id === 'gp-peak') {
    const s = 22 * r;
    c.width = s; c.height = s;
    x.beginPath();
    x.moveTo(s / 2, 3 * r); x.lineTo(s - 3 * r, s - 4 * r); x.lineTo(3 * r, s - 4 * r); x.closePath();
    x.lineJoin = 'round';
    x.lineWidth = 3 * r; x.strokeStyle = '#ffffff'; x.stroke();
    x.fillStyle = '#5a3a1e'; x.fill();
  } else if (id === 'gp-webcam') {
    // dunkles Quadrat mit weißer Kamera
    const s = 26 * r;
    c.width = s; c.height = s;
    x.beginPath();
    x.roundRect(2 * r, 2 * r, s - 4 * r, s - 4 * r, 6 * r);
    x.fillStyle = '#20313f';
    x.fill();
    x.lineWidth = 2 * r; x.strokeStyle = '#ffffff'; x.stroke();
    x.fillStyle = '#ffffff';
    x.beginPath(); x.roundRect(6.5 * r, 9 * r, 13 * r, 9.5 * r, 2 * r); x.fill();   // Gehäuse
    x.fillRect(10 * r, 7.2 * r, 5 * r, 2.4 * r);                                   // Sucher
    x.fillStyle = '#20313f';
    x.beginPath(); x.arc(13 * r, 13.7 * r, 3 * r, 0, Math.PI * 2); x.fill();          // Objektiv
    x.fillStyle = '#7fd3ff';
    x.beginPath(); x.arc(13 * r, 13.7 * r, 1.6 * r, 0, Math.PI * 2); x.fill();
  } else if (POI_FILL[id]) {
    // abgerundetes Quadrat mit weißem Rand, darin Haus, Zelt bzw. „P“
    const fill = POI_FILL[id];
    const s = 26 * r;
    c.width = s; c.height = s;
    x.beginPath();
    x.roundRect(2 * r, 2 * r, s - 4 * r, s - 4 * r, 6 * r);
    x.fillStyle = fill;
    x.fill();
    x.lineWidth = 2 * r; x.strokeStyle = '#ffffff'; x.stroke();
    x.fillStyle = '#ffffff';
    if (id === 'gp-hut' || id === 'gp-alm') {
      x.beginPath();
      x.moveTo(13 * r, 6.5 * r); x.lineTo(20.5 * r, 13 * r); x.lineTo(18 * r, 13 * r); x.lineTo(18 * r, 19.5 * r);
      x.lineTo(8 * r, 19.5 * r); x.lineTo(8 * r, 13 * r); x.lineTo(5.5 * r, 13 * r); x.closePath();
      x.fill();
      x.fillStyle = fill;
      x.fillRect(11.6 * r, 15 * r, 2.8 * r, 4.5 * r);
    } else if (id === 'gp-bivouac') {
      // Biwakschachtel: Dreieck mit Eingang
      x.beginPath();
      x.moveTo(13 * r, 6 * r); x.lineTo(20.5 * r, 19.5 * r); x.lineTo(5.5 * r, 19.5 * r); x.closePath();
      x.fill();
      x.fillStyle = fill;
      x.beginPath();
      x.moveTo(13 * r, 12.5 * r); x.lineTo(15.6 * r, 19.5 * r); x.lineTo(10.4 * r, 19.5 * r); x.closePath();
      x.fill();
    } else {
      x.font = `700 ${15 * r}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('P', s / 2, s / 2 + 0.8 * r);
    }
  } else {
    return false;
  }
  map.addImage(id, x.getImageData(0, 0, c.width, c.height), { pixelRatio: r });
  return true;
}

const firstLabel = (map) => map.getStyle().layers.find((l) => l.type === 'symbol' && !l.id.startsWith('gp-'))?.id;

/**
 * Ebenen hinzufügen. Reihenfolge von unten nach oben:
 * Höhenlinien → Wege → (Beschriftungen der Grundkarte) → Routen → Gipfel
 */
export function addOutdoorLayers(map, opts) {
  const src = omtSource(map);
  const below = firstLabel(map);
  // Rasterkarten haben keine Beschriftungsebenen: dann unter den Routen einfügen
  const routes = map.getLayer('gp-routes-casing') ? 'gp-routes-casing' : undefined;

  // --- Wanderwege und Fahrwege ---
  const isPath = ['all', ['==', ['get', 'class'], 'path'], ['!=', ['get', 'subclass'], 'cycleway']];
  const isTrack = ['==', ['get', 'class'], 'track'];
  const zw = (pairs) => ['interpolate', ['exponential', 1.5], ['zoom'], ...pairs];
  if (!map.getLayer('gp-tracks')) {
    map.addLayer({
      id: 'gp-tracks', type: 'line', source: src, 'source-layer': 'transportation', minzoom: 12, filter: isTrack,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#9a6b3a', 'line-width': zw([12, 1, 14, 1.6, 16, 2.6, 18, 4]), 'line-dasharray': [4, 1.5], 'line-opacity': 0.9 },
    }, below || routes);
  }
  if (!map.getLayer('gp-paths-casing')) {
    map.addLayer({
      id: 'gp-paths-casing', type: 'line', source: src, 'source-layer': 'transportation', minzoom: 12, filter: isPath,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': zw([12, 2.2, 14, 4, 16, 6.6, 18, 10]), 'line-opacity': 0.8 },
    }, below || routes);
    map.addLayer({
      id: 'gp-paths', type: 'line', source: src, 'source-layer': 'transportation', minzoom: 11.5, filter: isPath,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#d7261e', 'line-width': zw([11.5, 0.9, 14, 2.2, 16, 3.6, 18, 5.4]), 'line-dasharray': [2.2, 1.2] },
    }, below || routes);
  }

  // --- Gipfel: Dreieck, Name und Höhe, mit dem Zoom größer ---
  addMapIcon(map, 'gp-peak');
  for (const l of map.getStyle().layers) {
    if (l['source-layer'] === 'mountain_peak' && !l.id.startsWith('gp-')) map.setLayoutProperty(l.id, 'visibility', 'none');
  }
  if (!map.getLayer('gp-peaks')) {
    const name = ['coalesce', ['get', 'name:de'], ['get', 'name_de'], ['get', 'name']];
    map.addLayer({
      id: 'gp-peaks', type: 'symbol', source: src, 'source-layer': 'mountain_peak', minzoom: 8.5,
      filter: ['match', ['get', 'class'], ['peak', 'volcano'], true, false],
      layout: {
        'icon-image': 'gp-peak',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 13, 0.95, 16, 1.3],
        'text-field': ['format',
          name, { 'font-scale': 1 },
          ['case', ['has', 'ele'], ['concat', '\n', ['to-string', ['get', 'ele']], ' m'], ''], { 'font-scale': 0.82 }],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 13, 16, 17],
        'text-anchor': 'top',
        'text-offset': [0, 0.75],
        'text-max-width': 9,
        'text-line-height': 1.15,
        // bei Platzmangel gewinnen die höheren Gipfel
        'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ele'], 0]],
      },
      paint: { 'text-color': '#3a2614', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6 },
    }, map.getLayer('gp-hover') ? 'gp-hover' : undefined);
  }

  // --- Höhenlinien (asynchron, sobald die Bibliothek geladen ist) ---
  contourTiles().then((tiles) => {
    if (!tiles || map.getSource('gp-contours') || !map.getLayer('gp-paths')) return;
    map.addSource('gp-contours', { type: 'vector', tiles: [tiles], maxzoom: 15, attribution: 'Höhenlinien aus AWS Terrain Tiles' });
    map.addLayer({
      id: 'gp-contour-lines', type: 'line', source: 'gp-contours', 'source-layer': 'contours', minzoom: 11,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#8a5a2b',
        'line-opacity': ['case', ['==', ['get', 'level'], 1], 0.7, 0.45],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['==', ['get', 'level'], 1], 0.8, 0.4], 15, ['case', ['==', ['get', 'level'], 1], 1.6, 0.8]],
      },
    }, 'gp-tracks');
    map.addLayer({
      id: 'gp-contour-labels', type: 'symbol', source: 'gp-contours', 'source-layer': 'contours', minzoom: 12.5,
      filter: ['==', ['get', 'level'], 1],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
        'text-font': FONT_REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 9.5, 16, 11.5],
        'symbol-spacing': 320,
        'text-max-angle': 25,
        'text-padding': 4,
      },
      paint: { 'text-color': '#7a4d22', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 },
    }, below || routes);
    styleOutdoor(map, opts);
  });

  styleOutdoor(map, opts);
}

/** Sichtbarkeit und Farben je nach Grundkarte und Schalter */
export function styleOutdoor(map, { base, contours }) {
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  const sat = base === 'satellite';
  // OpenTopoMap hat eigene Höhenlinien
  const showContours = contours && base !== 'topo';
  vis('gp-contour-lines', showContours);
  vis('gp-contour-labels', showContours);
  if (map.getLayer('gp-contour-lines')) {
    map.setPaintProperty('gp-contour-lines', 'line-color', sat ? '#f3e6c8' : '#8a5a2b');
    map.setPaintProperty('gp-contour-labels', 'text-color', sat ? '#fff4dc' : '#7a4d22');
    map.setPaintProperty('gp-contour-labels', 'text-halo-color', sat ? 'rgba(40,30,20,0.8)' : 'rgba(255,255,255,0.9)');
  }
  if (map.getLayer('gp-paths')) {
    map.setPaintProperty('gp-paths', 'line-color', sat ? '#ff4d3d' : '#d7261e');
    map.setPaintProperty('gp-peaks', 'text-color', sat ? '#ffffff' : '#3a2614');
    map.setPaintProperty('gp-peaks', 'text-halo-color', sat ? 'rgba(20,20,20,0.85)' : 'rgba(255,255,255,0.95)');
  }
}
