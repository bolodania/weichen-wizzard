> Historische Spezifikation: nicht als Implementierungsanleitung ausführen. Aktueller Stand: README.md und docs/README-deployment-cf.md.

# Specification: TP-Wizard Weiche

> **Guidelines**: Read [guidelines.md](./guidelines.md) before executing ANY tasks below.

Guided wizard for creating SAP Functional Location (Technische Platz) hierarchies for railway switches (Weichen) at DB InfraGO — without requiring knowledge of SAP TP key systematics.

---

## Solution Setup

- [x] Create asset directories:
  ```bash
  mkdir -p assets/tp-wizard-cap assets/tp-wizard-agent
  ```
- [x] Invoke `setup-solution` skill to create `solution.yaml` and `asset.yaml` files for every asset:
  - `tp-wizard-cap` — CAP Application (backend rule engine + React/UI5 frontend)
  - `tp-wizard-agent` — AI Agent / Python A2A (LLM chatbot stretch goal)
- [x] Validate all `asset.yaml` and `solution.yaml` files exist and are well-formed

---

## Asset Implementation

- [x] Execute `specification/tp-wizard-cap/specification.md` (all items)
- [x] Execute `specification/tp-wizard-agent/specification.md` (all items — stretch goal, execute after CAP asset is complete)
- [x] Cross-implementation compatibility check:
  - CAP backend exposes all required REST endpoints consumed by the AI Agent
  - Session IDs are stable UUIDs; both assets agree on session lifecycle
  - TP key format and area grouping is consistent between CAP preview API and Agent skill instructions
  - Environment variable `FL_MOCK=true` disables real S/4HANA calls in both assets for offline Hackathon demo
  - Fix any mismatches before proceeding to deployment

---

## API Specs (Downloaded)

| API | ORD ID | File |
|-----|--------|------|
| Functional Location (create/read) | `sap.s4:apiResource:API_FUNCTIONALLOCATION:v1` | `specification/tp-wizard-cap/api-specs/API_FUNCTIONALLOCATION.edmx` |
| Functional Location Hierarchy Read | `sap.s4:apiResource:FUNCNLLOCSTRUCLIST_0001:v1` | `specification/tp-wizard-cap/api-specs/FUNCNLLOCSTRUCLIST_0001.edmx` |

---

## Key Hackathon Demo Scenarios

1. **NI_W2006 — einfache Weiche (Katrin-Flow)** (~30 TPs): Feldaufnehmerin Katrin öffnet `/field` auf dem Smartphone. Agent lädt Standardkonfiguration EWL, stellt ~4 Rückfragen (Heizung, Rückbaustatus). Katrin bestätigt → `submitSession` → Einreichung wartet auf Thomas.
2. **NRB_W806 — komplexe Weiche (Thomas-Flow)** (~80 TPs): Thomas öffnet `/approve` auf dem Desktop. Sieht die Einreichung von Katrin mit Warning-Strip (Agentannahmen). Prüft Hz-beweglich-Details, korrigiert Herzstückbauart (Bauart 2), setzt 2 Zgv-Antriebe. `approveSession` → SAP-Schreibzugriff → 80 TPs angelegt.
3. **Two-Role Handoff (kombiniert)**: Voller Ablauf in einer Demo: Katrin erfasst NI_W2006 via Chat in 90 Sekunden → Einreichung erscheint live in Thomas' Liste → Thomas prüft, editiert einen Wert, gibt frei → SAP-Ergebnis.
4. **(Demo contrast)** Show manual TP key lookup vs. wizard time savings (R-09 Aha-effect)

---

## Milestone Tracking

| Milestone | Condition | Log Pattern |
|-----------|-----------|-------------|
| M1 — Rule engine ready | All 19 areas executable | `[M1.achieved]: Regelwerk vollständig digitalisiert` |
| M2 — Simple switch validated | NI_W2006 TP count = expected | `[M2.achieved]: Einfache Weiche NI_W2006 validiert` |
| M3 — Complex switch validated | NRB_W806 TP count within ≤5% | `[M3.achieved]: Komplexe Weiche NRB_W806 validiert` |
| M4 — SAP write-back confirmed | ≥1 full session → A21 create success | `[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich` |
| M5 — Two-role flow end-to-end | Katrin submits via Agent → Thomas approves → SAP write | `[M5.achieved]: Zwei-Rollen-Flow vollstaendig durchlaufen` |

