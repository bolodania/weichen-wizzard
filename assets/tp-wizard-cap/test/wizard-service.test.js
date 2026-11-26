'use strict';

process.env.FL_MOCK = 'true';
process.env.CDS_IGNORE_DUPLICATE = 'true';
process.env.VALUE_HELP_DESTINATION = 'TEST_DESTINATION';
process.env.VALUE_HELP_SERVICE_PATH = '/odata/test-locations';
process.env.VALUE_HELP_ENTITY_SET = 'Stations';
process.env.VALUE_HELP_KEY_FIELD = 'Code';
process.env.VALUE_HELP_TEXT_FIELD = 'Description';
process.env.VALUE_HELP_ODATA_VERSION = '2';
// Integration tests must not invoke a developer's live LLM agent on port 5000.
process.env.AGENT_URL = 'http://127.0.0.1:1';

const cds = require('@sap/cds');
cds.env.requires.auth = {
  kind: 'mocked', users: {
    tester: { password: 'test', roles: [] },
    tools: { password: 'test', roles: ['system-user'] },
  },
};
const testServer = cds.test().in(__dirname + '/..');
const { GET, POST, PATCH } = testServer;
beforeAll(() => {
  testServer.axios.defaults.auth = { username: 'tester', password: 'test' };
});
const seedSessions = require('../db/data/tp.wizard.WizardSession.json');
const flService = require('../srv/fl-service');

async function completeSession(sid) {
  for (const { questionId, answer, source } of JSON.parse(seedSessions[0].answersJson)) {
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId, answer, source });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function createSession(ds100, switchNumber, basicForm, fertigmeldung) {
  const res = await POST('/wizard/createSession', { ds100, switchNumber, basicForm, fertigmeldung });
  return res.data.sessionId ?? res.data.value?.sessionId;
}

// OData functions returning String wrap the payload in { value: "..." }
function parseStringResponse(res) {
  const raw = res.data?.value ?? res.data;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// ── getSmartDefaults (Vorgaben aus dem Eingabenkatalog) ──────────────────────
describe('getSmartDefaults', () => {
  test('liefert Vorgaben für EWR', async () => {
    const res = await GET("/wizard/getSmartDefaults(basicForm='EWR')");
    const defaults = parseStringResponse(res);
    expect(Array.isArray(defaults)).toBe(true);
    expect(defaults.length).toBeGreaterThan(0);
    const antriebsart = defaults.find((d) => d.questionId === 'antrieb_art');
    expect(antriebsart?.defaultAnswer).toBe('elektromechanisch');
  });

  test('liefert leere Liste für Grundbauform ohne Regelwerk', async () => {
    const res = await GET("/wizard/getSmartDefaults(basicForm='EWL')");
    expect(parseStringResponse(res)).toEqual([]);
  });
});

// ── submitSession state machine ──────────────────────────────────────────────
describe('submitSession', () => {
  test('überführt offene Session nach submitted', async () => {
    const sid = await createSession('NI', '2006', 'EWR');
    const res = await POST('/wizard/submitSession', { sessionId: sid });
    expect(res.status).toBe(200);
    expect((res.data.value ?? res.data).sessionId).toBe(sid);
  });

  test('409 wenn Session bereits eingereicht', async () => {
    const sid = await createSession('NI', '2007', 'EWR');
    await POST('/wizard/submitSession', { sessionId: sid });
    await expect(POST('/wizard/submitSession', { sessionId: sid })).rejects.toMatchObject({
      response: { status: 409 },
    });
  });
});

// ── submitAnswer / TP-Ableitung aus dem Regelwerk ────────────────────────────
describe('submitAnswer', () => {
  test('invalid answer cannot be saved and leaves the session unchanged', async () => {
    const sid = await createSession('NI', '999', 'EWR');
    for (const answer of ['garbage', '2abc', '-1', '1.9']) {
      await expect(POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'zgv_ve', answer }))
        .rejects.toMatchObject({ response: { status: 400 } });
    }
    await expect(POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'invented', answer: '1' }))
      .rejects.toMatchObject({ response: { status: 400 } });
    const context = parseStringResponse(await GET(`/wizard/getSessionContext(sessionId='${sid}')`));
    expect(context.answers).toEqual([]);
  });
  test('Angabe setzen liefert TP-Vorschau aus dem Regelwerk', async () => {
    const sid = await createSession('NRB', '806', 'EWR');
    const res = await POST('/wizard/submitAnswer', {
      sessionId: sid, questionId: 'zgv_ve', answer: '8', source: 'human-confirmed',
    });
    expect(res.status).toBe(200);
    const body = res.data.value ?? res.data;
    const tps = JSON.parse(body.tpPreview);
    expect(Array.isArray(tps)).toBe(true);
    // Verschlussebenen-TPs entstehen aus der Mengenangabe
    expect(tps.some((tp) => tp.tpKey.endsWith('ZUBA-VE-08'))).toBe(true);
  });
});

