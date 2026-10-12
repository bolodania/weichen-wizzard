import { useState, useCallback } from 'react';
import axios from 'axios';

const API = '/wizard';

export function useWizardSession() {
  const [sessionId, setSessionId]         = useState(null);
  const [currentQuestion, setCurrentQ]    = useState(null);
  const [tpPreview, setTPPreview]         = useState([]);
  const [status, setStatus]               = useState('idle'); // idle | active | confirmed | created | error
  const [result, setResult]               = useState(null);
  const [error, setError]                 = useState(null);

  const createSession = useCallback(async ({ ds100, switchNumber, basicForm }) => {
    try {
      setStatus('active');
      setError(null);
      const res = await axios.post(`${API}/createSession`, { ds100, switchNumber, basicForm });
      const sid = res.data.value?.sessionId || res.data.sessionId;
      setSessionId(sid);
      // Fetch first question
      const qRes = await axios.get(`${API}/getNextQuestion(sessionId='${sid}')`);
      const q = JSON.parse(qRes.data.value || qRes.data);
      setCurrentQ(q);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
      setStatus('error');
    }
  }, []);

  const submitAnswer = useCallback(async (questionId, answer) => {
    if (!sessionId) return;
    try {
      const answerStr = typeof answer === 'object' ? JSON.stringify(answer) : String(answer);
      const res = await axios.post(`${API}/submitAnswer`, { sessionId, questionId, answer: answerStr });
      const data = res.data.value || res.data;
      const nextQ = JSON.parse(data.nextQuestion || 'null');
      const preview = JSON.parse(data.tpPreview || '[]');
      setCurrentQ(nextQ);
      setTPPreview(preview);
      if (!nextQ) setStatus('confirmed');
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    }
  }, [sessionId]);

  const confirmSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      setStatus('creating');
      const res = await axios.post(`${API}/confirmSession`, { sessionId });
      const data = res.data.value || res.data;
      setResult({
        created: JSON.parse(data.created || '[]'),
        failed:  JSON.parse(data.failed || '[]'),
        openFields: JSON.parse(data.openFields || '[]')
      });
      setStatus('created');
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
      setStatus('error');
    }
  }, [sessionId]);

  const exportCSV = useCallback(async () => {
    if (!sessionId) return;
    const res = await axios.get(`${API}/exportSessionCSV(sessionId='${sessionId}')`);
    const csv = res.data.value || res.data;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weiche-${sessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessionId]);

  return {
    sessionId, currentQuestion, tpPreview,
    status, result, error,
    createSession, submitAnswer, confirmSession, exportCSV
  };
}
