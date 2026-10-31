import { hydrateIcons } from './ui/icons.js';
import { createMapView } from './map/map.js';
import { createWeatherOverlay } from './map/weatherOverlay.js';
import { setupSearch } from './ui/search.js';
import { createRoutesPanel } from './ui/routes.js';
import { createForecastPanel } from './ui/forecast.js';
import { createWeatherBar } from './ui/weatherbar.js';
import { createSheet } from './ui/sheet.js';
import { createPlanner } from './ui/planner.js';
import { loadSurroundings, demElevation } from './api/osm.js';
import { suggestRoutes } from './api/routing.js';
import { fetchForecast } from './api/weather.js';
import { importGPXFile } from './api/gpx.js';
import { fmtInt } from './util/format.js';
import { boundsOf } from './util/geo.js';
import { lookupRegion, avalancheReport, avaKey } from './api/avalanche.js';
import { fetchWebcams } from './api/webcams.js';

hydrateIcons();

const $ = (id) => document.getElementById(id);
const view = createMapView('map');

// --- Wetterkarte -------------------------------------------------------------
let wbar = null;
const overlay = createWeatherOverlay(view, { onStatus: (t) => wbar?.status(t) });
wbar = createWeatherBar(overlay, { getCenter: () => view.map.getCenter() });
// Für die Fehlersuche im Entwicklungsmodus erreichbar (Browser-Konsole: __gp)
if (import.meta.env?.DEV) window.__gp = { view, overlay };
view.map.on('moveend', () => wbar.isOpen && wbar.updateWindy());

const isDesktop = () => window.matchMedia('(min-width: 721px)').matches;
let savedCamera = null;

/** Wetterkarte ein/aus. Beim Öffnen auf eine Regionsansicht herauszoomen, beim Schließen zurück. */
/** Hat die Gipfelregion an diesem Tag eine Lawinenwarnstufe? */
const avalancheRated = (date) => current.ava?.reports?.[avaKey(date || new Date())]?.state === 'rated';

