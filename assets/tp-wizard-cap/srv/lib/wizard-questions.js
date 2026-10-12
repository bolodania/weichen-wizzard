'use strict';

/**
 * Complete ordered list of wizard questions (80+ Fragen aus 19 Bereichen).
 * isAutomatic=true → no user input needed; skip in UI, derive automatically.
 */
const WIZARD_QUESTIONS = [
  // ── Bereich 1: Örtlichkeit ───────────────────────────────────────────────
  {
    id: 'ds100',
    area: 1,
    areaName: 'Örtlichkeit',
    text: 'Betriebsstelle (DS100-Kürzel):',
    answerType: 'text',
    required: true,
    isAutomatic: false
  },
  {
    id: 'switchNumber',
    area: 1,
    areaName: 'Örtlichkeit',
    text: 'Weichennummer:',
    answerType: 'text',
    required: true,
    isAutomatic: false
  },

  // ── Bereich 2: Objektgruppe ──────────────────────────────────────────────
  {
    id: 'basicForm',
    area: 3,
    areaName: 'Grundbauform',
    text: 'Grundbauform der Weiche:',
    answerType: 'choice',
    options: [
      { value: 'EWL', label: 'Einfache Weiche links' },
      { value: 'EWR', label: 'Einfache Weiche rechts' },
      { value: 'DKW', label: 'Doppelte Kreuzungsweiche' },
      { value: 'EKW', label: 'Einfache Kreuzungsweiche' },
      { value: 'IBW', label: 'Innenbogenweiche' },
      { value: 'DW',  label: 'Dreiwegweiche' },
      { value: 'ABW', label: 'Außenbogenweiche' }
    ],
    required: true,
    isAutomatic: false
  },
  {
    id: 'stwBauform',
    area: 3,
    areaName: 'Grundbauform',
    text: 'Stellwerks-Bauform:',
    answerType: 'choice',
    options: [
      { value: 'SELSL60N', label: 'ESTW (Siemens/Thales) — SELSL60N' },
      { value: 'SETEDBRU', label: 'ESTW (Bombardier) — SETEDBRU' },
      { value: 'DEFAULT',  label: 'Sonstige / unbekannt' }
    ],
    required: true,
    isAutomatic: false
  },

  // ── Bereich 4: ZGV ───────────────────────────────────────────────────────
  {
    id: 'anzahlVerschlussebenenZgv',
    area: 4,
    areaName: 'Zgv',
    text: 'Wie viele Verschlussebenen hat die Zungenvorrichtung (Zgv)?',
    answerType: 'number',
    required: true,
    isAutomatic: false
  },
  {
    id: 'anzahlZungRollpaarZgv',
    area: 4,
    areaName: 'Zgv',
    text: 'Wie viele Zungenrollvorrichtungspaare sind vorhanden?',
    answerType: 'number',
    required: true,
    isAutomatic: false
  },
  {
    id: 'federwippe',
    area: 4,
    areaName: 'Zgv',
    text: 'Ist eine Federwippe vorhanden?',
    answerType: 'boolean',
    required: true,
    isAutomatic: false
  },

  // ── Bereich 5: Herzstück ─────────────────────────────────────────────────
  {
    id: 'herzstückbauart',
    area: 5,
    areaName: 'Herzstück',
    text: 'Herzstück-Bauart (0 = starr, 1+ = beweglich):',
    answerType: 'number',
    required: true,
    isAutomatic: false
  },
  {
    id: 'anzahlVerschlussebenenHz',
    area: 5,
    areaName: 'Herzstück',
    text: 'Wie viele Verschlussebenen hat das Herzstück (beweglich)?',
    answerType: 'number',
    parentQuestionId: 'herzstückbauart',
    parentAnswer: '1',
    isAutomatic: false,
    required: false
  },
  {
    id: 'anzahlHzRollpaare',
    area: 5,
    areaName: 'Herzstück',
    text: 'Wie viele Herzstückrollvorrichtungspaare sind vorhanden?',
    answerType: 'number',
    parentQuestionId: 'herzstückbauart',
    parentAnswer: '1',
    isAutomatic: false,
    required: false
  },

  // ── Bereich 6: Radlenker ─────────────────────────────────────────────────
  {
    id: 'radsensoren',
    area: 6,
    areaName: 'Radlenker',
    text: 'Wie viele Radsensoren sind vorhanden? (0 = keine)',
    answerType: 'number',
    required: true,
    isAutomatic: false
  },

  // ── Bereich 7: Antrieb ───────────────────────────────────────────────────
  {
    id: 'anzahlAntriebeZgv',
    area: 7,
    areaName: 'Antrieb',
    text: 'Wie viele Weichenantriebe sind an der Zgv vorhanden?',
    answerType: 'number',
    required: true,
    isAutomatic: false
  },
  {
    id: 'anzahlAntriebeHz',
    area: 7,
    areaName: 'Antrieb',
    text: 'Wie viele Antriebe hat das bewegliche Herzstück?',
    answerType: 'number',
    parentQuestionId: 'herzstückbauart',
    parentAnswer: '1',
    isAutomatic: false,
    required: false
  },
  {
    id: 'hydraulisch',
    area: 7,
    areaName: 'Antrieb',
    text: 'Handelt es sich um hydraulische Antriebe?',
    answerType: 'boolean',
    required: true,
    isAutomatic: false
  },

  // ── Bereiche 8+9: Stränge + Schwellen (automatisch) ─────────────────────
  { id: 'stränge', area: 8, areaName: 'Stränge', text: 'Stränge (automatisch)', answerType: 'boolean', isAutomatic: true, required: false },
  { id: 'schwellen', area: 9, areaName: 'Schwellen', text: 'Schwellen (automatisch)', answerType: 'boolean', isAutomatic: true, required: false },

  // ── Bereich 10: Weichensignal ────────────────────────────────────────────
  {
    id: 'weichensignale',
    area: 10,
    areaName: 'Weichensignal',
    text: 'Wie viele Weichensignale sind vorhanden? (0 = keine)',
    answerType: 'number',
    required: true,
    isAutomatic: false
  },
  {
    id: 'lichtpunkte',
    area: 10,
    areaName: 'Weichensignal',
    text: 'Wie viele Lichtpunkte hat das Weichensignal?',
    answerType: 'number',
    parentQuestionId: 'weichensignale',
    parentAnswer: '1',
    isAutomatic: false,
    required: false
  },

  // ── Bereich 11: Weichensteuerung ─────────────────────────────────────────
  {
    id: 'weichensteuerung',
    area: 11,
    areaName: 'Weichensteuerung',
    text: 'Ist eine dezentrale Weichensteuerung vorhanden?',
    answerType: 'boolean',
    required: true,
    isAutomatic: false
  },

  // ── Bereich 12: Weichenüberwachung ───────────────────────────────────────
  {
    id: 'weichenüberwachung',
    area: 12,
    areaName: 'Weichenüberwachung',
    text: 'Ist eine Weichenüberwachungseinrichtung vorhanden?',
    answerType: 'boolean',
    required: true,
    isAutomatic: false
  },

  // ── Bereich 13: Zwischenschiene (automatisch) ─────────────────────────────
  { id: 'zwischenschiene', area: 13, areaName: 'Zwischenschiene', text: 'Zwischenschiene (automatisch)', answerType: 'boolean', isAutomatic: true, required: false },

  // ── Bereich 14: Isolierstöße ─────────────────────────────────────────────
  {
    id: 'isoPositions',
    area: 14,
    areaName: 'Isolierstöße',
    text: 'An welchen Einbauorten sind Isolierstöße vorhanden?',
    answerType: 'multiselect',
    options: [
      { value: 'ZGVL',   label: 'ZGV links' },
      { value: 'ZGVR',   label: 'ZGV rechts' },
      { value: 'ZSBSL',  label: 'Zwischenschiene Bs-Rl links' },
      { value: 'ZSBSR',  label: 'Zwischenschiene Bs-Rl rechts' },
      { value: 'ZSZHZL', label: 'Zwischenschiene Zg-Hz links' },
      { value: 'ZSZHZR', label: 'Zwischenschiene Zg-Hz rechts' },
      { value: 'RLL',    label: 'Radlenker links' },
      { value: 'RLR',    label: 'Radlenker rechts' },
      { value: 'STRAL',  label: 'Strang A Schiene links' },
      { value: 'STRAR',  label: 'Strang A Schiene rechts' },
      { value: 'STRBL',  label: 'Strang B Schiene links' },
      { value: 'STRBR',  label: 'Strang B Schiene rechts' },
      { value: 'HZL',    label: 'Herzstück links' },
      { value: 'HZR',    label: 'Herzstück rechts' }
    ],
    required: false,
    isAutomatic: false
  },

  // ── Bereich 15: HAV ──────────────────────────────────────────────────────
  {
    id: 'havPositions',
    area: 15,
    areaName: 'Hemmschuhauswurfvorrichtung',
    text: 'Sind Hemmschuhauswurfvorrichtungen vorhanden? (Einbauort auswählen)',
    answerType: 'multiselect',
    options: [
      { value: 'L',  label: 'Links' },
      { value: 'R',  label: 'Rechts' },
      { value: 'LA', label: 'Links A' },
      { value: 'LB', label: 'Links B' },
      { value: 'RA', label: 'Rechts A' },
      { value: 'RB', label: 'Rechts B' }
    ],
    required: false,
    isAutomatic: false
  },

  // ── Bereich 16: Prellbock ────────────────────────────────────────────────
  {
    id: 'prellbock',
    area: 16,
    areaName: 'Prellbock',
    text: 'Ist ein Prellbock vorhanden?',
    answerType: 'boolean',
    required: false,
    isAutomatic: false
  },

  // ── Bereich 17: Gleisstücke ──────────────────────────────────────────────
  {
    id: 'gleisstückWP',
    area: 17,
    areaName: 'Gleisstücke',
    text: 'Ist ein Gleisstück an der Weichenspitze vorhanden?',
    answerType: 'boolean',
    required: false,
    isAutomatic: false
  },
  {
    id: 'gleisstückEndA',
    area: 17,
    areaName: 'Gleisstücke',
    text: 'Ist ein Gleisstück am Endbereich Strang A vorhanden?',
    answerType: 'boolean',
    required: false,
    isAutomatic: false
  },
  {
    id: 'gleisstückEndB',
    area: 17,
    areaName: 'Gleisstücke',
    text: 'Ist ein Gleisstück am Endbereich Strang B vorhanden?',
    answerType: 'boolean',
    required: false,
    isAutomatic: false
  },

  // ── Bereich 18: Erdung ───────────────────────────────────────────────────
  {
    id: 'erdung',
    area: 18,
    areaName: 'Erdung',
    text: 'Ist eine Erdungsvorrichtung vorhanden?',
    answerType: 'boolean',
    required: false,
    isAutomatic: false
  },

  // ── Bereich 19: Weichenheizung ───────────────────────────────────────────
  {
    id: 'heizungTyp',
    area: 19,
    areaName: 'Weichenheizung',
    text: 'Welcher Heizungstyp ist vorhanden?',
    answerType: 'choice',
    options: [
      { value: null,        label: 'Keine Heizung' },
      { value: 'elektrisch',label: 'Elektrisch (EEH)' },
      { value: 'gas',       label: 'Gas (GHE)' },
      { value: 'öl',        label: 'Öl (ODH)' },
      { value: 'dampf',     label: 'Dampf (SPH)' }
    ],
    required: false,
    isAutomatic: false
  }
];

module.exports = { WIZARD_QUESTIONS };
