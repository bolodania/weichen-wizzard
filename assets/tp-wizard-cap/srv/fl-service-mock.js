'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('fl-service-mock');

/**
 * Mock Functional Location service.
 * Activated via FL_MOCK=true environment variable.
 * Returns success for all TPs — used for offline / Hackathon demo.
 */

async function bulkCreateFunctionalLocations(tps) {
  LOG.info(`[MOCK] bulkCreateFunctionalLocations: creating ${tps.length} TPs`);
  const created = tps.map(tp => tp.tpKey);
  LOG.info('[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs im System angelegt (MOCK)');
  return {
    created,
    failed: [],
    mock: true
  };
}

module.exports = { bulkCreateFunctionalLocations };
