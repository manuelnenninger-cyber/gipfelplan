// Kleiner dauerhafter Zwischenspeicher im Browser (IndexedDB). Wetterraster sind
// groß und zählen beim Wetterdienst gegen das Kontingent – nach einem Neuladen der
// Seite sollen sie nicht erneut abgerufen werden. Fehler werden ignoriert.
const DB = 'gipfelplan';
const STORE = 'cache';
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
const db = () => (dbPromise ||= openDb());

export async function cacheGet(key, maxAgeMs) {
  try {
    const d = await db();
    if (!d) return null;
    return await new Promise((resolve) => {
      const req = d.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v && Date.now() - v.t < maxAgeMs ? v.data : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function cacheSet(key, data) {
  try {
    const d = await db();
    if (!d) return;
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
    store.put({ t: Date.now(), data }, key);
    // alte Einträge (älter als 6 h) gelegentlich aufräumen
    if (Math.random() < 0.1) {
      const cur = store.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        if (Date.now() - c.value.t > 6 * 3600 * 1000) c.delete();
        c.continue();
      };
    }
  } catch { /* ohne Cache weiter */ }
}
