# TP-Wizard Weiche — Testszenarien (EWR-Regelwerk)

Die TP-Ableitung kommt ausschließlich aus dem geprüften Regelwerk (einfache Weiche rechts, **EWR**).
Golden-Kontrakt: `NI_W2006` → **25 TPs**, `NRB_W806` → **110 TPs**.

Vorbedingung — Server starten:

```bash
cd assets/tp-wizard-cap && FL_MOCK=true npm run dev                          # :4004 (CAP)
cd assets/tp-wizard-cap/app-field   && npm run dev                           # :5174 (Katrin)
cd assets/tp-wizard-cap/app-approve && npm run dev                           # :5177 (Thomas)
cd assets/tp-wizard-agent && source .env && python3 app/main.py --port 5001  # :5001 (Agent)
```

Die Datenbank ist beim Deploy mit zwei EWR-Demo-Sessions vorbefüllt:
`NI 2006` (Status *submitted*, 25 TPs) und `NRB 806` (Status *editing*, 110 TPs).

---

## Szenario 1 — Thomas prüft die geseedeten Demo-Sessions (deterministisch)

**Thomas öffnet** http://localhost:5177 (oder http://localhost:4004/approve/webapp/index.html).

1. Die Liste zeigt die beiden Demo-Sessions `NI 2006` und `NRB 806`.
2. `NRB 806` öffnen → Object Page.
3. **TP-Struktur-Tab:** exakt **110 TPs**, Eltern vor Kindern, mit Bereich, Planergruppe, Ebene.
4. **Antworten-Tab:** Spalten Bereich · Frage · Antwort · **Herkunft** · **Beleg** · Quelle.
5. `NI 2006` öffnen → **25 TPs**.

**Erwartet:** Zahlen und Suffixe stimmen mit `test/golden/ergebnis-*.csv` überein.

---

## Szenario 2 — Katrin erfasst eine neue EWR-Weiche

**Katrin öffnet** http://localhost:5174.

| Feld | Wert |
|---|---|
| Betriebsstelle (DS100) | `NRB` |
| Weichennummer | `806` |
| Grundbauform | **Einfache Weiche rechts (EWR)** (Standard) |

→ „Erfassung starten". Der Agent lädt Vorgaben (`getSmartDefaults`) und fragt die offenen,
sichtbaren Angaben ab (`getNextQuestion`). Antworten z. B.:

| Angabe (ID) | Frage (gekürzt) | Antwort |
|---|---|---|
| `zgv_ve` | Verschlussebenen Zungenvorrichtung | `8` |
| `zgv_wa` | Antriebe Zungenvorrichtung | `2` |
| `hz_bauart` | Herzstückbauart (0 starr, 1–2 beweglich) | `2` |
| `antrieb_art` | Antriebsart | `elektromechanisch` |

**Erwartet:** Die TP-Vorschau wächst mit jeder Angabe; abgeleitete Angaben (`hz_beweglich`,
`zgv_ueg`) werden nicht gefragt; A-Plätze (z. B. `STR-A`, `EV---`) erscheinen ohne Frage.
Für eine **andere Grundbauform als EWR** erscheint der Hinweis „Regelwerk fehlt" und es werden
keine TPs abgeleitet.

---

## Szenario 3 — Fertigmeldung und Belegpflicht (`applyDocumentValues`)

Werte aus einer Fertigmeldung dürfen nur mit einer **wörtlich vorkommenden Textstelle** gesetzt werden.

