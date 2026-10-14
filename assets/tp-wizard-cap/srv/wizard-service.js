'use strict';

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const { deriveTPStructure, getNextQuestion, validateTPStructure } = require('./rule-engine-service');
const { WIZARD_QUESTIONS } = require('./lib/wizard-questions');
const flService = require('./fl-service');
const { getSmartDefaults } = require('./lib/smart-defaults');

const LOG = cds.log('wizard-service');

// In-memory session store — primary store during active session lifetime.
// After submitSession the session is also in the DB; _loadSessionFromDb
// can rebuild it from there (e.g. after a server restart).
const SESSION_STORE = new Map();

// Indexed question lookup built once from WIZARD_QUESTIONS
const QUESTION_MAP = new Map(WIZARD_QUESTIONS.map(q => [q.id, q]));

// Shared helper — both listPendingSessions and getOpenHints use this so counts are always consistent.
function _computeOpenHints(session) {
  const hints = [];
  for (const a of (session.answers || [])) {
    if (a.source === 'agent-default' || a.source === 'auto') {
      hints.push({
        questionId:    a.questionId,
        answer:        a.answer,
        source:        a.source,
        agentProposal: a.agentProposal,
        hint:          `Wert "${a.answer}" wurde vom Agenten als Standard gesetzt (${a.source}). Bitte prüfen ob dies für diese spezifische Weiche zutrifft.`
      });
    }
  }
  return hints;
}

// Load a session from DB into SESSION_STORE (for server-restart resilience).
async function _loadSessionFromDb(sessionId) {
  const db = await cds.connect.to('db');
  const row = await db.run(SELECT.one.from('tp.wizard.WizardSession').where({ sessionId }));
  if (!row) return null;
  const answers = JSON.parse(row.answersJson || '[]');
  const session = { ...row, answers, tpPreview: null };
  SESSION_STORE.set(sessionId, session);
  return session;
}

// Retrieve session: memory first, DB fallback.
async function _getSession(sessionId) {
  return SESSION_STORE.get(sessionId) || await _loadSessionFromDb(sessionId);
}

// Persist all SessionAnswer rows for a session.
async function _upsertSessionAnswers(db, session) {
  for (const a of (session.answers || [])) {
    const q = QUESTION_MAP.get(a.questionId);
    await db.run(UPSERT.into('tp.wizard.SessionAnswer').entries({
      session_sessionId: session.sessionId,
      questionId:        a.questionId,
      questionText:      q?.text     || a.questionId,
      area:              q?.area     || 0,
      areaName:          q?.areaName || '',
      answer:            a.answer    || '',
      source:            a.source    || 'auto',
      agentProposal:     a.agentProposal || null
    }));
  }
}

// Compute level (depth) and parentTpKey for a flat list of TPs using prefix matching.
function _computeTPHierarchy(tps) {
  const keys = tps.map(tp => tp.tpKey);
  return tps.map(tp => {
    // Parent = longest other key that is a strict prefix of this key
    let parentTpKey = null;
    let maxLen = 0;
    for (const k of keys) {
      if (k !== tp.tpKey && tp.tpKey.startsWith(k) && k.length > maxLen) {
        maxLen = k.length;
        parentTpKey = k;
      }
    }
    // Level = count of all keys that are strict prefixes (= number of ancestors)
    const level = keys.filter(k => k !== tp.tpKey && tp.tpKey.startsWith(k)).length;
    return { ...tp, level, parentTpKey };
  });
}

// Persist DerivedTP rows for a session — DELETE existing, then INSERT fresh.
async function _upsertDerivedTPs(db, sessionId, tps) {
  await db.run(DELETE.from('tp.wizard.DerivedTP').where({ session_sessionId: sessionId }));
  const withHierarchy = _computeTPHierarchy(tps);
  for (const tp of withHierarchy) {
    await db.run(INSERT.into('tp.wizard.DerivedTP').entries({
      session_sessionId: sessionId,
      tpKey:             tp.tpKey      || '',
      posNr:             tp.posNr      || '',
      tpLabel:           tp.tpLabel    || '',
      area:              tp.area       || 0,
      areaName:          tp.areaName   || '',
      level:             tp.level,
      parentTpKey:       tp.parentTpKey,
      isAutomatic:       tp.isAutomatic ?? false
    }));
  }
}

