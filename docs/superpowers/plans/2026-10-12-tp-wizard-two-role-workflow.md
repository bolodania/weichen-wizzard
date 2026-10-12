# TP-Wizard Two-Role Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend TP-Wizard Weiche with a two-role workflow: Katrin (mobile chat + smart defaults via agent) submits for review; Thomas (desktop Fiori List Report + Object Page) edits and approves before anything is written to SAP S/4HANA.

**Architecture:** The existing CAP backend gains a state machine (open→submitted→editing→approved→created), source-tagged answers, and six new actions/functions. Two new Vite/React frontends are added alongside the existing `app/`: `app-field` (Katrin, mobile chat, directly calls CAP) and `app-approve` (Thomas, Fiori LR+OP). The Python agent's SKILL.md is already updated; only `agent.py` needs a system-prompt update and `submitSession` wiring.

**Tech Stack:** SAP CAP Node.js 8, @ui5/webcomponents-react ^2, Vite 5, React 18, Web Speech API (de-DE), Python 3.11 + LangGraph

**Spec:** `docs/superpowers/specs/2026-10-12-tp-wizard-two-role-design.md`

## Global Constraints

- All user-facing copy in German
- Answer `source` values: `auto | agent-default | katrin-confirmed | katrin-corrected | thomas-edited`
- Session `status` values: `open | submitted | editing | approved | created | failed`
- `approveSession` is the ONLY handler that calls `flService.bulkCreateFunctionalLocations` — never `submitSession`
- `confirmSession` (existing) kept but deprecated; add a comment, do not delete
- `submitAnswer` backward-compatible: `source` defaults to `"katrin-confirmed"` when omitted
- `FL_MOCK=true` env var keeps mock FL service active throughout
- Both new apps live under `assets/tp-wizard-cap/` as `app-field/` and `app-approve/`
- Each new app runs its own Vite dev server and proxies `/wizard` → `http://localhost:4004`

## Review Focus

1. **State machine bypass** — `submitSession` on a session with `status !== 'open'` must return 409, not silently proceed; test this guard explicitly
2. **`source` field missing from `submitAnswer`** — when the field is omitted (backward compat), handler must default to `"katrin-confirmed"` without crashing
3. **`approveSession` on wrong state** — calling it on `open` or `created` must return 409; a stale client could do this
4. **`openHintCount` staleness** — `listPendingSessions` computes hint count inline from SESSION_STORE; if this count differs from a fresh `getOpenHints` call, Thomas sees "0 hints" and skips review — add a shared helper so both use the same logic
5. **Voice input race condition** — Web Speech API fires `onend` before `onresult` on some browsers/Android Chrome; transcript must land in the text field only after `onresult` fires — test with `SpeechRecognition` mock

---

## File Map

### CAP Backend (`assets/tp-wizard-cap/`)

| Action | File |
|--------|------|
| Modify | `db/schema.cds` — add `submittedAt`, `approvedAt` to WizardSession |
| Modify | `srv/wizard-service.cds` — add 6 new actions/functions; extend `submitAnswer` |
| Modify | `srv/wizard-service.js` — implement all new handlers |
| Create | `srv/lib/smart-defaults.js` — defaults table per Grundbauform |
| Create | `test/wizard-service.test.js` — state machine + new endpoints |

### app-field (`assets/tp-wizard-cap/app-field/`)

| Action | File |
|--------|------|
| Create | `package.json`, `vite.config.js`, `index.html`, `src/main.jsx` |
| Create | `src/App.jsx` — router: EntryScreen / ChatScreen / SuccessScreen |
| Create | `src/hooks/useAgentSession.js` — all CAP calls, session state |
| Create | `src/components/ChatThread.jsx` — message list |
| Create | `src/components/MessageInput.jsx` — text + mic button |
| Create | `src/components/TPPreviewSheet.jsx` — collapsible TP list |
| Create | `src/components/SubmitSummary.jsx` — pre-submit confirmation |

### app-approve (`assets/tp-wizard-cap/app-approve/`)

| Action | File |
|--------|------|
| Create | `package.json`, `vite.config.js`, `index.html`, `src/main.jsx` |
| Create | `src/App.jsx` — router: ListReport / ObjectPage |
| Create | `src/hooks/useApprovalSessions.js` — listPendingSessions, getOpenHints, editAnswer, approveSession |
| Create | `src/components/SessionListReport.jsx` — table + filters |
| Create | `src/components/SessionObjectPage.jsx` — full detail view |
| Create | `src/components/WarningStrip.jsx` — unreviewed hints banner |
| Create | `src/components/AnswerSection.jsx` — answer rows with edit |
| Create | `src/components/TPPreviewSection.jsx` — read-only TP table |
| Create | `src/components/ApproveDialog.jsx` — confirmation dialog |

### Agent (`assets/tp-wizard-agent/`)

| Action | File |
|--------|------|
| Modify | `app/agent.py` — update system prompt for two-role flow |

---

## Task 1: CAP Backend — Schema Extension & Answer Source Tracking

**Files:**
- Modify: `assets/tp-wizard-cap/db/schema.cds`
- Modify: `assets/tp-wizard-cap/srv/wizard-service.cds` — extend `submitAnswer`
- Modify: `assets/tp-wizard-cap/srv/wizard-service.js` — store `source`

**Interfaces:**
- Produces: `submitAnswer` now accepts optional `source: String`; `WizardSession` has `submittedAt` and `approvedAt`

- [ ] **Step 1: Write schema test**

In terminal: `cd "assets/tp-wizard-cap" && cds compile db/schema.cds --to json > /dev/null && echo OK`
Expected: `OK` — baseline confirming current schema compiles.

- [ ] **Step 2: Extend `db/schema.cds`**

Replace the `WizardSession` entity with:

```cds
entity WizardSession {
  key sessionId    : String(36);
  ds100            : String(10);
  switchNumber     : String(10);
  basicForm        : String(20);
  answersJson      : String(4000);
  status           : String(20);   // open|submitted|editing|approved|created|failed
  derivedTPCount   : Integer;
  createdAt        : DateTime;
  submittedAt      : DateTime;
  approvedAt       : DateTime;
  creationResult   : String(500);
}
```

- [ ] **Step 3: Verify schema still compiles**

```bash
cd "assets/tp-wizard-cap" && cds compile db/schema.cds --to json > /dev/null && echo OK
```
Expected: `OK`

- [ ] **Step 4: Extend `submitAnswer` signature in `srv/wizard-service.cds`**

Replace the `submitAnswer` action block:

```cds
  action submitAnswer(
    sessionId    : String,
    questionId   : String,
    answer       : String,
    source       : String   // auto|agent-default|katrin-confirmed|katrin-corrected
  ) returns {
    sessionId    : String;
    nextQuestion : String; // JSON
    tpPreview    : String; // JSON
  };
```

- [ ] **Step 5: Update `submitAnswer` handler in `srv/wizard-service.js` to store source**

In the `submitAnswer` handler, replace the answer push/update lines so they include `source` and `agentProposal`:

```js
// In srv/wizard-service.js — inside srv.on('submitAnswer', ...)
const { sessionId, questionId, answer, source } = req.data;
const resolvedSource = source || 'katrin-confirmed';

const existingIdx = session.answers.findIndex(a => a.questionId === questionId);
if (existingIdx >= 0) {
  const prev = session.answers[existingIdx];
  session.answers[existingIdx] = {
    questionId,
    answer,
    source: resolvedSource,
    agentProposal: prev.agentProposal ?? (prev.source === 'agent-default' ? prev.answer : null)
  };
} else {
  session.answers.push({ questionId, answer, source: resolvedSource, agentProposal: null });
}
```

- [ ] **Step 6: Verify CDS service compiles**

```bash
cd "assets/tp-wizard-cap" && cds compile srv/wizard-service.cds --to json > /dev/null && echo OK
```
Expected: `OK`

- [ ] **Step 7: Start CAP server and smoke-test submitAnswer with source**

```bash
cd "assets/tp-wizard-cap" && npm start &
sleep 3
curl -s -X POST http://localhost:4004/wizard/createSession \
  -H "Content-Type: application/json" \
  -d '{"ds100":"NI","switchNumber":"2006","basicForm":"EWL"}' | grep sessionId

# Then submitAnswer with source
SESSION_ID=<from above>
curl -s -X POST http://localhost:4004/wizard/submitAnswer \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"questionId\":\"herzstückbauart\",\"answer\":\"0\",\"source\":\"agent-default\"}"
```
Expected: JSON with `sessionId`, `nextQuestion`, `tpPreview`

- [ ] **Step 8: Commit**

```bash
git add assets/tp-wizard-cap/db/schema.cds assets/tp-wizard-cap/srv/wizard-service.cds assets/tp-wizard-cap/srv/wizard-service.js
git commit -m "feat(cap): extend WizardSession schema and add source tracking to submitAnswer"
```

---

## Task 2: CAP Backend — Smart Defaults Engine

**Files:**
- Create: `assets/tp-wizard-cap/srv/lib/smart-defaults.js`
- Modify: `assets/tp-wizard-cap/srv/wizard-service.cds` — add `getSmartDefaults`
- Modify: `assets/tp-wizard-cap/srv/wizard-service.js` — implement handler
- Create: `assets/tp-wizard-cap/test/smart-defaults.test.js`

**Interfaces:**
- Produces: `getSmartDefaults(basicForm)` returns `[{ questionId, defaultAnswer, confidence, rationale }]`; `confidence` is `"high" | "medium" | "low"`

- [ ] **Step 1: Create `srv/lib/smart-defaults.js`**

