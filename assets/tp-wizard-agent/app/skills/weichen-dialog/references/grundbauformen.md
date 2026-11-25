# Grundbauformen — Unterstützte Weichentypen

Das geprüfte Regelwerk deckt aktuell **ausschließlich die EWR (einfache Weiche rechts)** ab.
Alle 99 Regeln gelten für `giltFuer = EWR`. Für andere Grundbauformen kann eine Session
angelegt werden, es werden aber noch keine Technischen Plätze abgeleitet (Hinweis an Katrin geben),
bis deren Regelwerk ergänzt ist.

| Kürzel | Bezeichnung | Regelwerk |
|--------|-------------|-----------|
| EWR | Einfache Weiche rechts | ✅ vorhanden |
| EWL | Einfache Weiche links | — (noch nicht hinterlegt) |
| DKW | Doppelte Kreuzungsweiche | — |
| EKW | Einfache Kreuzungsweiche | — |
| IBW | Innenbogenweiche | — |
| DW  | Dreiwegweiche | — |
| ABW | Außenbogenweiche | — |

## Referenzbeispiele (Golden-Fälle)

Die Ableitung wird deterministisch gegen diese beiden geprüften Beispielweichen getestet
(`test/golden/ergebnis-*.csv`).

### NI_W2006 — EWR, starres Herzstück
- Grundbauform: EWR
- Herzstückbauart: 0 (starr)
- Verschlussebenen Zgv: 1, ein Antrieb
- **Ergebnis: exakt 25 TPs**

### NRB_W806 — EWR, bewegliches Herzstück
- Grundbauform: EWR
- Herzstückbauart: 2 (beweglich)
- Verschlussebenen Zgv: 8, zwei Antriebe; Herzstück mit eigenen Verschlussebenen
- **Ergebnis: exakt 110 TPs**
