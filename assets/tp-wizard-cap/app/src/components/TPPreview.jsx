import React, { useMemo } from 'react';
import { List, StandardListItem, Title, FlexBox, Badge } from '@ui5/webcomponents-react';

const AREA_NAMES = {
  1: 'Örtlichkeit', 2: 'Objektgruppe', 3: 'Grundbauform', 4: 'Zgv',
  5: 'Herzstück', 6: 'Radlenker', 7: 'Antrieb', 8: 'Stränge',
  9: 'Schwellen', 10: 'Weichensignal', 11: 'Weichensteuerung',
  12: 'Weichenüberwachung', 13: 'Zwischenschiene', 14: 'Isolierstöße',
  15: 'Hemmschuhauswurfvorrichtung', 16: 'Prellbock', 17: 'Gleisstücke',
  18: 'Erdung', 19: 'Weichenheizung'
};

/**
 * Live TP Preview panel — groups TPs by area and shows automatic vs. confirmed.
 */
export function TPPreview({ tps = [] }) {
  const grouped = useMemo(() => {
    const map = {};
    for (const tp of tps) {
      const areaKey = tp.area || 0;
      if (!map[areaKey]) map[areaKey] = [];
      map[areaKey].push(tp);
    }
    return map;
  }, [tps]);

  const areas = Object.keys(grouped).sort((a, b) => a - b);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '0.5rem' }}>
      <Title level="H5" style={{ marginBottom: '0.5rem' }}>
        TP-Vorschau ({tps.length} TPs)
      </Title>
      {areas.length === 0 && (
        <p style={{ color: '#666', fontStyle: 'italic' }}>
          Noch keine TPs generiert — bitte Fragen beantworten.
        </p>
      )}
      {areas.map(area => (
        <div key={area} style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#0064d9', marginBottom: '0.25rem' }}>
            {AREA_NAMES[area] || `Bereich ${area}`} ({grouped[area].length})
          </div>
          <List>
            {grouped[area].map((tp, idx) => (
              <StandardListItem
                key={idx}
                description={tp.tpKey}
                additionalText={tp.isAutomatic ? '✅ auto' : '🔵 manuell'}
                additionalTextState={tp.isAutomatic ? 'Success' : 'Information'}
              >
                {tp.tpLabel || tp.tpKey}
              </StandardListItem>
            ))}
          </List>
        </div>
      ))}
    </div>
  );
}
