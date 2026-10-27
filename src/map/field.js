// Reine Rechenlogik für die Wetterkarte (ohne DOM), damit sie testbar bleibt.
import { latToMercY, mercYToLat } from '../util/geo.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Werte eines Layers zum (gebrochenen) Zeitindex tf, als Gitter nx*ny */
export function sliceAt(grid, key, tf) {
  const { nx, ny, times } = grid;
  const n = nx * ny;
  const T = times.length;
  const t0 = clamp(Math.floor(tf), 0, T - 1);
  const t1 = Math.min(T - 1, t0 + 1);
  const a = clamp(tf - t0);
  const src = grid.layers[key];
  const out = new Float32Array(n);
  const o0 = t0 * n, o1 = t1 * n;
  for (let k = 0; k < n; k++) out[k] = lerp(src[o0 + k], src[o1 + k], a);
  return out;
}

/** Nächster ganzzahliger Zeitpunkt (für Kategorien wie Wettercodes) */
export function sliceNearest(grid, key, tf) {
  const n = grid.nx * grid.ny;
  const t = clamp(Math.round(tf), 0, grid.times.length - 1);
  return grid.layers[key].subarray(t * n, (t + 1) * n);
}

/** Bilineare Interpolation im Gitter an Gitterkoordinate (gx, gy) */
export function bilinear(vals, nx, ny, gx, gy) {
  const x0 = clamp(Math.floor(gx), 0, nx - 1), y0 = clamp(Math.floor(gy), 0, ny - 1);
  const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1);
  const fx = clamp(gx - x0), fy = clamp(gy - y0);
  const a = vals[y0 * nx + x0], b = vals[y0 * nx + x1];
  const c = vals[y1 * nx + x0], d = vals[y1 * nx + x1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Geografische Position → Gitterkoordinate */
export function geoToGrid(grid, lng, lat) {
  return {
    gx: ((lng - grid.w) / (grid.e - grid.w)) * (grid.nx - 1),
    gy: ((grid.n - lat) / (grid.n - grid.s)) * (grid.ny - 1),
  };
}

/**
 * Catmull-Rom-Gewichte und Indizes je Bildspalte bzw. -zeile vorberechnen.
 * Dann kostet ein bikubischer Wert pro Pixel nur noch 16 Multiplikationen.
 */
export function axisCR(gs, n) {
  const len = gs.length;
  const idx = new Int32Array(len * 4);
  const w = new Float32Array(len * 4);
  for (let k = 0; k < len; k++) {
    const g = gs[k];
    const i1 = Math.min(n - 1, Math.max(0, Math.floor(g)));
    const t = Math.min(1, Math.max(0, g - i1));
    const t2 = t * t, t3 = t2 * t;
    idx[k * 4] = Math.max(0, i1 - 1);
    idx[k * 4 + 1] = i1;
    idx[k * 4 + 2] = Math.min(n - 1, i1 + 1);
    idx[k * 4 + 3] = Math.min(n - 1, i1 + 2);
    w[k * 4] = 0.5 * (-t3 + 2 * t2 - t);
    w[k * 4 + 1] = 0.5 * (3 * t3 - 5 * t2 + 2);
    w[k * 4 + 2] = 0.5 * (-3 * t3 + 4 * t2 + t);
    w[k * 4 + 3] = 0.5 * (t3 - t2);
  }
  return { idx, w };
}

/**
 * Erster Durchgang der trennbaren Interpolation: jede Rasterzeile auf die
 * Bildbreite W interpolieren. Ergebnis: ny × W Werte.
 */
function horizontalPass(vals, nx, ny, ax, W) {
  const H = new Float32Array(ny * W);
  for (let r = 0; r < ny; r++) {
    const row = r * nx, o = r * W;
    for (let x = 0, xi = 0; x < W; x++, xi += 4) {
      H[o + x] = ax.w[xi] * vals[row + ax.idx[xi]] + ax.w[xi + 1] * vals[row + ax.idx[xi + 1]] +
        ax.w[xi + 2] * vals[row + ax.idx[xi + 2]] + ax.w[xi + 3] * vals[row + ax.idx[xi + 3]];
    }
  }
  return H;
}

/** Für jedes Pixel des Overlay-Bildes die Gitterkoordinate vorberechnen (Mercator-treu) */
export function pixelLookup(grid, W, H) {
  const gxs = new Float32Array(W), lngs = new Float32Array(W);
  const gys = new Float32Array(H), lats = new Float32Array(H);
  for (let x = 0; x < W; x++) {
    const lng = grid.w + ((x + 0.5) / W) * (grid.e - grid.w);
    lngs[x] = lng;
    gxs[x] = ((lng - grid.w) / (grid.e - grid.w)) * (grid.nx - 1);
  }
  const yN = latToMercY(grid.n), yS = latToMercY(grid.s);
  for (let y = 0; y < H; y++) {
    const lat = mercYToLat(yN + ((y + 0.5) / H) * (yS - yN));
    lats[y] = lat;
    gys[y] = ((grid.n - lat) / (grid.n - grid.s)) * (grid.ny - 1);
  }
  return { gxs, gys, lngs, lats, ax: axisCR(gxs, grid.nx), ay: axisCR(gys, grid.ny) };
}

// --- Farbskalen ----------------------------------------------------------------
// Stopps: [Wert, r, g, b, a]
/** Ab dieser Menge (mm/h) gilt es als Niederschlag – mit Randlinie markiert */
export const PRECIP_MIN = 0.1;

export const SCALES = {
  // Schon schwacher Regen (0,1 mm/h) ist kräftig blau – nie mit Wolken zu verwechseln
  rain: [[0.06, 0, 160, 255, 0], [0.1, 0, 165, 255, 0.82], [0.5, 0, 120, 255, 0.88], [1.5, 20, 70, 235, 0.92], [4, 80, 40, 205, 0.94], [10, 200, 30, 160, 0.95], [25, 245, 40, 90, 0.96]],
  // Schnee pink/magenta, damit er sich von weißen Wolken abhebt
  snow: [[0.06, 255, 120, 220, 0], [0.1, 255, 125, 225, 0.82], [0.6, 235, 85, 215, 0.88], [1.5, 195, 55, 205, 0.92], [4, 150, 35, 185, 0.94]],
  thunder: [[0.06, 255, 214, 10, 0], [0.12, 255, 214, 10, 0.38], [0.4, 255, 150, 0, 0.6], [0.75, 255, 59, 48, 0.75], [1, 200, 30, 120, 0.82]],
  wind: [[5, 120, 200, 190, 0], [12, 120, 200, 190, 0.22], [25, 80, 185, 140, 0.4], [40, 240, 205, 60, 0.5], [60, 250, 140, 40, 0.58], [80, 235, 60, 60, 0.64], [110, 170, 40, 160, 0.7]],
};

export function colorAt(scale, v, out) {
  if (v <= scale[0][0]) { out[0] = scale[0][1]; out[1] = scale[0][2]; out[2] = scale[0][3]; out[3] = 0; return out; }
  for (let i = 1; i < scale.length; i++) {
    if (v <= scale[i][0]) {
      const p = scale[i - 1], q = scale[i];
      const t = (v - p[0]) / (q[0] - p[0]);
      out[0] = lerp(p[1], q[1], t); out[1] = lerp(p[2], q[2], t); out[2] = lerp(p[3], q[3], t); out[3] = lerp(p[4], q[4], t);
      return out;
    }
  }
  const l = scale[scale.length - 1];
  out[0] = l[1]; out[1] = l[2]; out[2] = l[3]; out[3] = l[4];
  return out;
}

/** Gewitterrisiko 0…1 aus CAPE, Niederschlag und (optional) Wettercode */
export function thunderRisk(cape, precip, code = 0) {
  let r = clamp((cape - 150) / 1350) * clamp(precip / 1.0 + 0.25);
  if (code >= 95) r = Math.max(r, 0.85);
  return r;
}

/**
 * Bikubische Interpolation (Catmull-Rom). Ergibt weiche, aber scharf
 * gezeichnete Übergänge statt der rautenförmigen Kanten der bilinearen Variante.
 */
function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
export function bicubic(vals, nx, ny, gx, gy) {
  const x1 = clamp(Math.floor(gx), 0, nx - 1), y1 = clamp(Math.floor(gy), 0, ny - 1);
  const fx = clamp(gx - x1), fy = clamp(gy - y1);
  const xs = [Math.max(0, x1 - 1), x1, Math.min(nx - 1, x1 + 1), Math.min(nx - 1, x1 + 2)];
  const ys = [Math.max(0, y1 - 1), y1, Math.min(ny - 1, y1 + 1), Math.min(ny - 1, y1 + 2)];
  const row = (y) => cr(vals[y * nx + xs[0]], vals[y * nx + xs[1]], vals[y * nx + xs[2]], vals[y * nx + xs[3]], fx);
  const v = cr(row(ys[0]), row(ys[1]), row(ys[2]), row(ys[3]), fy);
  return v < 0 ? 0 : v;
}

const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };

