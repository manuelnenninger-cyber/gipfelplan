import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, bearing, ascentDescent, compassWord } from '../src/util/geo.js';
import { pickStarts, analyzeRoute, hikingTime, parseWayInfo, dedupeRoutes, toGPX } from '../src/api/routing.js';
import { buildForecast, assessDay, pressureLevelFor, wxKind, buildGrid } from '../src/api/weather.js';
import { renderField, pixelLookup, sliceAt, thunderRisk } from '../src/map/field.js';
import { fmtDuration, fmtKm } from '../src/util/format.js';

// Ehrwalder Sonnenspitze (ungefähr)
const peak = { name: 'Sonnenspitze', lat: 47.3876, lng: 10.9480, ele: 2417 };

test('Geo-Grundlagen', () => {
  const d = haversine([11, 47], [11, 48]);
  assert.ok(Math.abs(d - 111195) < 200);
  assert.equal(Math.round(bearing([11, 47], [11, 48])), 0);
  assert.equal(compassWord(180), 'Süd');
  assert.deepEqual(ascentDescent([1000, 1002, 1010, 1008, 1100, 1090, 1050]), { up: 100, down: 50 });
});

test('Gehzeit nach DAV-Formel', () => {
  // 8 km, 1200 Hm hoch: horizontal 2 h, vertikal 4 h → 4 + 1 = 5 h
  assert.equal(hikingTime(8000, 1200, 0), 5);
  assert.equal(fmtDuration(4.58), '4:35 h');
  assert.equal(fmtKm(6240), '6,2 km');
});

test('Startpunkte: verschiedene Richtungen, sinnvolle Entfernung', () => {
  const places = [
    { id: 'a', type: 'parking', name: 'P Ehrwald', lat: 47.400, lng: 10.920 }, // NW, ~2,5 km
    { id: 'b', type: 'parking', name: null, lat: 47.401, lng: 10.921 },         // gleiche Richtung
    { id: 'c', type: 'trailhead', name: 'Seebensee', lat: 47.365, lng: 10.955 },// S
    { id: 'd', type: 'parking', name: 'zu nah', lat: 47.388, lng: 10.950 },      // < 1,2 km
    { id: 'e', type: 'bus', name: 'Biberwier', lat: 47.385, lng: 10.890 },       // W
    { id: 'f', type: 'hut', name: 'Coburger Hütte', lat: 47.375, lng: 10.960 },  // Hütte: kein Start
    { id: 'g', type: 'parking', name: 'weit weg', lat: 47.50, lng: 10.95 },      // > 9 km
  ];
  const starts = pickStarts(peak, places);
  const ids = starts.map((s) => s.id).sort();
  assert.deepEqual(ids, ['a', 'c', 'e']);
});

function fakeRoute(id, from, to, n = 60, e0 = 1000, e1 = 2400) {
  const coords = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    coords.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, e0 + (e1 - e0) * t + (i % 2 ? 1 : -1)]);
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        'track-length': String(Math.round(haversine(from, to))),
        messages: [
          ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'],
          ['1', '1', '1', '2000', '0', '0', '0', '0', '0', 'highway=track', '', '0', '0'],
          ['1', '1', '1', '1500', '0', '0', '0', '0', '0', 'highway=path sac_scale=mountain_hiking', '', '0', '0'],
          ['1', '1', '1', '500', '0', '0', '0', '0', '0', 'highway=path sac_scale=demanding_mountain_hiking trail_visibility=good', '', '0', '0'],
        ],
      },
      geometry: { type: 'LineString', coordinates: coords },
    }],
  };
}

