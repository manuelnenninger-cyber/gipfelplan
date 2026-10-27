// Bottom-Sheet für Handys: drei Höhen (eingeklappt, halb, voll), ziehen und
// wischen wie in Apple Karten. Am Desktop bleibt das Panel eine Seitenleiste.
const mq = window.matchMedia('(max-width: 720px)');
const ORDER = ['peek', 'half', 'full'];

export function createSheet(panel, { onSnap } = {}) {
  const grip = panel.querySelector('.panel-grip');
  const head = panel.querySelector('.panel-head');
  const seg = panel.querySelector('.segmented');
  let state = 'half';
  let height = 0;
  let stamp = 0;

  const safeBottom = () => parseFloat(getComputedStyle(panel).paddingBottom) || 0;

  /** Höhen der drei Stufen in Pixeln */
  function snaps() {
    const H = window.innerHeight;
    const search = document.querySelector('.search')?.getBoundingClientRect();
    const full = Math.round(H - ((search?.bottom ?? 60) + 10));
    // eingeklappt: Griff, Gipfelname und Umschalter Routen/Wetter bleiben sichtbar
    const peek = Math.min(full, Math.round(seg.offsetTop + seg.offsetHeight + 10 + safeBottom()));
    const half = Math.max(peek + 100, Math.min(full, Math.round(H * 0.5)));
    return { peek, half, full };
  }

  function apply(h, animate) {
    panel.classList.toggle('sheet-dragging', !animate);
    height = h;
    panel.style.height = `${Math.round(h)}px`;
  }

  function snap(to, { animate = true, reason } = {}) {
    if (!mq.matches || panel.hidden) { state = to; return; }
    state = to;
    stamp++;
    const h = snaps()[to];
    panel.dataset.sheet = to;
    panel.dataset.h = String(h); // Zielhöhe, für den Kartenausschnitt
    apply(h, animate);
    onSnap?.(to, reason);
  }

  // --- Ziehen am Kopf (Griff, Titel, Umschalter) --------------------------------
  let drag = null;
  function start(y) {
    drag = { y0: y, h0: height || panel.offsetHeight, lastY: y, lastT: performance.now(), v: 0, moved: false };
    panel.classList.add('sheet-dragging');
  }
  function move(y) {
    const { peek, full } = snaps();
    let h = drag.h0 + (drag.y0 - y);
    if (h > full) h = full + (h - full) * 0.2; // gummiartig über die Grenzen hinaus
    if (h < peek) h = peek - (peek - h) * 0.3;
    apply(h, false);
    const now = performance.now();
    drag.v = 0.8 * ((drag.lastY - y) / Math.max(1, now - drag.lastT)) + 0.2 * drag.v; // px/ms, + = nach oben
    drag.lastY = y; drag.lastT = now;
    if (Math.abs(y - drag.y0) > 5) drag.moved = true;
  }
  function end() {
    const s = snaps();
    let target;
    if (Math.abs(drag.v) > 0.45) {
      // Wischen: eine Stufe in Wischrichtung
      target = drag.v > 0
        ? ORDER.find((k) => s[k] > height + 8) || 'full'
        : [...ORDER].reverse().find((k) => s[k] < height - 8) || 'peek';
    } else {
      target = ORDER.reduce((best, k) => (Math.abs(s[k] - height) < Math.abs(s[best] - height) ? k : best), 'peek');
    }
    drag = null;
    snap(target, { reason: 'drag' });
  }

  for (const el of [grip, head, seg]) {
    el.addEventListener('pointerdown', (e) => {
      if (!mq.matches || e.button > 0) return;
      start(e.clientY);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      // Zeiger erst beim echten Ziehen festhalten – sonst kämen Klicks auf Knöpfe nicht an
      if (!drag.moved && Math.abs(e.clientY - drag.y0) > 5) el.setPointerCapture(e.pointerId);
      move(e.clientY);
    });
    const finish = (e) => {
      if (!drag) return;
      const tapped = !drag.moved;
      if (tapped) {
        drag = null;
        panel.classList.remove('sheet-dragging');
        // Antippen: Griff klappt um, Titel öffnet ein eingeklapptes Sheet
        if (el === grip) snap(state === 'peek' ? 'half' : state === 'half' ? 'peek' : 'half', { reason: 'tap' });
        else if (state === 'peek' && !e.target.closest('button')) snap('half', { reason: 'tap' });
      } else {
        end();
      }
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }

  // --- Ziehen im Inhalt: erst das Sheet bewegen, dann scrollen ----------------------
  panel.querySelectorAll('.panel-body').forEach((body) => {
    let t = null;
    body.addEventListener('touchstart', (e) => {
      if (!mq.matches || e.touches.length !== 1) { t = null; return; }
      t = { x: e.touches[0].clientX, y: e.touches[0].clientY, mode: null };
    }, { passive: true });
    body.addEventListener('touchmove', (e) => {
      if (!t) return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const dx = x - t.x, dy = y - t.y;
      if (!t.mode) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        const vertical = Math.abs(dy) > Math.abs(dx);
        const up = dy < 0;
        // nach oben: Sheet erst ganz aufziehen; nach unten: nur, wenn oben angekommen
        t.mode = vertical && ((up && state !== 'full') || (!up && body.scrollTop <= 0)) ? 'sheet' : 'scroll';
        if (t.mode === 'sheet') start(t.y);
      }
      if (t.mode === 'sheet') { e.preventDefault(); move(y); }
    }, { passive: false });
    const done = () => { if (t?.mode === 'sheet' && drag) end(); t = null; };
    body.addEventListener('touchend', done);
    body.addEventListener('touchcancel', done);
  });

  // Drehen, Fenstergröße, Wechsel zwischen Handy- und Desktop-Ansicht
  function relayout() {
    if (mq.matches) { if (!panel.hidden) snap(state, { animate: false, reason: 'resize' }); return; }
    panel.style.height = '';
    panel.classList.remove('sheet-dragging');
    delete panel.dataset.sheet;
    delete panel.dataset.h;
  }
  window.addEventListener('resize', relayout);
  mq.addEventListener('change', relayout);

  return {
    snap,
    get state() { return state; },
    /** Zähler, der sich bei jedem Einrasten ändert (um gleichzeitige Aktionen zu erkennen) */
    get stamp() { return stamp; },
    get isMobile() { return mq.matches; },
  };
}
