# Gipfelplan

Touren- und Wetterplanung für Wanderungen und Bergtouren im Browser. Gipfel suchen, Routenvorschläge vom Tal ansehen, Wetter und Lawinenlage am Gipfel prüfen und auf einer animierten Wetterkarte verfolgen, wie Wolken, Niederschlag, Gewitter und Wind ziehen.

- **Routen** vom Parkplatz, Bahnhof oder der Bergbahn zum Gipfel – mit Gehzeit, Höhenprofil, SAC-Schwierigkeit und GPX-Export
- **Wetter** am Gipfel für mehrere Tage, Tourenampel, animierte Wetterkarte (Niederschlag, Wolken in drei Höhen, Gewitter, Wind, Radar)
- **Lawinenlage** der europäischen Warndienste als Karte und Zusammenfassung
- **Karte** mit Höhenlinien, hervorgehobenen Wanderwegen und Gipfeln, anklickbaren Hütten und Parkplätzen, 2D/3D, Topo und Satellit

Alle Datenquellen sind offen und ohne API-Schlüssel nutzbar. Mitarbeit: siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

Am Mac: Doppelklick auf **„Gipfelplan starten.command“**. Oder im Terminal:

```bash
npm install
npm run dev
```

Der Browser öffnet sich auf http://localhost:5173. Gib einen Gipfel ein, z. B. „Sonnenspitze“, und wähle den passenden Treffer (es gibt mehrere Berge dieses Namens; die Region steht dabei).

Tastenkürzel: `/` oder `⌘K` springt in die Suche, `Esc` schließt die Wetterkarte.

Die Logik (Routenauswertung, Gehzeit, Tourenampel, Wetterraster) ist getestet:

```bash
npm test
```

## Was die App kann

**Gipfelsuche**: über OpenStreetMap (Photon). Gipfel lassen sich auch direkt auf der Karte antippen. Der gewählte Gipfel steht in der Adresszeile, ein Neuladen stellt ihn wieder her.

**Routenvorschläge**: Die App sucht im Umkreis von 9 km (bei Gipfeln über 2500 m 12 km) Parkplätze, Wanderparkplätze, Bergbahnen, Bahnhöfe und Bushaltestellen, wählt Startpunkte aus möglichst verschiedenen Himmelsrichtungen und berechnet mit BRouter (eigenes Profil auf Basis von `hiking-mountain`) den Weg zum Gipfel. Für jede Route:
- Strecke, Höhenmeter, Gehzeit hoch und runter (DAV/SAC-Formel: 4 km/h, 300 Hm/h hoch, 500 Hm/h runter)
- Schwierigkeit nach SAC-Skala (T1–T6) aus den OSM-Wegdaten
- interaktives Höhenprofil, das die Position auf der Karte zeigt
- Hinweise auf Klettersteige, weglose Gipfelanstiege und Bergbahnen
- GPX-Download fürs Handy oder die Uhr

**Tourenquellen**: Neben berechneten Wegen (direkt, Varianten, über Hütten, Rundtouren) übernimmt die App markierte, benannte Wanderwege aus OpenStreetMap. komoot, Outdooractive, Bergfex und hikr haben keine offene Schnittstelle; die App verlinkt dorthin. Touren von dort lassen sich als GPX exportieren und per Knopf oder Drag & Drop importieren – mit Höhenprofil, Gehzeit und Wetter. Fehlende Höhen in der Datei ergänzt das Höhenmodell.

Die Karte startet in 2D; 3D-Gelände schaltet man bei Bedarf über „3D“ ein.

**Am Handy** ist die Seitenleiste ein Bottom-Sheet mit drei Höhen (eingeklappt, halb, voll), das man wie in Apple Karten zieht und wischt. Tippt man auf die Karte, klappt es ein und die gewählte Route wird in den frei gewordenen Bereich eingepasst; Hochwischen holt die Details zurück.

**Gipfelwetter**: 7-Tage-Prognose von Open-Meteo, Temperaturen auf Gipfelhöhe umgerechnet. Der Gipfelwind kommt von der passenden Druckfläche (z. B. 700 hPa ≈ 3000 m), weil der 10-m-Wind der Modelle in Gipfellage zu niedrig ist. Dazu stündlicher Verlauf, Nullgradgrenze, Gewitterrisiko, Neuschnee, Sonnenzeiten und eine grobe Tourenampel je Tag.

**Wetterkarte** (öffnet sich mit dem Tab „Wetter“): Ebenen Niederschlag (mit Wolken darunter, Regen und Schnee getrennt), Wolken, Gewitter, Wind (Boden oder 3000 m, mit Windpartikeln) und Radar (gemessen, letzte 2 h). Zeitleiste über 5 Tage, stündlich, zwischen den Stunden weich überblendet. Die Wolken sind nach Stockwerken getrennt: tief (weiß, z. B. Nebel oder Gipfel in Wolken), mittel (bläulich), hoch (violetter Schleier). Die Grundkarte wird im Wettermodus abgedunkelt.