test('Routenanalyse aus BRouter-GeoJSON', () => {
  const start = { id: 'x', type: 'parking', name: null, lat: 47.36, lng: 10.95, bearing: 180 };
  const r = analyzeRoute(fakeRoute('x', [10.95, 47.36], [peak.lng, peak.lat]), start, peak);
  assert.equal(r.sac, 3);
  assert.ok(Math.abs(r.sacShare - 0.125) < 1e-9);
  assert.equal(r.up, 1400);
  assert.equal(r.title, 'Parkplatz, Südseite');
  assert.ok(r.timeUp > 4 && r.timeUp < 6, `Aufstiegszeit ${r.timeUp}`);
  assert.ok(r.timeDown < r.timeUp);
  assert.ok(r.gapToSummit < 1);
  assert.match(toGPX(r, 'Sonnenspitze'), /<trkpt lat="47\.360000" lon="10\.950000"><ele>/);
  assert.deepEqual(parseWayInfo(undefined), { maxSac: 0, sacShare: 0, viaFerrata: false });
});

test('Doppelte Routen werden zusammengefasst', () => {
  const s1 = { id: 'a', type: 'parking', lat: 47.36, lng: 10.95, bearing: 180 };
  const s2 = { id: 'b', type: 'parking', lat: 47.3605, lng: 10.9502, bearing: 180 };
  const s3 = { id: 'c', type: 'parking', lat: 47.40, lng: 10.92, bearing: 315 };
  const r1 = analyzeRoute(fakeRoute('a', [10.95, 47.36], [peak.lng, peak.lat]), s1, peak);
  const r2 = analyzeRoute(fakeRoute('b', [10.9502, 47.3605], [peak.lng, peak.lat]), s2, peak);
  const r3 = analyzeRoute(fakeRoute('c', [10.92, 47.40], [peak.lng, peak.lat]), s3, peak);
  assert.equal(dedupeRoutes([r1, r2, r3]).length, 2);
});

function fakeForecast({ cape = 0, precip = 0, wind = 20 } = {}) {
  const t0 = Date.UTC(2026, 9, 27, 0) / 1000 - 3600; // lokale Mitternacht (MEZ)
  const n = 48;
  const time = Array.from({ length: n }, (_, i) => t0 + i * 3600);
  const fill = (v) => Array(n).fill(v);
  return {
    elevation: 2100,
    hourly: {
      time,
      temperature_2m: fill(2), apparent_temperature: fill(-3), precipitation: fill(precip),
      precipitation_probability: fill(precip ? 80 : 5), snowfall: fill(0), weather_code: fill(precip ? 61 : 1),
      cloud_cover: fill(30), wind_speed_10m: fill(10), wind_gusts_10m: fill(30), wind_direction_10m: fill(270),
      freezing_level_height: fill(2600), cape: fill(cape), visibility: fill(20000), is_day: fill(1),
      wind_speed_800hPa: fill(wind), wind_direction_800hPa: fill(280),
    },
    daily: {
      time: [t0, t0 + 86400],
      weather_code: [1, 1], temperature_2m_max: [5, 6], temperature_2m_min: [-2, -1],
      precipitation_sum: [0, 0], precipitation_probability_max: [5, 5], snowfall_sum: [0, 0],
      wind_gusts_10m_max: [30, 30], sunrise: [t0 + 7 * 3600, t0 + 86400 + 7 * 3600], sunset: [t0 + 17 * 3600, t0 + 86400 + 17 * 3600],
      sunshine_duration: [30000, 30000],
    },
  };
}

test('Wetter: Druckfläche und Tourenampel', () => {
  assert.equal(pressureLevelFor(900), null);
  assert.equal(pressureLevelFor(2417), 800);
  assert.equal(pressureLevelFor(3100), 700);
  assert.equal(wxKind(95), 'thunder');
  assert.equal(wxKind(73), 'snow');

  const good = buildForecast(fakeForecast(), 800, 2417);
  assert.equal(good.days.length, 2);
  assert.equal(good.days[0].hours.length, 24);
  assert.equal(good.days[0].rating.level, 'good');
  assert.equal(good.hours[0].windSummit, 20);

  const storm = buildForecast(fakeForecast({ cape: 1200, precip: 0.5, wind: 65 }), 800, 2417);
  assert.equal(storm.days[0].rating.level, 'poor');
  assert.equal(storm.days[0].rating.thunderRisk, 'hoch');
  assert.ok(storm.days[0].rating.reasons.includes('Gewitter am Nachmittag möglich'));
});