// ── applyDocumentValues — Werte nur mit wörtlicher Textstelle ────────────────
describe('applyDocumentValues (Fertigmeldung + Zitatpflicht)', () => {
  const fertigmeldung = 'Fertigmeldung: Die Zungenvorrichtung hat 8 Verschlussebenen und 2 Antriebe.';

  test('übernimmt Wert mit gültiger, wörtlich vorkommender Textstelle', async () => {
    const sid = await createSession('NRB', '806', 'EWR', fertigmeldung);
    const res = await POST('/wizard/applyDocumentValues', {
      sessionId: sid,
      values: JSON.stringify([{ angabe: 'zgv_ve', wert: '8', textstelle: '8 Verschlussebenen' }]),
    });
    const body = res.data.value ?? res.data;
    const uebernommen = JSON.parse(body.uebernommen);
    const abgelehnt = JSON.parse(body.abgelehnt);
    expect(abgelehnt).toHaveLength(0);
    expect(uebernommen).toHaveLength(1);
    expect(uebernommen[0]).toMatchObject({ questionId: 'zgv_ve', answer: '8', herkunft: 'Dokument' });
    expect(uebernommen[0].beleg).toContain('8 Verschlussebenen');
  });

  test('lehnt Wert ohne passende Textstelle ab (kein erfundener Wert)', async () => {
    const sid = await createSession('NRB', '806', 'EWR', fertigmeldung);
    const res = await POST('/wizard/applyDocumentValues', {
      sessionId: sid,
      values: JSON.stringify([{ angabe: 'zgv_ve', wert: '99', textstelle: '99 Verschlussebenen' }]),
    });
    const body = res.data.value ?? res.data;
    expect(JSON.parse(body.uebernommen)).toHaveLength(0);
    expect(JSON.parse(body.abgelehnt)[0].grund).toMatch(/Textstelle/);
  });

  test('lehnt ungültigen Wert (Typprüfung) ab', async () => {
    const sid = await createSession('NRB', '806', 'EWR', 'Die Weiche hat viele Verschlussebenen.');
    const res = await POST('/wizard/applyDocumentValues', {
      sessionId: sid,
      values: JSON.stringify([{ angabe: 'zgv_ve', wert: 'viele', textstelle: 'viele Verschlussebenen' }]),
    });
    const body = res.data.value ?? res.data;
    expect(JSON.parse(body.uebernommen)).toHaveLength(0);
    expect(JSON.parse(body.abgelehnt)[0].grund).toMatch(/ganze Zahl/);
  });
});

