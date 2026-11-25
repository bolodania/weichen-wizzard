'use strict';

const cds = require('@sap/cds');

// ===========================================================================
// Lädt den Regelwerk-Katalog (Eingaben/Regeln/Bedingungen/ForlaPlaetze) aus
// der Datenbank in die vom Engine erwartete Form und memoisiert ihn.
// Stammdaten sind read-only; der Cache wird je Prozess einmal aufgebaut.
// ===========================================================================

let cache = null;

async function ladeKatalog() {
  if (cache) return cache;
  const db = await cds.connect.to('db');
  const { Eingaben, Regeln, Bedingungen, ForlaPlaetze } = cds.entities('tp.wizard');

  const [eingabenRows, regelnRows, bedingungenRows, forlaRows] = await Promise.all([
    db.run(SELECT.from(Eingaben)),
    db.run(SELECT.from(Regeln)),
    db.run(SELECT.from(Bedingungen)),
    db.run(SELECT.from(ForlaPlaetze)),
  ]);

  const eingaben = eingabenRows
    .map((r) => ({
      ID: r.ID,
      pos: r.pos,
      bereich: r.bereich,
      frage: r.frage,
      typ: r.typ,
      werte: r.werte,
      sichtbarWenn: r.sichtbarWenn,
      formel: r.formel,
      vorgabe: r.vorgabe,
      hauptquelle: r.hauptquelle,
      fuerTpNoetig: !!r.fuerTpNoetig,
      beleg: r.beleg,
    }))
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));

  const bedByRegel = new Map();
  for (const b of bedingungenRows) {
    const nr = b.regel_nr;
    if (!bedByRegel.has(nr)) bedByRegel.set(nr, []);
    bedByRegel.get(nr).push({ pos: b.pos, angabe: b.angabe_ID, operator: b.operator, wert: b.wert });
  }
  for (const arr of bedByRegel.values()) arr.sort((a, b) => (a.pos || 0) - (b.pos || 0));

  const regeln = regelnRows.map((r) => ({
    nr: r.nr,
    bereich: r.bereich,
    muster: r.muster,
    eltern: r.eltern === '–' ? '' : r.eltern || '',
    anzahl: r.anzahl,
    start: r.start || 1,
    giltFuer: r.giltFuer,
    beleg: r.beleg,
    hinweis: r.hinweis,
    bedingungen: bedByRegel.get(r.nr) || [],
  }));

  const forla = new Map();
  for (const f of forlaRows) {
    forla.set(f.muster, {
      muster: f.muster,
      positionsnummer: f.positionsnummer,
      bezeichnung: f.bezeichnung,
      klassen: f.klassen,
      planergruppe: f.planergruppe,
    });
  }

  cache = { eingaben, regeln, forla };
  return cache;
}

// Nur für Tests: Cache verwerfen, falls Stammdaten neu geladen werden müssen.
function resetKatalog() {
  cache = null;
}

module.exports = { ladeKatalog, resetKatalog };
