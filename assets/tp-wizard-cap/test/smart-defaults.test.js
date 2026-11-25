'use strict';
const { getSmartDefaults } = require('../srv/lib/smart-defaults');

test('EWL returns rückbauStatus as high confidence', () => {
  const defaults = getSmartDefaults('EWL');
  const d = defaults.find(d => d.questionId === 'rückbauStatus');
  expect(d).toBeDefined();
  expect(d.defaultAnswer).toBe('0');
  expect(d.confidence).toBe('high');
});

test('DKW herzstückbauart default is 2 (beweglich)', () => {
  const defaults = getSmartDefaults('DKW');
  const d = defaults.find(d => d.questionId === 'herzstückbauart');
  expect(d?.defaultAnswer).toBe('2');
});

test('heizungTyp is always low confidence for EWL', () => {
  const defaults = getSmartDefaults('EWL');
  const d = defaults.find(d => d.questionId === 'heizungTyp');
  expect(d?.confidence).toBe('low');
});

test('unknown basicForm returns empty array', () => {
  expect(getSmartDefaults('UNKNOWN')).toEqual([]);
});

test('every default has required fields', () => {
  ['EWL', 'EWR', 'DKW', 'EKW', 'IBW', 'DW', 'ABW'].forEach(form => {
    getSmartDefaults(form).forEach(d => {
      expect(d.questionId).toBeTruthy();
      expect(d.defaultAnswer).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(d.confidence);
      expect(d.rationale).toBeTruthy();
    });
  });
});
