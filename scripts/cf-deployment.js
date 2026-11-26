'use strict';

// CF metadata helper. Never prints or writes CF environment values/credentials.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const YAML = require(path.join(root, 'assets/tp-wizard-cap/node_modules/yaml'));

function cf(...args) {
  return execFileSync('cf', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function api(endpoint) { return JSON.parse(cf('curl', endpoint)); }

function app(name) {
  const matches = api(`/v3/apps?names=${encodeURIComponent(name)}`).resources;
  // Scope to the targeted space via cf app; a name may exist in several spaces.
  const guid = cf('app', name, '--guid').trim();
  return matches.find((entry) => entry.guid === guid) || api(`/v3/apps/${guid}`);
}

function externalRoutes(application) {
  const routes = api(`/v3/apps/${application.guid}/routes?per_page=500`).resources;
  return routes.filter((route) => {
    const domain = api(`/v3/domains/${route.relationships.domain.data.guid}`);
    return !domain.internal && !route.path && !route.port && !route.url.endsWith('.apps.internal');
  }).map((route) => route.url);
}

function routeUrl(application) {
  const routes = externalRoutes(application);
  if (routes.length !== 1) {
    throw new Error(`${application.name}: expected exactly one external root HTTP route, found ${routes.length}. Map/select a route before redeploying.`);
  }
  return `https://${routes[0]}`;
}

function prepare(directory) {
  for (const asset of ['cap', 'agent', 'router']) {
    const name = `tp-wizard-${asset}`;
    const application = app(name);
    const url = routeUrl(application);
    const env = api(`/v3/apps/${application.guid}/env`);
    const current = env.environment_variables || {};
    const bindings = Object.values(env.system_env_json?.VCAP_SERVICES || {}).flat();
    if (!bindings.some((binding) => binding.name === 'tp-wizard-xsuaa')) {
      throw new Error(`${name}: existing tp-wizard-xsuaa binding required`);
    }
    if (asset === 'cap') {
      const required = ['VALUE_HELP_DESTINATION', 'VALUE_HELP_SERVICE_PATH', 'VALUE_HELP_ENTITY_SET',
        'VALUE_HELP_KEY_FIELD', 'VALUE_HELP_TEXT_FIELD', 'VALUE_HELP_ODATA_VERSION'];
      const missing = required.filter((key) => !current[key]?.trim() || /^(YOUR_|<|\(\()/i.test(current[key].trim()));
      if (missing.length) throw new Error(`Configure actual CAP environment values first: ${missing.join(', ')}`);
    }
    if (asset === 'agent' && !['AICORE_PROXY_URL', 'AICORE_DESTINATION_NAME'].some((key) => current[key]) &&
        !['AICORE_CLIENT_ID', 'AICORE_CLIENT_SECRET', 'AICORE_AUTH_URL', 'AICORE_BASE_URL'].every((key) => current[key])) {
      throw new Error('Configure AI Core credentials on the existing agent first.');
    }
    const manifest = YAML.parse(fs.readFileSync(path.join(root, `assets/${name}/manifest.yml`), 'utf8'));
    const config = manifest.applications[0];
    config.path = path.join(root, `assets/${name}`);
    delete config['random-route'];
    config.routes = [{ route: url.slice('https://'.length) }];
    // Existing API mappings/resource group take precedence over example defaults.
    // Keep mandatory auth/mock-write safety values from the checked-in manifest.
    for (const key of Object.keys(config.env || {})) {
      if (Object.hasOwn(current, key) && !['NODE_ENV', 'FL_MOCK', 'CDS_REQUIRES_AUTH_KIND'].includes(key)) {
        delete config.env[key];
      }
    }
    fs.writeFileSync(path.join(directory, `${asset}.yml`), YAML.stringify(manifest), { mode: 0o600 });
    console.log(`Checked ${name}; existing external route will be preserved.`);
  }
}

function setEnv(name, key, value) { cf('set-env', name, key, value); }

function connect(directory) {
  const cap = routeUrl(app('tp-wizard-cap'));
  const agent = routeUrl(app('tp-wizard-agent'));
  const router = routeUrl(app('tp-wizard-router'));
  setEnv('tp-wizard-cap', 'AGENT_URL', `${agent}/`);
  setEnv('tp-wizard-agent', 'CAP_BASE_URL', cap);
  setEnv('tp-wizard-agent', 'AGENT_PUBLIC_URL', `${agent}/`);
  setEnv('tp-wizard-router', 'destinations', JSON.stringify([
    { name: 'cap-backend', url: cap, forwardAuthToken: true, timeout: 120000 },
  ]));
  const security = JSON.parse(fs.readFileSync(path.join(root, 'xs-security.json'), 'utf8'));
  security['oauth2-configuration'] = {
    ...security['oauth2-configuration'], 'redirect-uris': [`${router}/login/callback`],
  };
  fs.writeFileSync(path.join(directory, 'xs-security.json'), JSON.stringify(security, null, 2), { mode: 0o600 });
  console.log('HTTPS connections configured; credentials were left unchanged.');
}

async function waitService() {
  const service = api('/v3/service_instances?names=tp-wizard-xsuaa&per_page=500').resources;
  const space = app('tp-wizard-cap').relationships.space.data.guid;
  const instance = service.find((entry) => entry.relationships.space.data.guid === space);
  if (!instance) throw new Error('XSUAA instance not found in target space');
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = api(`/v3/service_instances/${instance.guid}`).last_operation;
    if (state?.state === 'succeeded') return;
    if (state?.state === 'failed') throw new Error('XSUAA update failed; check cf service tp-wizard-xsuaa');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('Timed out waiting for XSUAA update; apps remain stopped.');
}

async function main() {
  const [operation, directory] = process.argv.slice(2);
  if (operation === 'prepare') prepare(directory);
  else if (operation === 'connect') connect(directory);
  else if (operation === 'wait-service') await waitService();
  else if (operation === 'summary') console.log(`Open: ${routeUrl(app('tp-wizard-router'))}/field/`);
  else throw new Error('Unknown operation');
}
main().catch((error) => {
  // Do not print arbitrary CF subprocess output: it can contain sensitive data.
  console.error(error.cmd || error.stdout || error.stderr
    ? 'CF command failed. Check apps, external routes, bindings and permissions in the target space.'
    : error.message);
  process.exitCode = 1;
});