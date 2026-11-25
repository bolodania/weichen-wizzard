# CAP und Python auf BTP Cloud Foundry deployen

Drei Apps: CAP, Python-Agent und Approuter. Anmeldung und HTTPS-Verbindungen
verwenden dieselbe XSUAA-Instanz. Der Agent ruft CAP direkt auf; Agent Gateway
und Netzwerkregeln sind nicht erforderlich. PoC: Daten im Speicher, SAP-Anlage
simuliert, Destination-/LLM-Abfragen echt.

## 1. Services bereitstellen

Im Hauptverzeichnis des Repositorys:

```bash
export ROOT="$(pwd)"
cf login
cf target
cf create-service xsuaa application tp-wizard-xsuaa -c xs-security.json
cf create-service destination lite tp-wizard-destination
cf create-service connectivity lite tp-wizard-connectivity
cf services
```

Bestehende Services nicht erneut anlegen; Erfolg abwarten. Benötigt: Berechtigungen/
Entitlements, Node ≥22.12, Python-3.12-Buildpack, AI-Core-Zugang und Kundendestination.
OnPremise benötigt Cloud Connector und Connectivity. Die Manifeste binden Services
automatisch. Bei Namenskonflikten `xsappname` vorher anpassen.

## 2. Apps hochladen und URLs ablesen

```bash
cd "$ROOT/assets/tp-wizard-cap"
npm ci
npm run build
cf push
cd "$ROOT/assets/tp-wizard-agent"
cf push --no-start
cd "$ROOT/assets/tp-wizard-router"
npm ci
cf push --no-start
cf app tp-wizard-cap
cf app tp-wizard-agent
cf app tp-wizard-router
```

Die zugewiesenen **externen** Routen übernehmen, ohne abschließenden Schrägstrich:

```bash
export CAP_URL="https://YOUR_ASSIGNED_CAP_ROUTE"
export AGENT_URL="https://YOUR_ASSIGNED_AGENT_ROUTE"
export ROUTER_URL="https://YOUR_ASSIGNED_ROUTER_ROUTE"
```

Falls eine alte App ausschließlich `apps.internal` behält, externe Route zuordnen:
`cf map-route APP YOUR_HTTP_DOMAIN --hostname YOUR_UNIQUE_HOST`. Domains bei Bedarf
mit `cf domains` prüfen. Keine internen URLs für diese Verbindung verwenden.

## 3. Verbindungen und Kundendestination

```bash
cf set-env tp-wizard-cap AGENT_URL "$AGENT_URL/"
cf set-env tp-wizard-agent CAP_BASE_URL "$CAP_URL"
cf set-env tp-wizard-agent AGENT_PUBLIC_URL "$AGENT_URL/"
cf set-env tp-wizard-router destinations \
  "[{\"name\":\"cap-backend\",\"url\":\"$CAP_URL\",\"forwardAuthToken\":true,\"timeout\":120000}]"
printf 'Tatsächlicher BTP-SAP-Destination-Name: '
read -r SAP_DESTINATION
test -n "$SAP_DESTINATION" && cf set-env tp-wizard-cap VALUE_HELP_DESTINATION "$SAP_DESTINATION"
```

Den exakten Namen unter **Subaccount → Connectivity → Destinations** ablesen.
Nicht mit Service-Instanzname oder `cap-backend` verwechseln. Kein kundenspezifischer
Destination-Name ist vorbelegt. Platzhalter nicht wörtlich übernehmen.

API-Zuordnung auf CAP bei Bedarf mit `cf set-env` ändern:

| Variable | Technischer Beispielstandard |
|---|---|
| `VALUE_HELP_SERVICE_PATH` | `/sap/opu/odata/sap/API_BUSINESS_PARTNER` |
| `VALUE_HELP_ENTITY_SET` | `A_BusinessPartner` |
| `VALUE_HELP_KEY_FIELD` | `BusinessPartner` |
| `VALUE_HELP_TEXT_FIELD` | `BusinessPartnerFullName` |
| `VALUE_HELP_ODATA_VERSION` | `2` |

Business Partner sind keine DS100-Betriebsstellen; für Kundendaten Zuordnung anpassen.
Host, Passwort und Location ID bleiben in BTP. Service-Pfad nicht doppelt hinterlegen.

## 4. XSUAA-Callback und Benutzerrolle

Redirect-Platzhalter in `xs-security.json` durch die tatsächliche **Approuter-URL
mit `/login/callback`** ersetzen:

```bash
cd "$ROOT"
cf update-service tp-wizard-xsuaa -c xs-security.json
cf service tp-wizard-xsuaa
```

Erfolg abwarten. Unter **BTP-Subaccount → Security → Role Collections → TP Wizard
Users → Edit** berechtigte Benutzer mit passendem Identity Provider hinzufügen.
Fehlt die Sammlung, diese mit der **WizardUser**-Rolle der richtigen App anlegen.
CF-Entwicklerrechte erlauben nicht automatisch UI-Zugriff. Nach Zuweisung in einem
neuen privaten Browserfenster anmelden; alte Tokens erhalten keine neuen Scopes.

