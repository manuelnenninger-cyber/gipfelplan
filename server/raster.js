// Kleine Bildwerkzeuge für den Server, ohne Abhängigkeiten: PNG lesen (Kartenkacheln),
// Linien/Flächen zeichnen und als JPEG speichern (Vorschaubild für geteilte Touren).
import { inflateSync } from 'node:zlib';

// --- PNG lesen (8 Bit, ohne Interlacing; Graustufen, RGB, Palette, mit/ohne Alpha) ---
export function decodePng(buf) {
  buf = Buffer.from(buf);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Kein PNG');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const typ = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (typ === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (typ === 'PLTE') palette = data;
    else if (typ === 'tRNS') trns = data;
    else if (typ === 'IDAT') idat.push(data);
    else if (typ === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error('PNG-Format nicht unterstützt');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const stride = w * ch;
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(h * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (type === 3) {
      const k = px[i];
      r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2];
      if (trns && k < trns.length) a = trns[k];
    } else if (type === 2) { r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]; }
    else if (type === 6) { r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; a = px[i * 4 + 3]; }
    else if (type === 0) { r = g = b = px[i]; }
    else { r = g = b = px[i * 2]; a = px[i * 2 + 1]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { width: w, height: h, data: rgba };
}

// --- Zeichenfläche (RGB) ------------------------------------------------------------
export function createCanvas(width, height, [r, g, b] = [240, 240, 236]) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) { data[i * 3] = r; data[i * 3 + 1] = g; data[i * 3 + 2] = b; }
  return { width, height, data };
}

/** RGBA-Bild an Stelle (dx, dy) einsetzen (mit Alpha); scale = 0.5 halbiert (2×2-Mittel) */
export function drawImage(cv, img, dx, dy, { scale = 1 } = {}) {
  const k = Math.round(1 / scale);
  const w = Math.floor(img.width / k), h = Math.floor(img.height / k);
  for (let y = 0; y < h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= cv.height) continue;
    for (let x = 0; x < w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= cv.width) continue;
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
        const s = ((y * k + j) * img.width + (x * k + i)) * 4;
        const al = img.data[s + 3];
        r += img.data[s] * al; g += img.data[s + 1] * al; b += img.data[s + 2] * al; a += al;
      }
      if (!a) continue;
      const o = (ty * cv.width + tx) * 3, al = a / (k * k * 255);
      cv.data[o] = Math.round(cv.data[o] * (1 - al) + (r / a) * al);
      cv.data[o + 1] = Math.round(cv.data[o + 1] * (1 - al) + (g / a) * al);
      cv.data[o + 2] = Math.round(cv.data[o + 2] * (1 - al) + (b / a) * al);
    }
  }
}

/** Deckungsmaske einer Linie (geglättete Kanten), Werte 0–1 */
export function strokeMask(cv, pts, width) {
  const m = new Float32Array(cv.width * cv.height);
  const hw = width / 2;
  for (let s = 1; s < pts.length; s++) {
    const [x1, y1] = pts[s - 1], [x2, y2] = pts[s];
    const minX = Math.max(0, Math.floor(Math.min(x1, x2) - hw - 1)), maxX = Math.min(cv.width - 1, Math.ceil(Math.max(x1, x2) + hw + 1));
    const minY = Math.max(0, Math.floor(Math.min(y1, y2) - hw - 1)), maxY = Math.min(cv.height - 1, Math.ceil(Math.max(y1, y2) + hw + 1));
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
        const c = Math.min(1, Math.max(0, hw + 0.5 - d));
        const i = y * cv.width + x;
        if (c > m[i]) m[i] = c;
      }
    }
  }
  return m;
}

/** Kreis als Maske */
export function circleMask(cv, cx, cy, r) {
  const m = new Float32Array(cv.width * cv.height);
  for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(cv.height - 1, Math.ceil(cy + r + 1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(cv.width - 1, Math.ceil(cx + r + 1)); x++) {
      m[y * cv.width + x] = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
    }
  }
  return m;
}

