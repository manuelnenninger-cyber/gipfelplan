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

import { toRow, fromRow } from '../src/api/tours.js';
import { authMessage } from '../src/api/auth.js';

test('Touren speichern: Zeile hin und zurück', () => {
  const tour = {
    id: 'custom:1', kind: 'custom', title: 'P → Hütte → Gipfel', color: '#d6336c',
    coords: [[11.123456789, 47.1, 1000.4], [11.2, 47.2, null]], length: 5000, up: 900, down: 10,
    timeUp: 3, timeDown: 2, timeTotal: 5, sac: 3, isLoop: false, oneWay: false,
    waypoints: [{ lat: 47.1, lng: 11.1, name: 'P', type: 'parking' }],
    start: { id: 'x', type: 'parking', name: 'P', lat: 47.1, lng: 11.1, extra: 'weg' },
    dist: [0, 5000], huts: [],
  };
  const row = toRow(tour, { name: 'Gipfel', lat: 47.2, lng: 11.2, ele: 2000 });
  assert.deepEqual(row.coords[0], [11.12346, 47.1, 1000]);
  assert.equal(row.coords[1][2], null);
  assert.equal(row.stats.start.extra, undefined);
  assert.equal(row.dist, undefined);
  const back = fromRow({ ...row, id: 'abc', created_at: '2026-10-31T18:00:00Z' });
  assert.equal(back.id, 'saved:abc');
  assert.equal(back.savedId, 'abc');
  assert.equal(back.title, tour.title);
  assert.equal(back.sac, 3);
  assert.equal(back.peak.name, 'Gipfel');
  assert.equal(back.dist.length, 2);
  assert.equal(back.waypoints[0].name, 'P');
});

