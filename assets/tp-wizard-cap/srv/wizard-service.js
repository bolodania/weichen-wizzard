'use strict';

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const flService = require('./fl-service');
const { ladeKatalog } = require('./lib/katalog');
const { ableitenTps, naechsteFrage, vorgaben, validiere, uebernehmeDokumentwerte } = require('./lib/weiche');

const LOG = cds.log('wizard-service');

// In-memory session store — primary store during active session lifetime.
// After submitSession the session is also in the DB; _loadSessionFromDb
// can rebuild it from there (e.g. after a server restart).
const SESSION_STORE = new Map();

// Herkunft eines Angabe-Werts aus der Workflow-Quelle ableiten (falls nicht explizit gesetzt).
function herkunftVon(a) {
  if (a.herkunft) return a.herkunft;
  switch (a.source) {
    case 'agent-default': return 'Vorgabe';
    case 'auto': return 'Stammdaten';
    case 'agent': return 'Dokument';
    default: return 'Manuell'; // human-confirmed | human-corrected | thomas-edited | sonstige
  }
}

// Shared helper — both listPendingSessions and getOpenHints use this so counts are always consistent.
function _computeOpenHints(session) {
  const hints = [];
  for (const a of session.answers || []) {
    if (a.source === 'agent-default' || a.source === 'auto') {
      hints.push({
        questionId: a.questionId,
        answer: a.answer,
        source: a.source,
        agentProposal: a.agentProposal,
        hint: `Wert "${a.answer}" wurde als Standard gesetzt (${a.source}). Bitte prüfen, ob dies für diese Weiche zutrifft.`,
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
  return SESSION_STORE.get(sessionId) || (await _loadSessionFromDb(sessionId));
}

// Persist all SessionAnswer rows for a session.
async function _upsertSessionAnswers(db, session, katalog) {
  const eingabeById = new Map(katalog.eingaben.map((e) => [e.ID, e]));
  for (const a of session.answers || []) {
    const e = eingabeById.get(a.questionId);
    await db.run(
      UPSERT.into('tp.wizard.SessionAnswer').entries({
        session_sessionId: session.sessionId,
        questionId: a.questionId,
        questionText: (e && e.frage) || a.questionId,
        area: (e && e.bereich) || '',
        answer: a.answer || '',
        source: a.source || 'auto',
        herkunft: herkunftVon(a),
        beleg: a.beleg || null,
        agentProposal: a.agentProposal || null,
      }),
    );
  }
}

// Persist DerivedTP rows for a session — DELETE existing, then INSERT fresh.
// Hierarchy (level, parentTpKey) comes directly from the rule engine.
async function _upsertDerivedTPs(db, sessionId, tps) {
  await db.run(DELETE.from('tp.wizard.DerivedTP').where({ session_sessionId: sessionId }));
  for (const tp of tps) {
    await db.run(
      INSERT.into('tp.wizard.DerivedTP').entries({
        session_sessionId: sessionId,
        tpKey: tp.tpKey || '',
        posNr: tp.posNr || '',
        tpLabel: tp.tpLabel || '',
        area: tp.area || '',
        level: tp.level ?? 0,
        parentTpKey: tp.parentTpKey,
        isAutomatic: tp.isAutomatic ?? false,
        planergruppe: tp.planergruppe || '',
        klassen: tp.klassen || '',
        regel: tp.regel ?? null,
        muster: tp.muster || '',
      }),
    );
  }
}

// Core approve logic — shared by unbound approveSession and bound Sessions.approve.
async function _doApprove(sessionId, req) {
  const session = await _getSession(sessionId);
  if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
  if (!['submitted', 'editing'].includes(session.status)) {
    return req.error(409, `Session hat Status "${session.status}" — approve erfordert "submitted" oder "editing"`);
  }

  session.status = 'approved';
  session.approvedAt = new Date().toISOString();

  const db = await cds.connect.to('db');

  // Read answers directly from SessionAnswer rows — authoritative after FE draft save.
  const answerRows = await db.run(SELECT.from('tp.wizard.SessionAnswer').where({ session_sessionId: sessionId }));
  if (answerRows.length > 0) {
    session.answers = answerRows.map((r) => ({
      questionId: r.questionId,
      answer: r.answer,
      source: r.source,
      herkunft: r.herkunft,
      beleg: r.beleg,
      agentProposal: r.agentProposal,
    }));
  }

  const katalog = await ladeKatalog();
  const { tps } = ableitenTps(katalog, session);

  const validation = validiere(tps);
  if (!validation.valid) {
    session.status = 'failed';
    LOG.warn(`[M4.missed]: TP-Validierung fehlgeschlagen: ${validation.warnings.join(', ')}`);
    return req.error(422, `TP-Struktur ungültig: ${validation.warnings.join(', ')}`);
  }

  let result;
  try {
    result = await flService.bulkCreateFunctionalLocations(tps);
  } catch (err) {
    session.status = 'failed';
    LOG.error(`[M4.missed]: SAP-Schreibzugriff fehlgeschlagen: ${err.message}`);
    return req.error(502, `SAP-Schreibzugriff fehlgeschlagen: ${err.message}`);
  }

  session.status = 'created';
  session.derivedTPCount = tps.length;
  session.creationResult = JSON.stringify(result);

  await db.run(
    UPSERT.into('tp.wizard.WizardSession').entries({
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
      creationResult: session.creationResult,
    }),
  );

  LOG.info(`[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs angelegt: ${tps.length}`);
  LOG.info(`[M5.achieved]: Zwei-Rollen-Flow vollständig — Katrin submitted, Thomas approved, SAP write success`);

  return {
    sessionId,
    created: JSON.stringify(result.created),
    failed: JSON.stringify(result.failed),
    openFields: JSON.stringify([]),
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
      fertigmeldung: req.data.fertigmeldung || null,
      answers: [],
      status: 'open',
      createdAt: new Date().toISOString(),
    });

    LOG.info(`Session created: ${sessionId} für ${ds100} Weiche ${switchNumber} (${basicForm})`);
    return { sessionId, message: 'Session erstellt' };
  });

  // ── Submit Answer ─────────────────────────────────────────────────────────
  srv.on('submitAnswer', async (req) => {
    const { sessionId, questionId, answer, source } = req.data;
    const resolvedSource = source || 'human-confirmed';
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') return req.error(409, 'Session ist bereits abgeschlossen');

    const existingIdx = session.answers.findIndex((a) => a.questionId === questionId);
    if (existingIdx >= 0) {
      const prev = session.answers[existingIdx];
      session.answers[existingIdx] = {
        questionId,
        answer,
        source: resolvedSource,
        agentProposal: prev.agentProposal ?? (prev.source === 'agent-default' ? prev.answer : null),
      };
    } else {
      session.answers.push({ questionId, answer, source: resolvedSource, agentProposal: null });
    }

    const katalog = await ladeKatalog();
    const { tps } = ableitenTps(katalog, session);
    session.tpPreview = tps;

    const nextQ = naechsteFrage(katalog, session);

    return {
      sessionId,
      nextQuestion: JSON.stringify(nextQ),
      tpPreview: JSON.stringify(tps),
    };
  });

  // ── Apply Document Values (agent reads Fertigmeldung — each value needs a verbatim citation) ──
  srv.on('applyDocumentValues', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') return req.error(409, 'Session ist bereits abgeschlossen');

    let werte;
    try {
      werte = JSON.parse(req.data.values || '[]');
    } catch (err) {
      return req.error(400, `values ist kein gültiges JSON: ${err.message}`);
    }

    const katalog = await ladeKatalog();
    const { uebernommen, abgelehnt } = uebernehmeDokumentwerte(katalog, session, werte);

    for (const u of uebernommen) {
      const idx = session.answers.findIndex((a) => a.questionId === u.questionId);
      const eintrag = {
        questionId: u.questionId,
        answer: u.answer,
        source: u.source,
        herkunft: u.herkunft,
        beleg: u.beleg,
        agentProposal: null,
      };
      if (idx >= 0) session.answers[idx] = eintrag;
      else session.answers.push(eintrag);
    }

    const { tps } = ableitenTps(katalog, session);
    session.tpPreview = tps;

    return {
      sessionId,
      uebernommen: JSON.stringify(uebernommen),
      abgelehnt: JSON.stringify(abgelehnt),
      tpPreview: JSON.stringify(tps),
    };
  });

  // ── Get Next Question ─────────────────────────────────────────────────────
  srv.on('getNextQuestion', async (req) => {
    const session = SESSION_STORE.get(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);
    const katalog = await ladeKatalog();
    return JSON.stringify(naechsteFrage(katalog, session));
  });

  // ── Get TP Preview ────────────────────────────────────────────────────────
  srv.on('getTPPreview', async (req) => {
    const session = SESSION_STORE.get(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);
    const katalog = await ladeKatalog();
    const { tps } = ableitenTps(katalog, session);
    return JSON.stringify(tps);
  });

  // ── Get Open Fields ───────────────────────────────────────────────────────
  srv.on('getOpenFields', async (req) => {
    const session = SESSION_STORE.get(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);
    const katalog = await ladeKatalog();
    const { offeneAngaben } = ableitenTps(katalog, session);
    return JSON.stringify(offeneAngaben);
  });

  // ── Export CSV ────────────────────────────────────────────────────────────
  srv.on('exportSessionCSV', async (req) => {
    const session = SESSION_STORE.get(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);

    const tps = session.tpPreview || [];
    const lines = ['tpKey,tpLabel,area,posNr,planergruppe,isAutomatic'];
    for (const tp of tps) {
      lines.push(
        [
          tp.tpKey || '',
          `"${(tp.tpLabel || '').replace(/"/g, '""')}"`,
          `"${tp.area || ''}"`,
          tp.posNr || '',
          tp.planergruppe || '',
          tp.isAutomatic ? 'true' : 'false',
        ].join(','),
      );
    }
    return lines.join('\n');
  });

  // ── Get Smart Defaults (Vorgaben aus dem Eingabenkatalog) ──────────────────
  srv.on('getSmartDefaults', async (req) => {
    const { basicForm } = req.data;
    if (!basicForm) return req.error(400, 'basicForm ist Pflichtfeld');
    const katalog = await ladeKatalog();
    return JSON.stringify(vorgaben(katalog, basicForm));
  });

  // ── Bulk Submit With Defaults (agent shortcut — applies remaining defaults then submits) ──
  srv.on('bulkSubmitWithDefaults', async (req) => {
    const { sessionId } = req.data;
    const session = SESSION_STORE.get(sessionId);
    if (!session) return req.error(404, `Session ${sessionId} nicht gefunden`);
    if (session.status !== 'open') {
      return req.error(409, `Session hat Status "${session.status}" — bulkSubmitWithDefaults erfordert "open"`);
    }

    const katalog = await ladeKatalog();
    const defaults = vorgaben(katalog, session.basicForm);
    const answeredIds = new Set(session.answers.map((a) => a.questionId));
    let defaultedCount = 0;

    for (const d of defaults) {
      if (!answeredIds.has(d.questionId)) {
        session.answers.push({ questionId: d.questionId, answer: d.defaultAnswer, source: 'agent-default', agentProposal: null });
        defaultedCount++;
      }
    }

    session.status = 'submitted';
    session.submittedAt = new Date().toISOString();

    const db = await cds.connect.to('db');
    const { tps } = ableitenTps(katalog, session);
    session.tpPreview = tps;

    await db.run(
      INSERT.into('tp.wizard.WizardSession').entries({
        sessionId: session.sessionId,
        ds100: session.ds100,
        switchNumber: session.switchNumber,
        basicForm: session.basicForm,
        fertigmeldung: session.fertigmeldung || null,
        answersJson: JSON.stringify(session.answers),
        status: session.status,
        derivedTPCount: tps.length,
        createdAt: session.createdAt,
        submittedAt: session.submittedAt,
        approvedAt: null,
        creationResult: null,
        reviewComment: null,
      }),
    );

    await _upsertSessionAnswers(db, session, katalog);
    await _upsertDerivedTPs(db, session.sessionId, tps);

    LOG.info(`bulkSubmitWithDefaults: ${defaultedCount} Vorgaben übernommen, Session ${sessionId} eingereicht`);
    return {
      sessionId,
      defaultedCount,
      status: 'submitted',
      message: `${defaultedCount} Standardwerte übernommen — Einreichung erfolgreich`,
    };
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
    const katalog = await ladeKatalog();
    const { tps } = ableitenTps(katalog, session);
    session.tpPreview = tps;

    await db.run(
      INSERT.into('tp.wizard.WizardSession').entries({
        sessionId: session.sessionId,
        ds100: session.ds100,
        switchNumber: session.switchNumber,
        basicForm: session.basicForm,
        fertigmeldung: session.fertigmeldung || null,
        answersJson: JSON.stringify(session.answers),
        status: session.status,
        derivedTPCount: tps.length,
        createdAt: session.createdAt,
        submittedAt: session.submittedAt,
        approvedAt: null,
        creationResult: null,
        reviewComment: null,
      }),
    );

    await _upsertSessionAnswers(db, session, katalog);
    await _upsertDerivedTPs(db, session.sessionId, tps);

    LOG.info(`Session eingereicht und persistiert: ${sessionId}`);
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

    const existingIdx = session.answers.findIndex((a) => a.questionId === questionId);
    if (existingIdx >= 0) {
      session.answers[existingIdx] = { ...session.answers[existingIdx], answer, source: 'thomas-edited', herkunft: 'Manuell' };
    } else {
      session.answers.push({ questionId, answer, source: 'thomas-edited', herkunft: 'Manuell', agentProposal: null });
    }

    const db = await cds.connect.to('db');
    const katalog = await ladeKatalog();
    const { tps } = ableitenTps(katalog, session);
    session.tpPreview = tps;

    await db.run(
      UPDATE('tp.wizard.WizardSession')
        .set({ answersJson: JSON.stringify(session.answers), status: session.status, derivedTPCount: tps.length })
        .where({ sessionId }),
    );

    const e = katalog.eingaben.find((x) => x.ID === questionId);
    await db.run(
      UPSERT.into('tp.wizard.SessionAnswer').entries({
        session_sessionId: sessionId,
        questionId,
        questionText: (e && e.frage) || questionId,
        area: (e && e.bereich) || '',
        answer,
        source: 'thomas-edited',
        herkunft: 'Manuell',
        beleg: null,
        agentProposal: session.answers[existingIdx]?.agentProposal || null,
      }),
    );

    await _upsertDerivedTPs(db, sessionId, tps);

    return { sessionId, tpPreview: JSON.stringify(tps) };
  });

  // ── Protect Sessions header fields from PATCH ────────────────────────────
  srv.before('UPDATE', 'Sessions', (req) => {
    delete req.data.ds100;
    delete req.data.switchNumber;
    delete req.data.basicForm;
  });

  // ── Sync answersJson + DerivedTP after draft activation (and any Sessions UPDATE) ─────
  srv.after('UPDATE', 'Sessions', async (result, req) => {
    const sessionId =
      (Array.isArray(result) ? result[0]?.sessionId : result?.sessionId) ??
      req?.data?.sessionId ??
      req?.params?.[0]?.sessionId;
    if (!sessionId) return;

    const db = await cds.connect.to('db');
    const answerRows = await db.run(SELECT.from('tp.wizard.SessionAnswer').where({ session_sessionId: sessionId }));
    if (!answerRows.length) return;

    const answers = answerRows.map((r) => ({
      questionId: r.questionId,
      answer: r.answer,
      source: r.source,
      herkunft: r.herkunft,
      beleg: r.beleg,
      agentProposal: r.agentProposal,
    }));

    const row = await db.run(SELECT.one.from('tp.wizard.WizardSession').where({ sessionId }));
    if (!row) return;

    const newStatus = row.status === 'submitted' ? 'editing' : row.status;
    await db.run(UPDATE('tp.wizard.WizardSession').set({ answersJson: JSON.stringify(answers), status: newStatus }).where({ sessionId }));

    const mem = SESSION_STORE.get(sessionId);
    if (mem) {
      mem.answers = answers;
      mem.status = newStatus;
    }

    const katalog = await ladeKatalog();
    const sessionRow = mem || { basicForm: row.basicForm, ds100: row.ds100, switchNumber: row.switchNumber, answers };
    const { tps } = ableitenTps(katalog, { ...sessionRow, answers });
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

    const existingIdx = session.answers.findIndex((a) => a.questionId === questionId);
    if (existingIdx >= 0) {
      session.answers[existingIdx] = { ...session.answers[existingIdx], answer, source: 'thomas-edited', herkunft: 'Manuell' };
    } else {
      session.answers.push({ questionId, answer, source: 'thomas-edited', herkunft: 'Manuell', agentProposal: null });
    }

    const db = await cds.connect.to('db');
    await db.run(UPDATE('tp.wizard.WizardSession').set({ answersJson: JSON.stringify(session.answers), status: session.status }).where({ sessionId }));

    await db.run(
      UPSERT.into('tp.wizard.SessionAnswer').entries({
        session_sessionId: sessionId,
        questionId,
        answer,
        source: 'thomas-edited',
        herkunft: 'Manuell',
        agentProposal: session.answers[existingIdx]?.agentProposal || null,
      }),
    );

    return req.data;
  });

  // ── Approve Session — unbound (kept for agent/legacy callers) ─────────────
  srv.on('approveSession', async (req) => _doApprove(req.data.sessionId, req));

  // ── Approve Session — bound action called by Fiori Elements ──────────────
  srv.on('approve', 'Sessions', async (req) => {
    const { sessionId } = req.params[0];
    return _doApprove(sessionId, req);
  });

  // ── List Pending Sessions ─────────────────────────────────────────────────
  srv.on('listPendingSessions', async () => {
    const db = await cds.connect.to('db');
    const dbSessions = await db.run(SELECT.from('tp.wizard.WizardSession').where({ status: ['submitted', 'editing'] }));

    const result = [];
    for (const row of dbSessions) {
      const mem = SESSION_STORE.get(row.sessionId);
      const answers = mem?.answers ?? JSON.parse(row.answersJson || '[]');
      result.push({
        sessionId: row.sessionId,
        ds100: row.ds100,
        switchNumber: row.switchNumber,
        basicForm: row.basicForm,
        status: row.status,
        submittedAt: row.submittedAt,
        derivedTPCount: row.derivedTPCount ?? (mem?.tpPreview || []).length,
        openHintCount: _computeOpenHints({ answers }).length,
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
