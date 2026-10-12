import React from 'react';
import { Dialog, Button, Title, Bar, MessageStrip } from '@ui5/webcomponents-react';

export function ApproveDialog({ open, tpCount, unconfirmedCount, onConfirm, onCancel, approving }) {
  return (
    <Dialog open={open} header={<Bar><Title>Freigabe bestätigen</Title></Bar>}
            footer={
              <Bar endContent={
                <>
                  <Button onClick={onCancel} disabled={approving}>Abbrechen</Button>
                  <Button design="Emphasized" onClick={onConfirm} disabled={approving}>
                    {approving ? 'Wird freigegeben...' : 'Freigeben'}
                  </Button>
                </>
              } />
            }>
      <div style={{ padding: '1rem', maxWidth: 400 }}>
        <p><strong>{tpCount} Technische Plätze</strong> werden in SAP S/4HANA angelegt.</p>
        {unconfirmedCount > 0 && (
          <MessageStrip design="Warning" hideCloseButton style={{ marginTop: '0.5rem' }}>
            Davon basieren <strong>{unconfirmedCount} Einträge</strong> auf Agentannahmen, die nicht explizit von Katrin bestätigt wurden.
          </MessageStrip>
        )}
        <MessageStrip design="Information" hideCloseButton style={{ marginTop: '1rem' }}>
          Diese Aktion kann nicht rückgängig gemacht werden.
        </MessageStrip>
      </div>
    </Dialog>
  );
}
