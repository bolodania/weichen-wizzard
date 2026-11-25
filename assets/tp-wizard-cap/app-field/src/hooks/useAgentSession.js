import { useState, useCallback, useRef } from 'react';

const CAP_BASE = '/wizard';
const AGENT_BASE = '/agent';
let rpcId = 1;

// Keywords the agent uses when it has called submitSession and the session is done
const SUBMISSION_SIGNALS = [
  'thomas', 'freigabe', 'weitergeleitet', 'eingereicht', 'submitsession',
];

const AGENT_TRANSIENT_ERROR = 'I encountered an error while processing your request. Please try again.';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isSubmissionConfirmation(text) {
  const lower = text.toLowerCase();
  return SUBMISSION_SIGNALS.filter(kw => lower.includes(kw)).length >= 2;
}

async function a2aSend(text, contextId) {
  const body = {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: crypto.randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text }],
        ...(contextId ? { contextId } : {}),
      },
    },
    id: rpcId++,
  };

  const resp = await fetch(AGENT_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Agent HTTP ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  if (data.error) throw new Error(`Agent error: ${data.error.message ?? JSON.stringify(data.error)}`);

  const result = data.result;

  // Text is in artifacts when completed, in status.message when input_required
  const agentText =
    result?.artifacts?.[0]?.parts?.[0]?.text ??
    result?.status?.message?.parts?.[0]?.text ??
    '';
  const nextContextId = result?.contextId ?? contextId;

  return { agentText, contextId: nextContextId };
}

export function useAgentSession() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages]   = useState([]);
  const [tpPreview, setTpPreview] = useState([]);
  const [status, setStatus]       = useState('idle');
  const [error, setError]         = useState(null);
  const contextIdRef              = useRef(null);
  const sessionIdRef              = useRef(null); // ref for closure access in sendAnswer
  const isProcessingRef           = useRef(false); // synchronous guard — prevents concurrent agent calls

  const addMsg = (role, text) =>
    setMessages(prev => [...prev, { role, text, id: crypto.randomUUID() }]);

  const handleAgentReply = (agentText) => {
    if (!agentText) return;
    addMsg('agent', agentText);
  };

  async function a2aSendWithRetry(text, contextId, retriesLeft = MAX_RETRIES) {
    const result = await a2aSend(text, contextId);
    if (result.agentText === AGENT_TRANSIENT_ERROR && retriesLeft > 0) {
      await sleep(RETRY_DELAY_MS);
      return a2aSendWithRetry(text, contextId, retriesLeft - 1);
    }
    return result;
  }

  async function refreshTpPreview(sid) {
    if (!sid) return;
    try {
      const r = await fetch(`${CAP_BASE}/getTPPreview(sessionId='${sid}')`);
      if (!r.ok) return;
      const d = await r.json();
      const raw = d?.value ?? d;
      const tps = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(tps)) setTpPreview(tps);
    } catch (_) { /* non-critical — TP preview updates best-effort */ }
  }

  const start = useCallback(async ({ ds100, switchNumber, basicForm }) => {
    setStatus('loading');
    setError(null);
    contextIdRef.current = null;
    sessionIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    setTpPreview([]);

    // Create session directly so we reliably know the sessionId before the agent responds
    let sid;
    try {
      const capRes = await fetch(`${CAP_BASE}/createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ds100, switchNumber, basicForm }),
      });
      if (!capRes.ok) {
        const txt = await capRes.text();
        throw new Error(`createSession ${capRes.status}: ${txt}`);
      }
      const capData = await capRes.json();
      sid = capData?.value?.sessionId ?? capData?.sessionId;
      if (!sid) throw new Error('createSession returned no sessionId');
      setSessionId(sid);
      sessionIdRef.current = sid;
      await refreshTpPreview(sid); // show automatic TPs immediately
    } catch (e) {
      setError(e.message);
      setStatus('error');
      return;
    }

    // Show the user-facing intro in the chat
    const displayMsg = `Ich erfasse Weiche ${switchNumber} in Betriebsstelle ${ds100}. Grundbauform: ${basicForm}.`;
    addMsg('katrin', displayMsg);

    // Tell the agent the session already exists so it skips createSession
    const agentIntro = `Session-Id: ${sid}\nWeiche ${switchNumber} | Betriebsstelle ${ds100} | Grundbauform: ${basicForm}. Session wurde bereits erstellt. Bitte beginne sofort mit dem Frage-Dialog (getSmartDefaults → getNextQuestion → submitAnswer-Schleife).`;

    try {
      const { agentText, contextId } = await a2aSendWithRetry(agentIntro, null);
      contextIdRef.current = contextId;
      handleAgentReply(agentText);
      await refreshTpPreview(sid);
      setStatus('active');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  async function ensureSubmitted(sid) {
    // Guard: if the agent said it submitted but never called the CAP endpoint,
    // call it directly so Thomas always sees the session.
    try {
      const r = await fetch(`${CAP_BASE}/submitSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      });
      // 409 = already submitted — that's fine, session is in the right state
      if (!r.ok && r.status !== 409) {
        const txt = await r.text();
        console.warn('ensureSubmitted failed:', r.status, txt);
      }
    } catch (e) {
      console.warn('ensureSubmitted error:', e.message);
    }
  }

  const sendAnswer = useCallback(async (text) => {
    // Synchronous ref check prevents concurrent agent calls from racing.
    // React state (status) uses a stale closure so it cannot reliably block
    // rapid re-fires; the ref is always current.
    if (isProcessingRef.current || status !== 'active') return;
    isProcessingRef.current = true;
    addMsg('katrin', text);
    setStatus('loading');

    try {
      const { agentText, contextId } = await a2aSendWithRetry(text, contextIdRef.current);
      contextIdRef.current = contextId;
      handleAgentReply(agentText);

      // Always refresh TP preview from CAP — the agent may have submitted an answer
      // that updated the derived TP list, but doesn't forward the JSON to the chat.
      await refreshTpPreview(sessionIdRef.current);

      if (isSubmissionConfirmation(agentText)) {
        // Guarantee the CAP session is submitted regardless of whether the agent
        // actually called submitSession via MCP — keyword detection is not reliable enough.
        await ensureSubmitted(sessionIdRef.current);
        setStatus('submitted');
      } else {
        setStatus('active');
      }
    } catch (e) {
      setError(e.message);
      setStatus('active');
    } finally {
      isProcessingRef.current = false;
    }
  }, [status]);

  // SubmitSummary confirm button — calls CAP directly, no agent round-trip needed
  const submit = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setStatus('loading');

    try {
      const r = await fetch(`${CAP_BASE}/submitSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      });
      if (!r.ok && r.status !== 409) {
        const txt = await r.text();
        throw new Error(`submitSession ${r.status}: ${txt}`);
      }
      setStatus('submitted');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  return { sessionId, messages, tpPreview, status, error, start, sendAnswer, submit, addMsg };
}
