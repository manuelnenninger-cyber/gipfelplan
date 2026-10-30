// Eigene Route planen: Punkte auf der Karte antippen (Parkplatz, Hütte, Gipfel …),
// die App verbindet sie über vorhandene Wege. Punkte lassen sich verschieben und löschen.
import maplibregl from 'maplibre-gl';
import { planRoute, planTitle } from '../api/routing.js';
import { icon } from './icons.js';
import { escapeHtml, fmtKm, fmtInt, fmtDuration } from '../util/format.js';

const TYPE_ICON = { parking: 'parking', hut: 'hut', peak: 'mountain', point: 'signpost' };
let counter = 0;

export function createPlanner({ view, getPeak, onAccept, onOpen, onClose }) {
  const el = document.getElementById('planner');
  let points = [];
  let route = null;
  let error = null;
  let busy = false;
  let ctrl = null;
  let timer = 0;
  let markers = [];
  let active = false;

  const label = (i) => (i === 0 ? 'A' : i === points.length - 1 && points.length > 1 ? 'Z' : String(i));

  function hint() {
    if (!points.length) return 'Tippe auf der Karte den Startpunkt an – z. B. einen Parkplatz.';
    if (points.length === 1) return 'Jetzt das nächste Ziel antippen: eine Hütte, den Gipfel oder einen Punkt am Weg.';
    return 'Weitere Punkte antippen, Punkte auf der Karte verschieben oder mit × entfernen.';
  }

  function render() {
    const peak = getPeak();
    const hasPeak = peak && points.some((p) => p.type === 'peak' && Math.abs(p.lat - peak.lat) < 1e-4 && Math.abs(p.lng - peak.lng) < 1e-4);
    const loop = points.length > 2 && points[0].lat === points.at(-1).lat && points[0].lng === points.at(-1).lng;
    const stats = route ? `
      <div class="pl-stats">
        <span>${icon('route')}${fmtKm(route.length)}</span>
        <span>${icon('arrowUp')}${fmtInt(route.up)} m</span>
        <span>${icon('arrowDown')}${fmtInt(route.down)} m</span>
        <span>${icon('clock')}${fmtDuration(route.oneWay || route.isLoop ? route.timeTotal : route.timeUp)}${route.oneWay || route.isLoop ? '' : ' hoch'}</span>
        ${route.sac ? `<span class="sac sac-${route.sac}">T${route.sac}</span>` : ''}
      </div>` : '';
    el.innerHTML = `
      <header class="pl-head">
        <h2>${icon('route')}Eigene Route</h2>
        <button class="icon-btn pl-close" aria-label="Planung beenden">${icon('x')}</button>
      </header>
      ${points.length ? `<ol class="pl-points">${points.map((p, i) => `
        <li><span class="pl-num" data-l="${label(i)}">${label(i)}</span>${icon(TYPE_ICON[p.type] || 'signpost')}<span class="pl-name">${escapeHtml(p.name || 'Punkt am Weg')}</span>
        <button class="pl-del" data-i="${i}" aria-label="Punkt entfernen">${icon('x')}</button></li>`).join('')}</ol>` : ''}
      <p class="pl-hint">${busy ? '<span class="spinner"></span>Verbinde über Wanderwege …' : escapeHtml(error || hint())}</p>
      ${stats}
      <div class="pl-actions">
        ${peak && !hasPeak ? `<button class="btn pl-peak">${icon('mountain')}${escapeHtml(peak.name)}</button>` : ''}
        ${points.length >= 2 && !loop ? `<button class="btn pl-loop">${icon('loop')}Zurück zum Start</button>` : ''}
        ${points.length ? `<button class="btn pl-undo">Rückgängig</button>` : ''}
        <button class="btn btn-primary pl-accept" ${route && !busy ? '' : 'disabled'}>Route übernehmen</button>
      </div>`;
    el.querySelector('.pl-close').addEventListener('click', () => close());
    el.querySelector('.pl-peak')?.addEventListener('click', () => add({ lat: peak.lat, lng: peak.lng, name: peak.name, type: 'peak' }));
    el.querySelector('.pl-loop')?.addEventListener('click', () => add({ ...points[0] }));
    el.querySelector('.pl-undo')?.addEventListener('click', () => { points.pop(); changed(); });
    el.querySelector('.pl-accept').addEventListener('click', accept);
    el.querySelectorAll('.pl-del').forEach((b) => b.addEventListener('click', () => { points.splice(+b.dataset.i, 1); changed(); }));
  }

  function renderMarkers() {
    markers.forEach((m) => m.remove());
    markers = points.map((p, i) => {
      const m = document.createElement('div');
      m.className = 'plan-pt';
      m.dataset.l = label(i);
      m.textContent = label(i);
      // Rundtour: letzter Punkt liegt auf dem ersten – nur einen zeigen
      if (i === points.length - 1 && i > 1 && p.lat === points[0].lat && p.lng === points[0].lng) m.hidden = true;
      const marker = new maplibregl.Marker({ element: m, draggable: true }).setLngLat([p.lng, p.lat]).addTo(view.map);
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLngLat();
        points[i] = { lat, lng, name: null, type: 'point' };
        changed();
      });
      return marker;
    });
  }

  function changed() {
    route = null;
    error = null;
    view.setPlanRoute(null);
    renderMarkers();
    clearTimeout(timer);
    ctrl?.abort();
    busy = points.length >= 2;
    render();
    if (busy) timer = setTimeout(compute, 250);
  }

  async function compute() {
    ctrl = new AbortController();
    const { signal } = ctrl;
    try {
      const r = await planRoute(points, getPeak(), { signal, id: `custom:${++counter}` });
      if (signal.aborted) return;
      route = r;
      view.setPlanRoute(r.coords);
      busy = false;
      render();
      keepVisible(r.coords);
      return;
    } catch (e) {
      if (e.name === 'AbortError' || signal.aborted) return;
      error = e.message;
    }
    busy = false;
    render();
  }

  /** Route ganz zeigen, falls sie über den Rand oder unter die Planungskarte reicht */
  function keepVisible(coords) {
    const map = view.map;
    const box = map.getContainer().getBoundingClientRect();
    const card = el.getBoundingClientRect();
    const panel = document.getElementById('panel');
    const mobile = innerWidth <= 720;
    const left = !mobile && panel && !panel.hidden ? panel.getBoundingClientRect().right + 20 : 20;
    const pad = { top: 90, left, right: 70, bottom: Math.max(30, box.bottom - card.top + 20) };
    const inside = coords.every(([lng, lat]) => {
      const p = map.project([lng, lat]);
      return p.x >= pad.left && p.x <= box.width - pad.right && p.y >= pad.top && p.y <= box.height - pad.bottom;
    });
    if (inside) return;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [lng, lat] of coords) { w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat); }
    view.fitTo([[w, s], [e, n]], { padding: pad, duration: 700, maxZoom: 15, pitch: map.getPitch() });
  }

  function add(p) {
    points.push(p);
    changed();
  }

  function accept() {
    if (!route) return;
    route.title = planTitle(points);
    route.baseTitle = route.title;
    const r = route;
    close();
    onAccept?.(r);
  }

  function open() {
    if (active) return;
    active = true;
    points = [];
    route = null;
    error = null;
    el.hidden = false;
    view.setPlanning(add);
    onOpen?.();
    render();
  }

  function close() {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    ctrl?.abort();
    markers.forEach((m) => m.remove());
    markers = [];
    view.setPlanning(null);
    view.setPlanRoute(null);
    el.hidden = true;
    onClose?.();
  }

  return { open, close, get active() { return active; } };
}