/**
 * Gewicht 0…1 eines Detailgebiets an (lng, lat), mit weich auslaufendem Rand.
 * Das Detailraster wird damit eingeblendet, das Regionalraster entsprechend ausgeblendet.
 */
export function featherWeight(b, lng, lat, feather = 0.18) {
  if (!b || lng <= b.w || lng >= b.e || lat <= b.s || lat >= b.n) return 0;
  const fx = (b.e - b.w) * feather, fy = (b.n - b.s) * feather;
  return smooth(Math.min(lng - b.w, b.e - lng) / fx) * smooth(Math.min(lat - b.s, b.n - lat) / fy);
}

// Wolkenstockwerke: tiefe Wolken dicht und grauer, hohe Wolken dünn und weiß.
// So sieht man, ob Gipfel und Täler im Nebel stecken oder nur Schleierwolken ziehen.
export const CLOUD_LEVELS = [
  { key: 'cl', rgb: [247, 249, 252], max: 0.95 }, // tief (bis ca. 2 km): dicht und hell – Nebel, Gipfel in Wolken
  { key: 'cm', rgb: [176, 196, 226], max: 0.68 }, // mittel (2–6 km): bläulich
  { key: 'ch', rgb: [214, 200, 240], max: 0.32 }, // hoch: dünner, violetter Schleier
];