```bash
# Session mit Fertigmeldungstext anlegen
SID=$(curl -s -X POST http://localhost:4004/wizard/createSession \
  -H "Content-Type: application/json" \
  -d '{"ds100":"NRB","switchNumber":"806","basicForm":"EWR","fertigmeldung":"Die Zungenvorrichtung hat 8 Verschlussebenen und 2 Antriebe."}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['sessionId'])")

# Gültige Textstelle -> übernommen
curl -s -X POST http://localhost:4004/wizard/applyDocumentValues \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\",\"values\":\"[{\\\"angabe\\\":\\\"zgv_ve\\\",\\\"wert\\\":\\\"8\\\",\\\"textstelle\\\":\\\"8 Verschlussebenen\\\"}]\"}" \
  | python3 -m json.tool
# -> uebernommen: [{ questionId: zgv_ve, herkunft: Dokument, beleg: "Textstelle: …" }], abgelehnt: []

# Erfundene Textstelle -> abgelehnt (kein erfundener Wert)
curl -s -X POST http://localhost:4004/wizard/applyDocumentValues \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SID\",\"values\":\"[{\\\"angabe\\\":\\\"zgv_ve\\\",\\\"wert\\\":\\\"99\\\",\\\"textstelle\\\":\\\"99 Verschlussebenen\\\"}]\"}" \
  | python3 -m json.tool
# -> uebernommen: [], abgelehnt: [{ grund: "Textstelle … steht nicht in der Fertigmeldung" }]
```

**Erwartet:** Nur der erste Wert wird übernommen (Herkunft `Dokument`, Beleg = Textstelle);
ein nicht belegter oder typwidriger Wert wird abgelehnt.

---

## Szenario 4 — Zwei-Rollen-Workflow per curl (E2E)

```bash
# 1) Session (Katrin)
SID=$(curl -s -X POST http://localhost:4004/wizard/createSession \
  -H "Content-Type: application/json" \
  -d '{"ds100":"NI","switchNumber":"2006","basicForm":"EWR"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['sessionId'])")

# 2) Angaben setzen (EWR-Angabe-IDs aus dem Eingabenkatalog)
for QA in "zgv_ve:1" "zgv_wa:1" "hz_bauart:0"; do
  Q="${QA%%:*}"; A="${QA##*:}"
  curl -s -X POST http://localhost:4004/wizard/submitAnswer \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":\"$SID\",\"questionId\":\"$Q\",\"answer\":\"$A\",\"source\":\"katrin-confirmed\"}" >/dev/null
done

# 3) TP-Vorschau (aus dem Regelwerk)
curl -s "http://localhost:4004/wizard/getTPPreview(sessionId='$SID')" | python3 -c \
  "import sys,json; print(len(json.loads(json.load(sys.stdin)['value'])), 'TPs')"

# 4) Einreichen (Katrin)
curl -s -X POST http://localhost:4004/wizard/submitSession \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SID\"}" | python3 -m json.tool

# 5) Freigeben (Thomas) — einzige SAP-Schreiboperation
curl -s -X POST http://localhost:4004/wizard/approveSession \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SID\"}" | python3 -m json.tool
# -> { created: "[…]", failed: "[]", openFields: "[]" }
```

**CAP-Server-Log erwartet:**
```
[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs angelegt: <n>
[M5.achieved]: Zwei-Rollen-Flow vollständig — Katrin submitted, Thomas approved, SAP write success
```

---

## Sicherheitscheck — `approveSession` nicht im Agent-Toolset

```bash
python3 -c "import json; \
t=json.load(open('assets/tp-wizard-agent/cap-tools.json'))['servers']['tp-wizard-cap']['tools']; \
assert 'approveSession' not in t and 'confirmSession' not in t, 'FEHLER: Schreibaktion im Agent!'; \
assert 'applyDocumentValues' in t, 'FEHLER: applyDocumentValues fehlt!'; \
print('OK — Agent-Tools:', sorted(t))"
```

---

## Golden-Verifizierung (automatisiert)

```bash
cd assets/tp-wizard-cap
npx jest test/rule-engine.test.js      # Golden: NRB_W806=110, NI_W2006=25; Operatoren/Dreiwert-Logik
npx jest test/wizard-service.test.js   # Service, Zwei-Rollen-Workflow, applyDocumentValues
```

---

## Bekannte Einschränkungen

- Aktive Sessions leben während ihrer Laufzeit im RAM; nach CAP-Neustart werden sie aus der DB rekonstruiert (`answersJson` + `SessionAnswer`-Zeilen).
- Hinterlegt ist nur das EWR-Regelwerk; andere Grundbauformen liefern keine TPs (Hinweis „Regelwerk fehlt").
- Offene fachliche Punkte siehe [CAP-README](../assets/tp-wizard-cap/README.md) bzw. `regelwerk/README.md §5`.
