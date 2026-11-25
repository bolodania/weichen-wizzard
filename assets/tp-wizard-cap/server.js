'use strict';

const cds = require('@sap/cds');
const express = require('express');

cds.on('bootstrap', (app) => {
  // Health endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Fiori Elements Flex / LrepConnector stubs — prevents HTML-response errors
  // when running without FLP. Returns minimal valid JSON so sap.ui.fl continues.
  app.get('/flex/data', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json({ changes: [], variants: [], variantChanges: [], variantDependentControlChanges: [],
               variantManagementChanges: [], ui2personalization: {}, cacheKey: String(Date.now()) });
  });
  app.get('/flex/settings', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json({ isKeyUser: false, isVariantAdaptationEnabled: false,
               isPublicFlVariantEnabled: false, isContextSharingEnabled: false,
               isContextBasedAdaptationEnabled: false });
  });
  app.post('/flex/data', (_req, res) => res.json({ status: 'SUCCESS' }));

  // CORS for local frontend dev
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // Serve the React UI build
  const path = require('path');
  const uiBuildPath = path.join(__dirname, 'app', 'build');
  if (require('fs').existsSync(uiBuildPath)) {
    app.use(express.static(uiBuildPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/wizard') || req.path.startsWith('/odata')) return next();
      res.sendFile(path.join(uiBuildPath, 'index.html'));
    });
  }
});

module.exports = cds.server;
