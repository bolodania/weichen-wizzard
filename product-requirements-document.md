# Product Requirements Document (PRD)

**Titel:** TP-Wizard Weiche  
**Datum:** 2026-10-05  
**Owner:** DB InfraGO — Anlagen- und Materialmanagement  
**Solution Category:** CAP Application + AI Agent (Chatbot Stretch Goal)

---

## Produktzweck & Wertversprechen

**Elevator Pitch:**  
Neue DB InfraGO-Mitarbeiter können keine fehlerfreien SAP-Technischen-Platz-Hierarchien für Weichen anlegen, weil das Brückenwissen zwischen Eisenbahnkonstruktion und SAP-TP-Schlüsselsystematik erodiert. Der TP-Wizard führt Feldaufnehmer und Sachbearbeiter durch gezielte Klartextfragen, leitet die korrekte TP-Struktur automatisch aus einem Regelwerk ab und schreibt das Ergebnis nach SAP S/4HANA — ohne dass der Anwender einen einzigen TP-Schlüssel kennen muss.

**Geschäftlicher Bedarf:**  
Die neue WE/Forla-Struktur ist fachlich präziser als die Vorgänger-WK-Struktur, aber für neue Mitarbeiter noch schwerer handhabbar. Fehlerhafte Stammdaten fallen erst im späteren Prozess auf (IH, Auftragsabwicklung) und verursachen hohen Nachbearbeitungsaufwand. Die bestehende Dia App besitzt keine Auswahllogik und produziert systematisch Fehleingaben.

**Erwarteter Nutzen:**  
- ≥ 90 % der Technischen Plätze nach einem vollständigen Wizard-Durchlauf korrekt angelegt  
- Manuelle Nacharbeit auf ≤ 10–20 % des Aufwands reduziert  
- Wissen über TP-Schlüsselsystematik im System verankert — unabhängig von Mitarbeiterfluktuation  

**Produktziele (priorisiert):**  
1. Fehlerfreie TP-Anlage ohne SAP-Schlüsselkenntnisse ermöglichen (Kernziel)  
2. Durchgängiger Wizard-Flow für einfache und komplexe Weichen im Hackathon demonstrierbar  
3. Direkte Anlage im SAP-Fahrweg-System (A21-Sandbox) per Wizard-Bestätigung  
4. (Stretch) Natürlichsprachliche Chatbot-Eingabe als Alternative zum Formularwizard  

---

## Business Metrics

| Metrik | Baseline | Ziel | Timeline | Prozess / Capability | Quelle |
|--------|----------|------|----------|----------------------|--------|
| % der TPs korrekt nach vollständigem Wizard-Durchlauf (ohne Nacharbeit) | — (unbekannt) | ≥ 90 % | Q1 2027 (MVP) | Asset Data & Master Data Management | user |
| Verbleibender manueller Nacharbeitsanteil nach Wizard-Abschluss | — | ≤ 10–20 % | Q1 2027 | Asset Commissioning | user |

---

## Nutzerprofile & Personas

### Primäre Persona: Thomas, Sachbearbeiter Fahrbahn (Büro)

Thomas ist 34 Jahre alt, arbeitet als Instandhaltungs-Sachbearbeiter im Bereich Fahrbahn. Er legt täglich neue Anlagen in SAP Fahrweg an und pflegt Stammdaten. Er hat solide SAP-Grundkenntnisse, kennt aber die neue WE-Struktur nicht aus dem Effeff — er kommt nicht aus dem Weichenbereich. Wenn er Anlagen anlegt, bekommt er handschriftliche Aufnahmezettel oder Fotos vom Feldaufnehmer. Er sucht dann stundenlang in Z-Tabellen und fragt Kollegen, welche TP-Schlüssel für diese Konstellation gelten. Falsche Eingaben merkt er oft erst Wochen später, wenn IH-Aufträge fehlschlagen. Er wünscht sich ein System, das ihm die Schlüssel "automatisch" vorschlägt — er möchte die Eisenbahn verstehen, nicht SAP-Experte werden.

**Frustrationspunkte:** Fehlendes Domänenwissen für TP-Schlüsselauswahl; hohe Fehleranfälligkeit; spätes Fehlerfeedback; Kollegen mit Wissen scheiden aus  
**Erfolgsmessung:** Neue Weiche in < 30 Minuten korrekt angelegt; keine Rückmeldungen über Stammdatenfehler mehr

### Sekundäre Persona: Katrin, Feldaufnehmerin / Werkmeisterin Fahrbahn (mobil)

