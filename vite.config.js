import { defineConfig, loadEnv } from 'vite';
import { windyWebcams, CACHE_HEADER } from './server/webcams.js';

// Routing (BRouter) und OSM-Abfragen (Overpass) laufen über einen kleinen
// Proxy des Dev-Servers. So gibt es keine CORS-Probleme und wir senden einen
// sauberen User-Agent, wie es die Betreiber erbitten. Online übernimmt das vercel.json.
const UA = 'Gipfelplan/0.1 (lokale Entwicklung)';

const proxy = {
  '/proxy/brouter': {
    target: 'https://brouter.de',
    changeOrigin: true,
    headers: { 'User-Agent': UA },
    rewrite: (p) => p.replace(/^\/proxy\/brouter/, ''),
  },
  '/proxy/ovp-main': {
    target: 'https://overpass-api.de',
    changeOrigin: true,
    headers: { 'User-Agent': UA },
    rewrite: (p) => p.replace(/^\/proxy\/ovp-main/, ''),
  },
  '/proxy/ovp-kumi': {
    target: 'https://overpass.kumi.systems',
    changeOrigin: true,
    headers: { 'User-Agent': UA },
    rewrite: (p) => p.replace(/^\/proxy\/ovp-kumi/, ''),
  },
  '/proxy/ovp-alt': {
    target: 'https://overpass.private.coffee',
    changeOrigin: true,
    headers: { 'User-Agent': UA },
    rewrite: (p) => p.replace(/^\/proxy\/ovp-alt/, ''),
  },
};

/** /api/webcams lokal genauso wie die Vercel-Funktion (api/webcams.js) */
function webcamsApi(key) {
  const handle = async (req, res) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    let out;
    try { out = await windyWebcams(params, key); } catch (e) { out = { status: 502, body: { error: e.message } }; }
    res.statusCode = out.status;
    res.setHeader('Content-Type', 'application/json');
    if (out.status === 200) res.setHeader('Cache-Control', CACHE_HEADER);
    res.end(JSON.stringify(out.body));
  };
  return {
    name: 'gipfelplan-webcams',
    configureServer(server) { server.middlewares.use('/api/webcams', handle); },
    configurePreviewServer(server) { server.middlewares.use('/api/webcams', handle); },
  };
}

export default defineConfig(({ mode }) => {
  // Schlüssel aus .env.local (wird nicht eingecheckt)
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [webcamsApi(env.WINDY_WEBCAMS_KEY)],
    server: { port: 5173, open: true, proxy },
    preview: { port: 4173, proxy },
  };
});
