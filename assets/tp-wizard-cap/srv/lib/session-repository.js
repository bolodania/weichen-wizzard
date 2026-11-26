'use strict';

const cds = require('@sap/cds');
const { ableitenTps, normalisiereWert, pruefeWert } = require('./weiche');

const SOURCES = new Set(['auto', 'agent-default', 'human-confirmed', 'human-corrected', 'thomas-edited', 'agent']);
const SOURCE_ALIASES = { 'katrin-confirmed': 'human-confirmed', 'katrin-corrected': 'human-corrected', 'katrin-correction': 'human-corrected' };

function validateAnswer(katalog, questionId, answer) {
  const input = katalog.eingaben.find((e) => e.ID === questionId);
  if (!input || input.formel || questionId === 'grundbauform') {
    throw Object.assign(new Error(`Unbekannte oder abgeleitete Angabe: ${questionId}`), { status: 400 });
  }
  const normalized = normalisiereWert(input, answer);
  const error = pruefeWert(input, normalized);
  if (normalized === null || error || String(normalized).length > 500) {
    throw Object.assign(new Error(error || `Ungültiger oder leerer Wert für ${questionId}`), { status: 400 });
  }
  return normalized;
}

function sourceOf(source) {
  const value = SOURCE_ALIASES[source] || source || 'human-confirmed';
  if (!SOURCES.has(value)) throw Object.assign(new Error('Unbekannte Antwortquelle'), { status: 400 });
  return value;
}

function correctAnswer(session, questionId, answer, source) {
  const previous = session.answers.find((a) => a.questionId === questionId);
  const entry = {
    questionId, answer, source,
    herkunft: source === 'agent-default' ? 'Vorgabe' : source === 'auto' ? 'Stammdaten' : 'Manuell',
    beleg: null,
    agentProposal: previous?.agentProposal ?? (previous?.source === 'agent-default' ? previous.answer : null),
  };
  session.answers = [...session.answers.filter((a) => a.questionId !== questionId), entry];
}

async function getSession(sessionId) {
  const db = await cds.connect.to('db');
  const row = await db.run(SELECT.one.from('tp.wizard.WizardSession').where({ sessionId }));
  if (!row) return null;
  const answers = await db.run(SELECT.from('tp.wizard.SessionAnswer').where({ session_sessionId: sessionId }));
  return { ...row, answers: answers.map(({ questionId, answer, source, herkunft, beleg, agentProposal }) =>
    ({ questionId, answer, source, herkunft, beleg, agentProposal })) };
}

async function saveSnapshot(db, session, katalog) {
  const { tps } = ableitenTps(katalog, session);
  await db.run(UPDATE('tp.wizard.WizardSession').set({
    answersJson: JSON.stringify(session.answers), status: session.status, submittedAt: session.submittedAt || null,
    derivedTPCount: tps.length,
  }).where({ sessionId: session.sessionId }));
  const rows = session.answers.map((a) => {
    const input = katalog.eingaben.find((e) => e.ID === a.questionId);
    return { ...a, session_sessionId: session.sessionId, questionText: input?.frage || a.questionId,
      area: input?.bereich || '', source: sourceOf(a.source),
      herkunft: a.herkunft || (a.source === 'agent-default' ? 'Vorgabe' : 'Manuell') };
  });
  if (rows.length) await db.run(UPSERT.into('tp.wizard.SessionAnswer').entries(rows));
  await db.run(DELETE.from('tp.wizard.DerivedTP').where({ session_sessionId: session.sessionId }));
  if (tps.length) await db.run(INSERT.into('tp.wizard.DerivedTP').entries(
    tps.map((tp) => ({ ...tp, session_sessionId: session.sessionId }))));
  return tps;
}

module.exports = { getSession, saveSnapshot, validateAnswer, correctAnswer, sourceOf };