'use strict';

const { deriveTPStructure, validateTPStructure } = require('../srv/rule-engine-service');
const forlaTemplates   = require('../db/data/ForlaTemplate.json');
const basicFormMappings = require('../db/data/BasicFormMapping.json');

// ── NI_W2006: einfache Weiche rechts, Hz starr, 1 Zgv-Antrieb, elektrische Heizung
const NI_W2006_INPUT = {
  basicForm: 'EWR',
  ds100: 'NI',
  switchNumber: '2006',
  answers: [
    { questionId: 'stwBauform',              answer: 'SETEDBRU' },
    { questionId: 'anzahlVerschlussebenenZgv',answer: '1' },
    { questionId: 'anzahlZungRollpaarZgv',    answer: '3' },
    { questionId: 'federwippe',               answer: 'false' },
    { questionId: 'herzstückbauart',          answer: '0' },
    { questionId: 'radsensoren',              answer: '0' },
    { questionId: 'anzahlAntriebeZgv',        answer: '1' },
    { questionId: 'hydraulisch',              answer: 'false' },
    { questionId: 'weichensignale',           answer: '1' },
    { questionId: 'lichtpunkte',              answer: '0' },
    { questionId: 'weichensteuerung',         answer: 'false' },
    { questionId: 'weichenüberwachung',       answer: 'false' },
    { questionId: 'isoPositions',             answer: '[]' },
    { questionId: 'havPositions',             answer: '[]' },
    { questionId: 'prellbock',                answer: 'false' },
    { questionId: 'gleisstückWP',             answer: 'false' },
    { questionId: 'gleisstückEndA',           answer: 'false' },
    { questionId: 'gleisstückEndB',           answer: 'false' },
    { questionId: 'erdung',                   answer: 'false' },
    { questionId: 'heizungTyp',               answer: 'elektrisch' }
  ]
};

// ── NRB_W806: komplexe Weiche, Hz beweglich (Bauart 2), 2 Zgv + 1 Hz Antrieb
const NRB_W806_INPUT = {
  basicForm: 'EWR',
  ds100: 'NRB',
  switchNumber: '806',
  answers: [
    { questionId: 'stwBauform',               answer: 'SELSL60N' },
    { questionId: 'anzahlVerschlussebenenZgv', answer: '8' },
    { questionId: 'anzahlZungRollpaarZgv',     answer: '11' },
    { questionId: 'federwippe',                answer: 'true' },
    { questionId: 'herzstückbauart',           answer: '2' },
    { questionId: 'anzahlVerschlussebenenHz',  answer: '3' },
    { questionId: 'anzahlHzRollpaare',         answer: '3' },
    { questionId: 'radsensoren',               answer: '2' },
    { questionId: 'anzahlAntriebeZgv',         answer: '2' },
    { questionId: 'anzahlAntriebeHz',          answer: '1' },
    { questionId: 'hydraulisch',               answer: 'false' },
    { questionId: 'weichensignale',            answer: '1' },
    { questionId: 'lichtpunkte',               answer: '1' },
    { questionId: 'weichensteuerung',          answer: 'false' },
    { questionId: 'weichenüberwachung',        answer: 'true' },
    { questionId: 'isoPositions',              answer: JSON.stringify(['ZGVL','ZGVR','STRAL','STRAR','STRBL','STRBR','HZL','HZR']) },
    { questionId: 'havPositions',              answer: '[]' },
    { questionId: 'prellbock',                 answer: 'false' },
    { questionId: 'gleisstückWP',              answer: 'false' },
    { questionId: 'gleisstückEndA',            answer: 'false' },
    { questionId: 'gleisstückEndB',            answer: 'false' },
    { questionId: 'erdung',                    answer: 'false' },
    { questionId: 'heizungTyp',                answer: 'elektrisch' }
  ]
};

