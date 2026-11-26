'use strict';

const http = require('node:http');
const client = require('@sap-cloud-sdk/http-client');
const executeHttpRequest = client.executeHttpRequest;
const { prepare, bulkCreateFunctionalLocations } = require('../srv/fl-service');
const { serializeBatch } = require('../srv/lib/fl-batch');
const { batchResponse, batchError } = require('./helpers/fl-batch-response');

describe('Customer OData batch approval adapter', () => {
  let spy;
  let previous;
  const tps = [
    { tpKey: 'NI-----WE----995', tpLabel: 'Weiche', parentTpKey: '', klassen: 'ignored' },
    { tpKey: 'NI-----WE----995ZUBA-', tpLabel: 'Zungenvorrichtungsbereich A', parentTpKey: 'NI-----WE----995' },
    { tpKey: 'NI-----WE----995ZUBA-ZGV-L', tpLabel: 'Zungenvorrichtung links', parentTpKey: 'NI-----WE----995ZUBA-' },
  ];
  const payloads = tps.map((tp) => ({ FunctionalLocation: tp.tpKey, FunctionalLocationName: tp.tpLabel }));
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

  test('one batch with exact boundary, sorted complete hierarchy, CSRF/cookies/JWT and contracted properties', async () => {
    spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(batchResponse(payloads, true));
    const progress = jest.fn();
    const result = await bulkCreateFunctionalLocations([...tps].reverse(), { headers: { authorization: 'Bearer human-token' } }, progress);
    expect(result).toEqual({ created: tps.map((tp) => tp.tpKey), failed: [], mock: false });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]).toEqual([
      { destinationName: 'TEST_CUSTOMER', jwt: 'human-token' },
      { method: 'GET', url: '/odata/customer/', timeout: 15000,
        headers: { Accept: 'application/json', 'x-csrf-token': 'Fetch' } },
      { fetchCsrfToken: false },
    ]);
    const [destination, config, options] = spy.mock.calls[1];
    expect(destination).toEqual({ destinationName: 'TEST_CUSTOMER', jwt: 'human-token' });
    expect(config).toMatchObject({ method: 'POST', url: '/odata/customer/$batch', responseType: 'text', maxRedirects: 0,
      headers: { 'Content-Type': 'multipart/mixed; boundary=batch', Accept: 'multipart/mixed',
        'x-csrf-token': 'csrf-secret', cookie: 'SESSION=secret; sap-usercontext=sap-client=400' } });
    expect(options).toEqual({ fetchCsrfToken: false });
    const boundary = /boundary=(changeset_[^\r]+)/.exec(config.data)[1];
    const expected = ['--batch', `Content-Type: multipart/mixed; boundary=${boundary}`, ''];
    payloads.forEach((payload, index) => expected.push(`--${boundary}`, 'Content-Type: application/http',
      'Content-Transfer-Encoding: binary', `Content-ID: ${index + 1}`, '', 'POST FunctionalLocation HTTP/1.1',
      'Content-Type: application/json', 'Accept: application/json', '', JSON.stringify(payload)));
    expected.push(`--${boundary}--`, '--batch--', '');
    expect(config.data).toBe(expected.join('\r\n'));
    expect(config.data).not.toMatch(/parentTpKey|klassen|planergruppe/);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(result);
  });

  test('distinct change sets keep the same outer batch boundary', () => {
    const bodies = [serializeBatch('FunctionalLocation', payloads), serializeBatch('FunctionalLocation', payloads)];
    expect(bodies[0]).not.toBe(bodies[1]);
    bodies.forEach((body) => {
      expect(body.startsWith('--batch\r\n')).toBe(true);
      expect(body.endsWith('--batch--\r\n')).toBe(true);
    });
  });

  test.each(['http-id', '204'])('supports %s response form without assuming response order', async (form) => {
    const response = batchResponse(payloads, true);
    if (form === 'http-id') {
      response.data = response.data.replace(/Content-ID: (\d+)\r\n\r\nHTTP\/1.1 201 Created/g,
        '\r\nHTTP/1.1 201 Created\r\nContent-ID: $1');
    } else {
      response.data = response.data.replace(/HTTP\/1.1 201 Created\r\nContent-Type: application\/json\r\n\r\n[^\r]+/g,
        'HTTP/1.1 204 No Content\r\n\r\n');
    }
    spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(response);
    expect((await bulkCreateFunctionalLocations(tps)).created).toEqual(tps.map((tp) => tp.tpKey));
  });

  test('Basic Auth works without JWT; authInfo JWT is also supported', async () => {
    spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(batchResponse(payloads));
    expect((await bulkCreateFunctionalLocations(tps)).failed).toEqual([]);
    expect(spy.mock.calls[0][0]).toEqual({ destinationName: 'TEST_CUSTOMER' });
    spy.mockReset().mockResolvedValueOnce(csrf()).mockResolvedValueOnce(batchResponse(payloads));
    await bulkCreateFunctionalLocations(tps, { user: { authInfo: { getTokenValue: () => 'auth-info-token' } } });
    expect(spy.mock.calls[0][0].jwt).toBe('auth-info-token');
  });

  test('unset FL_MOCK defaults to real batch creation', async () => {
    delete process.env.FL_MOCK;
    spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(batchResponse(payloads));
    expect((await bulkCreateFunctionalLocations(tps)).created).toHaveLength(3);
    expect(spy.mock.calls.map((call) => call[1].method)).toEqual(['GET', 'POST']);
  });

  test.each(['', 'False', 'truee'])('invalid FL_MOCK (%s)', (flag) => {
    process.env.FL_MOCK = flag;
    expect(() => prepare(tps)).toThrow('FL_MOCK');
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ['FL_ENTITY_SET', ''], ['FL_ENTITY_SET', '<CUSTOMER_ENTITY>'], ['FL_ENTITY_SET', 'StationLocation'],
    ['FL_ENTITY_SET', 'Locations?x=y'], ['VALUE_HELP_DESTINATION', ''],
    ['VALUE_HELP_SERVICE_PATH', '//wrong'], ['VALUE_HELP_ODATA_VERSION', '4'],
  ])('invalid %s fails before SAP access', async (name, value) => {
    process.env[name] = value;
    await expect(bulkCreateFunctionalLocations(tps)).rejects.toMatchObject({ status: 503 });
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ['tpKey', 'X'.repeat(41)], ['tpLabel', 'X'.repeat(41)], ['tpKey', ''], ['tpLabel', ' '], ['tpLabel', null],
  ])('validates every %s before access without truncation', async (name, value) => {
    await expect(bulkCreateFunctionalLocations([tps[0], { ...tps[1], [name]: value }])).rejects.toMatchObject({ status: 422 });
    expect(spy).not.toHaveBeenCalled();
  });

  test('rejects empty/duplicate jobs, missing parents and cycles; accepts 40 characters', () => {
    expect(() => prepare([])).toThrow('Keine TPs');
    expect(() => prepare([tps[0], tps[0]])).toThrow('Doppelte');
    expect(() => prepare([tps[1]])).toThrow('Übergeordneter');
    expect(() => prepare([{ ...tps[0], parentTpKey: tps[1].tpKey }, tps[1]])).toThrow('Zyklische');
    expect(() => prepare([{ ...tps[0], parentTpKey: tps[0].tpKey }])).toThrow('Zyklische');
    expect(prepare([{ tpKey: 'K'.repeat(40), tpLabel: 'L'.repeat(40) }]).payloads[0].FunctionalLocationName).toHaveLength(40);
  });

  test.each([{}, { 'x-csrf-token': 'Required' }])('missing CSRF never sends batch (%j)', async (headers) => {
    spy.mockResolvedValue({ status: 200, headers });
    const result = await bulkCreateFunctionalLocations(tps);
    expect(result.created).toEqual([]);
    expect(result.failed).toHaveLength(3);
    expect(result.failed.every((tp) => tp.outcome === 'not-attempted')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('CSRF error is sanitized', async () => {
    spy.mockRejectedValue(new Error('password SECRET'));
    const result = await bulkCreateFunctionalLocations(tps);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|password/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])('atomic inner rejection marks every TP rejected (nested=%s)', async (nested) => {
    spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(batchError(400, nested));
    const result = await bulkCreateFunctionalLocations(tps);
    expect(result.created).toEqual([]);
    expect(result.failed).toHaveLength(3);
    expect(result.failed.every((tp) => tp.outcome === 'rejected')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test.each([[400, 'rejected'], [403, 'rejected'], [409, 'unknown'], [500, 'unknown'], [undefined, 'unknown']])(
    'outer/transport HTTP %s never retries and marks all %s', async (status, outcome) => {
      spy.mockResolvedValueOnce(csrf()).mockRejectedValueOnce({ cause: { response: { status } } });
      const result = await bulkCreateFunctionalLocations(tps);
      expect(result.created).toEqual([]);
      expect(result.failed).toHaveLength(3);
      expect(result.failed.every((tp) => tp.outcome === outcome)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    },
  );

  test.each([
    ['outer 202 only', { status: 202 }],
    ['wrong returned key', batchResponse([{ ...payloads[0], FunctionalLocation: 'WRONG' }, ...payloads.slice(1)])],
    ['missing result', batchResponse(payloads.slice(0, 2))],
    ['missing closing boundary', { ...batchResponse(payloads), data: batchResponse(payloads).data.replace('--response_batch--', '') }],
    ['duplicate ID', { ...batchResponse(payloads), data: batchResponse(payloads).data.replace('Content-ID: 2', 'Content-ID: 1') }],
    ['missing ID', { ...batchResponse(payloads), data: batchResponse(payloads).data.replace('Content-ID: 2\r\n', '') }],
    ['mixed success/error', { ...batchResponse(payloads), data: batchResponse(payloads).data.replace('HTTP/1.1 201 Created', 'HTTP/1.1 400 Bad Request') }],
    ['invalid JSON', { ...batchResponse(payloads), data: batchResponse(payloads).data.replace('{"d":', '{invalid:') }],
  ])('%s is uncertain for entire change set', async (_name, response) => {
    spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(response);
    const result = await bulkCreateFunctionalLocations(tps);
    expect(result.created).toEqual([]);
    expect(result.failed).toHaveLength(3);
    expect(result.failed.every((tp) => tp.outcome === 'unknown')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('persistence failure is not swallowed or retried', async () => {
    spy.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(batchResponse(payloads));
    await expect(bulkCreateFunctionalLocations(tps, {}, () => { throw new Error('DB unavailable'); })).rejects.toThrow('DB unavailable');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('mock never accesses SAP', async () => {
    process.env.FL_MOCK = 'true';
    delete process.env.FL_ENTITY_SET;
    expect(await bulkCreateFunctionalLocations(tps)).toEqual({ created: tps.map((tp) => tp.tpKey), failed: [], mock: true });
    expect(spy).not.toHaveBeenCalled();
  });

  test('real SDK round-trip sends raw multipart with exact matching batch boundary', async () => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('x-csrf-token', 'local-token');
          res.setHeader('set-cookie', ['SESSION=local-cookie; Path=/; HttpOnly']);
          res.end('{}');
        } else {
          const response = batchResponse(payloads);
          res.statusCode = response.status;
          res.setHeader('Content-Type', response.headers['content-type']);
          res.end(response.data);
        }
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      spy.mockImplementation((_destination, config, options) => executeHttpRequest(
        { url: `http://127.0.0.1:${server.address().port}`, authentication: 'NoAuthentication' }, config, options,
      ));
      expect((await bulkCreateFunctionalLocations(tps)).failed).toEqual([]);
      expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
      expect(requests[1].url).toBe('/odata/customer/$batch');
      expect(requests[1].headers['content-type']).toBe('multipart/mixed; boundary=batch');
      expect(requests[1].headers.cookie).toBe('SESSION=local-cookie');
      expect(requests[1].headers['x-csrf-token']).toBe('local-token');
      expect(requests[1].body.startsWith('--batch\r\n')).toBe(true);
      expect(requests[1].body.endsWith('--batch--\r\n')).toBe(true);
      expect(requests[1].body.replace(/\r\n/g, '')).not.toContain('\n');
      payloads.forEach((payload) => expect(requests[1].body).toContain(JSON.stringify(payload)));
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});