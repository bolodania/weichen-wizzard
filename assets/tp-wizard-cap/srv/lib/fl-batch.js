'use strict';

const { randomUUID } = require('node:crypto');

function serializeBatch(entitySet, payloads) {
  const changeSet = `changeset_${randomUUID()}`;
  const lines = ['--batch', `Content-Type: multipart/mixed; boundary=${changeSet}`, ''];
  payloads.forEach((payload, index) => {
    lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
      `Content-ID: ${index + 1}`, '', `POST ${entitySet} HTTP/1.1`,
      'Content-Type: application/json', 'Accept: application/json', '', JSON.stringify(payload));
  });
  lines.push(`--${changeSet}--`, '--batch--', '');
  return lines.join('\r\n');
}

function headersAndBody(text) {
  if (text.startsWith('\n')) return { headers: {}, body: text.slice(1) };
  const separator = text.indexOf('\n\n');
  if (separator < 0) throw new Error('Missing header separator');
  const headers = {};
  for (const line of text.slice(0, separator).split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error('Invalid header');
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key in headers) throw new Error('Duplicate header');
    headers[key] = line.slice(colon + 1).trim();
  }
  return { headers, body: text.slice(separator + 2) };
}

function multipart(contentType, text) {
  const match = /^multipart\/mixed\s*;.*?\bboundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType || '');
  const boundary = match?.[1] || match?.[2];
  if (!boundary || boundary.length > 70) throw new Error('Missing multipart boundary');
  const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const delimiter = new RegExp(`^--${escaped}(--)?[ \\t]*$`, 'gm');
  const markers = [...text.matchAll(delimiter)];
  if (markers.length < 2 || markers[0][1] || !markers.at(-1)[1] || markers.slice(0, -1).some((m) => m[1])) {
    throw new Error('Incomplete multipart response');
  }
  return markers.slice(0, -1).map((marker, index) => {
    const start = marker.index + marker[0].length;
    if (text[start] !== '\n') throw new Error('Invalid multipart delimiter');
    return headersAndBody(text.slice(start + 1, markers[index + 1].index));
  });
}

function httpResult(part) {
  if (!/^application\/http(?:\s*;|$)/i.test(part.headers['content-type'] || '')) throw new Error('Missing HTTP response');
  const firstLine = part.body.indexOf('\n');
  const status = /^HTTP\/1\.[01] (\d{3})(?:\s.*)?$/.exec(part.body.slice(0, firstLine));
  if (!status) throw new Error('Invalid HTTP status');
  const response = headersAndBody(part.body.slice(firstLine + 1));
  const mimeId = part.headers['content-id'];
  const httpId = response.headers['content-id'];
  if (mimeId && httpId && mimeId !== httpId) throw new Error('Conflicting Content-ID');
  return { status: Number(status[1]), id: mimeId || httpId, body: response.body.trim() };
}

// A single change set is atomic. Never infer success from outer HTTP 202 or
// incomplete/mixed results; Content-IDs must match every submitted operation.
function parseBatchResponse(response, payloads) {
  if (![200, 202].includes(response.status) || typeof response.data !== 'string') throw new Error('Unexpected batch response');
  const headers = Object.fromEntries(Object.entries(response.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const parts = multipart(headers['content-type'], response.data.replace(/\r\n/g, '\n'));
  if (parts.length !== 1) throw new Error('Unexpected change sets');
  const nested = /^multipart\/mixed(?:\s*;|$)/i.test(parts[0].headers['content-type'] || '');
  const results = (nested ? multipart(parts[0].headers['content-type'], parts[0].body) : parts).map(httpResult);
  // Gateway may return one application/http error in place of the whole set.
  if (results.length === 1 && results[0].status >= 400 && results[0].status <= 599) {
    return { outcome: 'rejected', status: results[0].status };
  }
  if (!nested || results.length !== payloads.length || results.some((item) => ![200, 201, 204].includes(item.status))) {
    throw new Error('Incomplete or inconsistent atomic result');
  }
  const ids = new Set();
  for (const item of results) {
    if (!/^[1-9]\d*$/.test(item.id || '') || ids.has(item.id) || Number(item.id) > payloads.length) throw new Error('Invalid Content-ID');
    ids.add(item.id);
    if (item.body) {
      const data = JSON.parse(item.body);
      const key = data?.d?.FunctionalLocation ?? data?.FunctionalLocation;
      if (data?.error || (key !== undefined && key !== payloads[Number(item.id) - 1].FunctionalLocation)) {
        throw new Error('Unexpected create key');
      }
    }
  }
  return { outcome: 'created' };
}

module.exports = { serializeBatch, parseBatchResponse };