async function toggleWeather(on, date, { layer } = {}) {
  const m = view.map;
  $('btn-weather').setAttribute('aria-pressed', on);
  document.body.classList.toggle('wx-mode', on);
  if (on) {
    if (!wbar.isOpen && m.getZoom() > 9.3) {
      savedCamera = { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
      const center = current.peak ? [current.peak.lng, current.peak.lat] : m.getCenter();
      await new Promise((res) => {
        m.once('moveend', res);
        setTimeout(res, 1600);
        m.easeTo({ center, zoom: 8.6, pitch: 0, bearing: 0, duration: 1000 });
      });
    }
    // Beim ersten Öffnen für einen Gipfel: Lawinenstufen zeigen, wenn es welche gibt
    if (!layer && current.avaAuto && avalancheRated(date)) layer = 'avalanche';
    current.avaAuto = false;
    await wbar.open(date, { layer });
  } else if (wbar.isOpen) {
    wbar.close();
    if (savedCamera) {
      m.easeTo({ ...savedCamera, pitch: view.state.terrain3d ? savedCamera.pitch : 0, duration: 1000 });
      savedCamera = null;
    }
  }
}

// --- Panel -------------------------------------------------------------------
const panel = $('panel');
const routesPanel = createRoutesPanel($('tab-routes'), {
  onSelect: (id) => {
    if (id) view.selectRoute(id);
    else { view.selectRoute(null, { fit: false }); view.fitRoutes(); }
  },
  onHover: (c) => view.setHover(c),
  onImportFiles: (files) => handleFiles(files),
  onPlan: () => planner.open(),
  // Karte zeigt die gefilterten Touren
  onShow: (list, sel) => {
    view.setRoutes(list);
    if (sel) view.selectRoute(sel, { fit: false });
  },
});
const forecastPanel = createForecastPanel($('tab-weather'), {
  onOpenMap: (date) => toggleWeather(true, date),
  onDay: (date) => { if (wbar.isOpen) wbar.jumpTo(date); },
  onAvalancheMap: (date) => {
    if (wbar.isOpen) { wbar.showLayer('avalanche'); wbar.jumpTo(date); }
    else toggleWeather(true, date, { layer: 'avalanche' });
  },
});

/** Lawinenlage für die Gipfelregion: heute und morgen */
async function loadAvalanche(peak, stale) {
  forecastPanel.setAvalanche({ loading: true });
  try {
    const region = await lookupRegion(peak.lat, peak.lng, avaKey(new Date()));
    if (stale()) return;
    if (!region) { forecastPanel.setAvalanche({ region: null }); return; }
    const today = new Date();
    const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    const reports = {};
    await Promise.all([today, tomorrow].map(async (d) => {
      const key = avaKey(d);
      reports[key] = await avalancheReport(region, key).catch(() => ({ state: 'missing', date: key, region }));
    }));
    if (stale()) return;
    current.ava = { region, reports };
    forecastPanel.setAvalanche(current.ava);
  } catch (e) {
    if (!stale()) forecastPanel.setAvalanche({ error: e.message });
  }
}

function setTab(name) {
  panel.querySelectorAll('.segmented button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $('tab-routes').hidden = name !== 'routes';
  $('tab-weather').hidden = name !== 'weather';
}
panel.querySelectorAll('.segmented button').forEach((b) => b.addEventListener('click', () => {
  setTab(b.dataset.tab);
  // Am Desktop gehören Wetter-Tab und Wetterkarte zusammen
  if (isDesktop()) toggleWeather(b.dataset.tab === 'weather');
}));
// Handy: Bottom-Sheet. Karte antippen klappt es ein, damit die Route frei liegt.
const sheet = createSheet(panel, {
  onSnap: (state, reason) => { if (state === 'peek' && reason === 'map') view.refit(); },
});
view.map.on('click', (e) => {
  if (!sheet.isMobile || panel.hidden || sheet.state === 'peek' || planner.active) return;
  const m = view.map;
  const box = [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]];
  const routeLayers = ['gp-routes-hit'].filter((l) => m.getLayer(l));
  if (routeLayers.length && m.queryRenderedFeatures(box, { layers: routeLayers }).length) return;
  // Hat der Klick etwas anderes ausgelöst (z. B. neuer Gipfel), nicht dazwischenfunken
  const s0 = sheet.stamp;
  setTimeout(() => { if (sheet.stamp === s0) sheet.snap('peek', { reason: 'map' }); }, 0);
});
view.map.on('dragstart', () => {
  if (sheet.isMobile && !panel.hidden && sheet.state !== 'peek' && !planner.active) sheet.snap('peek', { reason: 'pan' });
});

// --- Orte hervorheben (Hütten & Almen, Notbiwaks, Webcams) -------------------------
const poiFilter = $('poi-filter');
let highlight = null;
function updatePoiFilter() {
  const counts = view.poiCounts();
  poiFilter.hidden = !current.peak;
  poiFilter.querySelectorAll('button').forEach((b) => {
    const n = counts[b.dataset.cat] ?? 0;
    b.querySelector('.pf-n').textContent = n;
    b.disabled = n === 0 && highlight !== b.dataset.cat;
  });
}
function setHighlight(cat) {
  highlight = cat;
  poiFilter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cat === cat));
  view.setHighlight(cat);
  if (cat) {
    view.showAll(cat);
    if (sheet.isMobile && !panel.hidden) sheet.snap('peek', { reason: 'filter' });
  }
  updatePoiFilter();
}
poiFilter.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setHighlight(highlight === b.dataset.cat ? null : b.dataset.cat)));

// --- Eigene Route planen ---------------------------------------------------------
const planner = createPlanner({
  view,
  getPeak: () => current.peak,
  onOpen: () => { if (wbar.isOpen) toggleWeather(false); setTab('routes'); },
  onAccept: (tour) => {
    setTab('routes');
    routesPanel.addCustom(tour);
    if (sheet.isMobile) sheet.snap('half');
    const [[w, s], [e, n]] = boundsOf(tour.coords);
    overlay.setFocus({ w, s, e, n }); // feines Wetterraster für die neue Route
    toast('Route übernommen');
  },
});

function updatePeakHeader(peak) {
  $('peak-name').textContent = peak.name;
  $('peak-meta').textContent = [peak.ele ? `${fmtInt(peak.ele)} m` : null, peak.region || null].filter(Boolean).join(', ');
}

