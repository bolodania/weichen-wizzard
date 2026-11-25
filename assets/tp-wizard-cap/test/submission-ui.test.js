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