# TP-Wizard — Testszenarien

Vorbedingung: Alle drei Server laufen.

```bash
cd assets/tp-wizard-cap && FL_MOCK=true npm run dev   # :4004
cd assets/tp-wizard-cap/app-field  && npm run dev     # :5174
cd assets/tp-wizard-cap/app-approve && npm run dev    # :5175
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

**Thomas öffnet** http://localhost:5175

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

## Bekannte Einschränkungen (Hackathon)

- Sessions leben nur im RAM — nach CAP-Neustart sind alle Sitzungen weg
- Nach Freigabe landet Thomas direkt auf der (leeren) Liste ohne Erfolgsmeldung
- Antworten die Thomas bearbeitet, werden nicht in die DB zurückgeschrieben bis zur Freigabe