test('Anmeldung: verständliche Fehler', () => {
  assert.match(authMessage({ msg: 'Token has expired or is invalid' }, 403), /falsch oder abgelaufen/);
  assert.match(authMessage({ msg: 'For security purposes, you can only request this after 42 seconds.' }, 429), /Zu viele/);
  assert.match(authMessage({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400), /Passwort stimmt nicht/);
  assert.match(authMessage({ msg: 'User already registered' }, 422), /schon ein Konto/);
  assert.match(authMessage({ error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }, 422), /mindestens 8/);
  assert.match(authMessage({ error_code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400), /bestätige/);
});

import { slimRoute } from '../src/util/offline.js';

test('Offline: Routen schlank speichern', () => {
  const r = { id: 'x', title: 'T', dist: [0, 10], coords: [[11.123456789, 47.1, 999.6], [11.2, 47.2, undefined]] };
  const s = slimRoute(r);
  assert.equal(s.dist, undefined);
  assert.deepEqual(s.coords[0], [11.12346, 47.1, 1000]);
  assert.equal(s.coords[1][2], null);
  assert.equal(s.title, 'T');
});

import { terrarium, tileResolution, slopeDegrees, slopeColor, slopePixels } from '../src/map/slope.js';

test('Hangneigung: Neigung aus Geländemodell', () => {
  assert.equal(terrarium(128, 0, 0), 0);
  assert.equal(terrarium(129, 44, 0), 300);
  // Zoom 13 am Äquator ≈ 19,1 m pro Pixel; in den Alpen kleiner
  assert.ok(Math.abs(tileResolution(13, 4095) - 19.1) < 0.1);
  assert.ok(tileResolution(13, 2900) < 14);
  // schiefe Ebene: 10 m Anstieg je Pixel bei 10 m Pixelgröße → 45°
  const size = 5;
  const elev = new Float32Array(size * size).map((_, p) => (p % size) * 10);
  const deg = slopeDegrees(elev, size, 10);
  assert.ok(Math.abs(deg[12] - 45) < 1e-6);
  // flach → 0°
  assert.equal(slopeDegrees(new Float32Array(9).fill(500), 3, 10)[4], 0);
});

test('Hangneigung: Farbklassen wie Lawinenkarten', () => {
  assert.equal(slopeColor(29.9)[3], 0);
  assert.deepEqual(slopeColor(32), [242, 214, 0, 255]);
  assert.deepEqual(slopeColor(37), [243, 146, 0, 255]);
  assert.deepEqual(slopeColor(41), [226, 0, 26, 255]);
  assert.deepEqual(slopeColor(60), [140, 40, 160, 255]);
  // 2×2 Kachel aus Terrarium-Pixeln: flach → durchsichtig
  const rgba = new Uint8ClampedArray(16).fill(128);
  for (let p = 0; p < 4; p++) rgba[p * 4 + 3] = 255;
  assert.equal(slopePixels(rgba, 2, 13, 2900)[3], 0);
});

import { sunPosition, sunState } from '../src/util/sun.js';
import { buildItinerary, pointAt, recommendStart, weatherAt, sunAlong, snowSummary, summitIndex } from '../src/api/plan.js';
import { makeSampler, tileXY } from '../src/map/dem.js';

test('Sonne: Stand zur Mittagszeit und nachts', () => {
  // München, Sommeranfang, wahrer Mittag ≈ 11:16 UTC: Höhe ≈ 65°, Richtung Süd
  const noon = sunPosition(new Date('2026-06-21T11:16:00Z'), 48.14, 11.58);
  assert.ok(Math.abs(noon.alt - 65.3) < 0.8, `alt ${noon.alt}`);
  assert.ok(Math.abs(noon.az - 180) < 4, `az ${noon.az}`);
  // Sonnenaufgang im Osten
  const morning = sunPosition(new Date('2026-06-21T03:30:00Z'), 48.14, 11.58);
  assert.ok(morning.az > 40 && morning.az < 80 && morning.alt > -5 && morning.alt < 6);
  assert.ok(sunPosition(new Date('2026-06-21T23:00:00Z'), 48.14, 11.58).alt < -10);
});

test('Sonne: Schatten durch Gelände', () => {
  const flat = () => 1000;
  const sun = { alt: 20, az: 180 };
  assert.equal(sunState(flat, 11, 47, sun), 'sun');
  assert.equal(sunState(flat, 11, 47, { alt: -5, az: 180 }), 'night');
  // 1000 m hohe Wand 1 km südlich → 45° Horizont → bei 20° Sonnenhöhe Schatten
  const wall = (lng, lat) => (lat < 47 - 0.009 ? 2000 : 1000);
  assert.equal(sunState(wall, 11, 47, sun), 'shade');
  assert.equal(sunState(wall, 11, 47, { alt: 50, az: 180 }), 'sun');
  // Nordhang (fällt nach Norden ab, 45°) bei tiefer Südsonne → eigener Schatten
  const northSlope = (lng, lat) => 1000 - (lat - 47) * 111320;
  assert.equal(sunState(northSlope, 11, 47, { alt: 30, az: 180 }), 'shade');
});

test('Planen: Zeitplan einer Tour auf gleichem Weg', () => {
  const route = {
    kind: 'direct', timeUp: 3, timeDown: 2, timeTotal: 5, start: { name: 'Parkplatz' },
    coords: [[11, 47, 1000], [11.01, 47.01, 1500], [11.02, 47.02, 2000]],
    huts: [{ name: 'Hütte', index: 1 }],
  };
  const it = buildItinerary(route, { name: 'Gipfel', lng: 11.02, lat: 47.02 });
  assert.equal(it.points.length, 5);
  assert.ok(Math.abs(it.summitT - 3) < 1e-9 && Math.abs(it.total - 5) < 1e-9);
  assert.ok(Math.abs(it.points[2].t - 3) < 1e-9 && Math.abs(it.points[4].t - 5) < 1e-9);
  assert.deepEqual(it.marks.map((m) => m.kind), ['start', 'hut', 'summit', 'hut', 'end']);
  const p = pointAt(it.points, 3);
  assert.equal(p.ele, 2000);
  assert.equal(summitIndex(route.coords, null), 2);
});

const dayFor = (date, hours) => {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const at = (h) => { const x = new Date(d); x.setHours(h); return x; };
  return {
    date: d, sunrise: at(7), sunset: at(17),
    hours: Array.from({ length: 24 }, (_, h) => ({ t: at(h), code: 1, cape: 0, temp: 5, wind: 10, windSummit: 20, ...(hours[h] || {}) })),
  };
};

test('Planen: Startzeit nach Gewitter und Tageslicht', () => {
  const quiet = dayFor('2026-07-10T00:00:00', {});
  const r1 = recommendStart(quiet, 6, { now: new Date('2026-07-01T12:00:00') });
  // Sonnenuntergang 17 Uhr − 30 min − 6 h → spätestens 10:30, Vorschlag 8:00
  assert.equal(r1.latest.getHours() * 60 + r1.latest.getMinutes(), 10 * 60 + 30);
  assert.equal(r1.suggested.getHours(), 8);
  assert.equal(r1.limitedBy, 'light');
  const storm = dayFor('2026-07-10T00:00:00', { 13: { code: 95 } });
  const r2 = recommendStart(storm, 6, { now: new Date('2026-07-01T12:00:00') });
  assert.equal(r2.latest.getHours(), 7);
  assert.equal(r2.suggested.getHours(), 7);
  assert.equal(r2.limitedBy, 'thunder');
  assert.equal(r2.tight, false);
  const r3 = recommendStart(storm, 9, { now: new Date('2026-07-01T12:00:00') });
  assert.equal(r3.tight, true);
});

test('Planen: Wetter auf Punkthöhe, Schneegrenze', () => {
  const day = dayFor('2026-07-10T00:00:00', {});
  const fc = { ele: 2000, hours: day.hours };
  const w = weatherAt(fc, new Date(day.date.getTime() + 9.5 * 3600000), 1000);
  assert.ok(Math.abs(w.temp - 11.5) < 1e-9); // 5 °C am Gipfel + 1000 m × 0,65 °C
  assert.equal(weatherAt(fc, day.hours[9].t, 2000, { summit: true }).wind, 20);
  const s = snowSummary([{ ele: 900, depth: 0 }, { ele: 1420, depth: 0.05 }, { ele: 1800, depth: 0.3 }, { ele: 1200, depth: null }]);
  assert.equal(s.from, 1400);
  assert.equal(s.topDepth, 0.3);
  assert.equal(snowSummary([{ ele: 900, depth: 0 }]).any, false);
});

test('Planen: Sonne/Schatten-Abschnitte und Geländeraster', () => {
  const pts = [{ lng: 11, lat: 47, ele: 1000, t: 0 }, { lng: 11.01, lat: 47, ele: 1000, t: 1 }];
  const segs = sunAlong(pts, new Date('2026-06-21T10:00:00Z'), () => 1000);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].state, 'sun');
  // Raster: Höhe wächst nach Osten (x) um 1 m je Pixel
  const tile = new Float32Array(256 * 256).map((_, i) => i % 256);
  const [fx, fy] = tileXY(11, 47, 11);
  const sample = makeSampler((x, y) => (x === Math.floor(fx) && y === Math.floor(fy) ? tile : null), 11);
  const h = sample(11, 47);
  assert.ok(Math.abs(h - ((fx - Math.floor(fx)) * 256 - 0.5)) < 1e-3);
});