Zwei Raster werden ineinander geblendet: ein regionales (14 × 14 Punkte) für die ganze Ansicht und ein feines (ca. 2 km Abstand, Auflösung des Modells ICON-D2) um Gipfel und Routen. Geladene Raster werden 45 Minuten zwischengespeichert.

**Karte**: Standard (Vektor mit Relief), Topo (OpenTopoMap), Satellit; 3D-Gelände; markierte Wanderwege als Overlay.

**Wanderebenen** (alle Grundkarten): Höhenlinien aus dem Geländemodell (ab Zoom 11; 100 m → 10 m Abstand je nach Zoom, jede fünfte Linie kräftiger und beschriftet, abschaltbar; in Topo ausgeblendet, weil OpenTopoMap eigene hat). Fußwege rot gestrichelt mit weißem Rand, Fahrwege braun, beides wächst mit dem Zoom. Gipfel als Dreieck mit Name und Höhe; bei Platzmangel gewinnt der höhere Gipfel.

**Lawinenlage**: Im Wetter-Tab steht oben die aktuelle Lawinenwarnstufe der Gipfelregion (EAWS-Farben): Stufe, Region und Warndienst, Stufe ober- und unterhalb der Höhengrenze, Stufe auf Gipfelhöhe, Anstieg im Tagesverlauf, Lawinenprobleme mit Höhe und Hangrichtungen, Kernaussage, Tendenz, Gültigkeit und Link zum ganzen Bericht. „Heute“ und „Morgen“ (ab ca. 17 Uhr) haben einen Bericht. In der Wetterkarte färbt die Ebene „Lawinen“ alle Regionen ein – getrennt nach ober-/unterhalb der Höhengrenze wie auf avalanche.report; die Zeitleiste wählt den passenden Tagesbericht (vor-/nachmittags). Gibt es für die Gipfelregion eine Stufe, öffnet die Wetterkarte direkt mit dieser Ebene. Außerhalb der Saison steht „Keine Warnstufe“. Mit `?lawinen=2026-02-15` in der Adresse lässt sich ein vergangener Wintertag als Vorschau anzeigen.

**Webcams**: Kamerasymbole zeigen Webcams im Umkreis von 25 km um den Gipfel. Antippen öffnet das aktuelle Bild (mit Alter, z. B. „vor 7 Min.“), einen Link zum Anbieter (z. B. bergfex, foto-webcam.eu, Panomax) und den Zeitraffer. Quelle ist die Windy Webcams API; sie braucht einen kostenlosen Schlüssel (siehe „Webcams einrichten“). Ohne Schlüssel bleibt die Ebene einfach leer.

**Hütten und Parkplätze** sind anklickbar und öffnen eine kleine Infokarte: Foto (aus OSM/Wikidata verlinkt, bei Hütten sonst ein Foto aus unmittelbarer Nähe von Wikimedia Commons), Öffnungszeit mit „geöffnet/derzeit geschlossen“ (aus der Saison in `opening_hours`), Betreiber, Schlafplätze, Gebühr und Stellplätze, Lage zum Gipfel (Luftlinie, Höhenmeter darunter), Knöpfe für Website, Anrufen und Navigation (Apple Karten bzw. Google Maps).

## Leistung

- Die Karte startet in 2D. In 3D rendert sie mit reduzierter Auflösung (Pixelverhältnis 1,35 statt 2) und lädt Geländedaten nur bis Zoomstufe 12; 3D-Gebäude sind ausgeblendet.
- Während die Karte bewegt wird, schaltet die Oberfläche die Glas-Unschärfe ab.
- Hütten sind eine Kartenebene statt HTML-Elementen.
- Die Wetterbilder werden in einem Web Worker berechnet (trennbare bikubische Interpolation, ca. 15 ms pro Bild) und nur bei Änderungen an die Grafikkarte übergeben – im Ruhezustand zeichnet die Karte nicht neu.
- Wetterdaten werden im Browser (IndexedDB) zwischengespeichert: Raster 45 min, Gipfelprognose 30 min. Ein Neuladen der Seite kostet so kein Kontingent beim Wetterdienst.

## Aufbau

```
src/
  main.js               Ablauf: Gipfel wählen → Startpunkte → Routen + Wetter
  config.js             alle Datenquellen an einer Stelle
  api/
    search.js           Gipfelsuche (Photon)
    osm.js              Startpunkte und Hütten (Overpass)
    routing.js          Startpunktwahl, BRouter, Auswertung, GPX
    weather.js          Gipfelprognose, Tourenampel, Wetterraster
    radar.js            Radarbilder (RainViewer)
  map/
    map.js              MapLibre: Stile, 3D, Routen, Marker
    outdoorLayers.js    Höhenlinien, Wanderwege, Gipfel für alle Grundkarten
    avalancheLayer.js   Lawinenwarnstufen als Kartenebene
    field.js            Rechenkern der Wetterkarte (testbar, ohne DOM)
    weatherOverlay.js   Wetterfelder, Windpartikel, Radar auf der Karte
    fieldWorker.js      berechnet die Wetterbilder im Hintergrund
  ui/                   Suche, Routenliste, Höhenprofil, Wetter, Zeitleiste, Infokarte, Icons
tests/                  Node-Tests der Logik
```

