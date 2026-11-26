'use strict';

const cds = require('@sap/cds');
const httpClient = require('@sap-cloud-sdk/http-client');
const PAGE_SIZE = 30;

function configuration() {
  const config = {};
  for (const [key, variable] of Object.entries({
    destination: 'VALUE_HELP_DESTINATION', servicePath: 'VALUE_HELP_SERVICE_PATH',
    entitySet: 'VALUE_HELP_ENTITY_SET', keyField: 'VALUE_HELP_KEY_FIELD',
    textField: 'VALUE_HELP_TEXT_FIELD', odataVersion: 'VALUE_HELP_ODATA_VERSION',
  })) {
    const value = process.env[variable]?.trim();
    if (!value || /^(YOUR_|<|\(\()/i.test(value)) {
      throw new Error(`${variable} muss für den Zielservice konfiguriert sein; leere Werte und Platzhalter sind nicht erlaubt`);
    }
    config[key] = value;
  }
  for (const key of ['entitySet', 'keyField', 'textField']) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config[key])) throw new Error(`Ungültige Value-Help-Konfiguration: ${key}`);
  }
  if (!config.destination || !/^\/(?!\/)[A-Za-z0-9_./-]+$/.test(config.servicePath || '') ||
      config.servicePath.includes('..') || !['2', '4'].includes(String(config.odataVersion))) {
    throw new Error('Destination, servicePath oder odataVersion der Value Help ist ungültig');
  }
  return config;
}

function searchFilter(config, search) {
  const literal = `'${search.replace(/'/g, "''")}'`;
  // Exact string equality avoids assuming support for optional filter functions.
  // The configured customer code property must support equality filtering.
  return `${config.keyField} eq ${literal}`;
}

// Cloud SDK may wrap Axios errors several times. Log only allowlisted diagnostic
// fields, never stack/request/headers/body/token or potentially sensitive messages.
function errorDetails(error) {
  const details = [];
  const seen = new Set();
  for (let cause = error; cause && !seen.has(cause) && details.length < 6; cause = cause.cause) {
    seen.add(cause);
    const rawCode = cause.response?.data?.error?.code || cause.code;
    details.push({
      type: /^[A-Za-z]+Error$/.test(cause.name || '') ? cause.name : 'Error',
      ...(Number.isInteger(cause.response?.status) ? { status: cause.response.status } : {}),
      ...(typeof rawCode === 'string' && /^[A-Za-z0-9_/.:-]{1,100}$/.test(rawCode) ? { code: rawCode } : {}),
    });
  }
  return details;
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
    params.$filter = searchFilter(config, search);
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
    const causes = errorDetails(error);
    const status = causes.find((cause) => cause.status)?.status;
    cds.log('location-value-help').warn('Value-Help-Aufruf fehlgeschlagen', {
      destination: config.destination, entitySet: config.entitySet, filtered: Boolean(search),
      keyField: config.keyField, causes,
    });
    if (search && [400, 501].includes(status)) {
      return req.reject(502, `Backend lehnt den Code-Filter ab (HTTP ${status}). VALUE_HELP_KEY_FIELD muss eine per eq filterbare String-Eigenschaft sein; Zuordnung und Backend-Implementierung prüfen. Diagnose im CAP-Log.`);
    }
    return req.reject(502, 'Value Help nicht erreichbar. Konfigurierten Destination-Namen, BTP-Service-Bindings, Cloud Connector und API-Berechtigungen prüfen. Details im CAP-Log; Basic Auth benötigt kein Benutzer-JWT.');
  }
}

module.exports = { getLocationValues, searchFilter, errorDetails };