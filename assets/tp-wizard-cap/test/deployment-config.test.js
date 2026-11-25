'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const root = path.join(__dirname, '..');

describe('XSUAA HTTPS Cloud Foundry PoC configuration', () => {
  const manifest = YAML.parse(fs.readFileSync(path.join(root, 'manifest.yml'), 'utf8'));
  const app = manifest.applications[0];

  test('binds XSUAA and protects public backend routes', () => {
    expect(app.services).toEqual(['tp-wizard-xsuaa', 'tp-wizard-destination', 'tp-wizard-connectivity']);
    expect(app['random-route']).toBe(true);
    expect(app.instances).toBe(1);
    expect(app.env.FL_MOCK).toBe('true');
    expect(app.env.CDS_REQUIRES_AUTH_KIND).toBe('xsuaa');
    expect(app.env).not.toHaveProperty('PORT');
    expect(app.env).not.toHaveProperty('VCAP_SERVICES');
  });

  test('all manifests share XSUAA and use HTTPS without internal policies', () => {
    const agent = YAML.parse(fs.readFileSync(path.join(root, '../tp-wizard-agent/manifest.yml'), 'utf8')).applications[0];
    const router = YAML.parse(fs.readFileSync(path.join(root, '../tp-wizard-router/manifest.yml'), 'utf8')).applications[0];
    expect(agent.services).toContain('tp-wizard-xsuaa');
    expect(router.services).toContain('tp-wizard-xsuaa');
    expect(app.env).not.toHaveProperty('AGENT_URL');
    expect(agent.env).not.toHaveProperty('CAP_BASE_URL');
    expect(agent['random-route']).toBe(true);
    expect(router['random-route']).toBe(true);
    for (const manifest of [app, agent, router]) {
      expect(JSON.stringify(manifest)).not.toContain('((');
    }
    expect(agent.env.AUTH_MODE).toBe('xsuaa');
    const security = JSON.parse(fs.readFileSync(path.join(root, '../../xs-security.json'), 'utf8'));
    expect(security.authorities).not.toContain('$XSAPPNAME.WizardUser');
    expect(security.authorities).toEqual(['$XSAPPNAME.CAPTools', '$XSAPPNAME.AgentInvoke']);
    const routes = JSON.parse(fs.readFileSync(path.join(root, '../tp-wizard-router/xs-app.json'), 'utf8')).routes;
    expect(routes.every((r) => r.authenticationType === 'xsuaa' && r.csrfProtection)).toBe(true);
  });

  test('starts in-memory and configures API independently of destination host', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(app.command).toBe('npm run start:poc');
    expect(pkg.scripts['start:poc']).toBe('cds-serve --in-memory');
    expect(app.env).not.toHaveProperty('VALUE_HELP_DESTINATION');
    expect(app.env.VALUE_HELP_SERVICE_PATH).toBe('/sap/opu/odata/sap/API_BUSINESS_PARTNER');
    expect(app.env.VALUE_HELP_ENTITY_SET).toBe('A_BusinessPartner');
  });

  test('upload exclusions remove secrets and local dependencies, not built field UI', () => {
    const patterns = fs.readFileSync(path.join(root, '.cfignore'), 'utf8')
      .split('\n').filter((line) => line && !line.startsWith('#'));
    expect(patterns).toEqual(expect.arrayContaining([
      '.env', '.env.*', '.cdsrc-private.json', 'default-env.json',
      'node_modules/', 'app-field/node_modules/', 'gen/',
    ]));
    expect(patterns).not.toContain('app-field/dist/');
    expect(patterns).not.toContain('dist/');
    expect(patterns).not.toContain('app/');
    expect(patterns).not.toContain('db/');
  });
});