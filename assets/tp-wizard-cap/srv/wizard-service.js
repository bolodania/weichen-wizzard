'use strict';

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const flService = require('./fl-service');
const { ladeKatalog } = require('./lib/katalog');
const { ableitenTps, naechsteFrage, vorgaben, validiere, uebernehmeDokumentwerte, normalisiert } = require('./lib/weiche');

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
  const { tps, offeneAngaben } = ableitenTps(katalog, session);
  if (offeneAngaben.length) {
    return req.reject(422, `Pflichtangaben fehlen: ${offeneAngaben.join(', ')}`);
  }

  const validation = validiere(tps);
  if (!validation.valid) {
    LOG.warn(`[M4.missed]: TP-Validierung fehlgeschlagen: ${validation.warnings.join(', ')}`);
    return req.error(422, `TP-Struktur ungültig: ${validation.warnings.join(', ')}`);
  }

  let result;
  session.approvedAt = new Date().toISOString();
  try {
    result = await flService.bulkCreateFunctionalLocations(tps);
  } catch (err) {
    LOG.error(`[M4.missed]: SAP-Schreibzugriff fehlgeschlagen: ${err.message}`);
    result = { created: [], failed: tps.map((tp) => ({ tpKey: tp.tpKey, error: err.message })) };
  }

  session.status = result.failed.length ? 'failed' : 'created';
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

  if (result.failed.length) {
    LOG.warn(`[M4.missed]: ${result.failed.length} TPs konnten nicht angelegt werden`);
  } else {
    LOG.info(`[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs angelegt: ${tps.length}`);
    LOG.info(`[M5.achieved]: Zwei-Rollen-Flow vollständig — Katrin submitted, Thomas approved, SAP write success`);
  }

  return {
    sessionId,
    created: JSON.stringify(result.created),
    failed: JSON.stringify(result.failed),
    openFields: JSON.stringify([]),
  };
}

