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

Alle sechs `VALUE_HELP_*`-Variablen auf CAP konfigurieren: Destination-Name oben,
API-Zuordnung unten. Keine API-Standardwerte sind im Code oder Manifest hinterlegt.
`.env.example` enthält ausschließlich zu ersetzende Platzhalter für lokale Nutzung.

| Variable | Kundenspezifischer Wert |
|---|---|
| `VALUE_HELP_SERVICE_PATH` | Relativer Pfad des OData-Service |
| `VALUE_HELP_ENTITY_SET` | EntitySet der Betriebsstellen |
| `VALUE_HELP_KEY_FIELD` | String-Eigenschaft mit dem Betriebsstellen-Code |
| `VALUE_HELP_TEXT_FIELD` | Eigenschaft mit der Bezeichnung |
| `VALUE_HELP_ODATA_VERSION` | `2` oder `4`, passend zum Service |

Alle Platzhalter durch Werte aus dem OData-Service des Kunden ersetzen:

```bash
cf set-env tp-wizard-cap VALUE_HELP_SERVICE_PATH "/PFAD/DES/KUNDENSERVICE"
cf set-env tp-wizard-cap VALUE_HELP_ENTITY_SET "KUNDEN_ENTITYSET"
cf set-env tp-wizard-cap VALUE_HELP_KEY_FIELD "CODE_EIGENSCHAFT"
cf set-env tp-wizard-cap VALUE_HELP_TEXT_FIELD "BEZEICHNUNGS_EIGENSCHAFT"
cf set-env tp-wizard-cap VALUE_HELP_ODATA_VERSION "2" # ggf. 4
cf restart tp-wizard-cap
```

Die Zuordnung aus dem OData-Service des Kunden ableiten:

1. Service-Pfad festlegen; `$metadata` beschreibt EntitySets und Eigenschaften.
2. EntitySet mit den auswählbaren Einträgen als `VALUE_HELP_ENTITY_SET` setzen.
3. Code-Eigenschaft als `VALUE_HELP_KEY_FIELD`, Bezeichnung als
   `VALUE_HELP_TEXT_FIELD` setzen. Groß-/Kleinschreibung exakt übernehmen.
4. Protokollversion `2` oder `4` setzen und CAP neu starten.
5. Über Approuter die Felderfassung öffnen und „Auswählen“ testen.

Ergebnis: `<Destination-URL><VALUE_HELP_SERVICE_PATH>/<VALUE_HELP_ENTITY_SET>`.
`cf set-env` benötigt keinen lokalen Projektordner, aber das richtige CF-Ziel.
Ein Neustart genügt; kein Build erforderlich. Er verliert jedoch die PoC-Daten im
Speicher. Das Redeployment-Skript prüft und erhält bestehende API-Werte. Auch ein
manuelles `cf push` überschreibt diese Variablen nicht durch Manifest-Standardwerte.
Bei fehlenden Variablen liefert die Value Help HTTP 503 mit dem Variablennamen;
Platzhalter sind keine ausführbare Konfiguration.

Der Service muss fachlich passende Betriebsstellen-Codes liefern. Die Suche verwendet
exakte Gleichheit auf `VALUE_HELP_KEY_FIELD`; das Backend muss diesen String-Filter
unterstützen. Den vollständigen Code einschließlich führender Nullen eingeben.
Host, Passwort und Location ID bleiben in BTP. Service-Pfad nicht doppelt hinterlegen.

### Echte TP-Anlage aktivieren

Echte SAP-Anlage ist Standard (`FL_MOCK=false`, auch ohne Variable).
Vor manueller Freigabe Kundendestination und schreibbaren Vertrag prüfen.
Für das geprüfte `ZWW_SB_FUNCTIONALLOCA_V2`-Metadata gilt folgende Zuordnung
(kein Runtime-Standardwert; eine Business-Partner-Konfiguration vorher ersetzen):

