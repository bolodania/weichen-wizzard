import React from 'react';
import { Button, Title, FlexBox } from '@ui5/webcomponents-react';

export function SubmitSummary({ tpCount, sessionId, onConfirm, onBack, submitting }) {
  return (
    <div style={{ padding: '2rem', maxWidth: 480, margin: '0 auto' }}>
      <Title level="H4">Einreichung bestätigen</Title>
      <p style={{ marginTop: '1rem' }}>
        Es werden <strong>{tpCount} Technische Plätze</strong> zur Freigabe an den Technischen Verantwortlichen weitergeleitet.
      </p>
      <p style={{ color: 'var(--sapNeutralColor)', fontSize: 'var(--sapFontSmallSize)' }}>
        Referenz: {sessionId}
      </p>
      <FlexBox style={{ gap: '1rem', marginTop: '2rem' }}>
        <Button design="Emphasized" onClick={onConfirm} disabled={submitting}>
          {submitting ? 'Wird eingereicht...' : 'Zur Freigabe einreichen'}
        </Button>
        <Button onClick={onBack} disabled={submitting}>Zurück</Button>
      </FlexBox>
    </div>
  );
}
