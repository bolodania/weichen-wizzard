'use strict';

function batchResponse(payloads, reverse = false) {
  const items = payloads.map((payload, index) => ({ payload, id: String(index + 1) }));
  if (reverse) items.reverse();
  const lines = ['--response_batch', 'Content-Type: multipart/mixed; boundary="response_set"', ''];
  for (const { payload, id } of items) {
    lines.push('--response_set', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
      `Content-ID: ${id}`, '', 'HTTP/1.1 201 Created', 'Content-Type: application/json', '', JSON.stringify({ d: payload }));
  }
  lines.push('--response_set--', '--response_batch--', '');
  return { status: 202, headers: { 'content-type': 'multipart/mixed; boundary=response_batch' }, data: lines.join('\r\n') };
}

function batchError(status = 400, nested = false) {
  const lines = ['--response_batch'];
  if (nested) lines.push('Content-Type: multipart/mixed; boundary=response_set', '', '--response_set');
  lines.push('Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
    `HTTP/1.1 ${status} Error`, 'Content-Type: application/json', '', '{"error":{"message":"SECRET"}}');
  if (nested) lines.push('--response_set--');
  lines.push('--response_batch--', '');
  return { status: 202, headers: { 'content-type': 'multipart/mixed; boundary=response_batch' }, data: lines.join('\r\n') };
}

module.exports = { batchResponse, batchError };