Katrin ist 41 Jahre alt, Werkmeisterin Fahrbahn. Sie steht täglich draußen an Gleisanlagen, nimmt neue oder geänderte Weichen physisch auf und dokumentiert Bauteile (Antriebe, Verschlüsse, Zungenvorrichtungen). Sie kennt die Eisenbahn sehr gut, hat aber kaum SAP-Erfahrung. Bisher füllt sie Papierformulare aus, die dann ins Büro gehen. Manchmal ruft Thomas an und fragt nach Details — das kostet beide Zeit. Sie möchte die Aufnahme direkt im Feld digital abschließen, ohne später nachgebessert werden zu müssen.

**Frustrationspunkte:** Medienbruch Papier → SAP; Rückfragen aus dem Büro; keine unmittelbare Rückmeldung, ob die Aufnahme vollständig war  
**Erfolgsmessung:** Feldaufnahme vollständig und digital; keine Rückfragen von Thomas mehr

### Weitere Stakeholder

- **Bernd Altwasser / Thorsten Dörr (DB InfraGO):** fachliche Regelwerk-Eigentümer; Abnehmer der Wizard-Logik  
- **Samet Türkyilmaz / André Brouwer (DB InfraGO):** Hackathon-Vertreter  
- **Sascha Grebenstein (DB InfraGO):** technische Integration (Cloud Connector BTP ↔ A21)  

---

## Nutzerziele & Aufgaben

### Für Thomas (Sachbearbeiter):

**Ziele:**
- Neue Weiche vollständig und korrekt in SAP anlegen, ohne TP-Schlüssel nachschlagen zu müssen  
- Sicherheit haben, dass die angelegte Struktur der Forla-Vorlage entspricht  
- Fehler vor der Anlage erkennen und korrigieren können  

**Kernaufgaben:**
- Wizard starten, Grundbauform und Standort auswählen  
- Dynamische Folgefragen beantworten (Antriebstyp, Verschlussebenen, Isolierstöße, etc.)  
- Live-TP-Vorschau prüfen; zurücknavigieren und Antworten korrigieren  
- TP-Struktur bestätigen und Massenanlage in SAP auslösen  

### Für Katrin (Feldaufnehmerin):

**Ziele:**
- Physische Weichenattribute vollständig und medienbruchfrei digital erfassen  
- Aufnahme abschließen, ohne SAP-Kenntnisse zu benötigen  

**Kernaufgaben:**
- Wizard auf mobilem Gerät öffnen  
- Fragen zur Weiche (Bauform, Bauteile, Mengen) in Klartextsprache beantworten  
- Aufnahme abschließen; Ergebnis an Sachbearbeiter übergeben oder direkt bestätigen  

---

## Produktprinzipien

1. **Sprache vor Schlüssel:** Alle Fragen und Anzeigen verwenden Eisenbahn-Klartexte — SAP-TP-Schlüssel sind für den Anwender niemals sichtbar.  
2. **Regelwerk als Single Source of Truth:** Die Entscheidungslogik (Positionsnummern, Rückbaustatus, automatische TPs) liegt ausschließlich im CAP-Backend — nicht im UI und nicht im LLM.  
3. **LLM ergänzt, ersetzt nicht:** Der Chatbot ist eine Komfortschicht über dem Regelwerk; fehlerhafte LLM-Antworten dürfen das Regelwerk nicht umgehen.  
4. **Human-in-the-Loop vor Anlage:** Der Anwender bestätigt die TP-Vorschau explizit, bevor etwas in SAP geschrieben wird.  
5. **Rücknavigation immer möglich:** Jede Antwort kann korrigiert werden; die Vorschau aktualisiert sich live.  

---

## Ist-Zustand & Geschäftskontext

**Aktueller Prozess:**  
Feldaufnehmer dokumentiert Weiche auf Papier → Sachbearbeiter übersetzt manuell in SAP-TP-Schlüssel → Fehler entstehen bei fehlenden Schlüsselkenntnissen → IH-Aufträge schlagen fehl → Nachbearbeitung. Die Dia App sendet Daten ins System, enthält aber keine Auswahllogik.

**Strategische Relevanz:**  
Die WE-Struktur (Forla) ist der neue Standard für alle Weichen bei DB InfraGO. Korrekte Stammdaten sind Voraussetzung für funktionsfähige Instandhaltungsprozesse. Der Wizard ist potenziell Blueprint für weitere Objektgruppen (Tunnel, Brücken, Gleise, Signale).

---

## Ziele und Nicht-Ziele

### Ziele (Im Scope)

