import { fmtInt } from '../util/format.js';

const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** Höhenprofil als SVG, mit Fadenkreuz, das die Position auf der Karte zeigt */
export function renderProfile(container, route, { onHover } = {}) {
  const W = Math.max(280, container.clientWidth || 340);
  const H = 140;
  const m = { l: 38, r: 10, t: 14, b: 22 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  // Auf ~300 Punkte reduzieren
  const step = Math.max(1, Math.floor(route.coords.length / 300));
  const pts = [];
  for (let i = 0; i < route.coords.length; i += step) {
    if (route.coords[i][2] != null) pts.push({ i, d: route.dist[i], e: route.coords[i][2] });
  }
  const last = route.coords.length - 1;
  if (pts.length && pts[pts.length - 1].i !== last && route.coords[last][2] != null) {
    pts.push({ i: last, d: route.dist[last], e: route.coords[last][2] });
  }
  if (pts.length < 2) { container.innerHTML = '<p class="muted small">Kein Höhenprofil verfügbar.</p>'; return; }

  const dMax = pts[pts.length - 1].d || 1;
  let eMin = Math.min(...pts.map((p) => p.e)), eMax = Math.max(...pts.map((p) => p.e));
  const span = eMax - eMin;
  const tick = span > 1200 ? 500 : span > 500 ? 200 : 100;
  eMin = Math.floor(eMin / tick) * tick;
  eMax = Math.ceil(eMax / tick) * tick;
  if (eMax === eMin) eMax += tick;

  const x = (d) => m.l + (d / dMax) * iw;
  const y = (e) => m.t + (1 - (e - eMin) / (eMax - eMin)) * ih;

  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`).join('');
  const area = `${line}L${x(dMax).toFixed(1)},${m.t + ih}L${m.l},${m.t + ih}Z`;
  const gid = `pg-${route.id.replace(/\W/g, '')}`;

  let grid = '';
  for (let e = eMin; e <= eMax; e += tick) {
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(e)}" y2="${y(e)}" class="pf-grid"/>`;
    grid += `<text x="${m.l - 6}" y="${y(e) + 3.5}" class="pf-label" text-anchor="end">${fmtInt(e)}</text>`;
  }
  const kmTicks = [0, dMax / 2, dMax];
  const xl = kmTicks
    .map((d, k) => `<text x="${x(d)}" y="${H - 6}" class="pf-label" text-anchor="${['start', 'middle', 'end'][k]}">${nf1.format(d / 1000)} km</text>`)
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="profile-svg" role="img"
         aria-label="Höhenprofil von ${fmtInt(pts[0].e)} m bis ${fmtInt(pts[pts.length - 1].e)} m">
      <defs>
        <linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="${route.color}" stop-opacity="0.32"/>
          <stop offset="1" stop-color="${route.color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line}" fill="none" stroke="${route.color}" stroke-width="2" stroke-linejoin="round"/>
      ${xl}
      <g class="pf-cursor" visibility="hidden">
        <line class="pf-cursor-line" y1="${m.t}" y2="${m.t + ih}"/>
        <circle r="4.5" fill="#fff" stroke="${route.color}" stroke-width="2.5"/>
        <text class="pf-tip" y="${m.t - 3}" text-anchor="middle"></text>
      </g>
      <rect x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent" class="pf-hit"/>
    </svg>`;

  const svg = container.querySelector('svg');
  const cursor = svg.querySelector('.pf-cursor');
  const cLine = cursor.querySelector('line');
  const cDot = cursor.querySelector('circle');
  const cTip = cursor.querySelector('text');
  const hit = svg.querySelector('.pf-hit');

  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const d = Math.max(0, Math.min(dMax, ((px - m.l) / iw) * dMax));
    // nächster Punkt
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.d - d) < Math.abs(best.d - d)) best = p;
    const cx = x(best.d), cy = y(best.e);
    cursor.setAttribute('visibility', 'visible');
    cLine.setAttribute('x1', cx); cLine.setAttribute('x2', cx);
    cDot.setAttribute('cx', cx); cDot.setAttribute('cy', cy);
    cTip.setAttribute('x', Math.min(W - m.r - 50, Math.max(m.l + 50, cx)));
    cTip.textContent = `${nf1.format(best.d / 1000)} km, ${fmtInt(best.e)} m`;
    onHover?.(route.coords[best.i]);
  };
  const leave = () => { cursor.setAttribute('visibility', 'hidden'); onHover?.(null); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}
