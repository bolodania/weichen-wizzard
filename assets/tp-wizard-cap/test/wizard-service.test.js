'use strict';

process.env.FL_MOCK = 'true';

const cds = require('@sap/cds');
const { GET, POST } = cds.test().in(__dirname + '/..');

// ── Helper ────────────────────────────────────────────────────────────────────
async function createSession(ds100, switchNumber, basicForm) {
  const res = await POST('/wizard/createSession', { ds100, switchNumber, basicForm });
  return res.data.sessionId ?? res.data.value?.sessionId;
}

// OData functions returning String wrap the payload in { value: "..." }
function parseStringResponse(res) {
  const raw = res.data?.value ?? res.data;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// ── getSmartDefaults ──────────────────────────────────────────────────────────
describe('getSmartDefaults', () => {
  test('returns defaults for EWL', async () => {
    const res = await GET("/wizard/getSmartDefaults(basicForm='EWL')");
    const defaults = parseStringResponse(res);
    expect(Array.isArray(defaults)).toBe(true);
    expect(defaults.length).toBeGreaterThan(0);
    const rückbau = defaults.find(d => d.questionId === 'rückbauStatus');
    expect(rückbau?.confidence).toBe('high');
  });

  test('returns empty array for unknown basicForm', async () => {
    const res = await GET("/wizard/getSmartDefaults(basicForm='UNKNOWN')");
    const defaults = parseStringResponse(res);
    expect(defaults).toEqual([]);
  });
});

// ── submitSession state machine ───────────────────────────────────────────────
describe('submitSession', () => {
  test('transitions open session to submitted', async () => {
    const sid = await createSession('NI', '2006', 'EWL');
    const res = await POST('/wizard/submitSession', { sessionId: sid });
    expect(res.status).toBe(200);
    const body = res.data.value ?? res.data;
    expect(body.sessionId).toBe(sid);
  });

  test('returns 409 when session is already submitted', async () => {
    const sid = await createSession('NI', '2007', 'EWL');
    await POST('/wizard/submitSession', { sessionId: sid });
    await expect(POST('/wizard/submitSession', { sessionId: sid }))
      .rejects.toMatchObject({ response: { status: 409 } });
  });
});

// ── editAnswer ────────────────────────────────────────────────────────────────
describe('editAnswer', () => {
  test('allows Thomas to edit an answer on a submitted session', async () => {
    const sid = await createSession('NI', '3001', 'EWL');
    await POST('/wizard/submitSession', { sessionId: sid });
    const res = await POST('/wizard/editAnswer', {
      sessionId: sid, questionId: 'herzstückbauart', answer: '1'
    });
    expect(res.status).toBe(200);
  });

  test('returns 409 on open session', async () => {
    const sid = await createSession('NI', '9999', 'EWR');
    await expect(POST('/wizard/editAnswer', {
      sessionId: sid, questionId: 'herzstückbauart', answer: '0'
    })).rejects.toMatchObject({ response: { status: 409 } });
  });
});

// ── approveSession state machine ──────────────────────────────────────────────
describe('approveSession', () => {
  test('approves a submitted session and returns created TPs (mock)', async () => {
    const sid = await createSession('NI', '4001', 'EWL');
    await POST('/wizard/submitSession', { sessionId: sid });
    const res = await POST('/wizard/approveSession', { sessionId: sid });
    expect(res.status).toBe(200);
    const body = res.data.value ?? res.data;
    expect(body.created).toBeDefined();
  });

  test('returns 409 when called on an open session', async () => {
    const sid = await createSession('NI', '8888', 'EWR');
    await expect(POST('/wizard/approveSession', { sessionId: sid }))
      .rejects.toMatchObject({ response: { status: 409 } });
  });
});

// ── listPendingSessions ───────────────────────────────────────────────────────
describe('listPendingSessions', () => {
  test('lists sessions in submitted or editing state', async () => {
    const sid = await createSession('BL', '101', 'DKW');
    await POST('/wizard/submitSession', { sessionId: sid });

    const res = await GET('/wizard/listPendingSessions()');
    const sessions = parseStringResponse(res);
    expect(Array.isArray(sessions)).toBe(true);
    const found = sessions.find(s => s.sessionId === sid);
    expect(found).toBeDefined();
    expect(found.status).toBe('submitted');
    expect(typeof found.openHintCount).toBe('number');
  });
});

// ── confirmSession MUST NOT exist (two-role safety) ──────────────────────────
describe('confirmSession removed', () => {
  test('confirmSession endpoint is not available (404)', async () => {
    const sid = await createSession('NI', '7001', 'EWL');
    await expect(POST('/wizard/confirmSession', { sessionId: sid }))
      .rejects.toMatchObject({ response: { status: 404 } });
  });
});

// ── getOpenHints ──────────────────────────────────────────────────────────────
describe('getOpenHints', () => {
  test('returns hints for agent-default answers', async () => {
    const sid = await createSession('KD', '201', 'EWL');
    await POST('/wizard/submitAnswer', {
      sessionId: sid, questionId: 'herzstückbauart', answer: '0', source: 'agent-default'
    });
    await POST('/wizard/submitSession', { sessionId: sid });

    const res = await GET(`/wizard/getOpenHints(sessionId='${sid}')`);
    const hints = parseStringResponse(res);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].questionId).toBe('herzstückbauart');
    expect(hints[0].hint).toBeTruthy();
  });

  test('openHintCount in listPendingSessions matches getOpenHints length', async () => {
    const sid = await createSession('KD', '202', 'EWR');
    await POST('/wizard/submitAnswer', {
      sessionId: sid, questionId: 'federwippe', answer: 'false', source: 'agent-default'
    });
    await POST('/wizard/submitAnswer', {
      sessionId: sid, questionId: 'prellbock', answer: 'false', source: 'agent-default'
    });
    await POST('/wizard/submitSession', { sessionId: sid });

    const listRes = await GET('/wizard/listPendingSessions()');
    const sessions = parseStringResponse(listRes);
    const found = sessions.find(s => s.sessionId === sid);
    expect(found?.openHintCount).toBe(2);

    const hintsRes = await GET(`/wizard/getOpenHints(sessionId='${sid}')`);
    const hints = parseStringResponse(hintsRes);
    expect(hints.length).toBe(2); // must match listPendingSessions count
  });
});

// ── DerivedTP rows ────────────────────────────────────────────────────────────
describe('DerivedTP hierarchy', () => {
  test('submitSession persists DerivedTP rows with hierarchy', async () => {
    const sid = await createSession('NI', '9001', 'EWL');
    await POST('/wizard/submitSession', { sessionId: sid });

    const res = await GET(`/wizard/Sessions(sessionId='${sid}',IsActiveEntity=true)/tps`);
    expect(res.status).toBe(200);
    const items = res.data.value;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);

    // Root TP has level 0 and no parent
    const root = items.find(tp => tp.level === 0);
    expect(root).toBeDefined();
    expect(root.parentTpKey).toBeFalsy();

    // Child TPs have level 1 and parentTpKey pointing to root
    const children = items.filter(tp => tp.level === 1);
    expect(children.length).toBeGreaterThan(0);
    children.forEach(child => {
      expect(child.parentTpKey).toBe(root.tpKey);
    });

    // Every row carries a tpKey and tpLabel
    items.forEach(tp => {
      expect(tp.tpKey).toBeTruthy();
      expect(tp.tpLabel).toBeTruthy();
    });
  });
});
