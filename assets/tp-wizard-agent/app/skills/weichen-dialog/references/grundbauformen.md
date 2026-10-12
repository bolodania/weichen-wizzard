# Grundbauformen — Unterstützte Weichentypen

| Kürzel | Bezeichnung | Beschreibung | Typische TP-Anzahl |
|--------|-------------|--------------|-------------------|
| EWL | Einfache Weiche links | Standardweiche, Abzweig nach links | ~25–35 TPs |
| EWR | Einfache Weiche rechts | Standardweiche, Abzweig nach rechts | ~25–35 TPs |
| DKW | Doppelte Kreuzungsweiche | Kreuzung mit 4 Abzweigen | ~60–100 TPs |
| EKW | Einfache Kreuzungsweiche | Kreuzung mit 2 Abzweigen | ~40–60 TPs |
| IBW | Innenbogenweiche | Weiche im Innenbogen | ~25–40 TPs |
| DW  | Dreiwegweiche | 3 Abzweige (links + rechts + gerade) | ~50–80 TPs |
| ABW | Außenbogenweiche | Weiche im Außenbogen | ~25–40 TPs |

## Referenzbeispiele

### NI_W2006 — Einfache Weiche (einfach)
- Grundbauform: EWR
- Stw-Bauform: SETEDBRU
- Herzstück: starr (Bauart 0)
- Antriebe Zgv: 1
- Elektrische Heizung: Ja
- Weichensignal: 1 (keine Lichtpunkte)
- **Ergebnis: ~18–30 TPs**

### NRB_W806 — Einfache Weiche (komplex)
- Grundbauform: EWR  
- Stw-Bauform: SELSL60N
- Herzstück: beweglich (Bauart 2) + Federwippe
- Verschlussebenen Zgv: 8
- Rollvorrichtungspaare Zgv: 11
- Antriebe Zgv: 2 + Übertragungsgestänge
- Antriebe Hz: 1 + Übertragungsgestänge
- Radsensoren: 2
- Isolierstöße: 8 Positionen
- Elektrische Heizung: Ja
- **Ergebnis: ~50–80 TPs**