module.exports = (srv) => {
  srv.on('getLocationValues', require('./lib/location-value-help').getLocationValues);
  // ── Health check ──────────────────────────────────────────────────────────
  srv.on('health', () => JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Create Session ────────────────────────────────────────────────────────
  srv.on('createSession', async (req) => {
    const { ds100, switchNumber, basicForm } = req.data;
    if (!ds100 || !switchNumber || !basicForm) {
      return req.error(400, 'ds100, switchNumber und basicForm sind Pflichtfelder');
    }
    if (!/^\d{1,7}$/.test(switchNumber)) {
      return req.reject(400, 'Weichennummer muss aus 1 bis 7 Ziffern bestehen');
    }
    if (ds100.length > 10) return req.reject(400, 'Betriebsstelle darf maximal 10 Zeichen enthalten');

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
    const session = await _getSession(sessionId);
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
    const session = await _getSession(sessionId);
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
    const session = await _getSession(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);
    const katalog = await ladeKatalog();
    return JSON.stringify(naechsteFrage(katalog, session));
  });

  // ── Get TP Preview ────────────────────────────────────────────────────────
  srv.on('getTPPreview', async (req) => {
    const session = await _getSession(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);
    const katalog = await ladeKatalog();
    const { tps } = ableitenTps(katalog, session);
    return JSON.stringify(tps);
  });

  // ── Get Open Fields ───────────────────────────────────────────────────────
  srv.on('getOpenFields', async (req) => {
    const session = await _getSession(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);
    const katalog = await ladeKatalog();
    const { offeneAngaben } = ableitenTps(katalog, session);
    return JSON.stringify(offeneAngaben);
  });

  // ── Export CSV ────────────────────────────────────────────────────────────
  srv.on('exportSessionCSV', async (req) => {
    const session = await _getSession(req.data.sessionId);
    if (!session) return req.error(404, `Session ${req.data.sessionId} nicht gefunden`);

    const { tps } = ableitenTps(await ladeKatalog(), session);
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
    const session = await _getSession(sessionId);
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
    const session = await _getSession(sessionId);
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
    await db.run(UPDATE('tp.wizard.WizardSession').set({ derivedTPCount: tps.length }).where({ sessionId }));
    if (mem) mem.tpPreview = tps;
  });

  // ── Edit Answer via OData PATCH (Fiori Elements inline editing) ───────────
  srv.on('UPDATE', 'SessionAnswers', async (req) => {
    const keys = req.params[req.params.length - 1];
    const sessionId = keys.session_sessionId || req.params[0].sessionId;
    const { questionId } = keys;
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
        beleg: null,
        agentProposal: session.answers[existingIdx]?.agentProposal || null,
      }),
    );

    const { tps } = ableitenTps(await ladeKatalog(), session);
    session.tpPreview = tps;
    session.derivedTPCount = tps.length;
    await _upsertDerivedTPs(db, sessionId, tps);
    await db.run(UPDATE('tp.wizard.WizardSession').set({ derivedTPCount: tps.length }).where({ sessionId }));
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

  // ── Upload Document ───────────────────────────────────────────────────────
  srv.on('uploadDocument', async (req) => {
    const { sessionId, filename, mimeType, contentB64 } = req.data;
    if (!sessionId || !filename || !contentB64) {
      return req.error(400, 'sessionId, filename und contentB64 sind Pflichtfelder');
    }

    const session = await _getSession(sessionId);
    if (!session) return req.reject(404, `Session ${sessionId} nicht gefunden`);
    const db = await cds.connect.to('db');

    // Decode base64 → Buffer
    const content = Buffer.from(contentB64, 'base64');
    const uploadedAt = new Date().toISOString();

    // Best-effort text extraction: try pdftotext (poppler), fall back to raw string scan
    let extractedText = '';
    const fs = require('fs');
    const tmpIn = require('path').join(require('os').tmpdir(), `tp-doc-${uuidv4()}.pdf`);
    try {
      const { execFileSync } = require('child_process');
      fs.writeFileSync(tmpIn, content);
      extractedText = execFileSync('pdftotext', [tmpIn, '-'], { timeout: 10000 }).toString();
    } catch (_) {
      // pdftotext not available — use raw text extraction as fallback
      extractedText = content.toString('latin1').replace(/[^\x20-\x7E\n\r\t\u00C0-\u00FF]/g, ' ');
    } finally {
      if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    }

    // Run rule-based analysis
    const katalog = await ladeKatalog();
    const analysisJson = session
      ? JSON.stringify(_analyseDocument(katalog, session, extractedText))
      : JSON.stringify({ error: 'Session nicht gefunden' });

    // Persist document
    await db.run(
      UPSERT.into('tp.wizard.SessionDocument').entries({
        sessionId,
        filename,
        mimeType: mimeType || 'application/pdf',
        content,
        uploadedAt,
        extractedText,
        analysisJson,
        analysisDoneAt: new Date().toISOString(),
      }),
    );

    LOG.info(`[M2.achieved]: Dokument hochgeladen und analysiert: ${filename} für Session ${sessionId}`);
    return { sessionId, filename, analysisJson };
  });

  // ── Analyse Document (re-run analysis on existing document) ──────────────
  srv.on('analyseDocument', async (req) => {
    const { sessionId, filename } = req.data;
    const db = await cds.connect.to('db');

    const doc = await db.run(
      SELECT.one.from('tp.wizard.SessionDocument').where({ sessionId, filename }),
    );
    if (!doc) return req.error(404, `Dokument "${filename}" für Session ${sessionId} nicht gefunden`);

    const katalog = await ladeKatalog();
    const session = await _getSession(sessionId);
    const analysisJson = session
      ? JSON.stringify(_analyseDocument(katalog, session, doc.extractedText || ''))
      : JSON.stringify({ error: 'Session nicht gefunden' });

    await db.run(
      UPDATE('tp.wizard.SessionDocument')
        .set({ analysisJson, analysisDoneAt: new Date().toISOString() })
        .where({ sessionId, filename }),
    );

    return { sessionId, analysisJson };
  });

  // ── Approver Chat (proxy to Python A2A agent) ─────────────────────────────
  srv.on('approverChat', async (req) => {
    const { sessionId, contextId, message } = req.data;
    if (!sessionId || !message) return req.error(400, 'sessionId und message sind Pflichtfelder');

    const agentClient = require('./lib/agent-client');

    // Build a context-enriched message: prepend session summary so the agent
    // knows which session Thomas is looking at.
    const db = await cds.connect.to('db');
    const session = await _getSession(sessionId);
    let sessionCtx = '';
    if (session) {
      const docRow = await db.run(
        SELECT.one(['analysisJson']).from('tp.wizard.SessionDocument').where({ sessionId }).orderBy({ uploadedAt: 'desc' }),
      );
      const analysis = docRow?.analysisJson ? JSON.parse(docRow.analysisJson) : null;
      sessionCtx =
        `Session-Id: ${sessionId}\nLade approver-assist für die Prüfung dieser bestehenden Session. Keine neue Session erstellen.\n` +
        `[Kontext: Thomas-Chat für Session ${session.ds100} Weiche ${session.switchNumber} (${session.basicForm}), ` +
        `Status: ${session.status}, TPs: ${session.derivedTPCount ?? '?'}` +
        (analysis ? `, Analyse: ${analysis.summary ?? JSON.stringify(analysis).slice(0, 200)}` : '') +
        `] `;
    }

    const body = {
      jsonrpc: '2.0',
      method: 'message/send',
      id: Date.now(),
      params: {
        message: {
          kind: 'message',
          messageId: require('crypto').randomUUID(),
          role: 'user',
          parts: [{ kind: 'text', text: sessionCtx + message }],
          ...(contextId ? { contextId } : {}),
        },
      },
    };

    let reply = '';
    let newContextId = contextId || '';
    try {
      const agentAuthorization = await agentClient.authorization(req.headers.authorization);
      const payload = JSON.stringify(body);
      const agentReply = await new Promise((resolve, reject) => {
        const urlObj = agentClient.agentUrl();
        const http = require(urlObj.protocol === 'https:' ? 'https' : 'http');
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname || '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload),
            ...(agentAuthorization ? { Authorization: agentAuthorization } : {}),
          },
          timeout: 120000,
        };
        const r = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 400) reject(new Error(`Agent HTTP ${res.statusCode}`));
            else resolve(data);
          });
        });
        r.on('error', reject);
        r.on('timeout', () => r.destroy(new Error('Agent timeout')));
        r.write(payload);
        r.end();
      });
      const parsed = JSON.parse(agentReply);
      reply =
        parsed.result?.artifacts?.[0]?.parts?.[0]?.text ??
        parsed.result?.status?.message?.parts?.[0]?.text ??
        'Keine Antwort vom Agenten';
      newContextId = parsed.result?.contextId || contextId || '';
    } catch (err) {
      LOG.warn(`Agent nicht erreichbar: ${err.message}`);
      reply = `Agent nicht erreichbar (${err.message}). Bitte stellen Sie sicher, dass der Python-Agent läuft.`;
    }

    return { sessionId, contextId: newContextId, reply };
  });
};

