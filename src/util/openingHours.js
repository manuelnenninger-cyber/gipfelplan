// Öffnungszeiten aus OpenStreetMap (Tag "opening_hours") lesbar machen.
// Hütten haben fast immer nur eine Saison („Jun-Sep“ oder „May 15-Oct 15“).
// Die prüfen wir gegen das heutige Datum; alles Kompliziertere zeigen wir nur an.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const M = MONTHS.join('|');
const DATE = `(${M})(?:\\s+(\\d{1,2}))?`;
const RANGE = new RegExp(`^${DATE}(?:\\s*-\\s*${DATE})?`);
const LAST_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const mIdx = (m) => MONTHS.indexOf(m);

/** Liest eine Liste von Datumsbereichen am Anfang einer Regel. */
function readRanges(rule) {
  const ranges = [];
  let rest = rule.trim();
  for (;;) {
    const m = RANGE.exec(rest);
    if (!m) break;
    const [all, m1, d1, m2, d2] = m;
    const sM = mIdx(m1);
    const eM = m2 ? mIdx(m2) : sM;
    const start = sM * 100 + (d1 ? +d1 : 1);
    // „Jun 15“ ohne Ende gilt nur an diesem Tag, „Jun“ den ganzen Monat
    const end = eM * 100 + (d2 ? +d2 : m2 ? LAST_DAY[eM] : d1 ? +d1 : LAST_DAY[eM]);
    ranges.push([start, end]);
    rest = rest.slice(all.length).trim();
    if (rest.startsWith(',') && RANGE.test(rest.slice(1).trim())) rest = rest.slice(1).trim();
    else break;
  }
  return { ranges, rest };
}

const inRange = (t, [s, e]) => (s <= e ? t >= s && t <= e : t >= s || t <= e);

/** Deutsche Schreibweise für die Anzeige */
export function hoursToGerman(oh) {
  if (!oh) return '';
  const s = oh.trim();
  if (s === '24/7') return 'rund um die Uhr';
  const months = { Mar: 'Mär', May: 'Mai', Oct: 'Okt', Dec: 'Dez' };
  const days = { Mo: 'Mo', Tu: 'Di', We: 'Mi', Th: 'Do', Fr: 'Fr', Sa: 'Sa', Su: 'So', PH: 'Feiertage' };
  return s
    .replace(/\b(Mar|May|Oct|Dec)\b/g, (m) => months[m])
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => days[d])
    .replace(/\b(off|closed)\b/gi, 'geschlossen')
    .replace(/\s*;\s*/g, ' · ')
    .replace(/(\S)-(\S)/g, '$1–$2')
    .replace(/\s+-\s+/g, ' – ');
}

/**
 * @returns {{ text: string, open: boolean|null }}
 *   open: true/false, wenn es sich aus der Saison sicher ergibt, sonst null
 */
export function describeHours(oh, now = new Date()) {
  if (!oh || !oh.trim()) return { text: '', open: null };
  const text = hoursToGerman(oh);
  const raw = oh.trim();
  if (raw === '24/7') return { text, open: true };

  const today = now.getMonth() * 100 + now.getDate();
  let open = null;
  let allSeasonal = true;
  let anySeasonal = false;
  for (const rule of raw.split(/;|\|\|/).map((r) => r.trim()).filter(Boolean)) {
    const { ranges, rest } = readRanges(rule);
    const off = /\b(off|closed)\b/i.test(rest);
    if (!ranges.length) {
      allSeasonal = false;
      // Regel ohne Datum gilt immer; spätere Regeln mit Datum überschreiben sie
      open = off ? false : null;
      continue;
    }
    anySeasonal = true;
    if (ranges.some((r) => inRange(today, r))) open = !off;
  }
  // Nur Saisonregeln und keine trifft heute zu: außerhalb der Saison
  if (open === null && anySeasonal && allSeasonal) open = false;
  return { text, open };
}
