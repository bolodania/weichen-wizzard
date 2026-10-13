import { useState, useCallback, useRef } from 'react';

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

function extractTpPreview(text) {
  try {
    const match = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) ||
                  text.match(/(\[[\s\S]*"tp"[\s\S]*?\])/);
    if (match) return JSON.parse(match[1]);
  } catch (_) { /* not a JSON block */ }
  return null;
}

export function useAgentSession() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages]   = useState([]);
  const [tpPreview, setTpPreview] = useState([]);
  const [status, setStatus]       = useState('idle');
  const [error, setError]         = useState(null);
  const contextIdRef              = useRef(null);

  const addMsg = (role, text) =>
    setMessages(prev => [...prev, { role, text, id: crypto.randomUUID() }]);

  const handleAgentReply = (agentText) => {
    if (!agentText) return;
    addMsg('agent', agentText);
    const tps = extractTpPreview(agentText);
    if (tps) setTpPreview(tps);
  };

  async function a2aSendWithRetry(text, contextId, retriesLeft = MAX_RETRIES) {
    const result = await a2aSend(text, contextId);
    if (result.agentText === AGENT_TRANSIENT_ERROR && retriesLeft > 0) {
      await sleep(RETRY_DELAY_MS);
      return a2aSendWithRetry(text, contextId, retriesLeft - 1);
    }
    return result;
  }

  const start = useCallback(async ({ ds100, switchNumber, basicForm }) => {
    setStatus('loading');
    setError(null);
    contextIdRef.current = null;
    setMessages([]);
    setTpPreview([]);

    const intro = `Ich erfasse Weiche ${switchNumber} in Betriebsstelle ${ds100}. Grundbauform: ${basicForm}.`;
    addMsg('katrin', intro);

    try {
      const { agentText, contextId } = await a2aSendWithRetry(intro, null);
      contextIdRef.current = contextId;

      const sidMatch = agentText.match(/[Ss]ession[- ]?[Ii][Dd][:\s]+([a-f0-9-]{36})/);
      if (sidMatch) setSessionId(sidMatch[1]);

      handleAgentReply(agentText);
      setStatus('active');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  const sendAnswer = useCallback(async (text) => {
    if (status !== 'active') return;
    addMsg('katrin', text);
    setStatus('loading');

    try {
      const { agentText, contextId } = await a2aSendWithRetry(text, contextIdRef.current);
      contextIdRef.current = contextId;
      handleAgentReply(agentText);

      if (isSubmissionConfirmation(agentText)) {
        setStatus('submitted');
      } else {
        setStatus('active');
      }
    } catch (e) {
      setError(e.message);
      setStatus('active');
    }
  }, [status]);

  // Kept for the SubmitSummary confirm button
  const submit = useCallback(async () => {
    if (!contextIdRef.current) return;
    setStatus('loading');
    const confirmText = 'Ja, bitte einreichen.';
    addMsg('katrin', confirmText);

    try {
      const { agentText, contextId } = await a2aSendWithRetry(confirmText, contextIdRef.current);
      contextIdRef.current = contextId;
      handleAgentReply(agentText);
      setStatus('submitted');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  return { sessionId, messages, tpPreview, status, error, start, sendAnswer, submit, addMsg };
}
