import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLES, TERRAIN_TILES, TRAILS_TILES } from '../config.js';
import { boundsOf } from '../util/geo.js';
import { icon } from '../ui/icons.js';
import { escapeHtml } from '../util/format.js';
import { typeLabel } from '../api/osm.js';
import { addOutdoorLayers, styleOutdoor, addMapIcon, REBUILT } from './outdoorLayers.js';
import { openPoiCard, closePoiCard, openWebcamCard } from '../ui/poiCard.js';
import { PLAN_COLOR } from '../api/routing.js';

// Eigene Quellen/Ebenen beginnen mit "gp-" und überleben Stilwechsel.
// Ebenen mit "gp-wx" verwaltet das Wetter-Overlay selbst.
const isOurs = (id) => id.startsWith('gp-') && !id.startsWith('gp-wx');
const POI_LAYERS = ['gp-parking', 'gp-huts', 'gp-webcams'];
const BELOW_LABELS = (id) => id === 'gp-hillshade' || id === 'gp-trails' || id.startsWith('gp-radar');

const EMPTY = { type: 'FeatureCollection', features: [] };

// Retina-Bildschirme rendern sonst mit doppelter Auflösung (4× Pixel). In 3D ist das
// auf schwächeren Grafikchips der größte Bremsklotz, daher dort etwas weniger.
const DPR = window.devicePixelRatio || 1;
const PIXEL_RATIO_2D = Math.min(DPR, 2);
const PIXEL_RATIO_3D = Math.min(DPR, 1.35);
const PITCH_3D = 55;
const TERRAIN = { source: 'gp-dem', exaggeration: 1.3 };

