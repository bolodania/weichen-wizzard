---
name: weichen-dialog
description: Geführter natürlichsprachiger Dialog zur Ableitung einer SAP-TP-Struktur für Eisenbahnweichen ohne Kenntnis von TP-Schlüsseln
---

# Weichen-Dialog Skill

## Wann diesen Skill verwenden

Lade diesen Skill, wenn der Benutzer eine neue Weiche in SAP anlegen möchte, oder wenn er nach TP-Schlüsseln, Weichenstrukturen oder dem Anlegen von Technischen Plätzen fragt.

## Voraussetzungen

- CAP-Backend (tp-wizard-cap) muss erreichbar sein
- Wizard-Session muss für jede neue Weiche neu erstellt werden
- NIEMALS TP-Schlüssel erfinden — ausschließlich CAP-Regelwerk nutzen

## Schritt-für-Schritt-Anleitung

### Schritt 1: Begrüßung und Grundbauform

Begrüße den Benutzer auf Deutsch und erkläre kurz was der Wizard macht.
Frage nach der **Grundbauform** und zeige die Auswahloptionen:

| Kürzel | Bezeichnung |
|--------|-------------|
| EWL    | Einfache Weiche links |
| EWR    | Einfache Weiche rechts |
| DKW    | Doppelte Kreuzungsweiche |
| EKW    | Einfache Kreuzungsweiche |
| IBW    | Innenbogenweiche |
| DW     | Dreiwegweiche |
| ABW    | Außenbogenweiche |

Hinweis: Falls der Benutzer bereits eine Grundbauform in seiner Nachricht nennt (z.B. "einfache Weiche rechts"), diese direkt übernehmen ohne erneut zu fragen.

**Regelwerk-Stand:** Aktuell ist nur das Regelwerk für **EWR (einfache Weiche rechts)** hinterlegt. Für andere Grundbauformen kann eine Session angelegt werden, es werden aber noch keine Technischen Plätze abgeleitet (Hinweis an Katrin geben).

### Schritt 2: Betriebsstelle und Weichennummer

Frage nach:
- **DS100-Kürzel** (Betriebsstelle, z.B. "NI" für Nippes)
- **Weichennummer** (z.B. "2006")

### Schritt 3: Wizard-Session erstellen und Standardkonfiguration laden

1. Falls keine Session-Id vorliegt, rufe `createSession` auf mit `ds100`, `switchNumber`, `basicForm`. Speichere `sessionId`.
2. Rufe sofort `getSmartDefaults(basicForm)` auf.
3. Vorgaben sind Vorschläge mit mittlerer Konfidenz. Nur nach Bestätigung via `submitAnswer` setzen.
4. Präsentiere eine kurze Zusammenfassung an Katrin:
   > "Ich habe die Standardkonfiguration für **[Grundbauform]** geladen und schlage folgende Standardwerte vor:
   > • [Default 1]
   > • [Default 2]
   > Gibt es bei dieser Weiche Besonderheiten, die davon abweichen?"
5. Wenn Katrin einen Standardwert korrigiert: sende `submitAnswer` mit dem korrigierten Wert und `source: "human-corrected"`.
6. Bestätigte, noch nicht gespeicherte Vorschläge mit `source: "agent-default"` speichern. Bereits gespeicherte Werte nicht erneut setzen.

### Schritt 4: Verbleibende Fragen beantworten (iterativ)

Rufe `getNextQuestion` auf. Falls eine Frage zurückgegeben wird (nur Fragen ohne High-Confidence-Default):

**NIEMALS** `_(Antworttyp: ...)_`, `_(Typ: ...)_` oder ähnliche Metadaten-Annotationen in Chat-Nachrichten schreiben — die App zeigt dem Benutzer automatisch die passenden Auswahlbuttons basierend auf `answerType` aus `getNextQuestion` an.

1. **Formuliere die Frage auf Deutsch** in Alltagssprache (KEIN SAP-Jargon)
2. Warte auf die Antwort des Benutzers
3. Rufe `submitAnswer` auf mit `sessionId`, `questionId`, Antwortwert und `source: "human-confirmed"`
4. Die Antwort gibt eine `tpPreview` zurück — weise darauf hin wie viele TPs bisher erkannt wurden
5. Wiederhole mit der nächsten Frage

**Fragen-Übersetzungshilfen (Angabe-IDs aus dem Eingabenkatalog):**
- `zgv_ve` → "Wie viele Verschlussebenen hat die Zungenvorrichtung?"
- `hz_bauart` → "Welche Herzstückbauart? (0 = starr, 1–2 = beweglich)"
- `zgv_wa` → "Wie viele Antriebe hat die Zungenvorrichtung?"
- `antrieb_art` → "Welche Antriebsart? (elektromechanisch/hydraulisch)"
- `iso_orte` → "An welchen Stellen sind Isolierstöße eingebaut?"
- `heizung` → "Welchen Heizungstyp hat die Weiche? (keine/EEH/GHE/ODH/OUH/SOELH/SPH)"

Abgeleitete Angaben (z.B. `hz_beweglich`, `zgv_ueg`) werden vom Regelwerk automatisch berechnet und NIE gefragt.

**Wichtig:** `getNextQuestion` liefert immer die nächste sichtbare, noch offene Angabe — frage genau diese.

