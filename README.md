# Gipfelplan

Touren- und Wetterplanung für Wanderungen und Bergtouren im Browser. Gipfel suchen, Routenvorschläge vom Tal ansehen, Wetter und Lawinenlage am Gipfel prüfen und auf einer animierten Wetterkarte verfolgen, wie Wolken, Niederschlag, Gewitter und Wind ziehen.

- **Routen** vom Parkplatz, Bahnhof oder der Bergbahn zum Gipfel – mit Gehzeit, Höhenprofil, SAC-Schwierigkeit und GPX-Export
- **Wetter** am Gipfel für mehrere Tage, Tourenampel, animierte Wetterkarte (Niederschlag, Wolken in drei Höhen, Gewitter, Wind, Radar)
- **Lawinenlage** der europäischen Warndienste als Karte und Zusammenfassung
- **Karte** mit Höhenlinien, hervorgehobenen Wanderwegen und Gipfeln, anklickbaren Hütten und Parkplätzen, 2D/3D, Topo und Satellit
- **Als App** auf dem Handy-Home-Bildschirm, zuletzt angesehene Touren auch ohne Empfang

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

**Route zeichnen**: Über „Route zeichnen“ tippt man die Punkte der Tour nacheinander auf der Karte an – Parkplatz, Hütte, Gipfel oder einen beliebigen Punkt am Weg (der Gipfel geht auch per Knopf). Die App verbindet sie über vorhandene Wege (BRouter, gleiches Bergprofil wie bei den Vorschlägen) und zeigt sofort Strecke, Höhenmeter, Gehzeit und Schwierigkeit. Punkte lassen sich auf der Karte verschieben oder entfernen, „Zurück zum Start“ macht eine Rundtour daraus. „Route übernehmen“ legt sie in die Tourenliste – mit Höhenprofil, Details, Wetter und GPX-Export. Endet die Route oben, wird der Abstieg auf gleichem Weg gerechnet; Rundtouren und Überschreitungen einfach.

**Tourenquellen**: Neben berechneten Wegen (direkt, Varianten, über Hütten, Rundtouren) übernimmt die App markierte, benannte Wanderwege aus OpenStreetMap. komoot, Outdooractive, Bergfex und hikr haben keine offene Schnittstelle; die App verlinkt dorthin. Touren von dort lassen sich als GPX exportieren und per Knopf oder Drag & Drop importieren – mit Höhenprofil, Gehzeit und Wetter. Fehlende Höhen in der Datei ergänzt das Höhenmodell.

Die Karte startet in 2D; 3D-Gelände schaltet man bei Bedarf über „3D“ ein.

**Am Handy** ist die Seitenleiste ein Bottom-Sheet mit drei Höhen (eingeklappt, halb, voll), das man wie in Apple Karten zieht und wischt. Tippt man auf die Karte, klappt es ein und die gewählte Route wird in den frei gewordenen Bereich eingepasst; Hochwischen holt die Details zurück.

**Gipfelwetter**: 7-Tage-Prognose von Open-Meteo, Temperaturen auf Gipfelhöhe umgerechnet. Der Gipfelwind kommt von der passenden Druckfläche (z. B. 700 hPa ≈ 3000 m), weil der 10-m-Wind der Modelle in Gipfellage zu niedrig ist. Dazu stündlicher Verlauf, Nullgradgrenze, Gewitterrisiko, Neuschnee, Sonnenzeiten und eine grobe Tourenampel je Tag.

**Wetterkarte** (öffnet sich mit dem Tab „Wetter“): Ebenen Niederschlag (mit Wolken darunter, Regen und Schnee getrennt), Wolken, Gewitter, Wind (Boden oder 3000 m, mit Windpartikeln) und Radar (gemessen, letzte 2 h). Zeitleiste über 5 Tage, stündlich, zwischen den Stunden weich überblendet. Die Wolken sind nach Stockwerken getrennt: tief (weiß, z. B. Nebel oder Gipfel in Wolken), mittel (bläulich), hoch (violetter Schleier). Die Grundkarte wird im Wettermodus abgedunkelt.

