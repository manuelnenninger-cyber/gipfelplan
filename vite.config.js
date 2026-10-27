import { defineConfig } from 'vite';

// Routing (BRouter) und OSM-Abfragen (Overpass) laufen über einen kleinen
// Proxy des Dev-Servers. So gibt es keine CORS-Probleme und wir senden einen
// sauberen User-Agent, wie es die Betreiber erbitten.
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

export default defineConfig({
  server: { port: 5173, open: true, proxy },
  preview: { port: 4173, proxy },
});
