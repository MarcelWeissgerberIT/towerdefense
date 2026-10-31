# Iron Sentinel – Tower Defense

Isometrisches Tower Defense im Browser – optimiert für das iPhone (Touch, Safe-Areas, Hoch- und Querformat, „Zum Home-Bildschirm“ als Vollbild-App).

**Szenario:** Jahr 2049. Eine KI-Maschinenarmee aus Chrom-Endoskeletten, Spinnendrohnen, Jagdpanzern und Gunship-Drohnen marschiert auf das letzte Hauptquartier der Menschheit. Du verteidigst es mit realistischen, futuristischen Militärtürmen.

▶ **Spielen:** https://marcelweissgerberit.github.io/towerdefense/

## Features
- 3 Einsätze (Ödland, Ruinenstadt, Letzte Festung mit Zangenangriff über zwei Routen), je 20 Wellen, Sterne-Wertung, Fortschritt wird lokal gespeichert
- 5 Türme mit je 3 Stufen und Zielmodi (Erster / Stärkster / Nächster):
  - **Gatling-MG** – Rotorkanone, hohe Feuerrate, Boden + Luft
  - **Raketenwerfer** – Lenkraketen mit Flächenschaden, doppelt gegen Drohnen
  - **Plasmakanone** – ignoriert Panzerung, nur Bodenziele
  - **Railgun** – durchschlägt alles in einer Linie, riesige Reichweite
  - **EMP-Turm** – Kettenblitz, verlangsamt Maschinen
- 6 Gegnertypen inkl. fliegender Drohnen und Boss „Koloss“, gepanzerte Einheiten
- Effekte: Leuchtspur, Raketen mit Rauchspur, Plasma, Railgun-Strahl, Kettenblitze, Explosionen, Trümmer, Brandspuren am Boden
- Prozedurale Soundeffekte (WebAudio), 1×/2×/3× Geschwindigkeit, Pause
- Touch: Turm wählen → Feld antippen (Vorschau mit Reichweite) → nochmal tippen/„Bauen“; 1 Finger verschieben, 2 Finger zoomen

## Technik
- Reines HTML5 Canvas 2D + ES-Module, kein Build-Schritt, keine Abhängigkeiten
- Isometrische Projektion: Bodentexturen werden top-down komponiert und per affiner Transformation in die Iso-Ansicht projiziert (inkl. Erdschicht-Seitenflächen)
- Alle Grafiken (Türme, Gegner inkl. Rückansichten, Requisiten, Basis, Tor, Texturen, Titelbild) wurden mit **OpenArt** (GPT Image 2) generiert und mit `tools/process_assets.py` freigestellt (Hintergrund-Entfernung, Kantenbereinigung, WebP)
- Deployment über GitHub Actions → GitHub Pages (`.github/workflows/pages.yml`)

## Lokal starten
```bash
python3 -m http.server 8000
# http://localhost:8000
```
`?level=0|1|2` startet direkt einen Einsatz. Desktop: Tasten 1–5 wählen Türme, Leertaste ruft die nächste Welle, Mausrad zoomt.

## Werkzeuge
- `tools/process_assets.py <raw_dir> assets` – baut Sprites/Texturen aus den Roh-Renderings (Quellen + OpenArt-URLs in `tools/sources.json`)
- `node tools/balance_sim.mjs` – ein Bot spielt alle Level headless durch (Balancing)