test('Wetterraster und Feldrendering', () => {
  const nx = 3, ny = 3, T = 2;
  const locs = Array.from({ length: nx * ny }, (_, k) => ({
    hourly: {
      time: [1000, 4600],
      cloud_cover_low: [k * 10, 100], cloud_cover_mid: [0, 50], cloud_cover_high: [0, 20],
      precipitation: [k === 4 ? 5 : 0, 0], snowfall: [0, 0], cape: [0, 2000],
      wind_speed_10m: [36, 36], wind_direction_10m: [270, 270], // Westwind → u positiv
      wind_speed_700hPa: [72, 72], wind_direction_700hPa: [0, 0], // Nordwind → v negativ
    },
  }));
  const grid = buildGrid(locs, { w: 10, s: 46, e: 12, n: 48, nx, ny });
  assert.equal(grid.times.length, T);
  assert.ok(Math.abs(grid.layers.u10[0] - 36) < 1e-4);
  assert.ok(Math.abs(grid.layers.v700[0] + 72) < 1e-4);
  const mid = sliceAt(grid, 'cl', 0.5);
  assert.equal(mid[0], 50);
  assert.ok(thunderRisk(2000, 0, 95) >= 0.85);

  const W = 16, H = 16;
  const lookup = pixelLookup(grid, W, H);
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  renderField(img, grid, lookup, 'precip', 0);
  const center = ((H / 2) * W + W / 2) * 4;
  assert.ok(img.data[center + 3] > 150, 'Niederschlag in der Mitte sichtbar');
  assert.equal(img.data[3], 0, 'Kein Niederschlag und keine Wolken in der Ecke');
  renderField(img, grid, lookup, 'clouds', 1);
  assert.ok(img.data[3] > 200, 'Dichte tiefe Wolken sind kräftig sichtbar');
  for (const layer of ['clouds', 'thunder', 'wind']) renderField(img, grid, lookup, layer, 1, { windLevel: '700hPa' });
});

import { formatRegion } from '../src/api/search.js';
import { sensible, disambiguate } from '../src/api/routing.js';

test('Region unterscheidet gleichnamige Gipfel', () => {
  assert.equal(formatRegion({ city: 'Mieming', county: 'Bezirk Imst', state: 'Tirol', countrycode: 'AT' }), 'Mieming (Imst), Tirol');
  assert.equal(formatRegion({ city: 'Ellbögen', county: 'Bezirk Innsbruck-Land', state: 'Tirol', countrycode: 'AT' }), 'Ellbögen (Innsbruck-Land), Tirol');
  assert.equal(formatRegion({ county: 'Savoie', state: 'Auvergne-Rhône-Alpes', country: 'Frankreich', countrycode: 'FR' }), 'Savoie, Frankreich');
});

test('Unsinnige Routen werden aussortiert und gleiche Namen unterschieden', () => {
  const mk = (title, timeUp, startEle, type = 'parking', direction = 'Nord') => ({ title, timeUp, startEle, direction, start: { type } });
  const kept = sensible([mk('A', 2.4), mk('B', 3.75), mk('C', 6.7), mk('D', 11)]);
  assert.deepEqual(kept.map((r) => r.title), ['A', 'B']);
  const d = disambiguate([mk('Bahn', 2.4, 2051, 'cablecar'), mk('Bahn', 4.5, 1551, 'cablecar'), mk('P', 5, 900, 'parking', 'Süd'), mk('P', 5, 900, 'parking', 'West')]);
  assert.deepEqual(d.map((r) => r.title), ['Bahn, Bergstation', 'Bahn, Talstation', 'P, Südseite', 'P, Westseite']);
});

