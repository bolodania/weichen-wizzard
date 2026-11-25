export async function sessionState(sessionId) {
  const response = await fetch(`/wizard/getSessionState(sessionId='${sessionId}')`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return JSON.parse(body.value);
}

export async function submitSession(sessionId) {
  const response = await fetch('/wizard/submitSession', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok && response.status !== 409) {
    const body = await response.json();
    throw new Error(body.error?.message || `HTTP ${response.status}`);
  }
  const state = await sessionState(sessionId);
  if (!['submitted', 'editing'].includes(state.status)) throw new Error('Einreichung nicht bestätigt');
  return state;
}