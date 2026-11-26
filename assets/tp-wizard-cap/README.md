# TP-Wizard Weiche — CAP-Service

Leitet die Technischen Plätze (TP) einer Eisenbahnweiche **ausschließlich aus dem geprüften
Regelwerk** ab. Katrin (Feldaufnehmerin) erfasst die Weiche im Dialog, Thomas (Technischer
Verantwortlicher) prüft und gibt frei; erst die Freigabe legt die TPs in SAP an.

## Regelwerk als Single Source of Truth

Das gesamte Fachwissen liegt als Daten vor, nicht im Code:

| Entität | Inhalt | Quelle |
|---------|--------|--------|
| `Eingaben` (41) | Eingabenkatalog: Frage, Typ, Werte, `sichtbarWenn`, `formel`, `vorgabe`, `fuerTpNoetig` | Regelwerk |
| `Regeln` (99) | je Zeile ein TP-Muster: `muster`, `eltern`, `anzahl`, `giltFuer` | Regelwerk |
| `Bedingungen` (63) | mit `UND` verknüpfte Teilbedingungen je Regel | Regelwerk |
| `ForlaPlaetze` (348) | Bezeichnung (`N` = Laufnummer), Positionsnummer, Klassen, Planergruppe | Regelwerk |

Die Ableitung selbst ist eine **reine, deterministische Funktion** ([srv/lib/engine.js](srv/lib/engine.js)):
`ableiten(katalog, kopf, angaben) → { plaetze, angaben, offeneAngaben, hinweise }`.
Sie kennt keine weichenspezifischen Regeln — diese kommen alle aus den Daten.

- [srv/lib/katalog.js](srv/lib/katalog.js) — lädt den Katalog aus der DB (memoisiert).
- [srv/lib/weiche.js](srv/lib/weiche.js) — Zustand, Wertprüfung, Herkunft/Beleg, Übernahme von
  Fertigmeldungswerten mit wörtlicher Textstelle, Mapping auf `DerivedTP`.
- [srv/wizard-service.js](srv/wizard-service.js) — Service-Handler und Zwei-Rollen-Workflow.

