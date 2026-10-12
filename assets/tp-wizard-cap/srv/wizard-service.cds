using { tp.wizard as wizard } from '../db/schema';

service WizardService @(path: '/wizard') {

  // Read-only entities
  @readonly entity ForlaTemplates     as projection on wizard.ForlaTemplate;
  @readonly entity BasicFormMappings  as projection on wizard.BasicFormMapping;
  @readonly entity Sessions           as projection on wizard.WizardSession;

  // Session management
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
    answer       : String
  ) returns {
    sessionId    : String;
    nextQuestion : String; // JSON
    tpPreview    : String; // JSON
  };

  action confirmSession(
    sessionId    : String
  ) returns {
    sessionId    : String;
    created      : String; // JSON array of created TP keys
    failed       : String; // JSON array of failed TPs
    openFields   : String; // JSON
  };

  function getNextQuestion(sessionId : String) returns String; // JSON
  function getTPPreview(sessionId    : String) returns String; // JSON
  function getOpenFields(sessionId   : String) returns String; // JSON
  function exportSessionCSV(sessionId: String) returns String; // CSV string

  // Health check
  function health() returns String;
}