- Geführte TP-Anlage für Weichen (Objektgruppe WE) auf Basis der neuen WE/Forla-Struktur  
- Unterstützung von einfachen Weichen (ca. 30 TPs) und komplexen Weichen (ca. 80 TPs) als Extremfälle  
- Live-TP-Vorschau mit Rücknavigation und Korrekturmöglichkeit  
- Bulk-Anlage der TPs in S/4HANA Fahrweg (A21-Sandbox) per API  
- Mobile Nutzbarkeit (Feldaufnahme)  
- Hackathon-Prototyp (November 2026) + produktionsfähiges MVP (Q1 2027)  
- (Stretch) LLM-Chatbot-Dialog als Alternativeingabe  

### Nicht-Ziele (Außerhalb des Scope)

- Andere Objektgruppen (Tunnel, Brücken, Gleise, Signale) — in dieser Version nicht abgedeckt  
- Nachkorrektur bereits angelegter, fehlerhafter TPs im Bestand  
- Automatische Erkennung von Weichentypen aus Fotos oder Weichenverlegeplänen  
- Ähnlichkeitssuche auf signaltechnischen Komponenten (Verschlüsse, Antriebe) für Pre-fill  
- Ablösung der Dia App in ihrer vollen Funktionsbreite  

---

## Anforderungen

### Muss-Anforderungen

**R-01: Grundbauform-Auswahl als Wizard-Einstieg**

- **Problem:** Ohne Kenntnis der Grundbauform kann keine TP-Struktur abgeleitet werden.  
- **User Story:** Als Sachbearbeiter möchte ich zu Beginn Grundbauform, Standort (DS100) und Weichennummer eingeben, damit das Regelwerk die relevanten Fragen und Positionsnummernbereiche filtert.  
- **Abnahmekriterien:**  
  - Gegeben eine Auswahl der Grundbauform (z. B. Einfache Weiche links), zeigt das System nur die für diese Bauform relevanten Fragebereiche an.  
  - Positionsnummern außerhalb des Bauform-relevanten Bereichs werden nicht als TPs generiert.  
- **Bezug zu Produktziel:** 1, 2  
- **Priorität:** 1  

**R-02: Dynamischer Fragekatalog mit Verzweigungslogik**

- **Problem:** 80+ Fragen in 19 Bereichen hängen voneinander ab; irrelevante Fragen dürfen nicht angezeigt werden.  
- **User Story:** Als Sachbearbeiter möchte ich nur die für meine bisherigen Antworten relevanten Folgefragen sehen, damit ich nicht durch irrelevante Felder navigieren muss.  
- **Abnahmekriterien:**  
  - Antwort "Federwippe: Ja" aktiviert den Hz-beweglich-Ast (Herzstückverschlüsse, Hz-Antriebe).  
  - Rückbaustatus = 0 (neue Weiche) blendet Rückbau-spezifische Fragen aus.  
  - Automatisch-TPs (STR-A/B, SW, ZSBA) werden ohne Benutzerfrage generiert.  
- **Bezug zu Produktziel:** 1, 2  
- **Priorität:** 1  

**R-03: Live-TP-Vorschau (3-Panel-Layout)**

- **Problem:** Sachbearbeiter hat keine Rückmeldung, welche TPs seine Antworten erzeugen, bis die Anlage abgeschlossen ist.  
- **User Story:** Als Sachbearbeiter möchte ich nach jeder Antwort sofort sehen, welche TPs in meiner Weiche enthalten sein werden, damit ich Fehler vor der Anlage erkennen und korrigieren kann.  
- **Abnahmekriterien:**  
  - Rechtes Panel zeigt nach jeder Antwort die aktuell abgeleiteten TPs mit Klartext-Bezeichnung.  
  - Änderung einer früheren Antwort aktualisiert die Vorschau unmittelbar.  
  - Vorschau unterscheidet visibel zwischen bestätigten und noch ausstehenden TPs.  
- **Bezug zu Produktziel:** 1, 2  
- **Priorität:** 2  

**R-04: Rücknavigation und Antwortkorrektur**

- **Problem:** Fehlerhafte frühere Antworten können die gesamte TP-Struktur verfälschen.  
- **User Story:** Als Sachbearbeiter möchte ich jederzeit zu einer früheren Frage zurücknavigieren, meine Antwort korrigieren und die aktualisierte TP-Vorschau sehen.  
- **Abnahmekriterien:**  
  - Linkes Panel zeigt den Fragenbaum mit Fortschrittsindikator; jeder abgeschlossene Bereich ist anklickbar.  
  - Nach Korrektur einer Antwort werden alle abhängigen Folgefragen und TP-Ableitungen neu berechnet.  
- **Bezug zu Produktziel:** 1  
- **Priorität:** 2  

