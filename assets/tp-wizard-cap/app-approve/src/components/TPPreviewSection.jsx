import React from 'react';
import { Title, Panel, Text } from '@ui5/webcomponents-react';

export function TPPreviewSection({ tps }) {
  if (!tps || tps.length === 0) return (
    <Text style={{ padding: '1rem', color: 'var(--sapNeutralColor)' }}>Keine TPs abgeleitet.</Text>
  );

  const byArea = {};
  for (const tp of tps) {
    const key = tp.area ?? 0;
    if (!byArea[key]) byArea[key] = { area: key, areaName: tp.areaName || `Bereich ${key}`, tps: [] };
    byArea[key].tps.push(tp);
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <Title level="H5" style={{ padding: '0 1rem' }}>TP-Vorschau ({tps.length} TPs)</Title>
      {Object.values(byArea).sort((a, b) => a.area - b.area).map(group => (
        <Panel
          key={group.area}
          headerText={`${group.areaName} (${group.tps.length})`}
          collapsed
          style={{ marginTop: '0.5rem' }}
        >
          <table style={{ width: '100%', fontSize: 'var(--sapFontSmallSize)', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--sapList_HeaderBackground)' }}>
                <th style={{ padding: '0.3rem 1rem', textAlign: 'left', color: 'var(--sapList_HeaderTextColor)' }}>PosNr</th>
                <th style={{ padding: '0.3rem 1rem', textAlign: 'left', color: 'var(--sapList_HeaderTextColor)' }}>Bezeichnung</th>
                <th style={{ padding: '0.3rem 1rem', textAlign: 'left', color: 'var(--sapList_HeaderTextColor)' }}>TP-Schlüssel</th>
              </tr>
            </thead>
            <tbody>
              {group.tps.map((tp, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--sapList_BorderColor)' }}>
                  <td style={{ padding: '0.3rem 1rem', color: 'var(--sapTextColor)' }}>{tp.posNr}</td>
                  <td style={{ padding: '0.3rem 1rem', color: 'var(--sapTextColor)' }}>{tp.tpLabel}</td>
                  <td style={{ padding: '0.3rem 1rem', fontFamily: 'monospace', color: 'var(--sapNeutralColor)' }}>{tp.tpKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
    </div>
  );
}