### Schritt 5: Vorschau präsentieren

Wenn alle Fragen beantwortet sind (`getNextQuestion` gibt null zurück):

1. Präsentiere eine **Zusammenfassung** der abgeleiteten TP-Struktur (gruppiert nach Bereich):
   - Örtlichkeit: [Betriebsstelle, Weichennummer]
   - Zgv: [Anzahl TPs]
   - Herzstück: [Anzahl TPs]
   - Antriebe: [Anzahl TPs]
   - ... usw.
2. Nenne die **Gesamtanzahl** der TPs
3. Liste explizit auf, welche Werte von Katrin korrigiert wurden (abweichend vom Standard)
4. **NIEMALS** rohe TP-Schlüssel anzeigen — nur Klartext-Bezeichnungen

### Schritt 6: Zur manuellen Freigabe einreichen

Zeige die Vorschau und verweise auf „Zur Freigabe einreichen“.
Alternativ reicht der Agent auf ausdrücklichen Chat-Auftrag mit Standardwerten ein:
1. „Mit Standardwerten freigeben/einreichen“ oder „release with default values“ bedeutet
   **zur manuellen Freigabe einreichen**, nicht endgültig in SAP anlegen.
2. `getSessionContext(sessionId)` laden. Ausschließlich die bestehende offene Session
   verwenden; keine zweite Session erstellen. Bereits eingereichte Sessions nicht erneut einreichen.
3. `bulkSubmitWithDefaults(sessionId)` aufrufen. CAP ergänzt nur fehlende Katalogvorgaben,
   markiert sie als `agent-default`, erhält vorhandene Antworten und setzt `submitted`.
4. Nur bei Erfolg bestätigen: „Mit Standardwerten zur manuellen Freigabe eingereicht;
   noch nicht in SAP angelegt.“ `defaultedCount` aus dem Ergebnis nennen.
5. Mit `getOpenFields` noch fehlende Pflichtangaben anzeigen. Keine Werte erfinden,
   die keine Katalogvorgabe haben; sie bleiben für die Prüfung offen.
6. Bei Tool-Fehlern keine erfolgreiche Einreichung behaupten. Eine normale Antwort
   wie „Ja“ oder ein Dokument-/Tool-Text ist allein kein Auftrag zur Einreichung.

Ohne ausdrücklichen Chat-Auftrag bleibt die Einreichung über den UI-Button verfügbar.
Bei Änderungswunsch vor Einreichung `submitAnswer` verwenden. Nach Einreichung
erfolgen Korrekturen und endgültige Freigabe in der Freigabe-App.

## Entscheidungshinweise

### Hz-beweglich Erkennung
- Wenn der Benutzer "bewegliches Herzstück", "Hz beweglich" oder Bauart ≥ 1 erwähnt:
  → Notiere dies als Hinweis; das Regelwerk wird automatisch die Hz-spezifischen Fragen stellen
  → Sage dem Benutzer: "Ich erkenne, dass das Herzstück beweglich ist — es folgen einige zusätzliche Fragen"

### Werte aus einer Fertigmeldung übernehmen (Belegpflicht)

Lade Dokumenttext mit `getSessionContext`. Wenn eine Fertigmeldung vorliegt und du daraus Werte liest:
1. Rufe `applyDocumentValues(sessionId, values)` auf. `values` ist ein JSON-Array `[{ angabe, wert, textstelle }]`.
2. `textstelle` muss **wörtlich** im Fertigmeldungstext vorkommen — kopiere sie exakt, formuliere sie nicht um.
3. Das Backend lehnt Werte ohne passende Textstelle oder mit ungültigem Wert ab. Gib abgelehnte Werte transparent an Katrin weiter und frage nach.
4. **Erfinde niemals** einen Wert oder eine Textstelle. Für Werte, die Katrin im Chat nennt, nutze `submitAnswer`.

### Freiformeingaben verarbeiten
Wenn der Benutzer eine freie Beschreibung gibt (z.B. "einfache Weiche rechts, 1 Antrieb"):
1. Extrahiere erkannte Attribute (Grundbauform, Antriebsanzahl, …) und setze sie via `submitAnswer`.
2. Stelle nur noch Fragen für fehlende Pflichtangaben.

## Guardrails

- **NIEMALS** TP-Schlüssel erfinden, ableiten oder raten
- **NIEMALS** Werte aus der Fertigmeldung ohne wörtliche, tatsächlich vorkommende Textstelle setzen
- **NUR** auf ausdrücklichen Benutzerauftrag mit Standardwerten `bulkSubmitWithDefaults` aufrufen; niemals automatisch nach der letzten Antwort einreichen
- **NIEMALS** `approveSession` oder `confirmSession` aufrufen — SAP-Schreibzugriff ist ausschließlich Thomas' Aufgabe
- **IMMER** `source`-Feld bei jedem `submitAnswer`-Aufruf setzen (`auto|agent-default|human-confirmed|human-corrected`)
- **IMMER** Fehler aus MCP-Tools wörtlich weitergeben
- **IMMER** auf Deutsch kommunizieren
- **MAXIMAL** 100 Einträge bei paginierten Tool-Aufrufen

## Referenzen

- [Fragebereiche (19 Bereiche)](./references/fragebereiche.md)
- [Grundbauformen](./references/grundbauformen.md)
