import React, { useEffect, useRef, useState } from 'react';
import { FlexBox, Avatar, BusyIndicator, Button } from '@ui5/webcomponents-react';

function parseBulletItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^[-•]\s+(.+)$/);
    if (!m) continue;
    const full = m[1].replace(/\*\*/g, '').trim();
    const sepIdx = full.indexOf(' — ');
    const value = sepIdx !== -1 ? full.slice(0, sepIdx).trim() : full;
    items.push({ value, label: full });
  }
  return items;
}

// Beispiele aus "z. B. a, b, c" im Agententext ziehen (für freie Zahl-/Text-Felder).
function extractExamples(text) {
  if (!text) return [];
  const m = text.match(/z\.?\s*b\.?\s*:?\s*([^)?]*)/i);
  if (!m) return [];
  const bad = /(leer|lassen|bekannt|andere|zahl|beliebig)/i;
  return m[1]
    .split(/,|\boder\b/i)
    .map(s => s.replace(/\.$/, '').trim())
    .filter(v => v && v.length <= 20 && !bad.test(v))
    .slice(0, 8);
}

// Fallback-Heuristik, falls keine strukturierte Frage vorliegt (z. B. Zusammenfassung).
function detectInputMode(text) {
  const items = parseBulletItems(text);
  if (items.length >= 2 && items.length <= 8) return { type: 'choices', items };
  const lower = text.toLowerCase();
  if (lower.includes('ja/nein') || lower.includes('ja oder nein')) return { type: 'yesno' };
  if (/wie viele?\b/i.test(text) || lower.includes('anzahl')) return { type: 'number' };
  if (/^(ist |sind |hat |haben |gibt es )/im.test(text) && text.trim().endsWith('?')) return { type: 'yesno' };
  return null;
}

// Antwortmodus bevorzugt aus der strukturierten Frage (answerType/options aus dem Katalog).
function answerMode(question, agentText) {
  if (question && question.answerType) {
    switch (question.answerType) {
      case 'JaNein': return { type: 'yesno' };
      case 'Auswahl': return question.options?.length ? { type: 'choices', items: question.options } : null;
      case 'Einbauorte': return question.options?.length ? { type: 'multi', items: question.options } : null;
      case 'Menge': return { type: 'number' };
      case 'Zahl':
      case 'Text': {
        const ex = extractExamples(agentText);
        return ex.length ? { type: 'choices', items: ex } : null;
      }
      default: return null;
    }
  }
  return detectInputMode(agentText);
}

function asItem(it) {
  return typeof it === 'string' ? { value: it, label: it } : it;
}

const SMALL = { fontSize: 'var(--sapFontSmallSize)' };

// Mehrfachauswahl für Einbauorte: Chips umschalten, dann Auswahl senden.
function MultiSelect({ options, onSubmit }) {
  const [sel, setSel] = useState([]);
  const toggle = (o) => setSel(s => s.includes(o) ? s.filter(x => x !== o) : [...s, o]);
  return (
    <div style={{ marginTop: '0.375rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
        {options.map(o => (
          <Button key={o} design={sel.includes(o) ? 'Emphasized' : 'Default'} style={SMALL} onClick={() => toggle(o)}>
            {o}
          </Button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.375rem' }}>
        <Button design="Transparent" style={SMALL} onClick={() => onSubmit('keine')}>Keine</Button>
        <Button design="Emphasized" style={SMALL} disabled={!sel.length} onClick={() => onSubmit(sel.join(';'))}>
          Übernehmen{sel.length ? ` (${sel.length})` : ''}
        </Button>
      </div>
    </div>
  );
}

function AnswerControls({ mode, questionId, onChoiceClick }) {
  if (!mode) return null;

  if (mode.type === 'choices') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.375rem' }}>
        {mode.items.map(asItem).map(c => (
          <Button key={c.value} design="Default" style={SMALL} onClick={() => onChoiceClick(c.value)}>
            {c.label}
          </Button>
        ))}
      </div>
    );
  }

  if (mode.type === 'yesno') {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.375rem' }}>
        <Button design="Positive" onClick={() => onChoiceClick('Ja')}>Ja</Button>
        <Button design="Negative" onClick={() => onChoiceClick('Nein')}>Nein</Button>
      </div>
    );
  }

  if (mode.type === 'number') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.375rem' }}>
        {Array.from({ length: 11 }, (_, i) => (
          <Button key={i} design="Default" style={{ ...SMALL, minWidth: '2.25rem' }} onClick={() => onChoiceClick(String(i))}>
            {i}
          </Button>
        ))}
      </div>
    );
  }

  if (mode.type === 'multi') {
    return <MultiSelect key={questionId} options={mode.items} onSubmit={onChoiceClick} />;
  }

  return null;
}

function renderMarkdown(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*?<\/li>(?:\n<li>.*?<\/li>)*)/g, match => `<ul>${match.replace(/\n/g, '')}</ul>`)
    .replace(/\n/g, '<br>');
}

export function ChatThread({ messages, awaitingResponse, currentQuestion, onChoiceClick }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, awaitingResponse]);

  const lastAgentIdx = !awaitingResponse
    ? messages.reduce((acc, m, i) => (m.role === 'agent' ? i : acc), -1)
    : -1;

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '0.5rem 0.75rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.375rem',
      background: 'var(--sapBackgroundColor)'
    }}>
      {messages.map((msg, idx) =>
        msg.role === 'agent' ? (
          <FlexBox key={msg.id} alignItems="FlexStart" style={{ gap: '0.375rem' }}>
            <Avatar initials="AI" colorScheme="Accent6" size="XS" shape="Circle" style={{ flexShrink: 0 }} />
            <div style={{ maxWidth: '85%' }}>
              <div style={{
                background: 'var(--sapNeutralBackground)',
                border: '1px solid var(--sapNeutralBorderColor)',
                borderRadius: '0 0.375rem 0.375rem 0.375rem',
                padding: '0.4rem 0.625rem',
                fontSize: 'var(--sapFontSize)',
                lineHeight: 1.45,
              }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
              />
              {idx === lastAgentIdx && onChoiceClick && (
                <AnswerControls
                  mode={answerMode(currentQuestion, msg.text)}
                  questionId={currentQuestion?.id}
                  onChoiceClick={onChoiceClick}
                />
              )}
            </div>
          </FlexBox>
        ) : (
          <FlexBox key={msg.id} justifyContent="FlexEnd">
            <div style={{
              background: 'var(--sapHighlightColor)',
              borderRadius: '0.375rem 0 0.375rem 0.375rem',
              padding: '0.4rem 0.625rem',
              maxWidth: '80%'
            }}>
              <span style={{
                fontSize: 'var(--sapFontSize)',
                color: 'var(--sapButton_Emphasized_TextColor)'
              }}>
                {msg.text}
              </span>
            </div>
          </FlexBox>
        )
      )}
      {awaitingResponse && (
        <FlexBox alignItems="FlexStart" style={{ gap: '0.375rem' }}>
          <Avatar initials="AI" colorScheme="Accent6" size="XS" shape="Circle" style={{ flexShrink: 0 }} />
          <div style={{
            background: 'var(--sapNeutralBackground)',
            border: '1px solid var(--sapNeutralBorderColor)',
            borderRadius: '0 0.375rem 0.375rem 0.375rem',
            padding: '0.5rem 0.75rem'
          }}>
            <BusyIndicator active size="S" />
          </div>
        </FlexBox>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
