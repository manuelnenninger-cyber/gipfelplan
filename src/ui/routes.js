import { icon } from './icons.js';
import { renderProfile } from './profile.js';
import { escapeHtml, fmtKm, fmtM, fmtDuration, fmtInt } from '../util/format.js';
import { typeLabel } from '../api/osm.js';
import { toGPX } from '../api/routing.js';

const SAC_TEXT = {
  1: 'Wandern',
  2: 'Bergwandern',
  3: 'Anspruchsvolles Bergwandern',
  4: 'Alpinwandern',
  5: 'Anspruchsvolles Alpinwandern',
  6: 'Schwieriges Alpinwandern',
};
const START_ICON = { parking: 'parking', trailhead: 'signpost', cablecar: 'cablecar', station: 'train', bus: 'bus' };
const KIND_TAG = { loop: 'Rundtour', hut: 'Über Hütte', alt: 'Variante', marked: 'Markierter Weg', import: 'Importiert', custom: 'Eigene Route' };

// Suche nach weiteren Touren auf Tourenportalen (die keine offene Schnittstelle haben)
const PORTALS = [
  { name: 'komoot', site: 'komoot.com' },
  { name: 'Outdooractive', site: 'outdooractive.com' },
  { name: 'Bergfex', site: 'bergfex.at' },
  { name: 'hikr', site: 'hikr.org' },
];
const portalUrl = (peakName, site) => `https://www.google.com/search?q=${encodeURIComponent(`${peakName} Wanderung site:${site}`)}`;

// Filter: Name, Bedingung
const FILTERS = [
  { id: 'all', label: 'Alle', test: () => true },
  { id: 'loop', label: 'Rundtouren', test: (r) => r.kind === 'loop' || r.isLoop },
  { id: 'marked', label: 'Markierte Wege', test: (r) => r.kind === 'marked' },
  { id: 'hut', label: 'Mit Hütte', test: (r) => r.kind === 'hut' || (r.huts?.length ?? 0) > 0 },
  { id: 'easy', label: 'Bis T3', test: (r) => r.kind !== 'import' && (r.sac || 0) <= 3 },
  { id: 'short', label: 'Unter 6 h', test: (r) => r.timeTotal < 6 },
];

