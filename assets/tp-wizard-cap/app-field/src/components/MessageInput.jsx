import React, { useState, useRef } from 'react';
import { Button, Input } from '@ui5/webcomponents-react';

export function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const handleMic = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Spracherkennung wird in diesem Browser nicht unterstützt.');
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = 'de-DE';
    rec.continuous = false;
    rec.interimResults = false;
    recognitionRef.current = rec;

    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setText(transcript); // drop into field — user confirms before sending
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);

    rec.start();
    setListening(true);
  };

  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
      padding: '0.75rem',
      borderTop: '1px solid var(--sapGroup_TitleBorderColor)',
      background: 'var(--sapBaseColor)'
    }}>
      <Input
        style={{ flex: 1 }}
        placeholder={listening ? '🎙 Höre zu...' : 'Nachricht eingeben...'}
        value={text}
        onInput={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSend()}
        disabled={disabled}
      />
      <Button icon="microphone" design={listening ? 'Attention' : 'Default'} onClick={handleMic} />
      <Button design="Emphasized" icon="paper-plane" onClick={handleSend} disabled={disabled || !text.trim()} />
    </div>
  );
}