/** Farbe mit Maske auftragen */
export function paint(cv, mask, [r, g, b], opacity = 1) {
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i] * opacity;
    if (!a) continue;
    const o = i * 3;
    cv.data[o] = Math.round(cv.data[o] * (1 - a) + r * a);
    cv.data[o + 1] = Math.round(cv.data[o + 1] * (1 - a) + g * a);
    cv.data[o + 2] = Math.round(cv.data[o + 2] * (1 - a) + b * a);
  }
}

/** Rechteck füllen (halbdurchsichtig möglich) */
export function fillRect(cv, x0, y0, w, h, [r, g, b], a = 1) {
  for (let y = Math.max(0, y0); y < Math.min(cv.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(cv.width, x0 + w); x++) {
      const o = (y * cv.width + x) * 3;
      cv.data[o] = Math.round(cv.data[o] * (1 - a) + r * a);
      cv.data[o + 1] = Math.round(cv.data[o + 1] * (1 - a) + g * a);
      cv.data[o + 2] = Math.round(cv.data[o + 2] * (1 - a) + b * a);
    }
  }
}

// --- JPEG speichern (Baseline, 4:4:4, optimierte Huffman-Tabellen) ---------------------
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const QY = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array(32).fill(99)];
const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: 8 }, (_, x) => (u ? Math.sqrt(2 / 8) : Math.sqrt(1 / 8)) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)));

const scaleQ = (base, q) => {
  const s = q < 50 ? 5000 / q : 200 - 2 * q;
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))));
};
const category = (v) => (v === 0 ? 0 : 32 - Math.clz32(Math.abs(v)));

/** Optimale Huffman-Codelängen nach JPEG-Norm (Anhang K.2), höchstens 16 Bit */
export function huffmanTable(freqIn) {
  const freq = [...freqIn, 1]; // Platzhalter, damit kein Code nur aus Einsen besteht
  const size = new Array(257).fill(0), others = new Array(257).fill(-1);
  for (;;) {
    let c1 = -1, c2 = -1, v = Infinity;
    for (let i = 0; i <= 256; i++) if (freq[i] > 0 && freq[i] <= v) { v = freq[i]; c1 = i; }
    v = Infinity;
    for (let i = 0; i <= 256; i++) if (freq[i] > 0 && freq[i] <= v && i !== c1) { v = freq[i]; c2 = i; }
    if (c2 < 0) break;
    freq[c1] += freq[c2]; freq[c2] = 0;
    size[c1]++; while (others[c1] >= 0) { c1 = others[c1]; size[c1]++; }
    others[c1] = c2;
    size[c2]++; while (others[c2] >= 0) { c2 = others[c2]; size[c2]++; }
  }
  const bits = new Array(40).fill(0);
  for (let i = 0; i <= 256; i++) if (size[i]) bits[size[i]]++;
  for (let i = 39; i > 16; i--) {
    while (bits[i] > 0) {
      let j = i - 2;
      while (bits[j] === 0) j--;
      bits[i] -= 2; bits[i - 1]++; bits[j + 1] += 2; bits[j]--;
    }
  }
  let i = 16;
  while (bits[i] === 0) i--;
  bits[i]--; // Platzhalter wieder entfernen
  const vals = [];
  for (let len = 1; len < 40; len++) for (let s = 0; s < 256; s++) if (size[s] === len) vals.push(s);
  const table = { bits: bits.slice(1, 17), vals, code: new Int32Array(256), len: new Int32Array(256) };
  let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let n = 0; n < table.bits[l - 1]; n++) { table.code[vals[k]] = code; table.len[vals[k]] = l; code++; k++; }
    code <<= 1;
  }
  return table;
}

/**
 * JPEG mit Farbunterabtastung 4:2:0 (Helligkeit voll, Farbe halb aufgelöst – wie Kameras);
 * deutlich kleiner, wichtig für Vorschaubilder in Messengern.
 */
