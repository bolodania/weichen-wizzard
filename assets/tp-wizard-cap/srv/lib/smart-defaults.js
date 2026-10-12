'use strict';

// Standardkonfigurationen per Grundbauform, abgeleitet aus Kopie von Fragen.xlsx.
// questionIds müssen mit WIZARD_QUESTIONS ids übereinstimmen.
const DEFAULTS = {
  EWL: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'EWL — Herzstück meist starr' },
    { questionId: 'federwippe',              defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWL ohne Federwippe als Standard' },
    { questionId: 'prellbock',               defaultAnswer: 'false',   confidence: 'high',   rationale: 'EWL ohne Prellbock als Standard' },
    { questionId: 'heizungTyp',              defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert stark — bitte prüfen' },
    { questionId: 'erdung',                  defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWL ohne Erdung als Standard' },
    { questionId: 'weichensignale',          defaultAnswer: '0',       confidence: 'medium', rationale: 'EWL ohne Weichensignal als Standard' },
    { questionId: 'weichensteuerung',        defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWL ohne dezentrale Steuerung' },
    { questionId: 'weichenüberwachung',      defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWL ohne Überwachungseinrichtung' },
    { questionId: 'radsensoren',             defaultAnswer: '0',       confidence: 'medium', rationale: 'EWL ohne Radsensoren als Standard' },
  ],
  EWR: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'EWR — Herzstück meist starr' },
    { questionId: 'federwippe',              defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWR ohne Federwippe als Standard' },
    { questionId: 'prellbock',               defaultAnswer: 'false',   confidence: 'high',   rationale: 'EWR ohne Prellbock als Standard' },
    { questionId: 'heizungTyp',              defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert stark — bitte prüfen' },
    { questionId: 'erdung',                  defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWR ohne Erdung als Standard' },
    { questionId: 'weichensignale',          defaultAnswer: '0',       confidence: 'medium', rationale: 'EWR ohne Weichensignal als Standard' },
    { questionId: 'weichensteuerung',        defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWR ohne dezentrale Steuerung' },
    { questionId: 'weichenüberwachung',      defaultAnswer: 'false',   confidence: 'medium', rationale: 'EWR ohne Überwachungseinrichtung' },
    { questionId: 'radsensoren',             defaultAnswer: '0',       confidence: 'medium', rationale: 'EWR ohne Radsensoren als Standard' },
  ],
  DKW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '2',       confidence: 'medium', rationale: 'DKW — Herzstück meist beweglich Bauart 2' },
    { questionId: 'federwippe',              defaultAnswer: 'true',    confidence: 'medium', rationale: 'DKW meist mit Federwippe' },
    { questionId: 'heizungTyp',              defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert — bitte prüfen' },
    { questionId: 'prellbock',               defaultAnswer: 'false',   confidence: 'high',   rationale: 'DKW ohne Prellbock als Standard' },
  ],
  EKW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '1',       confidence: 'medium', rationale: 'EKW — Herzstück meist beweglich Bauart 1' },
    { questionId: 'federwippe',              defaultAnswer: 'false',   confidence: 'medium', rationale: 'EKW ohne Federwippe als Standard' },
    { questionId: 'heizungTyp',              defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert — bitte prüfen' },
  ],
  IBW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'IBW — Herzstück meist starr' },
    { questionId: 'federwippe',              defaultAnswer: 'false',   confidence: 'medium', rationale: 'IBW ohne Federwippe' },
    { questionId: 'heizungTyp',             defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert' },
  ],
  DW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'DW — Herzstück meist starr' },
    { questionId: 'heizungTyp',             defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert' },
  ],
  ABW: [
    { questionId: 'rückbauStatus',          defaultAnswer: '0',       confidence: 'high',   rationale: 'Neue Weiche — kein Rückbau' },
    { questionId: 'herzstückbauart',         defaultAnswer: '0',       confidence: 'medium', rationale: 'ABW — Herzstück meist starr' },
    { questionId: 'heizungTyp',             defaultAnswer: 'null',    confidence: 'low',    rationale: 'Heizung variiert' },
  ],
};

function getSmartDefaults(basicForm) {
  return DEFAULTS[basicForm] || [];
}

module.exports = { getSmartDefaults };
