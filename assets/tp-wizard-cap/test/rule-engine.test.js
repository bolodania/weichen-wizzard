'use strict';

const fs = require('fs');
const path = require('path');
const { ableiten, erfuellt, parseBedingungen } = require('../srv/lib/engine');

// ── Minimaler CSV-Parser (';'-getrennt, "" als Escape, ';' in Feldern erlaubt) ──
function felder(zeile) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (q) {
      if (c === '"' && zeile[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function csv(rel) {
  const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8').replace(/\r\n/g, '\n').trim();
  const [h, ...rows] = text.split('\n');
  const head = felder(h);
  return rows.map((l) => {
    const f = felder(l);
    return Object.fromEntries(head.map((k, i) => [k, f[i] ?? '']));
  });
}
function golden(rel) {
  const text = fs.readFileSync(path.join(__dirname, 'golden', rel), 'utf-8').replace(/\r\n/g, '\n').trim();
  const [h, ...rows] = text.split('\n');
  const head = felder(h);
  return rows.map((l) => {
    const f = felder(l);
    return Object.fromEntries(head.map((k, i) => [k, f[i] ?? '']));
  });
}

// Baut den Katalog aus den Seed-CSVs (identische Struktur wie katalog.js, aber DB-frei).
function ladeKatalog() {
  const eingaben = csv('db/data/tp.wizard.Eingaben.csv')
    .map((r) => ({
      ID: r.ID, pos: Number(r.pos), bereich: r.bereich, frage: r.frage, typ: r.typ,
      werte: r.werte, sichtbarWenn: r.sichtbarWenn, formel: r.formel, vorgabe: r.vorgabe,
      hauptquelle: r.hauptquelle, fuerTpNoetig: String(r.fuerTpNoetig).toLowerCase() === 'true', beleg: r.beleg,
    }))
    .sort((a, b) => a.pos - b.pos);

  const bedByRegel = new Map();
  for (const b of csv('db/data/tp.wizard.Bedingungen.csv')) {
    const nr = Number(b.regel_nr);
    if (!bedByRegel.has(nr)) bedByRegel.set(nr, []);
    bedByRegel.get(nr).push({ pos: Number(b.pos), angabe: b.angabe_ID, operator: b.operator, wert: b.wert });
  }
  for (const arr of bedByRegel.values()) arr.sort((a, b) => a.pos - b.pos);

  const regeln = csv('db/data/tp.wizard.Regeln.csv').map((r) => ({
    nr: Number(r.nr), bereich: r.bereich, muster: r.muster, eltern: r.eltern === '–' ? '' : r.eltern,
    anzahl: r.anzahl, start: Number(r.start) || 1, giltFuer: r.giltFuer, beleg: r.beleg, hinweis: r.hinweis,
    bedingungen: bedByRegel.get(Number(r.nr)) || [],
  }));

  const forla = new Map();
  for (const f of csv('db/data/tp.wizard.ForlaPlaetze.csv')) {
    forla.set(f.muster, { muster: f.muster, positionsnummer: f.positionsnummer, bezeichnung: f.bezeichnung, klassen: f.klassen, planergruppe: f.planergruppe });
  }
  return { eingaben, regeln, forla };
}

function goldenFall(fall) {
  const rows = golden('GoldenEingaben.csv').filter((r) => r.fall === fall);
  const kopf = { grundbauform: 'EWR' };
  const angaben = {};
  for (const r of rows) {
    if (r.angabe === '_betriebsstelle') kopf.betriebsstelle = r.wert;
    else if (r.angabe === '_weichennummer') kopf.weichennummer = r.wert;
    else angaben[r.angabe] = r.wert;
  }
  if (angaben.grundbauform) kopf.grundbauform = angaben.grundbauform;
  return { kopf, angaben };
}

function sollSuffixe(fall) {
  return golden(`ergebnis-${fall}.csv`).map((r) => r.Suffix).filter(Boolean).sort();
}

const katalog = ladeKatalog();

// ── Golden-Kontrakt gegen die geprüften Beispielweichen ──────────────────────
describe('Regelwerk-Engine — Golden-Tests', () => {
  test('Katalog ist vollständig geladen (41/99/63/348)', () => {
    expect(katalog.eingaben).toHaveLength(41);
    expect(katalog.regeln).toHaveLength(99);
    expect(katalog.forla.size).toBe(348);
  });

  test.each([
    ['NRB_W806', 110],
    ['NI_W2006', 25],
  ])('%s: Suffixe exakt wie erwartet, keine offenen Angaben (%i TPs)', (fall, anzahl) => {
    const { kopf, angaben } = goldenFall(fall);
    const erg = ableiten(katalog, kopf, angaben);
    const ist = erg.plaetze.map((p) => p.suffix).filter(Boolean).sort();
    expect(ist).toEqual(sollSuffixe(fall));
    expect(ist).toHaveLength(anzahl);
    expect(erg.offeneAngaben).toEqual([]);
  });

  test('NRB_W806: Eltern stehen vor Kindern (Baumreihenfolge)', () => {
    const { kopf, angaben } = goldenFall('NRB_W806');
    const erg = ableiten(katalog, kopf, angaben);
    const index = new Map(erg.plaetze.map((p, i) => [p.suffix, i]));
    for (const p of erg.plaetze) {
      if (p.elternSuffix && p.elternSuffix !== '') {
        expect(index.get(p.elternSuffix)).toBeLessThan(index.get(p.suffix));
      }
    }
  });

  test('NRB_W806: Laufnummer in Bezeichnung ersetzt (N -> 3)', () => {
    const { kopf, angaben } = goldenFall('NRB_W806');
    const erg = ableiten(katalog, kopf, angaben);
    const ve03 = erg.plaetze.find((p) => p.suffix === 'ZUBA-VE-03');
    expect(ve03).toBeDefined();
    expect(ve03.bezeichnung).toBe('Verschlussebene 3');
    expect(ve03.schluessel).toBe('NRB----WE----806ZUBA-VE-03');
  });

  test('Fehlende Pflichtangaben -> offene Angaben statt erfundener TPs', () => {
    const kopf = { betriebsstelle: 'NI', weichennummer: '1', grundbauform: 'EWR' };
    const erg = ableiten(katalog, kopf, {}); // keine Angaben
    // zgv_ve/hz_bauart sind pflichtig und sichtbar -> offen
    expect(erg.offeneAngaben).toEqual(expect.arrayContaining(['zgv_ve', 'hz_bauart']));
    // keine Verschlussebenen-TPs ohne Mengenangabe
    expect(erg.plaetze.some((p) => /^ZUBA-VE-\d/.test(p.suffix))).toBe(false);
  });

  test('Nicht-EWR Grundbauform: keine Regeln greifen -> keine TPs', () => {
    const kopf = { betriebsstelle: 'NI', weichennummer: '1', grundbauform: 'EWL' };
    const erg = ableiten(katalog, kopf, { zgv_ve: '2', hz_bauart: '0' });
    expect(erg.plaetze).toHaveLength(0);
  });
});

// ── Bedingungsauswertung (Dreiwert-Logik + Operatoren) ───────────────────────
describe('Regelwerk-Engine — erfuellt/Operatoren', () => {
  test('EQ/NE', () => {
    expect(erfuellt({ a: 'Ja' }, parseBedingungen('a EQ Ja'))).toBe(true);
    expect(erfuellt({ a: 'Ja' }, parseBedingungen('a NE Ja'))).toBe(false);
  });

  test('IN (;-Liste) und BT (Bereich)', () => {
    expect(erfuellt({ a: '2' }, parseBedingungen('a IN 1;2;4'))).toBe(true);
    expect(erfuellt({ a: '3' }, parseBedingungen('a IN 1;2;4'))).toBe(false);
    expect(erfuellt({ a: '2' }, parseBedingungen('a BT 1;2'))).toBe(true);
    expect(erfuellt({ a: '0' }, parseBedingungen('a BT 1;2'))).toBe(false);
  });

  test('GE/GT/LE/LT numerisch', () => {
    expect(erfuellt({ a: '3' }, parseBedingungen('a GE 3'))).toBe(true);
    expect(erfuellt({ a: '3' }, parseBedingungen('a GT 3'))).toBe(false);
    expect(erfuellt({ a: '2' }, parseBedingungen('a LT 3'))).toBe(true);
  });

  test('HAS prüft Mitgliedschaft in ;-Mehrfachwert (auch bei fehlendem Wert)', () => {
    expect(erfuellt({ orte: 'A;B;C' }, parseBedingungen('orte HAS B'))).toBe(true);
    expect(erfuellt({ orte: 'A;C' }, parseBedingungen('orte HAS B'))).toBe(false);
    expect(erfuellt({}, parseBedingungen('orte HAS B'))).toBe(false); // fehlend = nicht ausgewählt
  });

  test('@angabe vergleicht gegen anderen Angabewert', () => {
    expect(erfuellt({ ve: '8', wa: '2' }, parseBedingungen('ve GT @wa'))).toBe(true);
    expect(erfuellt({ ve: '2', wa: '2' }, parseBedingungen('ve GT @wa'))).toBe(false);
  });

  test('fehlender Wert -> null (unbestimmt), aber false schlägt fehlend', () => {
    expect(erfuellt({}, parseBedingungen('a EQ Ja'))).toBeNull();
    expect(erfuellt({ a: 'Nein', b: '' }, parseBedingungen('a EQ Ja UND b EQ Ja'))).toBe(false);
    expect(erfuellt({ a: 'Ja' }, parseBedingungen('a EQ Ja UND b EQ Ja'))).toBeNull();
  });

  test('unbekannter Operator wirft', () => {
    expect(() => parseBedingungen('a XX 1')).toThrow(/Unbekannter Operator/);
  });
});
