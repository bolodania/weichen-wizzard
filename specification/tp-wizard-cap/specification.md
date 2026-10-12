# Specification: tp-wizard-cap

> **Guidelines**: Read [../guidelines.md](../guidelines.md) before executing ANY tasks below.

This is the CAP (Cloud Application Programming Model) backend + React/UI5 frontend for the TP-Wizard Weiche.
It implements the rule engine, TP preview logic, and S/4HANA Functional Location write-back, plus the 3-panel wizard UI.

---

## Data Dependencies

- API ORD ID: `sap.s4:apiResource:API_FUNCTIONALLOCATION:v1` — Functional Location create/read (OData)
- API ORD ID: `sap.s4:apiResource:FUNCNLLOCSTRUCLIST_0001:v1` — Functional Location hierarchy read (OData)
- API spec files:
  - `specification/tp-wizard-cap/api-specs/API_FUNCTIONALLOCATION.edmx`
  - `specification/tp-wizard-cap/api-specs/FUNCNLLOCSTRUCLIST_0001.edmx`

---

## Basic Setup

- [ ] Invoke the `setup-solution` skill to create `solution.yaml` and `asset.yaml` for all assets in this solution.
  - Asset name: `tp-wizard-cap` (type: CAP Application)
  - Asset name: `tp-wizard-agent` (type: AI Agent — stretch goal)
  - Ensure `solution.yaml` references both assets.
- [ ] Create asset directory: `mkdir -p assets/tp-wizard-cap/`
- [ ] Scaffold a CAP Node.js project inside `assets/tp-wizard-cap/`:
  - `package.json` with dependencies: `@sap/cds`, `@sap-cloud-sdk/http-client`, `express`
  - `cds` service definitions in `srv/`
  - `db/` for schema (no persistent DB needed for Hackathon — in-memory SQLite)
  - `app/` for the React/UI5 frontend
- [ ] Verify CDS compiles: `cds compile srv/ --to json` — must succeed without errors

---

## Rule Engine (CAP Backend)

### Forla Data Model

- [ ] Define CDS entity `ForlaTemplate` in `db/schema.cds`:
  - Fields: `posNr` (String), `tpKey` (String), `tpLabel` (String), `basicForm` (String), `area` (String — one of 19 Bereiche), `isAutomatic` (Boolean), `rückbauStatus` (Integer)
  - Seed data from the 19 question areas in `Kopie von Fragen.xlsx` represented as JSON fixture in `db/data/ForlaTemplate.json`
- [ ] Define CDS entity `BasicFormMapping` — maps Grundbauform → relevant Positionsnummernbereiche (from Excel Filtertabellen):
  - Fields: `basicForm` (String key), `posNrFrom` (Integer), `posNrTo` (Integer)
- [ ] Define CDS entity `WizardQuestion` — the 80+ questions with branching logic:
  - Fields: `id`, `area` (1–19), `text` (German plain language), `answerType` (enum: `choice`, `number`, `boolean`, `multiselect`), `options` (array JSON), `parentQuestionId`, `parentAnswer`, `isAutomatic` (Boolean), `generatedTPKeys` (array of VORLA keys)
- [ ] Extend CDS entity `WizardSession` with two-role fields:
  - `submittedAt`: DateTime — set when Katrin/Agent calls `submitSession`
  - `approvedAt`: DateTime — set when Thomas calls `approveSession`
  - `status` extended values: `open | submitted | editing | approved | created | failed`
  - `answersJson` entries carry per-answer `source` field: `auto | agent-default | katrin-confirmed | katrin-corrected`

### Rule Engine Service

- [ ] Create `srv/rule-engine-service.cds` and `srv/rule-engine-service.js`:
  - Action `deriveTPStructure(input: WizardSessionInput): TPDeriveResult`
    - Input: `{ basicForm, ds100, switchNumber, answers: [{questionId, answer, source}] }`
    - Output: `{ tps: [{tpKey, tpLabel, area, posNr, isAutomatic, derivedFrom}], openFields: [{tpKey, fieldName}] }`
  - Function `getNextQuestion(sessionState: SessionState): NextQuestionResult`
    - Returns the next unanswered required question based on branching logic
    - Skips questions whose `parentAnswer` condition is not met
    - Returns `null` when all required questions answered
  - Function `getSmartDefaults(basicForm: String): SmartDefaultsResult`
    - Returns pre-filled answers per Grundbauform based on Standardkonfigurationen from `Kopie von Fragen.xlsx`
    - Each default carries `confidence: "high"|"medium"|"low"` and a `rationale` string
    - Low-confidence defaults are flagged as `openHints` for Thomas
  - Function `validateTPStructure(tps: [TP]): ValidationResult`
    - Validates each generated TP key against ForlaTemplate
    - Returns `{ valid: Boolean, invalidTPs: [tpKey], warnings: [String] }`
  - Function `getOpenHints(answers: [{questionId, answer, source}], basicForm: String): OpenHint[]`
    - Returns entries where `source === "agent-default"` or `source === "auto"` with a human-readable `hint` explaining why Thomas should review this item

