// Anmeldung mit E-Mail und Passwort; „Passwort vergessen“ per Mail (Link oder Code).
// Spricht direkt mit Supabase Auth (REST), ohne zusätzliche Bibliothek.
import { ACCOUNTS } from '../config.js';
import { fetchWithTimeout } from './osm.js';

const KEY = 'gp.session';
const listeners = new Set();
let session = load();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function store(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* privates Fenster */ }
  listeners.forEach((fn) => fn(user()));
}

// Anmeldung in einem anderen Tab übernehmen (gleicher Browser, gleiche Adresse)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    session = load();
    listeners.forEach((fn) => fn(user()));
  });
}

export const isConfigured = () => !!(ACCOUNTS.url && ACCOUNTS.anonKey);
export const user = () => (session?.user ? { id: session.user.id, email: session.user.email } : null);
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function call(path, body, { token, timeout = 12000, method = 'POST' } = {}) {
  const res = await fetchWithTimeout(`${ACCOUNTS.url}/auth/v1/${path}`, {
    method,
    timeout,
    headers: {
      apikey: ACCOUNTS.anonKey,
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(authMessage(data, res.status));
  return data;
}

/** verständliche Fehlermeldungen */
export function authMessage(data, status) {
  const raw = `${data?.msg || data?.error_description || data?.message || data?.error || ''}`;
  const code = `${data?.error_code || data?.code || ''}`;
  if (status === 429 || /rate limit|security purposes|too many/i.test(raw)) return 'Zu viele Versuche. Bitte in einer Minute noch einmal.';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) return 'E-Mail oder Passwort stimmt nicht.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) return 'Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Mail.';
  if (code === 'user_already_exists' || /already registered|already exists/i.test(raw)) return 'Für diese E-Mail gibt es schon ein Konto. Melde dich an oder nutze „Passwort vergessen?“.';
  if (code === 'weak_password' || /password should|weak password|at least \d+ characters/i.test(raw)) return 'Das Passwort ist zu kurz oder zu einfach (mindestens 8 Zeichen).';
  if (code === 'same_password' || /different from the old/i.test(raw)) return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (/expired|invalid|otp/i.test(raw)) return 'Der Code ist falsch oder abgelaufen.';
  if (/email/i.test(raw) && /valid|format/i.test(raw)) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  return raw || `Anmeldung fehlgeschlagen (${status})`;
}

function withExpiry(s) {
  return { ...s, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) };
}

const back = () => `${location.origin}${location.pathname}`;
const clean = (email) => email.trim().toLowerCase();

/** Anmelden mit E-Mail und Passwort */
export async function signIn(email, password) {
  const data = await call('token?grant_type=password', { email: clean(email), password });
  store(withExpiry(data));
  return user();
}

/**
 * Konto anlegen. Ist in Supabase „Confirm email“ aus, ist man sofort angemeldet
 * (→ { user }); sonst kommt erst eine Bestätigungsmail (→ { confirm: true }).
 */
export async function signUp(email, password) {
  const data = await call(`signup?redirect_to=${encodeURIComponent(back())}`, { email: clean(email), password });
  if (data.access_token) { store(withExpiry(data)); return { user: user() }; }
  return { confirm: true };
}

/** Passwort vergessen: Mail mit Link (und je nach Vorlage Code) schicken */
export async function requestReset(email) {
  await call(`recover?redirect_to=${encodeURIComponent(back())}`, { email: clean(email) });
}

/** Code aus der „Passwort vergessen“-Mail prüfen → angemeldet, danach neues Passwort setzen */
export async function verifyResetCode(email, code) {
  const data = await call('verify', { type: 'recovery', email: clean(email), token: code.replace(/\D/g, '') });
  if (!data.access_token) throw new Error('Der Code ist falsch oder abgelaufen.');
  store(withExpiry(data));
  return user();
}

/** Neues Passwort für das angemeldete Konto */
export async function updatePassword(password) {
  const token = await accessToken();
  if (!token) throw new Error('Bitte erst anmelden.');
  await call('user', { password }, { token, method: 'PUT' });
}

/** Wurde die Seite über den Link aus der Mail geöffnet? Dann Sitzung übernehmen. */
export function consumeRedirect() {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error_description)=/.test(h)) return false;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error_description')) {
    const expired = p.get('error_code') === 'otp_expired' || /expired|invalid/i.test(p.get('error_description'));
    return { error: expired ? 'Der Link ist abgelaufen oder wurde schon benutzt.' : p.get('error_description').replace(/\+/g, ' ') };
  }
  const s = {
    access_token: p.get('access_token'),
    refresh_token: p.get('refresh_token'),
    expires_in: Number(p.get('expires_in')) || 3600,
    expires_at: Number(p.get('expires_at')) || undefined,
  };
  // Nutzerdaten stehen im Token (JWT)
  try {
    const claims = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    s.user = { id: claims.sub, email: claims.email };
  } catch { return { error: 'Anmeldelink ungültig' }; }
  store(withExpiry(s));
  return { ok: true, type: p.get('type') || '' }; // 'recovery' = Link aus „Passwort vergessen“
}

let refreshing = null;
/** gültiges Zugriffstoken (erneuert es bei Bedarf); null = nicht angemeldet */
export async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  refreshing ||= call('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    .then((d) => { store(withExpiry({ ...d, user: d.user || session.user })); return session.access_token; })
    .catch((e) => {
      // Hat ein anderer Tab das Token gerade erneuert, dessen Sitzung übernehmen statt abzumelden
      const other = load();
      if (other?.refresh_token && other.refresh_token !== session?.refresh_token) { session = other; return other.access_token; }
      if (!/fetch|Zeitüberschreitung|network/i.test(e.message)) store(null); // abgelaufen → abmelden
      throw e;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function signOut() {
  const token = session?.access_token;
  store(null);
  if (token) await call('logout', {}, { token }).catch(() => {});
}
