import { useState, useRef } from 'react';
import { sessionState, submitSession, completeMissingAnswers } from '../sessionApi.js';

export function useAgentSession() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [tpPreview, setTpPreview] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [missingQuestions, setMissingQuestions] = useState([]);
  const [completionBusy, setCompletionBusy] = useState(false);
  const context = useRef(null);
  const busy = useRef(false);
  const addMsg = (role, text) => setMessages((previous) => [...previous, { role, text, id: crypto.randomUUID() }]);

  async function refresh(sid) {
    const state = await sessionState(sid);
    setTpPreview(state.tps);
    setCurrentQuestion(state.question);
    setMissingQuestions(['submitted', 'editing'].includes(state.status) ? state.missingQuestions || [] : []);
    setStatus(['submitted', 'editing'].includes(state.status) ? 'submitted' :
      !state.question ? 'all-answered' : 'active');
  }

  async function converse(text, sid) {
    const response = await fetch('/agent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'message/send', id: crypto.randomUUID(), params: {
        message: { kind: 'message', role: 'user', messageId: crypto.randomUUID(),
          parts: [{ kind: 'text', text }], ...(context.current ? { contextId: context.current } : {}) },
      } }),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error?.message || `Agent HTTP ${response.status}`);
    const result = data.result;
    if (result?.status?.state === 'failed') throw new Error(result.status.message?.parts?.[0]?.text || 'Agent fehlgeschlagen');
    context.current = result?.contextId || context.current;
    const reply = result?.status?.message?.parts?.[0]?.text || result?.artifacts?.[0]?.parts?.[0]?.text;
    if (reply) addMsg('agent', reply);
    await refresh(sid);
  }

  async function start({ ds100, switchNumber, basicForm }) {
    if (busy.current) return;
    busy.current = true;
    setStatus('loading'); setError(null); setMessages([]); context.current = null;
    try {
      const response = await fetch('/wizard/createSession', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ds100, switchNumber, basicForm }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'Session konnte nicht erstellt werden');
      const sid = body.sessionId;
      setSessionId(sid);
      addMsg('katrin', `Weiche ${switchNumber}, Betriebsstelle ${ds100}, ${basicForm}`);
      await converse(`Session-Id: ${sid}\nDie Session ist bereits erstellt. Beginne die Erfassung.`, sid);
    } catch (e) { setError(e.message); setStatus('error'); }
    finally { busy.current = false; }
  }

  async function sendAnswer(text) {
    if (busy.current || status !== 'active') return;
    busy.current = true; setStatus('loading'); setError(null); addMsg('katrin', text);
    try { await converse(text, sessionId); }
    catch (e) { setError(e.message); setStatus('active'); }
    finally { busy.current = false; }
  }

  async function submit() {
    if (busy.current || !sessionId) return;
    busy.current = true; setStatus('submitting'); setError(null);
    try { await submitSession(sessionId); await refresh(sessionId); }
    catch (e) { setError(e.message); setStatus('all-answered'); }
    finally { busy.current = false; }
  }

  async function complete(answers) {
    if (busy.current) return;
    busy.current = true; setCompletionBusy(true);
    try {
      await completeMissingAnswers(sessionId, answers);
      await refresh(sessionId);
    } finally { busy.current = false; setCompletionBusy(false); }
  }

  return { sessionId, messages, tpPreview, currentQuestion, status, error,
    missingQuestions, completionBusy, complete,
    start, sendAnswer, submit, back: () => setStatus('active') };
}