/** Wolkenwerte (tief, mittel, hoch in %) zu Farbe + Deckkraft zusammensetzen (tief unten, hoch oben) */
const CL0 = CLOUD_LEVELS[0], CL1 = CLOUD_LEVELS[1], CL2 = CLOUD_LEVELS[2];
// Neutrale Grautöne für Wolken unter dem Niederschlag – dort steht Farbe nur für Niederschlag
const NEUTRAL = [[206, 209, 214], [224, 226, 229], [240, 241, 243]];
function cloudsGrey(vl, vm, vh, scale, out) {
  let r = 0, g = 0, b = 0, a = 0, la;
  const vals = [vl, vm, vh], max = [CL0.max, CL1.max * 0.8, CL2.max * 0.7];
  for (let i = 0; i < 3; i++) {
    la = smooth((vals[i] - 8) / 82) * max[i] * scale;
    if (la <= 0) continue;
    const k = 1 - la, c = NEUTRAL[i];
    r = c[0] * la + r * k; g = c[1] * la + g * k; b = c[2] * la + b * k; a = la + a * k;
  }
  if (a > 0) { out[0] = r / a; out[1] = g / a; out[2] = b / a; } else { out[0] = out[1] = out[2] = 255; }
  out[3] = a;
  return out;
}

function cloudsColor(vl, vm, vh, scale, out) {
  let r = 0, g = 0, b = 0, a = 0, la;
  la = smooth((vl - 8) / 82) * CL0.max * scale;
  if (la > 0) { r = CL0.rgb[0] * la; g = CL0.rgb[1] * la; b = CL0.rgb[2] * la; a = la; }
  la = smooth((vm - 8) / 82) * CL1.max * scale;
  if (la > 0) { const k = 1 - la; r = CL1.rgb[0] * la + r * k; g = CL1.rgb[1] * la + g * k; b = CL1.rgb[2] * la + b * k; a = la + a * k; }
  la = smooth((vh - 8) / 82) * CL2.max * scale;
  if (la > 0) { const k = 1 - la; r = CL2.rgb[0] * la + r * k; g = CL2.rgb[1] * la + g * k; b = CL2.rgb[2] * la + b * k; a = la + a * k; }
  if (a > 0) { out[0] = r / a; out[1] = g / a; out[2] = b / a; } else { out[0] = out[1] = out[2] = 255; }
  out[3] = a;
  return out;
}

