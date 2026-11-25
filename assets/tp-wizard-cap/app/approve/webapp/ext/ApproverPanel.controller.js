sap.ui.define([
  'sap/ui/core/mvc/ControllerExtension',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageToast',
  'sap/m/MessageBox',
], function (ControllerExtension, JSONModel, MessageToast, MessageBox) {
  'use strict';

  return ControllerExtension.extend('tp.wizard.approve.ext.ApproverPanel', {

    // ── Lifecycle ──────────────────────────────────────────────────────────
    override: {
      onInit: function () {
        this._model = new JSONModel({
          fileSelected: false,
          selectedFile: null,
          uploadBusy: false,
          analysisResult: null,
          chatMessages: [],
          chatDraft: '',
          chatBusy: false,
          chatContextId: null,
        });
        this.base.getView().setModel(this._model, 'approverPanel');
      },
    },

    // ── Helper: get current sessionId from routing ─────────────────────────
    _getSessionId: function () {
      // 1. Prefer OData binding context (most reliable)
      const ctx = this.base.getView().getBindingContext();
      if (ctx) {
        const sid = ctx.getProperty('sessionId');
        if (sid) return sid;
      }
      // 2. Fallback: parse from URL hash
      // Handles both formats:
      //   Sessions(sessionId='xxx',IsActiveEntity=true)
      //   Sessions('xxx')
      const hash = window.location.hash || '';
      const m1 = hash.match(/sessionId='([^']+)'/);
      if (m1) return m1[1];
      const m2 = hash.match(/Sessions\('([^']+)'\)/);
      if (m2) return m2[1];
      return null;
    },

    // ── PDF Upload & Analyse ───────────────────────────────────────────────
    onFileSelected: function (oEvent) {
      const file = oEvent.getParameter('files')[0];
      this._model.setProperty('/fileSelected', !!file);
      this._model.setProperty('/selectedFile', file || null);
    },

    onUploadAndAnalyse: function () {
      const file = this._model.getProperty('/selectedFile');
      const sessionId = this._getSessionId();
      if (!file || !sessionId) {
        MessageToast.show('Bitte zuerst eine Datei auswählen.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        // Strip the data-URL prefix (data:application/pdf;base64,...)
        const b64 = e.target.result.split(',')[1];
        this._uploadDocument(sessionId, file.name, file.type || 'application/pdf', b64);
      };
      reader.readAsDataURL(file);
    },

    _uploadDocument: function (sessionId, filename, mimeType, contentB64) {
      this._model.setProperty('/uploadBusy', true);
      return this._callActionFetch('/wizard/uploadDocument', { sessionId, filename, mimeType, contentB64 })
            .then((result) => {
              const analysis = JSON.parse(result.analysisJson || '{}');
              this._model.setProperty('/analysisResult', analysis);
              MessageToast.show(`Dokument analysiert: ${analysis.summary || 'OK'}`);
            })
            .catch((err) => MessageBox.error(`Upload fehlgeschlagen: ${err.message}`))
            .finally(() => this._model.setProperty('/uploadBusy', false));
    },

    // ── Chat ───────────────────────────────────────────────────────────────
    onChatSend: function () {
      const draft = (this._model.getProperty('/chatDraft') || '').trim();
      if (!draft) return;

      const sessionId = this._getSessionId();
      if (!sessionId) {
        MessageToast.show('Session-ID nicht gefunden.');
        return;
      }

      // Append user message immediately
      const messages = this._model.getProperty('/chatMessages') || [];
      messages.push({ role: 'Sie', text: draft });
      this._model.setProperty('/chatMessages', messages);
      this._model.setProperty('/chatDraft', '');
      this._model.setProperty('/chatBusy', true);
      this._scrollChatToBottom();

      const contextId = this._model.getProperty('/chatContextId') || '';

      this._callActionFetch('/wizard/approverChat', { sessionId, contextId, message: draft })
        .then((result) => {
          const msgs = this._model.getProperty('/chatMessages') || [];
          msgs.push({ role: 'KI-Assistent', text: result.reply || '(Keine Antwort)' });
          this._model.setProperty('/chatMessages', msgs);
          if (result.contextId) this._model.setProperty('/chatContextId', result.contextId);
          this._scrollChatToBottom();
        })
        .catch((err) => {
          const msgs = this._model.getProperty('/chatMessages') || [];
          msgs.push({ role: 'Fehler', text: `Fehler: ${err.message}` });
          this._model.setProperty('/chatMessages', msgs);
          this._scrollChatToBottom();
        })
        .finally(() => this._model.setProperty('/chatBusy', false));
    },

    _scrollChatToBottom: function () {
      setTimeout(() => {
        const scroll = this.base.getView().findAggregatedObjects(true,
          (control) => control.getId().endsWith('--chatScroll'))[0];
        if (scroll) scroll.scrollTo(0, 99999);
      }, 100);
    },

    // ── OData action call (model handles CSRF and service URL) ──────────────
    _callActionFetch: function (path, params) {
      const action = path.split('/').pop();
      const binding = this.base.getView().getModel().bindContext(`/${action}(...)`);
      Object.entries(params).forEach(([key, value]) => binding.setParameter(key, value));
      return binding.execute('$direct')
        .then(() => binding.getBoundContext().getObject())
        .finally(() => binding.destroy());
    },
  });
});
