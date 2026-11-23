# 02 Stechuhr und Eingabeformular

Alle Daten sind erfunden. Ein Browser-Test dieser Fälle ist bisher nicht gelaufen; sie sind für Menschen
am Bildschirm gedacht.

## MT-02: Stempeln, ein ganzer Tag

**Voraussetzung:** Die App ist offen, noch nichts gestempelt (Bereich „Erfassen“, Seite „Stempeln“).

**Schritte**

1. Unter „Stempeln“ den Knopf „Kommen“ drücken.
2. Den Knopf „Pause Beginn“ drücken.
3. Den Knopf „Pause Ende“ drücken.
4. Den Knopf „Gehen“ drücken.

**Erwartet**

- Nach Schritt 1 steht dort „Seit HH:MM bei der Arbeit.“ und nur „Pause Beginn“ und „Gehen“ sind bedienbar.
- Nach Schritt 2 steht dort „… Pause seit …“; nur „Pause Ende“ und „Gehen“ sind bedienbar.
- Nach Schritt 4 steht „Heute ist der Arbeitstag beendet.“ Der Knopf „Kommen“ ist wieder bedienbar:
  siehe MT-14 (pro Datum gibt es nur einen Tag, „Kommen“ öffnet ihn nach einer Rückfrage wieder).
- Die Uhrzeiten stammen von der Uhr des Geräts.

## MT-03: Gehen mit laufender Pause

**Schritte**

1. „Kommen“, dann „Pause Beginn“ drücken.
2. „Gehen“ drücken, ohne die Pause zu beenden.
3. Im Bereich „Monat“ den heutigen Tag ansehen.

**Erwartet**

- „Gehen“ ist bei laufender Pause bedienbar und beendet die Pause im selben Moment (die Pause steht in der Spalte „Pause“).

## MT-04: Tag eintragen (Formular)

**Schritte**

1. Bereich „Erfassen“, Seite „Tag eingeben“.
2. „Datum“ auf gestern setzen, „Kommen“ 08:00, „Gehen“ 16:30.
3. „Pause hinzufügen“, Art „Dauer“, „Minuten“ 30.
4. „Speichern“ drücken.

**Erwartet**

- Darunter „Gespeichert: <Datum>“, das Formular ist leer.
- Im Bereich „Monat“ steht der Tag mit Pause 0:30 und Arbeitszeit 8:00.
- Trägt man dasselbe Datum noch einmal ein, kommt eine Rückfrage „… Ersetzen?“.

## MT-05: Ungültige Eingabe wird erklärt

**Schritte**

1. „Tag eingeben“, „Kommen“ 16:00, „Gehen“ 08:00, „Speichern“.

**Erwartet**

- Ein roter Kasten oben: „Gehen muss nach Kommen liegen.“ mit dem Knopf „Gelesen“. Er bleibt, bis man ihn schließt.

## MT-06: Schicht über Mitternacht

**Schritte**

1. „Tag eingeben“: „Kommen“ 22:00, „Gehen“ 06:00, Haken bei „Gehen am Folgetag“, „Speichern“.
2. Im Bereich „Monat“ nachsehen.

**Erwartet**

- Die Zeile zeigt „Gehen 06:00 (+1)“ und Arbeitszeit 8:00.

## MT-07: Vergessenes „Gehen“ nachtragen

**Voraussetzung:** Ein Tag läuft (nur „Kommen“ gestempelt).

**Schritte**

1. „Tag eingeben“ öffnen.

**Erwartet**

- Oben steht „Der Tag vom … läuft noch. Hier lässt er sich beenden oder korrigieren.“ und das Formular zeigt die Zeiten dieses Tages (Feld „Gehen“ leer). Mit einer Uhrzeit bei „Gehen“ und „Speichern“ ist der Tag beendet.

## MT-14: Nach „Gehen“ wieder „Kommen“

**Voraussetzung:** Heute wurde gestempelt und „Gehen“ gedrückt (MT-02), einige Minuten sind vergangen.

**Schritte**

1. Unter „Stempeln“ den Knopf „Kommen“ drücken.
2. Die Rückfrage mit „Abbrechen“ beantworten.
3. „Kommen“ noch einmal drücken und mit „OK“ bestätigen.
4. Später „Gehen“ drücken, dann im Bereich „Monat“ den heutigen Tag öffnen („Bearbeiten“).

**Erwartet**

- Die Rückfrage lautet „Heute wurde schon um HH:MM gegangen. Wirklich wieder kommen? Die Zeit dazwischen zählt als Pause.“
- Nach „Abbrechen“ ändert sich nichts.
- Nach „OK“ steht dort wieder „Seit … bei der Arbeit.“ (der erste Beginn bleibt).
- Im Formular steht die Lücke zwischen dem ersten „Gehen“ und dem zweiten „Kommen“ als Pause mit „von“ und „bis“; die Arbeitszeit enthält sie nicht.
- Das ist derselbe Tag und keine nachträgliche Änderung.
