using { tp.wizard as wizard } from '../db/schema';
using from '../app/approve/annotations';

service WizardService @(path: '/wizard') {

  // Read-only reference data
  @readonly entity ForlaTemplates    as projection on wizard.ForlaTemplate;
  @readonly entity BasicFormMappings as projection on wizard.BasicFormMapping;

  // Sessions — draft-enabled so FE OData V4 renders the Edit/Save/Discard toolbar
  @odata.draft.enabled
  entity Sessions as projection on wizard.WizardSession
    actions {
      action approve() returns {
        sessionId  : String;
        created    : String; // JSON array
        failed     : String; // JSON array
        openFields : String; // JSON array
      };
    };

  // SessionAnswers — writable so Thomas can edit inline in Object Page
  entity SessionAnswers as projection on wizard.SessionAnswer;

  // DerivedTPs — read-only snapshot of the TP structure Thomas reviews
  @readonly entity DerivedTPs as projection on wizard.DerivedTP;

  // ── Agent / app-field actions (kept for backward compatibility) ───────────

  action createSession(
    ds100        : String,
    switchNumber : String,
    basicForm    : String
  ) returns {
    sessionId    : String;
    message      : String;
  };

  action submitAnswer(
    sessionId    : String,
    questionId   : String,
    answer       : String,
    source       : String   // auto|agent-default|katrin-confirmed|katrin-corrected
  ) returns {
    sessionId    : String;
    nextQuestion : String; // JSON
    tpPreview    : String; // JSON
  };

  action submitSession(
    sessionId    : String
  ) returns {
    sessionId    : String;
    message      : String;
  };

  action bulkSubmitWithDefaults(
    sessionId    : String
  ) returns {
    sessionId      : String;
    defaultedCount : Integer;
    status         : String;
    message        : String;
  };

  action editAnswer(
    sessionId    : String,
    questionId   : String,
    answer       : String
  ) returns {
    sessionId    : String;
    tpPreview    : String; // JSON
  };

  // Unbound approve — still available for legacy callers
  action approveSession(
    sessionId    : String
  ) returns {
    sessionId    : String;
    created      : String; // JSON array
    failed       : String; // JSON array
    openFields   : String; // JSON
  };

  function getSmartDefaults(basicForm : String) returns String; // JSON array
  function listPendingSessions()                returns String; // JSON array
  function getOpenHints(sessionId    : String)  returns String; // JSON array
  function getNextQuestion(sessionId : String)  returns String; // JSON
  function getTPPreview(sessionId    : String)  returns String; // JSON
  function getOpenFields(sessionId   : String)  returns String; // JSON
  function exportSessionCSV(sessionId: String)  returns String; // CSV string

  function health() returns String;
}
