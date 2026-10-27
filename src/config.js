// Alle externen Dienste an einer Stelle. BRouter und Overpass laufen über die
// Proxy-Pfade /proxy/… – lokal im Vite-Dev-Server, online über vercel.json.
export const API = {
  // Gipfelsuche (OSM, von komoot betrieben)
  photon: 'https://photon.komoot.io/api/',
  // Exakte Gipfelhöhen (OSM-Tag ele), max. 1 Abruf pro Sekunde
  nominatimLookup: 'https://nominatim.openstreetmap.org/lookup',
  // Markierte, benannte Wanderwege aus OSM
  waymarked: 'https://hiking.waymarkedtrails.org/api/v1',
  // OSM-Abfragen für Parkplätze, Hütten, Bahnen …
  overpass: ['/proxy/ovp-main/api/interpreter', '/proxy/ovp-alt/api/interpreter', '/proxy/ovp-kumi/api/interpreter'],
  // Wander-Routing mit Höhendaten
  brouter: '/proxy/brouter/brouter',
  brouterProfile: 'hiking-mountain',
  // Wetter (frei, ohne Schlüssel)
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  openMeteoElevation: 'https://api.open-meteo.com/v1/elevation',
  // Niederschlagsradar, letzte 2 Stunden
  rainviewer: 'https://api.rainviewer.com/public/weather-maps.json',
};

export const MAP_STYLES = {
  standard: 'https://tiles.openfreemap.org/styles/liberty',
  topo: {
    version: 8,
    // Schriften für Gipfelnamen und Höhenlinien-Beschriftung
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      topo: {
        type: 'raster',
        tiles: [
          'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 17,
        attribution:
          'Karte: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), Daten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
  },
  satellite: {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      sat: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Bilder © Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  },
};

export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TRAILS_TILES = 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png';

export const ROUTE_COLORS = ['#2f4fd6', '#e0563b', '#13a37f', '#b04fd1', '#d9930d', '#1c8fc4'];
