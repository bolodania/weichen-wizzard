import React, { useState } from 'react';
import { Title, Input, Button, ObjectStatus, FlexBox, Text } from '@ui5/webcomponents-react';

const SOURCE_STATE = {
  auto:               'None',
  'agent-default':    'Critical',
  'katrin-confirmed': 'Positive',
  'katrin-corrected': 'Information',
  'thomas-edited':    'None',
};
const SOURCE_LABEL = {
  auto:               'AUTO',
  'agent-default':    'AGENT-STANDARD',
  'katrin-confirmed': 'BESTÄTIGT',
  'katrin-corrected': 'KORRIGIERT',
  'thomas-edited':    'THOMAS',
};

function AnswerRow({ answer, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(answer.answer ?? '');
  const highlight = answer.source === 'agent-default';

  const save = () => { onEdit(answer.questionId, val); setEditing(false); };

  return (
    <FlexBox alignItems="Center" style={{
      padding: '0.4rem 1rem',
      borderLeft: highlight ? '3px solid var(--sapCriticalColor)' : '3px solid transparent',
      background: highlight ? 'var(--sapCriticalBackground)' : 'var(--sapBaseColor)',
      borderBottom: '1px solid var(--sapGroup_TitleBorderColor)',
      gap: '0.5rem'
    }}>
      <Text style={{ flex: 2, fontSize: 'var(--sapFontSmallSize)', color: 'var(--sapTextColor)' }}>
        {answer.questionText || answer.questionId}
      </Text>
      {editing
        ? <>
            <Input value={val} onInput={e => setVal(e.target.value)} style={{ flex: 1 }} />
            <Button design="Emphasized" onClick={save}>Speichern</Button>
            <Button onClick={() => setEditing(false)}>Abbrechen</Button>
          </>
        : <>
            <Text style={{ flex: 1, fontSize: 'var(--sapFontSmallSize)', fontWeight: 'bold', color: 'var(--sapTextColor)' }}>
              {answer.answer ?? '—'}
            </Text>
            <ObjectStatus
              state={SOURCE_STATE[answer.source] ?? 'None'}
              inverted
              style={{ fontSize: 'var(--sapFontSmallSize)' }}
            >
              {SOURCE_LABEL[answer.source] ?? answer.source}
            </ObjectStatus>
            <Button icon="edit" design="Transparent" onClick={() => setEditing(true)} />
          </>
      }
    </FlexBox>
  );
}

export function AnswerSection({ session, onEdit }) {
  if (!session?.answers) return null;
  return (
    <div style={{ marginTop: '1rem' }}>
      <Title level="H5" style={{ padding: '0 1rem' }}>Antworten</Title>
      {session.answers.map(a => (
        <AnswerRow key={a.questionId} answer={a} onEdit={(qId, val) => onEdit(session.sessionId, qId, val)} />
      ))}
    </div>
  );
}