```js
'use strict';

// Standardkonfigurationen per Grundbauform, abgeleitet aus Kopie von Fragen.xlsx.
// questionIds müssen mit WIZARD_QUESTIONS ids übereinstimmen.
const DEFAULTS = {
  EWL: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'EWL — Herzstück meist starr' },
    { questionId: 'federwippe',              defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWL ohne Federwippe als Standard' },
    { questionId: 'prellbock',               defaultAnswer: 'false',   confidence: 'high',   rationale: 'EWL ohne Prellbock als Standard' },
    { questionId: 'heizungTyp',              defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert stark — bitte prüfen' },
    { questionId: 'erdung',                  defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWL ohne Erdung als Standard' },
    { questionId: 'weichensignale',          defaultAnswer: '0',       confidence: 'medium', rationale: 'EWL ohne Weichensignal als Standard' },
    { questionId: 'weichensteuerung',        defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWL ohne dezentrale Steuerung' },
    { questionId: 'weichenüberwachung',      defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWL ohne Überwachungseinrichtung' },
    { questionId: 'radsensoren',             defaultAnswer: '0',       confidence: 'medium', rationale: 'EWL ohne Radsensoren als Standard' },
  ],
  EWR: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'EWR — Herzstück meist starr' },
    { questionId: 'federwippe',              defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWR ohne Federwippe als Standard' },
    { questionId: 'prellbock',               defaultAnswer: 'false',   confidence: 'high',   rationale: 'EWR ohne Prellbock als Standard' },
    { questionId: 'heizungTyp',              defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert stark — bitte prüfen' },
    { questionId: 'erdung',                  defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWR ohne Erdung als Standard' },
    { questionId: 'weichensignale',          defaultAnswer: '0',       confidence: 'medium', rationale: 'EWR ohne Weichensignal als Standard' },
    { questionId: 'weichensteuerung',        defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWR ohne dezentrale Steuerung' },
    { questionId: 'weichenüberwachung',      defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWR ohne Überwachungseinrichtung' },
    { questionId: 'radsensoren',             defaultAnswer: '0',       confidence: 'medium', rationale: 'EWR ohne Radsensoren als Standard' },
  ],
  DKW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '2',       confidence: 'medium', rationale: 'DKW — Herzstück meist beweglich Bauart 2' },
    { questionId: 'federwippe',              defaultAnswer: 'true',    confidence: 'medium', rationale: 'DKW meist mit Federwippe' },
    { questionId: 'heizungTyp',              defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert — bitte prüfen' },
    { questionId: 'prellbock',               defaultAnswer: 'false',   confidence: 'high',   rationale: 'DKW ohne Prellbock als Standard' },
  ],
  EKW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '1',       confidence: 'medium', rationale: 'EKW — Herzstück meist beweglich Bauart 1' },
    { questionId: 'federwippe',              defaultAnswer: 'false',   confidence: 'medium', rationale: 'EKW ohne Federwippe als Standard' },
    { questionId: 'heizungTyp',              defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert — bitte prüfen' },
  ],
  IBW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'IBW — Herzstück meist starr' },
    { questionId: 'federwippe',              defaultAnswer: 'false',   confidence: 'medium', rationale: 'IBW ohne Federwippe' },
    { questionId: 'heizungTyp',             defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert' },
  ],
  DW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'DW — Herzstück meist starr' },
    { questionId: 'heizungTyp',             defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert' },
  ],
  ABW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'ABW — Herzstück meist starr' },
    { questionId: 'heizungTyp',             defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert' },
  ],
};

function getSmartDefaults(basicForm) {
  return DEFAULTS[basicForm] || [];
}

module.exports = { getSmartDefaults };
```

- [ ] **Step 2: Write failing test**

Create `assets/tp-wizard-cap/test/smart-defaults.test.js`:

```js
'use strict';
const { getSmartDefaults } = require('../srv/lib/smart-defaults');

test('EWL returns rückbauStatus as high confidence', () => {
  const defaults = getSmartDefaults('EWL');
  const d = defaults.find(d => d.questionId === 'rückbauStatus');
  expect(d).toBeDefined();
  expect(d.defaultAnswer).toBe('0');
  expect(d.confidence).toBe('high');
});

test('DKW herzstückbauart default is 2 (beweglich)', () => {
  const defaults = getSmartDefaults('DKW');
  const d = defaults.find(d => d.questionId === 'herzstückbauart');
  expect(d?.defaultAnswer).toBe('2');
});

test('heizungTyp is always low confidence', () => {
  for (const bf of ['EWL', 'EWR', 'DKW']) {
    const d = getSmartDefaults(bf).find(d => d.questionId === 'heizungTyp');
    expect(d?.confidence).toBe('low');
  }
});

test('unknown basicForm returns empty array', () => {
  expect(getSmartDefaults('UNKNOWN')).toEqual([]);
});
```

- [ ] **Step 3: Run test — expect FAIL (module missing)**

```bash
cd "assets/tp-wizard-cap" && npx jest test/smart-defaults.test.js --no-coverage
```
Expected: Error `Cannot find module '../srv/lib/smart-defaults'`

- [ ] **Step 4: Run test again after creating the file**

The file was already created in Step 1. Run:

```bash
cd "assets/tp-wizard-cap" && npx jest test/smart-defaults.test.js --no-coverage
```
Expected: All 4 tests PASS

- [ ] **Step 5: Add `getSmartDefaults` to `srv/wizard-service.cds`**

Add after `exportSessionCSV`:

```cds
  function getSmartDefaults(basicForm : String) returns array of {
    questionId    : String;
    defaultAnswer : String;
    confidence    : String;
    rationale     : String;
  };
```

- [ ] **Step 6: Implement `getSmartDefaults` handler in `srv/wizard-service.js`**

Add at the top with other requires:
```js
const { getSmartDefaults: loadSmartDefaults } = require('./lib/smart-defaults');
```

Add handler before the closing `};`:
```js
  srv.on('getSmartDefaults', (req) => {
    const { basicForm } = req.data;
    if (!basicForm) return req.error(400, 'basicForm ist Pflichtfeld');
    return loadSmartDefaults(basicForm);
  });
```

- [ ] **Step 7: Smoke-test endpoint**

```bash
curl -s "http://localhost:4004/wizard/getSmartDefaults(basicForm='EWL')" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).value.length,'defaults')"
```
Expected: `10 defaults` (or similar, ≥ 5)

- [ ] **Step 8: Commit**

```bash
git add assets/tp-wizard-cap/srv/lib/smart-defaults.js assets/tp-wizard-cap/srv/wizard-service.cds assets/tp-wizard-cap/srv/wizard-service.js assets/tp-wizard-cap/test/smart-defaults.test.js
git commit -m "feat(cap): add Smart Defaults Engine with getSmartDefaults function"
```

---

## Task 3: CAP Backend — submitSession & State Machine Guards

**Files:**
- Modify: `assets/tp-wizard-cap/srv/wizard-service.cds` — add `submitSession`
- Modify: `assets/tp-wizard-cap/srv/wizard-service.js` — implement + guards
- Create/extend: `assets/tp-wizard-cap/test/wizard-service.test.js`

**Interfaces:**
- Produces: `submitSession(sessionId)` → `{ sessionId, message }`; transitions `open → submitted`

- [ ] **Step 1: Write failing test**

Create `assets/tp-wizard-cap/test/wizard-service.test.js`:

```js
'use strict';
const cds = require('@sap/cds');

describe('WizardService state machine', () => {
  let srv, SESSION_STORE;

  beforeAll(async () => {
    // Use in-memory CAP test server
    const app = await cds.test(__dirname + '/..');
    srv = await cds.connect.to('WizardService');
    // Access the session store via a test helper (we'll expose it in Step 3)
    SESSION_STORE = require('../srv/wizard-service').__testSessionStore;
  });

  afterEach(() => SESSION_STORE.clear());

  test('submitSession transitions open → submitted', async () => {
    const { sessionId } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9001', basicForm: 'EWL' });
    const result = await srv.send('submitSession', { sessionId });
    expect(result.message).toMatch(/weitergeleitet/);
    expect(SESSION_STORE.get(sessionId).status).toBe('submitted');
  });

  test('submitSession on non-open session returns 409', async () => {
    const { sessionId } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9002', basicForm: 'EWL' });
    await srv.send('submitSession', { sessionId });
    await expect(srv.send('submitSession', { sessionId })).rejects.toThrow(/409/);
  });

  test('submitAnswer defaults source to katrin-confirmed when omitted', async () => {
    const { sessionId } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9003', basicForm: 'EWL' });
    await srv.send('submitAnswer', { sessionId, questionId: 'herzstückbauart', answer: '0' });
    const answer = SESSION_STORE.get(sessionId).answers.find(a => a.questionId === 'herzstückbauart');
    expect(answer.source).toBe('katrin-confirmed');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "assets/tp-wizard-cap" && npx jest test/wizard-service.test.js --no-coverage 2>&1 | head -20
```
Expected: Fails with `submitSession` undefined or `__testSessionStore` undefined.

- [ ] **Step 3: Add `submitSession` to `srv/wizard-service.cds`**

Add after `confirmSession`:

```cds
  action submitSession(
    sessionId : String
  ) returns {
    sessionId : String;
    message   : String;
  };
```

- [ ] **Step 4: Implement `submitSession` handler in `srv/wizard-service.js` and export test hook**

Add handler:

```js
  srv.on('submitSession', (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') {
      return req.error(409, `Session ist bereits im Status '${session.status}'`);
    }
    session.status = 'submitted';
    session.submittedAt = new Date().toISOString();
    LOG.info(`Session submitted for approval: ${sessionId}`);
    return { sessionId, message: 'Einreichung wurde zur Freigabe weitergeleitet' };
  });
```

At the very end of the file, after `module.exports = (srv) => {` closing brace, add:

```js
// Expose SESSION_STORE for unit tests only
module.exports.__testSessionStore = SESSION_STORE;
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd "assets/tp-wizard-cap" && npx jest test/wizard-service.test.js --no-coverage
```
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add assets/tp-wizard-cap/srv/wizard-service.cds assets/tp-wizard-cap/srv/wizard-service.js assets/tp-wizard-cap/test/wizard-service.test.js
git commit -m "feat(cap): add submitSession action and state machine guards"
```

---

## Task 4: CAP Backend — editAnswer & approveSession

**Files:**
- Modify: `assets/tp-wizard-cap/srv/wizard-service.cds`
- Modify: `assets/tp-wizard-cap/srv/wizard-service.js`
- Extend: `assets/tp-wizard-cap/test/wizard-service.test.js`

**Interfaces:**
- Produces: `editAnswer(sessionId, questionId, answer, source?)` → `{ sessionId }`; `approveSession(sessionId)` → `{ sessionId, created, failed, openFields }`

- [ ] **Step 1: Add tests**

Append to `test/wizard-service.test.js`:

```js
  test('editAnswer transitions submitted → editing', async () => {
    const { sessionId } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9004', basicForm: 'EWL' });
    await srv.send('submitSession', { sessionId });
    await srv.send('editAnswer', { sessionId, questionId: 'herzstückbauart', answer: '1', source: 'thomas-edited' });
    expect(SESSION_STORE.get(sessionId).status).toBe('editing');
    const a = SESSION_STORE.get(sessionId).answers.find(a => a.questionId === 'herzstückbauart');
    expect(a.answer).toBe('1');
    expect(a.source).toBe('thomas-edited');
  });

  test('approveSession on open session returns 409', async () => {
    const { sessionId } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9005', basicForm: 'EWL' });
    await expect(srv.send('approveSession', { sessionId })).rejects.toThrow(/409/);
  });

  test('approveSession on submitted session triggers SAP write (mock)', async () => {
    process.env.FL_MOCK = 'true';
    const { sessionId } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9006', basicForm: 'EWL' });
    await srv.send('submitSession', { sessionId });
    const result = await srv.send('approveSession', { sessionId });
    const created = JSON.parse(result.created);
    expect(Array.isArray(created)).toBe(true);
    expect(SESSION_STORE.get(sessionId).status).toBe('created');
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd "assets/tp-wizard-cap" && npx jest test/wizard-service.test.js --no-coverage 2>&1 | grep -E "PASS|FAIL|●"
```
Expected: `editAnswer` and `approveSession` tests fail.

- [ ] **Step 3: Add to `srv/wizard-service.cds`**

Add after `submitSession`:

```cds
  action editAnswer(
    sessionId  : String,
    questionId : String,
    answer     : String,
    source     : String   // defaults to thomas-edited
  ) returns {
    sessionId  : String;
  };

  action approveSession(
    sessionId  : String
  ) returns {
    sessionId  : String;
    created    : String; // JSON
    failed     : String; // JSON
    openFields : String; // JSON
  };
```

- [ ] **Step 4: Implement `editAnswer` handler in `srv/wizard-service.js`**

```js
  srv.on('editAnswer', async (req) => {
    const { sessionId, questionId, answer, source } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (!['submitted', 'editing'].includes(session.status)) {
      return req.error(409, `Session kann im Status '${session.status}' nicht bearbeitet werden`);
    }
    if (session.status === 'submitted') session.status = 'editing';

    const resolvedSource = source || 'thomas-edited';
    const existingIdx = session.answers.findIndex(a => a.questionId === questionId);
    if (existingIdx >= 0) {
      session.answers[existingIdx] = {
        ...session.answers[existingIdx],
        answer,
        source: resolvedSource
      };
    } else {
      session.answers.push({ questionId, answer, source: resolvedSource, agentProposal: null });
    }

    // Recompute TP preview
    const db = await cds.connect.to('db');
    const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));
    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates, basicFormMappings
    );
    session.tpPreview = tps;

    return { sessionId };
  });
```

- [ ] **Step 5: Implement `approveSession` handler**

`approveSession` contains the same SAP-write logic as `confirmSession`. Extract it into a shared helper first, then use it from both:

In `srv/wizard-service.js`, just above `module.exports`, add helper:

```js
async function _executeSAPWrite(session) {
  const db = await cds.connect.to('db');
  const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
  const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));

  const { tps } = deriveTPStructure(
    { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
    forlaTemplates, basicFormMappings
  );

  const validation = validateTPStructure(tps, forlaTemplates);
  if (!validation.valid) throw Object.assign(new Error(`TP-Struktur ungültig: ${validation.warnings.join(', ')}`), { code: 422 });

  const result = await flService.bulkCreateFunctionalLocations(tps);

  session.status = 'created';
  session.derivedTPCount = tps.length;
  session.creationResult = JSON.stringify(result);

  await db.run(INSERT.into('tp.wizard.WizardSession').entries({
    sessionId:      session.sessionId,
    ds100:          session.ds100,
    switchNumber:   session.switchNumber,
    basicForm:      session.basicForm,
    answersJson:    JSON.stringify(session.answers),
    status:         session.status,
    derivedTPCount: session.derivedTPCount,
    createdAt:      session.createdAt,
    submittedAt:    session.submittedAt || null,
    approvedAt:     session.approvedAt || null,
    creationResult: session.creationResult
  }));

  return result;
}
```

Add `approveSession` handler:

```js
  srv.on('approveSession', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (!['submitted', 'editing'].includes(session.status)) {
      return req.error(409, `Session kann im Status '${session.status}' nicht freigegeben werden`);
    }

    session.approvedAt = new Date().toISOString();
    try {
      const result = await _executeSAPWrite(session);
      return {
        sessionId,
        created:    JSON.stringify(result.created),
        failed:     JSON.stringify(result.failed),
        openFields: JSON.stringify([])
      };
    } catch (e) {
      session.status = 'failed';
      return req.error(e.code || 500, e.message);
    }
  });
```

Also update the existing `confirmSession` to delegate to `_executeSAPWrite` and add a deprecation note:

```js
  // Deprecated: use approveSession. Kept for backward compatibility.
  srv.on('confirmSession', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') return req.error(409, 'Session ist bereits abgeschlossen');
    session.submittedAt = new Date().toISOString();
    session.approvedAt  = new Date().toISOString();
    try {
      const result = await _executeSAPWrite(session);
      return { sessionId, created: JSON.stringify(result.created), failed: JSON.stringify(result.failed), openFields: JSON.stringify([]) };
    } catch (e) {
      return req.error(e.code || 500, e.message);
    }
  });
```

Remove the old inline SAP-write block from confirmSession (replaced above).

- [ ] **Step 6: Run all tests — expect PASS**

```bash
cd "assets/tp-wizard-cap" && npx jest test/wizard-service.test.js --no-coverage
```
Expected: All 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add assets/tp-wizard-cap/srv/wizard-service.cds assets/tp-wizard-cap/srv/wizard-service.js assets/tp-wizard-cap/test/wizard-service.test.js
git commit -m "feat(cap): add editAnswer and approveSession with shared SAP-write helper"
```

---

## Task 5: CAP Backend — listPendingSessions & getOpenHints

**Files:**
- Modify: `assets/tp-wizard-cap/srv/wizard-service.cds`
- Modify: `assets/tp-wizard-cap/srv/wizard-service.js`
- Extend: `assets/tp-wizard-cap/test/wizard-service.test.js`

**Interfaces:**
- Produces: `listPendingSessions()` → array of session summaries; `getOpenHints(sessionId)` → array of flagged answers

- [ ] **Step 1: Add tests**

Append to `test/wizard-service.test.js`:

```js
  test('listPendingSessions returns only submitted/editing sessions', async () => {
    const { sessionId: s1 } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9010', basicForm: 'EWL' });
    const { sessionId: s2 } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9011', basicForm: 'EWR' });
    await srv.send('submitSession', { sessionId: s1 });
    // s2 stays open
    const list = await srv.send('listPendingSessions');
    const ids = list.map(s => s.sessionId);
    expect(ids).toContain(s1);
    expect(ids).not.toContain(s2);
  });

  test('getOpenHints returns agent-default answers', async () => {
    const { sessionId } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9012', basicForm: 'EWL' });
    await srv.send('submitAnswer', { sessionId, questionId: 'herzstückbauart', answer: '0', source: 'agent-default' });
    await srv.send('submitAnswer', { sessionId, questionId: 'federwippe', answer: 'false', source: 'katrin-confirmed' });
    await srv.send('submitSession', { sessionId });
    const hints = await srv.send('getOpenHints', { sessionId });
    expect(hints.length).toBe(1);
    expect(hints[0].questionId).toBe('herzstückbauart');
    expect(hints[0].source).toBe('agent-default');
  });

  test('listPendingSessions openHintCount matches getOpenHints length', async () => {
    const { sessionId } = await srv.send('createSession', { ds100: 'NI', switchNumber: '9013', basicForm: 'EWL' });
    await srv.send('submitAnswer', { sessionId, questionId: 'herzstückbauart', answer: '0', source: 'agent-default' });
    await srv.send('submitAnswer', { sessionId, questionId: 'federwippe', answer: 'false', source: 'agent-default' });
    await srv.send('submitSession', { sessionId });
    const list = await srv.send('listPendingSessions');
    const entry = list.find(s => s.sessionId === sessionId);
    const hints = await srv.send('getOpenHints', { sessionId });
    expect(entry.openHintCount).toBe(hints.length);
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd "assets/tp-wizard-cap" && npx jest test/wizard-service.test.js --no-coverage 2>&1 | grep -E "PASS|FAIL|●" | head -20
```

- [ ] **Step 3: Add functions to `srv/wizard-service.cds`**

```cds
  function listPendingSessions() returns array of {
    sessionId      : String;
    ds100          : String;
    switchNumber   : String;
    basicForm      : String;
    basicFormLabel : String;
    submittedAt    : DateTime;
    tpCount        : Integer;
    openHintCount  : Integer;
  };

  function getOpenHints(sessionId : String) returns array of {
    questionId   : String;
    questionText : String;
    area         : Integer;
    areaName     : String;
    source       : String;
    value        : String;
    hint         : String;
  };
```

- [ ] **Step 4: Add shared hint helper and implement handlers in `srv/wizard-service.js`**

Add shared helper after the imports, before `module.exports`:

```js
function _computeOpenHints(session) {
  const { WIZARD_QUESTIONS } = require('./lib/wizard-questions');
  return session.answers
    .filter(a => ['agent-default', 'auto'].includes(a.source))
    .map(a => {
      const q = WIZARD_QUESTIONS.find(q => q.id === a.questionId);
      return {
        questionId:   a.questionId,
        questionText: q?.text || a.questionId,
        area:         q?.area || 0,
        areaName:     q?.areaName || '',
        source:       a.source,
        value:        a.answer,
        hint: a.source === 'auto'
          ? 'Automatisch abgeleitet — kein Benutzerdialog'
          : `Agent-Standardwert (nicht von Katrin bestätigt): ${a.agentProposal ?? a.answer}`
      };
    });
}
```

Add handlers in `srv/wizard-service.js`:

```js
  const BASIC_FORM_LABELS = {
    EWL: 'Einfache Weiche links', EWR: 'Einfache Weiche rechts',
    DKW: 'Doppelte Kreuzungsweiche', EKW: 'Einfache Kreuzungsweiche',
    IBW: 'Innenbogenweiche', DW: 'Dreiwegweiche', ABW: 'Außenbogenweiche'
  };

  srv.on('listPendingSessions', () => {
    return Array.from(SESSION_STORE.values())
      .filter(s => ['submitted', 'editing'].includes(s.status))
      .map(s => ({
        sessionId:     s.sessionId,
        ds100:         s.ds100,
        switchNumber:  s.switchNumber,
        basicForm:     s.basicForm,
        basicFormLabel: BASIC_FORM_LABELS[s.basicForm] || s.basicForm,
        submittedAt:   s.submittedAt,
        tpCount:       s.tpPreview?.length || 0,
        openHintCount: _computeOpenHints(s).length
      }));
  });

  srv.on('getOpenHints', (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    return _computeOpenHints(session);
  });
```