**R-05: Bestätigung und Massenanlage in SAP**

- **Problem:** Ohne direkten SAP-Schreibzugriff bleibt der Wizard ein Planungswerkzeug ohne Prozessintegration.  
- **User Story:** Als Sachbearbeiter möchte ich nach Prüfung der TP-Vorschau per Bestätigung alle TPs automatisch in S/4HANA Fahrweg anlegen lassen.  
- **Abnahmekriterien:**  
  - Bestätigungs-Schritt zeigt Zusammenfassung der anzulegenden TPs (Anzahl, Bereiche).  
  - Nach Bestätigung werden alle TPs über die Functional Location OData API (`API_FUNCTIONALLOCATION`) angelegt.  
  - Erfolg/Fehler pro TP wird im UI rückgemeldet; bei Fehlern bleibt der Datensatz zur Nachbearbeitung offen.  
- **Bezug zu Produktziel:** 3  
- **Priorität:** 1  

**R-06: Mobile Nutzbarkeit für Feldaufnahme**

- **Problem:** Feldaufnehmer stehen draußen an der Weiche und können kein Desktop-System nutzen.  
- **User Story:** Als Feldaufnehmerin möchte ich den Wizard auf meinem Smartphone oder Tablet bedienen, damit ich die Aufnahme direkt vor Ort abschließen kann.  
- **Abnahmekriterien:**  
  - UI ist responsive und auf Mobilgeräten (iOS/Android) vollständig bedienbar.  
  - Alle Eingabefelder sind auf Touchscreens nutzbar.  
- **Bezug zu Produktziel:** 1, 2  
- **Priorität:** 3  

**R-07: Validierung gegen Forla-Maximalausprägung**

- **Problem:** Generierte TPs müssen innerhalb der Forla-Vorlage liegen — keine TP-Schlüssel außerhalb der Maximalausprägung.  
- **User Story:** Als Sachbearbeiter möchte ich sicher sein, dass der Wizard nur TPs erzeugt, die in der Forla-Vorlage für die gewählte Grundbauform vorgesehen sind.  
- **Abnahmekriterien:**  
  - Jede generierte TP-Schlüssel-Referenz ist in der Forla-Z-Tabelle nachweisbar.  
  - Ungültige Konstellationen werden vom Regelwerk abgefangen und dem Nutzer als Warnung angezeigt.  
- **Bezug zu Produktziel:** 1  
- **Priorität:** 1  

### High-Want-Anforderungen

**R-08: Offene Pflichtfelder nach Wizard-Abschluss anzeigen**

- **Problem:** ~10–20 % der TPs erfordern manuelle Nacharbeit (Felder, die der Wizard nicht ableiten kann).  
- **User Story:** Als Sachbearbeiter möchte ich nach der Massenanlage eine Liste der noch offenen Pflichtfelder pro TP sehen, damit ich die Nacharbeit gezielt und vollständig erledigen kann.  
- **Priorität:** 1  

**R-09: Vergleichsansicht Wizard vs. manuelle Suche (Demo-Feature)**

- **Problem:** Der Mehrwert des Wizards gegenüber dem manuellen Prozess ist für Stakeholder schwer sichtbar zu machen.  
- **User Story:** Als Demo-Präsentator möchte ich nebeneinander zeigen, wie lange die manuelle TP-Suche vs. der Wizard dauert ("Aha-Effekt").  
- **Priorität:** 2  

### Nice-to-Have-Anforderungen

**R-10: LLM-Chatbot-Dialogschicht (Stretch Goal)**

- **Problem:** Einige Nutzer bevorzugen natürlichsprachliche Eingabe statt Formularfelder.  
- **User Story:** Als Sachbearbeiter möchte ich eine Weiche in eigenen Worten beschreiben ("Einfache Weiche links, 2 Antriebe, 4 Isolierstöße") und vom System nach fehlenden Details gefragt werden, bis die TP-Struktur vollständig ist.  
- **Priorität:** 1  

**R-11: Ähnlichkeitssuche für Oberbau-Elemente (Pre-fill)**

- **Problem:** Gleiche Oberbau-Konfigurationen wiederholen sich in einem Bahnhof.  
- **User Story:** Als Sachbearbeiter möchte ich bei Weichen in bekannten Bahnhöfen einen Vorschlag auf Basis ähnlicher Bestandsweichen erhalten, den ich nur noch bestätigen oder anpassen muss.  
- **Priorität:** 2 (nur Oberbau — signaltechnische Komponenten explizit ausgeschlossen)  

---

## Nicht-Funktionale Anforderungen

