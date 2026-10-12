# Specification: tp-wizard-agent

> **Guidelines**: Read all applicable guidelines before executing ANY tasks below:
> - [../guidelines.md](../guidelines.md) — Universal execution rules
> - [../guidelines-agent.md](../guidelines-agent.md) — Universal agent patterns
> - [../guidelines-agent-python.md](../guidelines-agent-python.md) — Python implementation details
> - [../guidelines-agent-skills.md](../guidelines-agent-skills.md) — Runtime skills patterns
> - [../guidelines-agent-mcp.md](../guidelines-agent-mcp.md) — MCP integration patterns

**Scope:** This is the **primary interface for Feldaufnehmerin Katrin** — a Python AI Agent (A2A protocol) that acts as a natural-language dialog layer over the CAP rule engine. The agent uses a Smart Default Engine to pre-fill ~80–90% of answers from Standardkonfigurationen; Katrin only corrects deviations. The agent does **not** write to SAP — it calls `submitSession` to hand off to Thomas for approval. The CAP backend (`tp-wizard-cap`) must be complete and running before this agent can be built.

---

## Data Dependencies

- CAP Rule Engine API (internal, same solution): `createSession`, `getSmartDefaults`, `getNextQuestion`, `submitAnswer` (with `source` field), `getTPPreview`, `submitSession` (hands off to Thomas — no SAP write)
- API ORD ID for MCP translation: `sap.s4:apiResource:API_FUNCTIONALLOCATION:v1`
- API spec: `specification/tp-wizard-cap/api-specs/API_FUNCTIONALLOCATION.edmx`

> **Note:** The agent calls the CAP backend (not S/4HANA directly). The agent never calls `approveSession` or `confirmSession` — SAP writes are exclusively triggered by Thomas via the approval UI.

---

## Basic Setup

- [ ] Read `product-requirements-document.md` and `intent.md` for full context
- [ ] Bootstrap agent code in `assets/tp-wizard-agent/` using the `sap-agent-bootstrap` skill — invoke from inside `assets/tp-wizard-agent/`
- [ ] Install dependencies: `pip install -r requirements.txt`
- [ ] Validate the agent starts and responds at `/.well-known/agent.json`

---

## MCP Server for CAP Wizard API

> The agent must NOT call the CAP backend directly via HTTP. All interactions go through an MCP server.

- [ ] Invoke `mcp-translation-file` skill with the CAP wizard API to generate an MCP translation card:
  - API spec path: `specification/tp-wizard-cap/api-specs/API_FUNCTIONALLOCATION.edmx`
  - MCP server name: `tp-wizard-mcp-server`
  - Output: `specification/tp-wizard-agent/mcps/API_FUNCTIONALLOCATION/translation.json`
- [ ] Invoke `setup-solution` skill to create the MCP server asset from the translation file
- [ ] Read generated `assets/tp-wizard-mcp-server/asset.yaml` and copy the exact `ordId` value — use it verbatim in the agent's `asset.yaml` `requires` entry
- [ ] Add MCP server dependency to `assets/tp-wizard-agent/asset.yaml`:
  ```yaml
  requires:
    - name: tp-wizard-mcp-server
      kind: mcp-server
      ordId: <exact ordId from generated asset.yaml>
  ```

---

## Runtime Skills

> The TP-Wizard chatbot has complex domain-specific logic — runtime skills are appropriate here.

- [ ] Create `assets/tp-wizard-agent/app/skills/weichen-dialog/SKILL.md`:
  - YAML frontmatter: `name: weichen-dialog`, `description: Guided natural-language dialog for railway switch TP structure derivation`
  - Content: step-by-step instructions for the LLM on how to collect switch attributes conversationally
    - Step 1: Greet user, ask for Grundbauform (show list of choices)
    - Step 2: Ask for DS100 (Betriebsstelle) and Weichennummer
    - Step 3: For each required area (1–19), ask questions in German plain language — skip areas not relevant to stated Grundbauform
    - Step 4: Confirm collected attributes before calling rule engine
    - Step 5: Present TP preview grouped by area (Klartexte only, never raw TP keys)
    - Step 6: Ask for explicit Bestätigung before triggering SAP creation
    - Step 7: Report creation result; highlight open mandatory fields
  - Include decision guidance: "If user mentions Federwippe, immediately note Hz-beweglich branch will be triggered"
  - Include guardrail: "NEVER invent TP keys. NEVER bypass the rule engine. ALL TP derivation is done by the CAP backend."

- [ ] Create companion file `assets/tp-wizard-agent/app/skills/weichen-dialog/references/fragebereiche.md`:
  - List of 19 question areas with plain-language descriptions (for LLM context)
  - Note which areas are automatic (no user input needed)

- [ ] Create companion file `assets/tp-wizard-agent/app/skills/weichen-dialog/references/grundbauformen.md`:
  - List of supported Grundbauformen (EW links, EW rechts, DKW, etc.) with descriptions

---

## Project-Specific Tasks

### Agent Configuration

- [ ] Open `assets/tp-wizard-agent/app/agent.py` and configure system prompt:
  ```
  Du bist der TP-Wizard-Chatbot für DB InfraGO. Du hilfst Mitarbeitern, neue Weichen
  in SAP Fahrweg anzulegen, ohne dass sie SAP-TP-Schlüssel kennen müssen.
  
  Lade die Skill-Anleitung mit load("skills/weichen-dialog/SKILL.md") bevor du einen
  Dialog zur Weichenanlage führst.
  
  WICHTIG: Du DARFST KEINE TP-Schlüssel erfinden oder generieren. Alle TP-Ableitungen
  werden ausschließlich durch das CAP-Regelwerk (via MCP-Tools) durchgeführt.
  Leite Fehler aus Tools wörtlich weiter — keine Umformulierung.
  
  Wenn ein Tool aufgerufen wird, setze 'top' oder 'limit' auf maximal 100.
  
  Use the MCP tools to interact with the TP Wizard CAP backend for all wizard session
  management, question flow, TP preview, and SAP creation operations.
  ```

