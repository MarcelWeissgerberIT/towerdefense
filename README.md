# Iron Sentinel – Tower Defense

Isometrisches Tower Defense im Browser, gebaut für das iPhone (Touch, Safe Areas, Hoch- und Querformat, „Zum Home-Bildschirm“ als Vollbild-App).

**Szenario:** Jahr 2049. Eine KI-Maschinenarmee aus Chrom-Endoskeletten, Spinnendrohnen, Jagdpanzern, Gunships und Mutterschiffen marschiert auf das letzte Hauptquartier der Menschheit. Du verteidigst es mit futuristischen Militärtürmen – in 40 Einsätzen auf 6 Kriegsschauplätzen.

▶ **Spielen:** https://marcelweissgerberit.github.io/towerdefense/

## Inhalt
- **25 Level** mit steigender Schwierigkeit in 5 Biomen: Ödland, Dschungel, Wüste, Arktis, Vulkan – 1 bis 3 Angriffsrouten, 10–25 Wellen, Sterne-Wertung, Fortschritt wird lokal gespeichert
- **9 Türme** (je 3 Stufen, Zielmodus Erster/Stärkster/Nächster), schrittweise freigeschaltet:
  Gatling-MG · Raketenwerfer · Plasmakanone · EMP-Turm · Flak · Flammenwerfer · Railgun · Laser · Mörser
- **11 Gegnertypen:** Späher-Spinne, Endoskelett, Jäger-Drohne, Sturm-Mech, HK-Panzer, Schild-Android, Reparatur-Crawler, Kamikaze-Drohne, Belagerungs-Walker und die Bosse Koloss & Mutterschiff
- **Gegner greifen an:** Mechs, Panzer, Drohnen, Walker und Bosse beschießen die Türme; Kamikaze-Drohnen stürzen sich auf sie. Türme haben Panzerung, regenerieren langsam und lassen sich reparieren.
- **Echte 3D-Drehung & Animation:** Geschütztürme schwenken realistisch zum Ziel (32 Winkel), mit Rückstoß und Mündungsfeuer am echten Laufende. Endoskelette, Schild-Androiden und Mechs haben echte Laufzyklen (Meshy-Rigging, 16 Richtungen × 8 Phasen, an die Laufgeschwindigkeit gekoppelt); Spinnen trippeln, Walker stampfen mit Staubwolken, Panzer vibrieren, Drohnen legen sich in die Kurve. Alle Einheiten laufen weiche Bögen durch Kurven.
- **Effekte:** Explosionen aus einem echten Feuerball-Video, Druckwellen, Glutbrocken, Trümmer, Rauchsäulen, Brandspuren, Laserstrahlen, Flammenstrahl, Flak-Wolken, Kettenblitze, Biom-Atmosphäre (Asche, Glühwürmchen, Staub, Schnee, Glut)
- **Einfache Touch-Bedienung:** Feld antippen → Ring-Menü → Turm 1× antippen (Vorschau + Reichweite) → nochmal antippen zum Bauen. Turm antippen → Upgrade, Reparieren, Zielmodus, Verkaufen. 1 Finger verschiebt, 2 Finger zoomen.

## Asset-Pipeline
1. **OpenArt** (GPT Image 2): Konzeptbilder aller Türme und Gegner, Requisiten, Bodentexturen pro Biom, Titelbild; **OpenArt-Video** (PixVerse) für die Explosion.
2. **Meshy** (Image-to-3D): aus jedem Turm-/Gegnerbild ein texturiertes PBR-3D-Modell (`tools/meshy.py`, Eingaben in `tools/meshy_jobs.json`); humanoide Gegner werden zusätzlich mit Meshy gerigged und bekommen eine Laufanimation (`tools/meshy_rig.py`). Der API-Key wird nur per Umgebungsvariable übergeben und nie gespeichert.
3. **Offline-Renderer** (`tools/render/`): Three.js rendert die Modelle headless exakt im Iso-Winkel des Spiels. Türme werden in Sockel + drehbaren Geschützkopf geteilt (32 Winkel, Mündungspunkte pro Frame), Gegner in 16 Richtungen (animierte Modelle mit 8 Laufphasen pro Richtung, Root-Motion herausgerechnet) → WebP-Sprite-Sheets in `assets/models/`.
4. `tools/process_assets.py` stellt die 2D-Requisiten frei (weißer bzw. Magenta-Hintergrund, Kantenbereinigung), `tools/make_vfx.py` macht aus dem Explosions-Video ein RGBA-Sheet.
5. `tools/gen_levels.mjs` generiert die 25 Karten (Pfade auf einem Grobraster, garantierter Bauplatz zwischen den Straßen), `tools/balance_sim.mjs` lässt einen Bot alle Level durchspielen.

Das Spiel selbst ist reines HTML5 Canvas 2D + ES-Module ohne Build-Schritt und läuft flüssig auf dem iPhone.

**Offline & Fortsetzen:** `sw.js` (Service Worker) hält alle Spieldateien auf dem Gerät; `tools/gen_sw.mjs` schreibt bei jedem Deploy die Dateiliste mit Inhalts-Hashes hinein (läuft im Pages-Workflow), sodass nach einem Update nur geänderte Dateien neu geladen werden. **Barrikaden & Gegenoffensive:** Gegner laufen den günstigsten Weg durchs Straßennetz (Dijkstra über die Straßenfelder); eine Barrikade zählt als 40 Felder Umweg – mit freiem Umweg wird sie umgangen, sonst bleiben Bodentruppen davor stehen und rammen sie. Die 10 Einsätze der „Gegenoffensive“ (31–40) haben Straßennetze mit Umwegen und Abkürzungen (`tools/gen_levels.mjs`, `bypass` in `js/level_specs.js`); `power` legt dort die Gegnerstärke fest. `BAR=1 node tools/balance_sim.mjs 31 40` lässt den Bot Barrikaden für die längsten Umwege setzen.

**Musik:** vier mit OpenArt (Wan 3.0, Video mit Tonspur) erzeugte Stücke in d-Moll – Bauphase, zwei Gefechts-Themen im Wechsel pro Welle, Boss. `tools/make_music.py` schneidet daraus nahtlose Schleifen über ganze Takte (Rhythmus- und Harmonie-Abgleich an der Naht, Überblendung, Lautheit), das Spiel blendet je nach Lage über. Eine laufende Mission wird alle paar Sekunden und beim Wechsel in den Hintergrund lokal gespeichert und lässt sich im Hauptmenü fortsetzen.

## Lokal starten
```bash
python3 -m http.server 8000
# http://localhost:8000          (?level=7 startet direkt Einsatz 7)
```