export function createMapView(container) {
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLES.standard,
    center: [11.0, 47.35],
    zoom: 8.2,
    maxPitch: 65,
    pixelRatio: PIXEL_RATIO_2D,
    renderWorldCopies: false,   // keine Welt-Wiederholungen → weniger Kacheln beim Herauszoomen
    fadeDuration: 150,
    attributionControl: { compact: true },
    hash: false,
  });

  // Während die Karte sich bewegt, teure Glas-Effekte der Oberfläche abschalten
  let movingTimer = 0;
  map.on('movestart', () => { clearTimeout(movingTimer); document.body.classList.add('map-moving'); });
  map.on('moveend', () => { movingTimer = setTimeout(() => document.body.classList.remove('map-moving'), 120); });
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  // Hüttensymbole erst ab Zoom 11, sonst überdecken sie den Gipfelnamen
  const updateZoomClass = () => map.getContainer().classList.toggle('low-zoom', map.getZoom() < 11);
  map.on('zoomend', updateZoomClass);
  map.on('load', updateZoomClass);
  // Falls der Container beim Start noch keine endgültige Größe hatte (z. B. Tab im
  // Hintergrund geladen), Kartengröße nachziehen, sobald sie nicht mehr passt.
  const syncSize = () => {
    const el = map.getContainer();
    const c = map.getCanvas();
    if (el.clientWidth && (Math.abs(c.clientWidth - el.clientWidth) > 1 || Math.abs(c.clientHeight - el.clientHeight) > 1)) map.resize();
  };
  new ResizeObserver(syncSize).observe(map.getContainer());
  map.once('load', syncSize);
  window.addEventListener('load', syncSize);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSize(); });

  const state = {
    base: 'standard',
    terrain3d: false,
    trails: false,
    contours: true,
    routes: [],
    selected: null,
    flat: false,
    saved: null,
    peak: null,
    planning: null, // Funktion, die angetippte Punkte für die eigene Route bekommt
  };
  const listeners = { peak: [], route: [], styleload: [] };
  let peakMarker = null;
  let hutData = EMPTY;
  const poiById = new Map();
  const camById = new Map();
  let planData = EMPTY;
  let camData = EMPTY;

  // --- Eigene Quellen & Ebenen ------------------------------------------------
  function ensureLayers() {
    if (!map.getSource('gp-dem')) {
      // Für das 3D-Gelände reicht Zoomstufe 12 (ca. 30 m) – deutlich weniger Kacheln
      map.addSource('gp-dem', { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
    }
    if (!map.getSource('gp-dem-hs')) {
      map.addSource('gp-dem-hs', { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 13 });
    }
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    if (!map.getLayer('gp-hillshade')) {
      map.addLayer({
        id: 'gp-hillshade',
        type: 'hillshade',
        source: 'gp-dem-hs',
        paint: {
          'hillshade-exaggeration': 0.45,
          'hillshade-shadow-color': 'rgba(40, 50, 70, 0.55)',
          'hillshade-highlight-color': 'rgba(255, 255, 255, 0.35)',
        },
      }, firstSymbol);
    }
    if (!map.getSource('gp-trails')) {
      map.addSource('gp-trails', {
        type: 'raster', tiles: [TRAILS_TILES], tileSize: 256, maxzoom: 18,
        attribution: 'Wanderwege © <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
      });
    }
    if (!map.getLayer('gp-trails')) {
      map.addLayer({ id: 'gp-trails', type: 'raster', source: 'gp-trails', paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } }, firstSymbol);
    }
    if (!map.getSource('gp-huts')) map.addSource('gp-huts', { type: 'geojson', data: hutData });
    addMapIcon(map, 'gp-hut');
    addMapIcon(map, 'gp-parking');
    addMapIcon(map, 'gp-webcam');
    // Mehrere Webcams am selben Ort (z. B. 11 am Zugspitzgipfel) werden zu einem Symbol mit Zahl
    if (!map.getSource('gp-webcams')) map.addSource('gp-webcams', { type: 'geojson', data: camData, cluster: true, clusterRadius: 26, clusterMaxZoom: 20 });
    if (!map.getSource('gp-routes')) {
      map.addSource('gp-routes', { type: 'geojson', data: EMPTY, tolerance: 0.6 });
      map.addSource('gp-starts', { type: 'geojson', data: EMPTY });
      map.addSource('gp-hover', { type: 'geojson', data: EMPTY });
    }
    if (!map.getLayer('gp-routes-casing')) {
      map.addLayer({
        id: 'gp-routes-casing', type: 'line', source: 'gp-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['get', 'sort'] },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['case', ['get', 'selected'], 9, 6],
          'line-opacity': ['case', ['get', 'dim'], 0.5, 0.95],
        },
      });
      map.addLayer({
        id: 'gp-routes', type: 'line', source: 'gp-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['get', 'sort'] },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'selected'], 5.5, 3.5],
          'line-opacity': ['case', ['get', 'dim'], 0.45, 1],
        },
      });
      map.addLayer({
        id: 'gp-routes-hit', type: 'line', source: 'gp-routes',
        paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 },
      });
      map.addLayer({
        id: 'gp-starts', type: 'circle', source: 'gp-starts',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2.5,
          'circle-opacity': ['case', ['get', 'dim'], 0.5, 1],
          'circle-stroke-opacity': ['case', ['get', 'dim'], 0.5, 1],
        },
      });
      // Hütten und Parkplätze: Kartenebenen statt HTML-Elementen (flüssiger), anklickbar
      const poiLayer = (id, kind, image, minzoom) => map.addLayer({
        id, type: 'symbol', source: 'gp-huts', minzoom,
        filter: ['==', ['get', 'kind'], kind],
        layout: {
          'icon-image': image,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 15, 1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
      poiLayer('gp-parking', 'parking', 'gp-parking', 12.5);
      poiLayer('gp-huts', 'hut', 'gp-hut', 11);
      map.addLayer({
        id: 'gp-webcams', type: 'symbol', source: 'gp-webcams', minzoom: 9.5,
        layout: {
          'icon-image': 'gp-webcam',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9.5, 0.65, 14, 0.95],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['case', ['has', 'point_count'], ['to-string', ['get', 'point_count']], ''],
          'text-font': ['Noto Sans Bold'],
          'text-size': 10.5,
          'text-offset': [0.95, -0.95],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#ff453a', 'text-halo-width': 2.6 },
      });
      map.addLayer({
        id: 'gp-hover', type: 'circle', source: 'gp-hover',
        paint: { 'circle-radius': 7, 'circle-color': '#fff', 'circle-stroke-color': '#1d1d1f', 'circle-stroke-width': 3 },
      });
    }
    // Eigene Route (Planung): kräftige Linie über allem anderen
    if (!map.getSource('gp-plan')) map.addSource('gp-plan', { type: 'geojson', data: planData });
    if (!map.getLayer('gp-plan-casing')) {
      map.addLayer({
        id: 'gp-plan-casing', type: 'line', source: 'gp-plan',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9 },
      }, map.getLayer('gp-hover') ? 'gp-hover' : undefined);
      map.addLayer({
        id: 'gp-plan', type: 'line', source: 'gp-plan',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': PLAN_COLOR, 'line-width': 5 },
      }, map.getLayer('gp-hover') ? 'gp-hover' : undefined);
    }
    // 3D-Gebäude der Grundkarte aus: kosten viel, bringen am Berg nichts
    for (const l of map.getStyle().layers) {
      if (l.type === 'fill-extrusion') map.setLayoutProperty(l.id, 'visibility', 'none');
    }
    applyVisibility();
    // Höhenlinien, Wanderwege, Gipfel
    // Zusatzebenen dürfen die Grundkarte nie blockieren
    try {
      addOutdoorLayers(map, { base: state.base, contours: state.contours });
    } catch (e) {
      console.warn('Wanderebenen konnten nicht geladen werden:', e);
    }
    if (state.terrain3d && !state.flat) map.setTerrain(TERRAIN);
    try {
      map.setSky?.({
        'sky-color': '#9fc6ef', 'horizon-color': '#dfe9f5', 'fog-color': '#eef2f7',
        'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 12, 0],
      });
    } catch { /* ältere MapLibre-Versionen ohne Himmel */ }
  }

  function applyVisibility() {
    if (map.getLayer('gp-hillshade')) map.setLayoutProperty('gp-hillshade', 'visibility', state.base === 'standard' ? 'visible' : 'none');
    if (map.getLayer('gp-trails')) map.setLayoutProperty('gp-trails', 'visibility', state.trails ? 'visible' : 'none');
  }

  map.on('style.load', () => {
    ensureLayers();
    renderRoutes();
    listeners.styleload.forEach((fn) => fn());
  });

  // --- Interaktion --------------------------------------------------------------
  // Nach einem Stilwechsel fehlen eigene Symbole kurz – hier sofort nachzeichnen
  map.on('styleimagemissing', (e) => { if (e.id?.startsWith('gp-')) addMapIcon(map, e.id); });

  const near = (p, r = 8) => [[p.x - r, p.y - r], [p.x + r, p.y + r]];
  const poiAt = (point) => {
    const layers = POI_LAYERS.filter((l) => map.getLayer(l));
    return layers.length ? map.queryRenderedFeatures(near(point), { layers })[0] : null;
  };

  // Eigene Route planen: angetippte Stelle als Wegpunkt (Hütte, Parkplatz, Gipfel oder freier Punkt)
  function planPick(e) {
    const f = poiAt(e.point);
    if (f && f.layer.id !== 'gp-webcams') {
      const place = poiById.get(f.properties.id);
      if (place) return { lat: place.lat, lng: place.lng, name: place.name || typeLabel(place.type), type: place.type };
    }
    const peaks = map.queryRenderedFeatures(near(e.point, 12)).filter((x) => x.sourceLayer === 'mountain_peak' && x.properties?.name);
    if (peaks[0]) {
      const [lng, lat] = peaks[0].geometry.coordinates;
      return { lat, lng, name: peaks[0].properties['name:de'] || peaks[0].properties.name, type: 'peak' };
    }
    const pk = state.peak;
    if (pk) {
      const pp = map.project([pk.lng, pk.lat]);
      if (Math.hypot(pp.x - e.point.x, pp.y - e.point.y) < 22) return { lat: pk.lat, lng: pk.lng, name: pk.name, type: 'peak' };
    }
    return { lat: e.lngLat.lat, lng: e.lngLat.lng, name: null, type: 'point' };
  }

  // Hütte oder Parkplatz antippen: Infokarte
  map.on('click', (e) => {
    if (state.planning) { state.planning(planPick(e)); return; }
    const f = poiAt(e.point);
    if (f?.layer.id === 'gp-webcams') {
      if (f.properties.cluster) {
        map.getSource('gp-webcams').getClusterLeaves(f.properties.cluster_id, 60, 0).then((leaves) => {
          const cams = leaves.map((l) => camById.get(l.properties.id)).filter(Boolean);
          if (cams.length) openWebcamCard(map, cams, { peak: state.peak });
        });
      } else {
        const cam = camById.get(f.properties.id);
        if (cam) openWebcamCard(map, [cam], { peak: state.peak });
      }
      return;
    }
    const place = f && poiById.get(f.properties.id);
    if (place) openPoiCard(map, place, { peak: state.peak });
  });
  for (const l of POI_LAYERS) {
    map.on('mousemove', l, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const p = e.features?.[0]?.properties;
      map.getCanvas().title = p?.cluster ? `${p.point_count} Webcams` : p?.title || '';
    });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = state.planning ? 'crosshair' : ''; map.getCanvas().title = ''; });
  }

  map.on('click', 'gp-routes-hit', (e) => {
    if (state.planning || poiAt(e.point)) return;
    const id = e.features?.[0]?.properties?.id;
    if (id) listeners.route.forEach((fn) => fn(id));
  });
  map.on('mouseenter', 'gp-routes-hit', () => { if (!state.planning) map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'gp-routes-hit', () => { map.getCanvas().style.cursor = state.planning ? 'crosshair' : ''; });

  // Gipfel direkt auf der Karte antippen (Vektorkarte, Ebene "mountain_peak")
  map.on('click', (e) => {
    if (state.flat || state.planning) return;
    const box = [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]];
    const hits = map.queryRenderedFeatures(box).filter((f) => f.sourceLayer === 'mountain_peak' && f.properties?.name);
    if (map.getLayer('gp-routes-hit') && map.queryRenderedFeatures(box, { layers: ['gp-routes-hit'] }).length) return;
    if (poiAt(e.point)) return;
    const f = hits[0];
    if (!f) return;
    const [lng, lat] = f.geometry.coordinates;
    listeners.peak.forEach((fn) => fn({
      name: f.properties['name:de'] || f.properties.name,
      lat, lng,
      ele: f.properties.ele != null ? Math.round(+f.properties.ele) : null,
      region: '',
      osmType: null, osmId: null,
    }));
  });

  // --- Routen zeichnen ----------------------------------------------------------
  function renderRoutes() {
    const src = map.getSource('gp-routes');
    if (!src) return;
    const sel = state.selected;
    const feats = state.routes.map((r, i) => ({
      type: 'Feature',
      properties: { id: r.id, color: r.color, selected: r.id === sel, dim: !!sel && r.id !== sel, sort: r.id === sel ? 100 : i },
      geometry: { type: 'LineString', coordinates: r.coords.map((c) => [c[0], c[1]]) },
    }));
    src.setData({ type: 'FeatureCollection', features: feats });
    map.getSource('gp-starts').setData({
      type: 'FeatureCollection',
      features: state.routes.map((r) => ({
        type: 'Feature',
        properties: { color: r.color, dim: !!sel && r.id !== sel },
        geometry: { type: 'Point', coordinates: [r.coords[0][0], r.coords[0][1]] },
      })),
    });
  }

  const padding = () => {
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    if (!mobile) return { top: 80, bottom: 60, left: 440, right: 80 };
    // Handy: unten so viel Platz lassen, wie das Bottom-Sheet gerade einnimmt
    const panel = document.getElementById('panel');
    const sheetH = panel && !panel.hidden ? Number(panel.dataset.h) || window.innerHeight * 0.5 : 0;
    const top = 90;
    const bottom = Math.min(sheetH + 24, window.innerHeight - top - 120);
    return { top, bottom, left: 30, right: 30 };
  };

  // MapLibre merkt sich die Polsterung eines flyTo (Gipfel mittig über dem Sheet) und
  // rechnet sie bei jedem fitBounds noch einmal dazu – dann passt am Handy nichts mehr.
  // Deshalb vorher zurücksetzen; das neue Polster gilt dann allein.
  const ZERO = { top: 0, bottom: 0, left: 0, right: 0 };
  function fitBounds(bounds, opts) {
    const p = map.getPadding();
    if (p.top || p.bottom || p.left || p.right) {
      // Polster entfernen, ohne dass die Karte springt: Bildschirmmitte bleibt, wo sie ist
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      map.jumpTo({ center: map.unproject([w / 2, h / 2]), padding: ZERO });
    }
    map.fitBounds(bounds, opts);
  }

  let hoverRaf = 0;
  let hoverNext = null;

  // --- Öffentliche Schnittstelle ------------------------------------------------
  return {
    map,
    on(evt, fn) { listeners[evt].push(fn); },

    setBaseStyle(name) {
      if (name === state.base) return;
      state.base = name;
      map.setStyle(MAP_STYLES[name], {
        diff: false,
        transformStyle: (prev, next) => {
          if (!prev) return next;
          const sources = { ...next.sources };
          // Höhenlinien/Wege/Gipfel werden nach dem Wechsel neu aufgebaut (ihre Quelle hängt vom Stil ab)
          for (const [k, v] of Object.entries(prev.sources)) if (isOurs(k) && !REBUILT.test(k)) sources[k] = v;
          const ours = prev.layers.filter((l) => isOurs(l.id) && !REBUILT.test(l.id));
          const below = ours.filter((l) => BELOW_LABELS(l.id));
          const above = ours.filter((l) => !BELOW_LABELS(l.id));
          const layers = [...next.layers];
          const i = layers.findIndex((l) => l.type === 'symbol');
          layers.splice(i < 0 ? layers.length : i, 0, ...below);
          return { ...next, sources, layers: [...layers, ...above] };
        },
      });
    },

    set3D(on) {
      state.terrain3d = on;
      if (state.flat) return;
      if (on) {
        map.setPixelRatio(PIXEL_RATIO_3D);
        map.setTerrain(TERRAIN);
        map.easeTo({ pitch: PITCH_3D, duration: 900 });
      } else {
        map.setTerrain(null);
        map.setPixelRatio(PIXEL_RATIO_2D);
        map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      }
    },

    setTrails(on) { state.trails = on; applyVisibility(); },

    setContours(on) { state.contours = on; styleOutdoor(map, { base: state.base, contours: on }); },

    /** Für die Wetterkarte: flache, genordete Karte */
    setFlat(on) {
      state.flat = on;
      if (on) {
        map.setTerrain(null);
        map.setPixelRatio(PIXEL_RATIO_2D);
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        map.touchPitch.disable();
        map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
      } else {
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();
        map.touchPitch.enable();
        if (state.terrain3d) {
          map.setPixelRatio(PIXEL_RATIO_3D);
          map.setTerrain(TERRAIN);
          map.easeTo({ pitch: PITCH_3D, duration: 700 });
        }
      }
    },

    showPeak(peak) {
      state.peak = peak;
      peakMarker?.remove();
      const el = document.createElement('div');
      el.className = 'peak-marker';
      el.innerHTML = `<span class="peak-pin">${icon('mountain')}</span><span class="peak-label">${escapeHtml(peak.name)}</span>`;
      peakMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([peak.lng, peak.lat]).addTo(map);
    },

    flyToPeak(peak) {
      map.flyTo({
        center: [peak.lng, peak.lat],
        zoom: 12.6,
        pitch: state.terrain3d && !state.flat ? PITCH_3D : 0,
        padding: padding(),
        duration: 1800,
        essential: true,
      });
    },

    /** Planungsmodus: fn bekommt jeden angetippten Punkt; null beendet ihn */
    setPlanning(fn) {
      state.planning = fn;
      closePoiCard();
      map.getCanvas().style.cursor = fn ? 'crosshair' : '';
      document.body.classList.toggle('planning', !!fn);
    },

    /** Linie der gerade geplanten Route (oder null) */
    setPlanRoute(coords) {
      planData = coords ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map((c) => [c[0], c[1]]) } } : EMPTY;
      map.getSource('gp-plan')?.setData(planData);
    },

    /** Webcams in der Nähe (anklickbar, Vorschaubild in der Infokarte) */
    showWebcams(cams) {
      camById.clear();
      cams.forEach((c) => camById.set(c.id, c));
      camData = {
        type: 'FeatureCollection',
        features: cams.map((c) => ({
          type: 'Feature',
          properties: { id: c.id, title: `Webcam: ${c.title}` },
          geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        })),
      };
      map.getSource('gp-webcams')?.setData(camData);
    },

    /** Hütten und Parkplätze anzeigen (anklickbar) */
    showPOIs(places) {
      closePoiCard();
      poiById.clear();
      places.forEach((p) => poiById.set(p.id, p));
      hutData = {
        type: 'FeatureCollection',
        features: places.map((p) => ({
          type: 'Feature',
          properties: { id: p.id, kind: p.type, title: p.name ? `${typeLabel(p.type)}: ${p.name}` : typeLabel(p.type) },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      };
      map.getSource('gp-huts')?.setData(hutData);
    },

    setRoutes(routes) {
      state.routes = routes;
      state.selected = null;
      renderRoutes();
    },

    selectRoute(id, { fit = true } = {}) {
      state.selected = id;
      renderRoutes();
      const r = state.routes.find((x) => x.id === id);
      if (r && fit) fitBounds(boundsOf(r.coords), { padding: padding(), duration: 900, pitch: map.getPitch() });
    },

    /** Ausschnitt einpassen (ohne gemerkte Polsterung früherer Kamerafahrten) */
    fitTo(bounds, opts) { fitBounds(bounds, opts); },

    /** Gewählte Route (oder alle) neu in den freien Kartenbereich einpassen */
    refit() {
      const r = state.routes.find((x) => x.id === state.selected);
      const coords = r ? r.coords : state.routes.flatMap((x) => x.coords);
      if (coords.length) fitBounds(boundsOf(coords), { padding: padding(), duration: 600, pitch: map.getPitch() });
    },

    fitRoutes() {
      const all = state.routes.flatMap((r) => r.coords);
      if (all.length) fitBounds(boundsOf(all), { padding: padding(), duration: 1200, pitch: map.getPitch() });
    },

    setHover(coord) {
      hoverNext = coord;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const src = map.getSource('gp-hover');
        if (!src) return;
        const c = hoverNext;
        src.setData(c ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [c[0], c[1]] } } : EMPTY);
      });
    },

    clear() {
      peakMarker?.remove();
      peakMarker = null;
      state.peak = null;
      this.showPOIs([]);
      this.showWebcams([]);
      state.routes = [];
      state.selected = null;
      renderRoutes();
      this.setHover(null);
    },

    get state() { return state; },
  };
}
