'use strict';

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const { deriveTPStructure, getNextQuestion, validateTPStructure } = require('./rule-engine-service');
const { WIZARD_QUESTIONS } = require('./lib/wizard-questions');
const flService = require('./fl-service');

const LOG = cds.log('wizard-service');

// In-memory session store (Hackathon: no persistence needed)
const SESSION_STORE = new Map();

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

  // ── Confirm Session (trigger SAP creation) ────────────────────────────────
  srv.on('confirmSession', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') return req.error(409, 'Session ist bereits abgeschlossen');

    const db = await cds.connect.to('db');
    const forlaTemplates    = await db.run(SELECT.from('tp.wizard.ForlaTemplate'));
    const basicFormMappings = await db.run(SELECT.from('tp.wizard.BasicFormMapping'));

    const { tps } = deriveTPStructure(
      { basicForm: session.basicForm, ds100: session.ds100, switchNumber: session.switchNumber, answers: session.answers },
      forlaTemplates,
      basicFormMappings
    );

    const validation = validateTPStructure(tps, forlaTemplates);
    if (!validation.valid) {
      return req.error(422, `TP-Struktur ungültig: ${validation.warnings.join(', ')}`);
    }

    const result = await flService.bulkCreateFunctionalLocations(tps);

    session.status = 'created';
    session.derivedTPCount = tps.length;
    session.creationResult = JSON.stringify(result);

    // Persist audit record to DB
    await db.run(INSERT.into('tp.wizard.WizardSession').entries({
      sessionId: session.sessionId,
      ds100: session.ds100,
      switchNumber: session.switchNumber,
      basicForm: session.basicForm,
      answersJson: JSON.stringify(session.answers),
      status: session.status,
      derivedTPCount: session.derivedTPCount,
      createdAt: session.createdAt,
      creationResult: session.creationResult
    }));

    return {
      sessionId,
      created: JSON.stringify(result.created),
      failed:  JSON.stringify(result.failed),
      openFields: JSON.stringify([])
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
};
