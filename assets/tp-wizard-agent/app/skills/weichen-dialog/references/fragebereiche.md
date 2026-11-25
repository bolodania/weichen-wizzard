# Fragebereiche — Eingabenkatalog des Regelwerks

Die Fragen stammen vollständig aus dem Eingabenkatalog (`Eingaben`, 41 Angaben). Jede Angabe trägt
ihren fachlichen **Bereich**, den Fragetext, den Typ und ggf. eine Sichtbarkeitsbedingung (`sichtbarWenn`),
eine Formel (`formel` → abgeleitet, wird nie gefragt) oder eine Vorgabe (`vorgabe` → Standardwert).

Der Agent fragt NICHT nach festen Bereichen, sondern folgt `getNextQuestion`, das die nächste sichtbare,
noch offene, nicht abgeleitete Angabe liefert.

## Bereiche (in Katalogreihenfolge)

| Bereich | Inhalt |
|---------|--------|
| Grunddaten | Grundbauform, Radius, Rückbaustatus |
| Zungenvorrichtung | Verschlussebenen, Rollvorrichtungen, Zungenprüfer, Handverschlüsse … |
| Herzstück | Bauart (0 = starr, 1–2 = beweglich), Verschlussebenen, Rollvorrichtungen |
| Radlenker | Radsensoren |
| Antrieb | Antriebsart (elektromechanisch/hydraulisch), Anzahl Antriebe Zgv/Hz |
| Weichensignal | Anzahl Signale, Lichtpunkte je Signal |
| Weichensteuerung | SIWES |
| Weichenüberwachung | Weichenüberwachung |
| Gleisstücke | Einbauorte Gleisstücke |
| Prellbock | Prellbock, Hemmschuh-Einbauorte |
| Hemmschuhauswurfvorrichtung | HAV-Einbauorte |
| Isolierstöße | Einbauorte der Isolierstöße (Mehrfachauswahl) |
| Weichenheizung | Heizungstyp (keine/EEH/GHE/ODH/OUH/SOELH/SPH) |

## Angabe-Typen

| Typ | Bedeutung |
|-----|-----------|
| Menge | ganze Zahl ≥ 0 (auch als Anzahl für Laufnummern) |
| Zahl | Dezimalzahl |
| JaNein | Ja / Nein |
| Auswahl | genau ein Wert aus der Werteliste |
| Einbauorte | mehrere Werte aus der Werteliste (Mehrfachauswahl) |
| Text | Freitext |

## Abgeleitete Angaben (werden nie gefragt)

- `hz_beweglich` = `hz_bauart BT 1;2`
- `hydraulisch` = `antrieb_art EQ hydraulisch`
- `zgv_ueg` = `zgv_wa GE 1 UND zgv_ve GT @zgv_wa`
- `hz_ueg` = `hz_beweglich EQ Ja UND hz_wa GE 1 UND hz_ve GT @hz_wa`

Automatisch angelegte TPs (Regeln ohne Bedingung, z.B. Stränge `STR-A`, Erdung `EV---`) erfordern keine Frage.
