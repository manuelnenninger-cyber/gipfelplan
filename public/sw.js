// Gipfelplan – Service Worker: App ohne Empfang starten, Karten und Daten aus dem Zwischenspeicher.
// Bei Änderungen an der Seite VERSION erhöhen (nur der App-Speicher wird erneuert; Karten und Daten bleiben).
const VERSION = 'v2';
const SHELL = `gp-shell-${VERSION}`;   // Seite, Skripte, Stile, Symbole
const TILES = 'gp-tiles-v1';   // Kartenkacheln, Schriften, Geländedaten
const DATA = 'gp-data-v1';     // Wetter, Routen, Suche (letzte Antworten)
const LIMITS = { [TILES]: 6000, [DATA]: 400 };

// Kacheln ändern sich selten → erst Zwischenspeicher, dann Netz
const TILE_HOSTS = [
  'tiles.openfreemap.org', 'tile.opentopomap.org', 'a.tile.opentopomap.org', 'b.tile.opentopomap.org', 'c.tile.opentopomap.org',
  'server.arcgisonline.com', 's3.amazonaws.com', 'tile.waymarkedtrails.org', 'cdn.jsdelivr.net',
  'gibs.earthdata.nasa.gov', // Satellitenbilder: Datum steht in der Adresse, ändern sich nicht
];
// Daten: erst Netz (aktuell), ohne Empfang die letzte Antwort
const DATA_HOSTS = [
  'api.open-meteo.com', 'photon.komoot.io', 'nominatim.openstreetmap.org', 'hiking.waymarkedtrails.org',
  'static.avalanche.report', 'commons.wikimedia.org', 'upload.wikimedia.org', 'www.wikidata.org',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL, TILES, DATA];
    for (const k of await caches.keys()) if (k.startsWith('gp-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Die Seite meldet nach dem Laden, welche Dateien sie geladen hat → für den nächsten Start ohne Netz
// Dabei Skripte älterer Versionen entfernen (Dateinamen enthalten einen Hash).
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache-urls') return;
  const wanted = new Set(e.data.urls.map((u) => new URL(u, self.location.origin).href));
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all([...wanted].map((u) => c.match(u).then((hit) => hit || c.add(u)).catch(() => {})));
    for (const k of await c.keys()) {
      if (new URL(k.url).pathname.startsWith('/assets/') && !wanted.has(k.url)) await c.delete(k);
    }
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.headers.has('range')) return; // Teilabrufe (Lawinenregionen) nicht zwischenspeichern

  // Seite selbst: aktuelle Version, bei schlechtem Netz nach 4 s die gespeicherte
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL, 4000, '/'));
    return;
  }
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/webcams')) return; // Bild-Adressen laufen ohnehin ab
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) { e.respondWith(cacheFirst(req, SHELL)); return; }
    if (url.pathname.startsWith('/proxy/')) { e.respondWith(networkFirst(req, DATA, 12000)); return; }
    e.respondWith(networkFirst(req, SHELL, 4000));
    return;
  }
  if (url.hostname.endsWith('supabase.co')) return; // Konto: nie zwischenspeichern
  if (url.hostname === 'api.windy.com' || url.hostname.includes('imgproxy')) return;
  if (TILE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    // Stil und TileJSON können sich ändern → erst Netz; Kacheln selbst → erst Speicher
    const meta = /\/styles\/|\/planet$|\.json$/.test(url.pathname);
    e.respondWith(meta ? networkFirst(req, TILES, 5000) : cacheFirst(req, TILES));
    return;
  }
  if (DATA_HOSTS.some((h) => url.hostname === h)) {
    e.respondWith(networkFirst(req, DATA, 12000));
  }
});

// OpenFreeMap legt jede Woche einen neuen Kartenstand an (/planet/<datum>/z/x/y.pbf).
// Gespeichert wird ohne Datum, damit vorab geladene Kacheln auch nach einem Wechsel
// ohne Empfang noch passen; online wird eine Kachel mit anderem Datum neu geholt.
function cacheKey(url) {
  return url.replace(/^(https:\/\/tiles\.openfreemap\.org\/planet)\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, '$1/any/$2');
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const key = cacheKey(req.url);
  const hit = await cache.match(key);
  if (hit && (key === req.url || hit.url === req.url)) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') { cache.put(key, res.clone()); trim(name); }
    return res;
  } catch (err) {
    if (hit) return hit; // anderer Kartenstand, aber besser als nichts
    throw err;
  }
}

// Erst Netz. Dauert es länger als `timeout` und gibt es eine gespeicherte Antwort, kommt
// diese; sonst wird weiter auf das Netz gewartet (Routenberechnung kann dauern).
async function networkFirst(req, name, timeout, fallbackUrl) {
  const cache = await caches.open(name);
  const cached = () => cache.match(req).then((hit) => hit || (fallbackUrl && cache.match(fallbackUrl)));
  const net = fetch(req).then((res) => {
    if (res.ok) { cache.put(fallbackUrl || req, res.clone()); trim(name); }
    return res;
  });
  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(async () => { const hit = await cached(); if (hit) resolve(hit); }, timeout);
  });
  try {
    return await Promise.race([net, slow]);
  } catch (err) {
    const hit = await cached();
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Zwischenspeicher begrenzen: älteste Einträge zuerst raus
let trimming = {};
function trim(name) {
  const max = LIMITS[name];
  if (!max || trimming[name]) return;
  trimming[name] = setTimeout(async () => {
    trimming[name] = null;
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  }, 5000);
}
