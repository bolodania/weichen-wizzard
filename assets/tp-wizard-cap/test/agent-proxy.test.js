'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

test('default /agent proxy targets IPv4 rather than the macOS AirPlay listener', async () => {
  let proxy;
  const app = {
    get: jest.fn(), post: jest.fn(),
    use: (route, handler) => { if (route === '/agent') proxy = handler; },
  };
  const cds = { env: { requires: { auth: { kind: 'mocked' } } }, on: (_event, callback) => callback(app), server: {} };
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  vm.runInNewContext(source, {
    require: (name) => name === '@sap/cds' ? cds : name === 'fs' ? { existsSync: () => false } :
      name === './srv/lib/agent-client' ? {
        agentUrl: () => new URL('http://127.0.0.1:5000/'), authorization: async () => undefined,
      } : require(name),
    process: { env: {} }, URL, __dirname: path.join(__dirname, '..'), module: {},
  });
  const upstream = { on: jest.fn(), destroy: jest.fn() };
  const spy = jest.spyOn(http, 'request').mockReturnValue(upstream);
  try {
    const req = { method: 'POST', headers: {}, pipe: jest.fn() };
    await proxy(req, {});
    expect(spy.mock.calls[0][0].hostname).toBe('127.0.0.1');
    expect(req.pipe).toHaveBeenCalledWith(upstream);
  } finally {
    spy.mockRestore();
  }
});

test('bootstrap routes accept authenticated users without custom scopes in XSUAA mode', () => {
  const middleware = [];
  const app = { get: jest.fn(), post: jest.fn(), use: (route) => middleware.push(route) };
  const cds = {
    env: { requires: { auth: { kind: 'xsuaa' } } },
    middlewares: { before: [] }, context: { user: { is: () => false } },
    on: (_event, callback) => callback(app), server: {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    require: (name) => name === '@sap/cds' ? cds : name === 'fs' ? { existsSync: () => false } : require(name),
    process: { env: { NODE_ENV: 'production' } }, URL, __dirname: path.join(__dirname, '..'), module: {},
  });
  const guard = middleware[1];
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  guard({}, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  cds.context.user.is = (role) => role === 'authenticated-user';
  guard({}, res, next);
  expect(next).toHaveBeenCalled();
});