Zwei Raster werden ineinander geblendet: ein regionales (14 × 14 Punkte) für die ganze Ansicht und ein feines (ca. 2 km Abstand, Auflösung des Modells ICON-D2) um Gipfel und Routen. Geladene Raster werden 45 Minuten zwischengespeichert.

**Karte**: Standard (Vektor mit Relief), Topo (OpenTopoMap), Satellit; 3D-Gelände; markierte Wanderwege als Overlay.

**Wanderebenen** (alle Grundkarten): Höhenlinien aus dem Geländemodell (ab Zoom 11; 100 m → 10 m Abstand je nach Zoom, jede fünfte Linie kräftiger und beschriftet, abschaltbar; in Topo ausgeblendet, weil OpenTopoMap eigene hat). Fußwege rot gestrichelt mit weißem Rand, Fahrwege braun, beides wächst mit dem Zoom. Gipfel als Dreieck mit Name und Höhe; bei Platzmangel gewinnt der höhere Gipfel.

**Hangneigung**: Im Kartenmenü zuschaltbar (ab Zoom 11). Die App berechnet aus den Geländekacheln je Pixel die Neigung und färbt steile Hänge wie die Lawinen-Hangneigungskarten: ab 30° gelb, 35° orange, 40° rot, ab 45° violett. Die Kacheln entstehen im Browser (`src/map/slope.js`, MapLibre-Protokoll `gp-slope://`) und funktionieren in allen Grundkarten, in 3D und ohne Empfang, soweit das Gelände schon geladen war.

**Touren teilen**: In jeder Tour erzeugt „Teilen“ einen kurzen Link (`/t/<id>`) – ohne Anmeldung. Der Dialog bietet das Teilen-Menü des Handys, WhatsApp und „Link kopieren“. Messenger zeigen eine Vorschau: Titel („Zugspitze: Über Knorrhütte“), Eckdaten (Schwierigkeit, Gehzeit, Höhenmeter, Strecke) und ein Bild mit Topo-Karte, Route, Gipfel, Höhenprofil und Logo. Wer den Link öffnet, landet direkt in der App bei dieser Tour (Markierung „Geteilt“). Technik: Tabelle `shares` mit Zugriff nur über `create_share`/`get_share` (`supabase/schema.sql`); die Linkseite (`api/share.js`) liefert die og:-Angaben und leitet weiter, das Vorschaubild (`api/share-image.js`) zeichnet der Server aus OpenTopoMap-Kacheln als JPEG – PNG-Lesen und JPEG-Schreiben ohne Abhängigkeiten in `server/raster.js`. Der App-Link selbst hat ebenfalls eine Vorschau (`public/og.jpg`).

**Auf einen Blick**: Unter dem Gipfelnamen steht eine Zeile wie „● Morgen gut · Lawinen 2 · ❄ Schnee ab 2.450 m“ – Tourenampel (bis 11 Uhr für heute, danach für morgen), Lawinenstufe auf Gipfelhöhe und Schneegrenze aus dem Satellitenbild entlang der schnellsten Tour. Antippen öffnet das Wetter. Ist eine Tour gewählt, treten die anderen auf der Karte zurück; im Kartenmenü färbt „Touren in Ampelfarben“ alle Touren nach Schwierigkeit (grün leicht, orange mittel, rot schwer).

