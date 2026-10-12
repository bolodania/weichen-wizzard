# TP-Wizard Weiche — Two-Role Workflow Design

**Date:** 2026-10-12  
**Project:** DB InfraGO SAP Hackathon — TP-Wizard Weiche  
**Status:** Approved by user

---

## 1. Problem and Context

Creating a SAP Technischer Platz (TP) hierarchy for a railway switch (Weiche) currently requires deep knowledge of DB InfraGO's TP key systematics (VORLA keys, Positionsnummern, Bereiche 1–19). The existing wizard captures this knowledge in a rule engine (~107 rows from `Kopie von Fragen.xlsx`, 27 automatic + 48 user-facing questions) and a Forla template (Maximalausprägung).

The existing app is a single-user desktop workflow. The redesign separates the process into two focused roles:

- **Katrin (Feldaufnehmerin)** — field engineer at the track, mobile device, limited SAP knowledge. Captures the physical switch data as simply as possible.
- **Thomas (Technischer Verantwortlicher)** — approver at a desktop, full SAP and process knowledge. Reviews and finalises the submission before it is written to SAP S/4HANA.

**Safety note:** An incorrect or incomplete TP structure leads to incorrect maintenance orders and faulty physical maintenance. Thomas's approval step is a hard gate before any SAP write.

---

## 2. Architecture

### 2.1 Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│  SAP BTP (Cloud Foundry)                                        │
│                                                                 │
│  ┌─────────────────────┐   ┌─────────────────────────────────┐  │
│  │  tp-wizard-cap      │   │  tp-wizard-agent (Python)       │  │
│  │  CAP Node.js        │   │  LangGraph + LiteLLM + A2A SDK  │  │
│  │  /wizard OData svc  │◄──┤  Handles Katrin's chat/voice    │  │
│  │  Rule Engine        │   │  Smart Default Engine           │  │
│  │  FL OData proxy     │   │  Calls CAP wizard actions       │  │
│  └─────────────────────┘   └─────────────────────────────────┘  │
│           │                                                     │
│    ┌──────┴────────┐                                            │
│    │  SQLite (dev) │  →  S/4HANA (API_FUNCTIONALLOCATION)       │
│    └───────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
           ▲                       ▲
           │                       │
  ┌────────┴──────┐       ┌────────┴──────┐
  │  /field       │       │  /approve     │
  │  Katrin UI    │       │  Thomas UI    │
  │  Mobile chat  │       │  Fiori LR+OP  │
  └───────────────┘       └───────────────┘
```

Two separate Vite/React apps sharing one CAP backend:

| App | Path | Target device | User |
|-----|------|--------------|------|
| `app-field` | `/field` | Mobile (375–414 px) | Katrin |
| `app-approve` | `/approve` | Desktop | Thomas |

### 2.2 Session State Machine

```
idle ──createSession──► open ──submitSession──► submitted
                                                    │
                         ┌──────────────────────────┘
                         │  Thomas edits (zero or more times)
                         ▼
                      editing ──approveSession──► approved ──SAP write──► created
                                                                              │
                                                                          (error)──► failed
```

| State | Owner | Meaning |
|-------|-------|---------|
| `open` | Katrin/Agent | Session created, dialogue in progress |
| `submitted` | Agent | Katrin confirmed; waiting for Thomas |
| `editing` | Thomas | Thomas is adjusting answers |
| `approved` | Thomas | Thomas confirmed; SAP write queued |
| `created` | System | All FLs created in S/4HANA |
| `failed` | System | SAP write partially or fully failed |

There is no "rejected" state. Thomas can only edit and approve.

---

## 3. Backend Changes (CAP — `tp-wizard-cap`)

### 3.1 New and Changed CDS Actions/Functions

```cds
// New action — Katrin/Agent submits for review
action submitSession(sessionId: String) returns { sessionId: String, message: String };

// New action — Thomas approves → triggers SAP write (renamed from confirmSession)
action approveSession(sessionId: String) returns {
  sessionId: String;
  created:   String;  // JSON
  failed:    String;  // JSON
};

// New function — Thomas list view
function listPendingSessions() returns array of {
  sessionId:        String;
  ds100:            String;
  switchNumber:     String;
  basicForm:        String;
  basicFormLabel:   String;
  submittedAt:      DateTime;
  tpCount:          Integer;
  openHintCount:    Integer;   // number of agent-assumed answers Thomas hasn't seen
};

