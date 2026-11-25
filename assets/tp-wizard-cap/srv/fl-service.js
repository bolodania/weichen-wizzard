'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('fl-service');

// Use mock service when FL_MOCK=true (Cloud Connector not yet available)
if (process.env.FL_MOCK === 'true') {
  module.exports = require('./fl-service-mock');
} else {
  /**
   * Real Functional Location service — calls S/4HANA via CAP remote service.
   * Requires Cloud Connector destination 'S4H_FL' configured.
   */

  let s4hFl = null;


  async function getServices() {
    if (!s4hFl) {
      s4hFl = await cds.connect.to('S4H_FL');
    }

    return { s4hFl };
  }

  async function bulkCreateFunctionalLocations(tps) {
    const created = [];
    const failed = [];

    try {
      const { s4hFl } = await getServices();
      for (const tp of tps) {
        try {
          await s4hFl.run(INSERT.into('FunctionalLocation').entries({
            FunctionalLocation: tp.tpKey,
            FunctionalLocationName: tp.tpLabel || tp.tpKey,
            TechObjIsEquipInstallation: false
          }));
          created.push(tp.tpKey);
        } catch (itemErr) {
          LOG.warn(`Failed to create TP ${tp.tpKey}: ${itemErr.message}`);
          failed.push({ tpKey: tp.tpKey, error: itemErr.message });
        }
      }

      if (failed.length === 0) {
        LOG.info('[M4.achieved]: SAP-Schreibzugriff A21 erfolgreich — TPs im System angelegt');
      } else {
        LOG.warn(`[M4.missed]: SAP-Schreibzugriff fehlgeschlagen — ${failed.length} von ${tps.length} TPs nicht angelegt`);
      }

      return { created, failed };
    } catch (err) {
      LOG.error(`[M4.missed]: SAP-Schreibzugriff fehlgeschlagen — Cloud Connector oder API-Fehler: ${err.message}`);
      return { created, failed: tps.map(tp => ({ tpKey: tp.tpKey, error: err.message })) };
    }
  }

  module.exports = { bulkCreateFunctionalLocations };
}
