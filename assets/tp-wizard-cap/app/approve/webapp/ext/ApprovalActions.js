sap.ui.define([
  'sap/m/Dialog', 'sap/m/Button', 'sap/m/VBox', 'sap/m/Label', 'sap/m/Input',
  'sap/m/Select', 'sap/ui/core/Item', 'sap/m/Text', 'sap/m/MessageStrip',
  'sap/m/MessageBox', 'sap/m/MessageToast', 'sap/base/Log', 'sap/ui/model/resource/ResourceModel',
  'sap/m/BusyDialog'
], function (Dialog, Button, VBox, Label, Input, Select, Item, Text, MessageStrip,
  MessageBox, MessageToast, Log, ResourceModel, BusyDialog) {
  'use strict';
  const resources = new ResourceModel({ bundleName: 'tp.wizard.approve.i18n.i18n' });
  let running = false;

  function contextOf(context, selected) {
    return selected && selected.length ? (selected.length === 1 ? selected[0] : null) : context;
  }
  function eligible(context) {
    return Boolean(context && context.getProperty('IsActiveEntity') === true &&
      !context.getProperty('HasDraftEntity') && ['submitted', 'editing'].includes(context.getProperty('status')));
  }
  async function request(model, path, parameters) {
    const binding = model.bindContext(path);
    try {
      if (parameters) {
        Object.keys(parameters).forEach(function (name) { binding.setParameter(name, parameters[name]); });
        await binding.execute('$direct');
        return binding.getBoundContext().getObject();
      }
      return await binding.requestObject();
    } finally { binding.destroy(); }
  }
  async function state(model, sid) {
    const literal = encodeURIComponent(sid.replace(/'/g, "''")).replace(/'/g, '%27');
    const result = await request(model, "/getSessionState(sessionId='" + literal + "')");
    return JSON.parse(result.value);
  }
  function completion(context, questions, bundle) {
    const model = context.getModel();
    const controls = {};
    const box = new VBox({ width: '100%' }).addStyleClass('sapUiSmallMargin');
    const notice = new MessageStrip({ visible: false, showCloseButton: false, type: 'Error' });
    box.addItem(new Text({ text: bundle.getText('missingInfo') }));
    box.addItem(notice);
    questions.forEach(function (q) {
      const options = q.answerType === 'JaNein' ? ['Ja', 'Nein'] : q.options;
      const input = options.length ? new Select({ width: '100%', selectedKey: '',
        items: [new Item({ key: '', text: bundle.getText('choose') })].concat(options.map(function (o) {
          return new Item({ key: o, text: o });
        })) }) : new Input({ width: '100%', type: ['Menge', 'Zahl'].includes(q.answerType) ? 'Number' : 'Text' });
      controls[q.id] = input;
      box.addItem(new Label({ text: q.text, required: true, labelFor: input }).addStyleClass('sapUiSmallMarginTop'));
      box.addItem(input);
    });
    let dialog;
    const save = new Button({ text: bundle.getText('save'), type: 'Emphasized', press: async function () {
      dialog.setBusyIndicatorDelay(0); dialog.setBusy(true); save.setEnabled(false); cancel.setEnabled(false); notice.setVisible(false);
      try {
        const answers = {};
        Object.keys(controls).forEach(function (id) {
          const control = controls[id];
          const value = control.isA('sap.m.Select') ? control.getSelectedKey() : control.getValue();
          if (value !== '') answers[id] = value;
        });
        const result = await request(model, '/completeMissingAnswers(...)', {
          sessionId: context.getProperty('sessionId'), answers: JSON.stringify(answers)
        });
        const updated = JSON.parse(result.value);
        context.getBinding().refresh();
        dialog.close();
        if (updated.missingQuestions.length) completion(context, updated.missingQuestions, bundle);
        else MessageToast.show(bundle.getText('saved'));
      } catch (error) {
        Log.error('Antworten konnten nicht gespeichert werden', error.message);
        notice.setText(error.message); notice.setVisible(true);
      } finally { dialog.setBusy(false); save.setEnabled(true); cancel.setEnabled(true); }
    } });
    const cancel = new Button({ text: bundle.getText('cancel'), press: function () { dialog.close(); } });
    dialog = new Dialog({ title: bundle.getText('missingTitle'), contentWidth: '36rem',
      content: [box], beginButton: save, endButton: cancel,
      afterClose: function () { dialog.destroy(); } });
    dialog.open();
  }
  return {
    enabled: function (context, selected) { return !running && eligible(contextOf(context, selected)); },
    approve: async function (context, selected) {
      if (running) return;
      running = true;
      let busy;
      try {
        const bundle = await resources.getResourceBundle();
        context = contextOf(context, selected);
        if (!eligible(context)) { MessageBox.information(bundle.getText('selectOne')); return; }
        busy = new BusyDialog({ text: bundle.getText('approvalChecking'), showCancelButton: false });
        busy.open();
        const model = context.getModel();
        const sid = context.getProperty('sessionId');
        const current = await state(model, sid);
        if (current.missingQuestions.length) {
          busy.close(); busy.destroy(); busy = null;
          completion(context, current.missingQuestions, bundle); return;
        }
        // Preflight never writes to SAP. Only this explicit human click approves.
        busy.setText(bundle.getText('approvalCreating'));
        const result = await request(model, context.getPath() + '/WizardService.approve(...)', {});
        busy.close(); busy.destroy(); busy = null;
        context.getBinding().refresh();
        if (JSON.parse(result.failed).length) MessageBox.warning(bundle.getText('failed'));
        else MessageToast.show(bundle.getText('created'));
      } catch (error) {
        if (busy) { busy.close(); busy.destroy(); busy = null; }
        // If state changed after preflight, show the completion form rather than
        // an opaque technical-ID error. All other failures remain visible.
        const current = context && await state(context.getModel(), context.getProperty('sessionId')).catch(function () { return null; });
        if (current && current.missingQuestions.length) completion(context, current.missingQuestions, await resources.getResourceBundle());
        else MessageBox.error(error.message);
      } finally {
        if (busy) { busy.close(); busy.destroy(); }
        running = false;
      }
    }
  };
});