import { makeAlpineProfile } from '../src/api/routing.js';

test('Alpines BRouter-Profil erlaubt T6', () => {
  const p = makeAlpineProfile('assign   SAC_scale_limit          3    # x\nassign   SAC_scale_preferred      1    # y');
  assert.match(p, /SAC_scale_limit\s+6/);
  assert.match(p, /SAC_scale_preferred\s+2/);
});

test('Skilifte verdrängen keine Parkplätze', () => {
  const places = [
    { id: 'l1', type: 'cablecar', name: 'Lift A', lat: 47.375, lng: 10.90 },
    { id: 'l2', type: 'cablecar', name: 'Lift B', lat: 47.395, lng: 10.93 },
    { id: 'l3', type: 'cablecar', name: 'Lift C', lat: 47.36, lng: 10.97 },
    { id: 'p1', type: 'parking', name: 'Parkplatz Süd', lat: 47.37, lng: 10.948 },
  ];
  const starts = pickStarts(peak, places);
  assert.ok(starts.some((s) => s.id === 'p1'));
  assert.ok(starts.filter((s) => s.type === 'cablecar').length <= 2);
});

import { featherWeight } from '../src/map/field.js';

test('Detailraster wird weich eingeblendet', () => {
  const b = { w: 10, e: 11, s: 47, n: 47.5 };
  assert.equal(featherWeight(b, 9.9, 47.2), 0);
  assert.equal(featherWeight(b, 10.5, 47.25), 1);
  const edge = featherWeight(b, 10.05, 47.25);
  assert.ok(edge > 0 && edge < 1);
});

import { detailLookup } from '../src/map/field.js';

test('Detailraster geht ohne Kante ins Grundraster über', () => {
  const mk = (val, b, n) => buildGrid(Array.from({ length: n * n }, () => ({ hourly: {
    time: [0], cloud_cover_low: [val], cloud_cover_mid: [0], cloud_cover_high: [0], precipitation: [0], snowfall: [0], cape: [0],
    wind_speed_10m: [0], wind_direction_10m: [0], wind_speed_700hPa: [0], wind_direction_700hPa: [0] } })), { ...b, nx: n, ny: n });
  const reg = mk(20, { w: 10, e: 12, s: 47, n: 48 }, 4);   // regional: wenig Wolken
  const det = mk(100, { w: 10.8, e: 11.2, s: 47.4, n: 47.6 }, 6); // Detail: dicht
  const W = 200, H = 100;
  const lk = pixelLookup(reg, W, H);
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  renderField(img, reg, lk, 'clouds', 0, { detail: { grid: det, tf: 0, lookup: detailLookup(lk, det) } });
  const alpha = (x, y) => img.data[(y * W + x) * 4 + 3];
  const y = 50; // Mitte des Detailgebiets
  const outside = alpha(10, y), inside = alpha(100, y);
  assert.ok(inside > outside + 100, `Detail deutlich sichtbar (${inside} vs ${outside})`);
  // keine Sprünge: benachbarte Pixel unterscheiden sich nur wenig
  let maxJump = 0;
  for (let x = 1; x < W; x++) maxJump = Math.max(maxJump, Math.abs(alpha(x, y) - alpha(x - 1, y)));
  assert.ok(maxJump < 70, `weicher Übergang statt Kante von ~200 (max. Sprung ${maxJump})`);
});

import { blur3, coarseBlend } from '../src/map/field.js';

test('Grobe Modelle werden ab ca. 2 Tagen geglättet', () => {
  assert.equal(coarseBlend(10), 0);
  assert.equal(coarseBlend(60), 1);
  const a = new Float32Array([0, 0, 0, 0, 100, 0, 0, 0, 0]);
  const b = blur3(a, 3, 3);
  assert.equal(b[4], 25);
  assert.ok(b[0] > 0 && b[0] < b[1]);
});

import { makeLoop, loopCandidates, hutsAlong } from '../src/api/routing.js';

