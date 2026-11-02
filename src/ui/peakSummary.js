// Ein Satz unter dem Gipfelnamen: das Wichtigste auf einen Blick, z. B.
// „● Morgen gut · Lawinen 2 · Schnee ab 2.450 m“. Antippen öffnet das Wetter.
import { LEVEL_COLOR, levelAt, avaKey } from '../api/avalanche.js';
import { fmtInt, escapeHtml } from '../util/format.js';
import { icon } from './icons.js';

const RATING = { good: 'gut', fair: 'eingeschränkt', poor: 'ungünstig' };

/**
 * Bausteine der Zusammenfassung
 * @param fc Gipfelprognose, ava { reports } Lawinenberichte, snow Schneegrenze aus dem Satellitenbild
 * @returns [{ kind, text, color }]
 */
export function summaryItems({ fc, ava, snow, peak, now = new Date() }) {
  const items = [];
  // vormittags zählt heute, danach schon morgen
  const useToday = now.getHours() < 11;
  const day = fc?.days?.[useToday ? 0 : 1] || fc?.days?.[0] || null;
  const label = useToday ? 'Heute' : 'Morgen';
  if (day?.rating?.level && RATING[day.rating.level]) {
    items.push({ kind: 'wx', text: `${label} ${RATING[day.rating.level]}`, color: `var(--${day.rating.level})` });
  }
  const date = day?.date || now;
  const r = ava?.reports?.[avaKey(date)];
  if (r?.state === 'rated' && r.level) {
    const l = levelAt(r, peak?.ele) ?? r.level;
    items.push({ kind: 'ava', text: `Lawinen ${l}`, color: LEVEL_COLOR[l] });
  }
  if (snow) {
    if (snow.from != null) items.push({ kind: 'snow', text: `Schnee ab ${fmtInt(snow.from)} m` });
    else if (snow.share < 0.15) items.push({ kind: 'snow', text: 'schneefrei' });
  }
  return items;
}

export function summaryHtml(items) {
  return items.map((it) => `<span class="ps-item ps-${it.kind}">${it.color ? `<i style="--c:${it.color}"></i>` : ''}${it.kind === 'snow' ? icon('snowflake') : ''}${escapeHtml(it.text)}</span>`).join('<span class="ps-sep">·</span>');
}
