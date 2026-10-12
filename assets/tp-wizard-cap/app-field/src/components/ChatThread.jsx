import React, { useEffect, useRef } from 'react';
import { FlexBox, Avatar, Text, BusyIndicator } from '@ui5/webcomponents-react';

export function ChatThread({ messages, awaitingResponse }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, awaitingResponse]);

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      background: 'var(--sapBackgroundColor)'
    }}>
      {messages.map(msg =>
        msg.role === 'agent' ? (
          <FlexBox key={msg.id} alignItems="FlexStart" style={{ gap: '0.5rem' }}>
            <Avatar initials="AI" colorScheme="Accent6" size="XS" shape="Circle" style={{ flexShrink: 0 }} />
            <div style={{
              background: 'var(--sapNeutralBackground)',
              border: '1px solid var(--sapNeutralBorderColor)',
              borderRadius: '0 0.5rem 0.5rem 0.5rem',
              padding: '0.625rem 0.875rem',
              maxWidth: '75%'
            }}>
              <Text renderWhitespace wrapping style={{ fontSize: 'var(--sapFontSize)' }}>{msg.text}</Text>
            </div>
          </FlexBox>
        ) : (
          <FlexBox key={msg.id} justifyContent="FlexEnd">
            <div style={{
              background: 'var(--sapHighlightColor)',
              borderRadius: '0.5rem 0 0.5rem 0.5rem',
              padding: '0.625rem 0.875rem',
              maxWidth: '75%'
            }}>
              <Text renderWhitespace wrapping style={{
                fontSize: 'var(--sapFontSize)',
                color: 'var(--sapButton_Emphasized_TextColor)'
              }}>
                {msg.text}
              </Text>
            </div>
          </FlexBox>
        )
      )}
      {awaitingResponse && (
        <FlexBox alignItems="FlexStart" style={{ gap: '0.5rem' }}>
          <Avatar initials="AI" colorScheme="Accent6" size="XS" shape="Circle" style={{ flexShrink: 0 }} />
          <div style={{
            background: 'var(--sapNeutralBackground)',
            border: '1px solid var(--sapNeutralBorderColor)',
            borderRadius: '0 0.5rem 0.5rem 0.5rem',
            padding: '0.75rem 1rem'
          }}>
            <BusyIndicator active size="S" />
          </div>
        </FlexBox>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
