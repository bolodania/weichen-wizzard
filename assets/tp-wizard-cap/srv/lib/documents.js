'use strict';
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function extractDocument(contentB64, mimeType = 'application/pdf') {
  if (typeof contentB64 !== 'string' || contentB64.length > 7_000_000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(contentB64)) {
    throw Object.assign(new Error('Ungültiges oder zu großes Dokument (maximal 5 MB)'), { status: 400 });
  }
  const content = Buffer.from(contentB64, 'base64');
  if (!content.length || content.length > 5 * 1024 * 1024) throw Object.assign(new Error('Dokumentgröße ungültig'), { status: 400 });
  if (mimeType === 'text/plain') {
    const text = content.toString('utf8').trim();
    if (!text) throw Object.assign(new Error('Dokument enthält keinen Text'), { status: 422 });
    return { content, text };
  }
  if (mimeType !== 'application/pdf' || !content.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw Object.assign(new Error('Nur PDF oder UTF-8-Textdateien sind erlaubt'), { status: 400 });
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-document-'));
  try {
    const file = path.join(dir, 'document.pdf');
    await fs.writeFile(file, content);
    const result = await promisify(execFile)('pdftotext', [file, '-'], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    if (!result.stdout.trim()) throw new Error('Kein extrahierbarer Text');
    return { content, text: result.stdout };
  } catch (_) {
    throw Object.assign(new Error('PDF-Textextraktion fehlgeschlagen. Poppler/pdftotext muss bereitstehen; alternativ eine UTF-8-Textdatei hochladen. Kein OCR verfügbar.'), { status: 422 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
module.exports = { extractDocument };