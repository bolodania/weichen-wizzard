import React from 'react';
import { List, StandardListItem } from '@ui5/webcomponents-react';

const AREAS = [
  { id: 1, name: 'Örtlichkeit' },
  { id: 3, name: 'Grundbauform' },
  { id: 4, name: 'Zgv' },
  { id: 5, name: 'Herzstück' },
  { id: 6, name: 'Radlenker' },
  { id: 7, name: 'Antrieb' },
  { id: 8, name: 'Stränge' },
  { id: 9, name: 'Schwellen' },
  { id: 10, name: 'Weichensignal' },
  { id: 11, name: 'Weichensteuerung' },
  { id: 12, name: 'Weichenüberwachung' },
  { id: 13, name: 'Zwischenschiene' },
  { id: 14, name: 'Isolierstöße' },
  { id: 15, name: 'HAV' },
  { id: 16, name: 'Prellbock' },
  { id: 17, name: 'Gleisstücke' },
  { id: 18, name: 'Erdung' },
  { id: 19, name: 'Weichenheizung' }
];

/**
 * Left navigation panel showing progress through the 19 question areas.
 */
export function NavigationTree({ currentArea, completedAreas = [] }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <List>
        {AREAS.map(area => {
          const isCompleted = completedAreas.includes(area.id);
          const isCurrent   = currentArea === area.id;
          return (
            <StandardListItem
              key={area.id}
              selected={isCurrent}
              additionalText={isCompleted ? '✓' : (isCurrent ? '▶' : '')}
              additionalTextState={isCompleted ? 'Success' : (isCurrent ? 'Warning' : 'None')}
              style={{ fontWeight: isCurrent ? 'bold' : 'normal' }}
            >
              {area.name}
            </StandardListItem>
          );
        })}
      </List>
    </div>
  );
}
