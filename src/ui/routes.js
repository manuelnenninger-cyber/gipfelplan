import { icon } from './icons.js';
import { renderProfile } from './profile.js';
import { escapeHtml, fmtKm, fmtM, fmtDuration, fmtInt } from '../util/format.js';
import { typeLabel } from '../api/osm.js';
import { toGPX } from '../api/routing.js';
import { ASPECTS, ASPECT_DE, CHECK_LABEL } from '../api/avyCheck.js';
import { LEVEL_NAME, LEVEL_COLOR } from '../api/avalanche.js';

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
  { id: 'short', label: 'Unter 6 h', test: (r) => r.timeTotal < 6 },
];

// Schwierigkeit in drei Stufen (SAC-Skala), Farben wie die Tourenampel
export const DIFFS = [
  { id: 'easy', label: 'Leicht', range: 'T1–T2', test: (r) => r.sac >= 1 && r.sac <= 2 },
  { id: 'medium', label: 'Mittel', range: 'T3', test: (r) => r.sac === 3 },
  { id: 'hard', label: 'Schwer', range: 'T4–T6', test: (r) => r.sac >= 4 },
];
export const diffOf = (r) => DIFFS.find((d) => d.test(r))?.id || null;

export function createRoutesPanel(el, { onSelect, onHover, onShow, onImportFiles, onPlan, onSave, onPlanTour, onShare, getAvy = () => null, onAvyLayer, colorOf = (r) => r.color }) {
  const saved = new Map(); // Tour-ID → ID in der Datenbank
  let routes = [];
  let imported = [];
  let selected = null;
  let peak = null;
  let filter = 'all';
  let diff = 'all';
  let pending = false;
  let note = '';
  let planning = null; // { id, view } – „Planen“-Ansicht einer Tour ist offen

  const all = () => [...imported, ...routes];
  const byKind = (list) => list.filter(FILTERS.find((f) => f.id === filter).test);
  const byDiff = (list) => (diff === 'all' ? list : list.filter((r) => diffOf(r) === diff));
  const visible = () => byDiff(byKind(all()));

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
  const planButton = () => `<button class="btn btn-plan">${icon('route')}Route zeichnen</button>`;

  function bindMore() {
    el.querySelector('.btn-plan')?.addEventListener('click', () => onPlan?.());
    const btn = el.querySelector('.btn-import');
    const input = el.querySelector('.gpx-input');
    btn?.addEventListener('click', () => input.click());
    input?.addEventListener('change', () => { if (input.files.length) onImportFiles?.(input.files); input.value = ''; });
  }

  function render() {
    if (planning) {
      const r = all().find((x) => x.id === planning.id);
      if (r && el.querySelector('.plan-host')) return; // Ansicht bleibt, auch wenn weitere Touren dazukommen
      if (r) {
        el.innerHTML = '<div class="plan-host"></div>';
        planning.view = onPlanTour?.(r, el.querySelector('.plan-host'), () => { planning = null; render(); onShow?.(visible(), selected); });
        return;
      }
      planning = null;
    }
    if (!all().length) {
      if (pending) { loading('Berechne Touren …'); return; }
      message('Keine Route gefunden', 'Im Umkreis gibt es keinen Startpunkt mit Wegverbindung zum Gipfel. Zeichne eine eigene Route oder importiere eine GPX-Datei.');
      el.insertAdjacentHTML('beforeend', planButton() + moreTours());
      bindMore();
      return;
    }
    const list = visible();
    // Zahlen berücksichtigen den jeweils anderen Filter
    const kindBase = byKind(all());
    // Keine Stufe gewählt = alle; nochmal tippen hebt die Auswahl auf
    const seg = DIFFS.map((d) => ({ ...d, n: kindBase.filter(d.test).length }))
      .map((d) => `<button data-diff="${d.id}" aria-pressed="${d.id === diff}" ${d.n || d.id === diff ? '' : 'disabled'} title="${d.label}: ${d.range}">
          <i class="dd dd-${d.id}"></i>${d.label}<span>${d.n}</span></button>`)
      .join('');
    const chips = FILTERS
      .map((f) => ({ ...f, n: byDiff(all()).filter(f.test).length }))
      .filter((f) => (f.id === 'all' ? filter !== 'all' : f.n > 0))
      .map((f) => `<button class="chip" data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label}<span>${f.n}</span></button>`)
      .join('');
    el.innerHTML = `
      ${planButton()}
      <div class="diff-seg" role="group" aria-label="Nach Schwierigkeit filtern">${seg}</div>
      <div class="chips" role="group" aria-label="Touren filtern">${chips}</div>
      ${note ? `<p class="offline-note">${icon('alert')}<span>${escapeHtml(note)}</span></p>` : ''}
      <p class="list-note">${list.length === 1 ? '1 Tour' : `${list.length} Touren`}, sortiert nach Gesamtzeit${pending ? '<span class="pending"><span class="spinner"></span>weitere werden berechnet</span>' : ''}</p>
      ${list.length ? `<ul class="route-list">${list.map(row).join('')}</ul>` : '<p class="muted small empty-filter">Keine Tour passt zu dieser Auswahl.</p>'}
      ${moreTours()}
      <p class="fineprint">Berechnet aus OpenStreetMap-Daten. Wegzustand, Sperrungen und Verhältnisse vor Ort prüfen; die Schwierigkeit stammt aus der SAC-Angabe der Wege (leicht T1–T2, mittel T3, schwer T4–T6). Gehzeiten nach DAV-Formel ohne Pausen.</p>`;

    const refilter = () => {
      if (selected && !visible().some((r) => r.id === selected)) selected = null;
      render();
      onShow?.(visible(), selected);
    };
    el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; refilter(); }));
    el.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
      diff = b.dataset.diff === diff ? 'all' : b.dataset.diff;
      refilter();
    }));
    bindMore();
    el.querySelectorAll('.route-row').forEach((b) => {
      b.addEventListener('click', () => select(b.dataset.id === selected ? null : b.dataset.id, true));
    });
    if (selected) {
      const r = all().find((x) => x.id === selected);
      const prof = el.querySelector('.profile');
      const avy = r && getAvy(r);
      if (r && prof) renderProfile(prof, r, { onHover, bands: avy?.check.sections.map((x) => ({ from: x.from, to: x.to, color: x.cls === 2 ? '#e11428' : '#ff9614' })) });
      el.querySelector('.avy-layer')?.addEventListener('click', () => onAvyLayer?.());
      el.querySelectorAll('.avy-secs li').forEach((li) => {
        const [lng, lat] = li.dataset.p.split(',').map(Number);
        li.addEventListener('mouseenter', () => onHover?.([lng, lat]));
        li.addEventListener('mouseleave', () => onHover?.(null));
        li.addEventListener('click', () => onHover?.([lng, lat]));
      });
      el.querySelector('.btn-gpx')?.addEventListener('click', () => downloadGPX(r));
      el.querySelector('.btn-share')?.addEventListener('click', () => onShare?.(r, peak));
      el.querySelector('.btn-plan-tour')?.addEventListener('click', () => openPlan(r.id));
      el.querySelector('.btn-save:not(.is-saved)')?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.innerHTML = '<span class="spinner"></span>Speichern …';
        const savedId = await onSave?.(r).catch(() => null);
        if (savedId) saved.set(r.id, savedId);
        render();
      });
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
    const tag = r.shared ? 'Geteilt' : KIND_TAG[r.kind];
    return `
      <li class="route ${isSel ? 'is-selected' : ''}" style="--rc:${colorOf(r)}">
        <button class="route-row" data-id="${escapeHtml(r.id)}" aria-expanded="${isSel}">
          <span class="route-start">${icon(r.kind === 'import' ? 'download' : r.kind === 'custom' ? 'route' : loop ? 'loop' : r.kind === 'hut' ? 'hut' : r.kind === 'marked' ? 'signpost' : START_ICON[r.start.type] || 'signpost')}</span>
          <span class="route-main">
            <span class="route-title">${r.savedId || saved.has(r.id) ? icon('bookmarkFill', 'saved-mark') : ''}${escapeHtml(r.title)}</span>
            <span class="route-sub">${tag ? `<span class="tag">${tag}</span>` : ''}${escapeHtml(subline(r))}</span>
            <span class="route-stats">
              ${loop
                ? `<span title="Gesamtzeit">${icon('clock')}${fmtDuration(r.timeTotal)}</span><span title="Höhenmeter">${icon('arrowUp')}${fmtM(r.up)}</span><span title="Strecke gesamt">${icon('route')}${fmtKm(r.length)}</span>`
                : `<span title="Aufstieg">${icon('clock')}${fmtDuration(r.timeUp)}</span><span title="Höhenmeter">${icon('arrowUp')}${fmtM(r.up)}</span><span title="Strecke einfach">${icon('route')}${fmtKm(r.length)}</span>`}
              ${avyPill(r)}
            </span>
          </span>
          ${r.sac ? `<span class="sac sac-${diffOf(r)}" title="${SAC_TEXT[r.sac]}"><small>${DIFFS.find((d) => d.test(r)).label}</small>T${r.sac}</span>` : ''}
        </button>
        ${isSel ? detail(r) : ''}
      </li>`;
  }

  function avyPill(r) {
    const a = getAvy(r);
    if (!a) return '';
    return `<span class="avy-pill avy-${a.check.level}" title="Lawinen-Check: ${CHECK_LABEL[a.check.level]}">${icon('alert')}Lawine ${CHECK_LABEL[a.check.level]}</span>`;
  }

  function avyCard(r) {
    const a = getAvy(r);
    if (!a) return '';
    const { check, report, day } = a;
    const lvl = report.level;
    const verdict = {
      2: 'Die Route führt durch Hänge, die bei dieser Lawinenlage gemieden werden sollten.',
      1: 'Steile Abschnitte nahe der Grenze – genau beurteilen und Alternativen prüfen.',
      0: 'Keine Hänge, die bei dieser Lage zu steil wären (geprüft bis ca. 15 m neben der Route).',
    }[check.level];
    const secs = [...check.sections].sort((x, y) => y.cls - x.cls || y.slope - x.slope).slice(0, 4).map((x) => `
        <li data-p="${x.points[0][0]},${x.points[0][1]}"><i class="avy-d avy-d${x.cls}"></i>
          <span>km ${(x.from / 1000).toFixed(1).replace('.', ',')} · ${fmtInt(Math.round(x.ele / 10) * 10)} m · <b>${Math.round(x.slope)}°</b> ${ASPECT_DE[ASPECTS[Math.round(x.aspect / 45) % 8]]}${x.core ? ' · Kernzone' : ''}</span>
          <small>${x.cls === 2 ? 'meiden' : 'Vorsicht'}</small></li>`).join('');
    const probs = (report.problems || []).filter((p) => p.where).map((p) => `${p.name}: ${p.where}`).join(' · ');
    return `
      <section class="avy-card avy-c${check.level}">
        <header><span class="ava-badge" style="--c:${LEVEL_COLOR[lvl]}" data-l="${lvl}">${lvl}</span>
          <div><b>Lawinen-Check: ${CHECK_LABEL[check.level]}</b>
          <small>Bericht ${escapeHtml(day)}: Stufe ${lvl} (${LEVEL_NAME[lvl]})${report.bound && report.high !== report.low ? `, über ${escapeHtml(report.bound)} ${report.high}, darunter ${report.low}` : ''}</small></div></header>
        <p>${verdict}</p>
        ${probs ? `<p class="muted small">Kernzonen: ${escapeHtml(probs)}</p>` : ''}
        ${secs ? `<ul class="avy-secs">${secs}</ul>` : ''}
        <button class="btn avy-layer">${icon('layers')}Gefahrenstellen auf der Karte</button>
        <p class="fineprint">Grobe Planungshilfe nach der Reduktionsmethode: je höher die Stufe, desto flachere Hänge (Stufe 2 bis 40°, 3 bis 35°, 4 bis 30°; außerhalb der Kernzonen eine Stufe weniger). Gelände ca. 20 m genau; Fels über 60°, Wald und Geländeform nicht berücksichtigt. Lagebericht lesen und vor Ort beurteilen.</p>
      </section>`;
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
          <div><dt>Schwierigkeit</dt><dd>${r.sac ? `${DIFFS.find((d) => d.test(r)).label} (T${r.sac}), ${SAC_TEXT[r.sac]}` : 'Keine Angabe'}</dd></div>
        </dl>
        ${huts}
        ${avyCard(r)}
        ${notes.map((n) => `<p class="note">${icon('alert')}<span>${escapeHtml(n)}</span></p>`).join('')}
        ${r.kind === 'marked' ? `<p class="marked-info">${icon('signpost')}<span>${r.symbol ? `Markierung: ${escapeHtml(r.symbol)}. ` : ''}<a href="${r.link}" target="_blank" rel="noopener">Weg bei Waymarked Trails ansehen</a></span></p>` : ''}
        <button class="btn btn-primary btn-plan-tour">${icon('calendar')}Startzeit & Wetter</button>
        <div class="actions">
          ${r.savedId || saved.has(r.id)
            ? `<button class="btn btn-save is-saved" disabled>${icon('bookmarkFill')}Gespeichert</button>`
            : `<button class="btn btn-save">${icon('bookmark')}Speichern</button>`}
          <button class="btn btn-share">${icon('share')}Teilen</button>
          <button class="btn btn-gpx">${icon('download')}GPX</button>
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

  function openPlan(id) {
    planning = { id, view: null };
    el.closest('.panel-body')?.scrollTo?.({ top: 0 });
    render();
  }

  function closePlan() {
    if (!planning) return;
    const v = planning.view;
    planning = null;
    v?.close?.();
  }

  function select(id, fromList = false) {
    if (planning && planning.id !== id) closePlan();
    selected = id;
    render();
    onSelect?.(id, fromList);
  }

  return {
    loading,
    message,
    /** Liste setzen; bei Zwischenständen bleiben Filter und Auswahl erhalten */
    set(p, list, { pending: isPending = false, note: info = '' } = {}) {
      const samePeak = p === peak;
      peak = p;
      routes = list;
      pending = isPending;
      note = info;
      if (!samePeak) { closePlan(); filter = 'all'; diff = 'all'; selected = null; imported = []; }
      if (!visible().length) { filter = 'all'; diff = 'all'; }
      if (selected && !all().some((r) => r.id === selected)) selected = null;
      render();
      onShow?.(visible(), selected);
    },
    select(id) { if (id !== selected) select(id); },
    /** „Planen“ für die gewählte Tour öffnen */
    plan(id) { if (all().some((r) => r.id === id)) { selected = id; openPlan(id); } },
    get planning() { return planning?.id || null; },
    /** Eigene oder gespeicherte Route oben einfügen und auswählen */
    addCustom(tour, forPeak) {
      if (imported.some((x) => x.id === tour.id)) { select(tour.id); return; }
      this.addImport(tour, forPeak);
    },
    /** Importierte Tour oben einfügen und auswählen */
    addImport(tour, forPeak) {
      if (forPeak && forPeak !== peak) { peak = forPeak; routes = []; imported = []; }
      imported.unshift(tour);
      filter = 'all';
      diff = 'all';
      selected = tour.id;
      render();
      onShow?.(visible(), selected);
      onSelect?.(tour.id, true);
    },
    /** neu zeichnen (z. B. andere Farben) – Liste und Karte */
    refresh() { if (!planning) render(); onShow?.(visible(), selected); },
    get selected() { return selected; },
    get visible() { return visible(); },
  };
}

function dirDative(dir) {
  // "Süd" → "Süden", "Nordost" → "Nordosten"
  return { Nord: 'Norden', Ost: 'Osten', Süd: 'Süden', West: 'Westen', Nordost: 'Nordosten', Südost: 'Südosten', Südwest: 'Südwesten', Nordwest: 'Nordwesten' }[dir] || dir;
}