### Performance
- **Latenz Regelwerk-Berechnung:** < 500 ms pro Frageschritt (TP-Vorschau-Aktualisierung)  
- **Latenz SAP-Schreibvorgang:** Massenanlage von bis zu 80 TPs innerhalb von 30 Sekunden  

### Zuverlässigkeit
- **Verfügbarkeit:** Hackathon-Betrieb; für MVP: > 99 % während Bürozeiten  
- **Fallback:** Bei SAP-API-Fehler zeigt der Wizard die generierten TPs zum manuellen Download (CSV-Export)  

### Erklärbarkeit
- **Nachvollziehbarkeit:** Jeder angelegte TP verweist auf den Fragepfad, der ihn erzeugt hat (Audit-Trail im CAP-Backend)  
- **Konfidenz-Kommunikation:** Offene Pflichtfelder werden nach Anlage klar als "noch auszufüllen" markiert  

---

## Lösungsarchitektur

**Architekturüberblick:**  
Drei-Schicht-Architektur auf SAP BTP: CAP-Backend als Regelwerk- und Integrations-Engine, React/UI5-Frontend als Wizard-UI, Python-AI-Agent als optionale Chatbot-Schicht (Stretch Goal). Schreibzugriff auf SAP S/4HANA Fahrweg (A21) über Cloud Connector + Functional Location OData API.

**Schlüsselkomponenten:**

- **CAP Backend (BTP):** Beherbergt Regelwerk (digitalisiert aus `Kopie von Fragen.xlsx`), Positionsnummernlogik, Forla-Vorlagenmanagement, Transformation VORLA-Prefix → konkreter TP-Schlüssel (Betriebsstelle + Weichennummer), Anbindung an S/4HANA Functional Location API  
- **React + SAP UI5 Web Components Frontend:** 3-Panel-Layout (Navigationsbaum links / Fragenbereich Mitte / TP-Vorschau rechts), responsive/mobil-fähig, kommuniziert ausschließlich mit CAP-Backend  
- **S/4HANA Fahrweg (A21-Sandbox):** Zielsystem für TP-Anlage; Quelle der Forla-Z-Tabellen und Bezeichnungsfelder; angebunden via OData API `API_FUNCTIONALLOCATION` + `FUNCNLLOCSTRUCLIST_0001`  
- **Python AI Agent (A2A, Stretch):** LLM-Chatbot-Dialogschicht, ruft CAP-Regelwerk-Endpunkte auf — ersetzt die Formular-UI, nutzt aber dieselbe Backend-Logik  

**Integrationspunkte:**

- **S/4HANA Functional Location API** (`sap.s4:apiResource:API_FUNCTIONALLOCATION:v1`): Anlage von TPs (write) und Lesen der Forla-Struktur — via Cloud Connector BTP ↔ A21  
- **S/4HANA Functional Location Hierarchy Read** (`sap.s4:apiResource:FUNCNLLOCSTRUCLIST_0001:v1`): Hierarchielesung für Vorschau und Validierung  

**Deployment-Umgebungen:**

- **Hackathon (Nov 2026):** BTP Trial / Sandbox; A21-Kopie als SAP-Zielsystem; Cloud Connector Voraussetzung  
- **MVP (Q1 2027):** BTP Production (DB InfraGO Tenant); A21 → produktive Fahrweg-Instanz  

### Agent Erweiterbarkeit & Instrumentierung

**Agent-Erweiterbarkeit (Stretch — Python AI Agent):**  
Der AI Agent ist als A2A-konformes Python-Modul aufgebaut. Erweiterungspunkte:  
- Neue Fragedomänen (weitere Objektgruppen: Tunnel, Brücken) als zusätzliche Skill-Module ohne Core-Änderung  
- Alternative LLM-Backends (GPT-4o, Gemini) per Konfiguration austauschbar  
- Neue MCP-Tools für zusätzliche SAP-APIs (z. B. Equipment API für Ausrüstungsobjekte)  

**Business-Step-Instrumentierung (Milestones als Observability-Anker):**  
Alle fünf Milestones werden als strukturierte Log-Events emittiert — sowohl im CAP-Backend als auch im AI Agent. Log-Format: `[MILESTONE_ID].[achieved|missed]: [Beschreibung]`

### Automatisierung & Agentverhalten

**Automatisierungsgrad:** Regelbasiert (CAP-Regelwerk) + Optional LLM-gestützt (AI Agent Stretch)

**Aktionen ohne menschliche Genehmigung:**
- Berechnung der TP-Vorschau auf Basis der Wizard-Antworten  
- Validierung der generierten TPs gegen Forla-Vorlage  
- Vorschlag offener Pflichtfelder nach Wizard-Abschluss  

