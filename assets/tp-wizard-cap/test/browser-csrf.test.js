'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('browser mutations fetch and forward the Approuter CSRF token', async () => {
  const native = jest.fn()
    .mockResolvedValueOnce({ headers: new Headers({ 'x-csrf-token': 'csrf' }) })
    .mockResolvedValue({ status: 200, headers: new Headers() });
  const window = { fetch: native, location: { href: 'https://router.example/field/', origin: 'https://router.example' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app-field/src/authenticatedFetch.js'), 'utf8'), {
    window, URL, Headers,
  });
  await window.fetch('/wizard/createSession', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  expect(native.mock.calls[0][0]).toBe('/health');
  expect(native.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('csrf');
  await window.fetch('/agent', { method: 'POST' });
  expect(native).toHaveBeenCalledTimes(3);
});