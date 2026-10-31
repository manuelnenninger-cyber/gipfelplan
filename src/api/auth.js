// Anmeldung ohne Passwort: E-Mail eingeben → 6-stelliger Code (oder Link) aus der Mail.
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

export const isConfigured = () => !!(ACCOUNTS.url && ACCOUNTS.anonKey);
export const user = () => (session?.user ? { id: session.user.id, email: session.user.email } : null);
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function call(path, body, { token, timeout = 12000 } = {}) {
  const res = await fetchWithTimeout(`${ACCOUNTS.url}/auth/v1/${path}`, {
    method: 'POST',
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
  if (status === 429 || /rate limit|security purposes|too many/i.test(raw)) return 'Zu viele Versuche. Bitte in einer Minute noch einmal.';
  if (/expired|invalid|otp/i.test(raw)) return 'Der Code ist falsch oder abgelaufen.';
  if (/email/i.test(raw) && /valid|format/i.test(raw)) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  return raw || `Anmeldung fehlgeschlagen (${status})`;
}

function withExpiry(s) {
  return { ...s, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) };
}

/** Schritt 1: Code (und Anmeldelink) per Mail schicken; legt das Konto bei Bedarf an */
export async function sendCode(email) {
  const back = `${location.origin}${location.pathname}`;
  await call(`otp?redirect_to=${encodeURIComponent(back)}`, { email: email.trim(), create_user: true });
}

/** Schritt 2: Code prüfen → angemeldet */
export async function verifyCode(email, code) {
  const token = code.replace(/\D/g, '');
  let data;
  try {
    data = await call('verify', { type: 'email', email: email.trim(), token });
  } catch (e) {
    // ältere Projekte unterscheiden noch zwischen Anmeldung und Registrierung
    data = await call('verify', { type: 'signup', email: email.trim(), token }).catch(() => { throw e; });
  }
  if (!data.access_token) throw new Error('Anmeldung fehlgeschlagen.');
  store(withExpiry(data));
  return user();
}

/** Wurde die Seite über den Link aus der Mail geöffnet? Dann Sitzung übernehmen. */
export function consumeRedirect() {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error_description)=/.test(h)) return false;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error_description')) return { error: p.get('error_description').replace(/\+/g, ' ') };
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
  return { ok: true };
}

let refreshing = null;
/** gültiges Zugriffstoken (erneuert es bei Bedarf); null = nicht angemeldet */
export async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  refreshing ||= call('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    .then((d) => { store(withExpiry({ ...d, user: d.user || session.user })); return session.access_token; })
    .catch((e) => {
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