**Aktionen mit menschlicher Genehmigung (Human-in-the-Loop):**
- Massenanlage der TPs in S/4HANA — explizite Benutzerbestätigung erforderlich  
- Überschreiben einer bereits angelegten TP-Struktur  

**Regelwerk-Engine (CAP-Backend):**  
Digitalisierter Fragenkatalog aus `Kopie von Fragen.xlsx` (19 Bereiche, 80+ Fragen). Positionsnummernlogik: Grundbauform → Positionsnummernbereiche → relevante TP-Blöcke aus der Forla. Rückbaustatus = 0 für alle Hackathon-Fälle (nur neue Weichen).

**LLM-Dialogschicht (Stretch — Python AI Agent):**  
GPT-4o oder Gemini via SAP Generative AI Hub. Agent interpretiert natürlichsprachliche Eingaben, extrahiert Wizard-Parameter, ruft CAP-Regelwerk-Endpunkte auf und fragt bei fehlenden Pflichtangaben nach.

**Wissens- und Datenquellen:**
- Forla-Z-Tabellen (SAP S/4HANA Fahrweg A21): Maximalausprägung aller TPs pro Objektgruppe  
- Excel-Filtertabellen (Thorsten Dörr / DB InfraGO): Positionsnummern-Bauform-Mapping  
- Bezeichnungsfelder (neue WE-Struktur): Klartexte für TP-Vorschau-Anzeige  

**Tools / Konnektoren:**
- `API_FUNCTIONALLOCATION` (OData, write): Anlage von Functional Locations in S/4HANA — hohes Risiko (schreibt Produktivdaten)  
- `FUNCNLLOCSTRUCLIST_0001` (OData, read-only): Lesen der Forla-Hierarchie und bestehender TP-Strukturen  
- CAP Regelwerk-API (intern, read-only): Fragenlogik, TP-Ableitung, Validierung (vom AI Agent genutzt)  

**Guardrails:**
- Keine TP-Anlage ohne explizite Benutzerbestätigung  
- Generierte TPs müssen gegen Forla-Vorlage validiert sein — ungültige Konstellationen werden blockiert  
- LLM darf Regelwerk-Logik nicht umgehen — alle TP-Ableitungen gehen durch das CAP-Backend  
- Bei API-Fehler: kein Silent-Fail; Nutzer erhält klare Fehlermeldung + Export-Fallback  

---

## Governance, Risiko & Compliance

**Datenhaltung:**  
Keine personenbezogenen Daten (PII) in Weichen-Stammdaten. Betriebsstellen-Schlüssel und Weichennummern sind interne DB-InfraGO-Betriebsdaten — kein besonderes Schutzlevel für Hackathon-Betrieb erforderlich.

**Genehmigungsflows:**  
TP-Massenanlage erfordert explizite Benutzerbestätigung im Wizard. Für den Produktivbetrieb (post-MVP): Freigabeworkflow für sicherheitsrelevante Komponenten (Signaltechnik) zu prüfen.

---

## Release-Kriterien

**Hackathon-Prototyp (November 2026):**
- Wizard führt vollständigen Flow für NI_W2006 (einfache Weiche) und NRB_W806 (komplexe Weiche) durch  
- TP-Vorschau stimmt mit erwarteter Forla-Ableitung überein  
- Massenanlage in A21-Sandbox nachweisbar  
- 3-Panel-UI demonstrierbar (auch wenn offline-fähig/mock-basiert bei fehlendem Cloud Connector)  

**MVP (Q1 2027):**
- ≥ 90 % korrekte TPs in Test-Cases NI_W2006 + NRB_W806 + mindestens 2 weiteren Beispielen  
- Cloud Connector BTP ↔ A21 (oder Produktivsystem) produktionsstabil  
- Fehlerbehandlung und offene-Pflichtfelder-Liste implementiert  
- Mobile Nutzbarkeit auf Standardgeräten (iOS/Android) getestet  

---

## Zeitplan & Meilensteine

**Ziel-Timeline:** Hackathon-Prototyp bis November 2026; produktionsfähiges MVP bis Q1 2027

**Treiber:**
- Hackathon-Deadline: 24.–27. November 2026 (Frankfurt am Main) — festes Datum  
- WE-Struktur-Rollout läuft bereits (A21 enthält erste migrierte Daten) — frühzeitige Pilotnutzung möglich  
- Generationsaltersfluktuation: Wissensträger scheiden laufend aus — jeder Monat Verzögerung erhöht das Fehlerrisiko  

---

## Meilensteine

### M1: Regelwerk betriebsbereit