test('Rundtouren und Hütten am Weg', () => {
  const sA = { id: 'a', type: 'parking', name: 'P Nord', lat: 47.40, lng: 10.92, bearing: 0 };
  const sB = { id: 'b', type: 'parking', name: 'P Nordost', lat: 47.401, lng: 10.935, bearing: 45 };
  const A = analyzeRoute(fakeRoute('a', [10.92, 47.40], [peak.lng, peak.lat]), sA, peak);
  // B über einen deutlich anderen Weg (Umweg nach Osten)
  const gB = fakeRoute('b', [10.935, 47.401], [10.975, 47.39]);
  const gB2 = fakeRoute('b2', [10.975, 47.39], [peak.lng, peak.lat], 40, 2400, 2417);
  gB.features[0].geometry.coordinates.push(...gB2.features[0].geometry.coordinates.slice(1));
  const B = analyzeRoute(gB, sB, peak);
  const cands = loopCandidates([A, B]);
  assert.equal(cands.length, 1, 'eine Kombination (nur in einer Richtung)');
  const L = makeLoop(cands[0].a, cands[0].b, null);
  assert.equal(L.kind, 'loop');
  assert.equal(L.coords[0][0], L.coords[0][0]);
  assert.ok(Math.abs(L.timeTotal - (L.timeUp + L.timeDown)) < 1e-9);
  assert.ok(L.length > A.length && L.length > B.length);
  assert.match(L.title, /^Rundtour P Nord/);
  const huts = hutsAlong(A, [{ name: 'Testhütte', lat: A.coords[30][1], lng: A.coords[30][0] }, { name: 'Weit weg', lat: 47.5, lng: 11.2 }]);
  assert.deepEqual(huts.map((h) => h.name), ['Testhütte']);
  assert.ok(huts[0].time > 0 && huts[0].time < A.timeUp);
});

import { legLabel } from '../src/api/routing.js';

test('Rundtouren benennen Hütten und Varianten', () => {
  const base = { baseTitle: 'Ehrwalder Almbahn' };
  assert.equal(legLabel({ ...base, kind: 'direct' }), 'Ehrwalder Almbahn');
  assert.equal(legLabel({ ...base, kind: 'hut', hut: { name: 'Seeben Alm' } }), 'Ehrwalder Almbahn über Seeben Alm');
  assert.equal(legLabel({ ...base, kind: 'alt' }), 'Ehrwalder Almbahn (Variante)');
});

import { parseGPX, tourFromCoords } from '../src/api/gpx.js';
import { chainWays, sectionsToSummit, toMerc } from '../src/api/marked.js';

test('GPX aus komoot & Co. wird gelesen und ausgewertet', () => {
  const gpx = `<?xml version="1.0"?><gpx><metadata><name>Meta</name></metadata><trk><name>Zugspitze über das Reintal &amp; Knorrhütte</name><trkseg>
    <trkpt lat="47.40" lon="10.90"><ele>1000</ele></trkpt>
    <trkpt lon="10.91" lat="47.41"><ele>1600</ele><time>x</time></trkpt>
    <trkpt lat='47.42' lon='10.92'><ele>2200</ele></trkpt>
    <trkpt lat="47.401" lon="10.901"><ele>1005</ele></trkpt>
  </trkseg></trk></gpx>`;
  const { name, coords } = parseGPX(gpx);
  assert.equal(name, 'Zugspitze über das Reintal & Knorrhütte');
  assert.equal(coords.length, 4);
  assert.deepEqual(coords[1], [10.91, 47.41, 1600]);
  const t = tourFromCoords(coords, { id: 'x', title: name });
  assert.equal(t.isLoop, true);
  assert.equal(t.up, 1200);
  assert.ok(t.timeUp > 0 && t.timeDown > 0 && t.timeDown < t.timeUp);
});

