namespace tp.wizard;

// ===========================================================================
// Typen
// ===========================================================================
type Eingabetyp : String(12) enum {
  Menge;      // ganze Zahl >= 0, auch als Anzahl verwendet
  Zahl;       // Dezimalzahl
  Text;       // Freitext
  JaNein;     // Ja / Nein
  Auswahl;    // ein Wert aus `werte`
  Einbauorte; // mehrere Werte aus `werte`, mit HAS abgefragt
}

type Operator : String(3) enum {
  EQ; NE; ![IN]; BT; GE; GT; LE; LT; HAS;
}

// Herkunft eines Angabe-Werts (Beleg = wörtliche Textstelle bei Dokumentwerten)
type Herkunft : String(12) enum {
  Dokument;   // aus der Fertigmeldung gelesen, mit wörtlicher Textstelle
  Bestand;    // von einer Vergleichsweiche übernommen
  Vorgabe;    // Standardwert aus dem Eingabenkatalog
  Stammdaten; // aus Weichenkopf-Stammdaten
  Regel;      // per Formel abgeleitet
  Manuell;    // manuell im Dialog gesetzt
}

// ===========================================================================
// Regelwerk-Katalog (read-only Stammdaten, erzeugt aus dem geprüften Regelwerk,
// 1:1 zu regelwerk/csv/*.csv — siehe scripts/regelwerk-uebernehmen.py)
// ===========================================================================

// Eingabenkatalog — jede Angabe, die über die Weiche bekannt sein muss
entity Eingaben {
  key ID         : String(30);  // stabiler technischer Schlüssel, z.B. "zgv_ve"
  pos            : Integer;      // Reihenfolge im Dialog
  bereich        : String(40);  // fachliche Gruppierung, z.B. "Zungenvorrichtung"
  frage          : String(200); // Fragetext im Dialog
  typ            : Eingabetyp;
  werte          : String(500); // erlaubte Werte (';'-getrennt) für Auswahl/Einbauorte
  sichtbarWenn   : String(200); // Sichtbarkeitsbedingung (Angabe-Op-Wert, mit UND)
  formel         : String(200); // abgeleitet (nie gefragt), Ergebnis Ja/Nein
  vorgabe        : String(100); // Standardwert, falls nicht gesetzt und nicht abgeleitet
  hauptquelle    : String(12);  // Dokument|Vorgabe|Stammdaten|Regel|Mensch
  fuerTpNoetig   : Boolean;     // relevant für die TP-Ableitung (Offen-Prüfung)
  beleg          : String(300); // Herkunft/Hinweis (FK-Nummer, Migrationsregel)
}

// Regeltabelle — eine Zeile je TP-Muster
entity Regeln {
  key nr       : Integer;       // Regelnummer (nicht fortlaufend); nr=1 = Wurzel
  bereich      : String(40);
  muster       : String(20);    // TP-Suffix-Muster; '#' = Laufnummer-Stelle(n)
  eltern       : String(20);    // Muster des Eltern-TP; leer = Wurzel
  anzahl       : String(30);    // Literal-Zahl ODER Angabe-ID (Menge)
  start        : Integer;       // Start-Laufnummer
  giltFuer     : String(20);    // Grundbauform(en), für die die Regel gilt
  beleg        : String(30);    // Migrationsregel / FK-Referenz
  hinweis      : String(200);
  bedingungen  : Composition of many Bedingungen on bedingungen.regel = $self;
}

// Bedingungen — je Zeile eine mit UND verknüpfte Teilbedingung einer Regel
entity Bedingungen {
  key regel    : Association to Regeln; // FK-Spalte: regel_nr
  key pos      : Integer;               // 1-basiert innerhalb der Regel
  angabe       : Association to Eingaben; // FK-Spalte: angabe_ID
  operator     : Operator;
  wert         : String(500);           // Vergleichswert; '@id' = Feldverweis
}