export function encodeJpeg(cv, quality = 78) {
  const { width: W, height: H } = cv;
  const q = [scaleQ(QY, quality), scaleQ(QC, quality)];
  const mw = Math.ceil(W / 16), mh = Math.ceil(H / 16);
  const nBlocks = mw * mh * 6; // je MCU: 4 × Helligkeit, 1 × Cb, 1 × Cr
  const blocks = new Int16Array(nBlocks * 64);
  const comp = new Uint8Array(nBlocks);
  const f = new Float32Array(64), tmp = new Float32Array(64);
  const px = (x, y) => (Math.min(H - 1, y) * W + Math.min(W - 1, x)) * 3;
  const fdct = (bi, c) => {
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += COS[u][x] * f[y * 8 + x];
      tmp[y * 8 + u] = s;
    }
    const qt = q[c ? 1 : 0];
    for (let k = 0; k < 64; k++) {
      const n = ZIGZAG[k], v = n >> 3, u = n & 7;
      let s = 0;
      for (let y = 0; y < 8; y++) s += COS[v][y] * tmp[y * 8 + u];
      blocks[bi * 64 + k] = Math.round(s / qt[n]);
    }
    comp[bi] = c;
  };
  let bi = 0;
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      for (let sb = 0; sb < 4; sb++) {
        const ox = mx * 16 + (sb & 1) * 8, oy = my * 16 + (sb >> 1) * 8;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const o = px(ox + x, oy + y);
          f[y * 8 + x] = 0.299 * cv.data[o] + 0.587 * cv.data[o + 1] + 0.114 * cv.data[o + 2] - 128;
        }
        fdct(bi++, 0);
      }
      for (let c = 1; c <= 2; c++) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          let s = 0;
          for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
            const o = px(mx * 16 + x * 2 + i, my * 16 + y * 2 + j);
            const R = cv.data[o], G = cv.data[o + 1], B = cv.data[o + 2];
            s += c === 1 ? -0.168736 * R - 0.331264 * G + 0.5 * B : 0.5 * R - 0.418688 * G - 0.081312 * B;
          }
          f[y * 8 + x] = s / 4;
        }
        fdct(bi++, c);
      }
    }
  }
  // Symbole zählen → optimale Tabellen
  const freq = [0, 0, 0, 0].map(() => new Array(256).fill(0)); // DC Y, AC Y, DC C, AC C
  const walk = (emit) => {
    const pred = [0, 0, 0];
    for (let b = 0; b < nBlocks; b++) {
      {
        const c = comp[b], base = b * 64, t = c ? 2 : 0;
        const diff = blocks[base] - pred[c];
        pred[c] = blocks[base];
        emit(t, category(diff), diff);
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const v = blocks[base + k];
          if (!v) { run++; continue; }
          while (run > 15) { emit(t + 1, 0xf0, null); run -= 16; }
          emit(t + 1, (run << 4) | category(v), v);
          run = 0;
        }
        if (run) emit(t + 1, 0x00, null);
      }
    }
  };
  walk((t, sym) => { freq[t][sym]++; });
  const tables = freq.map(huffmanTable);

  const out = [];
  const u16 = (v) => out.push((v >> 8) & 255, v & 255);
  const marker = (m) => out.push(0xff, m);
  marker(0xd8);
  marker(0xe0); u16(16); out.push(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  marker(0xdb); u16(2 + 65 * 2);
  for (let t = 0; t < 2; t++) { out.push(t); for (let k = 0; k < 64; k++) out.push(q[t][ZIGZAG[k]]); }
  marker(0xc0); u16(17); out.push(8); u16(H); u16(W); out.push(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  [[0x00, 0], [0x10, 1], [0x01, 2], [0x11, 3]].forEach(([id, t]) => {
    marker(0xc4); u16(2 + 1 + 16 + tables[t].vals.length);
    out.push(id, ...tables[t].bits, ...tables[t].vals);
  });
  marker(0xda); u16(12); out.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0);
  let acc = 0, n = 0;
  const put = (code, len) => {
    acc = (acc << len) | code; n += len;
    while (n >= 8) {
      const byte = (acc >> (n - 8)) & 255;
      out.push(byte);
      if (byte === 0xff) out.push(0);
      n -= 8; acc &= (1 << n) - 1;
    }
  };
  walk((t, sym, v) => {
    const tb = tables[t];
    put(tb.code[sym], tb.len[sym]);
    const s = sym & 15;
    if (v != null && s) put(v >= 0 ? v : v + (1 << s) - 1, s);
  });
  if (n) put((1 << (8 - n)) - 1, 8 - n);
  marker(0xd9);
  return Buffer.from(out);
}
