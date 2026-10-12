'use strict';

const cds = require('@sap/cds');
const express = require('express');

cds.on('bootstrap', (app) => {
  // Health endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

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
