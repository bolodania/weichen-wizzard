"""Übernimmt das geprüfte EWR-Regelwerk (CSV-Ausgabe von pruefung.py) in die CAP-App.

Aufruf:
    python scripts/regelwerk-uebernehmen.py <Ordner mit csv/ und ergebnis-*.csv>

Schreibt db/data/tp.wizard.<Entity>.csv (Seed-Stammdaten) und test/golden/*.csv (Golden-Fixtures).
Die Daten werden nicht abgetippt, sondern ausschließlich aus den Quell-CSVs erzeugt.
"""
import csv
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 2:
    sys.exit("Aufruf: python scripts/regelwerk-uebernehmen.py <regelwerk-ordner>")

QUELLE = Path(sys.argv[1]).resolve()
ZIEL = Path(__file__).resolve().parent.parent

(ZIEL / "test" / "golden").mkdir(parents=True, exist_ok=True)


def lies(name):
    with open(QUELLE / "csv" / name, encoding="utf-8") as f:
        return list(csv.reader(f, delimiter=";"))


def schreibe(pfad, zeilen):
    with open(ZIEL / pfad, "w", newline="", encoding="utf-8") as f:
        csv.writer(f, delimiter=";").writerows(zeilen)


# Eingaben: Spalte ID beibehalten, pos (1-basiert) ergänzen, fuerTpNoetig -> true/false
kopf, *eingaben = lies("Eingaben.csv")
schreibe(
    "db/data/tp.wizard.Eingaben.csv",
    [["ID", "pos", *kopf[1:]]]
    + [
        [
            e[0],
            str(pos),
            *[(e[i].lower() if name == "fuerTpNoetig" else e[i]) for i, name in enumerate(kopf) if i > 0],
        ]
        for pos, e in enumerate(eingaben, 1)
    ],
)

# Regeln: unverändert übernehmen
kopf, *regeln = lies("Regeln.csv")
schreibe("db/data/tp.wizard.Regeln.csv", [kopf, *regeln])

# Bedingungen: Header auf CAP-Assoziationsspalten zwingen (regel_nr -> Regeln.nr, angabe_ID -> Eingaben.ID)
kopf, *bedingungen = lies("Bedingungen.csv")
schreibe(
    "db/data/tp.wizard.Bedingungen.csv",
    [["regel_nr", "pos", "angabe_ID", "operator", "wert"], *bedingungen],
)

# ForlaPlaetze: unverändert übernehmen
kopf, *forla = lies("ForlaPlaetze.csv")
schreibe("db/data/tp.wizard.ForlaPlaetze.csv", [kopf, *forla])

# Golden-Fixtures für die Tests
shutil.copyfile(QUELLE / "csv" / "GoldenEingaben.csv", ZIEL / "test" / "golden" / "GoldenEingaben.csv")
ergebnisse = sorted(QUELLE.glob("ergebnis-*.csv"))
for ergebnis in ergebnisse:
    shutil.copyfile(ergebnis, ZIEL / "test" / "golden" / ergebnis.name)

print(
    f"{len(eingaben)} Angaben, {len(regeln)} Regeln, {len(bedingungen)} Bedingungen, "
    f"{len(forla)} Forla-Einträge; {len(ergebnisse)} Golden-Ergebnisdateien übernommen"
)
