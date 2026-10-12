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

Hinweis: Falls der Benutzer bereits eine Grundbauform in seiner Nachricht nennt (z.B. "einfache Weiche links"), diese direkt übernehmen ohne erneut zu fragen.

### Schritt 2: Betriebsstelle und Weichennummer

Frage nach:
- **DS100-Kürzel** (Betriebsstelle, z.B. "NI" für Nippes)
- **Weichennummer** (z.B. "2006")

### Schritt 3: Wizard-Session erstellen und Standardkonfiguration laden

1. Rufe `createSession` via MCP-Tool auf mit `ds100`, `switchNumber`, `basicForm`. Speichere `sessionId`.
2. Rufe sofort `getSmartDefaults(basicForm)` auf.
3. Sende alle High-Confidence-Defaults automatisch via `submitAnswer` mit `source: "agent-default"`.
4. Präsentiere eine kurze Zusammenfassung an Katrin:
   > "Ich habe die Standardkonfiguration für **[Grundbauform]** geladen und folgende Standardwerte gesetzt:
   > • [Default 1]
   > • [Default 2]
   > Gibt es bei dieser Weiche Besonderheiten, die davon abweichen?"
5. Wenn Katrin einen Standardwert korrigiert: sende erneut `submitAnswer` mit `source: "katrin-corrected"`.
6. Wenn Katrin einen Standardwert bestätigt: sende `submitAnswer` mit `source: "katrin-confirmed"`.

### Schritt 4: Verbleibende Fragen beantworten (iterativ)

Rufe `getNextQuestion` auf. Falls eine Frage zurückgegeben wird (nur Fragen ohne High-Confidence-Default):

1. **Formuliere die Frage auf Deutsch** in Alltagssprache (KEIN SAP-Jargon)
2. Warte auf die Antwort des Benutzers
3. Rufe `submitAnswer` auf mit `sessionId`, `questionId`, Antwortwert und `source: "katrin-confirmed"`
4. Die Antwort gibt eine `tpPreview` zurück — weise darauf hin wie viele TPs bisher erkannt wurden
5. Wiederhole mit der nächsten Frage

**Fragen-Übersetzungshilfen:**
- `anzahlVerschlussebenenZgv` → "Wie viele Verschlussebenen hat die Zungenvorrichtung?"
- `herzstückbauart` → "Ist das Herzstück starr (0) oder beweglich (Bauart 1+)?"
- `federwippe` → "Ist eine Federwippe vorhanden? (Ja/Nein)"
- `anzahlAntriebeZgv` → "Wie viele Weichenantriebe hat die Zungenvorrichtung?"
- `isoPositions` → "An welchen Stellen sind Isolierstöße eingebaut?"
- `heizungTyp` → "Welchen Heizungstyp hat die Weiche? (elektrisch/gas/öl/dampf/keine)"

**Wichtig:** Falls der Benutzer "Hz ist beweglich" oder ähnliches erwähnt, notiere sofort dass die Fragen zum beweglichen Herzstück folgen werden.

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

### Schritt 6: Einreichung zur Freigabe weiterleiten

Frage explizit: "Soll ich die Einreichung mit [N] Technischen Plätzen zur Freigabe an Thomas weiterleiten?"

Warte auf eine klare Bestätigung ("Ja", "Bestätigen", "Weiterleiten", "Ja, bitte").

Bei Änderungswunsch: Verarbeite die Korrektur (zurück zu Schritt 4) und präsentiere die neue Vorschau.

**NIEMALS `submitSession` aufrufen ohne explizite Bestätigung.**
**NIEMALS `approveSession` aufrufen — das ist ausschließlich Thomas' Aufgabe.**

### Schritt 7: Einreichung und Bestätigung

Rufe `submitSession` auf mit der `sessionId`.

Berichte das Ergebnis:
- Bei Erfolg: "✅ Einreichung [sessionId] wurde erfolgreich an Thomas zur Freigabe weitergeleitet. Du erhältst keine weitere Benachrichtigung — Thomas prüft und gibt frei."
- Bei Fehler: Gib die Fehlermeldung wörtlich aus

Log: `[M5.achieved]: Zwei-Rollen-Flow vollstaendig durchlaufen — Katrin submitted`

## Entscheidungshinweise

### Hz-beweglich Erkennung
- Wenn der Benutzer "bewegliches Herzstück", "Hz beweglich" oder Bauart ≥ 1 erwähnt:
  → Notiere dies als Hinweis; das Regelwerk wird automatisch die Hz-spezifischen Fragen stellen
  → Sage dem Benutzer: "Ich erkenne, dass das Herzstück beweglich ist — es folgen einige zusätzliche Fragen"

### Freiformeingaben verarbeiten
Wenn der Benutzer eine freie Beschreibung gibt (z.B. "einfache Weiche links, 1 Antrieb, elektrische Heizung"):
1. Extrahiere erkannte Attribute:
   - Grundbauform aus Beschreibung
   - Antriebsanzahl aus Nennung von Zahlen + "Antrieb"
   - Heizungstyp aus direkter Nennung
2. Erstelle Session und beantworte bekannte Fragen automatisch
3. Stelle nur noch Fragen für fehlende Pflichtattribute

## Guardrails

- **NIEMALS** TP-Schlüssel erfinden, ableiten oder raten
- **NIEMALS** `submitSession` ohne explizite Nutzerbestätigung aufrufen
- **NIEMALS** `approveSession` oder `confirmSession` aufrufen — SAP-Schreibzugriff ist ausschließlich Thomas' Aufgabe
- **IMMER** `source`-Feld bei jedem `submitAnswer`-Aufruf setzen (`auto|agent-default|katrin-confirmed|katrin-corrected`)
- **IMMER** Fehler aus MCP-Tools wörtlich weitergeben
- **IMMER** auf Deutsch kommunizieren
- **MAXIMAL** 100 Einträge bei paginierten Tool-Aufrufen

## Referenzen

- [Fragebereiche (19 Bereiche)](./references/fragebereiche.md)
- [Grundbauformen](./references/grundbauformen.md)
