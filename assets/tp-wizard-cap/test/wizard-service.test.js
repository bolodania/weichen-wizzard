'use strict';

process.env.FL_MOCK = 'true';

const cds = require('@sap/cds');
const { GET, POST } = cds.test().in(__dirname + '/..');

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
  test('gibt eingereichte Session frei und liefert angelegte TPs (Mock)', async () => {
    const sid = await createSession('NI', '4001', 'EWR');
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'zgv_ve', answer: '1', source: 'human-confirmed' });
    await POST('/wizard/submitAnswer', { sessionId: sid, questionId: 'hz_bauart', answer: '0', source: 'human-confirmed' });
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
