# TP Wizard Weiche

KI-gestütztes Erfassungs- und Freigabesystem für Technische Plätze (TPs) von Eisenbahnweichen bei DB InfraGO.

## Überblick

Neue Weichen müssen als Technische Plätze in SAP angelegt werden. Dieser Prozess erfordert die Beantwortung von bis zu 25 Fragen und die Ableitung einer strukturierten TP-Hierarchie. Der TP Wizard führt zwei Rollen durch diesen Prozess:

| Rolle | Aufgabe | App |
|---|---|---|
| **Katrin** (Feldaufnehmerin) | Weichendaten im Feld erfassen, via Chatbot geführt | `app-field` (React + UI5 Web Components) |
| **Thomas** (Technischer Verantwortlicher) | Einreichungen prüfen, Antworten korrigieren, SAP-Anlage freigeben | `app-approve` (Fiori Elements) |

Katrin kann niemals selbst freigeben. Die SAP-Schreiboperation erfolgt ausschließlich nach expliziter Freigabe durch Thomas.

---

## Architektur

```
Katrin (Feldaufnehmerin)              Thomas (Techn. Verantwortlicher)
         │                                          │
    app-field                                 app-approve
   (React/UI5)                             (Fiori Elements)
         │                                          │
    A2A JSON-RPC                             OData V4
         │                                          │
         ▼                                          ▼
  tp-wizard-agent  ──── MCP-Tools ──▶   tp-wizard-cap
 (Python/LangGraph)                    (Node.js / SAP CAP)
                                              │
                                              ▼
                                       SAP S/4HANA (TP-Anlage)
                                       ← nur nach Thomas' Freigabe
```

### Assets

```
assets/
├── tp-wizard-agent/        Python-Agent (LangGraph + LiteLLM + A2A)
│   └── app/
│       ├── agent.py        Haupt-Agent: Fallback-Chain, Circuit Breaker, Summarization
│       └── skills/
│           └── weichen-dialog/SKILL.md   Geführter 7-Schritt-Dialog
│
└── tp-wizard-cap/          SAP CAP Backend + Frontends
    ├── db/                 CDS Datenmodell + Seed-Daten
    │   └── schema.cds      Entities: WizardSession, SessionAnswer, DerivedTP, ForlaTemplate
    ├── srv/                CAP Service-Handler
    │   ├── wizard-service.cds
    │   ├── wizard-service.js
    │   └── lib/
    │       ├── engine.js       TP-Ableitungsregelwerk
    │       ├── katalog.js      Fragenkatalog
    │       ├── weiche.js       Weichen-Domänenobjekt
    │       └── smart-defaults.js
    ├── app-field/          Katrins Chat-App (React + Vite + UI5 Web Components)
    └── app/
        └── approve/        Thomas' Freigabe-App (Fiori Elements OData V4)
```

---

## Kernkonzepte

### Zwei-Rollen-Workflow

Der Agent hat ein **ABSOLUTES VERBOT**: Er darf `approveSession` niemals aufrufen. Die SAP-Schreiboperation (`bulkCreateFunctionalLocations`) wird ausschließlich durch Thomas' `approve`-Aktion in der Fiori-App ausgelöst.

### Session-Lebenszyklus

```
open → (Agent-Dialog) → submitted → (Thomas prüft) → approved → created
                                 ↘ (Thomas lehnt ab) → editing → submitted
```

### Antwortquellen (`source`-Feld)

Jede `SessionAnswer` trägt eine Quelle für vollständige Nachvollziehbarkeit:

| Wert | Bedeutung |
|---|---|
| `auto` | Automatisch aus Regelwerk abgeleitet |
| `agent-default` | Standardwert vom Agenten gesetzt (kein Dialog) |
| `katrin-confirmed` | Katrin hat Wert explizit bestätigt |
| `katrin-corrected` | Katrin hat Agenten-Vorschlag korrigiert |
| `thomas-edited` | Thomas hat Antwort nach Einreichung geändert |

### Schnellerfassung (`bulkSubmitWithDefaults`)

Wenn Katrin alle verbleibenden Fragen mit Standardwerten übernehmen möchte, setzt diese Aktion alle offenen Felder auf `source: 'agent-default'` und reicht die Session in einem einzigen Aufruf ein — ohne weitere LLM-Roundtrips.

---

## Deploy the complete solution to BTP Cloud Foundry

See the [step-by-step CAP + Python deployment README](docs/README-deployment-cf.md)
for service provisioning, both manifests, AI Core environment configuration,
XSUAA-protected HTTPS app-to-app connections, Approuter login, and troubleshooting.
The existing CAP manifest alone does not deploy the Python agent.

## Lokales Setup

### Voraussetzungen

| Tool | Version |
|---|---|
| Node.js | ≥ 22.12 |
| `@sap/cds-dk` | ≥ 8 (global) |
| Python | ≥ 3.11 |
| pip / venv | aktuell |

```bash
npm install -g @sap/cds-dk
```

### CAP Backend + Frontends starten