import { looksSnowy } from '../src/map/satellite.js';
import { satSnowLine } from '../src/api/plan.js';

test('Schnee im Satellitenbild', () => {
  assert.equal(looksSnowy(235, 238, 240), true);   // Schnee in der Sonne
  assert.equal(looksSnowy(70, 95, 140), true);     // Schnee im Schatten (bläulich)
  assert.equal(looksSnowy(90, 85, 60), false);     // Fels/Wiese
  assert.equal(looksSnowy(20, 40, 70), false);     // See
  assert.equal(looksSnowy(0, 0, 0, 0), null);      // keine Aufnahme
  const line = satSnowLine([
    { ele: 1000, snowy: false }, { ele: 1400, snowy: false }, { ele: 1800, snowy: true },
    { ele: 1900, snowy: false }, { ele: 2100, snowy: true }, { ele: 2400, snowy: true }, { ele: 2700, snowy: true },
  ]);
  assert.equal(line.from, 1800);
  assert.equal(line.top, true);
  assert.equal(satSnowLine([{ ele: 1000, snowy: null }]), null);
});

import { sunAlong as sunAlong2, localTop } from '../src/api/plan.js';
test('Sonne am Gipfel: höchster Punkt in der Nähe zählt', () => {
  // Grat in Ost-West-Richtung bei 47.0: nördlich fällt das Gelände steil ab
  const ridge = (lng, lat) => 2000 - Math.abs(lat - 47) * 111320 * 1.5;
  const top = localTop(ridge, 11, 47.0005);
  assert.ok(Math.abs(top.lat - 47) < 0.0002);
  const pts = [{ lng: 11, lat: 46.99, ele: 1000, t: 0 }, { lng: 11, lat: 47.0005, ele: 1990, t: 1.05 }, { lng: 11, lat: 46.99, ele: 1000, t: 2 }];
  const segs = sunAlong2(pts, new Date('2026-11-02T10:00:00Z'), ridge, { summitT: 1.05 });
  let st = null; for (const s of segs) if (s.from <= 1.05 + 1e-9) st = s.state;
  assert.equal(st, 'sun');
});