- [ ] **Step 5: Run all tests — expect PASS**

```bash
cd "assets/tp-wizard-cap" && npx jest test/ --no-coverage
```
Expected: All tests PASS (both files)

- [ ] **Step 6: Commit**

```bash
git add assets/tp-wizard-cap/srv/wizard-service.cds assets/tp-wizard-cap/srv/wizard-service.js assets/tp-wizard-cap/test/wizard-service.test.js
git commit -m "feat(cap): add listPendingSessions and getOpenHints with shared hint helper"
```

---

## Task 6: app-field — Scaffolding, Entry Screen & Session Hook

**Files:**
- Create: `assets/tp-wizard-cap/app-field/package.json`
- Create: `assets/tp-wizard-cap/app-field/vite.config.js`
- Create: `assets/tp-wizard-cap/app-field/index.html`
- Create: `assets/tp-wizard-cap/app-field/src/main.jsx`
- Create: `assets/tp-wizard-cap/app-field/src/hooks/useAgentSession.js`
- Create: `assets/tp-wizard-cap/app-field/src/App.jsx`

**Interfaces:**
- Produces: `useAgentSession()` hook with `{ sessionId, messages, tpPreview, status, error, start, sendAnswer, submit, addAgentMessage }`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tp-wizard-field",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@ui5/webcomponents": "^2",
    "@ui5/webcomponents-fiori": "^2",
    "@ui5/webcomponents-react": "^2",
    "axios": "^1",
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4",
    "vite": "^5"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd "assets/tp-wizard-cap/app-field" && npm install
```
Expected: `node_modules/` created, no errors

- [ ] **Step 3: Create `vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/wizard': 'http://localhost:4004' }
  }
});
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TP-Wizard — Felderfassung</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/main.jsx`**

```jsx
import '@ui5/webcomponents/dist/Assets.js';
import '@ui5/webcomponents-fiori/dist/Assets.js';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

setTheme('sap_horizon');
document.body.classList.add('sapUiSizeCozy'); // touch-friendly 44px tap targets on mobile
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

- [ ] **Step 6: Create `src/hooks/useAgentSession.js`**

```js
import { useState, useCallback } from 'react';
import axios from 'axios';

const BASE = '/wizard';

export function useAgentSession() {
  const [sessionId, setSessionId]   = useState(null);
  const [messages, setMessages]     = useState([]);
  const [tpPreview, setTpPreview]   = useState([]);
  const [pendingQ, setPendingQ]     = useState(null); // current question waiting for answer
  const [status, setStatus]         = useState('idle'); // idle|loading|active|all-answered|submitting|submitted|error
  const [error, setError]           = useState(null);

  const addMsg = (role, text) =>
    setMessages(prev => [...prev, { role, text, id: crypto.randomUUID() }]);

  const start = useCallback(async ({ ds100, switchNumber, basicForm }) => {
    setStatus('loading');
    setError(null);
    try {
      // 1. Create session
      const { data: sess } = await axios.post(`${BASE}/createSession`, { ds100, switchNumber, basicForm });
      const sid = sess.sessionId;
      setSessionId(sid);

      // 2. Load smart defaults
      const { data: defaultsResp } = await axios.get(`${BASE}/getSmartDefaults(basicForm='${basicForm}')`);
      const defaults = defaultsResp.value ?? defaultsResp;

      // 3. Auto-apply high-confidence defaults
      const highConf = defaults.filter(d => d.confidence === 'high');
      for (const d of highConf) {
        await axios.post(`${BASE}/submitAnswer`, {
          sessionId: sid, questionId: d.questionId, answer: d.defaultAnswer, source: 'agent-default'
        });
      }

      // 4. Build intro message
      const medConf = defaults.filter(d => d.confidence === 'medium');
      const lines = [...highConf, ...medConf].map(d => `• ${d.rationale}`).join('\n');
      addMsg('agent',
        `Hallo! Ich habe die Standardkonfiguration für **${basicForm}** geladen.\n\n` +
        `Folgende Werte wurden automatisch gesetzt:\n${lines}\n\n` +
        `Gibt es bei dieser Weiche Besonderheiten, die davon abweichen?`
      );

      // 5. Get first open question
      const { data: nextQResp } = await axios.get(`${BASE}/getNextQuestion(sessionId='${sid}')`);
      const nextQ = typeof nextQResp === 'string' ? JSON.parse(nextQResp) : nextQResp;
      if (nextQ) {
        setPendingQ(nextQ);
        addMsg('agent', nextQ.text);
      } else {
        setStatus('all-answered');
        addMsg('agent', 'Alle Fragen wurden beantwortet. Bitte bestätige die Einreichung.');
      }

      setStatus('active');
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
      setStatus('error');
    }
  }, []);

  const sendAnswer = useCallback(async (text) => {
    if (!pendingQ || !sessionId) return;
    addMsg('katrin', text);

    // Map text → answer value (simple keyword matching for demo; full NLP done by Python agent)
    const answer = text.trim();

    try {
      const { data } = await axios.post(`${BASE}/submitAnswer`, {
        sessionId,
        questionId: pendingQ.id,
        answer,
        source: 'katrin-confirmed'
      });

      const preview = typeof data.tpPreview === 'string' ? JSON.parse(data.tpPreview) : data.tpPreview;
      if (preview) setTpPreview(preview);

      addMsg('agent', `✓ Verstanden. Bisher ${preview?.length ?? 0} Technische Plätze erkannt.`);

      const nextQ = typeof data.nextQuestion === 'string' ? JSON.parse(data.nextQuestion) : data.nextQuestion;
      if (nextQ) {
        setPendingQ(nextQ);
        addMsg('agent', nextQ.text);
      } else {
        setPendingQ(null);
        setStatus('all-answered');
        addMsg('agent', 'Alle Angaben vollständig. Soll ich die Einreichung zur Freigabe weiterleiten?');
      }
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
    }
  }, [pendingQ, sessionId]);

  const submit = useCallback(async () => {
    setStatus('submitting');
    try {
      await axios.post(`${BASE}/submitSession`, { sessionId });
      addMsg('agent', `✅ Einreichung weitergeleitet. Referenz: ${sessionId}`);
      setStatus('submitted');
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
      setStatus('error');
    }
  }, [sessionId]);

  return { sessionId, messages, tpPreview, status, error, start, sendAnswer, submit, addMsg };
}
```

- [ ] **Step 7: Create skeleton `src/App.jsx`**

```jsx
import React, { useState } from 'react';
import {
  ShellBar, Button, Card, CardHeader,
  Form, FormGroup, FormItem,
  Input, Select, Option, Label, MessageStrip
} from '@ui5/webcomponents-react';
import { useAgentSession } from './hooks/useAgentSession.js';

const BASIC_FORMS = [
  { value: 'EWL', label: 'Einfache Weiche links' },
  { value: 'EWR', label: 'Einfache Weiche rechts' },
  { value: 'DKW', label: 'Doppelte Kreuzungsweiche' },
  { value: 'EKW', label: 'Einfache Kreuzungsweiche' },
  { value: 'IBW', label: 'Innenbogenweiche' },
  { value: 'DW',  label: 'Dreiwegweiche' },
  { value: 'ABW', label: 'Außenbogenweiche' },
];

export default function App() {
  const { sessionId, messages, tpPreview, status, error, start, sendAnswer, submit } = useAgentSession();
  const [ds100, setDs100]         = useState('');
  const [switchNum, setSwitchNum] = useState('');
  const [basicForm, setBasicForm] = useState('EWL');

  if (status === 'idle' || status === 'error') {
    return (
      <>
        <ShellBar primaryTitle="TP-Wizard" secondaryTitle="Felderfassung" />
        <Card
          header={<CardHeader titleText="Neue Weiche erfassen" />}
          style={{ maxWidth: 480, margin: '2rem auto' }}
        >
          {error && (
            <MessageStrip design="Negative" hideCloseButton style={{ margin: '1rem 1rem 0' }}>
              {error}
            </MessageStrip>
          )}
          <Form
            columnsXL={1} columnsL={1} columnsM={1}
            labelSpanXL={4} labelSpanL={4} labelSpanM={4}
            style={{ padding: '1rem' }}
          >
            <FormGroup headerText="Standort & Typ">
              <FormItem label={<Label required showColon>Betriebsstelle (DS100)</Label>}>
                <Input placeholder="z.B. NI" value={ds100} onInput={e => setDs100(e.target.value)} />
              </FormItem>
              <FormItem label={<Label required showColon>Weichennummer</Label>}>
                <Input placeholder="z.B. 2006" value={switchNum} onInput={e => setSwitchNum(e.target.value)} />
              </FormItem>
              <FormItem label={<Label required showColon>Grundbauform</Label>}>
                <Select onChange={e => setBasicForm(e.detail.selectedOption.getAttribute('data-value'))}>
                  {BASIC_FORMS.map(bf => (
                    <Option key={bf.value} data-value={bf.value}>{bf.label}</Option>
                  ))}
                </Select>
              </FormItem>
            </FormGroup>
          </Form>
          <div style={{ padding: '0 1rem 1.5rem' }}>
            <Button
              design="Emphasized"
              disabled={!ds100 || !switchNum}
              style={{ width: '100%' }}
              onClick={() => start({ ds100, switchNumber: switchNum, basicForm })}
            >
              Erfassung starten
            </Button>
          </div>
        </Card>
      </>
    );
  }

  // Placeholder — replaced in Task 7
  return (
    <>
      <ShellBar primaryTitle="TP-Wizard" secondaryTitle="Felderfassung" />
      <p style={{ padding: '2rem' }}>Status: {status} | Session: {sessionId}</p>
    </>
  );
}
```

- [ ] **Step 8: Start dev server and verify entry screen renders**

Make sure CAP is running (`cd assets/tp-wizard-cap && npm start &`), then:

```bash
cd "assets/tp-wizard-cap/app-field" && npm run dev &
```

Open `http://localhost:5174`. Verify the entry screen with DS100, Weichennummer, Grundbauform fields and "Erfassung starten" button appears. Check browser console for errors.

- [ ] **Step 9: Commit**

