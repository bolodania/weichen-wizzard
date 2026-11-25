'use strict';

const cds = require('@sap/cds');
const express = require('express');

cds.on('bootstrap', (app) => {
  if (process.env.VCAP_APPLICATION && cds.env.requires.auth?.kind !== 'xsuaa') {
    throw new Error('Cloud deployment requires XSUAA authentication');
  }
  // Health endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Bootstrap routes are outside CAP's OData adapter: explicitly authenticate
  // them too, so /agent and static UI cannot bypass XSUAA.
  if (cds.env.requires.auth?.kind === 'xsuaa') {
    app.use(cds.middlewares.before);
    app.use((_req, res, next) => {
      const user = cds.context?.user;
      if (!user?.is('authenticated-user')) return res.status(401).json({ error: { message: 'Authentication required' } });
      if (!['WizardUser', 'CAPTools', 'AgentInvoke'].some((role) => user.is(role))) {
        return res.status(403).json({ error: { message: 'TP Wizard scope required' } });
      }
      next();
    });
  }

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
  if (process.env.NODE_ENV !== 'production') app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // Same-origin A2A route for the built field app; Vite provides this in dev.
  app.use('/agent', async (req, res) => {
    let url, auth;
    try {
      const client = require('./srv/lib/agent-client');
      url = client.agentUrl();
      auth = await client.authorization(req.headers.authorization);
    } catch (_) {
      return res.status(502).json({ error: { message: 'Agent authentication/configuration failed' } });
    }
    const transport = require(url.protocol === 'https:' ? 'https' : 'http');
    const upstream = transport.request(url, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        ...(req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}),
        ...(auth ? { Authorization: auth } : {}),
        'X-Wizard-Mode': 'field',
      },
      timeout: 120000,
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Agent timeout')));
    upstream.on('error', (error) => {
      if (!res.headersSent) res.status(502).json({ error: { message: error.message } });
      else res.destroy(error);
    });
    req.pipe(upstream);
  });

  // Serve the React UI build
  const path = require('path');
  const uiBuildPath = path.join(__dirname, 'app-field', 'dist');
  if (require('fs').existsSync(uiBuildPath)) {
    app.use('/field', express.static(uiBuildPath));
    app.get('/', (_req, res) => res.redirect('/field/'));
  }
});

module.exports = cds.server;
