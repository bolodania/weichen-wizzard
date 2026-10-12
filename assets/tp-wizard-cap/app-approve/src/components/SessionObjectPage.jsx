import React, { useState } from 'react';
import {
  ObjectPage, ObjectPageTitle, ObjectPageHeader,
  ObjectPageSection, ObjectPageSubSection,
  Button, Title, FlexBox, ObjectStatus,
  BusyIndicator, MessageStrip
} from '@ui5/webcomponents-react';
import { WarningStrip }     from './WarningStrip.jsx';
import { AnswerSection }    from './AnswerSection.jsx';
import { TPPreviewSection } from './TPPreviewSection.jsx';
import { ApproveDialog }    from './ApproveDialog.jsx';

const STATUS_STATE = {
  submitted: 'Information',
  editing:   'Critical',
  approved:  'Positive',
  created:   'Positive',
  failed:    'Negative',
};
const STATUS_LABEL_DE = {
  submitted: 'Eingereicht',
  editing:   'In Bearbeitung',
  approved:  'Freigegeben',
  created:   'Angelegt',
  failed:    'Fehlgeschlagen',
};

export function SessionObjectPage({ selected, onEdit, onApprove, onBack, loading }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [approving, setApproving]   = useState(false);
  const [result, setResult]         = useState(null);

  if (loading || !selected) {
    return <BusyIndicator active size="L" style={{ margin: '4rem auto', display: 'block' }} />;
  }

  const { sessionId, hints, tpPreview, answers, status, ds100, switchNumber, basicFormLabel } = selected;
  const unconfirmedCount = hints?.length ?? 0;

  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await onApprove(sessionId);
      setResult(res);
      setDialogOpen(false);
    } finally {
      setApproving(false);
    }
  };

  if (result) {
    const created = JSON.parse(result.created || '[]');
    const failed  = JSON.parse(result.failed  || '[]');
    return (
      <div style={{ padding: '2rem' }}>
        <MessageStrip design={failed.length === 0 ? 'Positive' : 'Warning'}>
          {failed.length === 0
            ? `${created.length} Technische Plätze erfolgreich angelegt.`
            : `${created.length} angelegt, ${failed.length} fehlgeschlagen.`}
        </MessageStrip>
        <Button style={{ marginTop: '1rem' }} onClick={onBack}>Zurück zur Liste</Button>
      </div>
    );
  }

  return (
    <>
      <ObjectPage
        titleArea={
          <ObjectPageTitle
            header={<Title level="H3">{ds100} W{switchNumber} — {basicFormLabel}</Title>}
            subHeader={
              <FlexBox style={{ gap: '0.5rem', alignItems: 'center' }}>
                {status && (
                  <ObjectStatus state={STATUS_STATE[status] ?? 'None'} inverted>
                    {STATUS_LABEL_DE[status] ?? status}
                  </ObjectStatus>
                )}
                {unconfirmedCount > 0 && (
                  <ObjectStatus state="Critical" inverted>
                    {unconfirmedCount} Agentannahmen
                  </ObjectStatus>
                )}
              </FlexBox>
            }
            actionsBar={
              <FlexBox style={{ gap: '0.5rem' }}>
                <Button design="Transparent" onClick={onBack}>Abbrechen</Button>
                <Button
                  design="Emphasized"
                  onClick={() => setDialogOpen(true)}
                  disabled={approving}
                >
                  Freigeben
                </Button>
              </FlexBox>
            }
          />
        }
        headerArea={
          <ObjectPageHeader>
            <FlexBox style={{ gap: '2rem', padding: '0.5rem 0', flexWrap: 'wrap' }}>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Title level="H6" style={{ color: 'var(--sapNeutralColor)' }}>Betriebsstelle</Title>
                <Title level="H5">{ds100}</Title>
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Title level="H6" style={{ color: 'var(--sapNeutralColor)' }}>Weichennummer</Title>
                <Title level="H5">{switchNumber}</Title>
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Title level="H6" style={{ color: 'var(--sapNeutralColor)' }}>Grundbauform</Title>
                <Title level="H5">{basicFormLabel}</Title>
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Title level="H6" style={{ color: 'var(--sapNeutralColor)' }}>Technische Plätze</Title>
                <Title level="H5">{tpPreview?.length ?? 0}</Title>
              </FlexBox>
            </FlexBox>
          </ObjectPageHeader>
        }
      >
        {unconfirmedCount > 0 && (
          <ObjectPageSection id="hinweise" titleText="Hinweise">
            <ObjectPageSubSection id="hinweise-detail" titleText="">
              <WarningStrip hints={hints} />
            </ObjectPageSubSection>
          </ObjectPageSection>
        )}

        <ObjectPageSection id="antworten" titleText="Antworten">
          <ObjectPageSubSection id="antworten-detail" titleText="">
            <AnswerSection session={{ sessionId, answers }} onEdit={onEdit} />
          </ObjectPageSubSection>
        </ObjectPageSection>

        <ObjectPageSection id="tp-vorschau" titleText={`TP-Vorschau (${tpPreview?.length ?? 0})`}>
          <ObjectPageSubSection id="tp-list" titleText="">
            <TPPreviewSection tps={tpPreview} />
          </ObjectPageSubSection>
        </ObjectPageSection>
      </ObjectPage>

      <ApproveDialog
        open={dialogOpen}
        tpCount={tpPreview?.length ?? 0}
        unconfirmedCount={unconfirmedCount}
        onConfirm={handleApprove}
        onCancel={() => setDialogOpen(false)}
        approving={approving}
      />
    </>
  );
}
