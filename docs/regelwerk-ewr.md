# Regelwerk-EWR — TP-Ableitung im TP-Wizard Weiche

Technische Dokumentation der datengetriebenen TP-Ableitung. Zielgruppe: Entwickler, die den
CAP-Service und das Regelwerk pflegen. Ergänzt die [CAP-README](../assets/tp-wizard-cap/README.md)
(Betrieb) und die [Lösungsübersicht](solution-overview.md) (Fachkontext).

## 1. Zweck

Die Technischen Plätze (TP) einer Eisenbahnweiche werden **ausschließlich aus dem geprüften
Regelwerk** abgeleitet — nicht aus Code und nicht aus dem LLM. Hinterlegt ist aktuell das Regelwerk
für die **einfache Weiche rechts (EWR)**. Die Ableitung ist deterministisch und wird gegen zwei
geprüfte Beispielweichen getestet: `NI_W2006` → **25 TPs**, `NRB_W806` → **110 TPs**.

## 2. Architektur

```
Katrin (app-field)          Thomas (app-approve, Fiori Elements)
      │ createSession/submitAnswer/applyDocumentValues     │ approve
      ▼                                                     ▼
            WizardService  (srv/wizard-service.js)
                     │
      ┌──────────────┼───────────────────────────┐
      ▼              ▼                            ▼
 lib/katalog.js   lib/weiche.js             lib/engine.js
 (DB → Katalog)   (Zustand, Herkunft,       (reine Ableitung:
  memoisiert       Zitatprüfung, Mapping)    ableiten(katalog,kopf,angaben))
      │
      ▼
 Eingaben · Regeln · Bedingungen · ForlaPlaetze   (read-only Stammdaten)
```

- **[srv/lib/engine.js](../assets/tp-wizard-cap/srv/lib/engine.js)** — reine Funktion, keine DB/Netz/Zeit/Zufall. Entry: `ableiten(katalog, kopf, angaben) → { plaetze, angaben, offeneAngaben, hinweise }`.
- **[srv/lib/katalog.js](../assets/tp-wizard-cap/srv/lib/katalog.js)** — lädt den Katalog aus der DB (`cds.entities('tp.wizard')`), memoisiert pro Prozess.
- **[srv/lib/weiche.js](../assets/tp-wizard-cap/srv/lib/weiche.js)** — CAP-Glue: Session → Angaben-Map/Kopf, Mapping `Platz` → `DerivedTP`, Wertprüfung, Herkunft/Beleg, `uebernehmeDokumentwerte` (Zitatprüfung), nächste Frage, Vorgaben.
- **[srv/wizard-service.js](../assets/tp-wizard-cap/srv/wizard-service.js)** — Service-Handler, Zwei-Rollen-Workflow, SAP-Schreibpfad.

## 3. Datenmodell

Katalog (read-only Stammdaten, [db/schema.cds](../assets/tp-wizard-cap/db/schema.cds), 1:1 zu den Regelwerk-CSVs):

| Entität | Schlüssel | Kernfelder |
|---|---|---|
| `Eingaben` | `ID` | `pos`, `bereich`, `frage`, `typ`, `werte`, `sichtbarWenn`, `formel`, `vorgabe`, `fuerTpNoetig` |
| `Regeln` | `nr` | `muster`, `eltern`, `anzahl`, `start`, `giltFuer`; Composition `bedingungen` |
| `Bedingungen` | `regel` + `pos` | `angabe`, `operator`, `wert` (FK-Spalten `regel_nr`, `angabe_ID`) |
| `ForlaPlaetze` | `muster` | `positionsnummer`, `bezeichnung` (`N`-Platzhalter), `klassen`, `planergruppe` |

Transaktional: `WizardSession` (+`fertigmeldung`), `SessionAnswer` (+`herkunft`, `beleg`), `DerivedTP`
(Snapshot mit `level`, `parentTpKey`, `planergruppe`, `regel`, `muster`).

## 4. Ableitungsalgorithmus

1. **Angaben vervollständigen** (`vervollstaendige`): Rohwerte übernehmen → `vorgabe` für offene,
   nicht abgeleitete Angaben → `formel`-Angaben (`hz_beweglich`, `hydraulisch`, `zgv_ueg`, `hz_ueg`)
   zu `Ja`/`Nein` berechnen (Einzelpass in Katalogreihenfolge).
2. **Bedingungen** (`erfuellt`, dreiwertig `true|false|null`): Grammatik `angabe OP wert [ UND … ]`,
   Operatoren `EQ NE IN BT GE GT LE LT HAS`, `@id` = Verweis auf eine andere Angabe. `null` =
   unbestimmt, weil eine Angabe fehlt; **`false` schlägt fehlend** (ein bekannt-falscher Teil macht
   die Bedingung falsch).
3. **Regeln** (sortiert nach `nr`, Wurzel `nr=1` seedet den Platz `''`): Regel feuert, wenn
   `giltFuer` die Grundbauform enthält und `erfuellt` = `true`. Eltern-TPs über Regex aus `eltern`
   (`#`→`\d`); `muster` muss mit `eltern` beginnen.
4. **Laufnummern**: `#`-Gruppen im `rest = muster[len(eltern):]` werden je `i` in `0..anzahl-1`
   durch `start+i` ersetzt (Breite = Anzahl `#`). `anzahl` ist eine Literalzahl oder eine Angabe-ID
   (Menge); ist diese offen → Hinweis, kein TP.
