import { searchPeaks } from '../api/search.js';
import { demElevations, osmElevations } from '../api/osm.js';
import { escapeHtml, fmtInt } from '../util/format.js';
import { icon } from './icons.js';

export function setupSearch({ getCenter, onSelect, getRecent = () => [] }) {
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-results');
  const clearBtn = document.getElementById('search-clear');
  let results = [];
  let active = -1;
  let ctrl = null;
  let timer = 0;
  let mode = 'search'; // oder 'recent'

  function render(state, note = '') {
    if (state === 'loading') {
      list.innerHTML = '<li class="sr-note">Suche …</li>';
    } else if (state === 'empty') {
      list.innerHTML = '<li class="sr-note">Kein Gipfel mit diesem Namen gefunden. Versuch es mit einer anderen Schreibweise.</li>';
    } else if (state === 'error') {
      list.innerHTML = '<li class="sr-note">Die Suche ist gerade nicht erreichbar. Prüfe die Internetverbindung.</li>';
    } else {
      const head = mode === 'recent' ? `<li class="sr-note sr-head">${escapeHtml(note || 'Zuletzt angesehen')}</li>` : '';
      list.innerHTML = head + results
        .map((r, i) => `
          <li role="option" id="sr-${i}" aria-selected="${i === active}" data-i="${i}">
            <span class="sr-icon">${icon('mountain')}</span>
            <span class="sr-text"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.region || 'Gipfel')}</small></span>
            ${r.ele ? `<span class="sr-ele">${r.eleApprox ? 'ca. ' : ''}${fmtInt(r.ele)} m</span>` : ''}
          </li>`)
        .join('');
    }
    list.hidden = false;
  }

  async function run(q) {
    ctrl?.abort();
    ctrl = new AbortController();
    render('loading');
    try {
      results = await searchPeaks(q, { near: getCenter(), signal: ctrl.signal });
      active = results.length ? 0 : -1;
      render(results.length ? 'list' : 'empty');
      // Höhen nachladen (Photon liefert keine): exakt aus OSM, sonst geschätzt aus dem Höhenmodell
      const list0 = results;
      const missing = results.filter((r) => !r.ele);
      if (missing.length) {
        const osm = await osmElevations(missing, ctrl.signal).catch(() => []);
        missing.forEach((r, i) => { if (osm[i]) r.ele = osm[i]; });
        const rest = missing.filter((r) => !r.ele);
        if (rest.length) {
          const dem = await demElevations(rest, ctrl.signal).catch(() => []);
          rest.forEach((r, i) => { if (dem[i]) { r.ele = dem[i]; r.eleApprox = true; } });
        }
        if (results === list0 && !list.hidden) render('list');
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      // Ohne Netz: unter den zuletzt angesehenen Gipfeln suchen (die gehen auch offline)
      const ql = q.toLowerCase();
      const hits = getRecent().filter((r) => r.name.toLowerCase().includes(ql));
      if (hits.length) { results = hits; active = 0; mode = 'recent'; render('list', 'Ohne Empfang – zuletzt angesehen'); mode = 'search'; }
      else render('error');
    }
  }

  function showRecent() {
    const recent = getRecent();
    if (!recent.length) return;
    results = recent;
    active = -1;
    mode = 'recent';
    render('list', navigator.onLine === false ? 'Ohne Empfang – zuletzt angesehen' : 'Zuletzt angesehen');
    mode = 'search';
  }

  function choose(i) {
    const r = results[i];
    if (!r) return;
    input.value = r.name;
    list.hidden = true;
    input.blur();
    onSelect(r);
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.hidden = !q;
    clearTimeout(timer);
    if (q.length < 2) { list.hidden = true; if (!q) showRecent(); return; }
    timer = setTimeout(() => run(q), 250);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !results.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % results.length; render('list'); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + results.length) % results.length; render('list'); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(active); e.preventDefault(); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length < 2) showRecent();
    else if (results.length) render('list');
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) choose(+li.dataset.i);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#search')) list.hidden = true;
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    list.hidden = true;
    results = [];
    input.focus();
  });

  // Tastenkürzel: "/" oder ⌘K springt in die Suche
  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea/i.test(document.activeElement?.tagName);
    if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  return { setValue(v) { input.value = v; clearBtn.hidden = !v; } };
}
