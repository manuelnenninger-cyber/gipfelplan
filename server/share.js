// Geteilte Touren: Linkseite mit Vorschau (Open Graph) und Vorschaubild.
// Läuft als Vercel-Funktion (api/share.js, api/share-image.js) und im Vite-Dev-Server.
// Messenger wie WhatsApp lesen die og:-Angaben der Seite /t/<id> und zeigen Titel,
// Beschreibung und Bild; Menschen werden per Skript direkt in die App weitergeleitet.
import { ACCOUNTS } from '../src/config.js';
import { fmtDuration, fmtKm, fmtInt, escapeHtml } from '../src/util/format.js';
import { decodePng, createCanvas, drawImage, strokeMask, circleMask, paint, fillRect, encodeJpeg } from './raster.js';

export const ID_RE = /^[A-Za-z0-9]{6,12}$/;
const UA = 'Gipfelplan/1.0 (+https://gipfelplan.vercel.app)';
export const IMAGE_W = 1200, IMAGE_H = 630;
const BAND = 112; // Höhenprofil unten

export async function fetchShare(id, { fetchFn = fetch } = {}) {
  if (!ID_RE.test(id || '')) return null;
  const res = await fetchFn(`${ACCOUNTS.url}/rest/v1/rpc/get_share`, {
    method: 'POST',
    headers: { apikey: ACCOUNTS.anonKey, Authorization: `Bearer ${ACCOUNTS.anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id }),
  });
  if (!res.ok) throw new Error(`Datenbank ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

const SAC_LABEL = (s) => (s >= 4 ? 'Schwer' : s === 3 ? 'Mittel' : s >= 1 ? 'Leicht' : null);

/** Titel und Beschreibung für die Vorschau */
export function shareTexts(share) {
  const st = share.stats || {};
  const peak = share.peak?.name;
  const title = peak && !share.title.includes(peak) ? `${peak}: ${share.title}` : share.title;
  const loop = share.kind === 'loop' || st.isLoop || st.oneWay;
  const parts = [];
  if (st.sac) parts.push(`${SAC_LABEL(st.sac)} (T${st.sac})`);
  const time = loop ? st.timeTotal : st.timeUp;
  if (time) parts.push(`${fmtDuration(time)}${loop ? '' : ' Aufstieg'}`);
  if (st.up) parts.push(`↑ ${fmtInt(Math.round(st.up))} m`);
  if (st.length) parts.push(fmtKm(st.length));
  const description = `${parts.join(' · ')}${parts.length ? ' – ' : ''}Route, Wetter, Lawinenlage und Startzeit in Gipfelplan ansehen.`;
  return { title, description };
}

/** HTML der Linkseite /t/<id> */
export function shareHtml(share, { id, origin }) {
  const { title, description } = shareTexts(share);
  const url = `${origin}/t/${id}`;
  const app = `/?t=${encodeURIComponent(id)}`;
  const e = escapeHtml;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} – Gipfelplan</title>
<meta name="description" content="${e(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gipfelplan">
<meta property="og:locale" content="de_DE">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${e(`${origin}/api/share-image?id=${id}`)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="${IMAGE_W}">
<meta property="og:image:height" content="${IMAGE_H}">
<meta property="og:image:alt" content="${e(`Karte der Tour ${title}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#2440be">
<link rel="icon" href="/icons/favicon-64.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px -apple-system,system-ui,sans-serif;background:#2440be;color:#fff;text-align:center}a{color:#fff}</style>
<script>location.replace(${JSON.stringify(app)});</script>
</head>
<body><p>Gipfelplan öffnet die Tour …<br><a href="${e(app)}">Tour öffnen</a></p></body>
</html>`;
}

export function notFoundHtml() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tour nicht gefunden – Gipfelplan</title><meta property="og:title" content="Gipfelplan"><meta property="og:description" content="Touren- und Wetterplanung für die Berge.">
<script>setTimeout(function(){location.replace('/')},2500)</script></head>
<body style="font:16px system-ui,sans-serif;text-align:center;padding:40px">Diese Tour gibt es nicht (mehr). <a href="/">Zu Gipfelplan</a></body></html>`;
}

// --- Vorschaubild -------------------------------------------------------------------
const lonX = (lng, z) => ((lng + 180) / 360) * 256 * 2 ** z;
const latY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z;
};
const hex = (c, fallback) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '') || /^#?([0-9a-f]{6})$/i.exec(fallback);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Zoomstufe, bei der die Tour mit Rand ins Bild passt */
export function fitZoom(coords, w, h, { maxZoom = 15, minZoom = 5 } = {}) {
  for (let z = maxZoom; z > minZoom; z--) {
    const xs = coords.map((c) => lonX(c[0], z)), ys = coords.map((c) => latY(c[1], z));
    if (Math.max(...xs) - Math.min(...xs) <= w && Math.max(...ys) - Math.min(...ys) <= h) return z;
  }
  return minZoom;
}

/** Ecken abrunden (Alpha) */
function roundCorners(img, r) {
  const { width: w, height: h, data } = img;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x < r ? r - x - 0.5 : x >= w - r ? x - (w - r) + 0.5 : 0;
    const dy = y < r ? r - y - 0.5 : y >= h - r ? y - (h - r) + 0.5 : 0;
    if (!dx || !dy) continue;
    const d = Math.hypot(dx, dy);
    if (d > r) data[(y * w + x) * 4 + 3] = Math.round(data[(y * w + x) * 4 + 3] * Math.max(0, 1 - (d - r)));
  }
  return img;
}

/**
 * Vorschaubild: Topo-Karte (OpenTopoMap) mit Route, Start, Gipfel, Höhenprofil und Logo.
 * @param fetchTile (z, x, y) → Promise<Buffer|null> (PNG)
 */
export async function renderShareImage(share, { fetchTile, logo = null }) {
  const W = IMAGE_W, H = IMAGE_H, mapH = H - BAND;
  const coords = share.coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  const z = fitZoom(coords, W - 220, mapH - 150);
  const xs = coords.map((c) => lonX(c[0], z)), ys = coords.map((c) => latY(c[1], z));
  const ox = (Math.min(...xs) + Math.max(...xs)) / 2 - W / 2;
  const oy = (Math.min(...ys) + Math.max(...ys)) / 2 - mapH / 2;
  const cv = createCanvas(W, H, [236, 238, 232]);

  // Kacheln laden und einsetzen
  const jobs = [];
  for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++) {
    for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++) {
      jobs.push(fetchTile(z, tx, ty).then((buf) => {
        if (!buf) return;
        try { drawImage(cv, decodePng(buf), Math.round(tx * 256 - ox), Math.round(ty * 256 - oy)); } catch { /* Kachel fehlt */ }
      }).catch(() => {}));
    }
  }
  await Promise.all(jobs);
  fillRect(cv, 0, 0, W, mapH, [255, 255, 255], 0.16); // Karte etwas aufhellen: Route sticht hervor, Bild wird kleiner

  // Route
  const color = hex(share.stats?.color, '#d6336c');
  const pts = coords.map((c, i) => [xs[i] - ox, ys[i] - oy]);
  paint(cv, strokeMask(cv, pts, 13), [255, 255, 255]);
  paint(cv, strokeMask(cv, pts, 7), color);
  const [sx, sy] = pts[0];
  paint(cv, circleMask(cv, sx, sy, 12), [255, 255, 255]);
  paint(cv, circleMask(cv, sx, sy, 8), color);
  let top = 0;
  coords.forEach((c, i) => { if ((c[2] ?? -1e9) > (coords[top][2] ?? -1e9)) top = i; });
  if (share.peak?.lat != null) {
    // Gipfelpunkt der Tour (nächster Punkt zum Gipfel)
    let best = Infinity;
    coords.forEach((c, i) => { const d = (c[0] - share.peak.lng) ** 2 + (c[1] - share.peak.lat) ** 2; if (d < best) { best = d; top = i; } });
  }
  const [px, py] = pts[top];
  paint(cv, circleMask(cv, px, py, 17), [255, 255, 255]);
  paint(cv, circleMask(cv, px, py, 13), [36, 64, 190]);
  paint(cv, circleMask(cv, px, py, 4.5), [255, 255, 255]);

  // Höhenprofil im unteren Band
  fillRect(cv, 0, mapH, W, BAND, [255, 255, 255], 1);
  fillRect(cv, 0, mapH, W, 1, [210, 214, 222], 1);
  const elev = coords.map((c) => c[2]).filter((v) => v != null);
  if (elev.length > 1) {
    let dist = [0];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      const dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), dy = (b[1] - a[1]) * 111320;
      dist.push(dist[i - 1] + Math.hypot(dx, dy));
    }
    const total = dist[dist.length - 1] || 1;
    const lo = Math.min(...elev), hi = Math.max(...elev), span = Math.max(1, hi - lo);
    const x0 = 150, x1 = W - 40, y0 = mapH + 18, y1 = H - 16;
    const prof = [];
    let last = elev[0];
    coords.forEach((c, i) => { if (c[2] != null) last = c[2]; prof.push([x0 + (dist[i] / total) * (x1 - x0), y1 - ((last - lo) / span) * (y1 - y0)]); });
    // Fläche unter dem Profil
    const mask = new Float32Array(W * H);
    for (let x = x0; x <= x1; x++) {
      let k = prof.findIndex((p) => p[0] >= x);
      if (k < 0) k = prof.length - 1;
      const a = prof[Math.max(0, k - 1)], b = prof[k];
      const t = b[0] > a[0] ? (x - a[0]) / (b[0] - a[0]) : 0;
      const yy = a[1] + (b[1] - a[1]) * t;
      for (let y = Math.ceil(yy); y <= y1; y++) mask[y * W + x] = 1;
    }
    paint(cv, mask, color, 0.18);
    paint(cv, strokeMask(cv, prof, 3), color);
  }

  // Logo unten links im Band
  if (logo) {
    try { drawImage(cv, roundCorners(decodePng(logo), 40), 24, mapH + (BAND - 96) / 2, { scale: 0.5 }); } catch { /* ohne Logo */ }
  }
  return encodeJpeg(cv, 74);
}