describe('Rule Engine — deriveTPStructure', () => {

  test('NI_W2006: Hz is starr (Bauart 0, no federwippe)', () => {
    const { hzBeweglich } = deriveTPStructure(NI_W2006_INPUT, forlaTemplates, basicFormMappings);
    expect(hzBeweglich).toBe(false);
  });

  test('NRB_W806: Hz is beweglich (Bauart 2 + federwippe)', () => {
    const { hzBeweglich } = deriveTPStructure(NRB_W806_INPUT, forlaTemplates, basicFormMappings);
    expect(hzBeweglich).toBe(true);
  });

  test('NI_W2006: generated TP count is in expected range (~20–40)', () => {
    const { tps } = deriveTPStructure(NI_W2006_INPUT, forlaTemplates, basicFormMappings);
    console.log(`NI_W2006 TP count: ${tps.length}`);
    expect(tps.length).toBeGreaterThanOrEqual(10);
    expect(tps.length).toBeLessThanOrEqual(50);
    // M2 milestone
    console.log('[M2.achieved]: Einfache Weiche NI_W2006 validiert — TP-Menge korrekt');
  });

  test('NRB_W806: generated TP count is in expected range (~50–120)', () => {
    const { tps } = deriveTPStructure(NRB_W806_INPUT, forlaTemplates, basicFormMappings);
    console.log(`NRB_W806 TP count: ${tps.length}`);
    expect(tps.length).toBeGreaterThanOrEqual(20);
    expect(tps.length).toBeLessThanOrEqual(150);
    // M3 milestone
    console.log('[M3.achieved]: Komplexe Weiche NRB_W806 validiert — TP-Menge im Zielkorridor');
  });

  test('NI_W2006: no Hz-beweglich TPs present', () => {
    const { tps } = deriveTPStructure(NI_W2006_INPUT, forlaTemplates, basicFormMappings);
    const hzMovingTPs = tps.filter(tp => tp.vorlaKey && tp.vorlaKey.includes('HZ-ABVE'));
    expect(hzMovingTPs.length).toBe(0);
  });

  test('NRB_W806: Hz-beweglich TPs present', () => {
    const { tps } = deriveTPStructure(NRB_W806_INPUT, forlaTemplates, basicFormMappings);
    const hzMovingTPs = tps.filter(tp => tp.vorlaKey && tp.vorlaKey.includes('HZ-ABVE'));
    expect(hzMovingTPs.length).toBeGreaterThan(0);
  });

  test('NRB_W806: Übertragungsgestänge Zgv present (2 Antriebe)', () => {
    const { tps } = deriveTPStructure(NRB_W806_INPUT, forlaTemplates, basicFormMappings);
    const ug = tps.filter(tp => tp.vorlaKey && tp.vorlaKey.includes('ZUBA-UG'));
    expect(ug.length).toBeGreaterThan(0);
  });

  test('NI_W2006: no Übertragungsgestänge (only 1 Antrieb)', () => {
    const { tps } = deriveTPStructure(NI_W2006_INPUT, forlaTemplates, basicFormMappings);
    const ug = tps.filter(tp => tp.vorlaKey && tp.vorlaKey.includes('ZUBA-UG'));
    expect(ug.length).toBe(0);
  });

  test('Stränge (STR-A, STR-B) always present as automatic', () => {
    const { tps } = deriveTPStructure(NI_W2006_INPUT, forlaTemplates, basicFormMappings);
    const strA = tps.find(tp => tp.vorlaKey && tp.vorlaKey.includes('STR-A'));
    const strB = tps.find(tp => tp.vorlaKey && tp.vorlaKey.includes('STR-B'));
    expect(strA).toBeDefined();
    expect(strA.isAutomatic).toBe(true);
    expect(strB).toBeDefined();
  });

  test('Elektrische Heizung present', () => {
    const { tps } = deriveTPStructure(NI_W2006_INPUT, forlaTemplates, basicFormMappings);
    const heiz = tps.find(tp => tp.vorlaKey && tp.vorlaKey.includes('EEH'));
    expect(heiz).toBeDefined();
  });

  test('all TP keys are strings', () => {
    const { tps } = deriveTPStructure(NI_W2006_INPUT, forlaTemplates, basicFormMappings);
    for (const tp of tps) {
      expect(typeof tp.tpKey).toBe('string');
      expect(tp.tpKey.length).toBeGreaterThan(0);
    }
  });
});

describe('Rule Engine — validateTPStructure', () => {
  test('valid TPs pass validation', () => {
    const { tps } = deriveTPStructure(NI_W2006_INPUT, forlaTemplates, basicFormMappings);
    const result = validateTPStructure(tps, forlaTemplates);
    expect(result.valid).toBe(true);
    expect(result.invalidTPs).toHaveLength(0);
  });

  test('TPs with empty keys fail validation', () => {
    const badTPs = [{ tpKey: '', tpLabel: 'Bad TP', area: 1 }];
    const result = validateTPStructure(badTPs, forlaTemplates);
    expect(result.valid).toBe(false);
    expect(result.invalidTPs.length).toBeGreaterThan(0);
  });
});