```bash
git add assets/tp-wizard-cap/app-field/
git commit -m "feat(app-field): scaffold Vite app with entry screen and useAgentSession hook"
```

---

## Task 7: app-field — Chat Interface, Voice Input & TP Preview

**Files:**
- Create: `assets/tp-wizard-cap/app-field/src/components/ChatThread.jsx`
- Create: `assets/tp-wizard-cap/app-field/src/components/MessageInput.jsx`
- Create: `assets/tp-wizard-cap/app-field/src/components/TPPreviewSheet.jsx`
- Create: `assets/tp-wizard-cap/app-field/src/components/SubmitSummary.jsx`
- Modify: `assets/tp-wizard-cap/app-field/src/App.jsx` — wire chat screen and submit flow

**Interfaces:**
- Consumes: `useAgentSession` from Task 6
- Produces: fully functional chat screen visible to user

- [ ] **Step 1: Create `src/components/ChatThread.jsx`**

Use `Avatar` for the agent identity and CSS design tokens for all colors — never hardcode hex values in Fiori apps.

```jsx
import React, { useEffect, useRef } from 'react';
import { FlexBox, Avatar, Text, BusyIndicator } from '@ui5/webcomponents-react';

export function ChatThread({ messages, awaitingResponse }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, awaitingResponse]);

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      background: 'var(--sapBackgroundColor)'
    }}>
      {messages.map(msg =>
        msg.role === 'agent' ? (
          // Agent message: left-aligned, neutral background, Avatar with AI initials
          <FlexBox key={msg.id} alignItems="FlexStart" style={{ gap: '0.5rem' }}>
            <Avatar initials="AI" colorScheme="Accent6" size="XS" shape="Circle" style={{ flexShrink: 0 }} />
            <div style={{
              background: 'var(--sapNeutralBackground)',
              border: '1px solid var(--sapNeutralBorderColor)',
              borderRadius: '0 0.5rem 0.5rem 0.5rem',
              padding: '0.625rem 0.875rem',
              maxWidth: '75%'
            }}>
              <Text renderWhitespace wrapping style={{ fontSize: 'var(--sapFontSize)' }}>{msg.text}</Text>
            </div>
          </FlexBox>
        ) : (
          // Katrin message: right-aligned, highlight color background
          <FlexBox key={msg.id} justifyContent="FlexEnd">
            <div style={{
              background: 'var(--sapHighlightColor)',
              borderRadius: '0.5rem 0 0.5rem 0.5rem',
              padding: '0.625rem 0.875rem',
              maxWidth: '75%'
            }}>
              <Text renderWhitespace wrapping style={{
                fontSize: 'var(--sapFontSize)',
                color: 'var(--sapButton_Emphasized_TextColor)'
              }}>
                {msg.text}
              </Text>
            </div>
          </FlexBox>
        )
      )}
      {awaitingResponse && (
        <FlexBox alignItems="FlexStart" style={{ gap: '0.5rem' }}>
          <Avatar initials="AI" colorScheme="Accent6" size="XS" shape="Circle" style={{ flexShrink: 0 }} />
          <div style={{
            background: 'var(--sapNeutralBackground)',
            border: '1px solid var(--sapNeutralBorderColor)',
            borderRadius: '0 0.5rem 0.5rem 0.5rem',
            padding: '0.75rem 1rem'
          }}>
            <BusyIndicator active size="S" />
          </div>
        </FlexBox>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/MessageInput.jsx`**

```jsx
import React, { useState, useRef } from 'react';
import { Button, Input } from '@ui5/webcomponents-react';

export function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const handleMic = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Spracherkennung wird in diesem Browser nicht unterstützt.');
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = 'de-DE';
    rec.continuous = false;
    rec.interimResults = false;
    recognitionRef.current = rec;

    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setText(transcript); // drop into field — user confirms before sending
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);

    rec.start();
    setListening(true);
  };

  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
      padding: '0.75rem',
      borderTop: '1px solid var(--sapGroup_TitleBorderColor)',
      background: 'var(--sapBaseColor)'
    }}>
      <Input
        style={{ flex: 1 }}
        placeholder={listening ? '🎙 Höre zu...' : 'Nachricht eingeben...'}
        value={text}
        onInput={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSend()}
        disabled={disabled}
      />
      <Button icon="microphone" design={listening ? 'Attention' : 'Default'} onClick={handleMic} />
      <Button design="Emphasized" icon="paper-plane" onClick={handleSend} disabled={disabled || !text.trim()} />
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/TPPreviewSheet.jsx`**

Use `Panel` for built-in Fiori collapse/expand and `ObjectStatus` for source colour coding. No hardcoded hex colours.

```jsx
import React from 'react';
import { Panel, FlexBox, ObjectStatus, Text } from '@ui5/webcomponents-react';

// Maps answer source to semantic ObjectStatus state
const SOURCE_STATE = {
  auto:               'None',
  'agent-default':    'Critical',
  'katrin-confirmed': 'Positive',
  'katrin-corrected': 'Information',
};
const SOURCE_LABEL = {
  auto:               'Auto',
  'agent-default':    'Agent',
  'katrin-confirmed': 'Bestätigt',
  'katrin-corrected': 'Korrigiert',
};

export function TPPreviewSheet({ tps }) {
  const count = tps?.length ?? 0;

  return (
    <Panel
      headerText={`TP-Vorschau — ${count} Technische Plätze`}
      collapsed
      style={{ borderTop: '2px solid var(--sapHighlightColor)' }}
    >
      {count === 0
        ? <Text style={{ padding: '0.75rem 1rem', color: 'var(--sapNeutralColor)' }}>
            Noch keine TPs abgeleitet.
          </Text>
        : <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {tps.map((tp, i) => (
              <FlexBox
                key={i}
                justifyContent="SpaceBetween"
                alignItems="Center"
                style={{
                  padding: '0.35rem 1rem',
                  borderBottom: '1px solid var(--sapGroup_TitleBorderColor)',
                  fontSize: 'var(--sapFontSmallSize)'
                }}
              >
                <Text style={{ fontSize: 'inherit', color: 'var(--sapTextColor)' }}>
                  {tp.tpLabel || tp.tpKey}
                </Text>
                <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
                  <Text style={{ fontSize: 'var(--sapFontSmallSize)', color: 'var(--sapNeutralColor)' }}>
                    Bereich {tp.area}
                  </Text>
                  {tp.source && (
                    <ObjectStatus
                      state={SOURCE_STATE[tp.source] ?? 'None'}
                      style={{ fontSize: 'var(--sapFontSmallSize)' }}
                    >
                      {SOURCE_LABEL[tp.source] ?? tp.source}
                    </ObjectStatus>
                  )}
                </FlexBox>
              </FlexBox>
            ))}
          </div>
      }
    </Panel>
  );
}
```

- [ ] **Step 4: Create `src/components/SubmitSummary.jsx`**

```jsx
import React from 'react';
import { Button, Title, FlexBox } from '@ui5/webcomponents-react';

export function SubmitSummary({ tpCount, sessionId, onConfirm, onBack, submitting }) {
  return (
    <div style={{ padding: '2rem', maxWidth: 480, margin: '0 auto' }}>
      <Title level="H4">Einreichung bestätigen</Title>
      <p style={{ marginTop: '1rem' }}>
        Es werden <strong>{tpCount} Technische Plätze</strong> zur Freigabe an den Technischen Verantwortlichen weitergeleitet.
      </p>
      <p style={{ color: 'var(--sapNeutralColor)', fontSize: 'var(--sapFontSmallSize)' }}>
        Referenz: {sessionId}
      </p>
      <FlexBox style={{ gap: '1rem', marginTop: '2rem' }}>
        <Button design="Emphasized" onClick={onConfirm} disabled={submitting}>
          {submitting ? 'Wird eingereicht...' : 'Zur Freigabe einreichen'}
        </Button>
        <Button onClick={onBack} disabled={submitting}>Zurück</Button>
      </FlexBox>
    </div>
  );
}
```

- [ ] **Step 5: Replace placeholder in `src/App.jsx` with full chat screen**

Replace everything after the entry screen `return` (the `// Placeholder` section):

```jsx
  if (status === 'submitted') {
    return (
      <>
        <ShellBar primaryTitle="TP-Wizard" secondaryTitle="Felderfassung" />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100vh - 44px)',
          padding: '2rem'
        }}>
          <IllustratedMessage
            name="SuccessScreen"
            titleText="Einreichung weitergeleitet"
            subtitleText={`Referenz: ${sessionId} — Der Technische Verantwortliche prüft und gibt frei.`}
          />
          <Button style={{ marginTop: '1.5rem' }} onClick={() => window.location.reload()}>
            Neue Weiche erfassen
          </Button>
        </div>
      </>
    );
  }

  const showSubmitSummary = status === 'all-answered';

  return (
    <>
      <ShellBar primaryTitle={`TP-Wizard — ${ds100 || ''} W${switchNum || ''}`} secondaryTitle="Felderfassung" />
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 44px)' }}>
        {error && (
          <MessageStrip design="Negative" hideCloseButton style={{ margin: '0.5rem 1rem 0' }}>
            {error}
          </MessageStrip>
        )}
        {showSubmitSummary
          ? <SubmitSummary
              tpCount={tpPreview.length}
              sessionId={sessionId}
              onConfirm={submit}
              onBack={() => {/* allow back by resetting status — handled in hook */ }}
              submitting={status === 'submitting'}
            />
          : <>
              <ChatThread messages={messages} awaitingResponse={status === 'loading'} />
              <TPPreviewSheet tps={tpPreview} />
              <MessageInput onSend={sendAnswer} disabled={status !== 'active'} />
            </>
        }
      </div>
    </>
  );
```

Add the missing imports at the top of `App.jsx`:
```jsx
import { IllustratedMessage } from '@ui5/webcomponents-react';
import { ChatThread }    from './components/ChatThread.jsx';
import { MessageInput }  from './components/MessageInput.jsx';
import { TPPreviewSheet } from './components/TPPreviewSheet.jsx';
import { SubmitSummary } from './components/SubmitSummary.jsx';
```

- [ ] **Step 6: Manual smoke test — full Katrin flow**

1. Ensure CAP is running on port 4004
2. Open `http://localhost:5174`
3. Fill DS100="NI", Weichennummer="2006", Grundbauform="EWL"
4. Click "Erfassung starten"
5. Verify agent intro message appears with standard config list
6. Type an answer (e.g. "0") and press Enter or Send
7. Verify answer appears in thread and agent responds with TP count
8. Click microphone, speak a word, verify transcript lands in input field (no auto-send)
9. Click "▲ TP-Vorschau" — verify TP list expands
10. Continue until "all-answered" state, verify summary screen
11. Click "Zur Freigabe einreichen" — verify success screen

