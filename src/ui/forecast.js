import { icon, wxIcon } from './icons.js';
import { avalancheCard } from './avalancheCard.js';
import { wxKind, wmoText } from '../api/weather.js';
import { compassShort } from '../util/geo.js';
import { escapeHtml, fmtInt, fmtWeekday, fmtDayLong, fmtTime } from '../util/format.js';

const LEVEL_HEIGHT = { 850: 1500, 800: 2000, 700: 3000, 600: 4200, 500: 5600 };
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const r = (v) => (v == null || Number.isNaN(v) ? '–' : Math.round(v));

export function createForecastPanel(el, { onOpenMap, onDay, onAvalancheMap }) {
  let fc = null;
  let ava = null;
  let peak = null;
  let dayIdx = 0;

  function loading() {
    el.innerHTML = `<p class="status-line"><span class="spinner"></span>Lade Wetter am Gipfel …</p><div class="skeleton-card"></div>`;
  }
  function error(msg) {
    el.innerHTML = `<div class="empty"><p class="empty-title">Kein Wetter verfügbar</p><p class="muted">${escapeHtml(msg)}</p></div>`;
  }

  function render() {
    if (!fc) return;
    const now = Date.now();
    const cur = fc.hours.find((h) => h.t.getTime() + 3600000 > now) || fc.hours[0];
    const day = fc.days[dayIdx];

    el.innerHTML = `
      ${avalancheCard(ava, day.date, peak)}
      <div class="now-card">
        <div class="now-main">
          ${wxIcon(wxKind(cur.code), cur.isDay, 'wx-lg')}
          <div>
            <p class="now-temp">${r(cur.temp)}°</p>
            <p class="now-text">${escapeHtml(wmoText(cur.code))}</p>
          </div>
        </div>
        <p class="now-meta">Jetzt am Gipfel${fc.ele ? ` auf ${fmtInt(fc.ele)} m` : ''}. Gefühlt ${r(cur.feels)}°, Wind ${r(cur.windSummit)} km/h${cur.dirSummit != null ? ` aus ${compassShort(cur.dirSummit)}` : ''}.</p>
      </div>

      <div class="day-strip" role="tablist" aria-label="Tage">
        ${fc.days.map((d, i) => `
          <button role="tab" class="day ${i === dayIdx ? 'is-active' : ''}" data-i="${i}" aria-selected="${i === dayIdx}">
            <span class="day-name">${i === 0 ? 'Heute' : fmtWeekday(d.date)}</span>
            ${wxIcon(wxKind(d.code), true)}
            <span class="day-temp"><b>${r(d.tmax)}°</b><span>${r(d.tmin)}°</span></span>
            <span class="ampel ampel-${d.rating.level}" title="${escapeHtml(d.rating.label)}"></span>
          </button>`).join('')}
      </div>

      <section class="day-detail">
        <header class="day-head">
          <h2>${i18nDay(day, dayIdx)}</h2>
          <p class="verdict verdict-${day.rating.level}"><span class="ampel ampel-${day.rating.level}"></span>${escapeHtml(day.rating.label)}<span class="muted">: ${escapeHtml(day.rating.reasons.join(', '))}</span></p>
        </header>

        <div class="hourly" tabindex="0" aria-label="Stündlicher Verlauf">
          ${day.hours.filter((h) => h.t.getHours() >= 5 && h.t.getHours() <= 21).map((h) => `
            <div class="hour ${h.t.getTime() <= now && h.t.getTime() + 3600000 > now ? 'is-now' : ''}">
              <span class="hour-t">${h.t.getHours()} Uhr</span>
              ${wxIcon(wxKind(h.code), h.isDay)}
              <span class="hour-temp">${r(h.temp)}°</span>
              <span class="hour-p ${h.precip >= 0.1 ? '' : 'is-zero'}">${h.precip >= 0.1 ? `${nf1.format(h.precip)} mm` : '–'}</span>
              <span class="hour-w">${r(h.windSummit)}</span>
            </div>`).join('')}
        </div>
        <p class="hourly-legend">Niederschlag pro Stunde, Wind am Gipfel in km/h</p>

        ${tiles(day)}

        <button class="btn btn-wide btn-wx-map" id="open-wx-map">${icon('cloudSun')}Wetterkarte für diesen Tag</button>
      </section>

      <p class="fineprint">Prognose von Open-Meteo (u. a. DWD ICON, ECMWF). Temperaturen sind auf Gipfelhöhe umgerechnet${fc.level ? `, der Gipfelwind stammt aus ca. ${fmtInt(LEVEL_HEIGHT[fc.level])} m Höhe (${fc.level} hPa)` : ''}. Die Ampel ist eine grobe Einschätzung und ersetzt keinen Bergwetterbericht. Lawinenstufen: Europäische Lawinenwarndienste (EAWS), gesammelt von avalanche.report.</p>
    `;

    el.querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => { dayIdx = +b.dataset.i; render(); onDay?.(fc.days[dayIdx].date); }));
    el.querySelector('#open-wx-map').addEventListener('click', () => onOpenMap?.(day.date));
    el.querySelector('.ava-map')?.addEventListener('click', () => onAvalancheMap?.(day.date));
    el.querySelector('.hour.is-now')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function tiles(day) {
    const win = day.hours.filter((h) => h.t.getHours() >= 8 && h.t.getHours() <= 17);
    const src = win.length ? win : day.hours;
    const maxBy = (k) => src.reduce((best, h) => ((h[k] ?? -1) > (best?.[k] ?? -1) ? h : best), null);
    const wMax = maxBy('windSummit');
    const fz = src.map((h) => h.freezing).filter((v) => v != null);
    const fzText = fz.length ? `${fmtInt(Math.round(Math.min(...fz) / 50) * 50)}–${fmtInt(Math.round(Math.max(...fz) / 50) * 50)} m` : '–';
    const fzWarn = fz.length && fc.ele && Math.min(...fz) < fc.ele;
    const rows = [
      ['wind', 'Wind am Gipfel', wMax ? `bis ${r(wMax.windSummit)} km/h` : '–', wMax?.dirSummit != null ? `meist aus ${compassShort(wMax.dirSummit)}` : ''],
      ['wind', 'Böen', day.gust != null ? `bis ${r(day.gust)} km/h` : '–', 'Modellwert in Bodennähe'],
      ['freeze', 'Nullgradgrenze', fzText, fzWarn ? 'Gipfel liegt zeitweise im Frost' : 'zwischen 8 und 17 Uhr'],
      ['zap', 'Gewitterrisiko', day.rating.thunderRisk ?? '–', 'nachmittags am höchsten'],
      ['droplet', 'Niederschlag', `${nf1.format(day.precip ?? 0)} mm`, day.prob != null ? `Wahrscheinlichkeit bis ${r(day.prob)} %` : ''],
      ['snowflake', 'Neuschnee', `${nf1.format(day.snow ?? 0)} cm`, 'Summe des Tages'],
      ['sunrise', 'Sonne', day.sunrise ? `${fmtTime(day.sunrise)}–${fmtTime(day.sunset)}` : '–', day.sunshineH != null ? `${nf1.format(day.sunshineH)} h Sonnenschein` : ''],
    ];
    return `<dl class="tiles">${rows.map(([ic, k, v, sub]) => `
      <div class="tile"><dt>${icon(ic)}${k}</dt><dd>${escapeHtml(String(v))}</dd>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div>`).join('')}</dl>`;
  }

  return {
    loading,
    error,
    set(p, forecast) { peak = p; fc = forecast; dayIdx = 0; render(); },
    showDay(i) { dayIdx = i; render(); },
    /** Lawinenlage der Gipfelregion (lädt parallel zur Wetterprognose) */
    setAvalanche(a) { ava = a; render(); },
  };
}

function i18nDay(day, i) {
  if (i === 0) return 'Heute';
  if (i === 1) return 'Morgen';
  return fmtDayLong(day.date);
}
