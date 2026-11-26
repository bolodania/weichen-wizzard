'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

function harness(states) {
  const bindings = [];
  const dialogs = [];
  const buttons = [];
  class Control {
    constructor(settings) { this.settings = settings || {}; }
    addStyleClass() { return this; }
    addItem() { return this; }
    setBusy() {}
    setEnabled() {}
    setVisible() {}
    setText() {}
    close() {}
    destroy() {}
  }
  class Dialog extends Control {
    constructor(settings) { super(settings); dialogs.push(this); }
    open() {}
  }
  class Button extends Control {
    constructor(settings) { super(settings); buttons.push(this); }
  }
  class Input extends Control {
    isA() { return false; }
    getValue() { return '0'; }
  }
  class Select extends Control {
    isA() { return true; }
    getSelectedKey() { return 'Nein'; }
  }
  class ResourceModel {
    getResourceBundle() { return { getText: (key) => key }; }
  }
  const messageBox = { information: jest.fn(), warning: jest.fn(), error: jest.fn() };
  const toast = { show: jest.fn() };
  const model = { bindContext: jest.fn((bindingPath) => {
    const binding = { path: bindingPath, setParameter: jest.fn(), execute: jest.fn().mockResolvedValue(),
      getBoundContext: () => ({ getObject: () => bindingPath.includes('completeMissingAnswers')
        ? { value: JSON.stringify(states.shift()) } : { failed: '[]', created: '[]' } }),
      requestObject: async () => ({ value: JSON.stringify(states.shift()) }), destroy: jest.fn() };
    bindings.push(binding); return binding;
  }) };
  const refresh = jest.fn();
  const context = { getProperty: (name) => ({ sessionId: 'session', status: 'submitted', IsActiveEntity: true, HasDraftEntity: false })[name],
    getModel: () => model, getBinding: () => ({ refresh }), getPath: () => "/Sessions(sessionId='session',IsActiveEntity=true)" };
  let actions;
  const modules = [Dialog, Button, Control, Control, Input, Select, Control, Control, Control,
    messageBox, toast, { error: jest.fn() }, ResourceModel];
  const sandbox = { sap: { ui: { define: (_deps, factory) => { actions = factory(...modules); } } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app/approve/webapp/ext/ApprovalActions.js'), 'utf8'), sandbox);
  return { actions, context, bindings, dialogs, buttons, messageBox, toast, refresh };
}

test('approval preflight opens readable completion dialog, saving never auto-approves', async () => {
  const q = { id: 'zgv_ve', text: 'Wie viele Verschlussebenen hat die Zungenvorrichtung?', answerType: 'Menge', options: [] };
  const h = harness([{ missingQuestions: [q] }, { missingQuestions: [] }]);
  await h.actions.approve(h.context);
  expect(h.dialogs).toHaveLength(1);
  expect(h.bindings.map((b) => b.path)).toEqual(["/getSessionState(sessionId='session')"]);
  expect(h.messageBox.error).not.toHaveBeenCalled();
  await h.buttons.find((b) => b.settings.text === 'save').settings.press();
  const completion = h.bindings.find((b) => b.path === '/completeMissingAnswers(...)');
  expect(completion.setParameter).toHaveBeenCalledWith('answers', '{"zgv_ve":"0"}');
  expect(h.bindings.some((b) => b.path.includes('WizardService.approve'))).toBe(false);
  expect(h.refresh).toHaveBeenCalled();
  expect(h.toast.show).toHaveBeenCalledWith('saved');
});

test('complete session only approves on explicit click; draft and multi-selection are blocked', async () => {
  const h = harness([{ missingQuestions: [] }]);
  await h.actions.approve(h.context);
  expect(h.bindings.some((b) => b.path.includes('WizardService.approve'))).toBe(true);
  expect(h.dialogs).toHaveLength(0);
  expect(h.actions.enabled(h.context, [h.context, h.context])).toBe(false);
  expect(h.actions.enabled({ getProperty: () => false })).toBe(false);
});

test('both approval entry points route through completion preflight instead of generic error dialogs', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app/approve/webapp/manifest.json'), 'utf8'));
  const targets = manifest['sap.ui5'].routing.targets;
  expect(targets.SessionsObjectPage.options.settings.content.header.actions.CompleteAndApprove.press)
    .toBe('tp.wizard.approve.ext.ApprovalActions.approve');
  expect(targets.SessionsList.options.settings.controlConfiguration['@com.sap.vocabularies.UI.v1.LineItem']
    .actions.CompleteAndApprove.requiresSelection).toBe(true);
  const model = await require('@sap/cds').load(path.join(root, 'srv/wizard-service.cds'));
  expect(model.definitions['WizardService.Sessions']['@UI.Identification']).toEqual([]);
});