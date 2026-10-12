import { useState, useCallback } from 'react';
import axios from 'axios';

const BASE = '/wizard';

export function useAgentSession() {
  const [sessionId, setSessionId]   = useState(null);
  const [messages, setMessages]     = useState([]);
  const [tpPreview, setTpPreview]   = useState([]);
  const [pendingQ, setPendingQ]     = useState(null);
  const [status, setStatus]         = useState('idle'); // idle|loading|active|all-answered|submitting|submitted|error
  const [error, setError]           = useState(null);

  const addMsg = (role, text) =>
    setMessages(prev => [...prev, { role, text, id: crypto.randomUUID() }]);

  const start = useCallback(async ({ ds100, switchNumber, basicForm }) => {
    setStatus('loading');
    setError(null);
    try {
      const { data: sess } = await axios.post(`${BASE}/createSession`, { ds100, switchNumber, basicForm });
      const sid = sess.sessionId ?? sess.value?.sessionId;
      setSessionId(sid);

      // Pre-answer the identity questions so getNextQuestion skips them
      await axios.post(`${BASE}/submitAnswer`, { sessionId: sid, questionId: 'ds100',        answer: ds100,       source: 'katrin-confirmed' });
      await axios.post(`${BASE}/submitAnswer`, { sessionId: sid, questionId: 'switchNumber', answer: switchNumber, source: 'katrin-confirmed' });
      await axios.post(`${BASE}/submitAnswer`, { sessionId: sid, questionId: 'basicForm',    answer: basicForm,   source: 'katrin-confirmed' });

      const { data: defaultsResp } = await axios.get(`${BASE}/getSmartDefaults(basicForm='${basicForm}')`);
      const defaultsRaw = defaultsResp.value ?? defaultsResp;
      const defaults = typeof defaultsRaw === 'string' ? JSON.parse(defaultsRaw) : defaultsRaw;

      const highConf = defaults.filter(d => d.confidence === 'high');
      let lastData;
      for (const d of highConf) {
        const { data } = await axios.post(`${BASE}/submitAnswer`, {
          sessionId: sid, questionId: d.questionId, answer: d.defaultAnswer, source: 'agent-default'
        });
        lastData = data;
      }

      // Update TP preview from the last smart-default submission
      if (lastData) {
        const previewRaw = lastData.tpPreview ?? lastData.value?.tpPreview;
        const preview = typeof previewRaw === 'string' ? JSON.parse(previewRaw) : previewRaw;
        if (preview) setTpPreview(preview);
      }

      const medConf = defaults.filter(d => d.confidence === 'medium');
      const lines = [...highConf, ...medConf].map(d => `• ${d.rationale}`).join('\n');
      addMsg('agent',
        `Hallo! Ich habe die Standardkonfiguration für ${basicForm} geladen.\n\n` +
        `Folgende Werte wurden automatisch gesetzt:\n${lines}\n\n` +
        `Gibt es bei dieser Weiche Besonderheiten, die davon abweichen?`
      );

      const { data: nextQResp } = await axios.get(`${BASE}/getNextQuestion(sessionId='${sid}')`);
      const nextQRaw = nextQResp.value ?? nextQResp;
      const nextQ = typeof nextQRaw === 'string' ? JSON.parse(nextQRaw) : nextQRaw;
      if (nextQ) {
        setPendingQ(nextQ);
        addMsg('agent', nextQ.text);
      } else {
        setStatus('all-answered');
        addMsg('agent', 'Alle Fragen wurden beantwortet. Bitte bestätige die Einreichung.');
        return;
      }

      setStatus('active');
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
      setStatus('error');
    }
  }, []);

  const sendAnswer = useCallback(async (text) => {
    if (!pendingQ || !sessionId) return;
    addMsg('katrin', text);

    try {
      const { data } = await axios.post(`${BASE}/submitAnswer`, {
        sessionId,
        questionId: pendingQ.id,
        answer: text.trim(),
        source: 'katrin-confirmed'
      });

      const previewRaw = data.tpPreview ?? data.value?.tpPreview;
      const preview = typeof previewRaw === 'string' ? JSON.parse(previewRaw) : previewRaw;
      if (preview) setTpPreview(preview);

      addMsg('agent', `✓ Verstanden. Bisher ${preview?.length ?? 0} Technische Plätze erkannt.`);

      const nextQRaw = data.nextQuestion ?? data.value?.nextQuestion;
      const nextQ = typeof nextQRaw === 'string' ? JSON.parse(nextQRaw) : nextQRaw;
      if (nextQ) {
        setPendingQ(nextQ);
        addMsg('agent', nextQ.text);
      } else {
        setPendingQ(null);
        setStatus('all-answered');
        addMsg('agent', 'Alle Angaben vollständig. Soll ich die Einreichung zur Freigabe weiterleiten?');
      }
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
    }
  }, [pendingQ, sessionId]);

  const submit = useCallback(async () => {
    setStatus('submitting');
    try {
      await axios.post(`${BASE}/submitSession`, { sessionId });
      addMsg('agent', `Einreichung weitergeleitet. Referenz: ${sessionId}`);
      setStatus('submitted');
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
      setStatus('error');
    }
  }, [sessionId]);

  return { sessionId, messages, tpPreview, status, error, start, sendAnswer, submit, addMsg };
}