// ── editAnswer ────────────────────────────────────────────────────────────────
describe('editAnswer', () => {
  test('draft activation validates answers, invalid draft cannot corrupt active data', async () => {
    const sid = await createSession('NI', '997', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    const active = `/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`;
    await POST(`${active}/WizardService.draftEdit`, {PreserveChanges: false});
    await PATCH(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=false)/answers(session_sessionId='${sid}',questionId='zgv_ve',IsActiveEntity=false)`, {answer: 'invalid'});
    await expect(POST(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=false)/WizardService.draftActivate`, {}))
      .rejects.toMatchObject({response: {status: 400}});
    expect((await GET(active)).data.derivedTPCount).toBe(25);
  });
  test('invalid edit via action and active PATCH is rejected', async () => {
    const sid = await createSession('NI', '998', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', {sessionId: sid});
    await expect(POST('/wizard/editAnswer', {sessionId: sid, questionId: 'zgv_ve', answer: '2abc'}))
      .rejects.toMatchObject({response: {status: 400}});
    await expect(PATCH(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)/answers(session_sessionId='${sid}',questionId='zgv_ve',IsActiveEntity=true)`, {answer: '-1'}))
      .rejects.toMatchObject({response: {status: 400}});
    expect(parseStringResponse(await GET(`/wizard/getSessionState(sessionId='${sid}')`)).tps).toHaveLength(25);
  });
  test('erlaubt Thomas das Bearbeiten einer eingereichten Session', async () => {
    const sid = await createSession('NI', '3001', 'EWR');
    await POST('/wizard/submitSession', { sessionId: sid });
    const res = await POST('/wizard/editAnswer', { sessionId: sid, questionId: 'hz_bauart', answer: '1' });
    expect(res.status).toBe(200);
  });

  test('409 bei offener Session', async () => {
    const sid = await createSession('NI', '9999', 'EWR');
    await expect(
      POST('/wizard/editAnswer', { sessionId: sid, questionId: 'hz_bauart', answer: '0' }),
    ).rejects.toMatchObject({ response: { status: 409 } });
  });
});

// ── approveSession state machine ──────────────────────────────────────────────
describe('approveSession', () => {
  test('real adapter posts every derived TP, persists partial results and blocks repeat approval', async () => {
    const sid = await createSession('NI', '4998', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    const client = require('@sap-cloud-sdk/http-client');
    const spy = jest.spyOn(client, 'executeHttpRequest').mockImplementation(async (_destination, config) => {
      if (config.method === 'GET') return { status: 200, headers: { 'x-csrf-token': 'test-csrf' } };
      if (config.data.FunctionalLocation.endsWith('01')) throw { response: { status: 400 } };
      return { status: 201, data: { d: config.data } };
    });
    process.env.FL_MOCK = 'false';
    process.env.FL_ENTITY_SET = 'FunctionalLocation';
    try {
      const response = await POST('/wizard/approveSession', { sessionId: sid });
      const created = JSON.parse(response.data.created);
      const failed = JSON.parse(response.data.failed);
      expect(created.length + failed.length).toBe(25);
      expect(created.length).toBeGreaterThan(0);
      expect(failed.length).toBeGreaterThan(0);
      expect(spy).toHaveBeenCalledTimes(26);
      const row = (await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`)).data;
      expect(row.status).toBe('failed');
      expect(JSON.parse(row.creationResult)).toMatchObject({ created, failed, mock: false });
      await expect(POST('/wizard/approveSession', { sessionId: sid })).rejects.toMatchObject({ response: { status: 409 } });
      expect(spy).toHaveBeenCalledTimes(26);
    } finally {
      spy.mockRestore();
      process.env.FL_MOCK = 'true';
      delete process.env.FL_ENTITY_SET;
    }
  });

  test('missing real-write configuration returns 503 and keeps session submitted', async () => {
    const sid = await createSession('NI', '4999', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    process.env.FL_MOCK = 'false';
    delete process.env.FL_ENTITY_SET;
    try {
      await expect(POST('/wizard/approveSession', { sessionId: sid })).rejects.toMatchObject({ response: { status: 503 } });
      expect((await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`)).data.status).toBe('submitted');
    } finally { process.env.FL_MOCK = 'true'; }
  });

  test('bound approval validates all contract lengths before SAP access or state change', async () => {
    const sid = await createSession('NI', '4997', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    const client = require('@sap-cloud-sdk/http-client');
    const spy = jest.spyOn(client, 'executeHttpRequest');
    const katalog = await require('../srv/lib/katalog').ladeKatalog();
    const templates = [...katalog.forla.values()];
    const previousLabels = templates.map((template) => template.bezeichnung);
    templates.forEach((template) => { template.bezeichnung = 'X'.repeat(41); });
    process.env.FL_MOCK = 'false';
    process.env.FL_ENTITY_SET = 'FunctionalLocation';
    try {
      const active = `/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`;
      await expect(POST(`${active}/WizardService.approve`, {})).rejects.toMatchObject({ response: { status: 422 } });
      expect((await GET(active)).data.status).toBe('submitted');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      templates.forEach((template, i) => { template.bezeichnung = previousLabels[i]; });
      spy.mockRestore();
      process.env.FL_MOCK = 'true';
      delete process.env.FL_ENTITY_SET;
    }
  });

  test('concurrent approval performs the SAP write once', async () => {
    const sid = await createSession('NI', '995', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', {sessionId: sid});
    const spy = jest.spyOn(flService, 'bulkCreateFunctionalLocations');
    try {
      const results = await Promise.allSettled([
        POST('/wizard/approveSession', {sessionId: sid}),
        POST('/wizard/approveSession', {sessionId: sid}),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
  test('gibt eingereichte Session frei und liefert angelegte TPs (Mock)', async () => {
    const sid = await createSession('NI', '4001', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    const res = await POST('/wizard/approveSession', { sessionId: sid });
    expect(res.status).toBe(200);
    expect((res.data.value ?? res.data).created).toBeDefined();
  });

  test('409 bei offener Session', async () => {
    const sid = await createSession('NI', '8888', 'EWR');
    await expect(POST('/wizard/approveSession', { sessionId: sid })).rejects.toMatchObject({
      response: { status: 409 },
    });
  });
});

describe('PoC correctness regressions', () => {
  test('technical authenticated client cannot approve sessions', async () => {
    await expect(POST('/wizard/approveSession', { sessionId: seedSessions[0].sessionId }, {
      auth: { username: 'tools', password: 'test' },
    })).rejects.toMatchObject({ response: { status: 403 } });
  });
  test.each(['abc', '20a06', '-1', '1.5', '1e3', '12345678'])('rejects invalid switch number %s', async (value) => {
    await expect(createSession('NI', value, 'EWR')).rejects.toMatchObject({ response: { status: 400 } });
  });

  test('value help endpoint maps destination values without a live backend', async () => {
    const client = require('@sap-cloud-sdk/http-client');
    const spy = jest.spyOn(client, 'executeHttpRequest').mockResolvedValueOnce({
      data: { d: { results: [{ Code: '100', Description: 'Example partner' }] } },
    });
    try {
      const response = await GET("/wizard/getLocationValues(search='100',skip=0)");
      expect(response.data.items).toEqual([{ code: '100', description: 'Example partner' }]);
    } finally { spy.mockRestore(); }
  });
  test('seeded session helper endpoints and CSV work without prior edits', async () => {
    const sid = seedSessions[0].sessionId;
    expect(parseStringResponse(await GET(`/wizard/getTPPreview(sessionId='${sid}')`))).toHaveLength(25);
    expect(parseStringResponse(await GET(`/wizard/getOpenFields(sessionId='${sid}')`))).toEqual([]);
    expect((await GET(`/wizard/exportSessionCSV(sessionId='${sid}')`)).data.value.split('\n')).toHaveLength(26);
    expect((await GET(`/wizard/getNextQuestion(sessionId='${sid}')`)).status).toBe(200);
  });

  test('incomplete approval is rejected without changing submitted state', async () => {
    const sid = await createSession('NI', '4100', 'EWR');
    await POST('/wizard/submitSession', { sessionId: sid });
    await expect(POST('/wizard/approveSession', { sessionId: sid })).rejects.toMatchObject({ response: { status: 422 } });
    const row = await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`);
    expect(row.data.status).toBe('submitted');
    await POST('/wizard/editAnswer', { sessionId: sid, questionId: 'zgv_ve', answer: '1' });
  });

  test('unsupported basic form cannot be approved as an empty success', async () => {
    const sid = await createSession('NI', '4101', 'EWL');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    await expect(POST('/wizard/approveSession', { sessionId: sid })).rejects.toMatchObject({ response: { status: 422 } });
  });

  test('partial SAP failure is persisted as failed, never created', async () => {
    const sid = await createSession('NI', '4102', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    const spy = jest.spyOn(flService, 'bulkCreateFunctionalLocations').mockResolvedValueOnce({
      created: [], failed: [{ tpKey: 'test', error: 'SAP unavailable' }],
    });
    try {
      const result = await POST('/wizard/approveSession', { sessionId: sid });
      expect(JSON.parse(result.data.failed)).toHaveLength(1);
      expect((await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`)).data.status).toBe('failed');
    } finally {
      spy.mockRestore();
    }
  });

  test('thrown SAP failure is persisted and blocks repeat approval', async () => {
    const sid = await createSession('NI', '4106', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    const spy = jest.spyOn(flService, 'bulkCreateFunctionalLocations').mockRejectedValueOnce(new Error('Connection refused'));
    try {
      const result = await POST('/wizard/approveSession', { sessionId: sid });
      expect(JSON.parse(result.data.failed)).toHaveLength(25);
      expect((await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`)).data.status).toBe('failed');
      await expect(POST('/wizard/approveSession', { sessionId: sid })).rejects.toMatchObject({ response: { status: 409 } });
    } finally {
      spy.mockRestore();
    }
  });

  test('direct answer PATCH recalculates persisted TP count and preview', async () => {
    const sid = await createSession('NI', '4103', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    await PATCH(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)/answers(session_sessionId='${sid}',questionId='zgv_ve',IsActiveEntity=true)`, { answer: '2' });
    const row = await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`);
    const tps = await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)/tps`);
    expect(row.data.derivedTPCount).toBe(29);
    expect(tps.data.value).toHaveLength(29);
    expect(parseStringResponse(await GET(`/wizard/getTPPreview(sessionId='${sid}')`))).toHaveLength(29);
  });

  test('Fiori draft edit/save recalculates active answers and TP count', async () => {
    const sid = await createSession('NI', '4104', 'EWR');
    await completeSession(sid);
    await POST('/wizard/submitSession', { sessionId: sid });
    const active = `/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)`;
    await POST(`${active}/WizardService.draftEdit`, { PreserveChanges: false });
    await PATCH(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=false)/answers(session_sessionId='${sid}',questionId='zgv_ve',IsActiveEntity=false)`, { answer: '2' });
    expect((await GET(active)).data.derivedTPCount).toBe(25);
    await POST(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=false)/WizardService.draftActivate`, {});
    expect((await GET(active)).data.derivedTPCount).toBe(29);
    const result = await POST(`${active}/WizardService.approve`, {});
    expect(JSON.parse(result.data.created)).toHaveLength(29);
  });

  test('document analysis accepts wrapped citations and explains open inputs', async () => {
    const text = 'Die Zungenvorrichtung hat 8 Verschlussebenen.';
    const sid = await createSession('NI', '4105', 'EWR', text);
    await POST('/wizard/applyDocumentValues', {
      sessionId: sid, values: JSON.stringify([{ angabe: 'zgv_ve', wert: '8', textstelle: '8 Verschlussebenen' }]),
    });
    const result = await POST('/wizard/uploadDocument', {
      sessionId: sid, filename: 'citation.txt', mimeType: 'text/plain', contentB64: Buffer.from(text).toString('base64'),
    });
    const analysis = JSON.parse(result.data.analysisJson);
    expect(analysis.nichtBelegteWerte).toEqual([]);
    expect(analysis.offeneAngaben[0]).toEqual({ questionId: expect.any(String), hint: expect.any(String) });
    expect(analysis.fehlendeHinweise.some((r) => r.muster === '')).toBe(false);
  });
});

// ── listPendingSessions ───────────────────────────────────────────────────────
describe('listPendingSessions', () => {
  test('listet Sessions in submitted/editing', async () => {
    const sid = await createSession('BL', '101', 'EWR');
    await POST('/wizard/submitSession', { sessionId: sid });
    const res = await GET('/wizard/listPendingSessions()');
    const sessions = parseStringResponse(res);
    const found = sessions.find((s) => s.sessionId === sid);
    expect(found).toBeDefined();
    expect(found.status).toBe('submitted');
    expect(typeof found.openHintCount).toBe('number');
  });
});

// ── confirmSession darf nicht existieren (Zwei-Rollen-Schutz) ────────────────
describe('confirmSession entfernt', () => {
  test('confirmSession-Endpunkt ist nicht verfügbar (404)', async () => {
    const sid = await createSession('NI', '7001', 'EWR');
    await expect(POST('/wizard/confirmSession', { sessionId: sid })).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

// ── getOpenHints ──────────────────────────────────────────────────────────────
describe('getOpenHints', () => {
  test('liefert Hinweise für agent-default-Antworten', async () => {
    const sid = await createSession('KD', '201', 'EWR');
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'hz_bauart', answer: '0', source: 'agent-default' });
    await POST('/wizard/submitSession', { sessionId: sid });
    const res = await GET(`/wizard/getOpenHints(sessionId='${sid}')`);
    const hints = parseStringResponse(res);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].questionId).toBe('hz_bauart');
  });

  test('openHintCount in listPendingSessions passt zu getOpenHints', async () => {
    const sid = await createSession('KD', '202', 'EWR');
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'zgv_fwip', answer: 'Nein', source: 'agent-default' });
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'siwes', answer: 'Nein', source: 'agent-default' });
    await POST('/wizard/submitSession', { sessionId: sid });

    const listRes = await GET('/wizard/listPendingSessions()');
    const found = parseStringResponse(listRes).find((s) => s.sessionId === sid);
    expect(found?.openHintCount).toBe(2);

    const hintsRes = await GET(`/wizard/getOpenHints(sessionId='${sid}')`);
    expect(parseStringResponse(hintsRes).length).toBe(2);
  });
});

// ── bulkSubmitWithDefaults ────────────────────────────────────────────────────
describe('bulkSubmitWithDefaults', () => {
  test('übernimmt verbleibende Vorgaben und reicht ein', async () => {
    const sid = await createSession('NI', '5001', 'EWR');
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'hz_bauart', answer: '1', source: 'human-confirmed' });
    const res = await POST('/wizard/bulkSubmitWithDefaults', { sessionId: sid });
    const body = res.data.value ?? res.data;
    expect(body.sessionId).toBe(sid);
    expect(body.defaultedCount).toBeGreaterThan(0);
    expect(body.status).toBe('submitted');
  });

  test('überschreibt bereits bestätigte Antworten nicht', async () => {
    const sid = await createSession('NI', '5003', 'EWR');
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'antrieb_art', answer: 'hydraulisch', source: 'human-confirmed' });
    await POST('/wizard/bulkSubmitWithDefaults', { sessionId: sid });

    const sessionRes = await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)/answers`);
    const antrieb = sessionRes.data.value.find((a) => a.questionId === 'antrieb_art');
    expect(antrieb?.source).toBe('human-confirmed');
    expect(antrieb?.answer).toBe('hydraulisch');
  });

  test('409 wenn Session nicht offen', async () => {
    const sid = await createSession('NI', '5002', 'EWR');
    await POST('/wizard/submitSession', { sessionId: sid });
    await expect(POST('/wizard/bulkSubmitWithDefaults', { sessionId: sid })).rejects.toMatchObject({
      response: { status: 409 },
    });
  });
});

