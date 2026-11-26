import React, { useState } from 'react';
import { Button, Dialog, Input, Select, Option, Label, MessageStrip } from '@ui5/webcomponents-react';

export function MissingAnswersDialog({ questions, busy, onSave }) {
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const key = questions.map((q) => q.id).join(',');
  const [previousKey, setPreviousKey] = useState(key);
  if (key !== previousKey) {
    setPreviousKey(key); setDismissed(false); setValues({}); setError(null);
  }
  async function save() {
    setError(null);
    try { await onSave(values); }
    catch (e) { setError(e.message); }
  }
  return <>
    {dismissed && questions.length > 0 && <Button onClick={() => setDismissed(false)}>Offene Angaben ergänzen</Button>}
    <Dialog open={questions.length > 0 && !dismissed} headerText="Offene Angaben ergänzen"
      onClose={() => { if (!busy) setDismissed(true); }}
      footer={<>
        <Button design="Emphasized" disabled={busy || !Object.values(values).some((v) => v !== '')} onClick={save}>
          {busy ? 'Wird gespeichert…' : 'Angaben speichern'}
        </Button>
        <Button disabled={busy} onClick={() => setDismissed(true)}>Später ergänzen</Button>
      </>}>
      <div style={{ padding: '1rem', width: 'min(36rem, 80vw)' }}>
        <p>Die Katalogvorgaben wurden übernommen. Für diese Angaben gibt es keine Vorgabe.
          Bitte ergänzen Sie die zutreffenden Werte. Es werden keine TPs in SAP angelegt.</p>
        {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}
        {questions.map((q) => {
          const options = q.answerType === 'JaNein' ? ['Ja', 'Nein'] : q.options;
          return <div key={q.id} style={{ margin: '1rem 0' }}>
            <Label required>{q.text}</Label>
            {options.length > 0
              ? <Select accessibleName={q.text} disabled={busy} style={{ width: '100%' }}
                  onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.detail.selectedOption.getAttribute('data-value') }))}>
                  <Option data-value="" selected={!values[q.id]}>Bitte auswählen</Option>
                  {options.map((o) => <Option key={o} data-value={o} selected={values[q.id] === o}>{o}</Option>)}
                </Select>
              : <Input accessibleName={q.text} disabled={busy} value={values[q.id] || ''} style={{ width: '100%' }}
                  type={['Menge', 'Zahl'].includes(q.answerType) ? 'Number' : 'Text'}
                  onInput={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))} />}
          </div>;
        })}
      </div>
    </Dialog>
  </>;
}