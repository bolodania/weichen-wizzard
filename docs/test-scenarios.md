# TP-Wizard — Testszenarien

Vorbedingung: Alle drei Server laufen.

```bash
cd assets/tp-wizard-cap && FL_MOCK=true npm run dev   # :4004
cd assets/tp-wizard-cap/app-field  && npm run dev     # :5174
cd assets/tp-wizard-cap/app-approve && npm run dev    # :5177
```

---

## Szenario 1 — Standard EWL (einfachster Weg)

**Katrin öffnet** http://localhost:5174

### Einstiegsformular

| Feld | Wert |
|---|---|
| Betriebsstelle (DS100) | `NI` |
| Weichennummer | `2006` |
| Grundbauform | Einfache Weiche links (EWL) |

→ "Erfassung starten"

### Chatdialog

Der Agent setzt automatisch: `rückbauStatus=0`, `prellbock=false`.
Für alle weiteren Fragen diese Werte eingeben:

| Frage (gekürzt) | Antwort |
|---|---|
| Stellwerks-Bauform | `SELSL60N` |
| Verschlussebenen Zgv | `1` |
| Zungenrollvorrichtungspaare | `0` |
| Federwippe vorhanden? | `false` |
| Herzstück-Bauart | `0` |
| Radsensoren | `0` |
| Antriebe an der Zgv | `1` |
| Antrieb hydraulisch? | `false` |

→ Alle Fragen beantwortet → "Einreichen"

**Erwartet:** TP-Vorschau zeigt mehrere TPs; Erfolgsmeldung mit Session-ID.

---

## Szenario 2 — DKW mit beweglichem Herzstück (komplexer)

**Katrin öffnet** http://localhost:5174

### Einstiegsformular

| Feld | Wert |
|---|---|
| Betriebsstelle (DS100) | `FF` |
| Weichennummer | `105` |
| Grundbauform | Doppelte Kreuzungsweiche (DKW) |

### Chatdialog

Agent setzt automatisch: `rückbauStatus=0`, `prellbock=false`, `herzstückbauart=2` (beweglich), `federwippe=true`.

| Frage (gekürzt) | Antwort |
|---|---|
| Stellwerks-Bauform | `SELSL60N` |
| Verschlussebenen Zgv | `2` |
| Zungenrollvorrichtungspaare | `1` |
| Federwippe vorhanden? | `true` |
| Herzstück-Bauart | `2` |
| Verschlussebenen Herzstück | `1` |
| Herzstück-Rollpaare | `0` |
| Radsensoren | `0` |
| Antriebe an der Zgv | `2` |
| Antriebe am Herzstück | `1` |
| Antrieb hydraulisch? | `false` |

→ Einreichen

**Erwartet:** Mehr TPs als Szenario 1 (bewegliches Hz erzeugt zusätzliche TP-Positionen).

---

## Thomas-Freigabe (beide Szenarien)

**Thomas öffnet** http://localhost:5177

1. Session in der Liste sehen (Status: *Eingereicht*)
2. Draufklicken → Object Page öffnet sich
3. Antworten prüfen — amber markierte Zeilen = Agentannahmen
4. Optional: Wert per Bleistift-Icon bearbeiten
5. "Freigeben" → Bestätigungsdialog → "Freigeben"

**Erwartet:** `FL_MOCK=true` → Dummy-Ergebnis; CAP-Log zeigt:
```
[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich
[M5.achieved]: Zwei-Rollen-Flow vollstaendig durchlaufen
```

---

## Szenario 3 — Vollständiger Zwei-Rollen-Workflow (E2E-Verifizierung)

Getestet am 2026-10-13. Dieses Szenario prüft den gesamten Workflow von Katrins Erfassung bis zu Thomas' Freigabe und bestätigt, dass `approveSession` die einzige SAP-Schreiboperation ist.

### Schritt 1: Session anlegen (Katrin — curl oder app-field)

**Option A: curl (schnell, kein Agent nötig)**

