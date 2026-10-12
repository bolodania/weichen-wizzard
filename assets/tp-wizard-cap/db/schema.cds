namespace tp.wizard;

// ---------------------------------------------------------------------------
// Forla Template — Maximalausprägung aller möglichen TPs einer Weiche
// ---------------------------------------------------------------------------
entity ForlaTemplate {
  key posNr        : String(10);   // Positionsnummer z.B. "0010", "0300"
  tpKey            : String(40);   // VORLA-TP-Schlüssel z.B. "VORLA--WE------1ZUBA-VE-01"
  tpLabel          : String(80);   // Klartext-Bezeichnung (aus neuer WE-Struktur)
  area             : Integer;      // Bereich 1–19 (aus Fragenkatalog)
  areaName         : String(60);   // Bezeichnung des Bereichs
  isAutomatic      : Boolean;      // true = kein Benutzerdialog nötig
  rückbauStatus    : Integer;      // 0 = neue Weiche, 1+ = Rückbau
  conditions       : String(200);  // JSON: Bedingungen für Anlage
  basicForms       : String(200);  // JSON-Array: gültige Grundbauformen
}

// ---------------------------------------------------------------------------
// Grundbauform → Positionsnummernbereiche (aus Excel-Filtertabellen)
// ---------------------------------------------------------------------------
entity BasicFormMapping {
  key basicForm    : String(20);   // z.B. "EWL", "EWR", "DKW"
  basicFormLabel   : String(60);   // z.B. "Einfache Weiche links"
  posNrFrom        : Integer;      // Untergrenze Positionsnummernbereich
  posNrTo          : Integer;      // Obergrenze Positionsnummernbereich
  seq              : Integer;      // Reihenfolge
}

// ---------------------------------------------------------------------------
// Wizard Session (in-memory)
// ---------------------------------------------------------------------------
entity WizardSession {
  key sessionId    : String(36);   // UUID
  ds100            : String(10);   // Betriebsstelle z.B. "NI"
  switchNumber     : String(10);   // Weichennummer z.B. "2006"
  basicForm        : String(20);   // Grundbauform
  answersJson      : String(4000); // JSON-Snapshot aller Antworten
  status           : String(20);   // open|submitted|editing|approved|created|failed
  derivedTPCount   : Integer;
  createdAt        : DateTime;
  submittedAt      : DateTime;     // set when Katrin/Agent calls submitSession
  approvedAt       : DateTime;     // set when Thomas calls approveSession
  creationResult   : String(500);  // JSON summary from SAP
}