// Core approve logic — shared by unbound approveSession and bound Sessions.approve.
async function _doApprove(sessionId, req) {
  const session = await _getSession(sessionId);
  if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
  if (!['submitted', 'editing'].includes(session.status)) {
    return req.error(409, `Session hat Status "${session.status}" — approveSession erfordert "submitted" oder "editing"`);
  }

  session.status    = 'approved';
  session.approvedAt = new Date().toISOString();

  const db = await cds.connect.to('db');

  // Read answers directly from SessionAnswer rows — authoritative after FE draft save.
  // answersJson in WizardSession is only synced via the legacy editAnswer action and
  // the after-UPDATE handler; SessionAnswer rows are always up-to-date.
  const answerRows = await db.run(SELECT.from('tp.wizard.SessionAnswer').where({ session_sessionId: sessionId }));
  if (answerRows.length > 0) {
    session.answers = answerRows.map(r => ({
      questionId:    r.questionId,
      answer:        r.answer,
      source:        r.source,
      agentProposal: r.agentProposal
    }));
  }

  const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
  const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));
  const { tps } = deriveTPStructure(
    { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
    forlaTemplates,
    basicFormMappings
  );

  const validation = validateTPStructure(tps, forlaTemplates);
  if (!validation.valid) {
    session.status = 'failed';
    LOG.warn(`[M4.missed]: SAP-Schreibzugriff fehlgeschlagen — TP-Validierung: ${validation.warnings.join(', ')}`);
    return req.error(422, `TP-Struktur ungültig: ${validation.warnings.join(', ')}`);
  }

  let result;
  try {
    result = await flService.bulkCreateFunctionalLocations(tps);
  } catch (err) {
    session.status = 'failed';
    LOG.error(`[M4.missed]: SAP-Schreibzugriff fehlgeschlagen — Cloud Connector oder API-Fehler: ${err.message}`);
    return req.error(502, `SAP-Schreibzugriff fehlgeschlagen: ${err.message}`);
  }

  session.status         = 'created';
  session.derivedTPCount = tps.length;
  session.creationResult = JSON.stringify(result);

  await db.run(UPSERT.into('tp.wizard.WizardSession').entries({
    sessionId:      session.sessionId,
    ds100:          session.ds100,
    switchNumber:   session.switchNumber,
    basicForm:      session.basicForm,
    answersJson:    JSON.stringify(session.answers),
    status:         session.status,
    derivedTPCount: session.derivedTPCount,
    createdAt:      session.createdAt,
    submittedAt:    session.submittedAt,
    approvedAt:     session.approvedAt,
    creationResult: session.creationResult
  }));

  LOG.info(`[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs im System angelegt: ${tps.length}`);
  LOG.info(`[M5.achieved]: Zwei-Rollen-Flow vollstaendig durchlaufen — Katrin submitted, Thomas approved, SAP write success`);

  return {
    sessionId,
    created:    JSON.stringify(result.created),
    failed:     JSON.stringify(result.failed),
    openFields: JSON.stringify([])
  };
}