```bash
cf set-env tp-wizard-cap VALUE_HELP_SERVICE_PATH /sap/opu/odata/sap/ZWW_SB_FUNCTIONALLOCA_V2
cf set-env tp-wizard-cap VALUE_HELP_ENTITY_SET StationLocation
cf set-env tp-wizard-cap VALUE_HELP_KEY_FIELD StationLocationID
cf set-env tp-wizard-cap VALUE_HELP_TEXT_FIELD StationLocationName
cf set-env tp-wizard-cap VALUE_HELP_ODATA_VERSION 2
cf set-env tp-wizard-cap FL_ENTITY_SET FunctionalLocation
# Bestehende Simulation überschreiben; neuer Manifest-Standard ist false:
cf set-env tp-wizard-cap FL_MOCK false
```

`VALUE_HELP_DESTINATION` muss dieselbe Kundendestination für Lesen und Schreiben
adressieren. Bei einem anderen Vertrag nicht diese Zuordnung übernehmen.
Nach Codeänderungen nur CAP mit `cf push tp-wizard-cap --no-manifest` aus dem
CAP-Ordner deployen (vorhandenes `app-field/dist` erforderlich). Bei reinen
Umgebungsänderungen genügt `cf restart tp-wizard-cap`. Approuter und Agent bleiben
unverändert. `FL_MOCK=true` schaltet zurück auf Simulation.

Freigabe sendet alle abgeleiteten TPs einschließlich Wurzel und Eltern in einem
OData-V2-`$batch` mit einem atomaren Change Set, nur mit `FunctionalLocation` und
`FunctionalLocationName` (je maximal 40 Zeichen). ABAP leitet Eltern aus Schlüsseln
ab und unterstützt die gemeinsame Anlage (kundenseitig bestätigt).
Der Header lautet `Content-Type: multipart/mixed; boundary=batch`; der Rohtext
beginnt mit `--batch` und endet mit `--batch--` (CRLF einschließlich letzter Zeile).
Die innere Change-Set-Grenze ist je Anfrage eindeutig. CSRF und SAP-Cookies bleiben im
Backend. HTTP 202 allein gilt nicht als Erfolg: innere HTTP-Antworten und Content-IDs
werden geprüft. Ein Change-Set-Fehler lehnt alle TPs ab; unvollständige oder
widersprüchliche Antworten gelten insgesamt als ungeklärt. `creationResult` prüfen;
keine automatischen POST-Retries.
Unklare Ergebnisse zuerst in SAP abgleichen. Neustarts verlieren PoC-Daten und
Duplikatsperren; produktiver Betrieb benötigt dauerhafte Persistenz und Recovery.

## 4. XSUAA-Callback und Anmeldung

Redirect-Platzhalter in `xs-security.json` durch die tatsächliche **Approuter-URL
mit `/login/callback`** ersetzen:

```bash
cd "$ROOT"
cf update-service tp-wizard-xsuaa -c xs-security.json
cf service tp-wizard-xsuaa
```

Erfolg abwarten und nach Änderungen frisch anmelden. Eigene Scopes, Authorities
und Role Collections sind nicht erforderlich. Alle Benutzer, deren Tokens die
gebundene XSUAA-Instanz akzeptiert, haben Zugriff. JWT-Prüfung bleibt aktiv;
technische Client-Credentials-Tokens dürfen nicht freigeben. Dieser breite Zugriff
ist nur für eine kontrollierte PoC-Demo geeignet.

Bei Umstellung von der früheren Rollenvariante alle drei Apps neu deployen/restagen:
`xs-security.json` allein entfernt keine Scope-Prüfung aus Approuter oder Backend.
Die XSUAA-Service-Instanz muss dafür nicht gelöscht werden.

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

- **Redeployment-Skript:** Nach `cf push --no-start` werden die Apps ausdrücklich
  mit `cf restage` neu gebaut und gestartet. `cf start` allein kann bei einer bereits
  laufenden App die alte Version weiterlaufen lassen. Bei Verwendung einer älteren
  Skriptversion alle drei Apps nach dem Upload manuell restagen.

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

- **Forbidden wegen `WizardUser`:** alte Scope-Prüfung läuft noch; neuen Approuter,
  CAP und Agent deployen/restagen. Keine Rollenzuweisung für die aktuelle Variante nötig.
- **Destination 502:** CAP-Logs, exakten Namen, Bindings, Cloud Connector und API-Rechte prüfen.
- **Werkzeuge fehlschlagen:** CAP_BASE_URL und gemeinsame XSUAA-Bindings prüfen.
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