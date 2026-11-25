import React, { useState } from 'react';
import {
  ShellBar, Button, Card, CardHeader,
  Form, FormGroup, FormItem,
  Input, Select, Option, Label, MessageStrip,
  IllustratedMessage
} from '@ui5/webcomponents-react';
import { useAgentSession } from './hooks/useAgentSession.js';
import { ChatThread }     from './components/ChatThread.jsx';
import { MessageInput }   from './components/MessageInput.jsx';
import { TPPreviewSheet } from './components/TPPreviewSheet.jsx';
import { SubmitSummary }  from './components/SubmitSummary.jsx';

const BASIC_FORMS = [
  { value: 'EWL', label: 'Einfache Weiche links' },
  { value: 'EWR', label: 'Einfache Weiche rechts' },
  { value: 'DKW', label: 'Doppelte Kreuzungsweiche' },
  { value: 'EKW', label: 'Einfache Kreuzungsweiche' },
  { value: 'IBW', label: 'Innenbogenweiche' },
  { value: 'DW',  label: 'Dreiwegweiche' },
  { value: 'ABW', label: 'Außenbogenweiche' },
];

export default function App() {
  const { sessionId, messages, tpPreview, status, error, start, sendAnswer, submit } = useAgentSession();
  const [ds100, setDs100]         = useState('');
  const [switchNum, setSwitchNum] = useState('');
  const [basicForm, setBasicForm] = useState('EWL');

  if (status === 'idle' || status === 'error') {
    return (
      <>
        <ShellBar primaryTitle="TP-Wizard" secondaryTitle="Felderfassung" />
        <Card
          header={<CardHeader titleText="Neue Weiche erfassen" />}
          style={{ maxWidth: 480, margin: '2rem auto' }}
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
                <Input placeholder="z.B. NI" value={ds100} onInput={e => setDs100(e.target.value)} />
              </FormItem>
              <FormItem label={<Label required showColon>Weichennummer</Label>}>
                <Input placeholder="z.B. 2006" value={switchNum} onInput={e => setSwitchNum(e.target.value)} />
              </FormItem>
              <FormItem label={<Label required showColon>Grundbauform</Label>}>
                <Select onChange={e => setBasicForm(e.detail.selectedOption.getAttribute('data-value'))}>
                  {BASIC_FORMS.map(bf => (
                    <Option key={bf.value} data-value={bf.value}>{bf.label}</Option>
                  ))}
                </Select>
              </FormItem>
            </FormGroup>
          </Form>
          <div style={{ padding: '0 1rem 1.5rem' }}>
            <Button
              design="Emphasized"
              disabled={!ds100 || !switchNum}
              style={{ width: '100%' }}
              onClick={() => start({ ds100, switchNumber: switchNum, basicForm })}
            >
              Erfassung starten
            </Button>
          </div>
        </Card>
      </>
    );
  }

  if (status === 'submitted') {
    return (
      <>
        <ShellBar primaryTitle="TP-Wizard" secondaryTitle="Felderfassung" />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100vh - 44px)',
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

  const showSubmitSummary = status === 'all-answered';

  return (
    <>
      <ShellBar primaryTitle={`TP-Wizard — ${ds100 || ''} W${switchNum || ''}`} secondaryTitle="Felderfassung" />
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 44px)' }}>
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
              onBack={() => { /* handled by hook — go back to active to allow more answers */ }}
              submitting={status === 'submitting'}
            />
          : <>
              <ChatThread messages={messages} awaitingResponse={status === 'loading'} />
              <TPPreviewSheet tps={tpPreview} />
              <MessageInput onSend={sendAnswer} disabled={status !== 'active'} />
            </>
        }
      </div>
    </>
  );
}
