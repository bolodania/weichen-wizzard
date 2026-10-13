import React, { useEffect, useRef } from 'react';
import { FlexBox, Avatar, BusyIndicator } from '@ui5/webcomponents-react';

function renderMarkdown(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n/g, '<br>');

  return html;
}

export function ChatThread({ messages, awaitingResponse }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, awaitingResponse]);

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
      {messages.map(msg =>
        msg.role === 'agent' ? (
          <FlexBox key={msg.id} alignItems="FlexStart" style={{ gap: '0.375rem' }}>
            <Avatar initials="AI" colorScheme="Accent6" size="XS" shape="Circle" style={{ flexShrink: 0 }} />
            <div style={{
              background: 'var(--sapNeutralBackground)',
              border: '1px solid var(--sapNeutralBorderColor)',
              borderRadius: '0 0.375rem 0.375rem 0.375rem',
              padding: '0.4rem 0.625rem',
              maxWidth: '80%',
              fontSize: 'var(--sapFontSize)',
              lineHeight: 1.45,
            }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
            />
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
