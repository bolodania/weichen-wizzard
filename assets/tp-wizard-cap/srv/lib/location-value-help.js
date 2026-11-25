'use strict';

const cds = require('@sap/cds');
const httpClient = require('@sap-cloud-sdk/http-client');
const PAGE_SIZE = 30;

function configuration() {
  const defaults = cds.env.valueHelp || {};
  const config = {};
  for (const [key, variable] of Object.entries({
    destination: 'VALUE_HELP_DESTINATION', servicePath: 'VALUE_HELP_SERVICE_PATH',
    entitySet: 'VALUE_HELP_ENTITY_SET', keyField: 'VALUE_HELP_KEY_FIELD',
    textField: 'VALUE_HELP_TEXT_FIELD', odataVersion: 'VALUE_HELP_ODATA_VERSION',
  })) config[key] = process.env[variable] || defaults[key];
  if (!config.destination || /^(YOUR_|<|\(\()/i.test(config.destination)) {
    throw new Error('VALUE_HELP_DESTINATION muss den tatsächlichen BTP-Destination-Namen enthalten; Platzhalter sind nicht erlaubt');
  }
  for (const key of ['entitySet', 'keyField', 'textField']) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config[key] || '')) throw new Error(`Ungültige Value-Help-Konfiguration: ${key}`);
  }
  if (!config.destination || !/^\/(?!\/)[A-Za-z0-9_./-]+$/.test(config.servicePath || '') ||
      config.servicePath.includes('..') || !['2', '4'].includes(String(config.odataVersion))) {
    throw new Error('Destination, servicePath oder odataVersion der Value Help ist ungültig');
  }
  return config;
}

async function getLocationValues(req) {
  let config;
  try {
    config = configuration();
  } catch (error) {
    return req.reject(503, error.message);
  }
  const search = String(req.data.search || '').trim();
  const skip = req.data.skip ?? 0;
  if (search.length > 100 || !Number.isInteger(skip) || skip < 0) {
    return req.reject(400, 'Suchtext maximal 100 Zeichen; skip muss eine ganze Zahl ab 0 sein');
  }
  const params = {
    $select: [...new Set([config.keyField, config.textField])].join(','),
    $orderby: config.keyField, $top: PAGE_SIZE + 1, $skip: skip,
  };
  if (String(config.odataVersion) === '2') params.$format = 'json';
  if (search) {
    const literal = `'${search.replace(/'/g, "''")}'`;
    params.$filter = [config.keyField, config.textField].map((field) =>
      String(config.odataVersion) === '2' ? `substringof(${literal},${field})` : `contains(${field},${literal})`
    ).join(' or ');
  }
  const authorization = req.headers?.authorization || '';
  const jwt = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || req.user?.authInfo?.getTokenValue?.();
  try {
    const response = await httpClient.executeHttpRequest(
      { destinationName: config.destination, ...(jwt ? { jwt } : {}) },
      { method: 'GET', url: `${config.servicePath.replace(/\/$/, '')}/${config.entitySet}`,
        params, headers: { Accept: 'application/json' }, timeout: 15000 },
    );
    const rows = response.data?.d?.results ?? response.data?.value;
    if (!Array.isArray(rows)) throw new Error('OData-Antwort enthält keine Ergebnisliste');
    return {
      items: rows.slice(0, PAGE_SIZE).map((row) => ({
        code: String(row[config.keyField] ?? ''), description: String(row[config.textField] ?? ''),
      })).filter((item) => item.code),
      hasMore: rows.length > PAGE_SIZE || Boolean(response.data?.d?.__next || response.data?.['@odata.nextLink']),
    };
  } catch (error) {
    cds.log('location-value-help').warn(`Value Help über Destination ${config.destination} fehlgeschlagen (${error.response?.status || 'Verbindung/Konfiguration'})`);
    return req.reject(502, 'Value Help nicht erreichbar. Konfigurierten Destination-Namen, BTP-Service-Bindings, Cloud Connector und API-Berechtigungen prüfen. Details im CAP-Log; Basic Auth benötigt kein Benutzer-JWT.');
  }
}

module.exports = { getLocationValues };