/** Kachel von OpenTopoMap (mit Zeitlimit) */
export async function fetchTopoTile(z, x, y) {
  const n = 2 ** z;
  const xx = ((x % n) + n) % n;
  if (y < 0 || y >= n) return null;
  const host = 'abc'[(xx + y) % 3];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`https://${host}.tile.opentopomap.org/${z}/${xx}/${y}.png`, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } finally {
    clearTimeout(t);
  }
}

// --- Gemeinsame Handler (Node-Request/Response, für Vercel und Vite) ------------------
const originOf = (req) => `${req.headers['x-forwarded-proto'] || (req.headers.host?.startsWith('localhost') ? 'http' : 'https')}://${req.headers['x-forwarded-host'] || req.headers.host}`;

export async function handleSharePage(req, res, id) {
  let share = null;
  try { share = await fetchShare(id); } catch (e) { res.statusCode = 502; res.end(`Fehler: ${e.message}`); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!share) { res.statusCode = 404; res.end(notFoundHtml()); return; }
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400');
  res.statusCode = 200;
  res.end(shareHtml(share, { id, origin: originOf(req) }));
}

export async function handleShareImage(req, res, id) {
  let share = null;
  try { share = await fetchShare(id); } catch { /* unten 404 */ }
  if (!share) { res.statusCode = 404; res.end('Nicht gefunden'); return; }
  let logo = null;
  try {
    const r = await fetch(`${originOf(req)}/icons/icon-192.png`);
    if (r.ok) logo = Buffer.from(await r.arrayBuffer());
  } catch { /* ohne Logo */ }
  const jpg = await renderShareImage(share, { fetchTile: fetchTopoTile, logo });
  res.setHeader('Content-Type', 'image/jpeg');
  // geteilte Touren ändern sich nicht → lange zwischenspeichern
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
  res.statusCode = 200;
  res.end(jpg);
}