- [ ] **Step 7: Commit**

```bash
git add assets/tp-wizard-cap/app-field/src/
git commit -m "feat(app-field): add chat interface, voice input, TP preview sheet, submit flow"
```

---

## Task 8: app-approve — Scaffolding & List Report

**Files:**
- Create: `assets/tp-wizard-cap/app-approve/package.json`, `vite.config.js`, `index.html`, `src/main.jsx`
- Create: `assets/tp-wizard-cap/app-approve/src/App.jsx`
- Create: `assets/tp-wizard-cap/app-approve/src/hooks/useApprovalSessions.js`
- Create: `assets/tp-wizard-cap/app-approve/src/components/SessionListReport.jsx`

**Interfaces:**
- Produces: `useApprovalSessions()` hook; `SessionListReport` renders pending sessions table

- [ ] **Step 1: Create `package.json` (same deps as app-field, port 5175)**

```json
{
  "name": "tp-wizard-approve",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@ui5/webcomponents": "^2",
    "@ui5/webcomponents-fiori": "^2",
    "@ui5/webcomponents-react": "^2",
    "axios": "^1",
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4",
    "vite": "^5"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd "assets/tp-wizard-cap/app-approve" && npm install
```

- [ ] **Step 3: Create `vite.config.js` (port 5175)**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { '/wizard': 'http://localhost:4004' }
  }
});
```

- [ ] **Step 4: Create `index.html` and `src/main.jsx`**

`index.html`:
```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TP-Wizard — Freigabe</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

`src/main.jsx`:

```jsx
import '@ui5/webcomponents/dist/Assets.js';
import '@ui5/webcomponents-fiori/dist/Assets.js';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

setTheme('sap_horizon');
document.body.classList.add('sapUiSizeCompact'); // desktop: smaller spacing, 32px row height
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

- [ ] **Step 5: Create `src/hooks/useApprovalSessions.js`**

```js
import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';

const BASE = '/wizard';