Einzige Laufzeit-Abhängigkeit ist MapLibre GL JS. Die Höhenlinien berechnet maplibre-contour, das beim ersten Bedarf aus dem CDN (jsDelivr) nachgeladen wird.

## Datenquellen

Alle Dienste sind ohne Schlüssel nutzbar, aber für faire, persönliche Nutzung gedacht:

| Zweck | Dienst | Hinweis |
|---|---|---|
| Karte | OpenFreeMap, OpenTopoMap, Esri World Imagery | Satellit nur für Entwicklung; für ein öffentliches Angebot Nutzungsbedingungen prüfen |
| Gelände 3D, Höhenlinien | AWS Terrain Tiles (Terrarium) | Höhenlinien werden im Browser berechnet (maplibre-contour) |
| Suche | Photon (komoot) | |
| Lawinenlage | EAWS-Berichte über avalanche.report (`static.avalanche.report`: Warnstufen, Berichte, Regionsgrenzen als PMTiles) | Bibliotheken pmtiles, vector-tile, pbf werden aus dem CDN nachgeladen |
| Webcams | Windy Webcams API (kostenloser Schlüssel) | Bilder verlinken auf Windy, Hinweis „Webcams provided by Windy.com“ ist Pflicht; Bild-Adressen gelten ca. 10 Minuten |
| Hütten-/Parkplatzinfos | OSM-Tags (Overpass, sonst Nominatim), Fotos von Wikidata/Wikimedia Commons | |
| Gipfelhöhen | Nominatim (OSM) | exakte Höhe aus OSM; Höhenmodell nur als Notlösung („ca.“) |
| Markierte Wege | Waymarked Trails (OSM) | benannte Wanderwege, die den Gipfel erreichen (z. B. Höllentalsteig); BRouter folgt ihnen vom nächsten Talort |
| Startpunkte | Overpass API, Photon | Overpass ist oft überlastet; nach kurzer Wartezeit übernimmt Photon (nur benannte Orte) |
| Routing | BRouter (brouter.de) | eigenes Profil auf Basis von `hiking-mountain`, das auch T4–T6 erlaubt; max. 3 Anfragen parallel |
| Wetter | Open-Meteo | frei: 600 Abrufe/Minute, 5.000/Stunde, 10.000/Tag. Jeder Rasterpunkt zählt als Abruf: Regionalraster 144, Detailraster ca. 100–250. Bei erreichtem Limit lädt die Karte zur nächsten vollen Stunde automatisch neu |
| Radar | RainViewer | seit 2026 nur noch letzte 2 h, Zoom bis 7, persönliche Nutzung |
| Wanderwege | Waymarked Trails | |

## Online (Vercel)

Die App läuft als statische Seite auf [Vercel](https://vercel.com). `vercel.json` legt den Build fest (`npm run build` → `dist/`) und leitet die Proxy-Pfade für BRouter und Overpass an die echten Dienste weiter – dieselben Pfade wie im Dev-Server (`vite.config.js`), der Code muss also nichts unterscheiden.

Einrichten (einmalig): Auf vercel.com mit GitHub anmelden → „Add New… → Project“ → Repository `gipfelplan` importieren → „Deploy“. Danach veröffentlicht jeder Push auf `main` automatisch eine neue Version; Pull Requests bekommen eine eigene Vorschau-Adresse.

### Webcams einrichten

1. Kostenlosen Schlüssel holen: https://api.windy.com/keys (Produkt „Webcams API“).
2. Online: in Vercel unter Settings → Environment Variables `WINDY_WEBCAMS_KEY` anlegen und neu veröffentlichen (Deployments → Redeploy).
3. Lokal: `.env.example` nach `.env.local` kopieren und den Schlüssel eintragen. `.env.local` wird nicht eingecheckt.

Der Schlüssel bleibt auf dem Server: Der Browser fragt `/api/webcams`, das online die Vercel-Funktion `api/webcams.js` und lokal der Vite-Dev-Server beantwortet (gemeinsamer Code in `server/webcams.js`).

Für mehr Nutzer: Open-Meteo-Abo oder eigene Instanz, eigener BRouter-Server (Docker-Image vorhanden), Kartenkacheln von einem Anbieter mit Vertrag. Die Satellitenkarte (Esri) ist nur für die private Nutzung gedacht.

## Ideen für die nächsten Schritte

- Rundtouren und Überschreitungen (Auf- und Abstieg über verschiedene Wege)
- Hütten als Zwischenziel, Öffnungszeiten aus OSM
- Lawinenlagebericht einbinden (Euregio, Bayern, Schweiz)
- Tour speichern und als Link teilen, Offline-Modus als PWA
- Eigene Startpunkte per Klick auf die Karte setzen
