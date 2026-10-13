'use strict';

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const { deriveTPStructure, getNextQuestion, validateTPStructure } = require('./rule-engine-service');
const { WIZARD_QUESTIONS } = require('./lib/wizard-questions');
const flService = require('./fl-service');
const { getSmartDefaults } = require('./lib/smart-defaults');

const LOG = cds.log('wizard-service');

// In-memory session store (Hackathon: no persistence needed)
const SESSION_STORE = new Map();

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
      answers: [],
      status: 'open',
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

    // Update or add answer, preserving agentProposal for overrides
    const existingIdx = session.answers.findIndex(a => a.questionId === questionId);
    if (existingIdx >= 0) {
      const prev = session.answers[existingIdx];
      session.answers[existingIdx] = {
        questionId,
        answer,
        source: resolvedSource,
        agentProposal: prev.agentProposal ?? (prev.source === 'agent-default' ? prev.answer : null)
      };
    } else {
      session.answers.push({ questionId, answer, source: resolvedSource, agentProposal: null });
    }

    // Derive TP preview with current answers
    const db = await cds.connect.to('db');
    const forlaTemplates   = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
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
      tpPreview: JSON.stringify(tps)
    };
  });

  // ── Get Next Question ─────────────────────────────────────────────────────
  srv.on('getNextQuestion', async (req) => {
    const sessionId = req.data.sessionId;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    const nextQ = getNextQuestion(session, WIZARD_QUESTIONS);
    return JSON.stringify(nextQ);
  });

  // ── Get TP Preview ────────────────────────────────────────────────────────
  srv.on('getTPPreview', async (req) => {
    const sessionId = req.data.sessionId;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);

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
    const sessionId = req.data.sessionId;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    // After creation, open fields would be populated from SAP feedback
    return JSON.stringify(session.openFields || []);
  });

  // ── Export CSV ────────────────────────────────────────────────────────────
  srv.on('exportSessionCSV', async (req) => {
    const sessionId = req.data.sessionId;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);

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

  // ── Submit Session (Katrin hands off to Thomas) ───────────────────────────
  srv.on('submitSession', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') return req.error(409, `Session hat Status "${session.status}" — submitSession erfordert "open"`);

    session.status = 'submitted';
    session.submittedAt = new Date().toISOString();

    const db = await cds.connect.to('db');
    await db.run(INSERT.into('tp.wizard.WizardSession').entries({
      sessionId:      session.sessionId,
      ds100:          session.ds100,
      switchNumber:   session.switchNumber,
      basicForm:      session.basicForm,
      answersJson:    JSON.stringify(session.answers),
      status:         session.status,
      derivedTPCount: session.tpPreview?.length ?? 0,
      createdAt:      session.createdAt,
      submittedAt:    session.submittedAt,
      approvedAt:     null,
      creationResult: null
    }));

    LOG.info(`Session submitted and persisted: ${sessionId}`);
    return { sessionId, message: 'Einreichung erfolgreich — wartet auf Freigabe durch Thomas' };
  });

  // ── Edit Answer (Thomas corrections) ─────────────────────────────────────
  srv.on('editAnswer', async (req) => {
    const { sessionId, questionId, answer } = req.data;
    const session = SESSION_STORE.get(sessionId);
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
    const forlaTemplates   = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));
    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates, basicFormMappings
    );
    session.tpPreview = tps;

    return { sessionId, tpPreview: JSON.stringify(tps) };
  });

  // ── Approve Session (Thomas — ONLY SAP write path) ────────────────────────
  srv.on('approveSession', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (!['submitted', 'editing'].includes(session.status)) {
      return req.error(409, `Session hat Status "${session.status}" — approveSession erfordert "submitted" oder "editing"`);
    }

    session.status = 'approved';
    session.approvedAt = new Date().toISOString();

    const db = await cds.connect.to('db');
    const forlaTemplates   = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));
    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates, basicFormMappings
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

    session.status = 'created';
    session.derivedTPCount = tps.length;
    session.creationResult = JSON.stringify(result);

    await db.run(UPSERT.into('tp.wizard.WizardSession').entries({
      sessionId: session.sessionId,
      ds100: session.ds100,
      switchNumber: session.switchNumber,
      basicForm: session.basicForm,
      answersJson: JSON.stringify(session.answers),
      status: session.status,
      derivedTPCount: session.derivedTPCount,
      createdAt: session.createdAt,
      submittedAt: session.submittedAt,
      approvedAt: session.approvedAt,
      creationResult: session.creationResult
    }));

    LOG.info(`[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs im System angelegt: ${tps.length}`);
    LOG.info(`[M5.achieved]: Zwei-Rollen-Flow vollstaendig durchlaufen — Katrin submitted, Thomas approved, SAP write success`);

    return {
      sessionId,
      created: JSON.stringify(result.created),
      failed:  JSON.stringify(result.failed),
      openFields: JSON.stringify([])
    };
  });

  // ── List Pending Sessions (Thomas dashboard) ──────────────────────────────
  srv.on('listPendingSessions', () => {
    const pending = [];
    for (const session of SESSION_STORE.values()) {
      if (!['submitted', 'editing'].includes(session.status)) continue;
      pending.push({
        sessionId:       session.sessionId,
        ds100:           session.ds100,
        switchNumber:    session.switchNumber,
        basicForm:       session.basicForm,
        status:          session.status,
        submittedAt:     session.submittedAt,
        derivedTPCount:  (session.tpPreview || []).length,
        openHintCount:   _computeOpenHints(session).length
      });
    }
    return JSON.stringify(pending);
  });

  // ── Get Open Hints (agent assumptions Thomas should review) ───────────────
  srv.on('getOpenHints', (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    return JSON.stringify(_computeOpenHints(session));
  });
};
