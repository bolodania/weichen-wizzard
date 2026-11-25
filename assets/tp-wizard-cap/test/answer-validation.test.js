'use strict';
const { validateAnswer, correctAnswer, sourceOf } = require('../srv/lib/session-repository');
const { validiere } = require('../srv/lib/weiche');
const katalog = { eingaben: [
  { ID: 'count', typ: 'Menge' }, { ID: 'flag', typ: 'JaNein' },
  { ID: 'choice', typ: 'Auswahl', werte: 'A;B' }, { ID: 'formula', typ: 'JaNein', formel: 'count GT 0' },
] };

test.each(['garbage', '-1', '1.9', '2abc', '', '1000'])('invalid quantity %s is rejected', (value) => {
  expect(() => validateAnswer(katalog, 'count', value)).toThrow();
});
test('unknown, derived and invalid choice answers are rejected', () => {
  for (const id of ['unknown', 'formula']) expect(() => validateAnswer(katalog, id, '1')).toThrow();
  expect(() => validateAnswer(katalog, 'choice', 'C')).toThrow();
  expect(validateAnswer(katalog, 'flag', 'true')).toBe('Ja');
  expect(validateAnswer(katalog, 'choice', 'a')).toBe('A');
});
test('correction clears citation and retains original default proposal', () => {
  const session = { answers: [{ questionId: 'count', answer: '1', source: 'agent-default', herkunft: 'Dokument', beleg: 'old' }] };
  correctAnswer(session, 'count', '2', 'thomas-edited');
  expect(session.answers[0]).toMatchObject({ answer: '2', beleg: null, herkunft: 'Manuell', agentProposal: '1' });
  expect(sourceOf('katrin-confirmed')).toBe('human-confirmed');
  expect(() => sourceOf('invented')).toThrow();
  expect(validiere([]).valid).toBe(false);
});