test('Markierte Wege werden verbunden und zum Gipfel ausgerichtet', () => {
  const m = (lng, lat) => toMerc(lng, lat);
  // zwei Wege, der zweite rückwärts erfasst
  const ways = [
    { geometry: { coordinates: [m(10.90, 47.40), m(10.91, 47.405)] } },
    { geometry: { coordinates: [m(10.93, 47.415), m(10.92, 47.41), m(10.91, 47.405)] } },
  ];
  const line = chainWays(ways);
  assert.equal(line.length, 4);
  assert.ok(Math.abs(line[3][0] - 10.93) < 1e-6);
  const secs = sectionsToSummit(line, { lng: 10.93, lat: 47.415 }, { minLen: 500 });
  assert.equal(secs.length, 1, 'Weg endet am Gipfel → ein Anstieg');
  assert.ok(Math.abs(secs[0][0][0] - 10.90) < 1e-6, 'beginnt im Tal');
  const through = sectionsToSummit(line, { lng: 10.91, lat: 47.405 }, { minLen: 500 });
  assert.equal(through.length, 2, 'Weg führt über den Gipfel → zwei Anstiege');
});

test('Lange markierte Wege werden auf die letzten 18 km gekürzt', () => {
  const line = Array.from({ length: 301 }, (_, i) => [10 + i * 0.001, 47]); // ca. 22,7 km nach Osten
  const secs = sectionsToSummit(line, { lng: 10.3, lat: 47 });
  assert.equal(secs.length, 1);
  const cd = (s) => s.reduce((a, p, i) => (i ? a + Math.hypot((p[0] - s[i - 1][0]) * 75500, (p[1] - s[i - 1][1]) * 111000) : 0), 0);
  assert.ok(cd(secs[0]) <= 18100 && cd(secs[0]) > 17000);
});

import { probe, PRECIP_MIN } from '../src/map/field.js';

test('Messwert unter dem Mauszeiger', () => {
  const locs = Array.from({ length: 9 }, (_, k) => ({ hourly: {
    time: [0, 3600], cloud_cover_low: [80, 80], cloud_cover_mid: [20, 20], cloud_cover_high: [0, 0],
    precipitation: [k === 4 ? 2 : 0, 0], snowfall: [0, 0], cape: [0, 0],
    wind_speed_10m: [36, 36], wind_direction_10m: [270, 270], wind_speed_700hPa: [0, 0], wind_direction_700hPa: [0, 0] } }));
  const g = buildGrid(locs, { w: 10, e: 12, s: 47, n: 48, nx: 3, ny: 3 });
  const mid = probe(g, 0, 11, 47.5);
  assert.ok(mid.precip >= 1.9 && mid.precip >= PRECIP_MIN);
  assert.equal(Math.round(mid.cl), 80);
  assert.ok(Math.abs(mid.u10 - 36) < 1e-3);
  assert.equal(probe(g, 0, 13, 47.5), null, 'außerhalb des Rasters');
});

import { describeHours, hoursToGerman } from '../src/util/openingHours.js';

test('Öffnungszeiten von Hütten', () => {
  const okt = new Date(2026, 9, 27);
  const jul = new Date(2026, 6, 10);
  assert.equal(describeHours('Jun-Sep', jul).open, true);
  assert.equal(describeHours('Jun-Sep', okt).open, false);
  assert.equal(describeHours('May 15-Oct 15', new Date(2026, 9, 15)).open, true);
  assert.equal(describeHours('May 15-Oct 15', new Date(2026, 9, 16)).open, false);
  assert.equal(describeHours('Jun-Sep 07:00-22:00; Dec 26-Apr 15 08:00-18:00', new Date(2026, 0, 5)).open, true);
  assert.equal(describeHours('24/7').open, true);
  assert.equal(describeHours('Mo-Fr 08:00-12:00', jul).open, null);
  assert.equal(describeHours('Jun-Sep; Jul off', jul).open, false);
  assert.equal(hoursToGerman('May-Oct; Mo off'), 'Mai–Okt · Mo geschlossen');
  assert.equal(describeHours('').text, '');
});