// Forla — Vorlage (Bezeichnung, Positionsnummer, Klassen, Planergruppe) je Muster
entity ForlaPlaetze {
  key muster     : String(20);  // Erstinstanz-Muster (Laufnummern als 01/1)
  positionsnummer: String(4);   // 4-stellige Positionsnummer (Sortierung)
  bezeichnung    : String(80);  // Klartext; 'N' = Platzhalter für die Laufnummer
  klassen        : String(300);
  planergruppe   : String(5);
}

// ===========================================================================
// Transaktionale Entitäten (Zwei-Rollen-Workflow Katrin -> Thomas)
// ===========================================================================

// Eine Weichenaufnahme, Lebenszyklus open -> submitted -> editing -> approved -> created|failed
entity WizardSession {
  key sessionId  : String(36);   // UUID
  ds100          : String(10);   // Betriebsstelle, z.B. "NRB"
  switchNumber   : String(10);   // Weichennummer, z.B. "806"
  basicForm      : String(20);   // Grundbauform (Regelwerk vorhanden nur für EWR)
  fertigmeldung  : LargeString;  // Volltext der Fertigmeldung (Beleg-Quelle für Dokumentwerte)
  answersJson    : LargeString; // Export-Snapshot; SessionAnswer ist die maßgebliche Quelle
  status         : String(20);   // open|submitted|editing|approved|created|failed
  derivedTPCount : Integer;
  createdAt      : DateTime;
  submittedAt    : DateTime;
  approvedAt     : DateTime;
  creationResult : LargeString;  // Ergebnis je TP aus SAP
  reviewComment  : String(500);  // optionale Notiz von Thomas
  answers        : Composition of many SessionAnswer  on answers.session   = $self;
  tps            : Composition of many DerivedTP      on tps.session       = $self;
  documents      : Composition of many SessionDocument on documents.sessionId = $self.sessionId;
}

// Abgeleitete TPs — Snapshot der Struktur, bei submit/edit aus dem Regelwerk neu berechnet
entity DerivedTP {
  key session      : Association to WizardSession;
  key tpKey        : String(40);   // vollständiger TP-Schlüssel (eindeutig je Session)
  posNr            : String(10);   // Positionsnummer (Sortierung/Anzeige)
  tpLabel          : String(80);   // Bezeichnung (N bereits durch Laufnummer ersetzt)
  area             : String(40);   // Bereich (fachliche Gruppierung)
  level            : Integer;      // Ableitungsebene: 0 = Wurzel, 1, 2, ...
  parentTpKey      : String(40);   // tpKey des Eltern-TP; leer bei Wurzel
  isAutomatic      : Boolean;      // true = ohne Benutzerdialog angelegt
  planergruppe     : String(5);
  klassen          : String(300);
  regel            : Integer;      // Regelnummer, die diesen TP erzeugt hat
  muster           : String(20);   // zugrunde liegendes Regel-Muster
}

// PDF-Dokument, das Thomas zu einer Session hochlädt (optional)
entity SessionDocument {
  key sessionId    : String(36);   // FK zu WizardSession
  key filename     : String(200);
  mimeType         : String(100);
  content          : LargeBinary;            // Rohdaten des PDFs
  uploadedAt       : DateTime;
  extractedText    : LargeString;            // per pdftotext / Fallback extrahierter Text
  analysisJson     : LargeString;            // JSON-Ergebnis der Regelwerk-Analyse
  analysisDoneAt   : DateTime;
}

// Einzelantworten — im Fiori Object Page editierbar
entity SessionAnswer {
  key session      : Association to WizardSession;
  key questionId   : String(80);   // Eingaben.ID
  questionText     : String(200);  // Fragetext aus dem Eingabenkatalog
  area             : String(40);   // Bereich (fachliche Gruppierung)
  answer           : String(500);
  source           : String(30);   // auto|agent-default|human-confirmed|human-corrected|thomas-edited
  herkunft         : Herkunft;     // Regelwerk-Herkunft des Werts
  beleg            : String(500);  // wörtliche Textstelle (bei Herkunft=Dokument)
  agentProposal    : String(500);  // ursprünglicher Agent-Vorschlag, falls Thomas überschreibt
}
