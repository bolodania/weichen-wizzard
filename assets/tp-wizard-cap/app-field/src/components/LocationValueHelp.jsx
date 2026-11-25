import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Input, MessageStrip, BusyIndicator } from '@ui5/webcomponents-react';

export function LocationValueHelp({ value, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const requestId = ++generation.current;
    setBusy(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const literal = encodeURIComponent(search.replace(/'/g, "''")).replace(/'/g, '%27');
        const response = await fetch(`/wizard/getLocationValues(search='${literal}',skip=${skip})`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
        if (requestId !== generation.current) return;
        const result = data.value ?? data;
        setItems(result.items || []);
        setHasMore(Boolean(result.hasMore));
      } catch (e) {
        if (e.name !== 'AbortError' && requestId === generation.current) {
          setError(e.message);
          setItems([]);
          setHasMore(false);
        }
      } finally {
        if (requestId === generation.current && !controller.signal.aborted) setBusy(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, search, skip]);

  return <>
    <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
      <Input value={value} readonly placeholder="Betriebsstelle auswählen" accessibleName="Betriebsstelle" style={{ flex: 1 }} />
      <Button accessibleName="Betriebsstelle auswählen" onClick={() => {
        setSearch(''); setSkip(0); setItems([]); setOpen(true);
      }}>Auswählen</Button>
    </div>
    <Dialog open={open} headerText="Betriebsstelle auswählen" onClose={() => setOpen(false)}
      footer={<Button onClick={() => setOpen(false)}>Schließen</Button>}>
      <div style={{ padding: '1rem', width: 'min(32rem, 80vw)' }}>
        <Input accessibleName="Code oder Bezeichnung suchen" placeholder="Code oder Bezeichnung suchen"
          value={search} maxlength={100} style={{ width: '100%' }} onInput={(e) => {
            setSearch(e.target.value); setSkip(0);
          }} />
        {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}
        <BusyIndicator active={busy} style={{ display: 'block' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem 0' }}>
            {!busy && !error && !items.length && <span>Keine Einträge gefunden.</span>}
            {items.map((item) => <Button key={item.code} disabled={busy || item.code.length > 10}
              onClick={() => { onSelect(item.code); setOpen(false); }}>
              {item.code} — {item.description}
            </Button>)}
          </div>
        </BusyIndicator>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button disabled={busy || skip === 0} onClick={() => setSkip(Math.max(0, skip - 30))}>Zurück</Button>
          <Button disabled={busy || !hasMore} onClick={() => setSkip(skip + 30)}>Weiter</Button>
        </div>
      </div>
    </Dialog>
  </>;
}