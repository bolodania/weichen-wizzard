'use strict';

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const flService = require('./fl-service');
const { ladeKatalog } = require('./lib/katalog');
const { ableitenTps, naechsteFrage, vorgaben, validiere, uebernehmeDokumentwerte, normalisiert } = require('./lib/weiche');

const LOG = cds.log('wizard-service');

const { getSession: _getSession, saveSnapshot, validateAnswer, correctAnswer, sourceOf } = require('./lib/session-repository');
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

// Core approve logic — shared by unbound approveSession and bound Sessions.approve.
async function _doApprove(sessionId, req) {
  // Authentication includes client-credentials tokens; approval requires a human.
  if (!req.user?.is('authenticated-user') || req.user.is('system-user')) {
    return req.reject(403, 'Freigabe erfordert einen angemeldeten Benutzer, keinen technischen Client');
  }
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
  for (const a of session.answers) {
    try { a.answer = validateAnswer(katalog, a.questionId, a.answer); }
    catch (e) { return req.reject(422, e.message); }
  }
  const { tps, offeneAngaben } = ableitenTps(katalog, session);
  if (offeneAngaben.length) {
    return req.reject(422, `Pflichtangaben fehlen: ${offeneAngaben.join(', ')}`);
  }

  const validation = validiere(tps);
  if (!validation.valid) {
    LOG.warn(`[M4.missed]: TP-Validierung fehlgeschlagen: ${validation.warnings.join(', ')}`);
    return req.error(422, `TP-Struktur ungültig: ${validation.warnings.join(', ')}`);
  }

  // Reject configuration/payload errors before claiming or contacting SAP.
  try { flService.prepare(tps); }
  catch (error) { return req.reject(error.status || 422, error.message); }

  let result = { created: [], failed: [] };
  const claimed = await db.run(UPDATE('tp.wizard.WizardSession').set({ status: 'approved' })
    .where({ sessionId, status: { in: ['submitted', 'editing'] } }));
  if (!claimed) return req.reject(409, 'Session wird bereits freigegeben');
  session.approvedAt = new Date().toISOString();
  try {
    result = await flService.bulkCreateFunctionalLocations(tps, req, async (progress) => {
      result = JSON.parse(JSON.stringify(progress));
      await db.run(UPDATE('tp.wizard.WizardSession').set({ creationResult: JSON.stringify(result) })
        .where({ sessionId }));
    });
  } catch (err) {
    LOG.error('SAP-Schreibzugriff unterbrochen', { causes: require('./lib/location-value-help').errorDetails(err) });
    const recorded = new Set([...result.created, ...result.failed.map((tp) => tp.tpKey)]);
    result.failed.push(...tps.filter((tp) => !recorded.has(tp.tpKey)).map((tp) => ({ tpKey: tp.tpKey,
      outcome: 'unknown', error: 'SAP-Anlage unterbrochen; Ergebnis vor Wiederholung in SAP prüfen' })));
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
    const db = await cds.connect.to('db');
    await db.run(INSERT.into('tp.wizard.WizardSession').entries({
      sessionId,
      ds100,
      switchNumber,
      basicForm,
      fertigmeldung: req.data.fertigmeldung || null,
      status: 'open',
      createdAt: new Date().toISOString(),
    }));

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

    const katalog = await ladeKatalog();
    let value, resolved;
    try { value = validateAnswer(katalog, questionId, answer); resolved = sourceOf(resolvedSource); }
    catch (e) { return req.reject(e.status || 400, e.message); }
    correctAnswer(session, questionId, value, resolved);
    const tps = await saveSnapshot(await cds.connect.to('db'), session, katalog);

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
    if (!Array.isArray(werte)) return req.reject(400, 'values muss ein JSON-Array sein');

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

    const tps = await saveSnapshot(await cds.connect.to('db'), session, katalog);

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

  srv.on('getSessionState', async (req) => {
    const session = await _getSession(req.data.sessionId);
    if (!session) return req.reject(404, 'Session nicht gefunden');
    const katalog = await ladeKatalog();
    return JSON.stringify({ status: session.status, question: naechsteFrage(katalog, session),
      ...ableitenTps(katalog, session) });
  });

  srv.on('getSessionContext', async (req) => {
    const session = await _getSession(req.data.sessionId);
    if (!session) return req.reject(404, 'Session nicht gefunden');
    return JSON.stringify({ sessionId: session.sessionId, status: session.status,
      answers: session.answers, documentText: session.fertigmeldung || '' });
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

  async function submit(sessionId, req, withDefaults = false) {
    const session = await _getSession(sessionId);
    if (!session) return req.reject(404, 'Session nicht gefunden');
    if (session.status !== 'open') return req.reject(409, 'Session ist bereits eingereicht');
    const katalog = await ladeKatalog();
    let defaultedCount = 0;
    if (withDefaults) for (const d of vorgaben(katalog, session.basicForm)) {
      if (!session.answers.some((a) => a.questionId === d.questionId)) {
        correctAnswer(session, d.questionId, validateAnswer(katalog, d.questionId, d.defaultAnswer), 'agent-default');
        defaultedCount++;
      }
    }
    session.status = 'submitted';
    session.submittedAt = new Date().toISOString();
    await saveSnapshot(await cds.connect.to('db'), session, katalog);
    return { sessionId, defaultedCount, status: 'submitted', message: 'Einreichung erfolgreich' };
  }
  srv.on('submitSession', (req) => submit(req.data.sessionId, req));
  srv.on('bulkSubmitWithDefaults', (req) => submit(req.data.sessionId, req, true));

  async function edit(sessionId, questionId, answer, req) {
    const session = await _getSession(sessionId);
    if (!session) return req.reject(404, 'Session nicht gefunden');
    if (!['submitted', 'editing'].includes(session.status)) return req.reject(409, 'Bearbeitung erfordert submitted/editing');
    const katalog = await ladeKatalog();
    let value;
    try { value = validateAnswer(katalog, questionId, answer); }
    catch (e) { return req.reject(e.status || 400, e.message); }
    session.status = 'editing';
    correctAnswer(session, questionId, value, 'thomas-edited');
    const tps = await saveSnapshot(await cds.connect.to('db'), session, katalog);
    return { sessionId, tpPreview: JSON.stringify(tps) };
  }
  srv.on('editAnswer', (req) => edit(req.data.sessionId, req.data.questionId, req.data.answer, req));

  // ── Protect Sessions header fields from PATCH ────────────────────────────
  srv.before('UPDATE', 'Sessions', (req) => {
    delete req.data.ds100;
    delete req.data.switchNumber;
    delete req.data.basicForm;
    for (const field of ['status', 'createdAt', 'submittedAt', 'approvedAt', 'derivedTPCount', 'creationResult', 'answersJson']) {
      delete req.data[field];
    }
  });

  srv.before('UPDATE', 'Sessions', async (req) => {
    if (!req.data.answers) return;
    const session = await _getSession(req.data.sessionId || req.params?.[0]?.sessionId);
    if (session && !['submitted', 'editing'].includes(session.status)) return req.reject(409, 'Session ist nicht bearbeitbar');
    const katalog = await ladeKatalog();
    for (const a of req.data.answers) {
      if (a.answer === undefined) continue;
      try { a.answer = validateAnswer(katalog, a.questionId, a.answer); }
      catch (e) { return req.reject(e.status || 400, e.message); }
      a.source = 'thomas-edited'; a.herkunft = 'Manuell'; a.beleg = null;
    }
  });
  srv.after('UPDATE', 'Sessions', async (_result, req) => {
    const sessionId = req.data.sessionId || req.params?.[0]?.sessionId;
    const session = await _getSession(sessionId);
    if (!session) return;
    if (session.status === 'submitted') session.status = 'editing';
    await saveSnapshot(await cds.connect.to('db'), session, await ladeKatalog());
  });
  srv.on('UPDATE', 'SessionAnswers', async (req) => {
    const keys = req.params[req.params.length - 1];
    await edit(keys.session_sessionId || req.params[0].sessionId, keys.questionId, req.data.answer, req);
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
      const { answers } = await _getSession(row.sessionId);
      result.push({
        sessionId: row.sessionId,
        ds100: row.ds100,
        switchNumber: row.switchNumber,
        basicForm: row.basicForm,
        status: row.status,
        submittedAt: row.submittedAt,
        derivedTPCount: row.derivedTPCount || 0,
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
    if (filename.length > 200 || /[\/\\]/.test(filename)) return req.reject(400, 'Ungültiger Dateiname');

    const session = await _getSession(sessionId);
    if (!session) return req.reject(404, `Session ${sessionId} nicht gefunden`);
    const db = await cds.connect.to('db');

    const uploadedAt = new Date().toISOString();
    let extracted;
    try {
      extracted = await require('./lib/documents').extractDocument(contentB64, mimeType);
    } catch (error) {
      return req.reject(error.status || 422, error.message);
    }
    const { content, text: extractedText } = extracted;
    session.fertigmeldung = extractedText;
    await db.run(UPDATE('tp.wizard.WizardSession').set({ fertigmeldung: extractedText }).where({ sessionId }));

    // Run rule-based analysis
    const katalog = await ladeKatalog();
    const analysisJson = JSON.stringify(_analyseDocument(katalog, session, extractedText));

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

    LOG.info(`Dokumenttext extrahiert und Regel-/Zitatprüfung erstellt: ${filename}`);
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
    if (!session) return req.reject(404, 'Session nicht gefunden');
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
      const parsed = await agentClient.sendMessage(body, req.headers.authorization, 'review');
      reply =
        parsed.result?.artifacts?.[0]?.parts?.[0]?.text ??
        parsed.result?.status?.message?.parts?.[0]?.text ??
        'Keine Antwort vom Agenten';
      newContextId = parsed.result?.contextId || contextId || '';
    } catch (err) {
      LOG.warn(`Agent nicht erreichbar: ${err.message}`);
      return req.reject(502, 'Agent-Prüfung fehlgeschlagen. Details im Serverlog.');
    }

    return { sessionId, contextId: newContextId, reply };
  });
};

// ── Regelwerk-Analyse eines Dokuments ─────────────────────────────────────────
function _analyseDocument(katalog, session, extractedText) {
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
    scope: 'Regel- und Zitatprüfung vorhandener Antworten; keine automatische Dokumentinterpretation',
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
