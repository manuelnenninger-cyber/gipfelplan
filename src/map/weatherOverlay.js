import { fetchGrid, RateLimitError, DETAIL_STEP } from '../api/weather.js';
import { fetchRadarFrames } from '../api/radar.js';
import { renderField, pixelLookup, detailLookup, sliceAt, bilinear, geoToGrid, probe, thunderRisk, PRECIP_MIN } from './field.js';
import { latToMercY, mercYToLat } from '../util/geo.js';
import { createAvalancheLayer } from './avalancheLayer.js';

const FIELD_W = 384;
const FIELD_H = 384;

// Abdunkelung der Grundkarte, damit weiße Wolken und farbiger Niederschlag kräftig wirken
const DIM = { standard: 0.62, topo: 0.6, satellite: 0.35 };

/**
 * Wetterkarte über der MapLibre-Karte:
 *  – Modellfelder (Wolken, Niederschlag, Gewitter, Wind) als Canvas-Quelle,
 *    stündlich bis +120 h, zwischen den Stunden weich überblendet
 *  – zwei Raster: ein regionales für die ganze Ansicht und ein feines (≈1,5 km)
 *    um Gipfel und Routen; ihre Werte werden beim Zeichnen weich gemischt
 *  – Windpartikel als Bildschirm-Canvas
 *  – Radar (letzte 2 h) als Rasterkacheln
 */
