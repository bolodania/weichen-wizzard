'use strict';

const cds = require('@sap/cds');
const client = require('@sap-cloud-sdk/http-client');
const http = require('node:http');
const executeHttpRequest = client.executeHttpRequest;
const { getLocationValues, errorDetails } = require('../srv/lib/location-value-help');

describe('Destination-backed location value help', () => {
  let spy;
  beforeEach(() => {
    spy = jest.spyOn(client, 'executeHttpRequest');
    Object.assign(process.env, {
      VALUE_HELP_DESTINATION: 'TEST_DESTINATION', VALUE_HELP_SERVICE_PATH: '/odata/test-locations',
      VALUE_HELP_ENTITY_SET: 'Stations', VALUE_HELP_KEY_FIELD: 'Code',
      VALUE_HELP_TEXT_FIELD: 'Description', VALUE_HELP_ODATA_VERSION: '2',
    });
  });
  afterEach(() => {
    spy.mockRestore();
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('VALUE_HELP_')) delete process.env[name];
    }
  });
  const request = (search = '', skip = 0) => ({
    data: { search, skip }, headers: { authorization: 'Bearer user-token' },
    reject: (status, message) => { throw Object.assign(new Error(message), { status }); },
  });

  test('uses configured example destination, escapes search and propagates JWT', async () => {
    spy.mockResolvedValue({ data: { d: { results: [{ Code: '123', Description: 'Example' }] } } });
    const result = await getLocationValues(request("O'Brien"));
    expect(result).toEqual({ items: [{ code: '123', description: 'Example' }], hasMore: false });
    expect(spy.mock.calls[0][0]).toEqual({ destinationName: 'TEST_DESTINATION', jwt: 'user-token' });
    expect(spy.mock.calls[0][1].params.$filter).toBe("Code eq 'O''Brien'");
    expect(spy.mock.calls[0][1].url).toBe('/odata/test-locations/Stations');
  });

  test('customer configuration supports another destination, fields and OData V4', async () => {
    Object.assign(process.env, {
      VALUE_HELP_DESTINATION: 'CUSTOMER_LOCATIONS', VALUE_HELP_SERVICE_PATH: '/odata/locations',
      VALUE_HELP_ENTITY_SET: 'Stations', VALUE_HELP_KEY_FIELD: 'Code', VALUE_HELP_TEXT_FIELD: 'Name', VALUE_HELP_ODATA_VERSION: '4',
    });
    spy.mockResolvedValue({ data: { value: Array.from({ length: 31 }, (_, i) => ({ Code: `A${i}`, Name: 'Station' })) } });
    const result = await getLocationValues(request('NI', 30));
    expect(result.items).toHaveLength(30);
    expect(result.hasMore).toBe(true);
    expect(spy.mock.calls[0][0].destinationName).toBe('CUSTOMER_LOCATIONS');
    expect(spy.mock.calls[0][1]).toMatchObject({
      url: '/odata/locations/Stations', params: { $skip: 30, $filter: "Code eq 'NI'" },
    });
  });

  test('invalid paging is rejected before accessing a destination', async () => {
    await expect(getLocationValues(request('', -1))).rejects.toMatchObject({ status: 400 });
    expect(spy).not.toHaveBeenCalled();
  });

  test('unfiltered list does not send a filter and empty results are not an error', async () => {
    spy.mockResolvedValue({ data: { d: { results: [] } } });
    expect(await getLocationValues(request())).toEqual({ items: [], hasMore: false });
    expect(spy.mock.calls[0][1].params).not.toHaveProperty('$filter');
  });

  test('exact code lookup uses the existing key field without filter functions or OR', async () => {
    spy.mockResolvedValue({ data: { d: { results: [] } } });
    await getLocationValues(request('9001'));
    expect(spy.mock.calls[0][1].params.$filter).toBe("Code eq '9001'");
  });

  test.each([
    ['2', '9006'], ['4', '9006'],
    ['2', "009'O"], ['4', 'München & A+B%/#?'],
    ['2', "X' or Code eq 'Y"], ['4', '東京'],
  ])('SDK sends safely encoded OData V%s filter for %s over HTTP', async (version, search) => {
    process.env.VALUE_HELP_ODATA_VERSION = version;
    let receivedUrl;
    const server = http.createServer((req, res) => {
      receivedUrl = req.url;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(version === '2' ? { d: { results: [] } } : { value: [] }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      spy.mockImplementation((_destination, config) => executeHttpRequest(
        { url: `http://127.0.0.1:${server.address().port}`, authentication: 'NoAuthentication' },
        config,
        { fetchCsrfToken: false },
      ));
      expect(await getLocationValues(request(search, 30))).toEqual({ items: [], hasMore: false });
      expect(receivedUrl).not.toMatch(/\s|[^\x00-\x7F]/);
      const url = new URL(receivedUrl, 'http://localhost');
      expect(url.pathname).toBe('/odata/test-locations/Stations');
      expect(url.searchParams.get('$filter')).toBe(`Code eq '${search.replace(/'/g, "''")}'`);
      expect(url.searchParams.get('$select')).toBe('Code,Description');
      expect(url.searchParams.get('$orderby')).toBe('Code');
      expect(url.searchParams.get('$top')).toBe('31');
      expect(url.searchParams.get('$skip')).toBe('30');
      expect(url.searchParams.get('$format')).toBe(version === '2' ? 'json' : null);
      expect([...url.searchParams.keys()]).toHaveLength(version === '2' ? 6 : 5);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  test('exact lookup uses a customer key field, preserves zeros and escapes literals', async () => {
    process.env.VALUE_HELP_KEY_FIELD = 'StationCode';
    spy.mockResolvedValue({ data: { value: [] } });
    await getLocationValues(request("009'O"));
    expect(spy.mock.calls[0][1].params.$filter).toBe("StationCode eq '009''O'");
  });

  test('invalid key field is rejected before calling SAP', async () => {
    process.env.VALUE_HELP_KEY_FIELD = 'Code or 1 eq 1';
    await expect(getLocationValues(request('9001'))).rejects.toMatchObject({ status: 503 });
    expect(spy).not.toHaveBeenCalled();
  });

  test('nested SAP rejection is diagnosed without exposing request data or messages', async () => {
    const error = Object.assign(new Error('Bearer SECRET'), { cause: Object.assign(new Error('password secret'), {
      name: 'AxiosError', response: { status: 400, data: { error: { code: '/IWBEP/CM_MGW_RT/020', message: 'sensitive text' } } },
      config: { headers: { Authorization: 'Bearer SECRET' } },
    }) });
    expect(errorDetails(error)[1]).toEqual({ type: 'AxiosError', status: 400, code: '/IWBEP/CM_MGW_RT/020' });
    expect(JSON.stringify(errorDetails(error))).not.toMatch(/SECRET|password|sensitive/);
    spy.mockRejectedValue(error);
    await expect(getLocationValues(request('9001'))).rejects.toThrow('Backend lehnt den Code-Filter ab (HTTP 400)');
  });

  test.each(['', 'YOUR_BASIC_AUTH_DESTINATION', '<destination-name>'])('rejects missing/placeholder destination %s', async (value) => {
    process.env.VALUE_HELP_DESTINATION = value;
    await expect(getLocationValues(request())).rejects.toMatchObject({ status: 503 });
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    'VALUE_HELP_DESTINATION', 'VALUE_HELP_SERVICE_PATH', 'VALUE_HELP_ENTITY_SET',
    'VALUE_HELP_KEY_FIELD', 'VALUE_HELP_TEXT_FIELD', 'VALUE_HELP_ODATA_VERSION',
  ])('requires %s from environment without CDS defaults', async (variable) => {
    delete process.env[variable];
    const previous = cds.env.valueHelp;
    cds.env.valueHelp = { destination: 'FALLBACK', servicePath: '/fallback', entitySet: 'Fallback',
      keyField: 'FallbackCode', textField: 'FallbackText', odataVersion: '2' };
    try {
      await expect(getLocationValues(request())).rejects.toMatchObject({ status: 503 });
      await expect(getLocationValues(request())).rejects.toThrow(variable);
      expect(spy).not.toHaveBeenCalled();
    } finally { cds.env.valueHelp = previous; }
  });

  test.each([
    ['VALUE_HELP_SERVICE_PATH', '<CUSTOMER_SERVICE_PATH>'],
    ['VALUE_HELP_ENTITY_SET', 'YOUR_ENTITY_SET'],
    ['VALUE_HELP_KEY_FIELD', '<CUSTOMER_CODE_PROPERTY>'],
    ['VALUE_HELP_TEXT_FIELD', '<CUSTOMER_DESCRIPTION_PROPERTY>'],
    ['VALUE_HELP_ODATA_VERSION', '<2_OR_4>'],
  ])('rejects placeholder in %s', async (variable, value) => {
    process.env[variable] = value;
    await expect(getLocationValues(request())).rejects.toThrow(variable);
    expect(spy).not.toHaveBeenCalled();
  });

  test('connection failure gives actionable error without exposing credentials', async () => {
    spy.mockRejectedValue(new Error('secret destination detail'));
    await expect(getLocationValues(request())).rejects.toMatchObject({ status: 502 });
    await expect(getLocationValues(request())).rejects.not.toThrow('secret destination detail');
  });
});