# TP-Wizard Weiche — CAP-Service

Leitet die Technischen Plätze (TP) einer Eisenbahnweiche **ausschließlich aus dem geprüften
Regelwerk** ab. Katrin (Feldaufnehmerin) erfasst die Weiche im Dialog, Thomas (Technischer
Verantwortlicher) prüft und gibt frei; erst die Freigabe legt die TPs in SAP an.

## Regelwerk als Single Source of Truth

Das gesamte Fachwissen liegt als Daten vor, nicht im Code:

| Entität | Inhalt | Quelle |
|---------|--------|--------|
| `Eingaben` (41) | Eingabenkatalog: Frage, Typ, Werte, `sichtbarWenn`, `formel`, `vorgabe`, `fuerTpNoetig` | Regelwerk |
| `Regeln` (99) | je Zeile ein TP-Muster: `muster`, `eltern`, `anzahl`, `giltFuer` | Regelwerk |
| `Bedingungen` (63) | mit `UND` verknüpfte Teilbedingungen je Regel | Regelwerk |
| `ForlaPlaetze` (348) | Bezeichnung (`N` = Laufnummer), Positionsnummer, Klassen, Planergruppe | Regelwerk |

Die Ableitung selbst ist eine **reine, deterministische Funktion** ([srv/lib/engine.js](srv/lib/engine.js)):
`ableiten(katalog, kopf, angaben) → { plaetze, angaben, offeneAngaben, hinweise }`.
Sie kennt keine weichenspezifischen Regeln — diese kommen alle aus den Daten.

- [srv/lib/katalog.js](srv/lib/katalog.js) — lädt den Katalog aus der DB (memoisiert).
- [srv/lib/weiche.js](srv/lib/weiche.js) — Zustand, Wertprüfung, Herkunft/Beleg, Übernahme von
  Fertigmeldungswerten mit wörtlicher Textstelle, Mapping auf `DerivedTP`.
- [srv/wizard-service.js](srv/wizard-service.js) — Service-Handler und Zwei-Rollen-Workflow.

**Stand:** Hinterlegt ist nur das Regelwerk für **EWR (einfache Weiche rechts)**. Andere
Grundbauformen sind wählbar, liefern aber keine Ableitung (Hinweis „Regelwerk fehlt"), bis ihr
Regelwerk ergänzt ist.

## Fertigmeldung und Belegpflicht

Werte, die der KI-Agent aus einer Fertigmeldung liest, werden über die Aktion
`applyDocumentValues(sessionId, values)` gesetzt. Jeder Wert braucht eine **wörtliche Textstelle**,
die exakt im Fertigmeldungstext (`WizardSession.fertigmeldung`) vorkommt, und muss die Typprüfung
bestehen — sonst wird er abgelehnt. Der Agent setzt nie TPs und erfindet keine Werte.

## Regelwerk aktualisieren

Die Seed-Daten werden nicht abgetippt, sondern aus den Regelwerk-CSVs erzeugt:

```bash
python scripts/regelwerk-uebernehmen.py <pfad-zum-regelwerk-ordner>
cds deploy                 # Stammdaten + Golden-Fixtures neu laden
npx jest test/rule-engine.test.js
```

Das Skript schreibt `db/data/tp.wizard.{Eingaben,Regeln,Bedingungen,ForlaPlaetze}.csv` und kopiert
`GoldenEingaben.csv` + `ergebnis-*.csv` nach `test/golden/`.

## Starten

```bash
npm install
npm start          # bzw. cds watch für Entwicklung
```

Der SAP-Schreibpfad ist über `FL_MOCK=true` abschaltbar (Offline-Demo/Tests).

## Tests

```bash
npx jest test/rule-engine.test.js     # Golden-Kontrakt + Operatoren/Dreiwert-Logik
npx jest test/wizard-service.test.js  # Service, Zwei-Rollen-Workflow, Zitatpflicht
```

Golden-Kontrakt: Für die geprüften Beispielweichen liefert die Ableitung **exakt** die Suffixe aus
`test/golden/ergebnis-*.csv` — **NRB_W806 = 110 TPs**, **NI_W2006 = 25 TPs** — und keine offenen Angaben.

## Offene fachliche Punkte (aus `regelwerk/README.md §5`)

Diese Punkte sind im Regelwerk noch offen und werden nicht eigenmächtig entschieden; die Golden-
Erwartung (110/25) enthält bewusst die dort dokumentierten „zu viel"-Zeilen:

1. **Radsensoren** (Regel 67, `rsa`): ein TP je Sensor oder ein TP für alle?
2. **Hz-Verschlussfachabdeckung** (Regel 56, `hz_vsfa`): je Verschlussebene oder nur ausgewählte?
3. **Übertragungsgestänge / Prüferschieber je Antrieb** (Regeln 41, 42): gilt die Kundenliste (je Antrieb)?
4. **Herzstückbauart 0–6** (`hz_bauart`, Regeln 51, 57): Bedeutung je Wert; nur 1–2 = beweglich.
5. **Lichtpunkte je Signal** (Regel 81): Zählung bei mehr als einem Signal.
6. **Heizungs-Klassen** außer elektrisch (Regeln 92–96): Klassen in der Forla fehlen noch.
7. **Prellbock / Hemmschuhauswurfvorrichtung** (Regeln 110–127): Existenz ohne Gleisstück?
8. **Handbuch-Hinweise**: 8 Einträge, bei denen der TP-Schlüssel nicht zur Überschrift passt.