import { bulletinFor, mapLevels, pointInGeometry, levelAt, dayKey } from '../src/api/avalanche.js';

test('Lawinen: Bericht, Teilgebiete, Gipfelstufe', () => {
  // Bericht gilt bis 17 Uhr, danach der für den nächsten Tag
  assert.deepEqual(bulletinFor(new Date(2026, 1, 15, 10)), { date: '2026-02-15', period: 'am' });
  assert.deepEqual(bulletinFor(new Date(2026, 1, 15, 14)), { date: '2026-02-15', period: 'pm' });
  assert.deepEqual(bulletinFor(new Date(2026, 1, 15, 18)), { date: '2026-02-16', period: 'am' });
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');

  const r = { 'AT-07-02-01': 3, 'AT-07-02-01:high': 3, 'AT-07-02-01:low': 2, 'AT-07-02-01:high:pm': 4, 'DE-BY-11': 2 };
  assert.deepEqual(mapLevels(r, 'am'), { 'AT-07-02-01:high': 3, 'AT-07-02-01:low': 2, 'DE-BY-11:high': 2, 'DE-BY-11:low': 2 });
  assert.equal(mapLevels(r, 'pm')['AT-07-02-01:high'], 4);

  const sq = { type: 'Polygon', coordinates: [[[10, 47], [11, 47], [11, 48], [10, 48], [10, 47]], [[10.4, 47.4], [10.6, 47.4], [10.6, 47.6], [10.4, 47.6], [10.4, 47.4]]] };
  assert.equal(pointInGeometry(10.2, 47.2, sq), true);
  assert.equal(pointInGeometry(10.5, 47.5, sq), false); // Loch
  assert.equal(pointInGeometry(12, 47.5, sq), false);

  const rep = { state: 'rated', high: 3, low: 2, boundM: 2200 };
  assert.equal(levelAt(rep, 2962), 3);
  assert.equal(levelAt(rep, 1800), 2);
  assert.equal(levelAt({ ...rep, low: 3 }, 2962), null);
});

import { normalizeWebcam, windyWebcams, cleanTitle } from '../server/webcams.js';
import { ageText } from '../src/api/webcams.js';

test('Webcams: Windy-Antwort aufbereiten', async () => {
  const w = {
    webcamId: 1234, title: 'Zugspitze Gipfel', status: 'active', lastUpdatedOn: '2026-10-28T06:50:00Z',
    location: { latitude: 47.421, longitude: 10.985, city: 'Grainau', region: 'Bayern' },
    images: { current: { preview: 'https://imgproxy.windy.com/p.jpg', thumbnail: 't.jpg' }, daylight: { preview: 'd.jpg' } },
    urls: { detail: 'https://www.windy.com/webcams/1234', provider: 'https://www.bergfex.at/x' },
    player: { day: 'https://webcams.windy.com/webcams/public/embed/player/1234/day' },
  };
  const c = normalizeWebcam(w);
  assert.equal(c.id, '1234');
  assert.equal(cleanTitle('Grainau › Südosten: Zugspitze - Zugspitzeplatt', 'Grainau'), 'Südosten: Zugspitze - Zugspitzeplatt');
  assert.equal(cleanTitle('Grainau: Bayerische Zugspitzbahn', 'Grainau'), 'Bayerische Zugspitzbahn');
  assert.equal(cleanTitle('Grainau', 'Grainau'), 'Grainau');
  assert.equal(c.place, 'Grainau, Bayern');
  assert.equal(c.preview, 'https://imgproxy.windy.com/p.jpg');
  assert.equal(c.provider, 'https://www.bergfex.at/x');
  assert.equal(normalizeWebcam({ webcamId: 1, location: {} }), null);
  // ohne Schlüssel: sauber „nicht eingerichtet“, kein Abruf
  assert.deepEqual(await windyWebcams(new URLSearchParams('lat=47&lon=11'), ''), { status: 503, body: { error: 'no-key' } });
  const now = new Date('2026-10-28T07:00:00Z').getTime();
  assert.equal(ageText('2026-10-28T06:50:00Z', now), 'vor 10 Min.');
  assert.equal(ageText('2026-10-28T03:00:00Z', now), 'vor 4 Std.');
});