export function useApprovalSessions() {
  const [sessions, setSessions]   = useState([]);
  const [selected, setSelected]   = useState(null); // { sessionId, hints, tpPreview, answers }
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${BASE}/listPendingSessions()`);
      setSessions(data.value ?? data);
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  const openSession = useCallback(async (sessionId) => {
    setLoading(true);
    try {
      const [hintsResp, previewResp] = await Promise.all([
        axios.get(`${BASE}/getOpenHints(sessionId='${sessionId}')`),
        axios.get(`${BASE}/getTPPreview(sessionId='${sessionId}')`)
      ]);
      const hints    = hintsResp.data.value ?? hintsResp.data;
      const preview  = typeof previewResp.data === 'string' ? JSON.parse(previewResp.data) : (previewResp.data.value ?? previewResp.data);
      setSelected({ sessionId, hints, tpPreview: preview });
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const editAnswer = useCallback(async (sessionId, questionId, answer) => {
    await axios.post(`${BASE}/editAnswer`, { sessionId, questionId, answer, source: 'thomas-edited' });
    await openSession(sessionId); // refresh hints + preview
  }, [openSession]);

  const approve = useCallback(async (sessionId) => {
    const { data } = await axios.post(`${BASE}/approveSession`, { sessionId });
    await refreshList();
    setSelected(null);
    return data;
  }, [refreshList]);

  return { sessions, selected, loading, error, refreshList, openSession, editAnswer, approve, back: () => setSelected(null) };
}
```

- [ ] **Step 6: Create `src/components/SessionListReport.jsx`**

Use `ObjectStatus` (not `Badge`) for semantically-correct status chips. Use `IllustratedMessage` for the empty state. Add a `FilterBar` for the Fiori List Report pattern.

```jsx
import React, { useState, useMemo } from 'react';
import {
  AnalyticalTable, ObjectStatus, BusyIndicator,
  FilterBar, FilterGroupItem, Select, Option,
  Title, Toolbar, ToolbarSpacer, Button, IllustratedMessage
} from '@ui5/webcomponents-react';

// Semantic states for session status — no hardcoded hex colours
const STATUS_STATE = {
  submitted: 'Information',
  editing:   'Critical',
  approved:  'Positive',
  created:   'Positive',
  failed:    'Negative',
};
const STATUS_LABEL_DE = {
  submitted: 'Eingereicht',
  editing:   'In Bearbeitung',
  approved:  'Freigegeben',
  created:   'Angelegt',
  failed:    'Fehlgeschlagen',
};

export function SessionListReport({ sessions, loading, onSelect, onRefresh }) {
  const [filterStatus, setFilterStatus] = useState('');

  const filtered = useMemo(() =>
    filterStatus
      ? sessions.filter(s => s.status === filterStatus)
      : sessions,
    [sessions, filterStatus]
  );

  const columns = [
    { Header: 'Betriebsstelle', accessor: 'ds100',         minWidth: 100 },
    { Header: 'Weiche',         accessor: 'switchNumber',  minWidth: 80  },
    { Header: 'Grundbauform',   accessor: 'basicFormLabel',minWidth: 160 },
    {
      Header: 'Eingereicht',
      accessor: 'submittedAt',
      minWidth: 140,
      Cell: ({ value }) => value ? new Date(value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—',
    },
    { Header: 'TPs', accessor: 'tpCount', minWidth: 60, hAlign: 'End' },
    {
      Header: 'Hinweise',
      accessor: 'openHintCount',
      minWidth: 100,
      Cell: ({ value }) => (
        <ObjectStatus state={value > 0 ? 'Critical' : 'Positive'} inverted>
          {value > 0 ? `${value} offen` : 'Geprüft'}
        </ObjectStatus>
      ),
    },
    {
      Header: 'Status',
      accessor: 'status',
      minWidth: 130,
      Cell: ({ value }) => (
        <ObjectStatus state={STATUS_STATE[value] ?? 'None'} inverted>
          {STATUS_LABEL_DE[value] ?? value}
        </ObjectStatus>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <FilterBar
        onGo={() => {}} // filtering is client-side via useMemo
        showGoOnFT
        style={{ padding: '0.5rem 1rem' }}
      >
        <FilterGroupItem label="Status" groupName="Filter">
          <Select onChange={e => setFilterStatus(e.detail.selectedOption.getAttribute('data-value') ?? '')}>
            <Option data-value="">Alle</Option>
            <Option data-value="submitted">Eingereicht</Option>
            <Option data-value="editing">In Bearbeitung</Option>
          </Select>
        </FilterGroupItem>
      </FilterBar>

      <Toolbar style={{ padding: '0 1rem' }}>
        <Title level="H4">Ausstehende Einreichungen ({filtered.length})</Title>
        <ToolbarSpacer />
        <Button icon="refresh" design="Transparent" onClick={onRefresh} tooltip="Aktualisieren" />
      </Toolbar>

      {loading && filtered.length === 0
        ? <BusyIndicator active size="L" style={{ margin: '4rem auto', display: 'block' }} />
        : filtered.length === 0
          ? <IllustratedMessage
              name="NoData"
              titleText="Keine ausstehenden Einreichungen"
              subtitleText="Wenn Katrin eine Weiche erfasst und einreicht, erscheint sie hier."
            />
          : <AnalyticalTable
              columns={columns}
              data={filtered}
              onRowClick={e => onSelect(e.detail.row.original.sessionId)}
              minRows={1}
              rowHeight={44}
              style={{ flex: 1 }}
            />
      }
    </div>
  );
}
```

- [ ] **Step 7: Create `src/App.jsx`**

```jsx
import React from 'react';
import { ShellBar, Button, MessageStrip } from '@ui5/webcomponents-react';
import { useApprovalSessions } from './hooks/useApprovalSessions.js';
import { SessionListReport } from './components/SessionListReport.jsx';

export default function App() {
  const { sessions, selected, loading, error, refreshList, openSession, editAnswer, approve, back } = useApprovalSessions();

  return (
    <>
      <ShellBar
        primaryTitle="TP-Wizard — Freigabe"
        secondaryTitle="DB InfraGO"
      >
        <Button slot="endContent" icon="refresh" onClick={refreshList} />
      </ShellBar>
      {error && (
        <MessageStrip design="Negative" hideCloseButton style={{ margin: '0.5rem 1rem' }}>
          {error}
        </MessageStrip>
      )}
      {!selected
        ? <SessionListReport sessions={sessions} loading={loading} onSelect={openSession} onRefresh={refreshList} />
        : <div style={{ padding: '1rem' }}>Object Page placeholder — SessionId: {selected.sessionId}</div>
      }
    </>
  );
}
```

- [ ] **Step 8: Start and verify list report**

```bash
cd "assets/tp-wizard-cap/app-approve" && npm run dev &
```

1. Open `http://localhost:5175`
2. Submit a session via app-field or via curl: `curl -X POST http://localhost:4004/wizard/submitSession -H "Content-Type: application/json" -d '{"sessionId":"<id from createSession>"}'`
3. Refresh the approve UI — row should appear in the table
4. Verify Hinweise badge shows correct count

- [ ] **Step 9: Commit**

```bash
git add assets/tp-wizard-cap/app-approve/
git commit -m "feat(app-approve): scaffold Vite app with List Report and useApprovalSessions hook"
```

---

## Task 9: app-approve — Object Page (Warning Strip, Edit Answers, Approve)

**Files:**
- Create: `assets/tp-wizard-cap/app-approve/src/components/SessionObjectPage.jsx`
- Create: `assets/tp-wizard-cap/app-approve/src/components/WarningStrip.jsx`
- Create: `assets/tp-wizard-cap/app-approve/src/components/AnswerSection.jsx`
- Create: `assets/tp-wizard-cap/app-approve/src/components/TPPreviewSection.jsx`
- Create: `assets/tp-wizard-cap/app-approve/src/components/ApproveDialog.jsx`
- Modify: `assets/tp-wizard-cap/app-approve/src/App.jsx` — replace placeholder

**Interfaces:**
- Consumes: `selected.hints`, `selected.tpPreview`, `editAnswer`, `approve` from `useApprovalSessions`
- Produces: full approval UI for Thomas

- [ ] **Step 1: Create `src/components/WarningStrip.jsx`**

```jsx
import React from 'react';
import { MessageStrip } from '@ui5/webcomponents-react';

export function WarningStrip({ hints }) {
  if (!hints || hints.length === 0) return null;
  const labels = hints.slice(0, 3).map(h => h.questionText).join(', ');
  const more   = hints.length > 3 ? ` (+${hints.length - 3} weitere)` : '';
  return (
    <MessageStrip design="Warning" style={{ margin: '1rem' }}>
      <strong>⚠ {hints.length} Agentannahmen nicht geprüft</strong> — {labels}{more}.
      Bitte prüfen bevor du freigibst.
    </MessageStrip>
  );
}
```

- [ ] **Step 2: Create `src/components/AnswerSection.jsx`**

Use `ObjectStatus` (not `Badge`) for source chips and SAP CSS design tokens for all row colors — never hardcode hex values.

```jsx
import React, { useState } from 'react';
import { Title, Input, Button, ObjectStatus, Panel, FlexBox, Text } from '@ui5/webcomponents-react';

// Maps answer source to semantic ObjectStatus state — no hex colours
const SOURCE_STATE = {
  auto:               'None',
  'agent-default':    'Critical',
  'katrin-confirmed': 'Positive',
  'katrin-corrected': 'Information',
  'thomas-edited':    'None',
};
const SOURCE_LABEL = {
  auto:               'AUTO',
  'agent-default':    'AGENT-STANDARD',
  'katrin-confirmed': 'BESTÄTIGT',
  'katrin-corrected': 'KORRIGIERT',
  'thomas-edited':    'THOMAS',
};

function AnswerRow({ answer, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(answer.answer ?? '');
  const highlight = answer.source === 'agent-default';

  const save = () => { onEdit(answer.questionId, val); setEditing(false); };

  return (
    <FlexBox alignItems="Center" style={{
      padding: '0.4rem 1rem',
      borderLeft: highlight ? '3px solid var(--sapCriticalColor)' : '3px solid transparent',
      background: highlight ? 'var(--sapCriticalBackground)' : 'var(--sapBaseColor)',
      borderBottom: '1px solid var(--sapGroup_TitleBorderColor)',
      gap: '0.5rem'
    }}>
      <Text style={{ flex: 2, fontSize: 'var(--sapFontSmallSize)', color: 'var(--sapTextColor)' }}>
        {answer.questionText || answer.questionId}
      </Text>
      {editing
        ? <>
            <Input value={val} onInput={e => setVal(e.target.value)} style={{ flex: 1 }} />
            <Button design="Emphasized" onClick={save}>Speichern</Button>
            <Button onClick={() => setEditing(false)}>Abbrechen</Button>
          </>
        : <>
            <Text style={{ flex: 1, fontSize: 'var(--sapFontSmallSize)', fontWeight: 'bold', color: 'var(--sapTextColor)' }}>
              {answer.answer ?? '—'}
            </Text>
            <ObjectStatus
              state={SOURCE_STATE[answer.source] ?? 'None'}
              inverted
              style={{ fontSize: 'var(--sapFontSmallSize)' }}
            >
              {SOURCE_LABEL[answer.source] ?? answer.source}
            </ObjectStatus>
            <Button icon="edit" design="Transparent" onClick={() => setEditing(true)} />
          </>
      }
    </FlexBox>
  );
}

export function AnswerSection({ session, onEdit }) {
  if (!session?.answers) return null;
  // Group by area
  const byArea = {};
  for (const a of session.answers) {
    const key = `${a.area || 0}_${a.areaName || ''}`;
    if (!byArea[key]) byArea[key] = { area: a.area, areaName: a.areaName, answers: [] };
    byArea[key].answers.push(a);
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <Title level="H5" style={{ padding: '0 1rem' }}>Antworten</Title>
      {Object.values(byArea).map(group => (
        <Panel
          key={group.area}
          headerText={`Bereich ${group.area}: ${group.areaName}`}
          style={{ marginTop: '0.5rem' }}
        >
          {group.answers.map(a => (
            <AnswerRow key={a.questionId} answer={a} onEdit={(qId, val) => onEdit(session.sessionId, qId, val)} />
          ))}
        </Panel>
      ))}
    </div>
  );
}
```

Note: `session.answers` is not directly available from `useApprovalSessions` yet — it returns `hints` and `tpPreview`. For the Object Page, we need the full answers. Update `openSession` in the hook to also fetch answers via a CAP entity read in the next step.

- [ ] **Step 3: Update `useApprovalSessions.js` to include answers**

In `openSession`, add a fetch for the session's answers via the `Sessions` entity projection:

```js
// In openSession, after hintsResp + previewResp:
const sessResp = await axios.get(`${BASE}/Sessions('${sessionId}')`);
const sessData = sessResp.data;
const answersRaw = JSON.parse(sessData.answersJson || '[]');

// Enrich answers with question text from wizard-questions (done server-side via getOpenHints structure)
// Use hints to build a lookup: for agent-default answers we already have questionText
const hintMap = {};
for (const h of hints) hintMap[h.questionId] = h;

const answers = answersRaw.map(a => ({
  ...a,
  questionText: hintMap[a.questionId]?.questionText || a.questionId,
  area:         hintMap[a.questionId]?.area || 0,
  areaName:     hintMap[a.questionId]?.areaName || '',
}));

setSelected({ sessionId, hints, tpPreview: preview, answers });
```

Note: This requires the CAP `Sessions` entity to be readable. Verify `Sessions` is exposed in `wizard-service.cds` as `@readonly entity Sessions as projection on wizard.WizardSession` — it already is.

- [ ] **Step 4: Create `src/components/TPPreviewSection.jsx`**

Use `Panel` for built-in Fiori collapse/expand and SAP CSS design tokens for all table colors.

```jsx
import React from 'react';
import { Title, Panel, Text } from '@ui5/webcomponents-react';

export function TPPreviewSection({ tps }) {
  if (!tps || tps.length === 0) return (
    <Text style={{ padding: '1rem', color: 'var(--sapNeutralColor)' }}>Keine TPs abgeleitet.</Text>
  );

  const byArea = {};
  for (const tp of tps) {
    const key = tp.area ?? 0;
    if (!byArea[key]) byArea[key] = { area: key, areaName: tp.areaName || `Bereich ${key}`, tps: [] };
    byArea[key].tps.push(tp);
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <Title level="H5" style={{ padding: '0 1rem' }}>TP-Vorschau ({tps.length} TPs)</Title>
      {Object.values(byArea).sort((a, b) => a.area - b.area).map(group => (
        <Panel
          key={group.area}
          headerText={`${group.areaName} (${group.tps.length})`}
          collapsed
          style={{ marginTop: '0.5rem' }}
        >
          <table style={{ width: '100%', fontSize: 'var(--sapFontSmallSize)', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--sapList_HeaderBackground)' }}>
                <th style={{ padding: '0.3rem 1rem', textAlign: 'left', color: 'var(--sapList_HeaderTextColor)' }}>PosNr</th>
                <th style={{ padding: '0.3rem 1rem', textAlign: 'left', color: 'var(--sapList_HeaderTextColor)' }}>Bezeichnung</th>
                <th style={{ padding: '0.3rem 1rem', textAlign: 'left', color: 'var(--sapList_HeaderTextColor)' }}>TP-Schlüssel</th>
              </tr>
            </thead>
            <tbody>
              {group.tps.map((tp, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--sapList_BorderColor)' }}>
                  <td style={{ padding: '0.3rem 1rem', color: 'var(--sapTextColor)' }}>{tp.posNr}</td>
                  <td style={{ padding: '0.3rem 1rem', color: 'var(--sapTextColor)' }}>{tp.tpLabel}</td>
                  <td style={{ padding: '0.3rem 1rem', fontFamily: 'monospace', color: 'var(--sapNeutralColor)' }}>{tp.tpKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/ApproveDialog.jsx`**

Use `MessageStrip` for the unconfirmed-count warning — never hardcode `color: '#e67e00'`.

```jsx
import React from 'react';
import { Dialog, Button, Title, Bar, MessageStrip } from '@ui5/webcomponents-react';

export function ApproveDialog({ open, tpCount, unconfirmedCount, onConfirm, onCancel, approving }) {
  return (
    <Dialog open={open} header={<Bar><Title>Freigabe bestätigen</Title></Bar>}
            footer={
              <Bar endContent={
                <>
                  <Button onClick={onCancel} disabled={approving}>Abbrechen</Button>
                  <Button design="Emphasized" onClick={onConfirm} disabled={approving}>
                    {approving ? 'Wird freigegeben...' : 'Freigeben'}
                  </Button>
                </>
              } />
            }>
      <div style={{ padding: '1rem', maxWidth: 400 }}>
        <p><strong>{tpCount} Technische Plätze</strong> werden in SAP S/4HANA angelegt.</p>
        {unconfirmedCount > 0 && (
          <MessageStrip design="Warning" hideCloseButton style={{ marginTop: '0.5rem' }}>
            Davon basieren <strong>{unconfirmedCount} Einträge</strong> auf Agentannahmen, die nicht explizit von Katrin bestätigt wurden.
          </MessageStrip>
        )}
        <MessageStrip design="Information" hideCloseButton style={{ marginTop: '1rem' }}>
          Diese Aktion kann nicht rückgängig gemacht werden.
        </MessageStrip>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 6: Create `src/components/SessionObjectPage.jsx`**

Use the full Fiori `ObjectPage` pattern: `ObjectPage` + `DynamicPageTitle` (title, subheader, action bar) + `DynamicPageHeader` (key figures) + `ObjectPageSection` / `ObjectPageSubSection` for the two content sections. This matches the SAP Fiori Object Page floorplan exactly — no custom div-based header.

```jsx
import React, { useState } from 'react';
import {
  ObjectPage, DynamicPageTitle, DynamicPageHeader,
  ObjectPageSection, ObjectPageSubSection,
  Button, Title, FlexBox, ObjectStatus,
  BusyIndicator, MessageStrip
} from '@ui5/webcomponents-react';
import { WarningStrip }     from './WarningStrip.jsx';
import { AnswerSection }    from './AnswerSection.jsx';
import { TPPreviewSection } from './TPPreviewSection.jsx';
import { ApproveDialog }    from './ApproveDialog.jsx';

const STATUS_STATE = {
  submitted: 'Information',
  editing:   'Critical',
  approved:  'Positive',
  created:   'Positive',
  failed:    'Negative',
};
const STATUS_LABEL_DE = {
  submitted: 'Eingereicht',
  editing:   'In Bearbeitung',
  approved:  'Freigegeben',
  created:   'Angelegt',
  failed:    'Fehlgeschlagen',
};

export function SessionObjectPage({ selected, onEdit, onApprove, onBack, loading }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [approving, setApproving]   = useState(false);
  const [result, setResult]         = useState(null);

  if (loading || !selected) {
    return <BusyIndicator active size="L" style={{ margin: '4rem auto', display: 'block' }} />;
  }

  const { sessionId, hints, tpPreview, answers, status, ds100, switchNumber, basicFormLabel } = selected;
  const unconfirmedCount = hints?.length ?? 0;

  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await onApprove(sessionId);
      setResult(res);
      setDialogOpen(false);
    } finally {
      setApproving(false);
    }
  };

  if (result) {
    const created = JSON.parse(result.created || '[]');
    const failed  = JSON.parse(result.failed  || '[]');
    return (
      <div style={{ padding: '2rem' }}>
        <MessageStrip design={failed.length === 0 ? 'Positive' : 'Warning'}>
          {failed.length === 0
            ? `${created.length} Technische Plätze erfolgreich angelegt.`
            : `${created.length} angelegt, ${failed.length} fehlgeschlagen.`}
        </MessageStrip>
        <Button style={{ marginTop: '1rem' }} onClick={onBack}>Zurück zur Liste</Button>
      </div>
    );
  }

  return (
    <>
      <ObjectPage
        headerTitle={
          <DynamicPageTitle
            header={<Title level="H3">{ds100} W{switchNumber} — {basicFormLabel}</Title>}
            subHeader={
              <FlexBox style={{ gap: '0.5rem', alignItems: 'center' }}>
                {status && (
                  <ObjectStatus state={STATUS_STATE[status] ?? 'None'} inverted>
                    {STATUS_LABEL_DE[status] ?? status}
                  </ObjectStatus>
                )}
                {unconfirmedCount > 0 && (
                  <ObjectStatus state="Critical" inverted>
                    {unconfirmedCount} Agentannahmen
                  </ObjectStatus>
                )}
              </FlexBox>
            }
            actionsBar={
              <FlexBox style={{ gap: '0.5rem' }}>
                <Button design="Transparent" onClick={onBack}>Abbrechen</Button>
                <Button
                  design="Emphasized"
                  onClick={() => setDialogOpen(true)}
                  disabled={approving}
                >
                  Freigeben
                </Button>
              </FlexBox>
            }
          />
        }
        headerContent={
          <DynamicPageHeader>
            <FlexBox style={{ gap: '2rem', padding: '0.5rem 0', flexWrap: 'wrap' }}>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Title level="H6" style={{ color: 'var(--sapNeutralColor)' }}>Betriebsstelle</Title>
                <Title level="H5">{ds100}</Title>
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Title level="H6" style={{ color: 'var(--sapNeutralColor)' }}>Weichennummer</Title>
                <Title level="H5">{switchNumber}</Title>
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Title level="H6" style={{ color: 'var(--sapNeutralColor)' }}>Grundbauform</Title>
                <Title level="H5">{basicFormLabel}</Title>
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Title level="H6" style={{ color: 'var(--sapNeutralColor)' }}>Technische Plätze</Title>
                <Title level="H5">{tpPreview?.length ?? 0}</Title>
              </FlexBox>
            </FlexBox>
          </DynamicPageHeader>
        }
      >
        {/* Hinweise section — only shown when hints exist */}
        {unconfirmedCount > 0 && (
          <ObjectPageSection id="hinweise" titleText="Hinweise">
            <ObjectPageSubSection id="hinweise-detail" titleText="">
              <WarningStrip hints={hints} />
            </ObjectPageSubSection>
          </ObjectPageSection>
        )}

        <ObjectPageSection id="antworten" titleText="Antworten">
          <ObjectPageSubSection id="antworten-detail" titleText="">
            <AnswerSection session={{ sessionId, answers }} onEdit={onEdit} />
          </ObjectPageSubSection>
        </ObjectPageSection>

        <ObjectPageSection id="tp-vorschau" titleText={`TP-Vorschau (${tpPreview?.length ?? 0})`}>
          <ObjectPageSubSection id="tp-list" titleText="">
            <TPPreviewSection tps={tpPreview} />
          </ObjectPageSubSection>
        </ObjectPageSection>
      </ObjectPage>

      <ApproveDialog
        open={dialogOpen}
        tpCount={tpPreview?.length ?? 0}
        unconfirmedCount={unconfirmedCount}
        onConfirm={handleApprove}
        onCancel={() => setDialogOpen(false)}
        approving={approving}
      />
    </>
  );
}
```

- [ ] **Step 7: Update `src/App.jsx` to use SessionObjectPage**

Replace the `!selected` / `selected` branches:

```jsx
{!selected
  ? <SessionListReport sessions={sessions} loading={loading} onSelect={openSession} />
  : <SessionObjectPage
      selected={selected}
      loading={loading}
      onEdit={editAnswer}
      onApprove={approve}
      onBack={back}
    />
}
```

Add import at top: `import { SessionObjectPage } from './components/SessionObjectPage.jsx';`

- [ ] **Step 8: Manual smoke test — full Thomas flow**

1. Submit a session via app-field
2. Open `http://localhost:5175`
3. Verify session appears in list with correct Hinweise badge count
4. Click the row — Object Page opens
5. Verify Warning strip shows unreviewed hints
6. Click edit icon on an answer — inline edit appears, save works
7. Click "Freigeben" — dialog shows TP count and unconfirmed count
8. Click "Freigeben" in dialog — SAP mock creates TPs, result screen shows count
9. Return to list — session no longer appears (status = created)