import { summaryItems } from '../src/ui/peakSummary.js';
test('Gipfel-Zusammenfassung: Wetter, Lawinen, Schnee', () => {
  const day = (d, level) => ({ date: new Date(d), rating: { level } });
  const fc = { days: [day('2026-01-10T00:00:00', 'poor'), day('2026-01-11T00:00:00', 'good')] };
  const morning = new Date('2026-01-10T08:00:00'), evening = new Date('2026-01-10T19:00:00');
  assert.equal(summaryItems({ fc, now: morning })[0].text, 'Heute ungünstig');
  assert.equal(summaryItems({ fc, now: evening })[0].text, 'Morgen gut');
  const ava = { reports: { '2026-01-11': { state: 'rated', level: 3, high: 3, low: 2, boundM: 2000 } } };
  const items = summaryItems({ fc, ava, peak: { ele: 1500 }, snow: { from: 1800, share: 0.6 }, now: evening });
  assert.deepEqual(items.map((i) => i.text), ['Morgen gut', 'Lawinen 2', 'Schnee ab 1.800 m']);
  assert.equal(summaryItems({ snow: { from: null, share: 0 }, now: evening })[0].text, 'schneefrei');
  assert.equal(summaryItems({ now: evening }).length, 0);
});

import { deflateSync } from 'node:zlib';
import { decodePng, encodeJpeg, createCanvas, huffmanTable } from '../server/raster.js';
import { shareTexts, fitZoom, ID_RE } from '../server/share.js';
import { thin } from '../src/api/share.js';

function makePng(w, h, type, rows, palette) {
  const chunk = (name, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(name, 'ascii'), data, Buffer.alloc(4)]); // CRC wird beim Lesen nicht geprüft
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    ...(palette ? [chunk('PLTE', Buffer.from(palette))] : []), chunk('IDAT', deflateSync(Buffer.from(rows.flat()))), chunk('IEND', Buffer.alloc(0))]);
}