```bash
# Session erstellen
curl -s -X POST http://localhost:4004/wizard/createSession \
  -H "Content-Type: application/json" \
  -d '{"ds100":"NI","switchNumber":"2006","basicForm":"EWL"}' | python3 -m json.tool
# → {"sessionId":"<uuid>","message":"Session erstellt"}

SID=<uuid aus obiger Ausgabe>

# Smart Defaults laden (Agent würde das tun)
curl -s "http://localhost:4004/wizard/getSmartDefaults(basicForm='EWL')" | python3 -m json.tool
# → rückbauStatus="keine", prellbock=false werden als agent-default gesetzt

# Antworten einreichen — agent-default Werte
curl -s -X POST http://localhost:4004/wizard/submitAnswer \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\",\"questionId\":\"rückbauStatus\",\"answer\":\"keine\",\"source\":\"agent-default\"}"
curl -s -X POST http://localhost:4004/wizard/submitAnswer \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\",\"questionId\":\"prellbock\",\"answer\":\"false\",\"source\":\"agent-default\"}"

# Antworten einreichen — von Katrin bestätigt
for QA in \
  "stellwerksBauform:SELSL60N" \
  "verschlussebenenZgv:2" \
  "zungenrollvorrichtungspaare:1" \
  "federwippe:false" \
  "herzstückbauart:0" \
  "radsensoren:0" \
  "weichenantriebe:1" \
  "hydraulischeAntriebe:false" \
  "weichensignale:0" \
  "dezentraleWeichensteuerung:false" \
  "weichenüberwachung:false" \
  "isolierstöße:keine" \
  "hemmschuhauswurfvorrichtungen:keine" \
  "gleisstückWeichenspitze:false" \
  "gleisstückEndbereichA:false" \
  "gleisstückEndbereichB:false" \
  "erdung:false" \
  "weichenheizung:keine"; do
  Q="${QA%%:*}"; A="${QA##*:}"
  curl -s -X POST http://localhost:4004/wizard/submitAnswer \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":\"$SID\",\"questionId\":\"$Q\",\"answer\":\"$A\",\"source\":\"katrin-confirmed\"}"
done

# TP-Vorschau prüfen (erwartet: 13 TPs)
curl -s "http://localhost:4004/wizard/getTPPreview(sessionId='$SID')" | python3 -c \
  "import sys,json; tps=json.loads(json.load(sys.stdin)['value']); print(f'{len(tps)} TPs')"
# → 13 TPs

# Session einreichen
curl -s -X POST http://localhost:4004/wizard/submitSession \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\"}" | python3 -m json.tool
# → {"sessionId":"...","message":"Einreichung erfolgreich — wartet auf Freigabe durch Thomas"}
```

**Option B: app-field mit Agent**

1. http://localhost:5174 öffnen
2. DS100=`NI`, Weiche=`2006`, Grundbauform=`EWL`, "Erfassung starten"
3. Antworten wie in Szenario 1, dann Agent ruft `submitSession` auf
4. **Erwartet:** Erfolgsmeldung mit korrekter Session-ID (nicht "null") und TP-Anzahl

### Schritt 2: app-approve (Thomas)

1. http://localhost:5177 öffnen
2. **Erwartet:** Tabelle zeigt 1 Eintrag — `NI | 2006 | EWL | Eingereicht | 13 TPs | 2 offen`

### Schritt 3: Object Page

3. Auf die Zeile klicken → Object Page öffnet sich
4. **Header:** `NI W2006 — EWL` · Status: `Eingereicht` · `2 Agentannahmen`
5. **Hinweise-Tab:** Warnung `⚠ 2 Agentannahmen nicht geprüft — rückbauStatus, prellbock`
6. **Antworten-Tab:**
   - `rückbauStatus = keine` mit Chip `AGENT-STANDARD` (orange)
   - `prellbock = false` mit Chip `AGENT-STANDARD` (orange)
   - Alle übrigen 18 Antworten mit Chip `BESTÄTIGT` (grün)
7. **TP-Vorschau-Tab:** `TP-Vorschau (13 TPs)` mit Gruppen Objektgruppe(1), Zgv(1), Herzstück(1), Radlenker(2), Stränge(2), Schwellen(1), Zwischenschiene(5)

### Schritt 4: Freigabe

8. Schaltfläche "Freigeben" klicken
9. **Dialog:** `13 Technische Plätze werden in SAP S/4HANA angelegt. Davon basieren 2 Einträge auf Agentannahmen...`
10. "Freigeben" im Dialog bestätigen
11. **Erwartet:** Zurück zur Liste — `Ausstehende Einreichungen (0)`, leerer Zustand

### Verifizierung

```bash
# Session-Status in der DB prüfen
curl -s "http://localhost:4004/wizard/Sessions" | python3 -c \
  "import sys,json; ss=json.loads(sys.stdin.read()); \
   [print(s['sessionId'][:8],'status='+s['status']) for s in ss.get('value',[])]"
# → <uuid-prefix> status=created

# Keine ausstehenden Sessions mehr
curl -s "http://localhost:4004/wizard/listPendingSessions()" | python3 -m json.tool
# → {"value":"[]"}
```

**CAP-Server-Log erwartet:**
```
[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs im System angelegt: 13
[M5.achieved]: Zwei-Rollen-Flow vollstaendig durchlaufen — Katrin submitted, Thomas approved, SAP write success
```

**Sicherheitscheck:** `approveSession` darf NICHT im MCP-Tool-Set des Agenten erscheinen:
```bash
cat assets/tp-wizard-agent/mcp-mock.json | python3 -c \
  "import sys,json; tools=[t['name'] for t in json.load(sys.stdin)['tools']]; \
   assert 'approveSession' not in tools, 'FEHLER: approveSession im Agent!'; \
   print('OK — approveSession nicht im Agent:', tools)"
```

---

## Bekannte Einschränkungen (Hackathon)

- Sessions leben nur im RAM — nach CAP-Neustart sind alle Sitzungen weg
- Nach Freigabe landet Thomas direkt auf der (leeren) Liste ohne Erfolgsmeldung
- Antworten die Thomas bearbeitet, werden nicht in die DB zurückgeschrieben bis zur Freigabe
