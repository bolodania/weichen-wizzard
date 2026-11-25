'use strict';

const cds = require('@sap/cds');
const client = require('@sap-cloud-sdk/http-client');
const { getLocationValues } = require('../srv/lib/location-value-help');

describe('Destination-backed location value help', () => {
  let spy;
  beforeEach(() => {
    spy = jest.spyOn(client, 'executeHttpRequest');
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
    cds.env.valueHelp = {
      destination: 'RI4DEV400_PP', servicePath: '/sap/opu/odata/sap/API_BUSINESS_PARTNER',
      entitySet: 'A_BusinessPartner', keyField: 'BusinessPartner', textField: 'BusinessPartnerFullName', odataVersion: '2',
    };
    spy.mockResolvedValue({ data: { d: { results: [{ BusinessPartner: '123', BusinessPartnerFullName: 'Example' }] } } });
    const result = await getLocationValues(request("O'Brien"));
    expect(result).toEqual({ items: [{ code: '123', description: 'Example' }], hasMore: false });
    expect(spy.mock.calls[0][0]).toEqual({ destinationName: 'RI4DEV400_PP', jwt: 'user-token' });
    expect(spy.mock.calls[0][1].params.$filter).toContain("substringof('O''Brien',BusinessPartner)");
    expect(spy.mock.calls[0][1].url).toBe('/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner');
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
      url: '/odata/locations/Stations', params: { $skip: 30, $filter: "contains(Code,'NI') or contains(Name,'NI')" },
    });
  });

  test('invalid paging is rejected before accessing a destination', async () => {
    await expect(getLocationValues(request('', -1))).rejects.toMatchObject({ status: 400 });
    expect(spy).not.toHaveBeenCalled();
  });

  test('connection failure gives actionable error without exposing credentials', async () => {
    spy.mockRejectedValue(new Error('secret destination detail'));
    await expect(getLocationValues(request())).rejects.toMatchObject({ status: 502 });
    await expect(getLocationValues(request())).rejects.not.toThrow('secret destination detail');
  });
});