**Startzeit & Wetter**: In jeder Tour führt „Startzeit & Wetter“ zu einer ausführlichen Übersicht (`src/ui/planView.js`, Logik in `src/api/plan.js`):
- *Tag und Startzeit* (Tageschips mit Ampel, Startzeit per Schieber oder ±15 min). Empfehlung „spätestens … losgehen“: vor möglichen Gewittern (Wettercode Gewitter oder CAPE ≥ 800) und 30 min vor Sonnenuntergang zurück; Hinweis auf Stirnlampe bei Start vor Sonnenaufgang.
- *Zeitplan & Wetter*: Start, Hütten, Gipfel, Rückkehr mit Uhrzeit, Temperatur auf der jeweiligen Höhe (−0,65 °C/100 m), Wind, Wetter und Warnungen genau zur Uhrzeit, zu der man dort ist. Antippen zeigt den Punkt auf der Karte.
- *Sonne & Schatten*: Für die ganze Tour (alle 6 min) wird aus Sonnenstand (`src/util/sun.js`) und Geländemodell (`src/map/dem.js`, ca. 50 m) berechnet, ob man in der Sonne geht – eigener Hang und Horizont bis 12 km. Ergebnis als Band und Satz („Aufstieg bis 9:40 im Schatten, Gipfel in der Sonne“). Ohne Wolken und Wald.
- *Schnee am Weg*: Das aktuelle Satellitenbild wird an 24 Punkten des Aufstiegs ausgewertet („ab etwa 2.450 m weiß – vermutlich Schnee“), dazu die Schneehöhe des Wettermodells je Höhenlage und angesagter Neuschnee. Ein Knopf blendet das Satellitenbild auf der Karte ein.

**Schnee (Satellitenbild)**: Im Kartenmenü zuschaltbar. Neueste Aufnahmen von Sentinel-2 und Landsat (NASA HLS über GIBS, ca. 30 m, alle 2–3 Tage, `src/map/satellite.js`); Lücken füllen ältere Bilder der letzten 16 Tage. Die Legende nennt das Datum. Wolken sind ebenfalls weiß.

**Schwierigkeit**: Über der Tourenliste filtern drei Knöpfe nach leicht (T1–T2, grün), mittel (T3, orange) und schwer (T4–T6, rot) – mit Anzahl, kombinierbar mit Rundtouren, Hütte usw.; nochmal tippen zeigt wieder alle. Karte und Liste zeigen dann nur diese Touren. Jede Tour trägt die Stufe samt SAC-Grad als farbiges Schild.

**Lawinen-Check (Skitouren)**: Gibt es eine Warnstufe, prüft die App jede Tour gegen den Lagebericht – nach dem Grundgedanken der Reduktionsmethode (`src/api/avyCheck.js`): Stufe 2 bis 40°, 3 bis 35°, 4 bis 30°; in den Kernzonen des Berichts (gefährdete Hangrichtungen und Höhen der Lawinenprobleme) gilt die Stufe voll, außerhalb eine Stufe weniger. Alle 25 m wird das Gelände bis ca. 15 m neben der Spur bewertet (Steilheit 28–60°, darüber Fels). Ergebnis: Kennzeichen „Lawine unauffällig / Vorsicht / kritisch“ in der Liste, im Tourdetail eine Karte mit Begründung und den Schlüsselstellen (km, Höhe, Steilheit, Hangrichtung, Kernzone), farbige Abschnitte im Höhenprofil und auf der Karte. Ab 17 Uhr gilt der Bericht für morgen. Grobe Planungshilfe – ersetzt weder Lagebericht noch Beurteilung vor Ort.

**Gefahrenstellen und Hangrichtung** (Kartenmenü, ab Zoom 11): „Gefahrenstellen (Lawinen)“ färbt Hänge, die nach derselben Regel heute zu steil sind (orange Vorsicht, rot meiden) – mit dem Bericht des gewählten Gipfels bzw. der Region in der Kartenmitte; die Legende nennt Stufe und Kernzonen. „Hangrichtung“ färbt Hänge ab 20° nach ihrer Richtung (Nord blau, Ost grün, Süd gelb, West rot); eine Windrose wählt einzelne Richtungen. Beides wird wie die Hangneigung im Browser aus den Geländekacheln berechnet (`src/map/terrain.js`).

**Lawinenlage**: Im Wetter-Tab steht oben die aktuelle Lawinenwarnstufe der Gipfelregion (EAWS-Farben): Stufe, Region und Warndienst, Stufe ober- und unterhalb der Höhengrenze, Stufe auf Gipfelhöhe, Anstieg im Tagesverlauf, Lawinenprobleme mit Höhe und Hangrichtungen, Kernaussage, Tendenz, Gültigkeit und Link zum ganzen Bericht. „Heute“ und „Morgen“ (ab ca. 17 Uhr) haben einen Bericht. In der Wetterkarte färbt die Ebene „Lawinen“ alle Regionen ein – getrennt nach ober-/unterhalb der Höhengrenze wie auf avalanche.report; die Zeitleiste wählt den passenden Tagesbericht (vor-/nachmittags). Gibt es für die Gipfelregion eine Stufe, öffnet die Wetterkarte direkt mit dieser Ebene. Außerhalb der Saison steht „Keine Warnstufe“. Mit `?lawinen=2026-02-15` in der Adresse lässt sich ein vergangener Wintertag als Vorschau anzeigen.

