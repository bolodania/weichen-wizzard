import React, { useState } from 'react';
import {
  Button, Card, CardHeader,
  Form, FormGroup, FormItem,
  Input, Select, Option, Label, MessageStrip,
  IllustratedMessage
} from '@ui5/webcomponents-react';
import { useAgentSession } from './hooks/useAgentSession.js';
import { ChatThread }     from './components/ChatThread.jsx';
import { MessageInput }   from './components/MessageInput.jsx';
import { TPPreviewSheet } from './components/TPPreviewSheet.jsx';
import { SubmitSummary }  from './components/SubmitSummary.jsx';
import { LocationValueHelp } from './components/LocationValueHelp.jsx';

function AppHeader({ title, subtitle }) {
  return (
    <div style={{
      background: 'var(--sapShellColor, #354a5e)',
      color: 'var(--sapShell_TextColor, #fff)',
      padding: '0 1rem',
      height: '2.75rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      flexShrink: 0,
    }}>
      <span style={{ fontWeight: 700, fontSize: 'var(--sapFontSize)' }}>{title}</span>
      {subtitle && (
        <>
          <span style={{ opacity: 0.6 }}>·</span>
          <span style={{ fontSize: 'var(--sapFontSmallSize)', opacity: 0.85 }}>{subtitle}</span>
        </>
      )}
    </div>
  );
}

const BASIC_FORMS = [
  { value: 'EWR', label: 'Einfache Weiche rechts' },
  { value: 'EWL', label: 'Einfache Weiche links (kein Regelwerk)' },
  { value: 'DKW', label: 'Doppelte Kreuzungsweiche (kein Regelwerk)' },
  { value: 'EKW', label: 'Einfache Kreuzungsweiche (kein Regelwerk)' },
  { value: 'IBW', label: 'Innenbogenweiche (kein Regelwerk)' },
  { value: 'DW',  label: 'Dreiwegweiche (kein Regelwerk)' },
  { value: 'ABW', label: 'Außenbogenweiche (kein Regelwerk)' },
];

export default function App() {
  const { sessionId, messages, tpPreview, currentQuestion, status, error, start, sendAnswer, submit, back } = useAgentSession();
  const [ds100, setDs100]         = useState('');
  const [switchNum, setSwitchNum] = useState('');
  const [basicForm, setBasicForm] = useState('EWR');

  if (status === 'idle' || status === 'error') {
    return (
      <>
        <AppHeader title="TP-Wizard" subtitle="Felderfassung — Neue Weiche erfassen" />
        <div style={{ padding: '1.5rem 1rem' }}>
        <Card
          header={<CardHeader titleText="Neue Weiche erfassen" />}
          style={{ maxWidth: 480, margin: '0 auto' }}
        >
          {error && (
            <MessageStrip design="Negative" hideCloseButton style={{ margin: '1rem 1rem 0' }}>
              {error}
            </MessageStrip>
          )}
          <Form
            columnsXL={1} columnsL={1} columnsM={1}
            labelSpanXL={4} labelSpanL={4} labelSpanM={4}
            style={{ padding: '1rem' }}
          >
            <FormGroup headerText="Standort & Typ">
              <FormItem label={<Label required showColon>Betriebsstelle (DS100)</Label>}>
                <LocationValueHelp value={ds100} onSelect={setDs100} />
              </FormItem>
              <FormItem label={<Label required showColon>Weichennummer</Label>}>
                <Input placeholder="z.B. 2006" value={switchNum} maxlength={7}
                  accessibleName="Weichennummer (nur Ziffern)"
                  onInput={e => {
                    const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 7);
                    e.target.value = digits;
                    setSwitchNum(digits);
                  }} />
              </FormItem>
              <FormItem label={<Label required showColon>Grundbauform</Label>}>
                <Select onChange={e => setBasicForm(e.detail.selectedOption.getAttribute('data-value'))}>
                  {BASIC_FORMS.map(bf => (
                    <Option key={bf.value} data-value={bf.value} disabled={bf.value !== 'EWR'}>{bf.label}</Option>
                  ))}
                </Select>
              </FormItem>
            </FormGroup>
          </Form>
          <div style={{ padding: '0 1rem 1.5rem' }}>
            <Button
              design="Emphasized"
              disabled={!ds100 || !/^\d{1,7}$/.test(switchNum)}
              style={{ width: '100%' }}
              onClick={() => start({ ds100, switchNumber: switchNum, basicForm })}
            >
              Erfassung starten
            </Button>
          </div>
        </Card>
        </div>
      </>
    );
  }

  if (status === 'submitted') {
    return (
      <>
        <AppHeader title="TP-Wizard" subtitle="Felderfassung" />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100vh - 2.75rem)',
          padding: '2rem'
        }}>
          <IllustratedMessage
            name="SuccessScreen"
            titleText="Einreichung weitergeleitet"
            subtitleText={`Referenz: ${sessionId} — Der Technische Verantwortliche prüft und gibt frei.`}
          />
          <Button style={{ marginTop: '1.5rem' }} onClick={() => window.location.reload()}>
            Neue Weiche erfassen
          </Button>
        </div>
      </>
    );
  }

  const showSubmitSummary = ['all-answered', 'submitting'].includes(status);

  return (
    <>
      <AppHeader title={`TP-Wizard — ${ds100 || ''} W${switchNum || ''}`} subtitle="Felderfassung" />
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 2.75rem)' }}>
        {error && (
          <MessageStrip design="Negative" hideCloseButton style={{ margin: '0.5rem 1rem 0' }}>
            {error}
          </MessageStrip>
        )}
        {showSubmitSummary
          ? <SubmitSummary
              tpCount={tpPreview.length}
              sessionId={sessionId}
              onConfirm={submit}
              onBack={back}
              submitting={status === 'submitting'}
            />
          : <>
              <ChatThread messages={messages} awaitingResponse={status === 'loading'} currentQuestion={currentQuestion} onChoiceClick={sendAnswer} />
              <TPPreviewSheet tps={tpPreview} />
              <MessageInput onSend={sendAnswer} disabled={status !== 'active'} />
            </>
        }
      </div>
    </>
  );
}
