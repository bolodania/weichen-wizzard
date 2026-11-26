# Freigabe-Workflow

1. Felderfassung unter `/field/` öffnen. Über den Button einreichen oder im Chat
   ausdrücklich „Mit Standardwerten zur Freigabe einreichen“ anfordern. Der Agent
   ergänzt fehlende Katalogvorgaben, erhält bestehende Antworten und reicht ein.
2. Freigabe-App unter `/approve/webapp/index.html` öffnen.
3. In der Session **Allgemein**, **Antworten** und **TP-Struktur** prüfen.
4. Antworten bei Bedarf bearbeiten und speichern; die TP-Struktur wird neu berechnet.
5. **Freigeben** legt die abgeleiteten TPs an. Technische Clients dürfen nicht freigeben.

Die früheren KI-/Dokumentbereiche inklusive PDF-Upload, Analyse und Approver-Chat
sind entfernt. Die Felderfassung mit Agent und belegten Fertigmeldungswerten bleibt bestehen.

SAP-Anlage wird mit `FL_MOCK=true` simuliert. Für echte Anlage siehe
[Deployment-Anleitung](README-deployment-cf.md). Teilfehler und ungeklärte Ergebnisse
stehen in `creationResult`; vor Wiederholung in SAP abgleichen.

PoC-Daten liegen im Speicher und gehen beim Neustart verloren.

Die Chat-Einreichung ist keine SAP-Anlage. Vorgaben bleiben als `agent-default`
erkennbar; fehlende Angaben ohne Vorgabe müssen vor der endgültigen Freigabe geklärt werden.
