import React, { useState } from 'react';
import {
  Input, Select, Option, CheckBox, Button, Label,
  FlexBox, SegmentedButton, SegmentedButtonItem
} from '@ui5/webcomponents-react';

/**
 * Renders the appropriate input control based on question.answerType.
 */
export function QuestionRenderer({ question, onAnswer }) {
  const [value, setValue] = useState(question.answerType === 'multiselect' ? [] : '');

  if (!question) return null;

  const handleSubmit = () => onAnswer(question.id, value);

  if (question.answerType === 'choice') {
    return (
      <FlexBox direction="Column" style={{ gap: '1rem' }}>
        <Label>{question.text}</Label>
        <Select onChange={e => setValue(e.detail.selectedOption.getAttribute('data-value'))}>
          {(question.options || []).map(opt => (
            <Option key={opt.value} data-value={opt.value || ''}>{opt.label}</Option>
          ))}
        </Select>
        <Button onClick={handleSubmit} design="Emphasized">Weiter</Button>
      </FlexBox>
    );
  }

  if (question.answerType === 'number') {
    return (
      <FlexBox direction="Column" style={{ gap: '1rem' }}>
        <Label>{question.text}</Label>
        <Input
          type="Number"
          value={value}
          onInput={e => setValue(e.target.value)}
          style={{ maxWidth: '200px' }}
        />
        <Button onClick={handleSubmit} design="Emphasized">Weiter</Button>
      </FlexBox>
    );
  }

  if (question.answerType === 'boolean') {
    return (
      <FlexBox direction="Column" style={{ gap: '1rem' }}>
        <Label>{question.text}</Label>
        <SegmentedButton onSelectionChange={e => setValue(e.detail.selectedItem.getAttribute('data-value'))}>
          <SegmentedButtonItem data-value="true">Ja</SegmentedButtonItem>
          <SegmentedButtonItem data-value="false" pressed>Nein</SegmentedButtonItem>
        </SegmentedButton>
        <Button onClick={() => onAnswer(question.id, value || 'false')} design="Emphasized">Weiter</Button>
      </FlexBox>
    );
  }

  if (question.answerType === 'multiselect') {
    const toggleOption = (optVal) => {
      setValue(prev => {
        const arr = Array.isArray(prev) ? prev : [];
        return arr.includes(optVal) ? arr.filter(v => v !== optVal) : [...arr, optVal];
      });
    };
    return (
      <FlexBox direction="Column" style={{ gap: '0.5rem' }}>
        <Label>{question.text}</Label>
        {(question.options || []).map(opt => (
          <CheckBox
            key={opt.value}
            text={opt.label}
            checked={Array.isArray(value) && value.includes(opt.value)}
            onChange={() => toggleOption(opt.value)}
          />
        ))}
        <Button onClick={() => onAnswer(question.id, Array.isArray(value) ? value : [])} design="Emphasized">
          Weiter
        </Button>
      </FlexBox>
    );
  }

  // text fallback
  return (
    <FlexBox direction="Column" style={{ gap: '1rem' }}>
      <Label>{question.text}</Label>
      <Input value={value} onInput={e => setValue(e.target.value)} />
      <Button onClick={handleSubmit} design="Emphasized">Weiter</Button>
    </FlexBox>
  );
}