// ── DerivedTP-Hierarchie ──────────────────────────────────────────────────────
describe('DerivedTP-Hierarchie', () => {
  test('submitSession persistiert TPs mit Ebene und Elternbezug aus dem Regelwerk', async () => {
    const sid = await createSession('NRB', '9001', 'EWR');
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'zgv_ve', answer: '2', source: 'human-confirmed' });
    await POST('/wizard/submitSession', { sessionId: sid });

    const res = await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)/tps`);
    const items = res.data.value;
    expect(items.length).toBeGreaterThan(0);

    const keys = new Set(items.map((tp) => tp.tpKey));
    // Wurzelknoten: Ebene 0, kein Elternbezug
    expect(items.some((tp) => tp.level === 0 && !tp.parentTpKey)).toBe(true);
    // Jeder Elternbezug verweist auf einen tatsächlich vorhandenen TP
    for (const tp of items) {
      if (tp.parentTpKey) expect(keys.has(tp.parentTpKey)).toBe(true);
      expect(tp.tpKey).toBeTruthy();
      expect(tp.tpLabel).toBeTruthy();
    }
  });
});

// ── PDF Upload & Analyse (M2: Dokument-Upload-Feature) ────────────────────────
describe('uploadDocument & analyseDocument', () => {
  test('answer correction invalidates document analysis and removes old citations', async () => {
    const sid = await createSession('NI', '996', 'EWR');
    await POST('/wizard/uploadDocument', {sessionId: sid, filename: 'values.txt', mimeType: 'text/plain',
      contentB64: Buffer.from('Die Zungenvorrichtung hat 2 Verschlussebenen.').toString('base64')});
    await POST('/wizard/applyDocumentValues', {sessionId: sid,
      values: JSON.stringify([{angabe: 'zgv_ve', wert: '2', textstelle: '2 Verschlussebenen'}])});
    await POST('/wizard/submitSession', {sessionId: sid});
    await POST('/wizard/analyseDocument', {sessionId: sid, filename: 'values.txt'});
    await POST('/wizard/editAnswer', {sessionId: sid, questionId: 'zgv_ve', answer: '3'});
    const doc = await GET(`/wizard/SessionDocuments(sessionId='${sid}',filename='values.txt',IsActiveEntity=true)`);
    expect(doc.data.analysisDoneAt).toBeNull();
    const context = parseStringResponse(await GET(`/wizard/getSessionContext(sessionId='${sid}')`));
    expect(context.answers.find(a => a.questionId === 'zgv_ve')).toMatchObject({answer: '3', beleg: null, herkunft: 'Manuell'});
  });
  test('uploadDocument speichert PDF und analysiert Pflicht-/Optional-TPs', async () => {
    const sid = await createSession('NI', '8001', 'EWR');
    
    // Simuliere ein einfaches PDF (base64-kodiert)
    const mockPdfContent = Buffer.from('Weiche NI 8001').toString('base64');
    
    const res = await POST('/wizard/uploadDocument', {
      sessionId: sid,
      filename: 'test-weiche.pdf',
      mimeType: 'text/plain',
      contentB64: mockPdfContent
    });

    expect(res.status).toBe(200);
    const body = res.data.value ?? res.data;
    expect(body.sessionId).toBe(sid);
    expect(body.filename).toBe('test-weiche.pdf');
    expect(body.analysisJson).toBeTruthy();

    const analysis = JSON.parse(body.analysisJson);
    expect(analysis).toHaveProperty('pflichtTps');
    expect(analysis).toHaveProperty('optionalTps');
    expect(analysis).toHaveProperty('fehlendeHinweise');
    expect(Array.isArray(analysis.pflichtTps)).toBe(true);
  });

  test('uploadDocument gibt 400 bei fehlenden Pflichtfeldern', async () => {
    await expect(POST('/wizard/uploadDocument', { sessionId: 'test' }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('analyseDocument führt erneute Analyse auf bestehendem Dokument aus', async () => {
    const sid = await createSession('NI', '8002', 'EWR');
    
    // Erst hochladen
    const mockPdf = Buffer.from('Fertigmeldung Weiche').toString('base64');
    await POST('/wizard/uploadDocument', {
      sessionId: sid,
      filename: 'reanalyse-test.pdf',
      mimeType: 'text/plain',
      contentB64: mockPdf
    });

    // Dann erneut analysieren
    const res = await POST('/wizard/analyseDocument', {
      sessionId: sid,
      filename: 'reanalyse-test.pdf'
    });

    expect(res.status).toBe(200);
    const body = res.data.value ?? res.data;
    expect(body.sessionId).toBe(sid);
    expect(body.analysisJson).toBeTruthy();
    
    const analysis = JSON.parse(body.analysisJson);
    expect(analysis).toHaveProperty('pflichtTps');
    expect(analysis).toHaveProperty('summary');
  });

  test('analyseDocument gibt 404 wenn Dokument nicht existiert', async () => {
    const sid = await createSession('NI', '8003', 'EWR');
    await expect(POST('/wizard/analyseDocument', {
      sessionId: sid,
      filename: 'nicht-vorhanden.pdf'
    })).rejects.toMatchObject({ response: { status: 404 } });
  });
});

// ── Approver Chat (M2: Chat-Feature für Approver) ─────────────────────────────
describe('approverChat', () => {
  test('approverChat gibt 400 bei fehlender message', async () => {
    const sid = await createSession('NI', '9002', 'EWR');
    await expect(POST('/wizard/approverChat', { sessionId: sid }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('approverChat reports unavailable agent as 502', async () => {
    const sid = await createSession('NI', '9003', 'EWR');
    await expect(POST('/wizard/approverChat', {sessionId: sid, message: 'Prüfen'}))
      .rejects.toMatchObject({response: {status: 502}});
  });
});