$('panel-close').addEventListener('click', () => {
  planner.close();
  setHighlight(null);
  poiFilter.hidden = true;
  current.ctrl?.abort();
  current = { ctrl: null, peak: null };
  panel.hidden = true;
  view.clear();
  overlay.setFocus(null);
  search.setValue('');
  history.replaceState(null, '', location.pathname);
});

// --- Gipfel auswählen ----------------------------------------------------------
let current = { ctrl: null, peak: null };

async function selectPeak(input) {
  planner.close();
  current.ctrl?.abort();
  const ctrl = new AbortController();
  const peak = { ...input };
  current = { ctrl, peak, ava: null, avaAuto: true };
  const signal = ctrl.signal;
  const stale = () => current.peak !== peak;

  if (wbar.isOpen) { savedCamera = null; await toggleWeather(false); }
  // Die Karte bleibt in 2D (flüssiger); 3D schaltet man bei Bedarf selbst ein.

  panel.hidden = false;
  setTab('routes');
  updatePeakHeader(peak);
  sheet.snap('half');
  search.setValue(peak.name);
  history.replaceState(null, '', `#${peak.lat.toFixed(5)},${peak.lng.toFixed(5)},${encodeURIComponent(peak.name)}`);

  view.clear();
  updatePoiFilter();
  view.showPeak(peak);
  overlay.setFocus({ w: peak.lng, e: peak.lng, s: peak.lat, n: peak.lat }); // feines Wetterraster um den Gipfel
  view.flyToPeak(peak);
  routesPanel.loading('Suche Startpunkte im Umkreis …');
  forecastPanel.loading();
  loadAvalanche(peak, stale);
  // Webcams im Umkreis (fehlt der Schlüssel, bleibt die Ebene einfach leer)
  fetchWebcams(peak.lat, peak.lng, { signal })
    .then((d) => { if (!stale() && d) { view.showWebcams(d.cams); updatePoiFilter(); } })
    .catch((e) => { if (e.name !== 'AbortError') console.info('Webcams nicht geladen:', e.message); });

  // Höhe aus dem Höhenmodell (schnell) für das Wetter, OSM-Höhe folgt mit den Startpunkten
  const demP = peak.ele ? Promise.resolve(peak.ele) : demElevation(peak.lat, peak.lng).catch(() => null);
  // Hohe Gipfel haben lange Zustiege (Zugspitze: Garmisch, Hammersbach, Ehrwald) → größerer Umkreis
  const radius = (peak.ele ?? 0) > 2500 ? 12000 : 9000;
  const surroundP = loadSurroundings(peak, { signal, radius });

  demP.then((ele) => {
    if (stale()) return;
    if (!peak.ele && ele) { peak.ele = ele; updatePeakHeader(peak); }
    return fetchForecast(peak, { signal })
      .then((fc) => { if (!stale()) forecastPanel.set(peak, fc); })
      .catch((e) => { if (e.name !== 'AbortError') forecastPanel.error(e.message); });
  });

  let places;
  try {
    const res = await surroundP;
    if (stale()) return;
    places = res.places;
    if (res.ele) { peak.ele = res.ele; updatePeakHeader(peak); }
  } catch (e) {
    if (e.name === 'AbortError') return;
    routesPanel.message('Startpunkte konnten nicht geladen werden', `${e.message}. Der OpenStreetMap-Dienst ist manchmal überlastet; versuche es in einer Minute noch einmal.`);
    return;
  }

  view.showPOIs(places.filter((p) => ['hut', 'alm', 'bivouac', 'parking'].includes(p.type)));
  updatePoiFilter();
  routesPanel.loading('Berechne Routen …');
  let shown = false;
  try {
    await suggestRoutes(peak, places, {
      signal,
      onProgress: (d, n) => !stale() && !shown && routesPanel.loading(`Berechne Routen (${d} von ${n}) …`),
      // Zwischenstände sofort zeigen: erst direkte Wege, dann Varianten, Hüttentouren, Rundtouren
      onUpdate: (routes, { done }) => {
        if (stale()) return;
        if (!routes.length && !done) return;
        routesPanel.set(peak, routes, { pending: !done });
        if (!shown && routes.length) { view.fitRoutes(); shown = true; }
        if (done && routes.length) {
          const [[w, s], [e, n]] = boundsOf(routes.flatMap((r) => r.coords));
          overlay.setFocus({ w, s, e, n }); // feines Wetterraster über alle Touren
        }
      },
    });
  } catch (e) {
    if (e.name === 'AbortError') return;
    routesPanel.message('Routen konnten nicht berechnet werden', e.message);
  }
}

