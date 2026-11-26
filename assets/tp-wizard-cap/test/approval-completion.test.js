'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

function harness(states, options = {}) {
  const bindings = [];
  const dialogs = [];
  const buttons = [];
  const busyDialogs = [];
  class Control {
    constructor(settings) { this.settings = settings || {}; }
    addStyleClass() { return this; }
    addItem() { return this; }
    setBusy() {}
    setBusyIndicatorDelay() {}
    setEnabled() {}
    setVisible() {}
    setText() {}
    close() {}
    destroy() {}
  }
  class Dialog extends Control {
    constructor(settings) {
      super(settings);
      if (settings.showHeader === false) {
        busyDialogs.push(this);
        this.open = jest.fn(() => { if (!options.deferOpen) settings.afterOpen(); });
        this.destroy = jest.fn();
        this.close = jest.fn(() => settings.afterClose());
      } else dialogs.push(this);
    }
    open() {}
  }
  class Button extends Control {
    constructor(settings) { super(settings); buttons.push(this); }
  }
  class BusyIndicator extends Control {
    constructor(settings) {
      super(settings); this.setText = jest.fn();
    }
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
    messageBox, toast, { error: jest.fn() }, ResourceModel, BusyIndicator];
  const sandbox = { sap: { ui: { define: (_deps, factory) => { actions = factory(...modules); } } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app/approve/webapp/ext/ApprovalActions.js'), 'utf8'), sandbox);
  return { actions, context, bindings, dialogs, buttons, busyDialogs, messageBox, toast, refresh };
}

test('approval preflight opens readable completion dialog, saving never auto-approves', async () => {
  const q = { id: 'zgv_ve', text: 'Wie viele Verschlussebenen hat die Zungenvorrichtung?', answerType: 'Menge', options: [] };
  const h = harness([{ missingQuestions: [q] }, { missingQuestions: [] }]);
  await h.actions.approve(h.context);
  expect(h.dialogs).toHaveLength(1);
  expect(h.bindings.map((b) => b.path)).toEqual(["/getSessionState(sessionId='session')"]);
  expect(h.messageBox.error).not.toHaveBeenCalled();
  expect(h.busyDialogs[0].open).toHaveBeenCalled();
  expect(h.busyDialogs[0].close).toHaveBeenCalled();
  expect(h.busyDialogs[0].destroy).toHaveBeenCalled();
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
  expect(h.busyDialogs[0].settings.content[0].settings.items[0].setText).toHaveBeenCalledWith('approvalCreating');
  expect(h.busyDialogs[0].close).toHaveBeenCalled();
  expect(h.busyDialogs[0].destroy).toHaveBeenCalled();
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

test('pending approval shows loading feedback, blocks duplicate clicks, and cleans up on failure', async () => {
  const h = harness([{ missingQuestions: [] }, { missingQuestions: [] }]);
  let fail;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((_, reject) => { fail = reject; });
  const original = h.context.getModel().bindContext.getMockImplementation();
  h.context.getModel().bindContext.mockImplementation((path) => {
    const binding = original(path);
    if (path.includes('WizardService.approve')) binding.execute.mockImplementation(() => { entered(); return pending; });
    return binding;
  });
  const approval = h.actions.approve(h.context);
  await started;
  expect(h.busyDialogs[0].open).toHaveBeenCalled();
  expect(h.busyDialogs[0].close).not.toHaveBeenCalled();
  expect(h.actions.enabled(h.context)).toBe(false);
  await h.actions.approve(h.context);
  expect(h.bindings.filter((b) => b.path.includes('WizardService.approve'))).toHaveLength(1);
  fail(new Error('SAP unavailable'));
  await approval;
  expect(h.busyDialogs[0].close).toHaveBeenCalled();
  expect(h.busyDialogs[0].destroy).toHaveBeenCalled();
  expect(h.messageBox.error).toHaveBeenCalledWith('SAP unavailable');
  expect(h.actions.enabled(h.context)).toBe(true);
});

test('no preflight or SAP request starts until the loader has actually opened', async () => {
  const h = harness([{ missingQuestions: [] }], { deferOpen: true });
  const approval = h.actions.approve(h.context);
  await Promise.resolve();
  expect(h.busyDialogs).toHaveLength(1);
  expect(h.bindings).toHaveLength(0);
  expect(h.actions.enabled(h.context)).toBe(false);
  await h.actions.approve(h.context);
  expect(h.busyDialogs).toHaveLength(1);
  const popup = h.busyDialogs[0];
  const escape = { reject: jest.fn() };
  popup.settings.escapeHandler(escape);
  expect(escape.reject).toHaveBeenCalled();
  popup.settings.afterOpen();
  await approval;
  expect(h.bindings.some((binding) => binding.path.includes('WizardService.approve'))).toBe(true);
  expect(popup.close).toHaveBeenCalledTimes(1);
  expect(popup.destroy).toHaveBeenCalledTimes(1);
});

test('loader stays visible while failed approval outcome is checked', async () => {
  const h = harness([{ missingQuestions: [] }]);
  const original = h.context.getModel().bindContext.getMockImplementation();
  let entered;
  let release;
  const recoveryStarted = new Promise((resolve) => { entered = resolve; });
  const recovery = new Promise((resolve) => { release = resolve; });
  let stateCalls = 0;
  h.context.getModel().bindContext.mockImplementation((path) => {
    const binding = original(path);
    if (path.includes('WizardService.approve')) binding.execute.mockRejectedValue(new Error('SAP unavailable'));
    else if (++stateCalls === 2) binding.requestObject = () => { entered(); return recovery; };
    return binding;
  });
  const approval = h.actions.approve(h.context);
  await recoveryStarted;
  expect(h.busyDialogs[0].close).not.toHaveBeenCalled();
  release({ value: JSON.stringify({ missingQuestions: [] }) });
  await approval;
  expect(h.busyDialogs[0].close).toHaveBeenCalledTimes(1);
  expect(h.messageBox.error).toHaveBeenCalledWith('SAP unavailable');
});