**Webcams**: Kamerasymbole zeigen Webcams im Umkreis von 25 km um den Gipfel. Antippen öffnet das aktuelle Bild (mit Alter, z. B. „vor 7 Min.“), einen Link zum Anbieter (z. B. bergfex, foto-webcam.eu, Panomax) und den Zeitraffer. Quelle ist die Windy Webcams API; sie braucht einen kostenlosen Schlüssel (siehe „Webcams einrichten“). Ohne Schlüssel bleibt die Ebene einfach leer.

**Notbiwaks, Hütten und Almen**: Neben Berghütten zeigt die Karte Biwakschachteln, Notunterkünfte, Unterstände und unbewirtschaftete Hütten (orange) sowie bewirtschaftete Almen (grün). Die Infokarte sagt, ob es sich um eine Notunterkunft handelt, und nennt Schlafplätze, Ofen oder Decken, soweit in OSM eingetragen.

**Hervorheben**: Knöpfe oben auf der Karte – „Hütten & Almen“, „Notbiwaks“, „Webcams“, jeweils mit Anzahl – heben eine Art hervor: farbiger Ring, größeres Symbol, Namen, schon ab weiter herausgezoomter Karte; alles andere wird blasser. Liegen nicht alle im Bild, zoomt die Karte so, dass man sie sieht. Nochmal tippen hebt die Auswahl auf. Die Knöpfe funktionieren auch ohne gewählten Gipfel: Dann lädt die App die gewählte Art für den sichtbaren Kartenausschnitt und beim Verschieben nach (ab mittlerer Zoomstufe; Hütten über Overpass mit Photon als Rückfall, Webcams über die Windy-Schnittstelle). Die Zahlen auf den Knöpfen gelten für den sichtbaren Ausschnitt. Am Handy stehen die Knöpfe bei geöffnetem Gipfel im Kartenmenü, damit der obere Rand frei bleibt.

**Konto & gespeicherte Touren**: Ohne Anmeldung nutzbar. Erst beim Tippen auf „Speichern“ fragt die App nach E-Mail und Passwort; neue Nutzer legen dort mit „Konto erstellen“ ihr Konto an und sind sofort angemeldet. „Passwort vergessen?“ schickt eine Mail mit Knopf und Code (der Code funktioniert auch in der App auf dem Home-Bildschirm). Jeder Browser merkt sich die Anmeldung dauerhaft; Anmelden und Abmelden gilt sofort in allen Tabs. Oben rechts: „Meine Touren“ (öffnen, löschen) und Abmelden. Technik: Supabase (Projekt `gipfelplan`, Frankfurt) direkt per REST ohne zusätzliche Bibliothek; Tabelle und Zeilenrechte in `supabase/schema.sql`.

**Als App und ohne Empfang**: Auf dem iPhone in Safari „Teilen → Zum Home-Bildschirm“ – die App startet dann im Vollbild mit eigenem Symbol (ein Hinweis erklärt das einmalig). Ein Service Worker (`public/sw.js`) speichert die App selbst, angesehene Kartenkacheln (inkl. Gelände und Höhenlinien) und die letzten Antworten der Datendienste. Zusätzlich legt die App für die letzten 12 Gipfel Routen, Hütten und Parkplätze sowie die Wetterprognose in IndexedDB ab (14 Tage). Ohne Empfang zeigt sie diesen Stand mit Hinweis „Ohne Empfang: gespeicherte Routen vom …“, die Suche bietet die zuletzt angesehenen Gipfel an, und „Meine Touren“ kommt aus einer lokalen Kopie. Die Karte ist offline nur dort vorhanden, wo man sie vorher mit Netz angesehen hat – am besten vor der Tour die Route einmal auf der Karte abfahren und hineinzoomen. Im Dev-Server ist der Service Worker aus; zum Ausprobieren `?sw=1` an die Adresse hängen.

