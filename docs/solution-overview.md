# TP-Wizard Weiche — Lösungsübersicht

**Projekt:** DB InfraGO SAP-Hackathon  
**Datum:** 2026-10-13  
**Status:** Prototyp / Hackathon-Vorbereitung (Ziel: November 2026)

---

## 1. Das Problem

DB InfraGO muss für jede Eisenbahnweiche eine präzise Hierarchie von **Technischen Plätzen (TPs)** in SAP S/4HANA Fahrweg anlegen. Diese TPs repräsentieren physische Bauteile der Weiche (Zungenvorrichtung, Herzstück, Antriebe, Schwellen etc.) als hierarchische Struktureinheiten — die sogenannte **WE/Forla-Struktur**.

Das Kernproblem: Die korrekte Ableitung der TP-Schlüssel (z. B. `NI-----WE---2006ZUBA-VE-01`) erfordert ein tiefes Verständnis der SAP-TP-Schlüsselsystematik. Dieses Wissen lag bisher bei einer aussterbenden Generation erfahrener Mitarbeiter. Neue Kollegen kennen Eisenbahnkonstruktion, aber nicht die SAP-Logik — und machen deshalb systematisch Fehler, die erst Wochen später bei Instandhaltungsaufträgen auffallen und teuren Nachbearbeitungsaufwand erzeugen.

Die bestehende Dia App bietet keine Auswahllogik und produziert regelmäßig Fehleingaben.

**Zielwerte:**
- ≥ 90 % der TPs nach einem Wizard-Durchlauf korrekt angelegt (ohne Nacharbeit)
- Manuelle Nacharbeit auf ≤ 10–20 % reduziert

---

## 2. Die Nutzer

### Katrin — Feldaufnehmerin / Werkmeisterin Fahrbahn
Steht draußen an der Weiche. Kennt Eisenbahn sehr gut, hat kaum SAP-Erfahrung. Erfasst physische Attribute auf Papier, die dann ins Büro gehen. Will die Aufnahme direkt digital und vollständig abschließen.

### Thomas — Sachbearbeiter Fahrbahn (Büro)
Legt täglich Anlagen in SAP Fahrweg an. Hat SAP-Grundkenntnisse, kennt aber die neue WE-Struktur nicht aus dem Effeff. Sucht stundenlang in Z-Tabellen nach TP-Schlüsseln. Will ein System, das ihm die Schlüssel automatisch vorschlägt.

---

## 3. Die Lösung auf einen Blick

Der TP-Wizard ist ein **geführter Dialog-Assistent** mit KI-Chatbot-Schicht. Er stellt Katrin und Thomas Klartextfragen zur Weiche (Bauform, Anzahl Antriebe, Verschlüsse, Herzstücktyp etc.) und leitet daraus vollautomatisch die korrekte TP-Hierarchie ab — ohne dass die Nutzer einen einzigen SAP-TP-Schlüssel kennen müssen.

```
Katrin / Thomas                     TP-Wizard                         SAP S/4HANA
     │                                   │                                  │
     │  "Ich habe eine EWL,              │                                  │
     │   1 Antrieb, 1 Verschluss..."     │                                  │
     │──────────────────────────────────▶│                                  │
     │                                   │  Regelwerk                       │
     │                                   │  ↓ leitet TP-Schlüssel ab        │
     │  "Deine Weiche hat 13 TPs"        │                                  │
     │◀──────────────────────────────────│                                  │
     │                                   │                                  │
     │  "Freigeben"                      │                                  │
     │──────────────────────────────────▶│                                  │
     │                                   │  bulk create Functional Locations│
     │                                   │─────────────────────────────────▶│
     │  "✓ 13 TPs angelegt"              │                                  │
     │◀──────────────────────────────────│                                  │
```

---

## 4. Produktprinzipien

