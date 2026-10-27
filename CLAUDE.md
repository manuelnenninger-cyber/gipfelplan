# Gipfelplan – Hinweise für Claude

Web-App zur Planung von Wanderungen und Bergtouren (Vite + MapLibre GL, reines JavaScript, keine Frameworks). Oberfläche und Kommentare auf Deutsch, Bezeichner auf Englisch. Überblick über Funktionen, Aufbau und Datenquellen: `README.md`.

## Befehle

- `npm run dev` – Entwicklungsserver auf http://localhost:5173 (Proxys für BRouter und Overpass in `vite.config.js`)
- `npm test` – Logik-Tests (Node, ohne Browser)
- `npm run build` – Produktions-Build nach `dist/`

## Commits

Immer nach den Regeln in `CONTRIBUTING.md`: Conventional Commits auf Deutsch, `<typ>(<bereich>): <Imperativ>`, höchstens 72 Zeichen, darunter ein kurzer Text mit dem Warum. Ein Thema pro Commit; `npm test` vorher ausführen. Neue Arbeit auf einem eigenen Branch (`feat/…`, `fix/…`), nicht direkt auf `main`, außer der Nutzer wünscht es.

## Regeln für den Code

- Keine neuen npm-Abhängigkeiten ohne Rückfrage. Optionale Bibliotheken (maplibre-contour, pmtiles) werden zur Laufzeit von jsDelivr geladen und dürfen die App nicht blockieren, wenn sie fehlen.
- Datenquellen schonen: Open-Meteo hat Tageslimits (Raster zählen pro Punkt), Overpass ist oft überlastet. Zwischenspeichern (`src/util/cache.js`), Zeitlimits (`fetchWithTimeout`), Rückfälle vorsehen.
- Eigene Kartenebenen beginnen mit `gp-` und überleben Stilwechsel; `gp-wx-*` verwaltet das Wetter-Overlay.
- Testbare Logik in reine Funktionen auslagern und in `tests/logic.test.js` abdecken.
