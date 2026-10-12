import React from 'react';
import { MessageStrip } from '@ui5/webcomponents-react';

export function WarningStrip({ hints }) {
  if (!hints || hints.length === 0) return null;
  const labels = hints.slice(0, 3).map(h => h.questionId).join(', ');
  const more   = hints.length > 3 ? ` (+${hints.length - 3} weitere)` : '';
  return (
    <MessageStrip design="Warning" style={{ margin: '1rem' }}>
      <strong>⚠ {hints.length} Agentannahmen nicht geprüft</strong> — {labels}{more}.
      Bitte prüfen bevor du freigibst.
    </MessageStrip>
  );
}