| Prinzip | Bedeutung |
|---------|-----------|
| **Sprache vor Schlüssel** | Alle Fragen und Anzeigen in Eisenbahn-Klartexten — TP-Schlüssel sind für den Nutzer niemals sichtbar |
| **Regelwerk als Single Source of Truth** | Entscheidungslogik liegt ausschließlich im CAP-Backend, nicht im UI und nicht im LLM |
| **LLM ergänzt, ersetzt nicht** | Der Chatbot ist eine Komfortschicht über dem Regelwerk — fehlerhafte LLM-Antworten dürfen das Regelwerk nicht umgehen |
| **Human-in-the-Loop** | Zwei-Rollen-Workflow: Katrin erfasst, Thomas prüft und gibt frei — kein automatischer SAP-Schreibzugriff ohne explizite Bestätigung |
| **Rücknavigation immer möglich** | Jede Antwort korrigierbar; Vorschau aktualisiert sich live |

---

## 5. Zwei-Rollen-Workflow (aktuell implementiert)

Die Lösung trennt **Erfassung** und **Freigabe** bewusst in zwei Rollen:

```
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│  KATRIN (Feldaufnehmerin)       │     │  THOMAS (Sachbearbeiter)        │
│  app-field  :5174               │     │  app-approve  :5177 (Fiori)     │
│                                 │     │                                 │
│  1. Weiche auswählen            │     │  4. Eingereichte Sessions sehen │
│     DS100, Weichennummer,       │     │     (Status: Eingereicht)       │
│     Grundbauform                │     │                                 │
│                                 │     │  5. Antworten prüfen            │
│  2. KI-Agent beantwortet        │     │     Orange = Agent-Annahme      │
│     Smart Defaults              │     │     Grün = Katrin-bestätigt     │
│     (hochkonfidente Werte       │     │                                 │
│     werden automatisch gesetzt) │     │  6. Optional: Werte korrigieren │
│                                 │     │     (Bleistift-Icon)            │
│  3. Restliche Fragen im Chat    │     │                                 │
│     beantworten + "Einreichen"  │     │  7. "Freigeben"                 │
│                                 │     │     → SAP S/4HANA Bulk-Anlage   │
└─────────────────────────────────┘     └─────────────────────────────────┘
            │ sessionId + Antworten              │ approveSession()
            └────────────────────────────────────┘
                      CAP Backend :4004
```

**Warum zwei Rollen?**  
Agentannahmen (Smart Defaults) treffen in der Regel zu, müssen aber von jemandem mit Fachverantwortung abgesegnet werden, bevor produktive SAP-Daten angelegt werden. Thomas sieht transparent, welche Werte vom Agenten angenommen wurden (orange markiert) und kann diese vor der Freigabe korrigieren.

---

## 6. Technische Architektur

```
┌─────────────────────────────────────────────────────────────────────┐
│  SAP BTP                                                            │
│                                                                     │
│  ┌──────────────────────┐    ┌───────────────────────────────────┐  │
│  │  React Frontend      │    │  CAP Backend                      │  │
│  │  app-field (Katrin)  │───▶│  wizard-service.js                │  │
│  │  app-approve (Thomas)│◀───│  ├── lib/engine.js (Regelwerk)    │  │
│  └──────────────────────┘    │  ├── lib/katalog.js · weiche.js   │  │
│                              │  ├── fl-service.js                │  │
│  ┌──────────────────────┐    │  └── wizard-service.cds           │  │
│  │  Python AI Agent     │───▶│                                   │  │
│  │  (A2A / LLM-Chatbot) │    │  SQLite (dev) / HANA (prod)       │  │
│  └──────────────────────┘    └──────────────────┬────────────────┘  │
│                                                  │                   │
│                                         Cloud Connector              │
└──────────────────────────────────────────────────┼──────────────────┘
                                                   │
                                    ┌──────────────▼──────────────┐
                                    │  SAP S/4HANA Fahrweg (A21)  │
                                    │  API_FUNCTIONALLOCATION      │
                                    └─────────────────────────────┘
```