- [ ] **Step 9: Commit**

```bash
git add assets/tp-wizard-cap/app-approve/src/
git commit -m "feat(app-approve): add Object Page with warning strip, answer editing, and approve flow"
```

---

## Task 10: Agent — Smart Defaults Integration & submitSession Handoff

**Files:**
- Modify: `assets/tp-wizard-agent/app/agent.py` — update system prompt

**Interfaces:**
- Consumes: CAP `getSmartDefaults`, `submitAnswer` (with `source`), `submitSession`
- SKILL.md is already updated (Task 0 — done before this plan)

- [ ] **Step 1: Read current system prompt in `agent.py`**

```bash
grep -n "system_prompt\|Du bist\|WICHTIG\|MCP" "assets/tp-wizard-agent/app/agent.py" | head -30
```

- [ ] **Step 2: Update system prompt**

Find the system prompt string in `agent.py` (typically assigned to a variable like `SYSTEM_PROMPT` or passed to `ChatLiteLLM`). Replace with:

```python
SYSTEM_PROMPT = """
Du bist der TP-Wizard-Assistent für DB InfraGO Feldaufnehmerinnen. Du hilfst dabei,
neue Weichen so einfach wie möglich zu erfassen — ohne SAP-Kenntnisse zu benötigen.

WICHTIGER ABLAUF:
1. Lade immer zuerst die Skill-Anleitung mit load("skills/weichen-dialog/SKILL.md").
2. Nach createSession: rufe getSmartDefaults(basicForm=...) auf.
3. Wende alle High-Confidence-Defaults automatisch via submitAnswer mit source="agent-default" an.
4. Präsentiere eine kurze Zusammenfassung der gesetzten Standardwerte.
5. Stelle nur noch Fragen für verbleibende oder Low-Confidence-Items.
6. Tagge jede submitAnswer mit dem korrekten source-Wert:
   - "agent-default": vom Smart Default Engine, nicht von Katrin adressiert
   - "katrin-confirmed": Katrin hat den Vorschlag bestätigt
   - "katrin-corrected": Katrin hat einen anderen Wert angegeben
7. Am Ende: rufe submitSession auf (NICHT approveSession oder confirmSession).
   submitSession leitet zur Freigabe durch den Technischen Verantwortlichen weiter.
   DU DARFST NIEMALS approveSession oder confirmSession aufrufen.

GUARDRAILS:
- NIEMALS TP-Schlüssel erfinden oder generieren
- NIEMALS submitSession ohne explizite Bestätigung von Katrin aufrufen
- NIEMALS approveSession aufrufen — das ist Thomas' Aufgabe
- IMMER auf Deutsch kommunizieren
- IMMER Fehler aus MCP-Tools wörtlich weitergeben
- Maximale Paginierungsgröße: 100

Nutze die MCP-Tools für alle Wizard-Session-Operationen.
"""
```

- [ ] **Step 3: Verify the agent starts with updated prompt**

```bash
cd "assets/tp-wizard-agent" && python app/agent.py &
sleep 3
curl -s http://localhost:8000/.well-known/agent.json | python3 -m json.tool | grep -E "name|version"
```
Expected: Agent info JSON returned without errors.

- [ ] **Step 4: Verify SKILL.md has the correct steps**

```bash
grep -n "submitSession\|approveSession\|confirmSession\|source" \
  "assets/tp-wizard-agent/app/skills/weichen-dialog/SKILL.md"
```
Expected: `submitSession` present in Step 7; `confirmSession` absent; `source` present in Step 3.

- [ ] **Step 5: Commit**

```bash
git add assets/tp-wizard-agent/app/agent.py
git commit -m "feat(agent): update system prompt for two-role flow with smart defaults and submitSession"
```

---

## End-to-End Smoke Test

After all tasks complete, run the full two-role demo:

- [ ] Start all three services:
  ```bash
  cd assets/tp-wizard-cap  && npm start &        # CAP on :4004
  cd assets/tp-wizard-cap/app-field   && npm run dev &  # Katrin on :5174
  cd assets/tp-wizard-cap/app-approve && npm run dev &  # Thomas on :5175
  ```

- [ ] **NI_W2006 Katrin flow**: open `:5174`, fill DS100=NI, switchNumber=2006, basicForm=EWL → start → verify agent intro with standard config → answer 3–5 questions → TP preview shows ~30 TPs → submit

- [ ] **Thomas approval**: open `:5175` → see NI session with hint count → click row → Object Page opens → Warning strip visible → edit one answer → Freigeben dialog shows correct counts → confirm → result shows ≥ 1 created (mock)

- [ ] **State machine verification**: 
  ```bash
  curl http://localhost:4004/wizard/Sessions | node -e \
    "const d=require('fs').readFileSync('/dev/stdin','utf8');JSON.parse(d).value.forEach(s=>console.log(s.sessionId.slice(0,8),s.status))"
  ```
  Expected: last session shows `created`
