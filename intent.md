# TP-Wizard Weiche

DB InfraGO SAP-Hackathon — guided wizard for creating SAP Technical Places (Technische Plätze) for railway switches (Weichen)

## Business challenge

Railway switch (Weiche) master data at DB InfraGO suffers from high error rates because field engineers and office clerks lack knowledge of the SAP Technical Place (TP) key systematics of the new WE structure (Forla). An experienced generation of workers who knew both the physical components and the SAP TP keys is leaving; new staff know the railway construction but not the key logic. A guided wizard should replace the error-prone manual entry process by asking plain-language questions and automatically deriving the correct TP hierarchy from a rule engine. An LLM chatbot is a stretch goal.

## Business Goals & Success Criteria

| Metric | Baseline | Target | Timeline | Process / Capability | Source |
|--------|----------|--------|----------|----------------------|--------|
| % of TPs created correctly after a full wizard run (no rework) | — (unknown) | ≥ 90 % | Q1 2027 (production MVP) | Asset Data & Master Data Management | user |
| Remaining manual rework share after wizard completion | — | ≤ 10–20 % | Q1 2027 | Asset Commissioning | user |

## Key Milestones

1. **Rule engine ready** — 19-area questionnaire (80+ questions) from `Kopie von Fragen.xlsx` digitised and executable in CAP backend
2. **Simple switch validated** — wizard generates correct TP preview for NI_W2006 (~30 TPs) matching expected output
3. **Complex switch validated** — wizard generates correct TP preview for NRB_W806 (~80 TPs) matching expected output
4. **SAP write-back confirmed** — accepted TP structure bulk-created in A21 sandbox via S/4HANA Functional Location API
5. **(Stretch) LLM chatbot** — natural-language dialog layer produces equivalent TP structure as structured wizard

## Business Architecture (RBA)

### End-to-End Process

Acquire to Decommission (generic)

### Process Hierarchy

```
Acquire to Decommission (generic)
└── Manage Assets (generic)
    └── Manage asset data and collaboration (generic) [BPS-379]
        └── Manage asset master data
└── Acquire to Onboard (generic)
    └── Commission asset (generic) [BPS-372]
        └── Onboard asset
    └── Design and build asset (generic) [BPS-381]
        └── Build asset
└── Operate to Maintain (generic)
    └── Plan asset maintenance (generic) [BPS-377]
        └── Define maintenance plans and rules
```

### Summary

The TP-Wizard addresses the "Manage asset data and collaboration" and "Commission asset" sub-processes within the Acquire to Decommission E2E, with direct relevance to the utilities / transmission-and-distribution-network and tangible-assets industry variants — the closest standard RBA fit for railway infrastructure.

## Fit Gap Analysis

| Requirement (business) | Standard asset(s) found | API ORD ID | MCP Server ORD ID | MCP Server Version | Webhook API ORD ID | Data Product ORD ID | Gap? | Notes / assumptions |
| ---------------------- | ----------------------- | ---------- | ----------------- | ------------------ | ------------------ | ------------------- | ---- | ------------------- |
| Create / bulk-create Functional Locations (TPs) in S/4HANA | SAP S/4HANA Cloud Private Edition — Asset Data and Information Management (SC5257) | `sap.s4:apiResource:API_FUNCTIONALLOCATION:v1` | — | — | — | — | No | Standard OData API exists; no MCP server — called directly from CAP backend |
| Read existing Functional Location hierarchy (Forla) | SAP S/4HANA Cloud Private Edition | `sap.s4:apiResource:FUNCNLLOCSTRUCLIST_0001:v1` | — | — | — | — | No | Hierarchy read API available; use to display preview of existing structure |
| Rule engine: question catalogue → TP selection logic | — | — | — | — | — | — | **Yes** | No standard SAP product; must be built custom in CAP backend from Excel questionnaire |
| Guided wizard UI (3-panel, mobile-capable) | — | — | — | — | — | — | **Yes** | No Fiori standard app for domain-specific switch TP creation; custom React/UI5 app required |
| LLM chatbot dialog layer over rule engine (stretch) | — | — | — | — | — | — | **Yes** | No standard asset; Python AI Agent (A2A) as optional interface |
| Sandbox write-back (A21-Kopie) | SAP S/4HANA Cloud Private Edition | `sap.s4:apiResource:API_FUNCTIONALLOCATION:v1` | — | — | — | — | Maybe | Cloud Connector BTP ↔ A21 still pending (Sascha Grebenstein) |