// Welche Größen braucht welche Ebene?
const KEYS = {
  clouds: ['cl', 'cm', 'ch'],
  precip: ['precip', 'snow', 'cl', 'cm', 'ch'],
  thunder: ['thunder'],
  wind: ['wind'],
};

/** Ein Durchgang 3×3-Glättung ([1 2 1]-Kern), Ränder werden fortgesetzt */
export function blur3(src, nx, ny) {
  const out = new Float32Array(src.length);
  const at = (x, y) => src[Math.min(ny - 1, Math.max(0, y)) * nx + Math.min(nx - 1, Math.max(0, x))];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      out[y * nx + x] = (
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) +
        2 * at(x - 1, y) + 4 * at(x, y) + 2 * at(x + 1, y) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) / 16;
    }
  }
  return out;
}

/**
 * Nach etwa 2 Tagen wechselt die Prognose vom 2-km-Modell (ICON-D2) auf gröbere
 * Modelle (ICON-EU, 7 km). Deren Zellen würden als Kacheln sichtbar, deshalb wird
 * ab dann zunehmend geglättet. Rückgabe: Anteil 0…1.
 */
export function coarseBlend(hoursAhead) { return smooth((hoursAhead - 42) / 10); }

/** Werte aller benötigten Größen zum Zeitpunkt tf als Gitter vorbereiten */
function prepare(grid, layer, tf, windLevel) {
  const n = grid.nx * grid.ny;
  const out = {};
  const hoursAhead = (grid.times[0] + tf * 3600000 - Date.now()) / 3600000;
  const m = coarseBlend(hoursAhead);
  for (const k of KEYS[layer]) {
    if (k === 'thunder') {
      const cape = sliceAt(grid, 'cape', tf), pr = sliceAt(grid, 'precip', tf);
      const code = grid.layers.code ? sliceNearest(grid, 'code', tf) : null;
      const A = new Float32Array(n);
      for (let i = 0; i < n; i++) A[i] = thunderRisk(cape[i], pr[i], code ? code[i] : 0);
      out.thunder = A;
    } else if (k === 'wind') {
      const suffix = windLevel === '700hPa' ? '700' : '10';
      const u = sliceAt(grid, `u${suffix}`, tf), v = sliceAt(grid, `v${suffix}`, tf);
      const A = new Float32Array(n);
      for (let i = 0; i < n; i++) A[i] = Math.hypot(u[i], v[i]);
      out.wind = A;
    } else {
      out[k] = sliceAt(grid, k, tf);
    }
    if (m > 0.01) {
      const b = blur3(blur3(out[k], grid.nx, grid.ny), grid.nx, grid.ny);
      const a = out[k];
      for (let i = 0; i < n; i++) a[i] += (b[i] - a[i]) * m;
    }
  }
  return out;
}

