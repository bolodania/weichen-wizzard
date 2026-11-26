'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'scripts/redeploy-cf.sh');

test('redeploy script is valid bash and dry-run makes no changes', () => {
  execFileSync('bash', ['-n', script]);
  const result = execFileSync('bash', [script, '--dry-run'], { encoding: 'utf8' });
  expect(result).toContain('no commands executed');
  expect(result).toContain('cf push --no-start');
  expect(result).not.toContain('YOUR_');
});

test('redeploy rejects unknown options and documents safe defaults', () => {
  expect(() => execFileSync('bash', [script, '--invalid'], { stdio: 'pipe' })).toThrow();
  const source = fs.readFileSync(script, 'utf8');
  expect(source).toContain('set -euo pipefail');
  expect(source).toContain('--no-start');
  expect(source).toContain('cf restage "tp-wizard-$asset"');
  expect(source).not.toContain('cf start "tp-wizard-$asset"');
  expect(source).not.toContain('source .env');
  expect(source).not.toContain('cf delete');
  const helper = fs.readFileSync(path.join(root, 'scripts/cf-deployment.js'), 'utf8');
  expect(helper).toContain("delete config['random-route']");
  expect(helper).toContain("'redirect-uris': [`${router}/login/callback`]");
});