export function createWeatherOverlay(view, { onStatus } = {}) {
  const { map } = view;
  const s = {
    active: false,
    layer: 'precip',
    windLevel: '10m',
    t: 0,
    grid: null,
    lookup: null,
    loading: null,
    focus: null,       // Gebiet für das Detailraster (Gipfel + Routen)
    detail: null,
    detailLookup: null,
    detailLoading: null,
    radar: [],
    radarIndex: 0,
  };

  // Offscreen-Canvas für das Feld (wird als Canvas-Quelle in die Karte gelegt)
  const fieldCanvas = document.createElement('canvas');
  fieldCanvas.width = FIELD_W;
  fieldCanvas.height = FIELD_H;
  const fctx = fieldCanvas.getContext('2d', { willReadFrequently: true });
  const img = fctx.createImageData(FIELD_W, FIELD_H);

  // Bildschirm-Canvas für Windpartikel
  const pCanvas = document.createElement('canvas');
  pCanvas.className = 'wind-particles';
  map.getContainer().appendChild(pCanvas);
  const pctx = pCanvas.getContext('2d');
  let particles = [];
  let rafId = 0;

  // Wettermodell-Ebenen (Felder aus dem Raster); Radar und Lawinen sind eigene Kartenebenen
  const isModelLayer = () => s.layer !== 'radar' && s.layer !== 'avalanche';
  const timeAt = () => (s.grid ? s.grid.times[0] + s.t * 3600000 : Date.now());

  // --- Kartenquellen -----------------------------------------------------------
  // Wetterebenen liegen unter den Ortsnamen (bleiben lesbar) und unter den Routen.
  function beforeLabels() {
    const first = map.getStyle().layers.find((l) => l.type === 'symbol' && !l.id.startsWith('gp-'));
    return first?.id ?? (map.getLayer('gp-routes-casing') ? 'gp-routes-casing' : undefined);
  }

  function attachDim() {
    // Bei den Lawinenstufen weniger abdunkeln, damit die Farben stimmen
    const opacity = (DIM[view.state.base] ?? 0.45) * (s.layer === 'avalanche' ? 0.45 : 1);
    if (map.getLayer('gp-wx-dim')) { map.setPaintProperty('gp-wx-dim', 'background-opacity', opacity); return; }
    map.addLayer({
      id: 'gp-wx-dim', type: 'background',
      paint: { 'background-color': '#0e1626', 'background-opacity': opacity },
    }, beforeLabels());
  }
  function detachDim() {
    if (map.getLayer('gp-wx-dim')) map.removeLayer('gp-wx-dim');
  }

  // Lawinenwarnstufen (eigene Ebene, Zeit über die gleiche Zeitleiste)
  const aval = createAvalancheLayer(map, { beforeId: beforeLabels, onState: (st) => api.onAvalanche?.(st) });

  function attachField() {
    if (!s.grid || !s.active || !isModelLayer()) return;
    const coords = [[s.grid.w, s.grid.n], [s.grid.e, s.grid.n], [s.grid.e, s.grid.s], [s.grid.w, s.grid.s]];
    const src = map.getSource('gp-wx-field');
    if (src) {
      src.setCoordinates(coords);
    } else {
      // animate: false – sonst zeichnet MapLibre die Karte pausenlos neu (60×/s, auch im Stillstand)
      map.addSource('gp-wx-field', { type: 'canvas', canvas: fieldCanvas, coordinates: coords, animate: false });
      const before = beforeLabels();
      map.addLayer({
        id: 'gp-wx-field', type: 'raster', source: 'gp-wx-field',
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      }, before);
    }
  }
  function detachField() {
    if (map.getLayer('gp-wx-field')) map.removeLayer('gp-wx-field');
    if (map.getSource('gp-wx-field')) map.removeSource('gp-wx-field');
  }

  function attachRadar() {
    const before = beforeLabels();
    s.radar.forEach((f, i) => {
      const id = `gp-wx-radar-${i}`;
      if (!map.getSource(id)) {
        map.addSource(id, {
          type: 'raster', tiles: [f.tiles], tileSize: 256, maxzoom: 7,
          attribution: 'Radar © <a href="https://www.rainviewer.com">RainViewer</a>',
        });
        map.addLayer({
          id, type: 'raster', source: id,
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-opacity-transition': { duration: 0 } },
        }, before);
      }
    });
    showRadarFrame(s.radarIndex);
  }
  function detachRadar() {
    for (let i = 0; i < 40; i++) {
      const id = `gp-wx-radar-${i}`;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
  }
  function showRadarFrame(i) {
    s.radarIndex = i;
    s.radar.forEach((_, k) => {
      const id = `gp-wx-radar-${k}`;
      if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', k === i ? 0.9 : 0);
    });
  }

  // Nach einem Stilwechsel alles wieder einhängen
  view.on('styleload', () => {
    if (!s.active) return;
    attachDim();
    if (s.layer === 'avalanche') aval.reattach();
    else if (isModelLayer()) { attachField(); drawField(); } else attachRadar();
  });

  // --- Rastergitter laden --------------------------------------------------------
  function viewBounds() {
    const b = map.getBounds();
    let w = b.getWest(), e = b.getEast(), sLat = b.getSouth(), n = b.getNorth();
    const padX = (e - w) * 0.3, padY = (n - sLat) * 0.3;
    w -= padX; e += padX; sLat -= padY; n += padY;
    // Mindest- und Höchstausdehnung
    const cx = (w + e) / 2, cy = (sLat + n) / 2;
    const spanX = Math.min(24, Math.max(0.55, e - w));
    const spanY = Math.min(16, Math.max(0.35, n - sLat));
    // Auf ein festes Raster runden: gleiche Gegend → gleiche Anfrage → Treffer im Zwischenspeicher
    const step = spanX > 6 ? 1 : spanX > 2 ? 0.5 : spanX > 1 ? 0.25 : 0.1;
    const down = (v) => Math.floor(v / step) * step, up = (v) => Math.ceil(v / step) * step;
    const r3 = (v) => +v.toFixed(3);
    return {
      w: r3(down(cx - spanX / 2)), e: r3(up(cx + spanX / 2)),
      s: r3(Math.max(-80, down(cy - spanY / 2))), n: r3(Math.min(80, up(cy + spanY / 2))),
    };
  }

  // Passt ein Raster zum aktuellen Ausschnitt? (deckt ihn ab und ist nicht zu grob)
  function fits(g) {
    if (!g) return false;
    const b = map.getBounds();
    const inside = b.getWest() >= g.w && b.getEast() <= g.e && b.getSouth() >= g.s && b.getNorth() <= g.n;
    const tooCoarse = (b.getEast() - b.getWest()) < (g.e - g.w) / 5;
    const fresh = Date.now() - g.fetchedAt < 45 * 60 * 1000;
    return inside && !tooCoarse && fresh;
  }
  function needsNewGrid() { return !fits(s.grid); }

  // Bereits geladene Raster wiederverwenden (schont das Kontingent des Wetterdienstes)
  const cache = [];
  let retryTimer = 0;

  async function loadGrid() {
    if (s.loading) return s.loading;
    const cached = cache.find(fits);
    if (cached) { useGrid(cached); return; }
    const bounds = viewBounds();
    onStatus?.('Lade Wettermodell …');
    s.loading = fetchGrid(bounds)
      .then((grid) => {
        grid.fetchedAt ??= Date.now();
        cache.unshift(grid);
        cache.length = Math.min(cache.length, 6);
        useGrid(grid);
      })
      .catch((e) => {
        onStatus?.(e.message);
        if (e instanceof RateLimitError && e.retryIn != null) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { if (s.active && isModelLayer() && needsNewGrid()) loadGrid(); }, e.retryIn);
        }
      })
      .finally(() => { s.loading = null; });
    return s.loading;
  }

  function useGrid(grid) {
    // Zeitachse beibehalten: gleiche Uhrzeit wie vorher, auch wenn das neue Raster später beginnt
    const prevTime = s.grid ? s.grid.times[0] + s.t * 3600000 : null;
    s.grid = grid;
    workerSend('grid', grid);
    s.lookup = pixelLookup(grid, FIELD_W, FIELD_H);
    s.detailLookup = s.detail ? detailLookup(s.lookup, s.detail) : null;
    const t = prevTime != null ? (prevTime - grid.times[0]) / 3600000 : s.t;
    s.t = Math.max(0, Math.min(grid.times.length - 1, t));
    onStatus?.(null);
    if (s.active && isModelLayer()) { attachField(); drawField(); resetParticles(); }
    api.onGrid?.(grid);
    loadDetail();
  }

  // --- Detailraster um Gipfel und Routen ------------------------------------------
  const detailCache = new Map();
  function focusKey(f) { return f ? [f.w, f.s, f.e, f.n].map((v) => v.toFixed(3)).join(',') : ''; }

  async function loadDetail() {
    const f = s.focus;
    if (!f || !s.active || !isModelLayer() || !s.grid) return;
    const key = focusKey(f);
    const hit = detailCache.get(key);
    if (hit && Date.now() - hit.fetchedAt < 45 * 60 * 1000) { useDetail(hit); return; }
    if (s.detailLoading === key) return;
    s.detailLoading = key;
    const nx = Math.max(6, Math.min(16, Math.round((f.e - f.w) / DETAIL_STEP) + 1));
    const ny = Math.max(6, Math.min(16, Math.round((f.n - f.s) / (DETAIL_STEP * 0.7)) + 1));
    try {
      const d = await fetchGrid(f, { nx, ny });
      d.fetchedAt ??= Date.now();
      detailCache.set(key, d);
      if (focusKey(s.focus) === key) useDetail(d);
    } catch (e) {
      console.info('Detailraster nicht geladen:', e.message); // Regionalraster reicht als Rückfall
    } finally {
      if (s.detailLoading === key) s.detailLoading = null;
    }
  }

  function useDetail(d) {
    s.detail = d;
    workerSend('detail', d);
    s.detailLookup = s.lookup ? detailLookup(s.lookup, d) : null;
    if (s.active && isModelLayer()) drawField();
  }

  let moveTimer = 0;
  map.on('moveend', () => {
    if (!s.active) return;
    resetParticles();
    if (!isModelLayer()) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { if (needsNewGrid()) loadGrid(); }, 600);
  });
  map.on('movestart', () => { if (s.active) pctx.clearRect(0, 0, pCanvas.width, pCanvas.height); });
  map.on('resize', () => resizeParticles());

  // --- Feld zeichnen -------------------------------------------------------------
  // --- Wetterbild berechnen: im Hintergrund-Thread, damit die Bedienung flüssig bleibt ---
  let worker = null;
  try {
    worker = new Worker(new URL('./fieldWorker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'size', W: FIELD_W, H: FIELD_H });
  } catch {
    worker = null; // Rückfall: im Hauptthread rechnen
  }
  let seq = 0, inFlight = false, pending = false;
  if (worker) {
    worker.onmessage = (e) => {
      inFlight = false;
      if (s.active && isModelLayer() && e.data.seq === seq) {
        img.data.set(new Uint8ClampedArray(e.data.buffer));
        fctx.putImageData(img, 0, 0);
        uploadField();
      }
      if (pending) { pending = false; drawField(); }
    };
    worker.onerror = () => { worker = null; inFlight = false; drawField(); };
  }
  const workerSend = (type, grid) => worker?.postMessage({ type, grid });

  function detailTime() {
    const d = s.detail;
    if (!d) return 0;
    const absT = s.grid.times[0] + s.t * 3600000;
    return Math.max(0, Math.min(d.times.length - 1, (absT - d.times[0]) / 3600000));
  }

  function drawField() {
    if (!s.grid || !isModelLayer()) return;
    if (worker) {
      // Läuft schon eine Berechnung, wird danach mit dem neuesten Stand weitergerechnet
      if (inFlight) { pending = true; return; }
      inFlight = true;
      worker.postMessage({ type: 'render', seq: ++seq, layer: s.layer, t: s.t, td: detailTime(), windLevel: s.windLevel });
      return;
    }
    const detail = s.detail && s.detailLookup ? { grid: s.detail, tf: detailTime(), lookup: s.detailLookup } : null;
    renderField(img, s.grid, s.lookup, s.layer, s.t, { windLevel: s.windLevel, detail });
    fctx.putImageData(img, 0, 0);
    uploadField();
  }

  function uploadField() {
    // Neues Bild genau einmal zur Grafikkarte schicken
    const src = map.getSource('gp-wx-field');
    if (src?.play) {
      src.play();
      map.once('render', () => src.pause());
    } else {
      map.triggerRepaint();
    }
  }

  let drawRaf = 0, lastDraw = 0;
  function scheduleDraw() {
    if (drawRaf) return;
    const tick = (ts) => {
      if (ts - lastDraw < 66) { drawRaf = requestAnimationFrame(tick); return; }
      drawRaf = 0;
      lastDraw = ts;
      drawField();
    };
    drawRaf = requestAnimationFrame(tick);
  }

  // --- Windpartikel --------------------------------------------------------------
  function resizeParticles() {
    const r = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    pCanvas.width = w * r;
    pCanvas.height = h * r;
    pCanvas.style.width = `${w}px`;
    pCanvas.style.height = `${h}px`;
    pctx.setTransform(r, 0, 0, r, 0, 0);
    resetParticles();
  }

  function screenToGeo() {
    const b = map.getBounds();
    const { clientWidth: W, clientHeight: H } = map.getContainer();
    const yN = latToMercY(b.getNorth()), yS = latToMercY(b.getSouth());
    return (x, y) => [b.getWest() + (x / W) * (b.getEast() - b.getWest()), mercYToLat(yN + (y / H) * (yS - yN))];
  }

  function resetParticles() {
    const { clientWidth: W, clientHeight: H } = map.getContainer();
    const n = Math.min(2600, Math.round((W * H) / 700));
    particles = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, age: Math.random() * 80 }));
    pctx.clearRect(0, 0, W, H);
  }

  let lastUV = null;
  function startParticles() {
    if (rafId || !s.active || s.layer !== 'wind') return;
    rafId = requestAnimationFrame(animate);
  }
  function stopParticles() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function animate() {
    if (!s.active || s.layer !== 'wind') { rafId = 0; return; }
    rafId = requestAnimationFrame(animate);
    if (!s.active || s.layer !== 'wind' || !s.grid || map.isMoving()) return;
    const { clientWidth: W, clientHeight: H } = map.getContainer();
    const key = s.windLevel === '700hPa' ? '700' : '10';
    // u/v nur neu berechnen, wenn sich Zeit oder Ebene ändern
    const sig = `${s.t.toFixed(2)}|${key}`;
    if (!lastUV || lastUV.sig !== sig) {
      lastUV = { sig, u: sliceAt(s.grid, `u${key}`, s.t), v: sliceAt(s.grid, `v${key}`, s.t) };
    }
    const toGeo = screenToGeo();

    pctx.globalCompositeOperation = 'destination-in';
    pctx.fillStyle = 'rgba(0,0,0,0.9)';
    pctx.fillRect(0, 0, W, H);
    pctx.globalCompositeOperation = 'source-over';
    pctx.strokeStyle = 'rgba(255,255,255,0.78)'; // Karte ist im Wettermodus abgedunkelt
    pctx.lineWidth = 1.1;
    pctx.beginPath();
    const { nx, ny } = s.grid;
    for (const p of particles) {
      const [lng, lat] = toGeo(p.x, p.y);
      const { gx, gy } = geoToGrid(s.grid, lng, lat);
      if (gx < 0 || gy < 0 || gx > nx - 1 || gy > ny - 1 || p.age > 90) {
        p.x = Math.random() * W; p.y = Math.random() * H; p.age = 0; continue;
      }
      const u = bilinear(lastUV.u, nx, ny, gx, gy);
      const v = bilinear(lastUV.v, nx, ny, gx, gy);
      const k = 0.035; // rein optisch: km/h → Pixel pro Frame
      const nxp = p.x + u * k, nyp = p.y - v * k;
      pctx.moveTo(p.x, p.y);
      pctx.lineTo(nxp, nyp);
      p.x = nxp; p.y = nyp; p.age++;
    }
    pctx.stroke();
  }

  // --- Messwert unter dem Mauszeiger -----------------------------------------------
  const probeEl = document.createElement('div');
  probeEl.className = 'wx-probe';
  probeEl.hidden = true;
  map.getContainer().appendChild(probeEl);
  const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const pct = (v) => `${Math.round(Math.max(0, Math.min(100, v)))} %`;
  const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

  function probeText(v) {
    const clouds = `<span>Wolken tief ${pct(v.cl)}, mittel ${pct(v.cm)}, hoch ${pct(v.ch)}</span>`;
    if (s.layer === 'precip') {
      const pr = v.precip;
      if (pr < PRECIP_MIN) return `<b>Kein Niederschlag</b>${clouds}`;
      const snow = pr > 0.02 && (v.snow / 0.7) / pr >= 0.5;
      const kind = snow ? 'Schnee' : 'Regen';
      const strength = pr < 1 ? 'leichter' : pr < 4 ? 'mäßiger' : 'starker';
      return `<b class="${snow ? 'is-snow' : 'is-rain'}">${strength[0].toUpperCase() + strength.slice(1)} ${kind}, ${nf1.format(pr)} mm/h</b>${clouds}`;
    }
    if (s.layer === 'clouds') return `<b>Bewölkung</b>${clouds.replace('Wolken ', '')}`;
    if (s.layer === 'thunder') {
      const r = thunderRisk(v.cape, v.precip);
      return `<b>Gewitterrisiko ${r > 0.6 ? 'hoch' : r > 0.25 ? 'mittel' : 'gering'}</b><span>Labilität (CAPE) ${Math.round(v.cape)} J/kg</span>`;
    }
    const high = s.windLevel === '700hPa';
    const u = high ? v.u700 : v.u10, w = high ? v.v700 : v.v10;
    const from = (Math.atan2(-u, -w) * 180 / Math.PI + 360) % 360;
    return `<b>Wind ${Math.round(Math.hypot(u, w))} km/h aus ${DIRS[Math.round(from / 45) % 8]}</b><span>${high ? 'in ca. 3000 m Höhe' : 'in Bodennähe'}</span>`;
  }

  function placeProbe(ev) {
    const { clientWidth: W } = map.getContainer();
    const left = ev.point.x + 16 + 260 > W ? ev.point.x - 16 - 260 : ev.point.x + 16;
    probeEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(ev.point.y + 16)}px)`;
    probeEl.hidden = false;
  }

  let probeRaf = 0, probeEvt = null;
  function showProbe(e) {
    probeEvt = e;
    if (probeRaf) return;
    probeRaf = requestAnimationFrame(() => {
      probeRaf = 0;
      const ev = probeEvt;
      if (s.active && ev && s.layer === 'avalanche') {
        const a = aval.probe(ev.point);
        if (!a) { probeEl.hidden = true; return; }
        probeEl.innerHTML = a.level
          ? `<b>Lawinenstufe ${a.level} – ${a.name}</b><span>${a.elevation === 'high' ? 'oberhalb' : 'unterhalb'} der Höhengrenze${a.other && a.other !== a.level ? `, ${a.elevation === 'high' ? 'darunter' : 'darüber'} Stufe ${a.other}` : ''}</span>`
          : '<b>Keine Warnstufe</b><span>für diese Region und Zeit</span>';
        placeProbe(ev);
        return;
      }
      if (!s.active || !isModelLayer() || !s.grid || !ev) { probeEl.hidden = true; return; }
      const v = probe(s.grid, s.t, ev.lngLat.lng, ev.lngLat.lat, s.detail, detailTime());
      if (!v) { probeEl.hidden = true; return; }
      probeEl.innerHTML = probeText(v);
      placeProbe(ev);
    });
  }
  const hideProbe = () => { probeEvt = null; probeEl.hidden = true; };
  map.on('mousemove', (e) => { if (s.active && !map.isMoving()) showProbe(e); });
  map.on('mouseout', hideProbe);
  map.on('movestart', hideProbe);
  // Auf Touch-Geräten: antippen zeigt den Wert kurz an
  let probeTimer = 0;
  map.on('click', (e) => {
    if (!s.active || !window.matchMedia('(hover: none)').matches) return;
    showProbe(e);
    clearTimeout(probeTimer);
    probeTimer = setTimeout(hideProbe, 3500);
  });

  // --- Öffentliche Schnittstelle ------------------------------------------------
  const api = {
    onGrid: null,
    onAvalanche: null,
    get state() { return s; },

    async enable() {
      if (s.active) return;
      s.active = true;
      view.setFlat(true);
      attachDim();
      resizeParticles();
      pCanvas.hidden = s.layer !== 'wind';
      startParticles();
    },

    disable() {
      s.active = false;
      clearTimeout(retryTimer);
      stopParticles();
      cancelAnimationFrame(drawRaf);
      drawRaf = 0;
      pCanvas.hidden = true;
      detachDim();
      hideProbe();
      detachField();
      detachRadar();
      aval.show(false);
      view.setFlat(false);
    },

    async setLayer(layer) {
      s.layer = layer;
      hideProbe();
      pCanvas.hidden = layer !== 'wind';
      if (layer === 'wind') startParticles(); else stopParticles();
      if (!s.active) return;
      attachDim();
      if (layer !== 'avalanche') aval.show(false);
      if (layer === 'avalanche') {
        detachField();
        detachRadar();
        if (!s.grid) await loadGrid(); // für die Zeitleiste
        await aval.show(true).catch((e) => onStatus?.(`Lawinenkarte nicht verfügbar: ${e.message}`));
        await aval.setTime(timeAt());
      } else if (layer === 'radar') {
        detachField();
        if (!s.radar.length) {
          onStatus?.('Lade Radar …');
          try { s.radar = await fetchRadarFrames(); s.radarIndex = s.radar.length - 1; onStatus?.(null); }
          catch (e) { onStatus?.(e.message); return; }
        }
        attachRadar();
      } else {
        detachRadar();
        if (needsNewGrid()) await loadGrid();
        attachField();
        drawField();
        resetParticles();
        loadDetail();
      }
    },

    /** Gebiet für das feine Raster setzen (Gipfel und Routen), {w,s,e,n} oder null */
    setFocus(b) {
      if (!b) { s.focus = null; s.detail = null; s.detailLookup = null; workerSend('detail', null); drawField(); return; }
      // Mindestgröße, damit das Raster nicht zu klein wird, und auf 0,01° runden (Cache-Treffer)
      const cx = (b.w + b.e) / 2, cy = (b.s + b.n) / 2;
      const hx = Math.max(0.12, (b.e - b.w) / 2 * 1.3), hy = Math.max(0.08, (b.n - b.s) / 2 * 1.3);
      const r = (v) => Math.round(v * 100) / 100;
      const f = { w: r(cx - hx), e: r(cx + hx), s: r(cy - hy), n: r(cy + hy) };
      if (focusKey(f) === focusKey(s.focus)) return;
      s.focus = f;
      if (s.detail && focusKey(s.detail) !== focusKey(f)) { s.detail = null; s.detailLookup = null; workerSend('detail', null); }
      loadDetail();
    },

    setWindLevel(level) { s.windLevel = level; drawField(); resetParticles(); },

    setTime(t) {
      if (s.layer === 'radar') { showRadarFrame(Math.round(t)); return; }
      if (s.layer === 'avalanche') { s.t = t; aval.setTime(timeAt()); if (probeEvt) showProbe(probeEvt); return; }
      s.t = t;
      worker ? drawField() : scheduleDraw();
      if (probeEvt) showProbe(probeEvt);
    },

    refreshColors() { drawField(); },
  };
  return api;
}
