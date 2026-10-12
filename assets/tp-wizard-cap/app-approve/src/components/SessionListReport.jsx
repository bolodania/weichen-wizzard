import React, { useState, useMemo } from 'react';
import {
  AnalyticalTable, ObjectStatus, BusyIndicator,
  FilterBar, FilterGroupItem, Select, Option,
  Title, Toolbar, ToolbarSpacer, Button, IllustratedMessage
} from '@ui5/webcomponents-react';

const STATUS_STATE = {
  submitted: 'Information',
  editing:   'Critical',
  approved:  'Positive',
  created:   'Positive',
  failed:    'Negative',
};
const STATUS_LABEL_DE = {
  submitted: 'Eingereicht',
  editing:   'In Bearbeitung',
  approved:  'Freigegeben',
  created:   'Angelegt',
  failed:    'Fehlgeschlagen',
};

export function SessionListReport({ sessions, loading, onSelect, onRefresh }) {
  const [filterStatus, setFilterStatus] = useState('');

  const filtered = useMemo(() =>
    filterStatus
      ? sessions.filter(s => s.status === filterStatus)
      : sessions,
    [sessions, filterStatus]
  );

  const columns = [
    { Header: 'Betriebsstelle', accessor: 'ds100',          minWidth: 100 },
    { Header: 'Weiche',         accessor: 'switchNumber',   minWidth: 80  },
    { Header: 'Grundbauform',   accessor: 'basicFormLabel', minWidth: 160 },
    {
      Header: 'Eingereicht',
      accessor: 'submittedAt',
      minWidth: 140,
      Cell: ({ value }) => value ? new Date(value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—',
    },
    { Header: 'TPs', accessor: 'tpCount', minWidth: 60, hAlign: 'End' },
    {
      Header: 'Hinweise',
      accessor: 'openHintCount',
      minWidth: 100,
      Cell: ({ value }) => (
        <ObjectStatus state={value > 0 ? 'Critical' : 'Positive'} inverted>
          {value > 0 ? `${value} offen` : 'Geprüft'}
        </ObjectStatus>
      ),
    },
    {
      Header: 'Status',
      accessor: 'status',
      minWidth: 130,
      Cell: ({ value }) => (
        <ObjectStatus state={STATUS_STATE[value] ?? 'None'} inverted>
          {STATUS_LABEL_DE[value] ?? value}
        </ObjectStatus>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <FilterBar
        onGo={() => {}}
        showGoOnFT
        style={{ padding: '0.5rem 1rem' }}
      >
        <FilterGroupItem label="Status" groupName="Filter">
          <Select onChange={e => setFilterStatus(e.detail.selectedOption.getAttribute('data-value') ?? '')}>
            <Option data-value="">Alle</Option>
            <Option data-value="submitted">Eingereicht</Option>
            <Option data-value="editing">In Bearbeitung</Option>
          </Select>
        </FilterGroupItem>
      </FilterBar>

      <Toolbar style={{ padding: '0 1rem' }}>
        <Title level="H4">Ausstehende Einreichungen ({filtered.length})</Title>
        <ToolbarSpacer />
        <Button icon="refresh" design="Transparent" onClick={onRefresh} tooltip="Aktualisieren" />
      </Toolbar>

      {loading && filtered.length === 0
        ? <BusyIndicator active size="L" style={{ margin: '4rem auto', display: 'block' }} />
        : filtered.length === 0
          ? <IllustratedMessage
              name="NoData"
              titleText="Keine ausstehenden Einreichungen"
              subtitleText="Wenn Katrin eine Weiche erfasst und einreicht, erscheint sie hier."
            />
          : <AnalyticalTable
              columns={columns}
              data={filtered}
              onRowClick={e => onSelect(e.detail.row.original.sessionId)}
              minRows={1}
              rowHeight={44}
              style={{ flex: 1 }}
            />
      }
    </div>
  );
}