const search = setupSearch({ getCenter: () => view.map.getCenter(), onSelect: selectPeak });
view.on('peak', selectPeak);
view.on('route', (id) => {
  if (panel.hidden) return;
  setTab('routes');
  if (sheet.state === 'peek') sheet.snap('half');
  routesPanel.select(id);
});

// --- Kartensteuerung -----------------------------------------------------------
$('btn-zoom-in').addEventListener('click', () => view.map.zoomIn());
$('btn-zoom-out').addEventListener('click', () => view.map.zoomOut());

function set3D(on, byUser = true) {
  $('btn-3d').setAttribute('aria-pressed', on);
  view.set3D(on);
}
$('btn-3d').addEventListener('click', () => {
  if (wbar.isOpen) return toast('In der Wetterkarte ist die Ansicht flach.');
  set3D(!view.state.terrain3d);
});
$('btn-weather').addEventListener('click', () => toggleWeather(!wbar.isOpen));

const popover = $('style-popover');
$('btn-style').addEventListener('click', (e) => {
  e.stopPropagation();
  popover.hidden = !popover.hidden;
});
document.addEventListener('pointerdown', (e) => {
  if (!popover.hidden && !e.target.closest('#style-popover, #btn-style')) popover.hidden = true;
});
popover.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
  popover.querySelectorAll('[data-style]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  view.setBaseStyle(b.dataset.style);
  document.body.dataset.base = b.dataset.style;
}));
$('toggle-trails').addEventListener('change', (e) => view.setTrails(e.target.checked));
$('toggle-contours').addEventListener('change', (e) => view.setContours(e.target.checked));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    popover.hidden = true;
    if (planner.active) planner.close();
    if (wbar.isOpen) toggleWeather(false);
  }
});

// --- Hinweise ----------------------------------------------------------------------
let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// --- GPX-Import (z. B. aus komoot, Outdooractive) ------------------------------------
async function handleFiles(files) {
  const gpx = [...files].filter((f) => /\.gpx$/i.test(f.name) || f.type === 'application/gpx+xml');
  if (!gpx.length) { toast('Bitte eine GPX-Datei verwenden.'); return; }
  for (const f of gpx) {
    try {
      const tour = await importGPXFile(f, current.peak);
      if (!current.peak) {
        // Noch kein Gipfel gewählt: höchster Punkt der Tour wird zum Gipfel
        const top = tour.coords.reduce((m, c) => ((c[2] ?? -1e9) > (m[2] ?? -1e9) ? c : m));
        selectPeak({ name: tour.title, lat: top[1], lng: top[0], ele: top[2] != null ? Math.round(top[2]) : null, region: 'Höchster Punkt der importierten Tour', osmType: null, osmId: null });
      }
      setTab('routes');
      if (wbar.isOpen && isDesktop()) toggleWeather(false);
      routesPanel.addImport(tour, current.peak);
      const [[w, s], [e, n]] = boundsOf(tour.coords);
      overlay.setFocus({ w, s, e, n });
      toast(`„${tour.title}“ importiert`);
    } catch (e) {
      toast(e.message || 'Die Datei konnte nicht gelesen werden.');
    }
  }
}

// Dateien auf die Karte ziehen
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; document.body.classList.add('dropping'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dropping'); });
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dropping');
  handleFiles(e.dataTransfer.files);
});

// --- Gipfel aus der Adresszeile (#lat,lng,Name) wiederherstellen ---------------------
const m = location.hash.match(/^#(-?\d+\.\d+),(-?\d+\.\d+),(.+)$/);
if (m) {
  view.map.once('load', () => selectPeak({
    lat: +m[1], lng: +m[2], name: decodeURIComponent(m[3]), ele: null, region: '', osmType: null, osmId: null,
  }));
} else {
  $('search-input').focus();
}