### Komponenten

#### CAP Backend (`assets/tp-wizard-cap/`)
Das Herzstück der Lösung. Alle Geschäftslogik liegt hier:

- **`lib/engine.js`** — reine, deterministische Ableitung aus dem Regelwerk: `ableiten(katalog, kopf, angaben)`. Dreiwert-Logik, Operatoren `EQ NE IN BT GE GT LE LT HAS`, `@angabe`-Verweise, Laufnummern, Eltern-Muster, `N`→Laufnummer. Keine weichenspezifischen Regeln im Code.
- **`lib/katalog.js`** — lädt den Regelwerk-Katalog (Eingaben/Regeln/Bedingungen/ForlaPlaetze) aus der DB (memoisiert).
- **`lib/weiche.js`** — Zustand, Wertprüfung, Herkunft/Beleg, Übernahme von Fertigmeldungswerten mit wörtlicher Textstelle, nächste Frage, Vorgaben, Mapping auf `DerivedTP`.
- **`wizard-service.js`** — OData-Service-Handler für alle Wizard-Endpunkte: `createSession`, `submitAnswer`, `applyDocumentValues`, `getTPPreview`, `submitSession`, `approveSession`.
- **`fl-service.js`** — Integration mit S/4HANA Functional Location API (schreibt die TPs nach SAP).

#### Datenmodell (`assets/tp-wizard-cap/db/schema.cds`)

| Entität | Bedeutung |
|---------|-----------|
| `Eingaben` / `Regeln` / `Bedingungen` / `ForlaPlaetze` | Regelwerk-Katalog (read-only Stammdaten, aus dem geprüften Regelwerk) |
| `WizardSession` | Eine Weichen-Erfassung (von Öffnen bis SAP-Anlage), inkl. `fertigmeldung` |
| `SessionAnswer` | Einzelne Antwort mit Quelle (`agent-default`, `katrin-confirmed`, `thomas-edited`), Herkunft und Beleg |
| `DerivedTP` | Snapshot der abgeleiteten TP-Struktur (Ebene, Elternbezug, Planergruppe) |

#### React Frontend (`assets/tp-wizard-cap/app-field/`)
- Chat-Interface für Katrin: Fragen werden im Dialog gestellt, Antworten per Text oder Auswahl eingegeben
- Live-TP-Vorschau nach jeder Antwort
- Ausgerichtet auf mobile Nutzung (Feldaufnahme)

#### Fiori Elements Approve App (`assets/tp-wizard-cap/app-approve/`)
- List Report: alle eingereichten Sessions mit Status, TP-Anzahl, offenen Agentannahmen
- Object Page: vollständige Antwortliste pro Session, TP-Vorschau in Tabs, Freigabe-Button
- Orange-Chip = `AGENT-STANDARD`, Grün-Chip = `BESTÄTIGT`

#### Python AI Agent (`assets/tp-wizard-agent/`)
- A2A-konformes Python-Modul (SAP AI SDK, Gemini/GPT)
- Natürlichsprachlicher Dialog: wandelt Klartexteingaben in strukturierte Wizard-Antworten um
- Ruft ausschließlich CAP-Backend-Endpunkte auf — umgeht das Regelwerk nie direkt

---

## 7. Regelwerk und TP-Ableitung

### Datengetriebenes Regelwerk
Das gesamte Fachwissen liegt als Daten vor (siehe [CAP-README](../assets/tp-wizard-cap/README.md)):
`Eingaben` (41 Angaben), `Regeln` (99 TP-Muster), `Bedingungen` (63), `ForlaPlaetze` (348). Die
Ableitung ist eine reine Funktion `ableiten(katalog, kopf, angaben)` ohne weichenspezifische Regeln
im Code. Hinterlegt ist aktuell nur das Regelwerk für **EWR (einfache Weiche rechts)**.