export function createRoutesPanel(el, { onSelect, onHover, onShow, onImportFiles, onPlan }) {
  let routes = [];
  let imported = [];
  let selected = null;
  let peak = null;
  let filter = 'all';
  let pending = false;

  const all = () => [...imported, ...routes];
  const visible = () => all().filter(FILTERS.find((f) => f.id === filter).test);

  function loading(text) {
    el.innerHTML = `
      <p class="status-line"><span class="spinner"></span>${escapeHtml(text)}</p>
      ${'<div class="skeleton-row"></div>'.repeat(3)}`;
  }

  function message(title, body) {
    el.innerHTML = `<div class="empty"><p class="empty-title">${escapeHtml(title)}</p><p class="muted">${escapeHtml(body)}</p></div>`;
  }

  function moreTours() {
    const name = peak?.name || '';
    return `
      <section class="more-tours">
        <p class="more-title">Weitere Touren${name ? ` zu ${escapeHtml(name)}` : ''}</p>
        <p class="more-links">${PORTALS.map((p) => `<a href="${portalUrl(name, p.site)}" target="_blank" rel="noopener">${p.name}${icon('external')}</a>`).join('')}</p>
        <p class="muted small">Tour dort als GPX exportieren und hier hineinziehen oder importieren. Du bekommst Höhenprofil, Gehzeit und Wetter dazu.</p>
        <button class="btn btn-import">${icon('download')}GPX importieren</button>
        <input type="file" class="gpx-input" accept=".gpx,application/gpx+xml" multiple hidden />
      </section>`;
  }
  const planButton = () => `<button class="btn btn-plan">${icon('route')}Eigene Route planen</button>`;

  function bindMore() {
    el.querySelector('.btn-plan')?.addEventListener('click', () => onPlan?.());
    const btn = el.querySelector('.btn-import');
    const input = el.querySelector('.gpx-input');
    btn?.addEventListener('click', () => input.click());
    input?.addEventListener('change', () => { if (input.files.length) onImportFiles?.(input.files); input.value = ''; });
  }

  function render() {
    if (!all().length) {
      if (pending) { loading('Berechne Touren …'); return; }
      message('Keine Route gefunden', 'Im Umkreis gibt es keinen Startpunkt mit Wegverbindung zum Gipfel. Plane eine eigene Route oder importiere eine GPX-Datei.');
      el.insertAdjacentHTML('beforeend', planButton() + moreTours());
      bindMore();
      return;
    }
    const list = visible();
    const chips = FILTERS
      .map((f) => ({ ...f, n: all().filter(f.test).length }))
      .filter((f) => f.id === 'all' || f.n > 0)
      .map((f) => `<button class="chip" data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label}<span>${f.n}</span></button>`)
      .join('');
    el.innerHTML = `
      ${planButton()}
      <div class="chips" role="group" aria-label="Touren filtern">${chips}</div>
      <p class="list-note">${list.length === 1 ? '1 Tour' : `${list.length} Touren`}, sortiert nach Gesamtzeit${pending ? '<span class="pending"><span class="spinner"></span>weitere werden berechnet</span>' : ''}</p>
      ${list.length ? `<ul class="route-list">${list.map(row).join('')}</ul>` : '<p class="muted small empty-filter">Keine Tour passt zu diesem Filter.</p>'}
      ${moreTours()}
      <p class="fineprint">Berechnet aus OpenStreetMap-Daten. Wegzustand, Sperrungen und Verhältnisse vor Ort prüfen; die Schwierigkeit stammt aus der SAC-Angabe der Wege. Gehzeiten nach DAV-Formel ohne Pausen.</p>`;

    el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.filter;
      if (selected && !visible().some((r) => r.id === selected)) selected = null;
      render();
      onShow?.(visible(), selected);
    }));
    bindMore();
    el.querySelectorAll('.route-row').forEach((b) => {
      b.addEventListener('click', () => select(b.dataset.id === selected ? null : b.dataset.id, true));
    });
    if (selected) {
      const r = all().find((x) => x.id === selected);
      const prof = el.querySelector('.profile');
      if (r && prof) renderProfile(prof, r, { onHover });
      el.querySelector('.btn-gpx')?.addEventListener('click', () => downloadGPX(r));
      el.querySelector('.btn-remove')?.addEventListener('click', () => {
        imported = imported.filter((x) => x.id !== r.id);
        selected = null;
        render();
        onShow?.(visible(), null);
      });
      el.querySelector(`[data-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function subline(r) {
    if (r.kind === 'import') return `${r.isLoop ? 'Rundtour' : 'Strecke'} aus GPX-Datei`;
    if (r.kind === 'custom') return r.isLoop ? 'Rundtour, selbst geplant' : r.oneWay ? 'Überschreitung, selbst geplant' : 'Selbst geplant, Abstieg auf gleichem Weg';
    if (r.kind === 'marked') return `${r.subtitle}${r.startEle != null ? `, ab ${fmtInt(r.startEle)} m` : ''}`;
    if (r.kind === 'loop') return r.connector ? `inkl. ${fmtKm(r.connector.length)} zurück zum Start` : 'Auf- und Abstieg auf verschiedenen Wegen';
    if (r.kind === 'hut') return `${r.subtitle}${r.startEle != null ? `, ab ${fmtInt(r.startEle)} m` : ''}`;
    return [`${typeLabel(r.start.type)} im ${dirDative(r.direction)}`, r.startEle != null ? `ab ${fmtInt(r.startEle)} m` : null].filter(Boolean).join(', ');
  }

  function row(r) {
    const isSel = r.id === selected;
    const loop = r.kind === 'loop' || r.isLoop || r.oneWay;
    const tag = KIND_TAG[r.kind];
    return `
      <li class="route ${isSel ? 'is-selected' : ''}" style="--rc:${r.color}">
        <button class="route-row" data-id="${escapeHtml(r.id)}" aria-expanded="${isSel}">
          <span class="route-start">${icon(r.kind === 'import' ? 'download' : r.kind === 'custom' ? 'route' : loop ? 'loop' : r.kind === 'hut' ? 'hut' : r.kind === 'marked' ? 'signpost' : START_ICON[r.start.type] || 'signpost')}</span>
          <span class="route-main">
            <span class="route-title">${escapeHtml(r.title)}</span>
            <span class="route-sub">${tag ? `<span class="tag">${tag}</span>` : ''}${escapeHtml(subline(r))}</span>
            <span class="route-stats">
              ${loop
                ? `<span title="Gesamtzeit">${icon('clock')}${fmtDuration(r.timeTotal)}</span><span title="Höhenmeter">${icon('arrowUp')}${fmtM(r.up)}</span><span title="Strecke gesamt">${icon('route')}${fmtKm(r.length)}</span>`
                : `<span title="Aufstieg">${icon('clock')}${fmtDuration(r.timeUp)}</span><span title="Höhenmeter">${icon('arrowUp')}${fmtM(r.up)}</span><span title="Strecke einfach">${icon('route')}${fmtKm(r.length)}</span>`}
            </span>
          </span>
          ${r.sac ? `<span class="sac sac-${r.sac}" title="${SAC_TEXT[r.sac]}">T${r.sac}</span>` : ''}
        </button>
        ${isSel ? detail(r) : ''}
      </li>`;
  }

  function detail(r) {
    const loop = r.kind === 'loop' || r.isLoop || r.oneWay;
    const notes = [];
    if (r.sac >= 5) notes.push('Teile der Route sind anspruchsvolles bis schwieriges Alpinwandern (T5–T6): ausgesetzt, leichte Kletterstellen, oft weglos. Nur mit Erfahrung, Trittsicherheit und bei guten Verhältnissen.');
    else if (r.sac === 4) notes.push('Teile der Route sind Alpinwandern (T4): Hände nötig, teils ausgesetzt. Trittsicherheit und Schwindelfreiheit erforderlich.');
    if (r.viaFerrata) notes.push('Die Route führt über einen Klettersteig. Ausrüstung und Erfahrung nötig.');
    if (r.gapToSummit > 120) notes.push(`Der Weg endet etwa ${fmtInt(Math.round(r.gapToSummit / 10) * 10)} m vor dem Gipfelpunkt. Das letzte Stück kann weglos oder Kletterei sein.`);
    if (r.start.type === 'cablecar') notes.push('Start an einer Bergbahn: Betriebszeiten und Saison prüfen.');
    if (r.kind === 'import' && r.gapToSummit > 300) notes.push('Die importierte Tour führt nicht direkt über den gewählten Gipfel.');
    if (r.kind === 'custom' && r.via?.length) notes.push(`Über ${r.via.join(', ')}.`);
    if (r.timeTotal > 8 && r.huts?.length) notes.push(`Lange Tour: Mit Übernachtung auf der ${r.huts[0].name} lässt sie sich auf zwei Tage verteilen.`);

    const legs = r.kind === 'loop' ? `
        <dl class="legs">
          <div><dt>Aufstieg über</dt><dd>${escapeHtml(r.ascentVia)}</dd></div>
          <div><dt>Abstieg über</dt><dd>${escapeHtml(r.descentVia)}</dd></div>
        </dl>` : '';
    const huts = r.huts?.length ? `
        <p class="huts">${icon('hut')}<span>${r.huts.map((h) => `${escapeHtml(h.name)} <span class="muted">nach ${fmtDuration(h.time)}</span>`).join(', ')}</span></p>` : '';
    return `
      <div class="route-detail">
        <div class="profile"></div>
        ${legs}
        <dl class="stat-grid">
          <div><dt>Aufstieg</dt><dd>${fmtDuration(r.timeUp)}</dd></div>
          <div><dt>Abstieg</dt><dd>${fmtDuration(r.timeDown)}</dd></div>
          <div><dt>Gesamt</dt><dd>${fmtDuration(r.timeTotal)}</dd></div>
          <div><dt>${loop ? 'Strecke gesamt' : 'Strecke einfach'}</dt><dd>${fmtKm(r.length)}</dd></div>
          <div><dt>Höhenmeter</dt><dd>${icon('arrowUp')}${fmtInt(r.up)} ${icon('arrowDown')}${fmtInt(r.down)}</dd></div>
          <div><dt>Schwierigkeit</dt><dd>${r.sac ? `T${r.sac}, ${SAC_TEXT[r.sac]}` : 'Keine Angabe'}</dd></div>
        </dl>
        ${huts}
        ${notes.map((n) => `<p class="note">${icon('alert')}<span>${escapeHtml(n)}</span></p>`).join('')}
        ${r.kind === 'marked' ? `<p class="marked-info">${icon('signpost')}<span>${r.symbol ? `Markierung: ${escapeHtml(r.symbol)}. ` : ''}<a href="${r.link}" target="_blank" rel="noopener">Weg bei Waymarked Trails ansehen</a></span></p>` : ''}
        <div class="actions">
          <button class="btn btn-gpx">${icon('download')}GPX herunterladen</button>
          ${r.kind === 'import' || r.kind === 'custom' ? '<button class="btn btn-remove">Entfernen</button>' : ''}
        </div>
      </div>`;
  }

  function downloadGPX(r) {
    const blob = new Blob([toGPX(r, peak?.name || 'Gipfel')], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(peak?.name || 'gipfel').replace(/\s+/g, '-')}_${r.title.replace(/[^\wäöüÄÖÜß-]+/g, '-')}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function select(id, fromList = false) {
    selected = id;
    render();
    onSelect?.(id, fromList);
  }

  return {
    loading,
    message,
    /** Liste setzen; bei Zwischenständen bleiben Filter und Auswahl erhalten */
    set(p, list, { pending: isPending = false } = {}) {
      const samePeak = p === peak;
      peak = p;
      routes = list;
      pending = isPending;
      if (!samePeak) { filter = 'all'; selected = null; imported = []; }
      if (!visible().length && filter !== 'all') filter = 'all';
      if (selected && !all().some((r) => r.id === selected)) selected = null;
      render();
      onShow?.(visible(), selected);
    },
    select(id) { if (id !== selected) select(id); },
    /** Eigene Route oben einfügen und auswählen */
    addCustom(tour) { this.addImport(tour); },
    /** Importierte Tour oben einfügen und auswählen */
    addImport(tour, forPeak) {
      if (forPeak && forPeak !== peak) { peak = forPeak; routes = []; imported = []; }
      imported.unshift(tour);
      filter = 'all';
      selected = tour.id;
      render();
      onShow?.(visible(), selected);
      onSelect?.(tour.id, true);
    },
    get selected() { return selected; },
    get visible() { return visible(); },
  };
}

function dirDative(dir) {
  // "Süd" → "Süden", "Nordost" → "Nordosten"
  return { Nord: 'Norden', Ost: 'Osten', Süd: 'Süden', West: 'Westen', Nordost: 'Nordosten', Südost: 'Südosten', Südwest: 'Südwesten', Nordwest: 'Nordwesten' }[dir] || dir;
}
