'use strict';

/**
 * 14 possible Isolierstoß positions.
 * stw_bauform filters which positions are relevant.
 */
const ALL_ISO_POSITIONS = [
  { id: 'ZGVL',  label: 'ZGV links' },
  { id: 'ZGVR',  label: 'ZGV rechts' },
  { id: 'ZSBSL', label: 'Zwischenschiene Bs-Rl links' },
  { id: 'ZSBSR', label: 'Zwischenschiene Bs-Rl rechts' },
  { id: 'ZSZHZL',label: 'Zwischenschiene Zg-Hz links' },
  { id: 'ZSZHZR',label: 'Zwischenschiene Zg-Hz rechts' },
  { id: 'RLL',   label: 'Radlenker links' },
  { id: 'RLR',   label: 'Radlenker rechts' },
  { id: 'STRAL', label: 'Strang A Schiene links' },
  { id: 'STRAR', label: 'Strang A Schiene rechts' },
  { id: 'STRBL', label: 'Strang B Schiene links' },
  { id: 'STRBR', label: 'Strang B Schiene rechts' },
  { id: 'HZL',   label: 'Herzstück links' },
  { id: 'HZR',   label: 'Herzstück rechts' }
];

// Stw-Bauform → relevant ISO position IDs
const STW_BAUFORM_FILTER = {
  'SELSL60N': ['ZGVL','ZGVR','STRAL','STRAR','STRBL','STRBR','RLL','RLR','ZSBSL','ZSBSR','ZSZHZL','ZSZHZR','HZL','HZR'],
  'SETEDBRU': ['ZGVL','ZGVR','STRAL','STRAR','STRBL','STRBR'],
  'DEFAULT':  ['ZGVL','ZGVR','STRAL','STRAR','STRBL','STRBR']
};

function getRelevantIsoPositions(stwBauform) {
  const ids = STW_BAUFORM_FILTER[stwBauform] || STW_BAUFORM_FILTER['DEFAULT'];
  return ALL_ISO_POSITIONS.filter(p => ids.includes(p.id));
}

const ISO_KEY_MAP = {
  'ZGVL':   'ZUBA-ISO1',
  'ZGVR':   'ZUBA-ISO2',
  'STRAL':  'STR-AISO1',
  'STRAR':  'STR-AISO2',
  'STRBL':  'STR-BISO1',
  'STRBR':  'STR-BISO2',
  'HZL':    'HZ-ABISO1',
  'HZR':    'HZ-ABISO2',
  'RLL':    'HZ-ABRLL-ISO1',
  'RLR':    'HZ-ABRLR-ISO1',
  'ZSBSL':  'ZSBA-BSRLL-ISO1',
  'ZSBSR':  'ZSBA-BSRLR-ISO1',
  'ZSZHZL': 'ZSBA-ZGHZL-ISO1',
  'ZSZHZR': 'ZSBA-ZGHZR-ISO1'
};

function deriveIsolaerstöße(stwBauform, selectedPositions = []) {
  const relevant = getRelevantIsoPositions(stwBauform);
  const active = relevant.filter(p => selectedPositions.includes(p.id));
  return active.map(p => ({
    vorlaKey: `VORLA--WE------1${ISO_KEY_MAP[p.id]}`,
    tpLabel: `Isolierstoß ${p.label}`,
    area: 14,
    isAutomatic: false,
    isoPos: p.id
  }));
}

module.exports = { getRelevantIsoPositions, deriveIsolaerstöße };