test('Teilen: PNG lesen (Filter, Palette)', () => {
  // 2×2 RGB: Zeile 1 mit Filter „Sub“, Zeile 2 mit Filter „Up“
  const rgb = decodePng(makePng(2, 2, 2, [[1, 10, 20, 30, 5, 5, 5], [2, 1, 1, 1, 2, 2, 2]]));
  assert.deepEqual([...rgb.data], [10, 20, 30, 255, 15, 25, 35, 255, 11, 21, 31, 255, 17, 27, 37, 255]);
  const pal = decodePng(makePng(2, 1, 3, [[0, 1, 0]], [0, 0, 0, 200, 100, 50]));
  assert.deepEqual([...pal.data], [200, 100, 50, 255, 0, 0, 0, 255]);
});

test('Teilen: JPEG und Huffman-Tabellen', () => {
  const t = huffmanTable(Array.from({ length: 256 }, (_, i) => (i < 200 ? 1 + ((i * 7919) % 1000) : 0)));
  assert.ok(t.bits.reduce((a, b) => a + b, 0) === 200);
  assert.ok(Math.max(...Array.from(t.len)) <= 16);
  // präfixfrei: kein Code ist Anfang eines anderen
  const codes = t.vals.map((v) => t.code[v].toString(2).padStart(t.len[v], '0'));
  for (const a of codes) for (const b of codes) if (a !== b) assert.ok(!b.startsWith(a));
  assert.ok(!codes.some((c) => /^1+$/.test(c)));
  const cv = createCanvas(37, 21, [200, 120, 40]);
  const jpg = encodeJpeg(cv, 75);
  assert.equal(jpg.readUInt16BE(0), 0xffd8);
  assert.equal(jpg.readUInt16BE(jpg.length - 2), 0xffd9);
  const sof = jpg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.equal(jpg.readUInt16BE(sof + 5), 21);
  assert.equal(jpg.readUInt16BE(sof + 7), 37);
});

test('Teilen: Vorschautexte, Zoom, Ausdünnen', () => {
  const s = { title: 'Über Knorrhütte', kind: 'hut', peak: { name: 'Zugspitze' }, stats: { sac: 4, timeUp: 5.08, up: 964, length: 7200 } };
  const t = shareTexts(s);
  assert.equal(t.title, 'Zugspitze: Über Knorrhütte');
  assert.match(t.description, /^Schwer \(T4\) · 5:05 h Aufstieg · ↑ 964 m · 7,2 km/);
  assert.equal(shareTexts({ ...s, title: 'Zugspitze Rundtour', kind: 'loop', stats: { timeTotal: 7 } }).title, 'Zugspitze Rundtour');
  assert.ok(fitZoom([[11, 47], [11.05, 47.03]], 980, 368) >= 12);
  assert.ok(fitZoom([[10, 46], [12, 48]], 980, 368) < 10);
  const c = Array.from({ length: 5000 }, (_, i) => [i, 0]);
  const th = thin(c, 1500);
  assert.equal(th.length, 1500);
  assert.deepEqual(th[0], [0, 0]);
  assert.deepEqual(th[1499], [4999, 0]);
  assert.ok(ID_RE.test('AbCd1234') && !ID_RE.test('../etc') && !ID_RE.test(''));
});

import { slopeAspect } from '../src/map/terrain.js';
import { dangerSpec, dangerClass, inCore, aspectIndex, checkRoute, terrainAt } from '../src/api/avyCheck.js';