### Key findings

- SAP S/4HANA Cloud Private Edition covers asset data management and commissioning as mandatory capabilities — the Functional Location OData API is the write-back integration point.
- No MCP server exists for either the Functional Location or Functional Location Hierarchy API; the CAP backend will call S/4HANA directly via OData.
- The core gap is the rule engine: 19 question areas with 80+ branching questions, Positionsnummernlogik, and Rückbaustatus — this must be custom-built and is the critical path for the Hackathon.
- The LLM chatbot stretch goal (Python AI Agent) sits on top of the rule engine and does not replace it — rule engine correctness is a prerequisite for reliable LLM output.
- Cloud Connector between BTP and the A21 sandbox is the main infrastructure dependency; without it the write-back milestone cannot be demonstrated.
- Datenstabilität of the Forla structure (changes rarely) means the rule engine, once built, is durable and low-maintenance.

## Recommendations

### TP-Wizard — guided master data entry for Weichen in SAP

#### Executive Summary

CAP backend rule engine + React/UI5 wizard; optional Python AI Agent chatbot

#### Recommended Solution

Build a CAP (Cloud Application Programming Model) backend on SAP BTP that hosts the rule engine (derived from the `Kopie von Fragen.xlsx` questionnaire) and calls the S/4HANA Functional Location OData API. Expose a React + SAP UI5 Web Components frontend as a 3-panel wizard: navigation tree (left), active question/input area (centre), live TP preview (right). As a Hackathon stretch goal, add a Python AI Agent (A2A protocol) that acts as an LLM chatbot dialog layer over the same rule engine, allowing natural-language input instead of form fields.

#### Problem Statement

New DB InfraGO staff (field engineers and office clerks) cannot correctly assign SAP TP keys to switch components because the link between physical railway knowledge and SAP key systematics has eroded with the departure of experienced personnel. The new WE/Forla structure is more precise but even harder to use without background knowledge. The existing Dia App lacks the selection logic and produces faulty entries — errors surface only late in the process and cause expensive rework.

#### Affected User Roles

- **Feldaufnehmer** (field engineer / track supervisor): records physical switch attributes on-site; primary mobile user
- **Sachbearbeiter / THWler** (office clerk / technical administrator): enters data into SAP S/4HANA Fahrweg; primary desktop user

#### Important factors

##### Wizard approach separates domain knowledge from SAP key knowledge

The wizard encapsulates the TP key logic in the rule engine so neither user role needs to know SAP key systematics. Questions are in plain railway language; TP keys are derived invisibly.

##### Forla structure stability reduces maintenance overhead

Railway switch designs have not fundamentally changed in 125 years. The Forla template (max. TP set) is stable — once the rule engine is built it requires minimal ongoing maintenance.

##### Two concrete reference cases available

NI_W2006 (~30 TPs, simple) and NRB_W806 (~80 TPs, complex) provide ground-truth test cases for validating rule engine correctness before the Hackathon demo.

#### Potential risks

##### Cloud Connector dependency (A21 sandbox)

Write-back to SAP can only be demonstrated if the BTP ↔ A21 Cloud Connector is operational. This is owned by Sascha Grebenstein / technical operations and is not under SAP Build team control.

##### Rule engine completeness

Two known gaps in the questionnaire (Gleisstücke + Prüferschieber) are still open. Missing logic = missing TPs in output. Thorsten Dörr must close these gaps before the Hackathon.

##### LLM reliability over complex rule sets

An LLM chatbot over a 80+ question rule engine with strict positional logic may hallucinate or miss mandatory questions. The structured wizard is the reliable fallback; the chatbot is explicitly a stretch goal.

#### Recommended solution category

CAP Application, AI Agent

#### Intent fit

88%