// New function — hints/warnings for Thomas
function getOpenHints(sessionId: String) returns array of {
  questionId:  String;
  questionText: String;
  area:        Integer;
  areaName:    String;
  source:      String;   // "auto" | "agent-default" | "katrin-confirmed" | "katrin-corrected"
  value:       String;
  hint:        String;   // human-readable explanation of why this needs attention
};

// New action — Thomas edits a single answer
action editAnswer(sessionId: String, questionId: String, answer: String) returns { sessionId: String };
```

The existing `confirmSession` is replaced by `approveSession` (same SAP-write logic, new state guard).

### 3.2 Answer Source Tracking

Every answer stored in the session carries a `source` tag:

| Source | Set by | Meaning |
|--------|--------|---------|
| `auto` | Rule engine | Automatically derived (isAutomatic=true rows — Stränge, Schwellen, Zwischenschiene) |
| `agent-default` | Smart Default Engine | Agent proposed a best-practice default; Katrin did not explicitly address it |
| `katrin-confirmed` | Agent dialogue | Katrin explicitly confirmed the agent's proposal |
| `katrin-corrected` | Agent dialogue | Katrin provided a value that differed from the agent's proposal |

Stored structure per answer in `answersJson`:
```json
{ "questionId": "hz_bauart", "answer": "2", "source": "katrin-confirmed", "agentProposal": "2" }
```

### 3.3 WizardSession Schema Changes

```cds
entity WizardSession {
  key sessionId    : String(36);
  ds100            : String(10);
  switchNumber     : String(10);
  basicForm        : String(20);
  answersJson      : String(4000);  // now includes source per answer
  status           : String(20);    // extended state machine (see 2.2)
  derivedTPCount   : Integer;
  createdAt        : DateTime;
  submittedAt      : DateTime;      // NEW
  approvedAt       : DateTime;      // NEW
  creationResult   : String(500);
}
```

### 3.4 Smart Default Engine (Rule-Based)

The CAP backend exposes a new function the agent calls before starting the dialogue:

```cds
function getSmartDefaults(basicForm: String) returns array of {
  questionId: String;
  defaultAnswer: String;
  confidence: String;   // "high" | "medium" | "low"
  rationale: String;    // why this default applies
};
```

Defaults are derived from `wizard-questions.js` + `basicFormMappings` data. For example:
- **EWL/EWR**: Herzstückbauart = 1 (verschraubt), Radlenker = 1 (vorhanden), Heizung = 0 (keine)
- **DKW**: Herzstückbauart = 2 (beweglich), Radlenker = 2 (beidseitig)

The agent applies these defaults with `source: "agent-default"` and only surfaces questions where it has low confidence or where Katrin's earlier answers trigger a branch.

---

## 4. Katrin's Agent-Driven Mobile UI (`app-field`)

### 4.1 Entry Point

A minimal splash screen with three required inputs:
- **DS100** (Betriebsstelle, e.g. "NI") — text input
- **Weichennummer** (e.g. "2006") — text input
- **Grundbauform** — select: EWL / EWR / DKW / EKW / IBW / DW / ABW

On "Starten", the app calls `createSession` and then immediately fetches smart defaults from the agent. The agent prepares its opening message.

### 4.2 Chat Interface

Single-screen chat layout:
- Full-height message thread (bottom-up scroll)
- Fixed bottom bar: text input + microphone button (Web Speech API) + send
- SAP Horizon token colours: own messages right-aligned (SAP blue), agent messages left-aligned (neutral)

The agent's opening message introduces itself and presents the pre-loaded draft:
> "Ich habe die Standardkonfiguration für eine **EWL** (Einfache Weiche links) geladen. Ich gehe von folgenden Standardwerten aus:  
> • Herzstückbauart: verschraubt  
> • Radlenker: vorhanden  
> • Heizung: keine  
> Gibt es bei dieser Weiche Besonderheiten, die davon abweichen?"

Katrin can respond naturally: "Die Weiche hat eine Heizung" — the agent maps this to `heizung = 1`, sets `source: "katrin-corrected"`, and updates the TP preview.

### 4.3 TP Preview Panel

Collapsible bottom sheet (mobile) or side drawer (tablet):
- Grouped by Bereich (area), colour-coded by source
- Updates live as answers arrive
- Total TP count shown as badge

### 4.4 Submit Flow

When the agent determines all branching questions are resolved (or when Katrin says "fertig"), it summarises:
> "Ich habe **34 Technische Plätze** abgeleitet.  
> Deine Angaben: Heizung vorhanden, Herzstückbauart verschraubt.  
> Alles andere entspricht der Standardkonfiguration.  
> Soll ich die Einreichung für Thomas freigeben?"

Katrin confirms → `submitSession` → success screen with reference number.

### 4.5 Voice Input

The microphone button activates the Web Speech API (lang: `de-DE`). Transcribed text is dropped into the input field so Katrin can correct before sending. No auto-send on voice to avoid accidental submission.

---

## 5. Thomas' Desktop Approval UI (`app-approve`)

### 5.1 List Report (Fiori List Report pattern)

Route: `/approve`

Table columns:
| Column | Notes |
|--------|-------|
| Betriebsstelle | DS100 |
| Weiche | switchNumber |
| Grundbauform | with label |
| Eingereicht | submittedAt, formatted |
| TPs | derivedTPCount |
| Hinweise | badge count from openHintCount; red if > 0 |
| Status | submitted / editing / approved / created |

Filter bar: Status, Betriebsstelle, Grundbauform, Eingereicht (date range).  
Clicking a row navigates to the Object Page.

### 5.2 Object Page (Fiori Object Page pattern)

Route: `/approve/:sessionId`

**Header:**  
`NI W2006 — Einfache Weiche links` with status badge.

**Warning strip (prominent, top of content):**  
Only shown when `openHintCount > 0`:
> ⚠ **3 Agentannahmen nicht geprüft** — Herzstückbauart (auto), Heizungspositionen (agent-default), Rückbaustatus (auto). Bitte prüfen bevor du freigibst.

Strip dismisses when Thomas has reviewed each flagged item.

**Section: Antworten (19 Bereiche as sub-sections)**  
Expandable per Bereich. Each question row:
- Question label + current answer
- Source tag chip: `AUTO` / `AGENT-STANDARD` / `BESTÄTIGT` / `KORRIGIERT`
- Edit icon → inline edit or opens answer dialog
- `agent-default` rows are highlighted (amber left border) as "nicht von Katrin bestätigt"

**Section: TP-Vorschau**  
Read-only TP table: posNr, tpKey, tpLabel, area. Grouped by Bereich. Same data as `getTPPreview`.

**Footer toolbar:**  
`Freigeben` (primary, Emphasized) — disabled until Thomas has reviewed all red-flagged hints.  
`CSV Export` (secondary).

**Freigeben confirmation dialog:**  
> "**34 Technische Plätze werden in SAP S/4HANA angelegt.**  
> Davon basieren 6 Einträge auf Agentannahmen, die nicht explizit von Katrin bestätigt wurden.  
> Diese Aktion kann nicht rückgängig gemacht werden."  
> [Abbrechen] [**Freigeben**]

On confirm → `approveSession` → SAP write → result screen shows created/failed counts.

---

## 6. Code Gaps from Excel Analysis

The following questions from `Kopie von Fragen.xlsx` are not yet in `wizard-questions.js` and must be added during implementation:

| Bereich | Gap | Notes |
|---------|-----|-------|
| All | Rückbaustatus field (0=new, 1+=Rückbau) | Controls which TPs are included |
| 4 (Prellbock) | SH0 / SH2 distinction | Two Prellbock types with different TPs |
| 11 (Zgv) | Riegelhandschloss detail | Binary question |
| 11 (Zgv) | Zungenprüfkontakte detail | Binary question |
| 14 (Hz) | Niederhalter detail | Affects Hz TP count |
| 14 (Hz) | Handverschlüsse detail | Binary, affects Hz TPs |
| 14 (Hz) | Heizung positions (A-Strang, B-Strang, etc.) | Enumeration per heated element |

These gaps are explicitly flagged in `getOpenHints` as `confidence: "low"` items, ensuring Thomas always sees them for new EWL/EWR/DKW sessions.

---

## 7. Testing

- **Rule engine unit tests**: `deriveTPStructure` with fixtures from `NI_W2006` and `NRB_W806` Excel sheets — assert TP count and key correctness
- **State machine tests**: assert invalid transitions throw `req.error` (e.g., `approveSession` on `open` session)
- **Source tracking tests**: verify that `agent-default` answers remain tagged correctly after `editAnswer`
- **Agent integration test**: mock the CAP backend; verify the agent applies smart defaults and only asks low-confidence questions
- **UI smoke tests**: Playwright against both `/field` (chat flow to submit) and `/approve` (list → detail → approve)

---

## 8. Out of Scope (MVP)

- Push notifications to Thomas when Katrin submits
- Multi-switch batch submission
- Offline mode for Katrin
- S/4HANA hierarchy validation (FUNCNLLOCSTRUCLIST_0001 read-back)
- Role-based access control (XSUAA); Hackathon uses no-auth mode