/**
 * Lookup für ein Detailraster innerhalb des Bildes: Gitterkoordinaten und
 * Überblendgewicht (trennbar in x und y), damit pro Pixel nur multipliziert wird.
 */
export function detailLookup(lookup, d, feather = 0.25) {
  const W = lookup.lngs.length, H = lookup.lats.length;
  const gx = new Float32Array(W), wx = new Float32Array(W);
  const gy = new Float32Array(H), wy = new Float32Array(H);
  const fx = (d.e - d.w) * feather, fy = (d.n - d.s) * feather;
  for (let x = 0; x < W; x++) {
    const lng = lookup.lngs[x];
    gx[x] = ((lng - d.w) / (d.e - d.w)) * (d.nx - 1);
    wx[x] = lng <= d.w || lng >= d.e ? 0 : smooth(Math.min(lng - d.w, d.e - lng) / fx);
  }
  for (let y = 0; y < H; y++) {
    const lat = lookup.lats[y];
    gy[y] = ((d.n - lat) / (d.n - d.s)) * (d.ny - 1);
    wy[y] = lat <= d.s || lat >= d.n ? 0 : smooth(Math.min(lat - d.s, d.n - lat) / fy);
  }
  return { gx, gy, wx, wy, ax: axisCR(gx, d.nx), ay: axisCR(gy, d.ny) };
}

/**
 * Zeichnet ein Wetterfeld in ImageData (W×H, deckt die Gitter-Bounds ab).
 * layer: 'clouds' | 'precip' | 'thunder' | 'wind'
 * opts.detail = { grid, tf, lookup }: feineres Raster, dessen Werte in seinem Gebiet
 * weich mit dem Grundraster gemischt werden – auf Werteebene, daher ohne sichtbare Kante.
 */
export function renderField(img, grid, lookup, layer, tf, opts = {}) {
  const { width: W, height: H, data } = img;
  const { nx } = grid;
  const { ax, ay } = lookup;
  const keys = KEYS[layer];
  const R = prepare(grid, layer, tf, opts.windLevel);
  const det = opts.detail || null;
  const D = det ? prepare(det.grid, layer, det.tf, opts.windLevel) : null;
  const dl = det ? det.lookup : null;
  const nk = keys.length;
  // trennbare Interpolation: Zeilen vorab, pro Pixel nur noch 4 Werte senkrecht
  const RK = keys.map((k) => horizontalPass(R[k], nx, grid.ny, ax, W));
  const DK = D ? keys.map((k) => horizontalPass(D[k], det.grid.nx, det.grid.ny, dl.ax, W)) : null;
  const ayw = ay.w, ayi = ay.idx;
  const v = new Float64Array(nk);
  const c = [0, 0, 0, 0];
  const cc = [0, 0, 0, 0];

  // Niederschlagsmenge je Pixel merken (für die Randlinie); negativ = Schnee
  const pv = layer === 'precip' ? new Float32Array(W * H) : null;
  let p = 0;
  for (let y = 0; y < H; y++) {
    const wyd = dl ? dl.wy[y] : 0;
    const yi = y * 4;
    const r0 = ayi[yi] * W, r1 = ayi[yi + 1] * W, r2 = ayi[yi + 2] * W, r3 = ayi[yi + 3] * W;
    const w0 = ayw[yi], w1 = ayw[yi + 1], w2 = ayw[yi + 2], w3 = ayw[yi + 3];
    let d0 = 0, d1 = 0, d2 = 0, d3 = 0, dw0 = 0, dw1 = 0, dw2 = 0, dw3 = 0;
    if (wyd) {
      d0 = dl.ay.idx[yi] * W; d1 = dl.ay.idx[yi + 1] * W; d2 = dl.ay.idx[yi + 2] * W; d3 = dl.ay.idx[yi + 3] * W;
      dw0 = dl.ay.w[yi]; dw1 = dl.ay.w[yi + 1]; dw2 = dl.ay.w[yi + 2]; dw3 = dl.ay.w[yi + 3];
    }
    for (let x = 0; x < W; x++, p += 4) {
      const w = wyd ? wyd * dl.wx[x] : 0;
      for (let i = 0; i < nk; i++) {
        const A = RK[i];
        let a = w0 * A[r0 + x] + w1 * A[r1 + x] + w2 * A[r2 + x] + w3 * A[r3 + x];
        if (a < 0) a = 0;
        if (w > 0) {
          const B = DK[i];
          let b = dw0 * B[d0 + x] + dw1 * B[d1 + x] + dw2 * B[d2 + x] + dw3 * B[d3 + x];
          if (b < 0) b = 0;
          a += (b - a) * w;
        }
        v[i] = a;
      }
      if (layer === 'clouds') {
        cloudsColor(v[0], v[1], v[2], 1, c);
      } else if (layer === 'precip') {
        const pr = v[0], sn = v[1];
        const frac = pr > 0.02 ? clamp((sn / 0.7) / pr) : 0; // Schneeanteil
        if (frac < 0.5) colorAt(SCALES.rain, pr, c); else colorAt(SCALES.snow, pr, c);
        pv[p >> 2] = frac < 0.5 ? pr : -pr;
        // Wolken (neutral grau) darunter, Niederschlag darüber
        cloudsGrey(v[2], v[3], v[4], 0.55, cc);
        const pa = c[3], ca = cc[3];
        const a = pa + ca * (1 - pa);
        if (a > 0) {
          const k = ca * (1 - pa);
          c[0] = (c[0] * pa + cc[0] * k) / a;
          c[1] = (c[1] * pa + cc[1] * k) / a;
          c[2] = (c[2] * pa + cc[2] * k) / a;
        }
        c[3] = a;
      } else if (layer === 'thunder') {
        colorAt(SCALES.thunder, v[0], c);
      } else {
        colorAt(SCALES.wind, v[0], c);
      }
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = c[3] * 255;
    }
  }
  if (pv) outlinePrecip(data, pv, W, H);
  return img;
}

