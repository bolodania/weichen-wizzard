# TP Wizard Weiche

PoC zur KI-gestützten Erfassung und Prüfung von Technischen Plätzen für Eisenbahnweichen.
Die TP-Struktur wird deterministisch aus dem Regelwerk abgeleitet, nicht vom LLM.
Aktuell ist nur **EWR (einfache Weiche rechts)** unterstützt.

## Aufbau

| Verzeichnis | Aufgabe |
|---|---|
| `assets/tp-wizard-cap` | CAP-APIs, Regelwerk, Felderfassung (React/UI5), Freigabe (Fiori Elements) |
| `assets/tp-wizard-agent` | Python-A2A-Agent mit LangGraph/LiteLLM; direkte CAP-Werkzeuge aus `cap-tools.json` |
| `assets/tp-wizard-router` | SAP Approuter für Browser-Anmeldung über XSUAA |

## Gesamtarchitektur

```text
Feldaufnahme                              Technischer Verantwortlicher
    │                                              │
    └────────────── Browser / XSUAA-Anmeldung ──────┘
                              │
                       SAP Approuter
                              │ HTTPS + Benutzertoken
                              ▼
                    CAP-Anwendung (Node.js)
                    ├─ Felderfassung: React + UI5 Web Components
                    ├─ Freigabe: Fiori Elements / OData V4
                    ├─ WizardService: Erfassung, Vorschau, Prüfung
                    └─ Regelwerk: Katalog → deterministische TP-Hierarchie
                         │                  ▲
                 Chat / A2A über HTTPS       │ CAP-Werkzeuge über HTTPS
                         ▼                  │
                    Python-Agent ───────────┘
                    LangGraph + LiteLLM
                         │
                         ▼
                    SAP AI Core → Claude

CAP → Destination Service → Connectivity / Cloud Connector → SAP-System
      ├─ Value Help: konfigurierbarer OData-Service (lesend)
      └─ TP-Anlage: nach manueller Freigabe, im PoC simuliert

CAP-Daten: SQLite im Speicher — Katalog, Sessions, Antworten, TP-Snapshots
```

**Ablauf:** Weichendaten erfassen → Antworten speichern → TP-Vorschau ableiten →
einreichen → prüfen/korrigieren → manuell freigeben. Der Agent unterstützt den
Dialog; die fachliche Ableitung erfolgt ausschließlich im CAP-Regelwerk.

Alle drei Anwendungen laufen auf BTP Cloud Foundry. XSUAA schützt Browser- und
App-Verbindungen; der Agent ruft CAP direkt auf, ohne Agent Gateway.
Technische Tokens dürfen nicht freigeben. Die Browserrolle `WizardUser` erlaubt
im PoC sowohl Erfassung als auch Prüfung; getrennte Benutzerrollen sind noch offen.
Für Internet-Destinations entfällt der Cloud Connector.

## Deployment auf BTP Cloud Foundry

Siehe [Schritt-für-Schritt-Anleitung](docs/README-deployment-cf.md): Services anlegen,
drei Apps mit `cf push` deployen, URLs verbinden, Kundendestination und AI Core
konfigurieren sowie Benutzerrollen zuweisen. Der Destination-Name ist nicht vorbelegt;
API-Pfad, EntitySet und Feldzuordnung sind konfigurierbar.

## Lokal starten

Voraussetzungen: Node.js ≥22.12, CAP-CLI (`@sap/cds-dk`), Python 3.12.

```bash
# CAP: aus dem Repository-Hauptverzeichnis
cd assets/tp-wizard-cap
npm ci
npm run build
FL_MOCK=true npm start
```

Oberflächen: `http://localhost:4004/field/` und
`http://localhost:4004/approve/webapp/index.html`.
Die lokale Entwicklung verwendet Mock-Authentifizierung, nicht BTP-Login.

```bash
# Agent: zweites Terminal, aus dem Repository-Hauptverzeichnis
cd assets/tp-wizard-agent
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
source .env
python -u app/main.py --host 127.0.0.1 --port 5000
```

Die `.env` benötigt `AICORE_CLIENT_ID`, `AICORE_CLIENT_SECRET`, `AICORE_AUTH_URL`
und `AICORE_BASE_URL`. Ressourcengruppe nur ändern, wenn nicht `default`.
Lokaler CAP-Standard: `http://127.0.0.1:4004`. Modelle: Claude Sonnet 4.5 für Chat,
Haiku 4.5 für Zusammenfassungen. Keine Secrets einchecken oder ins Frontend kopieren.

## Tests

```bash
# Im CAP-Ordner
npm test -- --runInBand

# Im Agent-Ordner mit aktiviertem venv
python -m unittest discover -s tests -p test_cap_tools.py -v
python -m unittest discover -s tests -p test_xsuaa_auth.py -v
```

Referenzfälle: NI/2006 → 25 TPs, NRB/806 → 110 TPs.

## PoC-Grenzen

- Eine Instanz je App; SQLite/Gespräche liegen im Speicher. Neustarts verlieren Daten.
- `FL_MOCK=true` simuliert SAP-TP-Anlage; Destination-/LLM-Abfragen sind echt.
- Offene Pflichtangaben oder leere TP-Strukturen verhindern die Freigabe.
- Datensatzberechtigungen, getrennte Browserrollen und echter SAP-Schreibzugriff sind noch nicht vollständig umgesetzt.
- Business Partner sind eine technische Value-Help-Beispielquelle, keine DS100-Betriebsstellen.

## Dokumentation

- [CAP-Service](assets/tp-wizard-cap/README.md)
- [Python-Agent](assets/tp-wizard-agent/README.md)
- [Regelwerk](docs/regelwerk-ewr.md)
- [Testabläufe](docs/test-scenarios.md)

## Lizenz

Internes Projekt — DB InfraGO / SAP. Keine externe Weitergabe.