**Hütten und Parkplätze** sind anklickbar und öffnen eine kleine Infokarte: Foto (aus OSM/Wikidata verlinkt, bei Hütten sonst ein Foto aus unmittelbarer Nähe von Wikimedia Commons), Öffnungszeit mit „geöffnet/derzeit geschlossen“ (aus der Saison in `opening_hours`), Betreiber, Schlafplätze, Gebühr und Stellplätze, Lage zum Gipfel (Luftlinie, Höhenmeter darunter), Knöpfe für Website, Anrufen und Navigation (Apple Karten bzw. Google Maps).

## Farben

Alle Farben kommen aus dem Logo und stehen als Variablen oben in `src/styles.css`:
- **Gipfelblau** `--blue-900` … `--blue-50` (Logo: `#2440be` → `#6b8bfe`, Schattenseite `#d6e0ff`). Akzent in Hell `#2440be`, in Dunkel `#6b8bfe`; Flächen mit weißer Schrift `--accent-fill`. Blau steht für alles, was man antippt oder ausgewählt hat.
- **Sonnengelb** `--sun` `#ffce40` (dazu `--sun-strong`, `--sun-soft`, `--sun-ink`): sparsam für Sonne & Schatten, Startzeit-Empfehlung und die selbst gezeichnete Route.
- **Grautöne** `--gray-900` … `--gray-100` für Text, Flächen und Linien.
- **Signalfarben** (Ampel grün/orange/rot, EAWS-Lawinenstufen) nur für Bewertungen.

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

### Konten einrichten (Supabase)

1. `supabase/schema.sql` im SQL-Editor ausführen (beim Projekt `gipfelplan` bereits geschehen).
2. Authentication → URL Configuration: Site URL `https://gipfelplan.vercel.app`, Redirect URLs `https://gipfelplan.vercel.app/**` und `http://localhost:5173/**`. Fehlt das, landet der Link aus der Mail auf `localhost:3000` und die Anmeldung kommt nicht in der App an.
3. Authentication → Sign In / Providers → Email: „Confirm email“ ausschalten, damit neue Konten sofort angemeldet sind (sonst kommt erst eine Bestätigungsmail; Vorlage dafür: `supabase/templates/bestaetigen.html`, Betreff `Gipfelplan: bitte E-Mail bestätigen`).
4. Authentication → Emails → Templates → „Reset Password“: Betreff `Gipfelplan: neues Passwort festlegen`, Inhalt `supabase/templates/passwort.html` (Knopf und Code).
5. Für echte Nutzer eigenen Mailversand eintragen (Authentication → SMTP, z. B. Resend) – der eingebaute schickt nur wenige Mails pro Stunde.

### Webcams einrichten

1. Kostenlosen Schlüssel holen: https://api.windy.com/keys (Produkt „Webcams API“).
2. Online: in Vercel unter Settings → Environment Variables `WINDY_WEBCAMS_KEY` anlegen und neu veröffentlichen (Deployments → Redeploy).
3. Lokal: `.env.example` nach `.env.local` kopieren und den Schlüssel eintragen. `.env.local` wird nicht eingecheckt.

Der Schlüssel bleibt auf dem Server: Der Browser fragt `/api/webcams`, das online die Vercel-Funktion `api/webcams.js` und lokal der Vite-Dev-Server beantwortet (gemeinsamer Code in `server/webcams.js`).

Für mehr Nutzer: Open-Meteo-Abo oder eigene Instanz, eigener BRouter-Server (Docker-Image vorhanden), Kartenkacheln von einem Anbieter mit Vertrag. Die Satellitenkarte (Esri) ist nur für die private Nutzung gedacht.

## Ideen für die nächsten Schritte

- Tour als Link teilen
- Kartenausschnitt einer Tour gezielt für unterwegs herunterladen
- Eigener Mailversand (SMTP), Datenschutzerklärung und Impressum vor dem Start für andere
