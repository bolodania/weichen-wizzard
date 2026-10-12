import React from 'react';
import { ShellBar, Button, MessageStrip } from '@ui5/webcomponents-react';
import { useApprovalSessions } from './hooks/useApprovalSessions.js';
import { SessionListReport }   from './components/SessionListReport.jsx';
import { SessionObjectPage }   from './components/SessionObjectPage.jsx';

export default function App() {
  const { sessions, selected, loading, error, refreshList, openSession, editAnswer, approve, back } = useApprovalSessions();

  return (
    <>
      <ShellBar
        primaryTitle="TP-Wizard — Freigabe"
        secondaryTitle="DB InfraGO"
      >
        <Button slot="endContent" icon="refresh" onClick={refreshList} />
      </ShellBar>
      {error && (
        <MessageStrip design="Negative" hideCloseButton style={{ margin: '0.5rem 1rem' }}>
          {error}
        </MessageStrip>
      )}
      {!selected
        ? <SessionListReport sessions={sessions} loading={loading} onSelect={openSession} onRefresh={refreshList} />
        : <SessionObjectPage
            selected={selected}
            loading={loading}
            onEdit={editAnswer}
            onApprove={approve}
            onBack={back}
          />
      }
    </>
  );
}
