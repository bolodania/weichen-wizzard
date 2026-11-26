'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../app-field/src/sessionApi.js'), 'utf8').replace(/export /g, '');

test('UI submission cannot claim success after API failure', async () => {
  const fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: 'Failed' } }) });
  const ctx = { fetch }; vm.createContext(ctx); vm.runInContext(source, ctx);
  await expect(ctx.submitSession('id')).rejects.toThrow('Failed');
});
test('409 is only success if authoritative state is submitted', async () => {
  const fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 409 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ value: JSON.stringify({ status: 'open' }) }) });
  const ctx = { fetch }; vm.createContext(ctx); vm.runInContext(source, ctx);
  await expect(ctx.submitSession('id')).rejects.toThrow('nicht bestätigt');
});
test('chat hook no longer submits by prose keywords or retries entire turns', () => {
  const hook = fs.readFileSync(path.join(__dirname, '../app-field/src/hooks/useAgentSession.js'), 'utf8');
  expect(hook).not.toContain('SUBMISSION_SIGNALS');
  expect(hook).not.toContain('ensureSubmitted');
  expect(hook).not.toContain('MAX_RETRIES');
  expect(hook).toContain("'all-answered'");
});

test('completion API sends only explicit user answers and propagates validation failures', async () => {
  const fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ value: JSON.stringify({ status: 'editing', missingQuestions: [] }) }) })
    .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'Bitte gültig antworten' } }) });
  const ctx = { fetch }; vm.createContext(ctx); vm.runInContext(source, ctx);
  expect(await ctx.completeMissingAnswers('id', { zgv_ve: '0' })).toMatchObject({ status: 'editing', missingQuestions: [] });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ sessionId: 'id', answers: '{"zgv_ve":"0"}' });
  await expect(ctx.completeMissingAnswers('id', { zgv_ve: '-1' })).rejects.toThrow('Bitte gültig antworten');
});

test('field popup is driven by authoritative missing questions, not LLM text', () => {
  const hook = fs.readFileSync(path.join(__dirname, '../app-field/src/hooks/useAgentSession.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../app-field/src/App.jsx'), 'utf8');
  const dialog = fs.readFileSync(path.join(__dirname, '../app-field/src/components/MissingAnswersDialog.jsx'), 'utf8');
  expect(hook).toContain('state.missingQuestions');
  expect(app).toContain('<MissingAnswersDialog');
  expect(dialog).toContain('accessibleName={q.text}');
  expect(dialog).toContain('<Label required>{q.text}</Label>');
});