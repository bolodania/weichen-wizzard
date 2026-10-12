import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';

const BASE = '/wizard';

function parseJson(raw) {
  if (typeof raw === 'string') return JSON.parse(raw);
  if (raw?.value !== undefined) return parseJson(raw.value);
  return raw;
}

export function useApprovalSessions() {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null); // { sessionId, hints, tpPreview, answers, ... }
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${BASE}/listPendingSessions()`);
      setSessions(parseJson(data));
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  const openSession = useCallback(async (sessionId) => {
    setLoading(true);
    try {
      const [hintsResp, previewResp, sessResp] = await Promise.all([
        axios.get(`${BASE}/getOpenHints(sessionId='${sessionId}')`),
        axios.get(`${BASE}/getTPPreview(sessionId='${sessionId}')`),
        axios.get(`${BASE}/Sessions('${sessionId}')`)
      ]);

      const hints   = parseJson(hintsResp.data);
      const preview = parseJson(previewResp.data);
      const sessData = sessResp.data;
      const answersRaw = JSON.parse(sessData.answersJson || '[]');

      // Enrich answers with question text and area from hints
      const hintMap = {};
      for (const h of hints) hintMap[h.questionId] = h;
      const answers = answersRaw.map(a => ({
        ...a,
        questionText: hintMap[a.questionId]?.questionText || a.questionId,
        area:         hintMap[a.questionId]?.area || 0,
        areaName:     hintMap[a.questionId]?.areaName || '',
      }));

      setSelected({
        sessionId,
        hints,
        tpPreview: preview,
        answers,
        status:         sessData.status,
        ds100:          sessData.ds100,
        switchNumber:   sessData.switchNumber,
        basicFormLabel: sessData.basicForm,
      });
    } catch (e) {
      setError(e.response?.data?.error?.message ?? e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const editAnswer = useCallback(async (sessionId, questionId, answer) => {
    await axios.post(`${BASE}/editAnswer`, { sessionId, questionId, answer, source: 'thomas-edited' });
    await openSession(sessionId);
  }, [openSession]);

  const approve = useCallback(async (sessionId) => {
    const { data } = await axios.post(`${BASE}/approveSession`, { sessionId });
    await refreshList();
    setSelected(null);
    return data;
  }, [refreshList]);

  return {
    sessions,
    selected,
    loading,
    error,
    refreshList,
    openSession,
    editAnswer,
    approve,
    back: () => setSelected(null),
  };
}