- **Beschreibung:** Alle 19 Fragebereiche mit 80+ Fragen sind im CAP-Backend digitalisiert und ausführbar. Beide bekannten Lücken (Gleisstücke + Prüferschieber) sind durch Thorsten Dörr geschlossen.  
- **Erreicht wenn:** Regelwerk-Engine für NI_W2006 und NRB_W806 vollständige TP-Mengen ohne manuelle Eingriffe erzeugt.  
- **Log bei Erreichen:** `M1.achieved: Regelwerk vollständig digitalisiert — alle 19 Bereiche ausfuehrbar`  
- **Log bei Verfehlen:** `M1.missed: Regelwerk-Digitalisierung unvollstaendig — fehlende Bereiche oder Luecken`  

### M2: Einfache Weiche validiert

- **Beschreibung:** Wizard erzeugt für NI_W2006 (einfache Weiche, ca. 30 TPs) eine Vorschau, die mit der erwarteten Forla-Ableitung übereinstimmt.  
- **Erreicht wenn:** Automatisierter Test-Vergleich: generierte TP-Menge = erwartete TP-Menge für NI_W2006 (0 Abweichungen bei Pflicht-TPs).  
- **Log bei Erreichen:** `M2.achieved: Einfache Weiche NI_W2006 validiert — TP-Menge korrekt`  
- **Log bei Verfehlen:** `M2.missed: NI_W2006-Validierung fehlgeschlagen — Abweichungen in TP-Menge`  

### M3: Komplexe Weiche validiert

- **Beschreibung:** Wizard erzeugt für NRB_W806 (komplexe Weiche, ca. 80 TPs) eine korrekte Vorschau.  
- **Erreicht wenn:** Automatisierter Test-Vergleich: generierte TP-Menge = erwartete TP-Menge für NRB_W806 (≤ 5 % Abweichung bei optionalen TPs toleriert).  
- **Log bei Erreichen:** `M3.achieved: Komplexe Weiche NRB_W806 validiert — TP-Menge im Zielkorridor`  
- **Log bei Verfehlen:** `M3.missed: NRB_W806-Validierung fehlgeschlagen — Abweichung ueber Toleranz`  

### M4: SAP-Schreibzugriff bestätigt

- **Beschreibung:** Vom Wizard erzeugte TP-Struktur wird erfolgreich als Massenanlage in die A21-Sandbox geschrieben.  
- **Erreicht wenn:** ≥ 1 vollständiger Wizard-Durchlauf mit anschließender TP-Anlage in A21 ohne API-Fehler abgeschlossen.  
- **Log bei Erreichen:** `M4.achieved: SAP-Schreibzugriff A21 erfolgreich — TPs im System angelegt`  
- **Log bei Verfehlen:** `M4.missed: SAP-Schreibzugriff fehlgeschlagen — Cloud Connector oder API-Fehler`  

### M5 (Stretch): LLM-Chatbot äquivalent zu Wizard

- **Beschreibung:** Python AI Agent erzeugt per natürlichsprachlicher Eingabe eine TP-Struktur, die der des Formular-Wizards entspricht.  
- **Erreicht wenn:** Chatbot-Durchlauf für NI_W2006 produziert identische TP-Menge wie Wizard-Durchlauf.  
- **Log bei Erreichen:** `M5.achieved: LLM-Chatbot produziert aequivalente TP-Struktur — Stretchgoal erfuellt`  
- **Log bei Verfehlen:** `M5.missed: LLM-Chatbot-Ausgabe weicht von Regelwerk-Ergebnis ab`  

---

## Risiken, Annahmen und Abhängigkeiten

### Risiken

- **Cloud Connector BTP ↔ A21 fehlt:** Ohne funktionierenden Connector kann Meilenstein M4 (SAP-Schreibzugriff) nicht demonstriert werden. Mitigation: Mock-API für Hackathon-Präsentation vorbereiten.  
- **Regelwerk-Lücken (Gleisstücke + Prüferschieber):** Zwei fehlende Ast-Definitionen im Fragenkatalog blockieren korrekte TP-Ableitung für betroffene Weichen. Mitigation: Thorsten Dörr schließt Lücken vor Hackathon-Beginn; Deadline 2026-10-09.  
- **LLM-Halluzinationen bei komplexer Regellogik:** GPT/Gemini kann bei 80+ Fragen und Positionsnummernlogik fehlerhafte Konstellationen erzeugen. Mitigation: LLM-Ausgaben gehen immer durch CAP-Regelwerk-Validierung; kein direkter SAP-Schreibzugriff aus dem LLM.  
- **Sicherheitsfreigabe A21:** Erweiterte Pfadvorgaben für Cloud Connector noch nicht genehmigt. Mitigation: Sascha Grebenstein koordiniert mit Sicherheitsbeauftragtem; fallback: Read-only-Demo.  

