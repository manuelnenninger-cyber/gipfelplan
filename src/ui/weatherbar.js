import { icon } from './icons.js';
import { fmtDayHour, fmtWeekday, fmtTime } from '../util/format.js';

const DAY_HOUR = 10; // Tag gewählt → 10 Uhr, typische Zeit unterwegs
import { SCALES, thunderRisk } from '../map/field.js';
import { LEVEL_COLOR, LEVEL_NAME } from '../api/avalanche.js';

const WINDY_OVERLAY = { avalanche: 'snowcover', radar: 'radar', clouds: 'clouds', precip: 'rain', thunder: 'thunder', wind: 'wind' };

function gradient(scale, from, to, unit, labels) {
  const stops = scale
    .filter((s) => s[0] >= from)
    .map((s) => `rgba(${s[1]},${s[2]},${s[3]},${Math.max(0.15, s[4])}) ${(((s[0] - from) / (to - from)) * 100).toFixed(0)}%`)
    .join(',');
  return `<span class="lg-bar" style="background:linear-gradient(90deg,${stops})"></span>
          <span class="lg-labels">${labels.map((l) => `<span>${l}</span>`).join('')}</span><span class="lg-unit">${unit}</span>`;
}

const LEGENDS = {
  avalanche: () => [1, 2, 3, 4, 5].map((l) => `<span class="lg-ava" style="--c:${LEVEL_COLOR[l]}">${l}</span><span class="lg-ava-name">${LEVEL_NAME[l]}</span>`).join(''),
  radar: () => '<span class="lg-text">Gemessener Niederschlag der letzten 2 Stunden</span>',
  clouds: () => '<span class="lg-chip lg-low"></span>tief (Nebel, Gipfel in Wolken)<span class="lg-chip lg-mid"></span>mittel<span class="lg-chip lg-high"></span>hoch',
  precip: () => `<span class="lg-name">Regen</span>${gradient(SCALES.rain, 0.1, 25, 'mm/h', ['0,1', '1', '5', '25'])}<span class="lg-snow">Schnee</span><span class="lg-cloud">Wolken</span>`,
  thunder: () => gradient(SCALES.thunder, 0.12, 1, '', ['gering', 'mittel', 'hoch']),
  wind: () => gradient(SCALES.wind, 12, 110, 'km/h', ['10', '40', '80', '110']),
};

