// „Planen“ für eine Tour: Tag und Startzeit wählen, Empfehlung „wann los?“, Zeitplan mit
// Wetter zur jeweiligen Uhrzeit, Sonne & Schatten entlang der Route, Schnee am Weg.
import { icon, wxIcon } from './icons.js';
import { escapeHtml, fmtDuration, fmtInt, fmtTime, fmtWeekday } from '../util/format.js';
import { wxKind, wmoText } from '../api/weather.js';
import {
  buildItinerary, recommendStart, weatherAt, sunAlong, sunSummary, samplePoints, fetchSnowAlong, snowSummary, satSnowLine,
} from '../api/plan.js';
import { loadDem } from '../map/dem.js';
import { snowFromSatellite } from '../map/satellite.js';

const H = 3600000;
const STEP = 15 * 60000;
const dayShort = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric' });
const dayLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const SUN_TEXT = { sun: 'Sonne', shade: 'Schatten', night: 'Dunkel', unknown: '–' };
const MARK_ICON = { start: 'signpost', hut: 'hut', summit: 'mountain', end: 'flag' };

/**
 * @param host Element, in das die Ansicht gezeichnet wird
 * @param o.route Tour, o.peak Gipfel
 * @param o.getForecast () => Promise<Gipfelprognose>
 * @param o.onBack Zurück zur Tourenliste
 * @param o.onHover ([lng, lat] | null) Punkt auf der Karte zeigen
 * @param o.snowLayer { on: boolean, set(on) } Schnee-Satellitenbild auf der Karte
 */