### VORLA → Concrete TP Key Transformation

- [ ] Implement `transformVorlaKey(vorlaKey, ds100, switchNumber)` in `srv/lib/tp-key-transformer.js`:
  - Replace VORLA prefix (e.g. `VORLA--WE------`) with `{DS100}--WE----{switchNumber}` (zero-padded to correct width)
  - Validate output key length matches SAP Functional Location format
  - Unit test: transform `VORLA--WE------1ZUBA-VE-01` with DS100=`NI` and switchNumber=`2006` → expected result

### Positionsnummernlogik

- [ ] Implement `filterByBasicForm(basicForm, forlaTemplates)` in `srv/lib/pos-filter.js`:
  - Look up Positionsnummernbereiche for the given `basicForm` from `BasicFormMapping`
  - Return only ForlaTemplate entries whose `posNr` falls within relevant ranges
  - Test with `NI_W2006` (einfache Weiche) — expected ~30 TPs
  - Test with `NRB_W806` (komplexe Weiche) — expected ~80 TPs

### Rückbaustatus Logic

- [ ] Implement Rückbaustatus filtering in rule engine — for Hackathon: always `rückbauStatus = 0` (new switch only):
  - Filter out any ForlaTemplate entries that require `rückbauStatus > 0`
  - Log: `[M1.achieved]: Regelwerk Rückbaustatus-Filter aktiv — Rückbaustatus=0 (nur neue Weichen)`

### Automatic TP Generation

- [ ] Implement automatic TP generation without user questions:
  - STR-A / STR-B (Stränge) — always generated
  - SW (Schwellen) — always generated
  - ZSBA entries — derived automatically from Grundbauform
  - Mark all automatic TPs with `isAutomatic: true` in result

### Hz-beweglich Branch Logic

- [ ] Implement Hz-beweglich decision in `srv/lib/hz-logic.js`:
  - Input: `{ federwippe: Boolean, herzstückbauart: Integer }`
  - If `federwippe === true` AND `herzstückbauart >= 1` → Hz is beweglich → generate Hz-Verschlüsse, Hz-Antriebe, Rollvorrichtungen, Hz-Bereich TPs
  - If `herzstückbauart === 0` → Hz is starr → skip Hz-beweglich TPs
  - Unit test with NRB_W806 input (Hz beweglich, Bauart 2) and NI_W2006 input (Hz starr, Bauart 0)

### Isolierstöße Logic

- [ ] Implement `deriveIsolaerstöße(stw_bauform, selectedPositions)` in `srv/lib/iso-logic.js`:
  - 14 possible positions (ZGV-L/R, Zwischenschiene L/R Bs-Rl/Zg-Hz, Radlenker L/R, Strang A/B Schiene L/R)
  - `stw_bauform` filters which positions are relevant (e.g. SELSL60N vs. SETEDBRU have different relevant sets)
  - User selects from filtered positions → generates corresponding ISO TP keys

### Antrieb / Übertragungsgestänge Logic

- [ ] Implement `deriveAntriebe(anzahlZgv, anzahlHz, hydraulisch)` in `srv/lib/antrieb-logic.js`:
  - Generate WA TP keys for each Antrieb at Zgv and Hz
  - If 1 Antrieb for multiple Ebenen → add Übertragungsgestänge TP
  - If hydraulisch → add Zylinder TPs
  - Test with NRB_W806: 2 Zgv-Antriebe + Übertragungsgestänge + 1 Hz-Antrieb + Übertragungsgestänge

### Milestone Instrumentation

- [ ] Add structured logging in rule engine service for all 5 milestones:
  - `[M1.achieved]: Regelwerk vollständig digitalisiert — alle 19 Bereiche ausfuehrbar`
  - `[M1.missed]: Regelwerk-Digitalisierung unvollstaendig — fehlende Bereiche oder Luecken`
  - `[M2.achieved]: Einfache Weiche NI_W2006 validiert — TP-Menge korrekt`
  - `[M2.missed]: NI_W2006-Validierung fehlgeschlagen — Abweichungen in TP-Menge`
  - `[M3.achieved]: Komplexe Weiche NRB_W806 validiert — TP-Menge im Zielkorridor`
  - `[M3.missed]: NRB_W806-Validierung fehlgeschlagen — Abweichung ueber Toleranz`
  - `[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs im System angelegt`
  - `[M4.missed]: SAP-Schreibzugriff fehlgeschlagen — Cloud Connector oder API-Fehler`

