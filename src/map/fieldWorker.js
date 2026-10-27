// Berechnet die Wetterbilder im Hintergrund, damit Karte und Bedienung flüssig bleiben.
import { renderField, pixelLookup, detailLookup } from './field.js';

let W = 0, H = 0;
let reg = null, regLk = null;
let det = null, detLk = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'size') {
    W = m.W; H = m.H;
  } else if (m.type === 'grid') {
    reg = m.grid;
    regLk = pixelLookup(reg, W, H);
    detLk = det ? detailLookup(regLk, det) : null;
  } else if (m.type === 'detail') {
    det = m.grid;
    detLk = det && regLk ? detailLookup(regLk, det) : null;
  } else if (m.type === 'render') {
    if (!reg) return;
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    const detail = det && detLk ? { grid: det, tf: m.td, lookup: detLk } : null;
    renderField(img, reg, regLk, m.layer, m.t, { windLevel: m.windLevel, detail });
    self.postMessage({ seq: m.seq, buffer: img.data.buffer }, [img.data.buffer]);
  }
};
