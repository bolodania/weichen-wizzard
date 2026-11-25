'use strict';
const { extractDocument } = require('../srv/lib/documents');

test('plain text extraction is explicit and preserves UTF-8', async () => {
  const result = await extractDocument(Buffer.from('Verschlüsse: 2').toString('base64'), 'text/plain');
  expect(result.text).toBe('Verschlüsse: 2');
});
test('fake PDF and oversized document are rejected', async () => {
  await expect(extractDocument(Buffer.from('not a PDF').toString('base64'))).rejects.toMatchObject({ status: 400 });
  await expect(extractDocument('a'.repeat(7_000_001))).rejects.toMatchObject({ status: 400 });
});
test('malformed PDF is not silently treated as successfully extracted raw bytes', async () => {
  await expect(extractDocument(Buffer.from('%PDF-1.4 broken').toString('base64'))).rejects.toMatchObject({ status: 422 });
});