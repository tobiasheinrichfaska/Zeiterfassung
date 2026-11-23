# Fremdmaterial in der Anwendung

Die gebaute Datei `dist/index.html` und die erzeugten PDF enthalten Teile der folgenden Pakete. Die
Versionen sind in `package.json` fest eingetragen.

| Paket | Version | Lizenz | Wo | Datei hier |
|---|---|---|---|---|
| `@fontsource/noto-sans` (Noto Sans, Latin, normal und fett, als WOFF) | 5.3.0 | SIL Open Font License 1.1 | Die Schrift steckt in der HTML-Datei; in jedes PDF kommt eine Teilmenge (nur die benutzten Zeichen) | `NotoSans-OFL-1.1.txt` |
| `pdf-lib` | 1.17.1 | MIT | PDF-Erzeugung | `pdf-lib-MIT.txt` |
| `@pdf-lib/fontkit` | 1.1.1 | MIT (Angabe im Paket; Abspaltung von „fontkit“ von Devon Govett) | Lesen der Schrift, Teilmenge | (im Paket keine eigene Lizenzdatei) |
| `pako`, `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `tslib` | wie von `pdf-lib` angefordert | MIT, MIT und Zlib, MIT, 0BSD | Abhängigkeiten von `pdf-lib` | in den Paketen |
| `local-vault`, `rad-navi` | Git-Tags `v0.1.0`, `v0.1.1` | AGPLv3 + kommerziell (eigene Projekte) | Tresor, Navigation | in den Repos |

Das **sRGB-Farbprofil** im PDF (`src/logic/icc.ts`) ist keine Fremddatei: Es wird aus den veröffentlichten
sRGB-Werten (Primärfarben, D50-Weißpunkt, Übertragungskurve) im Code erzeugt.

Die OFL erlaubt das Einbetten der Schrift in Dokumente und Programme, solange Urheberhinweis und Lizenz
mitgeliefert werden (hier: diese Datei und der Text im Repository). Die Schrift wird nicht verkauft und nicht
geändert, nur zu einer Teilmenge zusammengestellt.
