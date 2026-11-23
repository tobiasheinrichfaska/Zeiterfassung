# Zeiterfassung

Arbeitszeit erfassen: wann man gekommen ist, wann man gegangen ist und wie viel Pause man gemacht hat –
wahlweise als Eingabeformular oder mit Knöpfen wie an einer Stechuhr. Eine einzige HTML-Datei, die auf
dem eigenen Gerät läuft und nichts ins Netz sendet.

**Stand: Stufe 1 gebaut, noch nicht im Browser erprobt.** Stechuhr, Eingabeformular, Monatsansicht,
verschlüsselter Speicher, Sicherungsdatei und der PDF-Export (Tabelle mit angehängtem JSON, nach PDF/A-3b gebaut und noch nicht validiert) sind da; die
Logik und das PDF sind automatisch getestet, die Bildschirme noch von niemandem durchgespielt
(`manual_tests/`).

## Stufen

1. **Lokal (jetzt):** erfassen, verschlüsselt im Gerät speichern (`local-vault`), Navigation mit
   `rad-navi`, Sicherungsdatei, am Monatsende eine Zusammenfassung als PDF mit angehängten JSON-Daten, die der
   Mitarbeiter selbst an die digitale Personalakte mailt.
2. **Später:** Abgleich zwischen Geräten (`device-sync`) über einen einstellbaren Treffpunkt, damit die
   Personalverantwortung die Zeiten sieht; Übergabe an ein neues Gerät der Personalverantwortung;
   vertrauenswürdige Zeitstempel aus einem eigenen Basis-Repo.

## Entwickeln

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build      # dist/index.html, eine einzelne Datei
```

Die Datenstruktur: [`docs/data-model.html`](docs/data-model.html) (im Browser öffnen).

## License

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

This project is licensed under the **GNU Affero General Public License v3.0** (AGPLv3).
You are free to use, modify, and distribute this software under the terms of the AGPLv3.
If you use this software to provide a network service, you must make the full source code
of your modifications available to users of that service.

**Commercial License:** If you wish to use this software in a closed-source or proprietary
product, a commercial license is available. Contact: tobias.a.w.heinrich@gmail.com

See [LICENSE](LICENSE) for the full AGPLv3 text.
See [LICENSE_COMMERCIAL.md](LICENSE_COMMERCIAL.md) for commercial licensing terms.
