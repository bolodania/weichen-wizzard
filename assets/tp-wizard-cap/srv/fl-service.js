'use strict';

const cds = require('@sap/cds');
const httpClient = require('@sap-cloud-sdk/http-client');
const { configuration, errorDetails } = require('./lib/location-value-help');
const LOG = cds.log('fl-service');

function prepare(tps) {
  const mock = process.env.FL_MOCK ?? 'false';
  if (mock === 'true') return null;
  if (mock !== 'false') {
    throw Object.assign(new Error('FL_MOCK muss true (Simulation) oder false (SAP-Anlage, Standard) sein'), { status: 503 });
  }
  let config;
  try {
    config = configuration();
    const entitySet = process.env.FL_ENTITY_SET?.trim();
    if (!entitySet || /^(YOUR_|<)/i.test(entitySet) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entitySet)) {
      throw new Error('FL_ENTITY_SET muss das schreibbare EntitySet des Kundendienstes enthalten');
    }
    if (config.odataVersion !== '2') throw new Error('SAP-Anlage unterstützt den bestätigten OData-V2-Vertrag');
    if (entitySet === config.entitySet) throw new Error('FL_ENTITY_SET muss vom read-only Value-Help-EntitySet verschieden sein');
    config = { ...config, entitySet };
  } catch (error) {
    throw Object.assign(error, { status: 503 });
  }
  const keys = new Set();
  const payloads = tps.map((tp) => {
    // Only these two properties exist in the customer contract.
    const payload = { FunctionalLocation: tp.tpKey, FunctionalLocationName: tp.tpLabel };
    for (const [name, value] of Object.entries(payload)) {
      if (typeof value !== 'string' || !value.trim() || value.length > 40) {
        throw Object.assign(new Error(`${name} muss 1–40 Zeichen enthalten; keine automatische Kürzung`), { status: 422 });
      }
    }
    if (keys.has(tp.tpKey)) throw Object.assign(new Error('Doppelte TP-Schlüssel im Freigabeauftrag'), { status: 422 });
    keys.add(tp.tpKey);
    return payload;
  });
  if (!payloads.length) throw Object.assign(new Error('Keine TPs zur Anlage vorhanden'), { status: 422 });
  return { config, payloads };
}

async function bulkCreateFunctionalLocations(tps, req = {}, onProgress = async () => {}) {
  const prepared = prepare(tps);
  if (!prepared) return require('./fl-service-mock').bulkCreateFunctionalLocations(tps);
  const { config, payloads } = prepared;
  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1]
    || req.user?.authInfo?.getTokenValue?.();
  const destination = { destinationName: config.destination, ...(jwt ? { jwt } : {}) };
  const serviceRoot = `${config.servicePath.replace(/\/$/, '')}/`;
  const result = { created: [], failed: [], mock: false };
  let csrfHeaders;
  try {
    // Explicit GET supports Gateway services without HEAD. Never POST when the
    // token fetch fails; keep destination authentication and cookies in CAP.
    const response = await httpClient.executeHttpRequest(destination, {
      method: 'GET', url: serviceRoot, timeout: 15000,
      headers: { Accept: 'application/json', 'x-csrf-token': 'Fetch' },
    }, { fetchCsrfToken: false });
    const headers = Object.fromEntries(Object.entries(response.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const token = headers['x-csrf-token'];
    if (typeof token !== 'string' || !token || /^(fetch|required)$/i.test(token)) throw new Error('CSRF token missing');
    const cookies = headers['set-cookie'];
    const cookie = (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).map((value) => value.split(';')[0]).join('; ');
    csrfHeaders = { 'x-csrf-token': token, ...(cookie ? { cookie } : {}) };
  } catch (error) {
    LOG.warn('SAP-CSRF-Vorbereitung fehlgeschlagen', { causes: errorDetails(error) });
    result.failed = tps.map((tp) => ({ tpKey: tp.tpKey, outcome: 'not-attempted', error: 'SAP-CSRF-Vorbereitung fehlgeschlagen; Destination, Berechtigungen und Service prüfen' }));
    await onProgress(result);
    return result;
  }

  for (const payload of payloads) {
    try {
      const response = await httpClient.executeHttpRequest(destination, {
        method: 'POST', url: `${serviceRoot}${config.entitySet}`, data: payload,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...csrfHeaders },
        timeout: 15000, maxRedirects: 0,
      }, { fetchCsrfToken: false });
      if (![200, 201, 204].includes(response.status)) throw new Error('Unexpected create response');
      const returnedKey = response.data?.d?.FunctionalLocation ?? response.data?.FunctionalLocation;
      if (returnedKey !== undefined && returnedKey !== payload.FunctionalLocation) throw new Error('Unexpected create key');
      result.created.push(payload.FunctionalLocation);
    } catch (error) {
      const causes = errorDetails(error);
      const status = causes.find((cause) => cause.status)?.status;
      LOG.warn('SAP-TP-Anlage fehlgeschlagen', { causes });
      // Timeouts/5xx/conflicts can mean SAP already created the object. Never
      // automatically retry a POST, even when its result is unknown.
      const outcome = status && status >= 400 && status < 500 && ![408, 409].includes(status) ? 'rejected' : 'unknown';
      result.failed.push({ tpKey: payload.FunctionalLocation, outcome,
        error: `SAP-Anlage ${outcome === 'unknown' ? 'ungeklärt; vor Wiederholung in SAP prüfen' : 'abgelehnt'}${status ? ` (HTTP ${status})` : ''}` });
    }
    // Outside the HTTP catch: persistence failure must stop further writes.
    await onProgress(result);
  }
  return result;
}

module.exports = { prepare, bulkCreateFunctionalLocations };
