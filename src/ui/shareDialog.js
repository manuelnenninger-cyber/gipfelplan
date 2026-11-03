// „Tour teilen“: Link erzeugen, dann Teilen (Systemmenü), WhatsApp oder Link kopieren.
// Der Dialog öffnet sofort; der Link kommt nach, sobald die Tour gespeichert ist.
import { icon } from './icons.js';
import { escapeHtml } from '../util/format.js';

/**
 * @param o.title Titel der Tour, o.summary Eckdaten („Schwer (T4) · 5:05 h · …“)
 * @param o.getUrl () => Promise<string>
 */
export function openShareDialog({ title, summary, getUrl, toast }) {
  const root = document.createElement('div');
  root.className = 'acct-backdrop share-backdrop';
  root.innerHTML = `<div class="acct share" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <header class="acct-head"><h2 id="share-title">Tour teilen</h2>
        <button class="icon-btn acct-x" aria-label="Schließen">${icon('x')}</button></header>
      <div class="share-card">
        <span class="share-pin">${icon('mountain')}</span>
        <div><b>${escapeHtml(title)}</b><small>${escapeHtml(summary)}</small></div>
      </div>
      <p class="acct-lead share-lead">Wer den Link öffnet, sieht die Tour mit Karte, Höhenprofil, Wetter und Startzeit – ohne Anmeldung. In WhatsApp & Co. erscheint eine Vorschau mit Karte.</p>
      <div class="share-body"><p class="status-line"><span class="spinner"></span>Link wird erstellt …</p></div>
    </div>`;
  document.body.append(root);
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('.acct-x').addEventListener('click', close);

  const body = root.querySelector('.share-body');
  getUrl().then((url) => {
    if (!root.isConnected) return;
    const text = `${title} – geplant mit Gipfelplan`;
    const canShare = typeof navigator.share === 'function';
    body.innerHTML = `
      <label class="share-link"><input readonly value="${escapeHtml(url)}" aria-label="Link zur Tour" /></label>
      <div class="share-actions">
        ${canShare ? `<button class="btn btn-primary share-native">${icon('share')}Teilen …</button>` : ''}
        <a class="btn share-wa" href="https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}" target="_blank" rel="noopener">${icon('chat')}WhatsApp</a>
        <button class="btn share-copy">${icon('copy')}Link kopieren</button>
      </div>`;
    const input = body.querySelector('input');
    input.addEventListener('focus', () => input.select());
    body.querySelector('.share-native')?.addEventListener('click', async () => {
      try { await navigator.share({ title: text, text, url }); close(); } catch (e) { if (e.name !== 'AbortError') toast?.('Teilen nicht möglich – kopiere den Link.'); }
    });
    body.querySelector('.share-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); } catch { input.focus(); input.select(); document.execCommand?.('copy'); }
      toast?.('Link kopiert');
      const b = body.querySelector('.share-copy');
      b.innerHTML = `${icon('copy')}Kopiert`;
    });
  }).catch((e) => {
    if (root.isConnected) body.innerHTML = `<p class="acct-error">${escapeHtml(e.message)}</p>`;
  });
  return { close };
}
