import React, { useState } from 'react';
import {
  ShellBar, Button, Title, FlexBox, Card, CardHeader,
  Input, Select, Option, Label, MessageBox, BusyIndicator
} from '@ui5/webcomponents-react';
import { NavigationTree } from './components/NavigationTree.jsx';
import { QuestionRenderer } from './components/QuestionRenderer.jsx';
import { TPPreview } from './components/TPPreview.jsx';
import { useWizardSession } from './hooks/useWizardSession.js';

const BASIC_FORMS = [
  { value: 'EWL', label: 'Einfache Weiche links' },
  { value: 'EWR', label: 'Einfache Weiche rechts' },
  { value: 'DKW', label: 'Doppelte Kreuzungsweiche' },
  { value: 'EKW', label: 'Einfache Kreuzungsweiche' },
  { value: 'IBW', label: 'Innenbogenweiche' },
  { value: 'DW',  label: 'Dreiwegweiche' },
  { value: 'ABW', label: 'Außenbogenweiche' }
];

export default function App() {
  const {
    sessionId, currentQuestion, tpPreview,
    status, result, error,
    createSession, submitAnswer, confirmSession, exportCSV
  } = useWizardSession();

  const [ds100, setDs100]         = useState('');
  const [switchNum, setSwitchNum] = useState('');
  const [basicForm, setBasicForm] = useState('EWL');
  const [completedAreas, setCompletedAreas] = useState([]);

  const handleAnswer = (questionId, answer) => {
    if (currentQuestion) {
      setCompletedAreas(prev => 
        prev.includes(currentQuestion.area) ? prev : [...prev, currentQuestion.area]
      );
    }
    submitAnswer(questionId, answer);
  };

  // ── Start screen ────────────────────────────────────────────────────────
  const StartScreen = () => (
    <Card header={<CardHeader titleText="Neue Weiche anlegen" />} style={{ maxWidth: 500, margin: '2rem auto' }}>
      <FlexBox direction="Column" style={{ padding: '1.5rem', gap: '1rem' }}>
        <Label required>Betriebsstelle (DS100)</Label>
        <Input
          placeholder="z.B. NI"
          value={ds100}
          onInput={e => setDs100(e.target.value)}
          maxlength={10}
        />
        <Label required>Weichennummer</Label>
        <Input
          placeholder="z.B. 2006"
          value={switchNum}
          onInput={e => setSwitchNum(e.target.value)}
          maxlength={10}
        />
        <Label required>Grundbauform</Label>
        <Select onChange={e => setBasicForm(e.detail.selectedOption.getAttribute('data-value'))}>
          {BASIC_FORMS.map(bf => (
            <Option key={bf.value} data-value={bf.value}>{bf.label}</Option>
          ))}
        </Select>
        <Button
          design="Emphasized"
          disabled={!ds100 || !switchNum}
          onClick={() => createSession({ ds100, switchNumber: switchNum, basicForm })}
        >
          Wizard starten
        </Button>
      </FlexBox>
    </Card>
  );

  // ── Wizard screen (3-panel) ──────────────────────────────────────────────
  const WizardScreen = () => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '220px 1fr 320px',
      gridTemplateRows: 'calc(100vh - 60px)',
      gap: '0',
      height: 'calc(100vh - 60px)'
    }}>
      {/* Left: Navigation */}
      <div style={{ borderRight: '1px solid #e0e0e0', padding: '0.5rem', background: '#fafafa' }}>
        <Title level="H6" style={{ padding: '0.5rem' }}>Bereiche</Title>
        <NavigationTree
          currentArea={currentQuestion?.area}
          completedAreas={completedAreas}
        />
      </div>

      {/* Centre: Question */}
      <div style={{ padding: '2rem', overflowY: 'auto' }}>
        {status === 'active' && currentQuestion && (
          <Card header={<CardHeader titleText={currentQuestion.areaName || 'Frage'} />}>
            <div style={{ padding: '1.5rem' }}>
              <QuestionRenderer question={currentQuestion} onAnswer={handleAnswer} />
            </div>
          </Card>
        )}

        {status === 'confirmed' && (
          <Card header={<CardHeader titleText="Zusammenfassung" />}>
            <div style={{ padding: '1.5rem' }}>
              <Title level="H5">Alle Fragen beantwortet</Title>
              <p>{tpPreview.length} Technische Plätze werden angelegt.</p>
              <FlexBox style={{ gap: '1rem', marginTop: '1rem' }}>
                <Button design="Emphasized" onClick={confirmSession}>
                  TPs in SAP anlegen
                </Button>
                <Button onClick={exportCSV}>
                  Als CSV exportieren
                </Button>
              </FlexBox>
            </div>
          </Card>
        )}

        {status === 'creating' && (
          <FlexBox justifyContent="Center" style={{ padding: '4rem' }}>
            <BusyIndicator active size="L" text="TPs werden in SAP angelegt..." />
          </FlexBox>
        )}

        {status === 'created' && result && (
          <Card header={<CardHeader titleText="Ergebnis" />}>
            <div style={{ padding: '1.5rem' }}>
              <Title level="H5" style={{ color: result.failed.length === 0 ? 'green' : 'orange' }}>
                {result.failed.length === 0
                  ? `✅ ${result.created.length} TPs erfolgreich angelegt`
                  : `⚠️ ${result.created.length} angelegt, ${result.failed.length} fehlgeschlagen`}
              </Title>
              {result.failed.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <Button onClick={exportCSV}>CSV-Export (Fallback)</Button>
                </div>
              )}
            </div>
          </Card>
        )}

        {error && (
          <MessageBox type="Error" open onClose={() => {}}>
            {error}
          </MessageBox>
        )}
      </div>

      {/* Right: TP Preview */}
      <div style={{ borderLeft: '1px solid #e0e0e0', padding: '0.5rem', background: '#f8f8f8' }}>
        <TPPreview tps={tpPreview} />
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: 'var(--sapFontFamily, "72", "72full", Arial, Helvetica, sans-serif)' }}>
      <ShellBar
        primaryTitle="TP-Wizard Weiche"
        secondaryTitle="DB InfraGO — Technische Plätze anlegen"
        style={{ position: 'sticky', top: 0, zIndex: 100 }}
      />

      {(status === 'idle' || status === 'error') && <StartScreen />}
      {(['active', 'confirmed', 'creating', 'created'].includes(status)) && <WizardScreen />}
    </div>
  );
}
