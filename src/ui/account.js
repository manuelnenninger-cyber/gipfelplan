// Konto: Anmeldung nur bei Bedarf (z. B. beim Speichern), „Meine Touren“, Abmelden.
// Anmelden mit E-Mail und Passwort, Konto anlegen, Passwort vergessen/neu setzen.
import { isConfigured, user, onAuthChange, signIn, signUp, requestReset, verifyResetCode, updatePassword, signOut } from '../api/auth.js';
import { listTours, deleteTour, forgetLocalTours } from '../api/tours.js';
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
  let step = 'login'; // 'login' | 'signup' | 'forgot' | 'sent' | 'confirm' | 'newpw'
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
  const TITLES = { login: 'Anmelden', signup: 'Konto erstellen', forgot: 'Passwort vergessen', sent: 'Mail ist unterwegs', confirm: 'E-Mail bestätigen', newpw: 'Neues Passwort' };
  const MIN_PW = 8;

  const emailField = () => `<label class="acct-field">${icon('mail')}<input type="email" name="email" placeholder="deine@email.de" autocomplete="username" inputmode="email" autocapitalize="off" required value="${escapeHtml(email)}" /></label>`;
  const pwField = (kind, placeholder) => `<label class="acct-field">${icon('lock')}<input type="password" name="password" placeholder="${placeholder}" autocomplete="${kind}" required ${kind === 'new-password' ? `minlength="${MIN_PW}"` : ''} />
      <button type="button" class="acct-eye" aria-label="Passwort zeigen">${icon('eye')}</button></label>`;
  const goBtn = (label) => `${error ? `<p class="acct-error">${escapeHtml(error)}</p>` : ''}
      <button class="btn btn-primary acct-go" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : ''}${label}</button>`;

  function renderLogin() {
    const head = `<header class="acct-head"><h2 id="acct-title">${TITLES[step]}</h2>
      <button class="icon-btn acct-x" aria-label="Schließen">${icon('x')}</button></header>`;
    let body = '';
    if (step === 'login') {
      body = `<p class="acct-lead">${escapeHtml(reason || 'Melde dich an, um Touren zu speichern und überall wiederzufinden.')}</p>
        <form class="acct-form">${emailField()}${pwField('current-password', 'Passwort')}${goBtn('Anmelden')}</form>
        <p class="acct-fine"><button class="acct-link" data-go="forgot">Passwort vergessen?</button></p>
        <p class="acct-switch">Neu bei Gipfelplan? <button class="acct-link" data-go="signup">Konto erstellen</button></p>`;
    } else if (step === 'signup') {
      body = `<p class="acct-lead">${escapeHtml(reason || 'Mit einem Konto findest du gespeicherte Touren auf jedem Gerät wieder.')}</p>
        <form class="acct-form">${emailField()}${pwField('new-password', `Passwort (mind. ${MIN_PW} Zeichen)`)}${goBtn('Konto erstellen')}</form>
        <p class="acct-switch">Schon ein Konto? <button class="acct-link" data-go="login">Anmelden</button></p>`;
    } else if (step === 'forgot') {
      body = `<p class="acct-lead">Gib deine E-Mail-Adresse ein. Du bekommst eine Mail, mit der du ein neues Passwort festlegst. Das geht auch, wenn du bisher ohne Passwort angemeldet warst.</p>
        <form class="acct-form">${emailField()}${goBtn('Mail senden')}</form>
        <p class="acct-switch"><button class="acct-link" data-go="login">Zurück zur Anmeldung</button></p>`;
    } else if (step === 'sent') {
      body = `<p class="acct-lead">Wir haben dir eine Mail an <b>${escapeHtml(email)}</b> geschickt. Tippe auf den Link darin, dann kannst du ein neues Passwort festlegen. Steht ein Code in der Mail, gib ihn hier ein.</p>
        <form class="acct-form"><input class="acct-code" name="code" placeholder="Code (falls in der Mail)" autocomplete="one-time-code" inputmode="numeric" maxlength="10" required />${goBtn('Weiter')}</form>
        <p class="acct-switch"><button class="acct-link" data-go="login">Zurück zur Anmeldung</button></p>`;
    } else if (step === 'confirm') {
      body = `<p class="acct-lead">Fast geschafft: Wir haben dir eine Mail an <b>${escapeHtml(email)}</b> geschickt. Tippe auf den Link darin, um deine Adresse zu bestätigen – danach kannst du dich hier anmelden.</p>
        <p class="acct-switch"><button class="acct-link" data-go="login">Zur Anmeldung</button></p>`;
    } else if (step === 'newpw') {
      body = `<p class="acct-lead">Lege ein neues Passwort für <b>${escapeHtml(user()?.email || email)}</b> fest.</p>
        <form class="acct-form"><input type="email" name="email" autocomplete="username" value="${escapeHtml(user()?.email || email)}" hidden />${pwField('new-password', `Neues Passwort (mind. ${MIN_PW} Zeichen)`)}${goBtn('Passwort speichern')}</form>`;
    }
    box.innerHTML = head + body;
    box.querySelector('.acct-x').addEventListener('click', () => close(null));
    const form = box.querySelector('form');
    form?.addEventListener('submit', (e) => { e.preventDefault(); submit(new FormData(form)); });
    box.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      const em = box.querySelector('input[name=email]')?.value;
      if (em) email = em.trim();
      step = b.dataset.go; error = ''; renderLogin();
    }));
    box.querySelector('.acct-eye')?.addEventListener('click', (e) => {
      const inp = e.currentTarget.parentElement.querySelector('input');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      e.currentTarget.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort zeigen');
      e.currentTarget.classList.toggle('is-on', show);
    });
    setTimeout(() => {
      const first = [...box.querySelectorAll('input:not([hidden])')].find((i) => !i.value) || box.querySelector('input:not([hidden])');
      first?.focus();
    }, 30);
  }

  async function submit(fd) {
    if (busy) return;
    if (fd.has('email') && step !== 'newpw') email = String(fd.get('email') || '').trim();
    const pw = String(fd.get('password') || '');
    busy = true; error = ''; renderLogin();
    try {
      if (step === 'login') {
        const u = await signIn(email, pw);
        return done(u, `Angemeldet als ${u.email}`);
      }
      if (step === 'signup') {
        if (pw.length < MIN_PW) throw new Error(`Das Passwort braucht mindestens ${MIN_PW} Zeichen.`);
        const r = await signUp(email, pw);
        if (r.user) return done(r.user, 'Willkommen bei Gipfelplan – dein Konto ist angelegt.');
        step = 'confirm';
      } else if (step === 'forgot') {
        await requestReset(email);
        step = 'sent';
      } else if (step === 'sent') {
        await verifyResetCode(email, String(fd.get('code') || ''));
        step = 'newpw';
      } else if (step === 'newpw') {
        if (pw.length < MIN_PW) throw new Error(`Das Passwort braucht mindestens ${MIN_PW} Zeichen.`);
        await updatePassword(pw);
        return done(user(), 'Neues Passwort gespeichert.');
      }
    } catch (e) {
      error = e.message;
      // Bisher per Mail-Link angemeldet → hat noch kein Passwort
      if (step === 'login' && /stimmt nicht/.test(error)) error += ' Noch kein Passwort festgelegt? Dann über „Passwort vergessen?“.';
    }
    busy = false;
    renderLogin();
  }

  function done(u, msg) {
    busy = false;
    toast?.(msg);
    close(u);
  }

  // --- Meine Touren ----------------------------------------------------------------
  async function renderMine() {
    const u = user();
    box.innerHTML = `
      <header class="acct-head"><h2 id="acct-title">Meine Touren</h2>
        <button class="icon-btn acct-x" aria-label="Schließen">${icon('x')}</button></header>
      ${tours?.offline ? `<p class="offline-note">${icon('alert')}<span>Ohne Empfang – zuletzt geladene Liste</span></p>` : ''}
      <div class="acct-list">${tours == null ? '<p class="acct-lead acct-loading"><span class="spinner"></span> Lade …</p>' : list()}</div>
      <footer class="acct-foot"><span class="acct-mail">${icon('user')}${escapeHtml(u?.email || '')}</span>
        <button class="acct-link acct-out">${icon('logout')}Abmelden</button></footer>`;
    box.querySelector('.acct-x').addEventListener('click', () => close(null));
    box.querySelector('.acct-out').addEventListener('click', async () => { await signOut(); forgetLocalTours(); tours = null; close(null); toast?.('Abgemeldet'); });
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
    step = 'login';
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
  onAuthChange((u) => {
    updateButton();
    // Link aus der Mail in einem anderen Tab geöffnet → hier wartender Dialog ist erledigt
    if (u && !root.hidden && waiting && ['login', 'signup', 'confirm'].includes(step)) { toast?.(`Angemeldet als ${u.email}`); close(u); }
  });
  updateButton();

  /** nach dem Link aus „Passwort vergessen“: neues Passwort festlegen */
  function askNewPassword() {
    if (!user()) return;
    step = 'newpw'; error = ''; busy = false;
    root.hidden = false;
    renderLogin();
  }

  return { requireLogin, openMine, askNewPassword, refresh: updateButton };
}