// ── Regelwerk-Analyse eines Dokuments ─────────────────────────────────────────
function _analyseDocument(katalog, session, extractedText) {
  const { ableitenTps } = require('./lib/weiche');
  const { tps, offeneAngaben, angaben } = ableitenTps(katalog, session);

  // Alle Pflicht-TPs (Regeln ohne optionale Bedingung) vs. tatsächlich abgeleitete
  const { erfuellt } = require('./lib/engine');
  const allePflichtRegeln = katalog.regeln.filter(
    (r) => r.nr !== 1 && (r.giltFuer || '').split(/[;, ]+/).includes(session.basicForm) &&
      erfuellt(angaben, r.bedingungen || []) !== false &&
      (/^\d+$/.test(r.anzahl) ? Number(r.anzahl) > 0 : angaben[r.anzahl] === undefined || Number(angaben[r.anzahl]) > 0),
  );

  const abgeleiteteSchluessel = new Set(tps.map((t) => t.muster));

  const pflichtTps = [];
  const optionalTps = [];
  const fehlendeHinweise = [];

  for (const regel of allePflichtRegeln) {
    const abgeleitet = abgeleiteteSchluessel.has(regel.muster);
    const eintrag = {
      regelNr: regel.nr,
      muster: regel.muster,
      bereich: regel.bereich,
      abgeleitet,
    };
    if (regel.hinweis?.toLowerCase().includes('optional')) {
      optionalTps.push(eintrag);
    } else {
      pflichtTps.push(eintrag);
      if (!abgeleitet) {
        fehlendeHinweise.push({
          regelNr: regel.nr,
          muster: regel.muster,
          bereich: regel.bereich,
          hinweis: regel.hinweis || `Pflicht-TP "${regel.muster}" wurde nicht abgeleitet. Bitte Eingaben prüfen.`,
        });
      }
    }
  }

  // Prüfe ob Werte aus dem Dokument-Text belegt sind
  const nichtBelegte = (session.answers || []).filter(
    (a) => a.herkunft === 'Dokument' && a.beleg &&
      !normalisiert(extractedText).includes(normalisiert(a.beleg.replace(/^Textstelle:\s*/, ''))),
  );

  const summary =
    `${tps.length} TPs abgeleitet, ` +
    `${fehlendeHinweise.length} Pflicht-TPs fehlen, ` +
    `${optionalTps.filter((o) => o.abgeleitet).length} optionale TPs vorhanden, ` +
    `${offeneAngaben.length} offene Angaben, ` +
    `${nichtBelegte.length} Belege nicht im Dokument gefunden`;

  return {
    summary,
    tpsAbgeleitet: tps.length,
    pflichtTps,
    optionalTps,
    fehlendeHinweise,
    offeneAngaben: offeneAngaben.map((questionId) => ({
      questionId,
      hint: katalog.eingaben.find((e) => e.ID === questionId)?.frage || questionId,
    })),
    nichtBelegteWerte: nichtBelegte.map((a) => ({
      questionId: a.questionId,
      answer: a.answer,
      beleg: a.beleg,
    })),
  };
}
