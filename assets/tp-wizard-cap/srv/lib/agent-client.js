'use strict';

// Reuse the same bound XSUAA instance across CAP, agent and Approuter.
// Forward a validated browser token; otherwise acquire a technical token.
let cached;
function binding() {
  const services = JSON.parse(process.env.VCAP_SERVICES || '{}');
  const matches = Object.values(services).flat().filter((s) => s.label === 'xsuaa' || s.tags?.includes('xsuaa'));
  if (matches.length !== 1) throw new Error('Exactly one XSUAA binding is required');
  return matches[0].credentials;
}

async function authorization(incoming) {
  if (incoming) return incoming;
  if (process.env.NODE_ENV !== 'production' && !process.env.VCAP_APPLICATION) return undefined;
  if (cached?.until > Date.now()) return `Bearer ${cached.token}`;
  const credentials = binding();
  const url = new URL('/oauth/token', credentials.url);
  if (url.protocol !== 'https:') throw new Error('XSUAA token endpoint must use HTTPS');
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.clientid}:${credentials.clientsecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`XSUAA token request failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error('XSUAA did not return an access token');
  cached = { token: data.access_token, until: Date.now() + Math.max(0, (Number(data.expires_in) - 60) * 1000) };
  return `Bearer ${cached.token}`;
}

function agentUrl() {
  const cloud = process.env.NODE_ENV === 'production' || process.env.VCAP_APPLICATION;
  const value = process.env.AGENT_URL || (!cloud && 'http://127.0.0.1:5000/');
  if (!value) throw new Error('AGENT_URL must be configured');
  const url = new URL(value);
  if (cloud && url.protocol !== 'https:') throw new Error('Cloud AGENT_URL must use HTTPS');
  return url;
}

module.exports = { authorization, agentUrl };
