'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const webapp = path.join(__dirname, '../app/approve/webapp');

function loadExtension() {
  let extension;
  class JSONModel {
    constructor(data) { this.data = data; }
    getProperty(key) { return this.data[key.slice(1)]; }
    setProperty(key, value) { this.data[key.slice(1)] = value; }
  }
  const sandbox = {
    sap: { ui: { define: (_deps, factory) => {
      extension = factory({ extend: (_name, definition) => definition }, JSONModel,
        { show: jest.fn() }, { error: jest.fn() });
    } } },
    setTimeout,
  };
  vm.runInNewContext(fs.readFileSync(path.join(webapp, 'ext/ApproverPanel.controller.js'), 'utf8'), sandbox);
  return extension;
}

describe('Approver panel wiring', () => {
  test('manifest and fragment reference the registered extension handlers', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(webapp, 'manifest.json'), 'utf8'));
    const name = manifest['sap.ui5'].extends.extensions['sap.ui.controllerExtensions']
      ['sap.fe.templates.ObjectPage.ObjectPageController'].controllerName;
    const fragment = fs.readFileSync(path.join(webapp, 'ext/ApproverPanel.fragment.xml'), 'utf8');
    const extension = loadExtension();
    for (const handler of ['onFileSelected', 'onUploadAndAnalyse', 'onChatSend']) {
      expect(fragment).toContain(`.extension.${name}.${handler}`);
      expect(typeof extension[handler]).toBe('function');
    }
  });

  test('upload executes the OData action and clears its busy state', async () => {
    const extension = loadExtension();
    const result = { analysisJson: JSON.stringify({ summary: '25 TPs', offeneAngaben: [] }) };
    const binding = {
      setParameter: jest.fn(), execute: jest.fn().mockResolvedValue(), destroy: jest.fn(),
      getBoundContext: () => ({ getObject: () => result }),
    };
    const view = { setModel: jest.fn(), getModel: () => ({ bindContext: jest.fn(() => binding) }) };
    extension.base = { getView: () => view };
    extension.override.onInit.call(extension);
    await extension._uploadDocument('session', 'test.pdf', 'application/pdf', 'YWJj');
    expect(binding.setParameter).toHaveBeenCalledWith('sessionId', 'session');
    expect(binding.execute).toHaveBeenCalledWith('$direct');
    expect(binding.destroy).toHaveBeenCalled();
    expect(extension._model.getProperty('/analysisResult').summary).toBe('25 TPs');
    expect(extension._model.getProperty('/uploadBusy')).toBe(false);
  });
});