'use strict';

const http = require('node:http');
const client = require('@sap-cloud-sdk/http-client');
const executeHttpRequest = client.executeHttpRequest;
const { prepare, bulkCreateFunctionalLocations } = require('../srv/fl-service');

describe('Customer OData approval adapter', () => {
  let spy;
  let previous;
  const tps = [
    { tpKey: 'NI_W2006', tpLabel: 'Weiche', parentTpKey: '', klassen: 'ignored' },
    { tpKey: 'NI_W2006-ZG', tpLabel: 'Zungenvorrichtung', parentTpKey: 'NI_W2006', planergruppe: 'ignored' },
  ];
  const csrf = () => ({ status: 200, headers: {
    'X-CSRF-Token': 'csrf-secret', 'set-cookie': ['SESSION=secret; Path=/; HttpOnly', 'sap-usercontext=sap-client=400; Path=/'],
  } });
  beforeEach(() => {
    previous = { ...process.env };
    Object.assign(process.env, {
      FL_MOCK: 'false', FL_ENTITY_SET: 'FunctionalLocation',
      VALUE_HELP_DESTINATION: 'TEST_CUSTOMER', VALUE_HELP_SERVICE_PATH: '/odata/customer/',
      VALUE_HELP_ENTITY_SET: 'StationLocation', VALUE_HELP_KEY_FIELD: 'StationLocationID',
      VALUE_HELP_TEXT_FIELD: 'StationLocationName', VALUE_HELP_ODATA_VERSION: '2',
    });
    spy = jest.spyOn(client, 'executeHttpRequest');
  });
  afterEach(() => {
    spy.mockRestore();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });

  test('reuses destination/JWT and posts only contracted properties after CSRF fetch', async () => {
    spy.mockResolvedValueOnce(csrf()).mockResolvedValue({ status: 201 });
    const progress = jest.fn();
    const result = await bulkCreateFunctionalLocations(tps, { headers: { authorization: 'Bearer human-token' } }, progress);
    expect(result).toEqual({ created: tps.map((tp) => tp.tpKey), failed: [], mock: false });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0]).toEqual([
      { destinationName: 'TEST_CUSTOMER', jwt: 'human-token' },
      { method: 'GET', url: '/odata/customer/', timeout: 15000,
        headers: { Accept: 'application/json', 'x-csrf-token': 'Fetch' } },
      { fetchCsrfToken: false },
    ]);
    tps.forEach((tp, i) => {
      expect(spy.mock.calls[i + 1][0]).toEqual({ destinationName: 'TEST_CUSTOMER', jwt: 'human-token' });
      expect(spy.mock.calls[i + 1][1]).toMatchObject({ method: 'POST', url: '/odata/customer/FunctionalLocation',
        maxRedirects: 0, data: { FunctionalLocation: tp.tpKey, FunctionalLocationName: tp.tpLabel },
        headers: { 'x-csrf-token': 'csrf-secret', cookie: 'SESSION=secret; sap-usercontext=sap-client=400' } });
    });
    expect(progress).toHaveBeenCalledTimes(2);
  });

  test('Basic Auth destination works without a user JWT; authInfo token is supported', async () => {
    spy.mockResolvedValueOnce(csrf()).mockResolvedValue({ status: 204 });
    await bulkCreateFunctionalLocations(tps);
    expect(spy.mock.calls[0][0]).toEqual({ destinationName: 'TEST_CUSTOMER' });
    spy.mockReset().mockResolvedValueOnce(csrf()).mockResolvedValue({ status: 200, data: {} });
    await bulkCreateFunctionalLocations(tps, { user: { authInfo: { getTokenValue: () => 'auth-info-token' } } });
    expect(spy.mock.calls[0][0].jwt).toBe('auth-info-token');
  });

  test.each([undefined, '', 'False', 'truee'])('real writes require explicit opt-in (%s)', (flag) => {
    if (flag === undefined) delete process.env.FL_MOCK;
    else process.env.FL_MOCK = flag;
    expect(() => prepare(tps)).toThrow('FL_MOCK');
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ['FL_ENTITY_SET', ''], ['FL_ENTITY_SET', '<CUSTOMER_ENTITY>'],
    ['FL_ENTITY_SET', 'StationLocation'], ['FL_ENTITY_SET', 'Locations?x=y'],
    ['VALUE_HELP_DESTINATION', ''], ['VALUE_HELP_SERVICE_PATH', '//wrong'],
    ['VALUE_HELP_ODATA_VERSION', '4'],
  ])('invalid %s fails before any SAP access', async (name, value) => {
    process.env[name] = value;
    await expect(bulkCreateFunctionalLocations(tps)).rejects.toMatchObject({ status: 503 });
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ['tpKey', 'X'.repeat(41)], ['tpLabel', 'X'.repeat(41)],
    ['tpKey', ''], ['tpLabel', ' '], ['tpLabel', null],
  ])('validates every %s before the first request without truncation', async (name, value) => {
    await expect(bulkCreateFunctionalLocations([tps[0], { ...tps[1], [name]: value }])).rejects.toMatchObject({ status: 422 });
    expect(spy).not.toHaveBeenCalled();
  });

  test('rejects empty/duplicate jobs and accepts 40-character boundary', () => {
    expect(() => prepare([])).toThrow('Keine TPs');
    expect(() => prepare([tps[0], tps[0]])).toThrow('Doppelte');
    expect(prepare([{ tpKey: 'K'.repeat(40), tpLabel: 'L'.repeat(40) }]).payloads[0].FunctionalLocationName).toHaveLength(40);
  });

  test.each([{}, { 'x-csrf-token': 'Required' }])('missing CSRF token never results in POST (%j)', async (headers) => {
    spy.mockResolvedValue({ status: 200, headers });
    const result = await bulkCreateFunctionalLocations(tps);
    expect(result.created).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].outcome).toBe('not-attempted');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('CSRF rejection is sanitized and never posts', async () => {
    spy.mockRejectedValue(new Error('password SECRET'));
    const result = await bulkCreateFunctionalLocations(tps);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|password/);
    expect(result.failed.every((tp) => tp.outcome === 'not-attempted')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test.each([[400, 'rejected'], [403, 'rejected'], [409, 'unknown'], [500, 'unknown'], [undefined, 'unknown']])(
    'persists per-item failure for HTTP %s without retries', async (status, outcome) => {
      const error = Object.assign(new Error('SECRET'), { cause: { response: { status, data: { error: { code: 'BACKEND_CODE' } } } } });
      spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce({ status: 201 }).mockRejectedValueOnce(error);
      const progress = [];
      const result = await bulkCreateFunctionalLocations(tps, {}, (snapshot) => progress.push(JSON.parse(JSON.stringify(snapshot))));
      expect(result.created).toEqual([tps[0].tpKey]);
      expect(result.failed[0]).toMatchObject({ tpKey: tps[1].tpKey, outcome });
      expect(JSON.stringify(result)).not.toContain('SECRET');
      expect(progress[0].created).toEqual([tps[0].tpKey]);
      expect(progress[1]).toEqual(result);
      expect(spy).toHaveBeenCalledTimes(3);
    },
  );

  test('continues after an item rejection and does not call it an empty success', async () => {
    spy.mockResolvedValueOnce(csrf()).mockRejectedValueOnce({ response: { status: 400 } }).mockResolvedValueOnce({ status: 204 });
    const result = await bulkCreateFunctionalLocations(tps);
    expect(result.failed).toHaveLength(1);
    expect(result.created).toEqual([tps[1].tpKey]);
  });

  test.each([{ status: 202 }, { status: 201, data: { d: { FunctionalLocation: 'WRONG' } } }])(
    'unexpected create response is uncertain, not success (%j)', async (response) => {
      spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(response);
      const result = await bulkCreateFunctionalLocations([tps[0]]);
      expect(result.created).toEqual([]);
      expect(result.failed[0].outcome).toBe('unknown');
    },
  );

  test('progress persistence failure stops additional writes', async () => {
    spy.mockResolvedValueOnce(csrf()).mockResolvedValue({ status: 201 });
    await expect(bulkCreateFunctionalLocations(tps, {}, () => { throw new Error('DB unavailable'); })).rejects.toThrow('DB unavailable');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('mock mode never accesses SAP, even without real configuration', async () => {
    process.env.FL_MOCK = 'true';
    delete process.env.FL_ENTITY_SET;
    expect(await bulkCreateFunctionalLocations(tps)).toEqual({ created: tps.map((tp) => tp.tpKey), failed: [], mock: true });
    expect(spy).not.toHaveBeenCalled();
  });

  test('real SDK GET/token/cookies/JSON POST round-trip against local backend', async () => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          res.setHeader('x-csrf-token', 'local-token');
          res.setHeader('set-cookie', ['SESSION=local-cookie; Path=/; HttpOnly']);
          res.end('{}');
        } else {
          res.statusCode = 201;
          res.end(JSON.stringify({ d: JSON.parse(body) }));
        }
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      spy.mockImplementation((_destination, config, options) => executeHttpRequest(
        { url: `http://127.0.0.1:${server.address().port}`, authentication: 'NoAuthentication' }, config, options,
      ));
      const result = await bulkCreateFunctionalLocations(tps);
      expect(result.failed).toEqual([]);
      expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'POST']);
      expect(requests[0].headers['x-csrf-token']).toBe('Fetch');
      expect(requests[1].url).toBe('/odata/customer/FunctionalLocation');
      expect(requests[1].headers.cookie).toBe('SESSION=local-cookie');
      expect(requests[1].headers['x-csrf-token']).toBe('local-token');
      expect(JSON.parse(requests[1].body)).toEqual({ FunctionalLocation: tps[0].tpKey, FunctionalLocationName: tps[0].tpLabel });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});