5. **Forla/Bezeichnung**: Lookup über Erstinstanz-Muster (`Ziffern→#→1`); der Platzhalter `\bN\b`
   wird durch die Laufnummer des Platzes ersetzt.
6. **Schlüssel**: `betriebsstelle.padEnd(7,'-') + 'WE' + weichennummer.padStart(7,'-') + suffix`
   (z. B. `NRB----WE----806ZUBA-VE-03`).
7. **Baumreihenfolge & Ebene**: Tiefensuche, Eltern vor Kindern, Geschwister nach
   `positionsnummer` dann `suffix`.
8. **Offene Angaben**: nicht abgeleitet, `fuerTpNoetig`, kein `Einbauorte`, sichtbar (`sichtbarWenn`
   nicht `false`), noch leer → werden abgefragt statt TPs zu erfinden.

## 5. Herkunft, Beleg und Fertigmeldung

Jede `SessionAnswer` trägt eine Herkunft (`Dokument|Bestand|Vorgabe|Stammdaten|Regel|Manuell`) und
einen Beleg. Werte aus einer Fertigmeldung setzt der Agent über `applyDocumentValues`; jeder Wert
braucht eine Textstelle, die (quote-/whitespace-normalisiert) **wörtlich** im Fertigmeldungstext
vorkommt, und muss die Typprüfung bestehen — sonst wird er abgelehnt. Der Agent setzt nie TPs und
erfindet keine Werte oder Textstellen.

## 6. Regelwerk aktualisieren

```bash
cd assets/tp-wizard-cap
python scripts/regelwerk-uebernehmen.py <regelwerk-ordner>   # erzeugt db/data/*.csv + test/golden/*
cds deploy                                                   # Stammdaten + Fixtures laden
npx jest test/rule-engine.test.js                            # Golden-Kontrakt prüfen
```

Das Skript schreibt `tp.wizard.{Eingaben,Regeln,Bedingungen,ForlaPlaetze}.csv` (Eingaben: Spalte `ID`
+ generierte `pos`, `fuerTpNoetig`→`true/false`; Bedingungen-Header → `regel_nr;pos;angabe_ID;operator;wert`)
und kopiert `GoldenEingaben.csv` + `ergebnis-*.csv` nach `test/golden/`. Daten werden nie abgetippt.

## 7. Migration (ersetzt / entfernt)

| Vorher (synthetisch/imperativ) | Nachher (datengetrieben) |
|---|---|
| `rule-engine-service.js` (hartcodierte Bereiche) | `lib/engine.js` (reine Funktion) |
| `lib/smart-defaults.js` (DEFAULTS je Form) | `Eingaben.vorgabe` → `weiche.vorgaben()` |
| `lib/wizard-questions.js` (WIZARD_QUESTIONS) | `Eingaben` + `weiche.naechsteFrage()` |
| `lib/{tp-key-transformer,pos-filter,hz-,iso-,antrieb-}.js` | `engine.js` (Schlüssel, Laufnummern, Bedingungen) |
| `ForlaTemplate`, `BasicFormMapping` | `Eingaben/Regeln/Bedingungen/ForlaPlaetze` |

## 8. EWR-only + Gerüst

Alle 99 Regeln gelten `giltFuer = EWR`. Andere Grundbauformen bleiben in UI/Modell wählbar, liefern
aber keine TPs; `ableitenTps` gibt dann einen Hinweis „Regelwerk fehlt" zurück. Weitere Regelwerke
werden ergänzt, indem Regeln mit anderem `giltFuer` ins Regelwerk aufgenommen werden — ohne Code-Änderung.

## 9. Offene fachliche Punkte (aus `regelwerk/README.md §5`)

Nicht eigenmächtig entschieden; die Golden-Erwartung (110/25) enthält bewusst die dort dokumentierten
„zu viel"-Zeilen (NRB: `ZUBA-WA-02UEG-`, `ZUBA-WA-02PRSS`, `HZ-ABVE--3VSFA`, `HZ-ABRSA-2`; NI: `HZ-ABHZ---`):

1. Radsensoren (Regel 67, `rsa`): ein TP je Sensor oder ein TP für alle?
2. Hz-Verschlussfachabdeckung (Regel 56, `hz_vsfa`): je Verschlussebene oder nur ausgewählte?
3. Übertragungsgestänge / Prüferschieber je Antrieb (Regeln 41, 42): gilt die Kundenliste?
4. Herzstückbauart 0–6 (`hz_bauart`, Regeln 51, 57): Bedeutung je Wert; nur 1–2 = beweglich.
5. Lichtpunkte je Signal (Regel 81): Zählung bei mehr als einem Signal.
6. Heizungs-Klassen außer elektrisch (Regeln 92–96): Klassen in der Forla fehlen noch.
7. Prellbock / Hemmschuhauswurfvorrichtung (Regeln 110–127): Existenz ohne Gleisstück?
8. Handbuch-Hinweise: 8 Einträge, bei denen der TP-Schlüssel nicht zur Überschrift passt.

## 10. Tests

- [test/rule-engine.test.js](../assets/tp-wizard-cap/test/rule-engine.test.js) — Golden-Kontrakt (exakte Suffixe, keine offenen Angaben) + Operatoren/Dreiwert-Logik/Laufnummern/`N`-Ersetzung.
- [test/wizard-service.test.js](../assets/tp-wizard-cap/test/wizard-service.test.js) — Service, Zwei-Rollen-Workflow, `applyDocumentValues`-Zitatpflicht, Fehlerfälle.
- Agent (pytest): `tests/test_document_citation.py` prüft Skill-/MCP-Verdrahtung der Belegpflicht.