## 5. AI-Core-Zugangsdaten

`.env` wird nicht hochgeladen. Werte aus geschütztem CI-Secretspeicher oder einer
vertrauenswürdigen `.env` in einem privaten Terminal übernehmen:

```bash
cd "$ROOT/assets/tp-wizard-agent"
(
  set -a
  source .env  # weglassen, wenn CI die Variablen bereitstellt
  set +a
  : "${AICORE_CLIENT_ID:?Erforderlich}"
  : "${AICORE_CLIENT_SECRET:?Erforderlich}"
  : "${AICORE_AUTH_URL:?Erforderlich}"
  : "${AICORE_BASE_URL:?Erforderlich}"
  cf set-env tp-wizard-agent AICORE_CLIENT_ID "$AICORE_CLIENT_ID" &&
  cf set-env tp-wizard-agent AICORE_CLIENT_SECRET "$AICORE_CLIENT_SECRET" &&
  cf set-env tp-wizard-agent AICORE_AUTH_URL "$AICORE_AUTH_URL" &&
  cf set-env tp-wizard-agent AICORE_BASE_URL "$AICORE_BASE_URL" &&
  cf set-env tp-wizard-agent AICORE_RESOURCE_GROUP "${AICORE_RESOURCE_GROUP:-default}"
)
```

Keine Secrets einchecken, Shell-Tracing aktivieren oder `cf env` weitergeben.
Privilegierte CF-Benutzer können App-Variablen lesen. XSUAA-Zugangsdaten kommen aus
Bindings; AI-Core-Werte separat setzen. Ressourcengruppe nur bei Bedarf ändern.

## 6. Starten und testen

```bash
cf restart tp-wizard-cap
cf start tp-wizard-agent
cf start tp-wizard-router
```

Bereits laufende Apps nach Variablenänderungen neu starten. Oberfläche über
**Approuter-URL + `/field/`**, Freigabe über **`/approve/webapp/index.html`** öffnen.
CAP direkt bietet keinen interaktiven Login.

```bash
curl -i "$CAP_URL/health"
curl -i "$CAP_URL/wizard/listPendingSessions()"
cf logs tp-wizard-cap --recent
cf logs tp-wizard-agent --recent
cf logs tp-wizard-router --recent
```

Health: 200; APIs ohne Token: 401. Destination-Auswahl, EWR-Chat, Einreichung und
Freigabe testen. In CF ist XSUAA automatisch aktiv; keine Test-/Provider-Flags nötig.

## Fehlerbehebung und Updates

### Alles mit einem Befehl erneut deployen

Für eine bereits vollständig konfigurierte Installation, aus dem Repository-Hauptverzeichnis:

```bash
bash scripts/redeploy-cf.sh --dry-run  # Ablauf anzeigen, keine Änderungen
bash scripts/redeploy-cf.sh          # CF-Ziel bestätigen, bauen/testen/deployen
```

Das Skript erhält die vorhandenen externen Routen, Kundendestination/API-Werte,
AI-Core-Zugangsdaten und Ressourcengruppe. Es verbindet die Apps erneut, aktualisiert
den XSUAA-Callback und startet alle drei Apps. Services/Benutzerrollen werden nicht
angelegt und lokale `.env`-Dateien nicht übertragen. Neustarts verlieren PoC-Daten.
Python-Tests benötigen ein venv mit Testabhängigkeiten; alternativ `AGENT_PYTHON`
setzen. Für CI `--yes`, Tests nur ausdrücklich mit `--skip-tests` überspringen.
Fehler stoppen den Ablauf; es gibt keinen automatischen Rollback.

- **Forbidden / nur `openid`:** Benutzerrolle zuweisen und frisch anmelden.
- **Destination 502:** CAP-Logs, exakten Namen, Bindings, Cloud Connector und API-Rechte prüfen.
- **Werkzeuge fehlschlagen:** CAP_BASE_URL, XSUAA-Binding und technische Scopes prüfen.
- **Callback fehlerhaft:** exakte Approuter-Callback-URI registrieren.
- **Updates:** je Asset `cf push`; CAP-UI vorher bauen. Geänderte URLs erfordern
  neue Verbindungswerte/Callback. Variablenänderungen benötigen Neustart.
- **Migration:** alte HOST-, PYTHONUNBUFFERED-, IBD_TESTING- und AUTH_MODE-UPVs mit
  `cf unset-env tp-wizard-agent NAME` entfernen; sie werden nicht mehr verwendet.

Eine Instanz je App, volatile Daten und kombinierte Browserrollen bleiben PoC-Grenzen.
Deployment erfolgt ausschließlich mit CF-Buildpacks; Docker ist nicht vorgesehen.
PDF benötigt Poppler im Laufzeitumfeld. Ohne Poppler Textdateien verwenden;
Extraktionsfehler werden sichtbar abgewiesen. Die Analyse prüft Regeln/Zitate
vorhandener Antworten und ist keine automatische Dokumentinterpretation.
Destination-, Modell- und Tokenzugriff im Kundensystem verifizieren.