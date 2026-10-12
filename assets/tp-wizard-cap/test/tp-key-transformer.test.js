'use strict';

const { transformVorlaKey, validateTPKey } = require('../srv/lib/tp-key-transformer');

describe('tp-key-transformer', () => {
  test('transforms NI_W2006 VORLA key correctly', () => {
    const result = transformVorlaKey('VORLA--WE------1ZUBA-VE-01', 'NI', '2006');
    expect(result).toContain('NI---');
    expect(result).toContain('WE');
    expect(result).toContain('ZUBA-VE-01');
  });

  test('transforms NRB_W806 VORLA key correctly', () => {
    const result = transformVorlaKey('VORLA--WE------1ZUBA-WA-01', 'NRB', '806');
    expect(result).toContain('NRB--');
    expect(result).toContain('WE');
    expect(result).toContain('ZUBA-WA-01');
  });

  test('pads DS100 to 5 chars', () => {
    const result = transformVorlaKey('VORLA--WE------1STR-A', 'NI', '2006');
    expect(result.substring(0, 5)).toBe('NI---');
  });

  test('zero-pads switch number to 4 digits', () => {
    const result = transformVorlaKey('VORLA--WE------1STR-A', 'NI', '42');
    expect(result).toContain('0042');
  });

  test('throws on invalid VORLA prefix', () => {
    expect(() => transformVorlaKey('INVALID_KEY', 'NI', '2006')).toThrow();
  });

  test('throws on missing parameters', () => {
    expect(() => transformVorlaKey(null, 'NI', '2006')).toThrow();
    expect(() => transformVorlaKey('VORLA--WE------1STR-A', null, '2006')).toThrow();
  });

  test('validateTPKey returns valid for normal key', () => {
    expect(validateTPKey('NI---WE----2006STR-A').valid).toBe(true);
  });

  test('validateTPKey rejects empty key', () => {
    expect(validateTPKey('').valid).toBe(false);
    expect(validateTPKey(null).valid).toBe(false);
  });
});