### Wie die Ableitung arbeitet

1. **Angaben vervollständigen**: Vorgaben (`vorgabe`) füllen offene nicht-abgeleitete Angaben; abgeleitete Angaben (`formel`, z. B. `hz_beweglich`, `zgv_ueg`) werden zu Ja/Nein berechnet.
2. **Regeln auswerten** (sortiert nach `nr`, Wurzel zuerst): Eine Regel feuert, wenn ihre Grundbauform passt (`giltFuer`) und ihre Bedingung `true` ist. Dreiwert-Logik: eine fehlende Pflichtangabe ergibt `null` → der TP wird nicht erfunden, die Angabe erscheint als **offen**.
3. **Laufnummern** (`#`-Stellen) expandieren je `anzahl` (Literal oder Angabe-ID) unter jedem passenden Eltern-TP.
4. **Bezeichnung** kommt aus `ForlaPlaetze`; der Platzhalter `N` wird durch die Laufnummer ersetzt (z. B. „Verschlussebene N" → „Verschlussebene 3").
5. **Schlüssel**: `Betriebsstelle(7,'-') + "WE" + Weichennummer(7,'-') + Suffix`, z. B. `NRB----WE----806ZUBA-VE-03`.

### Golden-Kontrakt
Für die geprüften Beispielweichen liefert die Ableitung **exakt** die Suffixe aus
`test/golden/ergebnis-*.csv`:

| Beispiel | Herzstück | TPs |
|---|---|---|
| `NI_W2006` | starr (Bauart 0) | **25** |
| `NRB_W806` | beweglich (Bauart 2), 8 Verschlussebenen, 2 Antriebe | **110** |

Vorgaben (Standardwerte) stammen jetzt aus der Spalte `vorgabe` des Eingabenkatalogs und werden vom
Agenten als `agent-default` gesetzt; Thomas kann sie vor der Freigabe prüfen und korrigieren.

---

## 8. Aus den Unterlagen abgeleitete Erkenntnisse

Die beiden Referenzfälle sind als `GoldenEingaben.csv`/`ergebnis-*.csv` ins Regelwerk übernommen und
bilden den Golden-Kontrakt der Tests:

### NI_W2006 (EWR, starres Herzstück — 25 TPs)
- 1 Verschlussebene, 1 Antrieb; Weichensignal (`WSIG1`) + Heizung (`EEH01`) werden korrekt erzeugt.

### NRB_W806 (EWR, bewegliches Herzstück — 110 TPs)
- 8 Verschlussebenen an der Zgv, 2 Antriebe, bewegliches Herzstück mit eigenen Verschlussebenen.
- Wichtigster Stresstest: belegt die korrekte `n`-fache Laufnummern-Expansion.

**Offene fachliche Punkte** (aus `regelwerk/README.md §5`, nicht eigenmächtig entschieden): Radsensoren
je Sensor vs. gesammelt, Hz-Verschlussfachabdeckung je Ebene, Übertragungsgestänge/Prüferschieber je
Antrieb, Bedeutung der Herzstückbauart 0–6, Lichtpunkte je Signal, fehlende Heizungs-Klassen,
Prellbock/Hemmschuh am Gleisstück, Handbuch-Hinweise. Die Golden-Erwartung (110/25) enthält bewusst die
dort dokumentierten „zu viel"-Zeilen und wird nicht „korrigiert".

---

## 9. Session-Lebenszyklus

```
createSession()       submitAnswer()×n      submitSession()
      │                     │                    │
      ▼                     ▼                    ▼
  [open] ──────────── [open + Antworten] ──▶ [submitted]
                                                  │
                                         Thomas öffnet App
                                                  │
                                        editAnswer() (optional)
                                                  │
                                                  ▼
                                            [editing]
                                                  │
                                        approveSession()
                                                  │
                                                  ▼
                                            [approved]
                                                  │
                                    SAP Functional Location API
                                                  │
                                         [created] oder [failed]
```

