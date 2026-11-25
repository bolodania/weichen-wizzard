'use strict';

describe('XSUAA agent client', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });

  test('cloud calls require HTTPS and a configured URL', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AGENT_URL;
    const client = require('../srv/lib/agent-client');
    expect(() => client.agentUrl()).toThrow('AGENT_URL');
    process.env.AGENT_URL = 'http://agent.example';
    expect(() => client.agentUrl()).toThrow('HTTPS');
  });

  test('acquires and caches technical token without exposing credentials downstream', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.VCAP_SERVICES = JSON.stringify({ xsuaa: [{ label: 'xsuaa', credentials: {
      url: 'https://auth.example', clientid: 'client', clientsecret: 'secret',
    } }] });
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'access', expires_in: 3600 }),
    });
    const client = require('../srv/lib/agent-client');
    expect(await client.authorization()).toBe('Bearer access');
    expect(await client.authorization()).toBe('Bearer access');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await client.authorization('Bearer user')).toBe('Bearer user');
  });
});