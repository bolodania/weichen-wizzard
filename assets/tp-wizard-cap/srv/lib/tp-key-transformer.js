'use strict';

/**
 * Transforms a VORLA TP key into a concrete TP key for a specific switch.
 *
 * VORLA prefix format:  VORLA--WE------1...
 * Target prefix format: {DS100:5chars}--WE----{switchNum:3chars}...
 *
 * Example: transformVorlaKey("VORLA--WE------1ZUBA-VE-01", "NI", "2006")
 *          => "NI-----WE----2061ZUBA-VE-01"   (padded according to FL key rules)
 */
function transformVorlaKey(vorlaKey, ds100, switchNumber) {
  if (!vorlaKey || !ds100 || !switchNumber) {
    throw new Error('transformVorlaKey: all parameters required');
  }

  const VORLA_PREFIX = 'VORLA--WE------1';
  if (!vorlaKey.startsWith(VORLA_PREFIX)) {
    throw new Error(`transformVorlaKey: key does not start with expected VORLA prefix: ${vorlaKey}`);
  }

  // DS100: left-pad/right-pad to 5 chars
  const ds100Part = ds100.toUpperCase().padEnd(5, '-').substring(0, 5);
  // Switch number: zero-left-pad to 4 digits (SAP FL numbering)
  const numPart = switchNumber.toString().padStart(4, '0').substring(0, 4);
  // Construct target prefix: "{ds100}--WE----{num}"
  const targetPrefix = `${ds100Part}--WE----${numPart}`;

  const suffix = vorlaKey.substring(VORLA_PREFIX.length);
  return targetPrefix + suffix;
}

/**
 * Validates that a concrete TP key has the correct length/format.
 * SAP Functional Location keys are typically 30 chars max.
 */
function validateTPKey(key) {
  if (!key || key.length > 40) {
    return { valid: false, error: `TP key too long or empty: ${key}` };
  }
  return { valid: true };
}

module.exports = { transformVorlaKey, validateTPKey };