---

## SAP S/4HANA Integration (CAP Backend)

> API spec files are in `specification/tp-wizard-cap/api-specs/`.
> CAP backend calls S/4HANA **directly** via OData (no MCP server for CAP services — MCP is for the AI Agent only).
> Use `@sap-cloud-sdk/http-client` or CAP's built-in `cds.connect.to('S4H')` remote service pattern.

- [ ] Configure CAP remote service destination in `package.json` `.cds.requires`:
  ```json
  "S4H_FL": {
    "kind": "odata-v2",
    "model": "srv/external/API_FUNCTIONALLOCATION",
    "credentials": { "destination": "S4H_FL" }
  }
  ```
- [ ] Import EDMX into CAP project:
  - `cds import specification/tp-wizard-cap/api-specs/API_FUNCTIONALLOCATION.edmx --keep-namespace`
  - `cds import specification/tp-wizard-cap/api-specs/FUNCNLLOCSTRUCLIST_0001.edmx --keep-namespace`
  - Verify generated CDS files appear in `srv/external/`
- [ ] Implement `srv/fl-service.js` — Functional Location service:
  - `readForlaHierarchy(ds100)` — calls `FUNCNLLOCSTRUCLIST_0001` to read existing WE structure from A21
  - `bulkCreateFunctionalLocations(tps: [TPCreateInput])` — calls `API_FUNCTIONALLOCATION` batch create
    - Maps wizard TP objects → `FunctionalLocation` OData entities
    - Returns `{ created: [tpKey], failed: [{tpKey, error}] }`
  - Error handling: on API failure → return error details for UI display; log `[M4.missed]: ...`
- [ ] Implement mock FL service in `srv/fl-service-mock.js` for offline/Hackathon use when Cloud Connector is unavailable:
  - Simulates successful bulk create for all provided TPs
  - Returns same shape as real service
  - Activated via env var `FL_MOCK=true`

---

## CAP API Endpoints

- [ ] Expose REST endpoints from `srv/wizard-service.cds` and `srv/wizard-service.js`:
  - `POST /wizard/createSession` — create new wizard session `{ ds100, switchNumber, basicForm }` → `{ sessionId }`
  - `GET /wizard/getSmartDefaults(basicForm=...)` — returns pre-filled defaults for the given Grundbauform with confidence levels; called by the agent before dialogue starts
  - `POST /wizard/submitAnswer` — submit answer `{ sessionId, questionId, answer, source }` — `source` is one of `auto|agent-default|katrin-confirmed|katrin-corrected`; returns updated TP preview
  - `GET /wizard/getNextQuestion(sessionId=...)` — returns next unanswered question or null when complete
  - `GET /wizard/getTPPreview(sessionId=...)` — full TP preview for current answers
  - `POST /wizard/submitSession` — Katrin/Agent finishes; transitions `open → submitted`; returns `{ sessionId, message }`
  - `GET /wizard/listPendingSessions()` — Thomas' list view; returns sessions in `submitted` or `editing` state with `openHintCount`
  - `GET /wizard/getOpenHints(sessionId=...)` — returns flagged answers (source=`agent-default` or `auto`) with hint text for Thomas
  - `POST /wizard/editAnswer` — Thomas changes an answer `{ sessionId, questionId, answer }`; transitions `submitted → editing` on first edit
  - `POST /wizard/approveSession` — Thomas approves; transitions `editing|submitted → approved`; triggers SAP bulk create
  - `GET /wizard/getOpenFields(sessionId=...)` — open mandatory fields after SAP creation
  - `GET /wizard/exportSessionCSV(sessionId=...)` — CSV of all derived TPs
- [ ] Validate all endpoints return < 500 ms for rule engine operations (performance requirement from PRD)
- [ ] Add CORS headers for local frontend development

---

## React / SAP UI5 Frontend

Two separate Vite/React apps share the same CAP backend. Both use `@ui5/webcomponents-react`.

### app-field — Katrins mobile Chat-UI (`assets/tp-wizard-cap/app-field/`)

- [ ] Scaffold Vite + React app in `assets/tp-wizard-cap/app-field/`
  - Dependencies: `@ui5/webcomponents-react`, `@ui5/webcomponents`, `axios`
  - Proxy: all `/wizard/*` requests → CAP backend (localhost:4004 in dev)
