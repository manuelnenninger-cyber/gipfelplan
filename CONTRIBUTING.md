# Mitarbeiten an Gipfelplan

Schön, dass du mitmachst! Diese Seite beschreibt, wie wir zusammenarbeiten, damit der Code und die Historie übersichtlich bleiben.

## Einrichten

```bash
git clone https://github.com/manuelnenninger-cyber/gipfelplan.git
cd gipfelplan
npm install
git config commit.template .gitmessage   # Vorlage für Commit-Nachrichten
npm run dev                               # http://localhost:5173
```

Voraussetzung ist Node.js ab Version 20.

## Ablauf

1. **Issue zuerst**: Größere Änderungen kurz als Issue beschreiben, damit nicht zwei Leute dasselbe bauen.
2. **Eigener Branch** pro Thema, von `main` abgezweigt:
   `feat/lawinen-tendenz`, `fix/zugspitze-routen`, `docs/readme-start`
3. **Kleine, in sich geschlossene Commits** – jeder Commit soll für sich verständlich sein und die App lauffähig lassen.
4. **Pull Request** gegen `main` öffnen. Die Vorlage fragt ab, was sich ändert, warum und wie es getestet wurde. Die automatischen Prüfungen (Tests und Build) müssen grün sein.
5. Nach dem Review wird **per „Squash and merge“** oder „Rebase and merge“ zusammengeführt; `main` ist immer lauffähig.

## Commit-Nachrichten

Wir schreiben Commits nach [Conventional Commits](https://www.conventionalcommits.org/de/), **auf Deutsch**:

```
<typ>(<bereich>): <was sich ändert>

<warum – optional, aber bei allem Nicht-Trivialen erwünscht>

<Verweise, z. B. "Closes #12">
```

- **Betreffzeile**: Imperativ („Zeige …“, „Behebe …“, „Lade …“), höchstens 72 Zeichen, kein Punkt am Ende.
- **Text**: Warum war die Änderung nötig, was ist für Nutzer anders, worauf sollte man achten? Zeilen um 72 Zeichen umbrechen.
- **Ein Thema pro Commit.** Formatierungen nicht mit inhaltlichen Änderungen mischen.

| Typ | Wofür |
|---|---|
| `feat` | neue Funktion für Nutzer |
| `fix` | Fehlerbehebung |
| `perf` | schneller, flüssiger, weniger Abrufe |
| `refactor` | Umbau ohne sichtbare Änderung |
| `style` | Aussehen (CSS), keine Logik |
| `docs` | README, Kommentare, diese Datei |
| `test` | Tests ergänzen oder anpassen |
| `chore` | Build, Abhängigkeiten, Konfiguration |

Bereiche: `routen`, `wetter`, `lawinen`, `karte`, `suche`, `ui`, `daten`, `build`.

Beispiele:

```
feat(karte): Hütten und Parkplätze anklickbar machen
fix(routen): Startpunkte an Seilbahnen nicht mehr als Talort werten
perf(wetter): Wetterbild im Hintergrund-Thread berechnen
docs: Lawinenvorschau mit ?lawinen=JJJJ-MM-TT erklären
```

Die Vorlage `.gitmessage` zeigt das Format beim Committen direkt im Editor an (siehe „Einrichten“).

## Code

- Oberfläche und Kommentare auf **Deutsch**, Bezeichner im Code auf Englisch.
- Keine neuen Laufzeit-Abhängigkeiten ohne Absprache – die App soll schlank bleiben.
- Logik, die sich ohne Browser prüfen lässt (Berechnungen, Datenaufbereitung), gehört in eigene Funktionen und bekommt einen Test in `tests/`.
- **Datenquellen schonen**: Alle Dienste sind kostenlos und für faire Nutzung gedacht. Abrufe zwischenspeichern, Zeitlimits setzen, keine Schleifen ohne Bremse. Keine Seiten ohne offene Schnittstelle auslesen (z. B. komoot).
- Vor dem Commit: `npm test`.

## Fragen

Einfach ein Issue aufmachen.
