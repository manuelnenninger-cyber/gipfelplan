const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtInt = (n) => nf0.format(n);
export const fmtKm = (m) => `${nf1.format(m / 1000)} km`;
export const fmtM = (m) => `${nf0.format(Math.round(m))} m`;

/** Stunden (Dezimal) → "4:35 h" */
export function fmtDuration(hours) {
  const total = Math.round(hours * 60 / 5) * 5; // auf 5 Minuten runden
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

const wd = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const wdLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const hm = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayHour = new Intl.DateTimeFormat('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtWeekday = (d) => wd.format(d).replace('.', '');
export const fmtDayLong = (d) => wdLong.format(d);
export const fmtTime = (d) => hm.format(d);
export const fmtDayHour = (d) => dayHour.format(d).replace('.', '').replace(',', '');

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