### Natural Language Understanding

- [ ] Implement entity extraction logic in agent for free-text switch descriptions:
  - Pattern: "einfache Weiche links, 2 Antriebe, 4 Isolierstöße" → `{ grundbauform: 'EW_L', antriebe: 2, isolierstöße: 4 }`
  - If entity extraction produces partial data → trigger follow-up questions via CAP `getNextQuestion` endpoint
  - Never proceed to `submitSession` without all mandatory fields confirmed

### Smart Default Engine Integration

- [ ] On session start, call `getSmartDefaults(basicForm)` before the first user question:
  - Apply all `confidence: "high"` defaults immediately with `source: "agent-default"` via `submitAnswer`
  - Present a brief summary to Katrin: "Ich habe die Standardkonfiguration für EWL geladen. Ich nehme an: [list]. Gibt es Besonderheiten?"
  - Only ask `getNextQuestion` follow-ups for unanswered or low-confidence items
- [ ] Tag every `submitAnswer` call with the correct `source`:
  - `"agent-default"` — applied from `getSmartDefaults` without Katrin addressing it
  - `"katrin-confirmed"` — Katrin explicitly agreed with the agent's proposal
  - `"katrin-corrected"` — Katrin provided a different value than the agent proposed

### Conversation State Management

- [ ] Wire agent to create and maintain a CAP wizard session per conversation:
  - On first user message about a new switch → call `POST /wizard/session` via MCP tool
  - Persist `sessionId` in conversation context
  - Route all subsequent tool calls to the same session
  - On session completion or user abandonment → log session outcome

### Human-in-the-Loop (Katrin → Thomas)

- [ ] Implement summary and handoff step before `submitSession`:
  - Agent must present full TP summary (count per area, total count) and list any deviations from Standardkonfiguration
  - Ask: "Soll ich die Einreichung mit [N] Technischen Plätzen zur Freigabe an Thomas weiterleiten?"
  - Only call `submitSession` after receiving explicit "Ja" / "Bestätigen" from Katrin
  - Never auto-submit
  - After `submitSession`: confirm with reference number — "✅ Einreichung [sessionId] wurde an Thomas zur Freigabe weitergeleitet."
  - The agent NEVER calls `approveSession` — SAP writes are exclusively Thomas' responsibility

---

## Business Instrumentation

- [ ] Implement structured logging for milestones:
  - `[M5.achieved]: Zwei-Rollen-Flow vollstaendig durchlaufen — Katrin submitted, Thomas approved, SAP write success`
  - `[M5.missed]: Zwei-Rollen-Flow fehlgeschlagen — Katrin submission or Thomas approval incomplete`
  - Also relay M4 logging from creation outcome: `[M4.achieved]` / `[M4.missed]`
- [ ] Add OpenTelemetry spans for each business step:
  - `weichen-dialog.session-start`
  - `weichen-dialog.questions-completed`
  - `weichen-dialog.user-confirmed`
  - `weichen-dialog.sap-creation`
- [ ] Verify `bootstrap(app)` is called after `app = server.build()` in `main.py`

---

## MCP Tool Integration

- [ ] During MCP translation, verify these files exist after `mcp-translation-file` skill:
  ```
  specification/tp-wizard-agent/mcps/API_FUNCTIONALLOCATION/api-spec.edmx
  specification/tp-wizard-agent/mcps/API_FUNCTIONALLOCATION/translation.json
  specification/tp-wizard-agent/mcps/API_FUNCTIONALLOCATION/.tool-list.json
  ```
- [ ] Wire MCP tool loading in `agent.py` using `get_mcp_tools()` from `mcp_tools` module
- [ ] Generate `mcp-mock.json` using the `mcp-mock-config` skill after MCP setup is complete

---

## Testing

- [ ] `conftest.py` only sets `IBD_TESTING=true`
- [ ] Write unit test `tests/test_weichen_dialog_skill.py`:
  - Test that agent loads SKILL.md via `load()` tool when user initiates switch creation
  - Mock LLM responses and MCP tool calls
- [ ] Write unit test `tests/test_entity_extraction.py`:
  - Test extraction of Grundbauform, Antriebe count, Isolierstöße from natural language input
  - Test partial extraction → follow-up question triggered
- [ ] Write unit test `tests/test_confirmation_guard.py`:
  - Test that SAP creation MCP tool is NOT called before user confirms
  - Test that explicit "Ja" triggers the creation tool
- [ ] Write one integration test `tests/test_agent_flow.py`:
  - Full conversation for NI_W2006: user describes switch → agent asks follow-ups → confirms → creation result
  - Uses mocked LLM and mocked MCP tools
  - Verify chatbot-derived TP structure matches expected NI_W2006 TP count (M5 validation)
- [ ] Run `pytest` from `assets/tp-wizard-agent/` — all tests must pass, coverage ≥ 70%
- [ ] Run `pytest` again to generate `test_report.json`
- [ ] Verify `test_report.json` exists

---

## Validation Checklist

```bash
# Instrumentation
grep -r "M5\.achieved" assets/tp-wizard-agent/app/     # must return results
grep -r "M4\.achieved" assets/tp-wizard-agent/app/     # must return results

# Test report
ls assets/tp-wizard-agent/test_report.json             # must exist

# MCP mock
ls assets/tp-wizard-agent/mcp-mock.json                # must exist
```