import { customTour, planTitle } from '../src/api/routing.js';

test('Eigene Route: Titel, Rundtour, Überschreitung', () => {
  assert.equal(planTitle([{ name: 'P Hammersbach' }, { name: 'Knorrhütte' }, { name: 'Zugspitze' }]), 'P Hammersbach → Knorrhütte → Zugspitze');
  assert.equal(planTitle([{ name: 'A' }, { name: null }, { name: 'B' }, { name: 'C' }, { name: 'D' }]), 'A → … → D');
  assert.equal(planTitle([{ name: null }, { name: null }]), 'Eigene Route');

  // künstliche Strecke: 0 → 1000 m hoch → wieder runter an den Start
  const line = (pts) => ({ features: [{ geometry: { coordinates: pts }, properties: {} }] });
  const up = [[11, 47, 1000], [11, 47.01, 1500], [11, 47.02, 2000]];
  const peak = { lat: 47.02, lng: 11, ele: 2000 };
  const A = { lat: 47, lng: 11, name: 'P', type: 'parking' };
  const G = { lat: 47.02, lng: 11, name: 'Gipfel', type: 'peak' };
  const toTop = customTour(line(up), [A, G], peak, 'x');
  assert.equal(toTop.oneWay, false); // endet oben: Rückweg gleich
  assert.ok(toTop.timeDown > 0 && toTop.timeTotal > toTop.timeUp);
  assert.ok(toTop.gapToSummit < 1);

  const loop = customTour(line([...up, [11.01, 47.01, 1500], [11, 47, 1000]]), [A, G, { ...A }], peak, 'y');
  assert.equal(loop.isLoop, true);
  assert.ok(Math.abs(loop.timeTotal - (loop.timeUp + loop.timeDown)) < 1e-9);

  const trav = customTour(line([...up, [11.02, 47.03, 1200]]), [A, G, { lat: 47.03, lng: 11.02, name: 'Tal', type: 'point' }], peak, 'z');
  assert.equal(trav.oneWay, true);
  assert.equal(trav.title, 'P → Gipfel → Tal');
});

import { classify } from '../src/api/osm.js';
import { poiLabel } from '../src/api/poi.js';

test('Hütten, Almen und Notbiwaks erkennen', () => {
  assert.equal(classify({ tourism: 'alpine_hut' }), 'hut');
  assert.equal(classify({ tourism: 'wilderness_hut' }), 'bivouac');
  assert.equal(classify({ amenity: 'shelter', shelter_type: 'basic_hut' }), 'bivouac');
  assert.equal(classify({ amenity: 'shelter', name: 'Biwak am Grat' }), 'bivouac');
  assert.equal(classify({ amenity: 'shelter', shelter_type: 'public_transport' }), null);
  assert.equal(classify({ amenity: 'shelter', shelter_type: 'picnic_shelter', name: 'Rastplatz' }), null);
  assert.equal(classify({ amenity: 'restaurant', name: 'Ehrwalder Alm' }), 'alm');
  assert.equal(classify({ amenity: 'restaurant', name: 'Pizzeria Roma' }), null);
  assert.equal(poiLabel('bivouac', { name: 'Biwakschachtel Hochwanner' }), 'Biwak');
  assert.equal(poiLabel('bivouac', { tourism: 'wilderness_hut' }), 'Unbewirtschaftete Hütte');
  assert.equal(poiLabel('bivouac', { shelter_type: 'basic_hut' }), 'Notunterkunft');
  assert.equal(poiLabel('alm', {}), 'Alm / Einkehr');
});
