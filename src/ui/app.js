// Als App auf dem Handy: Service Worker (ohne Empfang starten), Hinweis zum Installieren
// auf dem iPhone, Meldungen bei verlorenem/wiederhergestelltem Netz.

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = () => /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);

export function setupApp({ toast }) {
  document.documentElement.classList.toggle('is-standalone', standalone());

  // Service Worker nur in der veröffentlichten Version (im Dev-Server stört er beim Entwickeln)
  // (lokal zum Ausprobieren mit ?sw=1)
  if ('serviceWorker' in navigator && (import.meta.env?.PROD || new URLSearchParams(location.search).has('sw'))) {
    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js');
        const reg = await navigator.serviceWorker.ready;
        // geladene Dateien (Skripte, Stile) für den Start ohne Netz merken
        const urls = performance.getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin) && /\/(assets|icons)\//.test(u));
        reg.active?.postMessage({ type: 'cache-urls', urls: ['/', ...urls] });
      } catch (e) {
        console.info('Offline-Modus nicht verfügbar:', e.message);
      }
    };
    // setupApp läuft oft erst nach dem „load“-Ereignis – dann sofort registrieren
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  const setOffline = (off) => document.documentElement.classList.toggle('is-offline', off);
  setOffline(navigator.onLine === false);
  window.addEventListener('offline', () => { setOffline(true); toast('Kein Empfang – Gipfelplan zeigt gespeicherte Routen und Karten.'); });
  window.addEventListener('online', () => { setOffline(false); toast('Wieder online'); });
}

/** Hinweis „Zum Home-Bildschirm“ – nur iPhone/iPad in Safari, nur einmal */
export function maybeShowInstallHint() {
  if (standalone() || !isIOS() || !isSafari()) return;
  try { if (localStorage.getItem('gp.installHint')) return; } catch { return; }
  const el = document.createElement('div');
  el.className = 'install-hint';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <img src="/icons/apple-touch-icon.png" alt="" width="44" height="44" />
    <div><b>Gipfelplan als App</b>
      <span>Tippe unten auf <svg class="ih-share" viewBox="0 0 24 24" aria-label="Teilen"><path d="M12 3v12M8 7l4-4 4 4M6 11v8h12v-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> und dann auf <b>„Zum Home-Bildschirm“</b>. Gespeicherte Routen gehen dann auch ohne Empfang.</span></div>
    <button class="icon-btn" aria-label="Schließen">✕</button>`;
  document.body.append(el);
  el.querySelector('button').addEventListener('click', () => {
    el.remove();
    try { localStorage.setItem('gp.installHint', '1'); } catch { /* egal */ }
  });
}