### Annahmen

- A21-Kopie enthält bereits migrierte WE-Strukturen für mehrere Bahnhöfe (bestätigt von Thorsten Dörr, 2026-10-05).  
- Forla-Vorlagenstruktur ist stabil und ändert sich im Hackathon-Zeitraum nicht.  
- Rückbaustatus = 0 für alle Hackathon-Testfälle (nur neue Weichen).  
- Hackathon-Team (Samet Türkyilmaz + André Brouwer) kann fachliche Rückfragen klären, wenn Bernd Altwasser + Thorsten Dörr vor Ort nicht verfügbar sind.  

### Abhängigkeiten

- **Regelwerk-Vollständigkeit:** Thorsten Dörr (DB InfraGO) schließt zwei offene Lücken im Fragenkatalog bis 2026-10-09  
- **Cloud Connector:** Sascha Grebenstein (DB InfraGO) richtet BTP ↔ A21-Verbindung ein (technische Betriebsführung + Sicherheitsbeauftragter)  
- **SharePoint-Zugang:** Aleksandra Lesche / Thorsten Dörr richten Zugang für SAP-SharePoint-Ordner ein  
- **SAP Generative AI Hub:** Für Stretch Goal AI Agent; muss im BTP-Tenant der DB InfraGO verfügbar sein  

---

## Offene Fragen

- Welche Authentifizierungsmethode nutzt der Cloud Connector für den A21-Zugriff (Basic Auth / OAuth / Zertifikat)?  
- Soll der Wizard langfristig die Dia App ersetzen oder ergänzen? (Auswirkung auf Mobile-UX-Scope)  
- Wird für den MVP ein Freigabeworkflow für sicherheitsrelevante Komponenten benötigt? (Signaltechnik, Verschlüsse, Antriebe)  
- Sollen Doppelkreuzungsweichen für den Hackathon als dritter Testfall aufgenommen werden?  

---

## Anhang

### Glossar

| Begriff | Erklärung |
|---------|-----------|
| **Forla** | Vorlage — Maximalausprägung aller möglichen Technischen Plätze einer Weiche; unabhängig von der Grundbauform |
| **TP** | Technischer Platz (SAP: Functional Location) — hierarchische Einheit zur Strukturierung technischer Anlagen |
| **WE-Struktur** | Neue Weichen-Struktur (Ersatz der WK-Struktur); bildet Weichen physisch-strukturell ab |
| **Positionsnummernlogik** | TP-Blöcke sind über Nummernbereiche gegliedert; Grundbauform-Auswahl filtert relevante Bereiche |
| **Rückbaustatus** | Zentraler Steuerparameter — bestimmt, ob ein TP angelegt wird (Status 0 = neue Weiche, kein Rückbau) |
| **DS100** | Standardisiertes Betriebsstellenkürzel im DB-Konzern |
| **Zgv** | Zungenvorrichtung — Weichenteil, das die Umstellung der Zungen bewirkt |
| **Hz** | Herzstück — Kreuzungsbereich zweier Gleise in einer Weiche |
| **A21** | SAP-Systemlandschaft DB InfraGO; A21-Kopie = Sandbox-Grundlage für den Hackathon |
| **CAP** | SAP Cloud Application Programming Model — Framework für BTP-Backend-Services |
| **A2A** | Agent-to-Agent Protocol — Standard für Python AI Agents auf SAP BTP |

### Referenzen

- Use Case Canvas: `Hackathon SAP_Use Case Canvas.pdf`, Seite 6  
- Fragenkatalog (Entwurf): `Kopie von Fragen.xlsx` — Bernd Altwasser (DB InfraGO), 2026-09-22  
- Komplexbeispiel: NRB_W806 (Bfu Rohrbach/Iphofen, ~80 TPs)  
- Einfachbeispiel: NI_W2006 (Bfu Iphofen, ~30 TPs)  
- SAP Functional Location OData API: `sap.s4:apiResource:API_FUNCTIONALLOCATION:v1`  
- SAP Functional Location Hierarchy Read: `sap.s4:apiResource:FUNCNLLOCSTRUCLIST_0001:v1`  
- Nachlese Termin 1 (2026-09-14): `2026-09-14-nachlese-uc06-tp-wizard-weiche.md`  
- Nachlese Termin 2 (2026-10-05): `2026-10-05-nachlese-uc06-tp-wizard-weiche-pt2.md`  
