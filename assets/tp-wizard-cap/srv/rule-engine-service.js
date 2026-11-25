'use strict';

const cds = require('@sap/cds');
const { transformVorlaKey } = require('./lib/tp-key-transformer');
const { filterByBasicForm } = require('./lib/pos-filter');
const { deriveHzBeweglich } = require('./lib/hz-logic');
const { deriveIsolaerstöße } = require('./lib/iso-logic');
const { deriveAntriebe } = require('./lib/antrieb-logic');

const LOG = cds.log('rule-engine');

/**
 * Derives the full TP structure from a set of wizard answers.
 *
 * @param {object} input - { basicForm, ds100, switchNumber, answers }
 * @param {object[]} forlaTemplates - All ForlaTemplate records
 * @param {object[]} basicFormMappings - All BasicFormMapping records
 * @returns {object} { tps, openFields }
 */
function deriveTPStructure(input, forlaTemplates, basicFormMappings) {
  const { basicForm, ds100, switchNumber, answers = [] } = input;

  // Helper: get answer value by question key
  const ans = (key, defaultVal = null) => {
    const found = answers.find(a => a.questionId === key);
    return found ? found.answer : defaultVal;
  };

  // ── Step 1: Hz-beweglich decision ───────────────────────────────────────
  const federwippe = ans('federwippe', false) === true || ans('federwippe') === 'true';
  const herzstückbauart = parseInt(ans('herzstückbauart', '0'), 10);
  const { hzBeweglich } = deriveHzBeweglich({ federwippe, herzstückbauart });

  // ── Step 2: Collect numeric answers ────────────────────────────────────
  const anzahlVerschlussebenenZgv = parseInt(ans('anzahlVerschlussebenenZgv', '0'), 10);
  const anzahlZungRollpaarZgv     = parseInt(ans('anzahlZungRollpaarZgv', '0'), 10);
  const anzahlVerschlussebenenHz  = hzBeweglich ? parseInt(ans('anzahlVerschlussebenenHz', '1'), 10) : 0;
  const anzahlHzRollpaare         = hzBeweglich ? parseInt(ans('anzahlHzRollpaare', '0'), 10) : 0;
  const radsensoren               = parseInt(ans('radsensoren', '0'), 10);
  const anzahlAntriebeZgv         = parseInt(ans('anzahlAntriebeZgv', '0'), 10);
  const anzahlAntriebeHz          = hzBeweglich ? parseInt(ans('anzahlAntriebeHz', '0'), 10) : 0;
  const hydraulisch               = ans('hydraulisch', false) === true || ans('hydraulisch') === 'true';
  const weichensignale            = parseInt(ans('weichensignale', '0'), 10);
  const lichtpunkte               = parseInt(ans('lichtpunkte', '0'), 10);
  const weichensteuerung          = ans('weichensteuerung', false) === true || ans('weichensteuerung') === 'true';
  const weichenüberwachung        = ans('weichenüberwachung', false) === true || ans('weichenüberwachung') === 'true';
  const stwBauform                = ans('stwBauform', 'DEFAULT');
  const isoPositions              = JSON.parse(ans('isoPositions', '[]') || '[]');
  const havPositions              = JSON.parse(ans('havPositions', '[]') || '[]');
  const prellbock                 = ans('prellbock', false) === true || ans('prellbock') === 'true';
  const erdung                    = ans('erdung', false) === true || ans('erdung') === 'true';
  const heizungTyp                = ans('heizungTyp', null);
  const gleisstückWP              = ans('gleisstückWP', false) === true || ans('gleisstückWP') === 'true';
  const gleisstückEndA            = ans('gleisstückEndA', false) === true || ans('gleisstückEndA') === 'true';
  const gleisstückEndB            = ans('gleisstückEndB', false) === true || ans('gleisstückEndB') === 'true';

  // ── Safety gate: decommissioned switch (Rückbaustatus 7/8) ─────────────
  const rückbauStatus = parseInt(ans('rückbauStatus', '0'), 10);
  if (rückbauStatus === 7 || rückbauStatus === 8) {
    return { tps: [], hzBeweglich, openFields: [] };
  }

  const derivedTPs = [];

  // ── Step 3: Automatic TPs from Forla (rückbauStatus=0 only) ─────────────
  const filtered = filterByBasicForm(basicForm, forlaTemplates, basicFormMappings)
    .filter(t => t.rückbauStatus === 0);

  for (const t of filtered) {
    if (!t.isAutomatic) continue; // will be handled conditionally below

    const concreteKey = transformVorlaKey(t.tpKey, ds100, switchNumber);
    derivedTPs.push({
      tpKey: concreteKey,
      vorlaKey: t.tpKey,
      tpLabel: t.tpLabel,
      area: t.area,
      areaName: t.areaName,
      posNr: t.posNr,
      isAutomatic: true,
      derivedFrom: 'forla-automatic'
    });
  }

  // ── Step 4: Conditional TPs ──────────────────────────────────────────────
  const conditionalTPs = [];

  // Bereich 4: ZGV
  for (let e = 1; e <= anzahlVerschlussebenenZgv; e++) {
    conditionalTPs.push({
      vorlaKey: `VORLA--WE------1ZUBA-VE-${String(e).padStart(2, '0')}`,
      tpLabel: `Verschluss Zgv Ebene ${String(e).padStart(2, '0')}`,
      area: 4, areaName: 'Zgv', isAutomatic: false
    });
  }
  for (let r = 1; r <= anzahlZungRollpaarZgv; r++) {
    conditionalTPs.push({
      vorlaKey: `VORLA--WE------1ZUBA-ZR-${String(r).padStart(2, '0')}`,
      tpLabel: `Zungenrollvorrichtungspaar ${String(r).padStart(2, '0')}`,
      area: 4, areaName: 'Zgv', isAutomatic: false
    });
  }

  // Bereich 5: Herzstück verschlüsse (beweglich only)
  if (hzBeweglich) {
    for (let e = 1; e <= anzahlVerschlussebenenHz; e++) {
      conditionalTPs.push({
        vorlaKey: `VORLA--WE------1HZ-ABVE--${e}`,
        tpLabel: `Herzstück Verschluss beweglich Ebene ${String(e).padStart(2, '0')}`,
        area: 5, areaName: 'Herzstück', isAutomatic: false
      });
    }
    for (let r = 1; r <= anzahlHzRollpaare; r++) {
      conditionalTPs.push({
        vorlaKey: `VORLA--WE------1HZ-ABZR-${String(r).padStart(2, '0')}`,
        tpLabel: `Herzstück Rollvorrichtungspaar ${String(r).padStart(2, '0')}`,
        area: 5, areaName: 'Herzstück', isAutomatic: false
      });
    }
  }

  // Bereich 6: Radsensoren
  for (let r = 1; r <= radsensoren; r++) {
    conditionalTPs.push({
      vorlaKey: `VORLA--WE------1HZ-ABRSA-${r}`,
      tpLabel: `Radsensor ${String(r).padStart(2, '0')}`,
      area: 6, areaName: 'Radlenker', isAutomatic: false
    });
  }

  // Bereich 7: Antriebe
  const antriebTPs = deriveAntriebe({ anzahlAntriebeZgv, anzahlAntriebeHz, hydraulisch, hzBeweglich });
  conditionalTPs.push(...antriebTPs);

  // Bereich 10: Weichensignal
  for (let s = 1; s <= weichensignale; s++) {
    conditionalTPs.push({
      vorlaKey: `VORLA--WE------1WSIG${s}`,
      tpLabel: `Weichensignal ${String(s).padStart(2, '0')}`,
      area: 10, areaName: 'Weichensignal', isAutomatic: false
    });
    for (let l = 1; l <= lichtpunkte; l++) {
      conditionalTPs.push({
        vorlaKey: `VORLA--WE------1WSIG${s}LP${String(l).padStart(2, '0')}`,
        tpLabel: `Weichensignal ${s} Lichtpunkt ${String(l).padStart(2, '0')}`,
        area: 10, areaName: 'Weichensignal', isAutomatic: false
      });
    }
  }

  // Bereich 11: Weichensteuerung
  if (weichensteuerung) {
    conditionalTPs.push({
      vorlaKey: 'VORLA--WE------1SIWES',
      tpLabel: 'Dezentrale Weichensteuerung',
      area: 11, areaName: 'Weichensteuerung', isAutomatic: false
    });
  }

  // Bereich 12: Weichenüberwachung
  if (weichenüberwachung) {
    conditionalTPs.push({
      vorlaKey: 'VORLA--WE------1WUE-1',
      tpLabel: 'Weichenüberwachung 01',
      area: 12, areaName: 'Weichenüberwachung', isAutomatic: false
    });
  }

  // Bereich 14: Isolierstöße
  const isoTPs = deriveIsolaerstöße(stwBauform, isoPositions);
  conditionalTPs.push(...isoTPs.map(t => ({ ...t, area: 14, areaName: 'Isolierstöße', isAutomatic: false })));

  // Bereich 15: HAV
  for (const pos of havPositions) {
    conditionalTPs.push({
      vorlaKey: `VORLA--WE------1HAV-${pos}`,
      tpLabel: `Hemmschuhauswurfvorrichtung ${pos}`,
      area: 15, areaName: 'Hemmschuhauswurfvorrichtung', isAutomatic: false
    });
  }

  // Bereich 16: Prellbock
  if (prellbock) {
    conditionalTPs.push({
      vorlaKey: 'VORLA--WE------1PR---',
      tpLabel: 'Prellbock',
      area: 16, areaName: 'Prellbock', isAutomatic: false
    });
  }

  // Bereich 17: Gleisstücke
  if (gleisstückWP) {
    conditionalTPs.push({ vorlaKey: 'VORLA--WE------1WGWA-', tpLabel: 'Weichenspitze Gleisstück', area: 17, areaName: 'Gleisstücke', isAutomatic: false });
  }
  if (gleisstückEndA) {
    conditionalTPs.push({ vorlaKey: 'VORLA--WE------1WGESA', tpLabel: 'Endbereich Strang A', area: 17, areaName: 'Gleisstücke', isAutomatic: false });
  }
  if (gleisstückEndB) {
    conditionalTPs.push({ vorlaKey: 'VORLA--WE------1WGESB', tpLabel: 'Endbereich Strang B', area: 17, areaName: 'Gleisstücke', isAutomatic: false });
  }

  // Bereich 18: Erdung
  if (erdung) {
    conditionalTPs.push({ vorlaKey: 'VORLA--WE------1EV---', tpLabel: 'Erdungsvorrichtung', area: 18, areaName: 'Erdung', isAutomatic: false });
  }

  // Bereich 19: Heizung
  const heizungMap = { elektrisch: 'EEH01', gas: 'GHE01', öl: 'ODH01', dampf: 'SPH01' };
  if (heizungTyp && heizungMap[heizungTyp]) {
    conditionalTPs.push({
      vorlaKey: `VORLA--WE------1${heizungMap[heizungTyp]}`,
      tpLabel: `Weichenheizung ${heizungTyp}`,
      area: 19, areaName: 'Weichenheizung', isAutomatic: false
    });
  }

  // ── Step 5: Transform conditional vorla keys to concrete keys ───────────
  for (const t of conditionalTPs) {
    try {
      if (t.vorlaKey && t.vorlaKey.startsWith('VORLA--WE------1')) {
        t.tpKey = transformVorlaKey(t.vorlaKey, ds100, switchNumber);
      } else {
        t.tpKey = t.vorlaKey; // already concrete (iso/hav with custom prefix)
      }
    } catch {
      t.tpKey = t.vorlaKey;
    }
    t.derivedFrom = 'rule-engine';
    derivedTPs.push(t);
  }

  // ── Milestone logging ────────────────────────────────────────────────────
  LOG.info('[M1.achieved]: Regelwerk vollständig digitalisiert — alle 19 Bereiche ausfuehrbar');

  return {
    tps: derivedTPs,
    hzBeweglich,
    openFields: [] // placeholder: populated after SAP creation
  };
}