module.exports = (srv) => {

  // ── Health check ──────────────────────────────────────────────────────────
  srv.on('health', () => JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Create Session ────────────────────────────────────────────────────────
  srv.on('createSession', async (req) => {
    const { ds100, switchNumber, basicForm } = req.data;
    if (!ds100 || !switchNumber || !basicForm) {
      return req.error(400, 'ds100, switchNumber und basicForm sind Pflichtfelder');
    }

    const sessionId = uuidv4();
    SESSION_STORE.set(sessionId, {
      sessionId,
      ds100,
      switchNumber,
      basicForm,
      answers:   [],
      status:    'open',
      createdAt: new Date().toISOString()
    });

    LOG.info(`Session created: ${sessionId} for ${ds100} Weiche ${switchNumber} (${basicForm})`);
    return { sessionId, message: 'Session erstellt' };
  });

  // ── Submit Answer ─────────────────────────────────────────────────────────
  srv.on('submitAnswer', async (req) => {
    const { sessionId, questionId, answer, source } = req.data;
    const resolvedSource = source || 'katrin-confirmed';
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') return req.error(409, 'Session ist bereits abgeschlossen');

    const existingIdx = session.answers.findIndex(a => a.questionId === questionId);
    if (existingIdx >= 0) {
      const prev = session.answers[existingIdx];
      session.answers[existingIdx] = {
        questionId,
        answer,
        source:        resolvedSource,
        agentProposal: prev.agentProposal ?? (prev.source === 'agent-default' ? prev.answer : null)
      };
    } else {
      session.answers.push({ questionId, answer, source: resolvedSource, agentProposal: null });
    }

    const db = await cds.connect.to('db');
    const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));

    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates,
      basicFormMappings
    );
    session.tpPreview = tps;

    const nextQ = getNextQuestion(session, WIZARD_QUESTIONS);

    return {
      sessionId,
      nextQuestion: JSON.stringify(nextQ),
      tpPreview:    JSON.stringify(tps)
    };
  });

  // ── Get Next Question ─────────────────────────────────────────────────────
  srv.on('getNextQuestion', async (req) => {
    const session = SESSION_STORE.get(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);
    return JSON.stringify(getNextQuestion(session, WIZARD_QUESTIONS));
  });

  // ── Get TP Preview ────────────────────────────────────────────────────────
  srv.on('getTPPreview', async (req) => {
    const session = SESSION_STORE.get(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);

    const db = await cds.connect.to('db');
    const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));

    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates,
      basicFormMappings
    );
    return JSON.stringify(tps);
  });

  // ── Get Open Fields ───────────────────────────────────────────────────────
  srv.on('getOpenFields', async (req) => {
    const session = SESSION_STORE.get(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);
    return JSON.stringify(session.openFields || []);
  });

  // ── Export CSV ────────────────────────────────────────────────────────────
  srv.on('exportSessionCSV', async (req) => {
    const session = SESSION_STORE.get(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);

    const tps = session.tpPreview || [];
    const lines = ['tpKey,tpLabel,area,areaName,posNr,isAutomatic'];
    for (const tp of tps) {
      lines.push([
        tp.tpKey || '',
        `"${(tp.tpLabel || '').replace(/"/g, '""')}"`,
        tp.area || '',
        `"${tp.areaName || ''}"`,
        tp.posNr || '',
        tp.isAutomatic ? 'true' : 'false'
      ].join(','));
    }
    return lines.join('\n');
  });

  // ── Get Smart Defaults ────────────────────────────────────────────────────
  srv.on('getSmartDefaults', (req) => {
    const { basicForm } = req.data;
    if (!basicForm) return req.error(400, 'basicForm ist Pflichtfeld');
    return JSON.stringify(getSmartDefaults(basicForm));
  });

  // ── Bulk Submit With Defaults (agent shortcut — applies all remaining smart defaults then submits) ──
  srv.on('bulkSubmitWithDefaults', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') {
      return req.error(409, `Session hat Status "${session.status}" — bulkSubmitWithDefaults erfordert "open"`);
    }

    const defaults = getSmartDefaults(session.basicForm);
    const answeredIds = new Set(session.answers.map(a => a.questionId));
    let defaultedCount = 0;

    for (const d of defaults) {
      if (!answeredIds.has(d.questionId)) {
        session.answers.push({
          questionId:    d.questionId,
          answer:        d.defaultAnswer,
          source:        'agent-default',
          agentProposal: null
        });
        defaultedCount++;
      }
    }

    // Now run the same submit logic inline
    session.status      = 'submitted';
    session.submittedAt = new Date().toISOString();

    const db = await cds.connect.to('db');
    const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));
    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates,
      basicFormMappings
    );
    session.tpPreview = tps;

    await db.run(INSERT.into('tp.wizard.WizardSession').entries({
      sessionId:      session.sessionId,
      ds100:          session.ds100,
      switchNumber:   session.switchNumber,
      basicForm:      session.basicForm,
      answersJson:    JSON.stringify(session.answers),
      status:         session.status,
      derivedTPCount: tps.length,
      createdAt:      session.createdAt,
      submittedAt:    session.submittedAt,
      approvedAt:     null,
      creationResult: null,
      reviewComment:  null
    }));

    await _upsertSessionAnswers(db, session);
    await _upsertDerivedTPs(db, session.sessionId, tps);

    LOG.info(`bulkSubmitWithDefaults: ${defaultedCount} defaults applied, session ${sessionId} submitted`);
    return {
      sessionId,
      defaultedCount,
      status:  'submitted',
      message: `${defaultedCount} Standardwerte übernommen — Einreichung erfolgreich`
    };
  });

  // ── Submit Session (Katrin hands off to Thomas) ───────────────────────────
  srv.on('submitSession', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') return req.error(409, `Session hat Status "${session.status}" — submitSession erfordert "open"`);

    session.status      = 'submitted';
    session.submittedAt = new Date().toISOString();

    const db = await cds.connect.to('db');

    const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));
    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates,
      basicFormMappings
    );
    session.tpPreview = tps;

    await db.run(INSERT.into('tp.wizard.WizardSession').entries({
      sessionId:      session.sessionId,
      ds100:          session.ds100,
      switchNumber:   session.switchNumber,
      basicForm:      session.basicForm,
      answersJson:    JSON.stringify(session.answers),
      status:         session.status,
      derivedTPCount: tps.length,
      createdAt:      session.createdAt,
      submittedAt:    session.submittedAt,
      approvedAt:     null,
      creationResult: null,
      reviewComment:  null
    }));

    // Persist individual answers so Fiori Elements Object Page can navigate to them
    await _upsertSessionAnswers(db, session);

    // Persist TP structure snapshot so Thomas can review the tree in the Object Page
    await _upsertDerivedTPs(db, session.sessionId, tps);

    LOG.info(`Session submitted and persisted: ${sessionId}`);
    return { sessionId, message: 'Einreichung erfolgreich — wartet auf Freigabe durch Thomas' };
  });

  // ── Edit Answer (Thomas corrections via unbound action) ───────────────────
  srv.on('editAnswer', async (req) => {
    const { sessionId, questionId, answer } = req.data;
    const session = await _getSession(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (!['submitted', 'editing'].includes(session.status)) {
      return req.error(409, `Session hat Status "${session.status}" — editAnswer erfordert "submitted" oder "editing"`);
    }

    if (session.status === 'submitted') session.status = 'editing';

    const existingIdx = session.answers.findIndex(a => a.questionId === questionId);
    if (existingIdx >= 0) {
      session.answers[existingIdx] = { ...session.answers[existingIdx], answer, source: 'thomas-edited' };
    } else {
      session.answers.push({ questionId, answer, source: 'thomas-edited', agentProposal: null });
    }

    const db = await cds.connect.to('db');
    const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));
    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates, basicFormMappings
    );
    session.tpPreview = tps;

    await db.run(UPDATE('tp.wizard.WizardSession').set({
      answersJson:    JSON.stringify(session.answers),
      status:         session.status,
      derivedTPCount: tps.length
    }).where({ sessionId }));

    const q = QUESTION_MAP.get(questionId);
    await db.run(UPSERT.into('tp.wizard.SessionAnswer').entries({
      session_sessionId: sessionId,
      questionId,
      questionText:      q?.text     || questionId,
      area:              q?.area     || 0,
      areaName:          q?.areaName || '',
      answer,
      source:            'thomas-edited',
      agentProposal:     session.answers[existingIdx]?.agentProposal || null
    }));

    return { sessionId, tpPreview: JSON.stringify(tps) };
  });

  // ── Protect Sessions header fields from PATCH ────────────────────────────
  srv.before('UPDATE', 'Sessions', req => {
    delete req.data.ds100;
    delete req.data.switchNumber;
    delete req.data.basicForm;
  });

  // ── Sync answersJson after draft activation (and any Sessions UPDATE) ─────
  // When Thomas clicks Save in FE, CAP activates the draft and fires an UPDATE
  // on the active Sessions entity. At that point SessionAnswer rows are already
  // up-to-date; we sync answersJson so legacy functions (listPendingSessions,
  // getOpenHints) and SESSION_STORE keep working correctly.
  srv.after('UPDATE', 'Sessions', async (result, req) => {
    // In CAP after-handlers the first arg is the result (entity data), second is req.
    const sessionId = (Array.isArray(result) ? result[0]?.sessionId : result?.sessionId)
                   ?? req?.data?.sessionId ?? req?.params?.[0]?.sessionId;
    if (!sessionId) return;

    const db = await cds.connect.to('db');
    const answerRows = await db.run(
      SELECT.from('tp.wizard.SessionAnswer').where({ session_sessionId: sessionId })
    );
    if (!answerRows.length) return;

    const answers = answerRows.map(r => ({
      questionId:    r.questionId,
      answer:        r.answer,
      source:        r.source,
      agentProposal: r.agentProposal
    }));

    // Update WizardSession.answersJson and status
    const row = await db.run(SELECT.one.from('tp.wizard.WizardSession').where({ sessionId }));
    if (!row) return;

    const newStatus = row.status === 'submitted' ? 'editing' : row.status;
    await db.run(UPDATE('tp.wizard.WizardSession').set({
      answersJson: JSON.stringify(answers),
      status:      newStatus
    }).where({ sessionId }));

    // Keep SESSION_STORE in sync
    const mem = SESSION_STORE.get(sessionId);
    if (mem) {
      mem.answers = answers;
      mem.status  = newStatus;
    }

    // Refresh DerivedTP rows to reflect any answer changes Thomas may have saved
    const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));
    const sessionRow = mem || { basicForm: row.basicForm, ds100: row.ds100, switchNumber: row.switchNumber };
    const { tps } = deriveTPStructure(
      { basicForm: sessionRow.basicForm, ds100: sessionRow.ds100, switchNumber: sessionRow.switchNumber, answers },
      forlaTemplates,
      basicFormMappings
    );
    await _upsertDerivedTPs(db, sessionId, tps);
    if (mem) mem.tpPreview = tps;
  });

  // ── Edit Answer via OData PATCH (Fiori Elements inline editing) ───────────
  srv.on('UPDATE', 'SessionAnswers', async (req) => {
    const { session_sessionId: sessionId, questionId } = req.params[0];
    const { answer } = req.data;

    const session = await _getSession(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (!['submitted', 'editing'].includes(session.status)) {
      return req.error(409, `Session hat Status "${session.status}" — Bearbeitung erfordert "submitted" oder "editing"`);
    }

    if (session.status === 'submitted') session.status = 'editing';

    const existingIdx = session.answers.findIndex(a => a.questionId === questionId);
    if (existingIdx >= 0) {
      session.answers[existingIdx] = { ...session.answers[existingIdx], answer, source: 'thomas-edited' };
    } else {
      session.answers.push({ questionId, answer, source: 'thomas-edited', agentProposal: null });
    }

    const db = await cds.connect.to('db');
    await db.run(UPDATE('tp.wizard.WizardSession').set({
      answersJson: JSON.stringify(session.answers),
      status:      session.status
    }).where({ sessionId }));

    await db.run(UPSERT.into('tp.wizard.SessionAnswer').entries({
      session_sessionId: sessionId,
      questionId,
      answer,
      source:        'thomas-edited',
      agentProposal: session.answers[existingIdx]?.agentProposal || null
    }));

    return req.data;
  });

  // ── Approve Session — unbound (kept for agent/legacy callers) ─────────────
  srv.on('approveSession', async (req) => {
    return _doApprove(req.data.sessionId, req);
  });

  // ── Approve Session — bound action called by Fiori Elements ──────────────
  srv.on('approve', 'Sessions', async (req) => {
    const { sessionId } = req.params[0];
    return _doApprove(sessionId, req);
  });

  // ── List Pending Sessions (legacy function — reads DB + in-memory) ─────────
  srv.on('listPendingSessions', async () => {
    const db = await cds.connect.to('db');
    const dbSessions = await db.run(
      SELECT.from('tp.wizard.WizardSession').where({ status: ['submitted', 'editing'] })
    );

    const result = [];
    for (const row of dbSessions) {
      const mem = SESSION_STORE.get(row.sessionId);
      const answers = mem?.answers ?? JSON.parse(row.answersJson || '[]');
      result.push({
        sessionId:      row.sessionId,
        ds100:          row.ds100,
        switchNumber:   row.switchNumber,
        basicForm:      row.basicForm,
        status:         row.status,
        submittedAt:    row.submittedAt,
        derivedTPCount: row.derivedTPCount ?? (mem?.tpPreview || []).length,
        openHintCount:  _computeOpenHints({ answers }).length
      });
    }
    return JSON.stringify(result);
  });

  // ── Get Open Hints (agent assumptions Thomas should review) ───────────────
  srv.on('getOpenHints', async (req) => {
    const { sessionId } = req.data;
    const session = await _getSession(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    return JSON.stringify(_computeOpenHints(session));
  });
};