- [ ] Entry screen: DS100 text input, Weichennummer text input, Grundbauform select → "Starten"
- [ ] Chat layout: full-height message thread (bottom-up scroll), fixed bottom bar (text input + microphone button + send)
  - Agent messages: left-aligned, neutral colour
  - Katrin messages: right-aligned, SAP blue
- [ ] Microphone button activates Web Speech API (`lang: de-DE`); transcribed text drops into input field (no auto-send)
- [ ] Collapsible TP-Preview panel (bottom sheet on mobile, side drawer on tablet): TPs grouped by Bereich, colour-coded by answer source
- [ ] Submit screen: agent presents summary → Katrin confirms → call `submitSession` → success screen with reference number
- [ ] Ensure all inputs are touch-friendly (minimum 44px tap target); test on 375 px viewport

### app-approve — Thomas' Desktop Freigabe-UI (`assets/tp-wizard-cap/app-approve/`)

- [ ] Scaffold Vite + React app in `assets/tp-wizard-cap/app-approve/`
  - Dependencies: `@ui5/webcomponents-react`, `@ui5/webcomponents`, `axios`
  - Proxy: all `/wizard/*` requests → CAP backend (localhost:4004 in dev)
- [ ] **List Report** (`/approve`): Fiori List Report pattern
  - Table columns: Betriebsstelle, Weiche, Grundbauform, Eingereicht (submittedAt), TPs (derivedTPCount), Hinweise (openHintCount badge — red if > 0), Status
  - Filter bar: Status, Betriebsstelle, Grundbauform, Eingereicht (date range)
  - Clicking a row navigates to Object Page
- [ ] **Object Page** (`/approve/:sessionId`): Fiori Object Page pattern
  - Header: `{DS100} W{switchNumber} — {basicFormLabel}` with status badge
  - Warning strip (shown when `openHintCount > 0`): "⚠ N Agentannahmen nicht geprüft — [questionLabels]. Bitte prüfen bevor du freigibst." Dismisses per item once Thomas has reviewed it.
  - Section "Antworten": 19 Bereiche as sub-sections; each question row shows label, answer, source chip (`AUTO`/`AGENT-STANDARD`/`BESTÄTIGT`/`KORRIGIERT`), edit icon; `agent-default` rows have amber left border
  - Section "TP-Vorschau": read-only TP table (posNr, tpKey, tpLabel, area) grouped by Bereich
  - Footer: `Freigeben` button (Emphasized, disabled until all red hints reviewed) + `CSV Export`
  - Freigeben confirmation dialog: shows TP count, count of unreviewed agent assumptions, irreversibility note
  - On confirm → call `approveSession` → result screen (created/failed counts)

---

## Validation Tests

- [ ] Write unit test `test/rule-engine.test.js`:
  - Test `filterByBasicForm('EWR', forlaTemplates)` returns correct TP count range
  - Test `deriveTPStructure` for NI_W2006 inputs → TP list matches expected ~30 TPs (0 deviation on mandatory TPs)
  - Test `deriveTPStructure` for NRB_W806 inputs → TP list matches expected ~80 TPs (≤ 5% deviation on optional)
  - Test Hz-beweglich branch: Federwippe=true + Bauart=2 → Hz TPs present
  - Test Hz-starr branch: Bauart=0 → no Hz-beweglich TPs
  - Log `[M2.achieved]` or `[M2.missed]` based on NI_W2006 test result
  - Log `[M3.achieved]` or `[M3.missed]` based on NRB_W806 test result
- [ ] Write unit test `test/tp-key-transformer.test.js`:
  - Test VORLA key transformation for both NI_W2006 and NRB_W806 examples
- [ ] Write integration test `test/wizard-flow.test.js`:
  - Full wizard session: create session → answer all questions for NI_W2006 → confirm → verify TP list
  - Uses mock FL service (`FL_MOCK=true`)
- [ ] Run `npm test` — all tests must pass

---

## CSV Export Fallback (NFR — Reliability)

- [ ] Implement `GET /wizard/session/:id/export` — returns CSV of all derived TPs:
  - Columns: `tpKey`, `tpLabel`, `area`, `posNr`, `isAutomatic`
  - Triggered automatically in result screen when bulk creation fails

---

## Audit Trail

- [ ] For each confirmed wizard session, persist audit record in CAP in-memory store:
  - `{ sessionId, ds100, switchNumber, basicForm, answersSnapshot, derivedTPCount, createdAt, creationResult }`
  - Endpoint: `GET /wizard/sessions` — list recent sessions (last 20)

