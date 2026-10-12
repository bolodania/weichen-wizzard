import React from 'react';
import { Panel, FlexBox, ObjectStatus, Text } from '@ui5/webcomponents-react';

const SOURCE_STATE = {
  auto:               'None',
  'agent-default':    'Critical',
  'katrin-confirmed': 'Positive',
  'katrin-corrected': 'Information',
};
const SOURCE_LABEL = {
  auto:               'Auto',
  'agent-default':    'Agent',
  'katrin-confirmed': 'Bestätigt',
  'katrin-corrected': 'Korrigiert',
};

export function TPPreviewSheet({ tps }) {
  const count = tps?.length ?? 0;

  return (
    <Panel
      headerText={`TP-Vorschau — ${count} Technische Plätze`}
      collapsed
      style={{ borderTop: '2px solid var(--sapHighlightColor)' }}
    >
      {count === 0
        ? <Text style={{ padding: '0.75rem 1rem', color: 'var(--sapNeutralColor)' }}>
            Noch keine TPs abgeleitet.
          </Text>
        : <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {tps.map((tp, i) => (
              <FlexBox
                key={i}
                justifyContent="SpaceBetween"
                alignItems="Center"
                style={{
                  padding: '0.35rem 1rem',
                  borderBottom: '1px solid var(--sapGroup_TitleBorderColor)',
                  fontSize: 'var(--sapFontSmallSize)'
                }}
              >
                <Text style={{ fontSize: 'inherit', color: 'var(--sapTextColor)' }}>
                  {tp.tpLabel || tp.tpKey}
                </Text>
                <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
                  <Text style={{ fontSize: 'var(--sapFontSmallSize)', color: 'var(--sapNeutralColor)' }}>
                    Bereich {tp.area}
                  </Text>
                  {tp.source && (
                    <ObjectStatus
                      state={SOURCE_STATE[tp.source] ?? 'None'}
                      style={{ fontSize: 'var(--sapFontSmallSize)' }}
                    >
                      {SOURCE_LABEL[tp.source] ?? tp.source}
                    </ObjectStatus>
                  )}
                </FlexBox>
              </FlexBox>
            ))}
          </div>
      }
    </Panel>
  );
}