Der Status `source` jeder Antwort (`agent-default` → `katrin-confirmed` → `thomas-edited`) bildet einen vollständigen Audit-Trail: jeder angelegte TP ist rückverfolgbar auf den Fragepfad, der ihn erzeugt hat.

---

## 10. Aktuelle Meilensteine

| Meilenstein | Status |
|---|---|
| M1: Regelwerk betriebsbereit (19 Bereiche, 80+ Fragen) | In Arbeit |
| M2: Einfache Weiche NI_W2006 validiert (~28 TPs korrekt) | Teilweise — Testszenarien vorhanden |
| M3: Komplexe Weiche NRB_W806 validiert (~80 TPs) | Offen |
| M4: SAP-Schreibzugriff A21 bestätigt | Getestet (FL_MOCK=true), Cloud Connector ausstehend |
| M5 (Stretch): LLM-Chatbot äquivalent zu Wizard | Grundstruktur implementiert |

**Zwei-Rollen-Workflow (M4/M5-Erweiterung):** vollständig implementiert und getestet am 2026-10-13.

---

## 11. Lokale Entwicklungsumgebung

Vier Server müssen parallel laufen:

```bash
# 1. CAP Backend (Regelwerk + OData API)
cd assets/tp-wizard-cap && FL_MOCK=true npm run dev          # http://localhost:4004

# 2. React Chat-App (Katrin)
cd assets/tp-wizard-cap/app-field && npm run dev             # http://localhost:5174

# 3. Fiori Approve-App (Thomas)
cd assets/tp-wizard-cap/app-approve && npm run dev           # http://localhost:5177

# 4. Python AI Agent (LLM-Chatbot, optional)
cd assets/tp-wizard-agent && source .env && python3 app/main.py --port 5001
```

`FL_MOCK=true` deaktiviert den echten SAP-Schreibzugriff und nutzt einen Dummy — für lokale Entwicklung ohne Cloud Connector.

---

## 12. Glossar

| Begriff | Erklärung |
|---------|-----------|
| **TP (Technischer Platz)** | SAP Functional Location — hierarchische Struktureinheit für eine technische Anlage |
| **Forla** | Vorlage (Maximalausprägung) aller möglichen TPs einer Weiche; unabhängig von der Grundbauform |
| **WE-Struktur** | Neue Weichen-Struktur (Ersatz der WK-Struktur); bildet Weichen physisch ab |
| **Positionsnummernlogik** | TP-Blöcke sind über Nummernbereiche gegliedert; Grundbauform filtert relevante Bereiche |
| **Rückbaustatus** | 0 = neue Weiche; 1+ = Rückbau. Steuert, welche TPs angelegt werden |
| **DS100** | Standardisiertes Betriebsstellenkürzel im DB-Konzern (z. B. `NI` = Iphofen) |
| **Zgv** | Zungenvorrichtung — bewegt die Zungen beim Umstellen der Weiche |
| **Hz** | Herzstück — Kreuzungsbereich zweier Gleise |
| **Smart Default** | Hochkonfidenter Standardwert aus Erfahrungswissen, automatisch vom Agenten gesetzt |
| **Agent-Annahme** | Smart Default-Wert, den Thomas vor der SAP-Anlage prüfen und ggf. korrigieren soll |
| **A21** | SAP-Systemlandschaft DB InfraGO; A21-Kopie = Sandbox für den Hackathon |
| **CAP** | SAP Cloud Application Programming Model — Framework für BTP-Backend-Services |
| **A2A** | Agent-to-Agent Protocol — Standard für Python AI Agents auf SAP BTP |
| **EWL/EWR** | Einfache Weiche links / rechts |
| **DKW** | Doppelte Kreuzungsweiche |
| **EKW** | Einfache Kreuzungsweiche |