export function createWeatherBar(overlay, { getCenter }) {
  const bar = document.getElementById('weatherbar');
  const slider = document.getElementById('wb-slider');
  const timeEl = document.getElementById('wb-time');
  const daysEl = document.getElementById('wb-days');
  const playBtn = document.getElementById('wb-play');
  const legend = document.getElementById('wb-legend');
  const windy = document.getElementById('wb-windy');
  const windLevel = document.getElementById('wb-wind-level');
  const statusEl = document.getElementById('wb-status');
  const dayChips = document.getElementById('wb-daychips');
  let chipDays = [];
  const hintEl = document.getElementById('wb-hint');
  const hintText = document.getElementById('wb-hint-text');
  const hintBtn = document.getElementById('wb-hint-btn');
  let hintTarget = null;
  windy.insertAdjacentHTML('beforeend', icon('external'));

  let playing = false;
  let raf = 0;
  let last = 0;
  let pendingDate = null;

  const s = overlay.state;
  const isRadar = () => s.layer === 'radar';

  // Tagesauswahl: ein Knopf pro Tag des Wetterrasters
  function buildDayChips() {
    if (isRadar() || !s.grid) { dayChips.hidden = true; chipDays = []; return; }
    const seen = new Map();
    s.grid.times.forEach((t, i) => {
      const d = new Date(t); const key = d.toDateString();
      if (!seen.has(key)) seen.set(key, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), first: i });
    });
    chipDays = [...seen.values()];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    dayChips.innerHTML = chipDays.map((c, i) => {
      const diff = Math.round((c.date - today) / 86400000);
      const label = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : `${fmtWeekday(c.date)} ${c.date.getDate()}.`;
      return `<button role="tab" data-i="${i}">${label}</button>`;
    }).join('');
    dayChips.hidden = false;
    dayChips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      play(false);
      const c = chipDays[+b.dataset.i];
      const target = new Date(c.date); target.setHours(DAY_HOUR, 0, 0, 0);
      let idx = (target - s.grid.times[0]) / 3600000;
      if (idx < 0) idx = 0; // heute schon später als 10 Uhr → jetzt
      setT(Math.min(s.grid.times.length - 1, idx));
    }));
    markDay();
  }
  function markDay() {
    if (!chipDays.length || !s.grid) return;
    const cur = new Date(s.grid.times[0] + s.t * 3600000).toDateString();
    dayChips.querySelectorAll('button').forEach((b) => {
      const on = chipDays[+b.dataset.i].date.toDateString() === cur;
      b.setAttribute('aria-selected', on);
    });
  }
  function step(h) {
    if (isRadar()) {
      const n = s.radar.length; if (!n) return;
      setT(Math.max(0, Math.min(n - 1, s.radarIndex + Math.sign(h))));
    } else if (s.grid) {
      play(false);
      setT(Math.max(0, Math.min(s.grid.times.length - 1, Math.round(s.t) + h)));
    }
  }
  document.getElementById('wb-prev').addEventListener('click', () => step(-1));
  document.getElementById('wb-next').addEventListener('click', () => step(1));
  // Pfeiltasten: ±1 Stunde, mit Umschalt ±1 Tag
  document.addEventListener('keydown', (e) => {
    if (bar.hidden || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (/input|textarea/i.test(document.activeElement?.tagName) && document.activeElement !== slider) return;
    e.preventDefault();
    step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 24 : 1));
  });

  function configureSlider() {
    buildDayChips();
    if (isRadar()) {
      const n = Math.max(1, s.radar.length);
      slider.min = 0; slider.max = n - 1; slider.step = 1;
      slider.value = s.radarIndex;
      daysEl.innerHTML = '';
    } else if (s.grid) {
      const T = s.grid.times.length;
      slider.min = 0; slider.max = T - 1; slider.step = 0.05;
      slider.value = s.t;
      // Tagesmarken
      daysEl.innerHTML = s.grid.times
        .map((t, i) => ({ d: new Date(t), i }))
        .filter(({ d, i }) => d.getHours() === 0 && i > 0)
        .map(({ d, i }) => `<span style="left:${(i / (T - 1)) * 100}%">${fmtWeekday(d)}</span>`)
        .join('');
    }
    updateLabel();
  }

  function updateLabel() {
    if (isRadar()) {
      const f = s.radar[s.radarIndex];
      if (!f) { timeEl.textContent = ''; return; }
      const mins = Math.round((Date.now() - f.time) / 60000);
      timeEl.textContent = `${fmtTime(new Date(f.time))} Uhr${mins <= 10 ? ', aktuell' : `, vor ${mins} Min.`}`;
    } else if (s.grid) {
      const t0 = s.grid.times[0];
      const d = new Date(t0 + s.t * 3600000);
      d.setMinutes(Math.round(d.getMinutes() / 10) * 10);
      timeEl.textContent = `${fmtDayHour(d)} Uhr`;
    }
  }

  // Stärke eines Zeitschritts im Ausschnitt (max. über alle Gitterpunkte)
  function strength(layer, t) {
    const g = s.grid; const n = g.nx * g.ny; const o = t * n; let mx = 0;
    for (let i = 0; i < n; i++) {
      const v = layer === 'precip' ? g.layers.precip[o + i]
        : thunderRisk(g.layers.cape[o + i], g.layers.precip[o + i], g.layers.code?.[o + i] ?? 0);
      if (v > mx) mx = v;
    }
    return mx;
  }

  /** Zeigt einen Hinweis, wenn in der gewählten Ebene gerade nichts zu sehen ist */
  let avaState = null;
  overlay.onAvalanche = (st) => { avaState = st; updateHint(); };

  function updateHint() {
    hintTarget = null;
    const layer = s.layer;
    if (layer === 'avalanche') {
      hintBtn.hidden = true;
      const st = avaState;
      if (playing || !st) { hintEl.hidden = true; return; }
      const d = new Date(`${st.date}T00:00:00`);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = Math.round((d - today) / 86400000);
      const when = diff === 0 ? 'heute' : diff === 1 ? 'morgen' : `${fmtWeekday(d)}, ${d.getDate()}.`;
      if (!st.available) {
        hintText.textContent = diff >= 1
          ? `Für ${when} gibt es noch keinen Lawinenbericht. Er erscheint am Vortag gegen 17 Uhr.`
          : 'Für diesen Tag liegt kein Lawinenbericht vor.';
      } else if (!st.count) {
        hintText.textContent = 'In den Alpen gibt derzeit kein Warndienst eine Lawinenstufe aus – außerhalb der Wintersaison üblich.';
      } else { hintEl.hidden = true; return; }
      hintEl.hidden = false;
      return;
    }
    if (playing || !s.grid || (layer !== 'precip' && layer !== 'thunder')) { hintEl.hidden = true; return; }
    const thr = layer === 'precip' ? 0.15 : 0.12;
    const now = Math.round(s.t);
    if (strength(layer, now) >= thr) { hintEl.hidden = true; return; }
    const T = s.grid.times.length;
    let next = -1;
    for (let t = now + 1; t < T; t++) if (strength(layer, t) >= thr) { next = t; break; }
    const what = layer === 'precip' ? 'Niederschlag' : 'Gewitterrisiko';
    if (next < 0) {
      hintText.textContent = `Kein ${what} im Kartenausschnitt in den nächsten ${T} Stunden.`;
      hintBtn.hidden = true;
    } else {
      hintTarget = next;
      hintText.textContent = `Zu diesem Zeitpunkt kein ${what} im Ausschnitt.`;
      hintBtn.textContent = `Nächster: ${fmtDayHour(new Date(s.grid.times[next]))} Uhr`;
      hintBtn.hidden = false;
    }
    hintEl.hidden = false;
  }
  hintBtn.addEventListener('click', () => { if (hintTarget != null) setT(hintTarget); });

  function setT(t) {
    if (isRadar()) {
      overlay.setTime(Math.round(t));
    } else {
      overlay.setTime(t);
    }
    slider.value = t;
    updateLabel();
    markDay();
    if (!playing) updateHint();
  }

  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (!last) last = ts;
    const dt = ts - last;
    if (isRadar()) {
      if (dt < 600) return;
      last = ts;
      const n = s.radar.length;
      if (n) setT((s.radarIndex + 1) % n);
    } else if (s.grid) {
      last = ts;
      const T = s.grid.times.length - 1;
      let t = s.t + dt / 320; // 1 Stunde pro 0,32 s
      if (t > T) t = 0;
      setT(t);
    }
  }

  function play(on) {
    playing = on;
    if (on) hintEl.hidden = true; else updateHint();
    playBtn.innerHTML = icon(on ? 'pause' : 'play');
    playBtn.setAttribute('aria-label', on ? 'Anhalten' : 'Abspielen');
    cancelAnimationFrame(raf);
    last = 0;
    if (on) raf = requestAnimationFrame(tick);
  }

  async function chooseLayer(layer) {
    play(false);
    bar.querySelectorAll('.wb-layers button').forEach((b) => b.setAttribute('aria-checked', b.dataset.layer === layer));
    windLevel.hidden = layer !== 'wind';
    legend.innerHTML = LEGENDS[layer]();
    await overlay.setLayer(layer);
    configureSlider();
    updateWindy();
    updateHint();
  }

  function noonIndex(date) {
    const noon = new Date(date); noon.setHours(DAY_HOUR, 0, 0, 0);
    const idx = (noon.getTime() - s.grid.times[0]) / 3600000;
    return Math.max(0, Math.min(s.grid.times.length - 1, idx));
  }

  function updateWindy() {
    const c = getCenter();
    windy.href = `https://www.windy.com/?${WINDY_OVERLAY[s.layer]},${c.lat.toFixed(3)},${c.lng.toFixed(3)},8`;
  }

  // Events
  bar.querySelectorAll('.wb-layers button').forEach((b) => {
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => chooseLayer(b.dataset.layer));
  });
  windLevel.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    windLevel.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    overlay.setWindLevel(b.dataset.level);
  }));
  slider.addEventListener('input', () => { play(false); setT(+slider.value); });
  playBtn.addEventListener('click', () => play(!playing));

  overlay.onGrid = () => {
    if (pendingDate && s.grid) {
      s.t = noonIndex(pendingDate);
      pendingDate = null;
      overlay.setTime(s.t);
    }
    configureSlider();
    updateHint();
  };

  return {
    async open(date, { layer } = {}) {
      bar.hidden = false;
      if (layer) s.layer = layer;
      pendingDate = date || null;
      if (pendingDate && s.grid) overlay.onGrid();
      await overlay.enable();
      await chooseLayer(s.layer);
    },
    jumpTo(date) {
      if (!s.grid || s.layer === 'radar') return;
      play(false);
      const idx = noonIndex(date);
      if (idx >= s.grid.times.length - 1 && new Date(date) > new Date(s.grid.times[s.grid.times.length - 1])) {
        this.status('Die Wetterkarte reicht 5 Tage weit. Für spätere Tage gilt die Prognose in der Seitenleiste.');
        setTimeout(() => this.status(null), 3500);
      }
      setT(idx);
    },
    close() {
      play(false);
      hintEl.hidden = true;
      bar.hidden = true;
      overlay.disable();
    },
    status(text) {
      statusEl.hidden = !text;
      statusEl.textContent = text || '';
    },
    updateWindy,
    /** Ebene wechseln, während die Wetterkarte offen ist */
    showLayer(layer) { if (!bar.hidden) chooseLayer(layer); },
    get layer() { return s.layer; },
    get isOpen() { return !bar.hidden; },
  };
}