/**
 * Randlinie um Niederschlagsgebiete: Pixel mit Niederschlag, deren Nachbar trocken
 * ist, bekommen eine dunkle, deckende Kontur. So ist sofort klar, wo es regnet.
 */
function outlinePrecip(data, pv, W, H) {
  const wet = (i) => Math.abs(pv[i]) >= PRECIP_MIN;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!wet(i)) continue;
      if (wet(i - 1) && wet(i + 1) && wet(i - W) && wet(i + W)) continue;
      const p = i * 4;
      if (pv[i] < 0) { data[p] = 120; data[p + 1] = 20; data[p + 2] = 140; } // Schnee
      else { data[p] = 0; data[p + 1] = 55; data[p + 2] = 170; }             // Regen
      data[p + 3] = 245;
    }
  }
}

/**
 * Werte aller Wettergrößen an einem Ort (für die Anzeige unter dem Mauszeiger).
 * Mischt wie die Karte das Detailraster weich ein.
 */
export function probe(grid, tf, lng, lat, detail = null, td = 0) {
  const at = (g, t, key) => {
    if (!g.layers[key]) return 0;
    const { gx, gy } = geoToGrid(g, lng, lat);
    if (gx < 0 || gy < 0 || gx > g.nx - 1 || gy > g.ny - 1) return null;
    return bilinear(sliceAt(g, key, t), g.nx, g.ny, gx, gy);
  };
  const keys = ['precip', 'snow', 'cl', 'cm', 'ch', 'cape', 'u10', 'v10', 'u700', 'v700'];
  const out = {};
  const w = detail ? featherWeight(detail, lng, lat) : 0;
  for (const k of keys) {
    let v = at(grid, tf, k);
    if (v == null) return null;
    if (w > 0) { const d = at(detail, td, k); if (d != null) v += (d - v) * w; }
    out[k] = v;
  }
  return out;
}
