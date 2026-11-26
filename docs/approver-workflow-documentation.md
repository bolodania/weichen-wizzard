# Freigabe-Workflow

1. Felderfassung unter `/field/` öffnen. Über den Button einreichen oder im Chat
   ausdrücklich „Mit Standardwerten zur Freigabe einreichen“ anfordern. Der Agent
   ergänzt fehlende Katalogvorgaben, erhält bestehende Antworten und reicht ein.
2. Freigabe-App unter `/approve/webapp/index.html` öffnen.
3. In der Session **Allgemein**, **Antworten** und **TP-Struktur** prüfen.
4. Antworten bei Bedarf bearbeiten und speichern; die TP-Struktur wird neu berechnet.
5. **Freigeben** prüft zunächst die Vollständigkeit. Fehlende Pflichtangaben öffnen
   einen Dialog mit lesbaren Fragen und passenden Auswahlwerten statt einer ID-Fehlermeldung.
   Nach dem Speichern die neu berechnete TP-Struktur prüfen und erneut **Freigeben** klicken.
   Erst dieser Klick bei vollständigen Angaben legt TPs an. Technische Clients dürfen nicht freigeben.

Die früheren KI-/Dokumentbereiche inklusive PDF-Upload, Analyse und Approver-Chat
sind entfernt. Die Felderfassung mit Agent und belegten Fertigmeldungswerten bleibt bestehen.

Echte SAP-Anlage ist Standard (`FL_MOCK=false`). `FL_MOCK=true` simuliert sie.
Konfiguration für echte Anlage siehe
[Deployment-Anleitung](README-deployment-cf.md). Teilfehler und ungeklärte Ergebnisse
stehen in `creationResult`; vor Wiederholung in SAP abgleichen.

PoC-Daten liegen im Speicher und gehen beim Neustart verloren.

Die Chat-Einreichung ist keine SAP-Anlage. Vorgaben bleiben als `agent-default`
erkennbar. Fehlende Angaben ohne Vorgabe öffnet die Felderfassung unmittelbar nach
Einreichung als Ergänzungsdialog. „Später ergänzen“ lässt die Session in der Freigabeliste;
die endgültige Freigabe bleibt bis zur vollständigen Erfassung gesperrt. Vorhandene
Antworten werden durch den Dialog nicht überschrieben. Es werden keine Standardwerte erfunden.