**Stand:** Hinterlegt ist nur das Regelwerk für **EWR (einfache Weiche rechts)**. Andere
Grundbauformen sind wählbar, liefern aber keine Ableitung (Hinweis „Regelwerk fehlt"), bis ihr
Regelwerk ergänzt ist.

## Fertigmeldung und Belegpflicht

Werte, die der KI-Agent aus einer Fertigmeldung liest, werden über die Aktion
`applyDocumentValues(sessionId, values)` gesetzt. Jeder Wert braucht eine **wörtliche Textstelle**,
die exakt im Fertigmeldungstext (`WizardSession.fertigmeldung`) vorkommt, und muss die Typprüfung
bestehen — sonst wird er abgelehnt. Der Agent setzt nie TPs und erfindet keine Werte.

## Regelwerk aktualisieren

Die Seed-Daten werden nicht abgetippt, sondern aus den Regelwerk-CSVs erzeugt:

```bash
python scripts/regelwerk-uebernehmen.py <pfad-zum-regelwerk-ordner>
cds deploy                 # Stammdaten + Golden-Fixtures neu laden
npx jest test/rule-engine.test.js
```

Das Skript schreibt `db/data/tp.wizard.{Eingaben,Regeln,Bedingungen,ForlaPlaetze}.csv` und kopiert
`GoldenEingaben.csv` + `ergebnis-*.csv` nach `test/golden/`.

## Starten

Voraussetzung: **Node.js >= 22.12**. Für die lokale PoC-Demo bleibt SQLite im Speicher;
ein Neustart setzt neu erfasste Daten zurück. Nur **EWR** ist fachlich unterstützt.

```bash
npm install
FL_MOCK=true npm start  # SAP-Anlage simulieren; alternativ FL_MOCK=true npm run dev
```

Der SAP-Schreibpfad ist über `FL_MOCK=true` abschaltbar (Offline-Demo/Tests).

```bash
npm run build      # CAP + aktuelle app-field bauen (nicht den alten React-Wizard)
```

- Felderfassung nach dem Build: `http://localhost:4004/field/`
- Freigabe: `http://localhost:4004/approve/webapp/index.html`
- Der Chat benötigt weiterhin den separat gestarteten Python-Agenten. `AGENT_URL`
  ist standardmäßig `http://127.0.0.1:5000/`; CAP leitet `/agent` dorthin weiter.
  Die IPv4-Adresse vermeidet unter macOS den AirPlay-Dienst, der auf Port 5000
  über `localhost`/IPv6 statt des Python-Agenten antworten kann (HTTP 403).
- Die Einreichung darf offene Angaben zur Prüfung enthalten. **Freigabe** wird dagegen
  bei fehlenden Pflichtangaben oder leerer TP-Struktur mit HTTP 422 abgewiesen.
- PDF-Textextraktion nutzt optional `pdftotext` (Poppler). Ohne dieses Programm ist
  keine PDF-Extraktion möglich; alternativ UTF-8-Textdateien hochladen. Defekte PDFs
  werden abgewiesen, nicht aus Rohbytes interpretiert. Keine OCR verfügbar.
- Echter SAP-Zugriff wird ausdrücklich mit `FL_MOCK=false` aktiviert; siehe unten.

## Cloud Foundry: XSUAA und HTTPS

Siehe [Deployment-Anleitung](../../docs/README-deployment-cf.md). Die Manifeste binden
`tp-wizard-xsuaa`; Browserzugriff erfolgt über den Approuter, ohne interne Routen.

## SAP-Anlage nach manueller Freigabe

`FL_MOCK=true` simuliert die Anlage. Für echte POSTs ausdrücklich `FL_MOCK=false`
und `FL_ENTITY_SET` setzen. Destination, Service-Pfad und Protokollversion werden
aus der vorhandenen `VALUE_HELP_*`-Konfiguration übernommen; keine zweite Destination.
Der bestätigte Vertrag ist OData V2: `tpKey` → `FunctionalLocation`,
`tpLabel` → `FunctionalLocationName`, jeweils maximal 40 Zeichen, ohne Kürzung.
Andere Attribute (Eltern, Klassen, Planergruppe) werden nicht übertragen.

Je abgeleitetem TP einschließlich Wurzel erfolgt ein POST nach CSRF-Token-/Cookie-Abruf.
Nur angemeldete Benutzer können freigeben. Konfiguration und alle Payloads werden
vor dem ersten SAP-Aufruf geprüft. Ergebnisse je TP stehen in `creationResult`;
Teilfehler führen zu `failed`. Erneute Freigaben sind gesperrt, POSTs werden nicht
automatisch wiederholt. `unknown` erfordert Abgleich in SAP, nicht blindes Wiederholen.
Kein atomarer SAP-Batch: erfolgreiche Teilanlagen bleiben bestehen.

Die PoC-Datenbank bleibt im Speicher; Neustarts verlieren Ergebnisse und Sperren.
Auch DB-Rollback nach externem POST kann SAP nicht zurückrollen. Vor produktivem
Einsatz sind dauerhafte Persistenz und ein Recovery-/Abgleichverfahren erforderlich.

## Tests

### Destination-basierte Value Help (erstes Feld)

Die Auswahl lädt über CAP und SAP Cloud SDK aus einer BTP-Destination. Der Browser
erhält nur Code/Bezeichnung, keine Destination-Credentials. Suchtext und Seiten werden
serverseitig an OData weitergegeben (30 Einträge pro Seite).

Der Destination-Name hat keinen Standardwert und muss pro Landschaft über
`VALUE_HELP_DESTINATION` gesetzt werden. Service-Pfad, EntitySet und Feldzuordnung
auf den Betriebsstellen-Service des Kunden konfigurieren. Die Suche verwendet
exakte Gleichheit auf der konfigurierten String-Code-Eigenschaft; die Bezeichnung
dient nur der Anzeige. Der ausgewählte Code wird unverändert als `ds100` verwendet
(maximal 10 Zeichen). Die Filterunterstützung im Zielservice muss geprüft werden.

Konfiguration ohne Codeänderungen, siehe `.env.example`:

| Variable | Bedeutung |
|---|---|
| `VALUE_HELP_DESTINATION` | BTP-Destination-Name |
| `VALUE_HELP_SERVICE_PATH` | Server-relativer Service-Pfad |
| `VALUE_HELP_ENTITY_SET` | EntitySet für die Auswahl |
| `VALUE_HELP_KEY_FIELD` | Eigenschaft mit dem auszuwählenden Code |
| `VALUE_HELP_TEXT_FIELD` | Eigenschaft mit der Bezeichnung |
| `VALUE_HELP_ODATA_VERSION` | `2` oder `4` |

CAP lädt eine lokale `.env`; danach Server neu starten. Alternativ Variablen in der
Deployment-Umgebung setzen. Alle sechs `VALUE_HELP_*`-Variablen sind erforderlich;
es gibt keine API-Standardwerte oder `cds.valueHelp`-Fallbacks. Platzhalter aus
`.env.example` ersetzen. Bei fehlender Konfiguration liefert die Auswahl HTTP 503
mit dem Namen der erforderlichen Variable.

**Voraussetzungen bei PrincipalPropagation:** Für eine `OnPremise`-Destination mit
`PrincipalPropagation` werden Destination-Service- und Connectivity-Service-Bindings,
ein erreichbarer Cloud Connector und ein authentifizierter Benutzer mit gültigem JWT
benötigt. CAP übergibt das eingehende Bearer-JWT an die Destination-Auflösung.
Eine lokale CAP-Session mit Mock-Authentifizierung stellt **kein solches JWT** bereit.
Die Destination im Cockpit allein genügt deshalb nicht für den lokalen Zugriff.
Für Hybridtests die Services per `cds bind` anbinden und einen authentifizierten Zugang
(z. B. Approuter) verwenden, oder eine separate, für lokale Tests geeignete Destination
konfigurieren. Keine Credentials ins Frontend oder Repository kopieren.

`FL_MOCK=true` betrifft nur TP-Anlage, nicht die Value Help. Bei fehlender Verbindung
zeigt die Auswahl einen Fehler statt erfundener Werte. Die Weichennummer akzeptiert
nur 1–7 Ziffern, inklusive führender Nullen; dies wird auch im Backend geprüft.

```bash
npx jest test/rule-engine.test.js     # Golden-Kontrakt + Operatoren/Dreiwert-Logik
npx jest test/wizard-service.test.js  # Service, Zwei-Rollen-Workflow, Zitatpflicht
```

Golden-Kontrakt: Für die geprüften Beispielweichen liefert die Ableitung **exakt** die Suffixe aus
`test/golden/ergebnis-*.csv` — **NRB_W806 = 110 TPs**, **NI_W2006 = 25 TPs** — und keine offenen Angaben.

## Offene fachliche Punkte (aus `regelwerk/README.md §5`)

Diese Punkte sind im Regelwerk noch offen und werden nicht eigenmächtig entschieden; die Golden-
Erwartung (110/25) enthält bewusst die dort dokumentierten „zu viel"-Zeilen:

1. **Radsensoren** (Regel 67, `rsa`): ein TP je Sensor oder ein TP für alle?
2. **Hz-Verschlussfachabdeckung** (Regel 56, `hz_vsfa`): je Verschlussebene oder nur ausgewählte?
3. **Übertragungsgestänge / Prüferschieber je Antrieb** (Regeln 41, 42): gilt die Kundenliste (je Antrieb)?
4. **Herzstückbauart 0–6** (`hz_bauart`, Regeln 51, 57): Bedeutung je Wert; nur 1–2 = beweglich.
5. **Lichtpunkte je Signal** (Regel 81): Zählung bei mehr als einem Signal.
6. **Heizungs-Klassen** außer elektrisch (Regeln 92–96): Klassen in der Forla fehlen noch.
7. **Prellbock / Hemmschuhauswurfvorrichtung** (Regeln 110–127): Existenz ohne Gleisstück?
8. **Handbuch-Hinweise**: 8 Einträge, bei denen der TP-Schlüssel nicht zur Überschrift passt.
