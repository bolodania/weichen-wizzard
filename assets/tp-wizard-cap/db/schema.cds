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
// Wizard Session
// ---------------------------------------------------------------------------
entity WizardSession {
  key sessionId    : String(36);   // UUID
  ds100            : String(10);   // Betriebsstelle z.B. "NI"
  switchNumber     : String(10);   // Weichennummer z.B. "2006"
  basicForm        : String(20);   // Grundbauform
  answersJson      : String(4000); // JSON-Snapshot aller Antworten (kept for backward compat)
  status           : String(20);   // open|submitted|editing|approved|created|failed
  derivedTPCount   : Integer;
  createdAt        : DateTime;
  submittedAt      : DateTime;     // set when Katrin/Agent calls submitSession
  approvedAt       : DateTime;     // set when Thomas calls approveSession
  creationResult   : String(500);  // JSON summary from SAP
  reviewComment    : String(500);  // Thomas's optional review note (editable field — triggers FE Edit button)
  answers          : Composition of many SessionAnswer on answers.session = $self;
  tps              : Composition of many DerivedTP     on tps.session     = $self;
}

// ---------------------------------------------------------------------------
// Derived TPs — hierarchy snapshot written at submitSession, refreshed on edit
// ---------------------------------------------------------------------------
entity DerivedTP {
  key session      : Association to WizardSession;
  key tpKey        : String(40);   // full TP key as it appears in SAP — unique per session
  posNr            : String(10);   // position number for sorting/display (may be empty)
  tpLabel          : String(80);   // human-readable label
  area             : Integer;      // Bereich number
  areaName         : String(60);   // Bereich label
  level            : Integer;      // 0 = root, 1 = child, 2 = grandchild
  parentTpKey      : String(40);   // tpKey of parent; null for root nodes
  isAutomatic      : Boolean;      // true = no user dialog needed
}

// ---------------------------------------------------------------------------
// Individual answers — navigable from Sessions in Fiori Elements Object Page
// ---------------------------------------------------------------------------
entity SessionAnswer {
  key session      : Association to WizardSession;
  key questionId   : String(80);
  questionText     : String(200);  // Human-readable question label from WIZARD_QUESTIONS
  area             : Integer;      // Bereich number
  areaName         : String(60);   // Bereich label
  answer           : String(500);
  source           : String(30);   // auto|agent-default|katrin-confirmed|katrin-corrected|thomas-edited
  agentProposal    : String(500);  // original agent suggestion when Thomas overrides
}
