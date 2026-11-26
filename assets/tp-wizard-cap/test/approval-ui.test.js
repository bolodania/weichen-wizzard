'use strict';

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');
const root = path.join(__dirname, '..');

describe('Approval page without retired assistant/document features', () => {
  test('manifest does not mount the retired controller or section', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app/approve/webapp/manifest.json'), 'utf8'));
    expect(JSON.stringify(manifest)).not.toMatch(/ApproverPanel|ApproverAssistSection|KI-Assistent & Dokumente/);
    for (const filename of ['ApproverPanel.controller.js', 'ApproverPanel.fragment.xml']) {
      expect(fs.existsSync(path.join(root, 'app/approve/webapp/ext', filename))).toBe(false);
    }
  });

  test('compiled model retains approval/field operations but removes retired APIs and storage', async () => {
    const model = await cds.load(path.join(root, 'srv/wizard-service.cds'));
    const session = model.definitions['WizardService.Sessions'];
    expect(session['@UI.Facets'].map((facet) => facet.ID)).toEqual(['GeneralInfo', 'Answers', 'TPStructure']);
    expect(session.actions.approve).toBeDefined();
    expect(session.elements.documents).toBeUndefined();
    for (const name of ['uploadDocument', 'analyseDocument', 'approverChat', 'SessionDocuments']) {
      expect(model.definitions[`WizardService.${name}`]).toBeUndefined();
    }
    expect(model.definitions['tp.wizard.SessionDocument']).toBeUndefined();
    for (const name of ['applyDocumentValues', 'createSession', 'editAnswer', 'approveSession']) {
      expect(model.definitions[`WizardService.${name}`]).toBeDefined();
    }
  });

  test('agent tool catalog only references existing CAP operations', async () => {
    const model = await cds.load(path.join(root, 'srv/wizard-service.cds'));
    const tools = JSON.parse(fs.readFileSync(path.join(root, '../tp-wizard-agent/cap-tools.json'), 'utf8'))
      .servers['tp-wizard-cap'].tools;
    expect(tools).not.toHaveProperty('analyseDocument');
    for (const name of Object.keys(tools)) expect(model.definitions[`WizardService.${name}`]).toBeDefined();
  });
});