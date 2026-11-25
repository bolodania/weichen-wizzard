'use strict';

/**
 * Derives Antrieb (drive) TPs based on wizard answers.
 *
 * NRB_W806: 2 Zgv-Antriebe + Übertragungsgestänge + 1 Hz-Antrieb + Übertragungsgestänge
 * NI_W2006: 1 Zgv-Antrieb (no Hz drives, no Übertragungsgestänge)
 */
function deriveAntriebe({ anzahlAntriebeZgv = 0, anzahlAntriebeHz = 0, hydraulisch = false, hzBeweglich = false }) {
  const tps = [];

  // Zgv Antriebe
  for (let i = 1; i <= anzahlAntriebeZgv; i++) {
    tps.push({
      vorlaKey: `VORLA--WE------1ZUBA-WA-${String(i).padStart(2, '0')}`,
      tpLabel: `Weichenantrieb Zgv ${String(i).padStart(2, '0')}`,
      area: 7,
      isAutomatic: false
    });
  }

  // Übertragungsgestänge Zgv: wenn mehr als 1 Antrieb, oder explizit gesetzt
  if (anzahlAntriebeZgv > 1) {
    tps.push({
      vorlaKey: 'VORLA--WE------1ZUBA-WA-01UEG-',
      tpLabel: 'Übertragungsgestänge Zgv',
      area: 7,
      isAutomatic: false,
      zgvUebertragungsgestänge: true
    });
  }

  // Hz Antriebe (only if Hz is beweglich)
  if (hzBeweglich && anzahlAntriebeHz > 0) {
    for (let i = 1; i <= anzahlAntriebeHz; i++) {
      tps.push({
        vorlaKey: `VORLA--WE------1HZ-ABWA-${String(i).padStart(2, '0')}`,
        tpLabel: `Herzstück Antrieb ${String(i).padStart(2, '0')}`,
        area: 7,
        isAutomatic: false
      });
    }
    // Übertragungsgestänge Hz
    if (anzahlAntriebeHz > 0) {
      tps.push({
        vorlaKey: 'VORLA--WE------1HZ-ABWA-01UEG-',
        tpLabel: 'Übertragungsgestänge Hz',
        area: 7,
        isAutomatic: false,
        hzUebertragungsgestänge: true
      });
    }
  }

  // Hydraulic cylinder TPs
  if (hydraulisch) {
    tps.push({
      vorlaKey: 'VORLA--WE------1ZYL---',
      tpLabel: 'Hydraulikzylinder',
      area: 7,
      isAutomatic: false
    });
  }

  return tps;
}

module.exports = { deriveAntriebe };
