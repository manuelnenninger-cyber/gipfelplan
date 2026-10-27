// Lawinenlage im Wetter-Tab: Warnstufe der Gipfelregion, hervorgehoben
import { icon } from './icons.js';
import { escapeHtml, fmtInt, fmtWeekday, fmtTime } from '../util/format.js';
import { LEVEL_COLOR, LEVEL_NAME, levelAt, avaKey, isPreview } from '../api/avalanche.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const badge = (l, cls = '') => `<span class="ava-badge ${cls}" style="--c:${l ? LEVEL_COLOR[l] : 'var(--fill-2)'}" data-l="${l || 0}">${l || '–'}</span>`;

function whenLabel(date) {
  const d = new Date(`${date}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  return diff === 0 ? 'heute' : diff === 1 ? 'morgen' : `${fmtWeekday(d)}, ${d.getDate()}.`;
}

/**
 * @param ava  { loading } | { error } | { region, reports: { [JJJJ-MM-TT]: report } }
 * @param day  Datum des gewählten Prognosetags
 * @param peak Gipfel (für die Stufe auf Gipfelhöhe)
 */
export function avalancheCard(ava, day, peak) {
  if (!ava) return '';
  const head = (kicker) => `<p class="ava-kicker">${icon('alert')}Lawinenlage · ${kicker}</p>`;
  if (ava.loading) return `<section class="ava-card is-muted">${head('wird geladen')}<div class="ava-skel"></div></section>`;
  if (ava.error) return `<section class="ava-card is-muted is-compact">${head('nicht erreichbar')}<p class="ava-text">Der Lawinenbericht konnte nicht geladen werden (${escapeHtml(ava.error)}).</p></section>`;
  if (!ava.region) {
    return `<section class="ava-card is-muted is-compact">${head('kein Bericht')}<p class="ava-text">Für diesen Ort gibt es keinen Bericht der europäischen Lawinenwarndienste.</p></section>`;
  }

  const date = avaKey(day);
  const when = isPreview() ? `Vorschau ${date.split('-').reverse().join('.')}` : whenLabel(date);
  const r = ava.reports?.[date];
  const link = (r?.url || ava.region.provider?.url) && `<a class="ava-link" href="${escapeHtml(r?.url || ava.region.provider.url)}" target="_blank" rel="noopener">${escapeHtml(r?.provider || ava.region.provider?.name || 'Lawinenwarndienst')}${icon('external')}</a>`;

  if (!r || r.state === 'missing') {
    const text = when === 'morgen' ? 'Der Bericht für morgen erscheint heute gegen 17 Uhr.'
      : when === 'heute' ? 'Für heute liegt kein Lawinenbericht vor.'
      : 'Lawinenberichte gibt es nur für heute und morgen – sie erscheinen jeweils am Vortag gegen 17 Uhr.';
    return `<section class="ava-card is-muted is-compact">${head(when)}<p class="ava-text">${text}</p>${link ? `<footer class="ava-foot">${link}</footer>` : ''}</section>`;
  }

  if (r.state === 'none') {
    return `<section class="ava-card is-muted">
      <header class="ava-head">${badge(0, 'lg')}<div>${head(when)}<h3>Keine Warnstufe</h3></div></header>
      <p class="ava-text">${escapeHtml(ava.region.provider?.name || 'Der Lawinenwarndienst')} gibt derzeit keine Stufe aus – außerhalb der Wintersaison üblich. Liegt im Hochgebirge Schnee, trotzdem auf Lawinengefahr achten.</p>
      ${link ? `<footer class="ava-foot">${link}</footer>` : ''}
    </section>`;
  }

  const summit = levelAt(r, peak?.ele);
  const split = r.high !== r.low && r.bound
    ? `<div class="ava-split">
        <div>${badge(r.high)}<span>über ${escapeHtml(r.bound)}</span></div>
        <div>${badge(r.low)}<span>unter ${escapeHtml(r.bound)}</span></div>
      </div>` : '';
  const facts = [
    summit ? `Am Gipfel (${fmtInt(peak.ele)} m): <b>Stufe ${summit}</b>` : null,
    r.pmLevel ? `Im Tagesverlauf Anstieg auf <b>Stufe ${r.pmLevel}</b>` : null,
    r.tendency ? `Tendenz: ${r.tendency}` : null,
  ].filter(Boolean);
  const valid = r.validUntil ? `gültig bis ${fmtWeekday(r.validUntil)} ${fmtTime(r.validUntil)} Uhr` : '';

  return `<section class="ava-card" style="--c:${LEVEL_COLOR[r.level]}">
    <header class="ava-head">
      ${badge(r.level, 'lg')}
      <div>${head(when)}<h3>${cap(LEVEL_NAME[r.level])}</h3>
        <p class="ava-region">${escapeHtml([r.regionName, r.provider].filter(Boolean).join(' · '))}</p></div>
    </header>
    ${split}
    ${facts.length ? `<p class="ava-facts">${facts.join('<br>')}</p>` : ''}
    ${r.problems.length ? `<ul class="ava-problems">${r.problems.map((p) => `<li><b>${escapeHtml(p.name)}${p.pm ? ' <small>(nachmittags)</small>' : ''}</b><span>${escapeHtml(p.where)}</span></li>`).join('')}</ul>` : ''}
    ${r.highlights ? `<p class="ava-text">${escapeHtml(r.highlights)}</p>` : ''}
    <footer class="ava-foot">
      <button class="ava-map" type="button">${icon('layers')}Auf der Karte</button>
      ${link || ''}
    </footer>
    ${valid ? `<p class="ava-valid">${valid}</p>` : ''}
  </section>`;
}