test('Lawinen: Hangrichtung und Steilheit', () => {
  // Gelände steigt nach Osten → Hang zeigt nach Westen
  const size = 5, east = new Float32Array(size * size).map((_, p) => (p % size) * 10);
  const a = slopeAspect(east, size, 10);
  assert.ok(Math.abs(a.aspect[12] - 270) < 1e-6);
  assert.ok(Math.abs(a.slope[12] - 45) < 1e-6);
  // Gelände steigt nach Süden (Zeilen nach unten) → Hang zeigt nach Norden
  const south = new Float32Array(size * size).map((_, p) => Math.floor(p / size) * 5);
  const b = slopeAspect(south, size, 10);
  assert.ok(b.aspect[12] < 1e-6 || Math.abs(b.aspect[12] - 360) < 1e-6);
  assert.equal(aspectIndex(350), 0);
  assert.equal(aspectIndex(44), 1);
  assert.equal(aspectIndex(181), 4);
  // Sampler: Ebene, die nach Norden ansteigt → Hang zeigt nach Süden
  const t = terrainAt((lng, lat) => (lat - 47) * 111320 * 0.7, 11, 47);
  assert.ok(Math.abs(t.aspect - 180) < 1 && Math.abs(t.slope - 35) < 0.5);
});

test('Lawinen: Reduktionsmethode mit Kernzonen', () => {
  const report = {
    state: 'rated', level: 3, high: 3, low: 2, boundM: 2000,
    problems: [{ type: 'wind_slab', aspects: ['N', 'NE', 'E'], lower: 2200, upper: null }, { type: 'favourable_situation', aspects: null }],
  };
  const spec = dangerSpec(report);
  assert.deepEqual(spec.z, [[7, 2200, null]]);
  assert.equal(inCore(spec, 20, 2500), true);
  assert.equal(inCore(spec, 180, 2500), false);
  assert.equal(inCore(spec, 20, 2100), false);
  // Kernzone, Stufe 3: ab 35° meiden, ab 30° Vorsicht
  assert.equal(dangerClass(spec, 36, 10, 2500), 2);
  assert.equal(dangerClass(spec, 31, 10, 2500), 1);
  // Südhang (keine Kernzone) → eine Stufe weniger (2): erst ab 40° meiden
  assert.equal(dangerClass(spec, 36, 180, 2500), 1);
  assert.equal(dangerClass(spec, 41, 180, 2500), 2);
  // unter der Höhengrenze Stufe 2, außerhalb der Kernzone → 1
  assert.equal(dangerClass(spec, 38, 10, 1500), 0);
  assert.equal(dangerClass(spec, 20, 10, 2500), 0);
  assert.equal(dangerSpec({ state: 'none' }), null);
  // ohne Lawinenprobleme gilt alles als Kernzone
  assert.equal(inCore(dangerSpec({ ...report, problems: [] }), 180, 1000), true);
});

test('Lawinen: Route durch steilen Nordhang', () => {
  const spec = dangerSpec({ state: 'rated', level: 3, high: 3, low: 3, boundM: null, problems: [] });
  // Gelände: ab 47,005 steiler Hang (40°) nach Norden abfallend, sonst flach
  const elev = (lng, lat) => (lat > 47.005 ? 2000 - (lat - 47.005) * 111320 * Math.tan((40 * Math.PI) / 180) : 2000);
  const coords = [];
  for (let i = 0; i <= 40; i++) coords.push([11, 47 + i * 0.00025]);
  const c = checkRoute(coords, elev, spec);
  assert.equal(c.level, 2);
  assert.ok(c.sections.length >= 1 && c.sections[0].from > 400);
  assert.ok(Math.abs(c.sections[0].slope - 40) < 1.5);
  const flat = checkRoute(coords, () => 1500, spec);
  assert.equal(flat.level, 0);
  assert.equal(checkRoute(coords, () => null, spec), null);
});

import { emailSuggestion } from '../src/api/auth.js';
test('Konto: Tippfehler in der E-Mail erkennen', () => {
  assert.equal(emailSuggestion('max@iclud.com'), 'max@icloud.com');
  assert.equal(emailSuggestion('max@gmial.com'), 'max@gmail.com');
  assert.equal(emailSuggestion('max@gmx.de'), null);
  assert.equal(emailSuggestion('max@web.de'), null);
  assert.equal(emailSuggestion('max@alpenverein-muenchen.de'), null);
  assert.equal(emailSuggestion('kein-at-zeichen'), null);
});