```bash
cd assets/tp-wizard-cap
npm install
FL_MOCK=true npm run dev  # CAP auf http://localhost:4004, SAP-Anlage simuliert
```

```bash
cd assets/tp-wizard-cap/app-field
npm install
npm run dev        # Katrins Chat-App auf http://localhost:5173
```

### Python-Agent starten

```bash
cd assets/tp-wizard-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Umgebungsvariablen (Beispiel):
export AICORE_BASE_URL=https://...
export AICORE_CLIENT_ID=...
export AICORE_CLIENT_SECRET=...

python -m app   # Agent auf http://localhost:8000
```

### Umgebungsvariablen

| Variable | Beschreibung |
|---|---|
| `AICORE_BASE_URL` | SAP AI Core API-Endpunkt |
| `AICORE_CLIENT_ID` | Service-Key Client-ID |
| `AICORE_CLIENT_SECRET` | Service-Key Client-Secret |
| `AICORE_TOKEN_URL` | OAuth Token-Endpunkt |
| `AGENT_INJECTION_RESISTANCE` | Optionale Zusatzinstruktionen gegen Prompt-Injection |
| `SAP_DESTINATION_*` | Credentials für S/4HANA Destination (Produktion) |

Niemals Credentials in den Code oder in dieses Repository einchecken. `.env`-Dateien sind via `.gitignore` ausgeschlossen.

---

## Tests ausführen

### CAP (Jest)

```bash
cd assets/tp-wizard-cap
npm test
```

### Python-Agent (pytest)

```bash
cd assets/tp-wizard-agent
source .venv/bin/activate
pytest
```

---

## Branches

| Branch | Inhalt |
|---|---|
| `main` | Stabiler Stand |
| `feature/two-role-workflow` | Zwei-Rollen-Workflow (Katrin / Thomas) |
| `regelwerk-ewr` | Datengetriebenes TP-Ableitungsregelwerk aus EWR-Daten |

---

## Datenmodell (Kurzübersicht)

```
WizardSession (UUID)
  ├── status: open | submitted | editing | approved | created | failed
  ├── answers: SessionAnswer[]
  │     └── source: auto | agent-default | katrin-confirmed | katrin-corrected | thomas-edited
  └── tps: DerivedTP[]
        └── level / parentTpKey (Hierarchie per Präfix-Matching)

ForlaTemplate    — Maximalausprägung aller möglichen TPs je Weichentyp
BasicFormMapping — Grundbauform → gültige Positionsnummernbereiche
```

---

## CAP Service-Endpunkte

Basis-URL lokal: `http://localhost:4004/wizard`

| Methode | Endpunkt | Aufrufer | Beschreibung |
|---|---|---|---|
| POST | `/createSession` | Frontend / Agent | Neue Session anlegen |
| POST | `/submitAnswer` | Agent | Einzelne Antwort speichern |
| POST | `/bulkSubmitWithDefaults` | Agent | Alle offenen Fragen mit Defaults setzen + einreichen |
| POST | `/submitSession` | Agent | Session zur Freigabe einreichen |
| POST | `/Sessions({id})/approve` | Thomas (Fiori) | SAP-Anlage auslösen |
| GET | `/getNextQuestion` | Agent | Nächste offene Frage abfragen |
| GET | `/getTPPreview` | Frontend | Aktuelle TP-Hierarchie abrufen |
| GET | `/getSmartDefaults` | Agent | Standardwerte für Grundbauform |
| GET | `/listPendingSessions` | Agent / Thomas | Offene Einreichungen auflisten |
| GET | `/health` | Monitoring | Verfügbarkeitsprüfung |

---

## Agent-Konfiguration

Der Agent (`assets/tp-wizard-agent/app/agent.py`) ist über SAP AI Core konfigurierbar:

| Parameter | Standard | Beschreibung |
|---|---|---|
| `config.model` | `sap/anthropic--claude-4.5-sonnet` | Primäres LLM |
| `config.fallback_models` | leer | Komma-getrennte Fallback-Modelle |
| `config.circuit_breaker.failure_threshold` | 3 | Fehler bis Circuit Breaker öffnet |
| `config.circuit_breaker.cooldown_seconds` | 120 | Cooldown-Zeit in Sekunden |
| `config.temperature` | 0.0 | LLM-Temperatur |
| `config.summarization.trigger_tokens` | 30 000 | Token-Schwelle für Gesprächs-Komprimierung |
| `config.summarization.model` | `sap/anthropic--claude-4.5-haiku` | Modell für Komprimierung |

---

## UI-Mockups

Interaktive HTML-Mockups (Fiori Horizon) liegen unter `docs/mockups/` und werden lokal generiert:

```bash
cd /tmp/tp-mockups-scratch   # oder lokal ablegen
node generator.js
# → docs/mockups/index.html öffnen
```

Die generierten Dateien sind aus `.gitignore` ausgeschlossen (reproduzierbar).

---

## Lizenz

Internes Projekt — DB InfraGO / SAP. Keine externe Weitergabe.