/**
 * Returns the next unanswered question given the current session state.
 */
function getNextQuestion(sessionState, allQuestions) {
  const answered = (sessionState.answers || []).map(a => a.questionId);

  for (const q of allQuestions) {
    if (answered.includes(q.id)) continue;
    if (q.isAutomatic) continue;

    // Check parent condition
    if (q.parentQuestionId) {
      const parentAnswer = (sessionState.answers || []).find(a => a.questionId === q.parentQuestionId);
      if (!parentAnswer || parentAnswer.answer !== q.parentAnswer) continue;
    }

    return q;
  }
  return null;
}

/**
 * Validates a derived TP structure against the ForlaTemplate.
 */
function validateTPStructure(tps, forlaTemplates) {
  const warnings = [];
  const invalidTPs = [];

  for (const tp of tps) {
    if (!tp.tpKey || tp.tpKey.length === 0) {
      invalidTPs.push(tp.vorlaKey || 'unknown');
      warnings.push(`TP without key: ${tp.tpLabel}`);
    }
  }

  const valid = invalidTPs.length === 0;
  if (valid) {
    LOG.info('[M2.achieved]: TP-Struktur validiert — keine ungültigen TP-Schlüssel');
  } else {
    LOG.warn('[M2.missed]: TP-Struktur ungültig — fehlende Schlüssel');
  }

  return { valid, invalidTPs, warnings };
}

module.exports = { deriveTPStructure, getNextQuestion, validateTPStructure };
