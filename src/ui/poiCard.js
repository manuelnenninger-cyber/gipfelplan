// Infokarte für Hütten und Parkplätze: Foto, Öffnungszeit, das Wichtigste – nicht mehr.
import maplibregl from 'maplibre-gl';
import { poiDetails, poiImage } from '../api/poi.js';
import { demElevation } from '../api/osm.js';
import { haversine } from '../util/geo.js';
import { escapeHtml } from '../util/format.js';
import { icon } from './icons.js';

let popup = null;
let ctrl = null;

const nf = new Intl.NumberFormat('de-DE');
const km = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const apple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function navUrl({ lat, lng }) {
  return apple
    ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** Lage zum Gipfel, z. B. „2,4 km · 850 Hm unter dem Gipfel“ */
function relation(place, ele, peak) {
  if (!peak) return null;
  const d = haversine([place.lng, place.lat], [peak.lng, peak.lat]);
  if (d < 150) return 'direkt am Gipfel';
  const parts = [`${km(d)} Luftlinie zum Gipfel`];
  if (ele != null && peak.ele) {
    const dh = Math.round(peak.ele - ele);
    if (dh > 20) parts.push(`${nf.format(dh)} Hm darunter`);
  }
  return parts.join(' · ');
}

function render(el, place, info, peak) {
  const hut = place.type === 'hut';
  const sub = [info.label, info.ele != null ? `${nf.format(info.ele)} m` : null].filter(Boolean).join(' · ');

  let status = '';
  if (info.hours.text) {
    const cls = info.hours.open === true ? 'is-open' : info.hours.open === false ? 'is-closed' : '';
    const word = info.hours.open === true ? 'Geöffnet' : info.hours.open === false ? 'Derzeit geschlossen' : 'Öffnungszeiten';
    status = `<div class="poi-status ${cls}"><b>${word}</b><span>${escapeHtml(info.hours.text)}</span></div>`;
  } else if (hut && place.kind !== 'wilderness_hut') {
    const where = info.website ? 'auf der Website' : info.phone ? 'telefonisch' : 'vor der Tour';
    status = `<div class="poi-status"><b>Öffnungszeiten</b><span>In OpenStreetMap nicht eingetragen – am besten ${where} prüfen</span></div>`;
  }

  const rows = [];
  if (hut && info.operator) rows.push(['signpost', info.operator]);
  if (hut && info.beds) rows.push(['bed', `${info.beds} Schlafplätze${info.winterRoom ? ' · Winterraum' : ''}`]);
  else if (hut && info.winterRoom) rows.push(['bed', 'Winterraum vorhanden']);
  if (!hut && info.fee) rows.push(['euro', info.fee]);
  if (!hut && info.spaces) rows.push(['parking', `ca. ${info.spaces} Stellplätze`]);
  const rel = relation(place, info.ele, peak);
  if (rel) rows.push(['mountain', rel]);

  const actions = [];
  if (!hut) actions.push(`<a class="poi-btn primary" href="${navUrl(place)}" target="_blank" rel="noopener">${icon('navigate')}Navigation</a>`);
  if (info.website) actions.push(`<a class="poi-btn${hut ? ' primary' : ''}" href="${escapeHtml(info.website)}" target="_blank" rel="noopener">${icon('external')}Website</a>`);
  if (info.phone) actions.push(`<a class="poi-btn" href="tel:${escapeHtml(info.phone.replace(/[^\d+]/g, ''))}">${icon('phone')}Anrufen</a>`);

  el.querySelector('.poi-body').innerHTML = `
    <div class="poi-head">
      <span class="poi-ico ${hut ? 'hut' : 'parking'}">${icon(hut ? 'hut' : 'parking')}</span>
      <div><h3>${escapeHtml(info.name || info.label)}</h3><p>${escapeHtml(sub)}</p></div>
    </div>
    ${status}
    ${rows.length ? `<ul class="poi-rows">${rows.map(([i, t]) => `<li>${icon(i)}<span>${escapeHtml(t)}</span></li>`).join('')}</ul>` : ''}
    ${actions.length ? `<div class="poi-actions">${actions.join('')}</div>` : ''}
    <a class="poi-src" href="https://www.openstreetmap.org/${place.id}" target="_blank" rel="noopener">Daten: OpenStreetMap</a>`;
}

/** Karte so verschieben, dass die Infokarte ganz zu sehen ist (nicht unter der Seitenleiste) */
function keepInView(map, el) {
  const box = el.closest('.maplibregl-popup')?.getBoundingClientRect();
  if (!box) return;
  const view = map.getContainer().getBoundingClientRect();
  // Handy: Bottom-Sheet verdeckt den unteren Teil der Karte
  const sheetH = innerWidth <= 720 ? Number(document.getElementById('panel')?.dataset.h) || 0 : 0;
  const bottomEdge = sheetH && !document.getElementById('panel').hidden ? Math.min(view.bottom, innerHeight - sheetH) : view.bottom;
  const panel = document.querySelector('.panel:not([hidden])')?.getBoundingClientRect();
  const left = panel && panel.right < view.width * 0.6 && innerWidth > 720 ? panel.right : view.left;
  const m = 12;
  let dx = 0, dy = 0;
  if (box.left < left + m) dx = box.left - left - m;
  else if (box.right > view.right - 64) dx = box.right - view.right + 64; // Kartenknöpfe rechts
  if (box.top < view.top + m) dy = box.top - view.top - m;
  else if (box.bottom > bottomEdge - 30) dy = box.bottom - bottomEdge + 30;
  if (dx || dy) map.panBy([dx, dy], { duration: 350 });
}

export function closePoiCard() {
  ctrl?.abort();
  popup?.remove();
  popup = null;
}

export function openPoiCard(map, place, { peak } = {}) {
  closePoiCard();
  ctrl = new AbortController();
  const { signal } = ctrl;

  const el = document.createElement('div');
  el.className = 'poi-card';
  el.innerHTML = `<figure class="poi-photo" hidden></figure><div class="poi-body"><div class="poi-loading">Lade Infos …</div></div>`;
  popup = new maplibregl.Popup({ className: 'poi-popup', maxWidth: '300px', offset: 14, focusAfterOpen: false })
    .setLngLat([place.lng, place.lat])
    .setDOMContent(el)
    .addTo(map);
  popup.on('close', () => { if (ctrl?.signal === signal) ctrl.abort(); });

  poiDetails(place, signal).then(async (info) => {
    if (signal.aborted) return;
    render(el, place, info, peak);
    keepInView(map, el);

    // Höhe nachtragen, wenn OSM keine kennt (für „… Hm unter dem Gipfel“)
    if (info.ele == null) {
      demElevation(place.lat, place.lng).then((e) => {
        if (signal.aborted || e == null) return;
        info.ele = e;
        render(el, place, info, peak);
      }).catch(() => {});
    }

    const img = await poiImage(place, info.tags, signal).catch(() => null);
    if (signal.aborted || !img) return;
    const fig = el.querySelector('.poi-photo');
    const pic = new Image();
    pic.alt = info.name || info.label;
    pic.decoding = 'async';
    pic.referrerPolicy = 'no-referrer';
    pic.onload = () => {
      if (signal.aborted) return;
      fig.innerHTML = '';
      fig.append(pic);
      fig.insertAdjacentHTML('beforeend', `<a href="${escapeHtml(img.href)}" target="_blank" rel="noopener">${escapeHtml(img.credit)}</a>`);
      fig.hidden = false;
      keepInView(map, el);
    };
    pic.src = img.src;
  }).catch((e) => {
    if (signal.aborted) return;
    el.querySelector('.poi-body').innerHTML = `<div class="poi-loading">Infos nicht verfügbar (${escapeHtml(e.message)})</div>`;
  });
}
