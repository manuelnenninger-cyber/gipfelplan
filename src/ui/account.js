// Konto: Anmeldung nur bei Bedarf (z. B. beim Speichern), „Meine Touren“, Abmelden.
import { isConfigured, user, onAuthChange, sendCode, verifyCode, signOut } from '../api/auth.js';
import { listTours, deleteTour } from '../api/tours.js';
import { icon } from './icons.js';
import { escapeHtml, fmtKm, fmtInt, fmtDuration } from '../util/format.js';

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });

export function createAccount({ onOpenTour, toast }) {
  const btn = document.getElementById('btn-account');
  const root = document.createElement('div');
  root.className = 'acct-backdrop';
  root.hidden = true;
  root.innerHTML = '<div class="acct" role="dialog" aria-modal="true" aria-labelledby="acct-title"></div>';
  document.body.append(root);
  const box = root.querySelector('.acct');

  let waiting = null; // Promise-Auflösung für requireLogin
  let email = '';
  let step = 'email';
  let busy = false;
  let error = '';
  let reason = '';
  let tours = null;

  function updateButton() {
    const u = user();
    btn.classList.toggle('is-signed-in', !!u);
    btn.innerHTML = u ? `<span class="acct-avatar">${escapeHtml((u.email || '?')[0].toUpperCase())}</span>` : icon('user');
    btn.setAttribute('aria-label', u ? `Konto: ${u.email}` : 'Anmelden');
  }

  function close(result = null) {
    root.hidden = true;
    error = '';
    const w = waiting;
    waiting = null;
    w?.(result);
  }

  // --- Anmelden ------------------------------------------------------------------
  function renderLogin() {
    const head = `<header class="acct-head"><h2 id="acct-title">${step === 'email' ? 'Anmelden' : 'Code eingeben'}</h2>
      <button class="icon-btn acct-x" aria-label="Schließen">${icon('x')}</button></header>`;
    if (step === 'email') {
      box.innerHTML = `${head}
        <p class="acct-lead">${escapeHtml(reason || 'Melde dich an, um Touren zu speichern und überall wiederzufinden.')}</p>
        <form class="acct-form">
          <label class="acct-field">${icon('mail')}<input type="email" name="email" placeholder="deine@email.de" autocomplete="email" inputmode="email" required value="${escapeHtml(email)}" /></label>
          ${error ? `<p class="acct-error">${escapeHtml(error)}</p>` : ''}
          <button class="btn btn-primary acct-go" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : ''}Code per E-Mail senden</button>
        </form>
        <p class="acct-fine">Kein Passwort nötig: Du bekommst einen Code per Mail. Neu hier? Dann wird dein Konto dabei automatisch angelegt.</p>`;
    } else {
      box.innerHTML = `${head}
        <p class="acct-lead">Wir haben dir eine Mail an <b>${escapeHtml(email)}</b> geschickt. Gib den Code daraus ein – oder tippe einfach auf den Link in der Mail.</p>
        <form class="acct-form">
          <input class="acct-code" name="code" placeholder="123456" autocomplete="one-time-code" inputmode="numeric" maxlength="10" required />
          ${error ? `<p class="acct-error">${escapeHtml(error)}</p>` : ''}
          <button class="btn btn-primary acct-go" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : ''}Anmelden</button>
        </form>
        <p class="acct-fine"><button class="acct-link acct-back">Andere E-Mail</button> · <button class="acct-link acct-resend">Code erneut senden</button></p>`;
    }
    box.querySelector('.acct-x').addEventListener('click', () => close(null));
    const form = box.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(new FormData(form)); });
    box.querySelector('.acct-back')?.addEventListener('click', () => { step = 'email'; error = ''; renderLogin(); });
    box.querySelector('.acct-resend')?.addEventListener('click', () => submitEmail(email, true));
    setTimeout(() => box.querySelector('input')?.focus(), 30);
  }

  async function submitEmail(value, resend = false) {
    email = value.trim();
    busy = true; error = ''; renderLogin();
    try {
      await sendCode(email);
      step = 'code';
      if (resend) toast?.('Neuer Code ist unterwegs.');
    } catch (e) {
      error = e.message;
    }
    busy = false;
    renderLogin();
  }

  async function submit(fd) {
    if (step === 'email') return submitEmail(String(fd.get('email') || ''));
    busy = true; error = ''; renderLogin();
    try {
      const u = await verifyCode(email, String(fd.get('code') || ''));
      busy = false;
      toast?.(`Angemeldet als ${u.email}`);
      close(u);
    } catch (e) {
      busy = false;
      error = e.message;
      renderLogin();
    }
  }

  // --- Meine Touren ----------------------------------------------------------------
  async function renderMine() {
    const u = user();
    box.innerHTML = `
      <header class="acct-head"><h2 id="acct-title">Meine Touren</h2>
        <button class="icon-btn acct-x" aria-label="Schließen">${icon('x')}</button></header>
      <div class="acct-list">${tours == null ? '<p class="acct-lead"><span class="spinner"></span> Lade …</p>' : list()}</div>
      <footer class="acct-foot"><span class="acct-mail">${icon('user')}${escapeHtml(u?.email || '')}</span>
        <button class="acct-link acct-out">${icon('logout')}Abmelden</button></footer>`;
    box.querySelector('.acct-x').addEventListener('click', () => close(null));
    box.querySelector('.acct-out').addEventListener('click', async () => { await signOut(); tours = null; close(null); toast?.('Abgemeldet'); });
    box.querySelectorAll('.acct-tour').forEach((b) => b.addEventListener('click', () => {
      const t = tours.find((x) => x.savedId === b.dataset.id);
      if (t) { close(null); onOpenTour?.(t); }
    }));
    box.querySelectorAll('.acct-del').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      b.disabled = true;
      try {
        await deleteTour(id);
        tours = tours.filter((x) => x.savedId !== id);
        renderMine();
      } catch (err) { toast?.(err.message); b.disabled = false; }
    }));
  }

  function list() {
    if (!tours.length) return '<p class="acct-lead">Noch keine Touren gespeichert. Öffne eine Tour und tippe auf „Speichern“.</p>';
    return `<ul>${tours.map((t) => `
      <li><button class="acct-tour" data-id="${t.savedId}">
        <span class="acct-tour-main"><b>${escapeHtml(t.title)}</b>
          <small>${escapeHtml([t.peak?.name, dateFmt.format(new Date(t.savedAt))].filter(Boolean).join(' · '))}</small>
          <small class="acct-stats">${fmtKm(t.length)} · ↑ ${fmtInt(t.up)} m · ${fmtDuration(t.oneWay || t.isLoop ? t.timeTotal : t.timeUp)}${t.sac ? ` · T${t.sac}` : ''}</small></span>
        <span class="acct-del" role="button" data-id="${t.savedId}" aria-label="Löschen">${icon('trash')}</span>
      </button></li>`).join('')}</ul>`;
  }

  async function openMine() {
    root.hidden = false;
    tours = null;
    renderMine();
    try { tours = await listTours(); } catch (e) { tours = []; toast?.(e.message); }
    if (!root.hidden) renderMine();
  }

  // --- öffentliche Schnittstelle --------------------------------------------------
  /** Sicherstellen, dass jemand angemeldet ist. Fragt nur, wenn nötig. */
  function requireLogin(why) {
    if (!isConfigured()) { toast?.('Speichern ist auf diesem Server noch nicht eingerichtet.'); return Promise.resolve(null); }
    if (user()) return Promise.resolve(user());
    reason = why || '';
    step = 'email';
    error = '';
    root.hidden = false;
    renderLogin();
    return new Promise((res) => { waiting = res; });
  }

  btn.addEventListener('click', () => {
    if (!isConfigured()) { toast?.('Konten sind auf diesem Server noch nicht eingerichtet.'); return; }
    if (user()) openMine();
    else requireLogin('Melde dich an, um Touren und eigene Routen zu speichern – auf jedem Gerät.').then((u) => { if (u) openMine(); });
  });
  root.addEventListener('click', (e) => { if (e.target === root) close(null); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close(null); });
  onAuthChange(updateButton);
  updateButton();

  return { requireLogin, openMine, refresh: updateButton };
}
