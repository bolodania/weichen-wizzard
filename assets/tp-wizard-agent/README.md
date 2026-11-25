# TP Wizard Agent

Python-A2A-Chatbot mit Claude über SAP AI Core. Werkzeuge in `cap-tools.json`
rufen CAP direkt auf. Kein Agent Gateway und keine Testmodus-Umschaltung.

## Lokal starten

Python 3.12 verwenden; CAP muss auf Port 4004 laufen:

```bash
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
source .env
python -u app/main.py --host 127.0.0.1 --port 5000
```

`.env`: `AICORE_CLIENT_ID`, `AICORE_CLIENT_SECRET`, `AICORE_AUTH_URL`,
`AICORE_BASE_URL`. `AICORE_RESOURCE_GROUP` nur ändern, wenn nicht `default`.
`CAP_BASE_URL` ist lokal standardmäßig `http://127.0.0.1:4004`. Keine Secrets einchecken.

## Cloud Foundry

Siehe [Deployment-Anleitung](../../docs/README-deployment-cf.md).
XSUAA ist in CF automatisch erforderlich. Nach Push die tatsächlichen
`CAP_BASE_URL`, `AGENT_PUBLIC_URL` und AI-Core-Werte setzen. `python -u` aktiviert
unmittelbare Logs; CF stellt den Container-Port bereit.

## Tests

```bash
python -m unittest discover -s tests -p test_xsuaa_auth.py -v
python -m unittest discover -s tests -p test_cap_tools.py -v
```

Gespräche liegen im Speicher. Sonnet 4.5 wird für Chat, Haiku 4.5 für Zusammenfassungen
verwendet. CAP steuert die simulierte SAP-Anlage über `FL_MOCK`.