export function openPlanView(host, { route, peak, getForecast, onBack, onHover, snowLayer }) {
  const it = buildItinerary(route, peak);
  const ctrl = new AbortController();
  let fc = null;
  let dayIdx = 0;
  let start = null; // Date
  let rec = null;
  let elevAt = null; // Gelände für Sonne/Schatten
  let demState = 'loading';
  let snow = { state: 'loading' };
  let sat = { state: 'loading' };
  let sunCache = { key: '', segs: null };
  let closed = false;

  host.innerHTML = `<div class="plan">${head()}<p class="status-line"><span class="spinner"></span>Lade Wetter und Gelände …</p></div>`;
  bindHead();

  function head() {
    return `<header class="plan-head">
        <button class="plan-back" aria-label="Zurück zu den Touren">${icon('chevronLeft')}Touren</button>
        <div class="plan-title"><p>Startzeit & Wetter</p><h3>${escapeHtml(route.title)}</h3></div>
      </header>`;
  }
  function bindHead() {
    host.querySelector('.plan-back').addEventListener('click', () => close());
  }
  function close() {
    if (closed) return;
    closed = true;
    ctrl.abort();
    onHover?.(null);
    onBack?.();
  }

  // --- Daten laden ----------------------------------------------------------------
  getForecast()
    .then((f) => {
      if (closed) return;
      fc = f;
      // heute, wenn man es noch rechtzeitig schafft – sonst morgen
      const today = recommendStart(fc.days[0], it.total);
      dayIdx = !today.tight && today.latest > new Date() ? 0 : 1;
      chooseDay(dayIdx, true);
    })
    .catch((e) => { if (!closed) host.querySelector('.plan').innerHTML = `${head()}<div class="empty"><p class="empty-title">Wetter nicht verfügbar</p><p class="muted">${escapeHtml(e.message)}</p></div>`; bindHead(); });

  const bounds = it.points.reduce((b, p) => ({ w: Math.min(b.w, p.lng), e: Math.max(b.e, p.lng), s: Math.min(b.s, p.lat), n: Math.max(b.n, p.lat) }), { w: 180, e: -180, s: 90, n: -90 });
  loadDem(bounds, { signal: ctrl.signal })
    .then((f) => { elevAt = f; demState = 'ok'; })
    .catch(() => { demState = 'error'; })
    .finally(() => { if (!closed && fc) render(); });

  fetchSnowAlong(samplePoints(it.points, it.summitT, 8), { signal: ctrl.signal })
    .then((list) => { snow = { state: 'ok', list, sum: snowSummary(list) }; })
    .catch((e) => { snow = { state: 'error', message: e.message }; })
    .finally(() => { if (!closed && fc) render(); });

  // Satellitenbild entlang des Aufstiegs: wo ist es weiß?
  snowFromSatellite(samplePoints(it.points, it.summitT, 24), { signal: ctrl.signal })
    .then((r) => { sat = { state: 'ok', date: r.date, line: satSnowLine(r.points) }; })
    .catch(() => { sat = { state: 'error' }; })
    .finally(() => { if (!closed && fc) render(); });

  function chooseDay(i, first = false) {
    dayIdx = Math.max(0, Math.min(fc.days.length - 1, i));
    rec = recommendStart(fc.days[dayIdx], it.total);
    start = rec.suggested;
    render(first);
  }

  // --- Zeichnen ---------------------------------------------------------------------
  const at = (t) => new Date(start.getTime() + t * H);
  const day = () => fc.days[dayIdx];

  function sunSegs() {
    if (!elevAt) return null;
    const key = `${start.getTime()}`;
    if (sunCache.key !== key) sunCache = { key, segs: sunAlong(it.points, start, elevAt, { summitT: it.summitT }) };
    return sunCache.segs;
  }

  function render() {
    if (closed) return;
    const scroll = host.closest('.panel-body')?.scrollTop;
    const segs = sunSegs();
    host.innerHTML = `<div class="plan">
      ${head()}
      ${daysHtml()}
      ${startHtml()}
      ${summaryHtml()}
      ${timelineHtml(segs)}
      ${sunHtml(segs)}
      ${snowHtml()}
      <p class="fineprint">Gehzeiten nach DAV-Formel ohne Pausen. Wetter: Modellprognose am Gipfel, Temperaturen auf die jeweilige Höhe umgerechnet. Sonne & Schatten aus dem Geländemodell (ca. 50 m), ohne Wolken und Wald. Schnee: grobe Modellwerte – vor Ort und im Lawinenbericht prüfen.</p>
    </div>`;
    if (scroll != null) host.closest('.panel-body').scrollTop = scroll;
    bind();
  }

  function daysHtml() {
    const chips = fc.days.slice(0, 7).map((d, i) => {
      const lbl = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : fmtWeekday(d.date);
      return `<button class="plan-day" data-day="${i}" aria-pressed="${i === dayIdx}">
          <span>${lbl}</span><small>${dayShort.format(d.date)}</small>${wxIcon(wxKind(d.code), true, 'pd-wx')}<i class="pd-dot pd-${d.rating?.level || 'unknown'}"></i></button>`;
    }).join('');
    return `<div class="plan-days" role="group" aria-label="Tag wählen">${chips}</div>`;
  }

  function startHtml() {
    const d = day();
    const min = new Date(d.date); min.setHours(4, 0, 0, 0);
    const max = new Date(d.date); max.setHours(15, 0, 0, 0);
    const reasons = [];
    if (rec.thunderAt) reasons.push(`Gewitter ab ca. ${fmtTime(rec.thunderAt)} möglich – vorher zurück sein`);
    reasons.push(`Sonnenuntergang ${fmtTime(rec.sunset)}`);
    const late = start > rec.latest;
    const early = start < new Date(rec.sunrise.getTime() - 15 * 60000);
    let recText;
    if (rec.tight) {
      recText = `<b>Knapp:</b> ${rec.limitedBy === 'thunder' ? 'Bis zu den möglichen Gewittern' : 'Bis zur Dunkelheit'} reicht die Zeit an diesem Tag kaum. Früh los, kürzere Tour oder anderen Tag wählen.`;
    } else {
      recText = `<b>Empfehlung:</b> spätestens <b>${fmtTime(rec.latest)}</b> losgehen.`;
    }
    return `<section class="plan-start">
        <div class="ps-row">
          <button class="ps-step" data-step="-1" aria-label="15 Minuten früher">${icon('minus')}</button>
          <div class="ps-time"><span>Start am ${escapeHtml(dayLong.format(d.date))}</span><b>${fmtTime(start)}</b></div>
          <button class="ps-step" data-step="1" aria-label="15 Minuten später">${icon('plus')}</button>
        </div>
        <input class="ps-range" type="range" min="${min.getTime()}" max="${max.getTime()}" step="${STEP}" value="${start.getTime()}" aria-label="Startzeit" />
        <div class="ps-rec ${rec.tight || late ? 'is-warn' : ''}">
          ${icon(rec.tight || late ? 'alert' : 'clock')}
          <div><p>${recText}</p><p class="muted small">${reasons.join(' · ')}</p>
          ${late && !rec.tight ? `<p class="ps-late">${lateText()}</p>` : ''}
          ${early ? `<p class="muted small">Start vor Sonnenaufgang (${fmtTime(rec.sunrise)}) – Stirnlampe mitnehmen.</p>` : ''}
          ${start.getTime() !== rec.suggested.getTime() ? `<button class="acct-link ps-apply">Vorschlag ${fmtTime(rec.suggested)} übernehmen</button>` : ''}</div>
        </div>
      </section>`;
  }

  function lateText() {
    const end = at(it.total);
    if (rec.thunderAt && end > rec.thunderAt) return `Mit Start ${fmtTime(start)} bist du erst um ${fmtTime(end)} zurück – nach dem möglichen Gewitterbeginn.`;
    return `Mit Start ${fmtTime(start)} bist du erst um ${fmtTime(end)} zurück – kurz vor oder nach Sonnenuntergang.`;
  }

  function summaryHtml() {
    const end = at(it.total);
    const dark = end > rec.sunset;
    return `<div class="plan-sum">
        <div><span>Start</span><b>${fmtTime(start)}</b></div>
        <div><span>Gipfel</span><b>${fmtTime(at(it.summitT))}</b></div>
        <div class="${dark ? 'is-warn' : ''}"><span>Zurück</span><b>${fmtTime(end)}</b></div>
        <div><span>Gehzeit</span><b>${fmtDuration(it.total)}</b></div>
      </div>`;
  }

  function stateAt(segs, t) {
    if (!segs) return null;
    let hit = null;
    for (const s of segs) if (s.from <= t + 1e-9) hit = s;
    return hit?.state || null;
  }

  function timelineHtml(segs) {
    const rows = it.marks.map((m, k) => {
      const when = at(m.t);
      const w = weatherAt(fc, when, m.ele, { summit: m.kind === 'summit' });
      const st = stateAt(segs, m.t);
      const tags = [];
      if (w?.thunder) tags.push('<span class="tag tag-warn">Gewitter möglich</span>');
      else if ((w?.precip ?? 0) >= 0.3) tags.push(`<span class="tag">${w.temp != null && w.temp < 1 ? 'Schnee' : 'Regen'} ${w.prob != null ? `${Math.round(w.prob)} %` : ''}</span>`);
      if (when < rec.sunrise || when > rec.sunset) tags.push('<span class="tag">dunkel</span>');
      return `<li class="pt-row pt-${m.kind}" data-k="${k}">
          <span class="pt-time">${fmtTime(when)}</span>
          <span class="pt-dot">${icon(MARK_ICON[m.kind] || 'signpost')}</span>
          <span class="pt-main"><b>${escapeHtml(m.name)}</b><small>${fmtInt(m.ele)} m${m.t > 0 ? ` · nach ${fmtDuration(m.t)}` : ''}</small>${tags.join('')}</span>
          <span class="pt-wx" title="${w ? escapeHtml(wmoText(w.code)) : ''}">${w ? `${wxIcon(wxKind(w.code), w.isDay)}<b>${w.temp != null ? `${Math.round(w.temp)}°` : '–'}</b><small>${w.wind != null ? `${Math.round(w.wind)} km/h` : ''}</small>` : ''}</span>
          <span class="pt-sun pt-sun-${st || 'none'}" title="${st ? SUN_TEXT[st] : ''}">${st === 'sun' ? icon('sun') : st === 'shade' ? icon('shade') : st === 'night' ? icon('moon') : ''}</span>
        </li>`;
    }).join('');
    return `<section class="plan-sec"><h4>${icon('clock')}Zeitplan & Wetter</h4><ol class="plan-time">${rows}</ol></section>`;
  }

  function sunHtml(segs) {
    let body;
    if (segs) {
      const total = it.total || 1;
      const bar = segs.map((s) => `<i class="sb-${s.state}" style="width:${(((s.to - s.from) / total) * 100).toFixed(2)}%" title="${SUN_TEXT[s.state]} ${fmtTime(at(s.from))}–${fmtTime(at(s.to))}"></i>`).join('');
      const pct = (t) => `${((t / total) * 100).toFixed(1)}%`;
      body = `<div class="sun-band">${bar}<span class="sb-summit" style="left:${pct(it.summitT)}" title="Gipfel"></span></div>
        <div class="sun-ticks"><span>${fmtTime(start)}</span><span style="left:${pct(it.summitT)}">${icon('mountain')}${fmtTime(at(it.summitT))}</span><span>${fmtTime(at(it.total))}</span></div>
        <p class="plan-text">${escapeHtml(sunSummary(segs, it.summitT, start, fmtTime))}.</p>
        <p class="sun-legend"><span><i class="sb-sun"></i>Sonne</span><span><i class="sb-shade"></i>Schatten</span><span><i class="sb-night"></i>Dunkel</span></p>`;
    } else if (demState === 'loading') {
      body = '<p class="status-line"><span class="spinner"></span>Berechne Sonne und Schatten …</p>';
    } else {
      body = '<p class="muted small">Gelände nicht verfügbar – Sonne und Schatten lassen sich gerade nicht berechnen.</p>';
    }
    return `<section class="plan-sec"><h4>${icon('sun')}Sonne & Schatten</h4>${body}</section>`;
  }

  function snowHtml() {
    const d = day();
    let body;
    if (snow.state === 'loading') body = '<p class="status-line"><span class="spinner"></span>Lade Schneelage …</p>';
    else if (snow.state === 'error' || !snow.sum) body = `<p class="muted small">Schneelage nicht verfügbar${snow.message ? ` (${escapeHtml(snow.message)})` : ''}.</p>`;
    else {
      const s = snow.sum;
      const cm = (m) => `${Math.round(m * 100)} cm`;
      const text = s.any
        ? `Laut Wettermodell liegt ab etwa <b>${fmtInt(s.from)} m</b> Schnee${s.topDepth >= 0.03 ? `, am Gipfel rund <b>${cm(s.topDepth)}</b>` : ''}.`
        : s.maxDepth >= 0.005
          ? `Laut Wettermodell höchstens <b>ein paar Zentimeter</b> Schnee (oben ca. ${cm(s.maxDepth)}).`
          : 'Laut Wettermodell liegt entlang des Aufstiegs <b>kein Schnee</b>.';
      const bars = [...snow.list].sort((a, b) => a.ele - b.ele).map((p) => {
        const h = p.depth == null ? 0 : Math.min(1, p.depth / 0.6);
        return `<span class="snow-col" title="${fmtInt(Math.round(p.ele))} m: ${p.depth == null ? '–' : cm(p.depth)}"><i style="height:${Math.max(h * 100, p.depth > 0.005 ? 8 : 2)}%" class="${p.depth >= 0.03 ? 'is-snow' : ''}"></i><small>${fmtInt(Math.round(p.ele / 10) * 10)}</small></span>`;
      }).join('');
      body = `<p class="plan-text">${text}</p><div class="snow-cols" aria-hidden="true">${bars}</div>
        <p class="muted small">Schneehöhe je Höhenlage (m). Das Modell rechnet grob und unterschätzt Schnee in Gipfellagen oft – das Satellitenbild zeigt, was wirklich liegt.</p>`;
    }
    const fresh = d.snow >= 0.5
      ? `<p class="plan-text">${icon('snowflake')}Am ${escapeHtml(dayLong.format(d.date))} sind am Gipfel etwa <b>${Math.round(d.snow)} cm Neuschnee</b> angesagt.</p>`
      : '';
    let satHtml = '';
    if (sat.state === 'loading') satHtml = '<p class="status-line"><span class="spinner"></span>Werte Satellitenbild aus …</p>';
    else if (sat.state === 'ok' && sat.line && sat.date) {
      const when = new Date(`${sat.date}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
      const l = sat.line;
      const t = l.from != null
        ? `ab etwa <b>${fmtInt(l.from)} m</b> weiß – vermutlich Schnee${l.top ? ', auch am Gipfel' : ''}`
        : l.share > 0.15 ? 'stellenweise weiß – einzelne Schneefelder (oder Wolken)' : '<b>kaum Weiß</b> – vermutlich schneefrei';
      satHtml = `<p class="plan-text sat-line">${icon('layers')}Satellitenbild vom ${when}: entlang des Aufstiegs ${t}.</p>`;
    }
    return `<section class="plan-sec"><h4>${icon('snowflake')}Schnee am Weg</h4>${satHtml}${body}${fresh}
        <button class="btn plan-snow-btn" aria-pressed="${!!snowLayer?.on}">${icon('layers')}${snowLayer?.on ? 'Satellitenbild ausblenden' : 'Aktuelles Satellitenbild auf der Karte'}</button>
      </section>`;
  }

  function setStart(t) {
    const d = day();
    const min = new Date(d.date); min.setHours(4, 0, 0, 0);
    const max = new Date(d.date); max.setHours(15, 0, 0, 0);
    start = new Date(Math.max(min.getTime(), Math.min(max.getTime(), Math.round(t / STEP) * STEP)));
    render();
  }

  let rangeRaf = 0;
  function bind() {
    bindHead();
    host.querySelectorAll('.plan-day').forEach((b) => b.addEventListener('click', () => chooseDay(Number(b.dataset.day))));
    host.querySelectorAll('.ps-step').forEach((b) => b.addEventListener('click', () => setStart(start.getTime() + Number(b.dataset.step) * STEP)));
    const range = host.querySelector('.ps-range');
    range?.addEventListener('input', () => {
      cancelAnimationFrame(rangeRaf);
      const v = Number(range.value);
      rangeRaf = requestAnimationFrame(() => {
        start = new Date(v);
        // beim Ziehen nur Zeiten aktualisieren, die Ansicht beim Loslassen neu zeichnen
        host.querySelector('.ps-time b').textContent = fmtTime(start);
      });
    });
    range?.addEventListener('change', () => setStart(Number(range.value)));
    host.querySelector('.ps-apply')?.addEventListener('click', () => { start = rec.suggested; render(); });
    host.querySelectorAll('.pt-row').forEach((row) => {
      const m = it.marks[Number(row.dataset.k)];
      row.addEventListener('mouseenter', () => onHover?.([m.lng, m.lat]));
      row.addEventListener('mouseleave', () => onHover?.(null));
      row.addEventListener('click', () => onHover?.([m.lng, m.lat]));
    });
    host.querySelector('.plan-snow-btn')?.addEventListener('click', () => {
      snowLayer?.set(!snowLayer.on);
      render();
    });
  }

  return { close };
}
