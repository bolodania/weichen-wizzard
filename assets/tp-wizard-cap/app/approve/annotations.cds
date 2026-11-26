using WizardService from '../../srv/wizard-service';

// ── Sessions — List Report + Object Page ─────────────────────────────────────
annotate WizardService.Sessions with @(

  // Disable OData-Draft-Create in List Report — sessions are created via createSession action only
  UI.CreateHidden: true,
  UI.DeleteHidden: true,

  UI.HeaderInfo: {
    TypeName:       'Einreichung',
    TypeNamePlural: 'Einreichungen',
    Title:       { $Type: 'UI.DataField', Value: ds100 },
    Description: { $Type: 'UI.DataField', Value: switchNumber }
  },

  // Filter bar fields
  UI.SelectionFields: [ status, basicForm, ds100 ],

  // List Report table columns
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: ds100,          Label: 'Betriebsstelle' },
    { $Type: 'UI.DataField', Value: switchNumber,   Label: 'Weiche'         },
    { $Type: 'UI.DataField', Value: basicForm,      Label: 'Grundbauform'   },
    { $Type: 'UI.DataField', Value: submittedAt,    Label: 'Eingereicht am' },
    { $Type: 'UI.DataField', Value: derivedTPCount, Label: 'Anzahl TPs'     },
    { $Type: 'UI.DataField', Value: status,         Label: 'Status'         }
  ],

  // Object Page header action + List Report toolbar action (when row selected)
  UI.Identification: [
    {
      $Type:  'UI.DataFieldForAction',
      Label:  'Freigeben',
      Action: 'WizardService.approve'
    }
  ],

  // Object Page sections
  UI.Facets: [
    {
      $Type: 'UI.CollectionFacet',
      ID:    'GeneralInfo',
      Label: 'Allgemein',
      Facets: [
        {
          $Type:  'UI.ReferenceFacet',
          Label:  'Session-Details',
          Target: '@UI.FieldGroup#General'
        }
      ]
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'Answers',
      Label:  'Antworten',
      Target: 'answers/@UI.LineItem'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'TPStructure',
      Label:  'TP-Struktur',
      Target: 'tps/@UI.LineItem'
    }
  ],

  UI.FieldGroup#General: {
    Data: [
      { $Type: 'UI.DataField', Value: ds100,          Label: 'Betriebsstelle'  },
      { $Type: 'UI.DataField', Value: switchNumber,   Label: 'Weichennummer'   },
      { $Type: 'UI.DataField', Value: basicForm,      Label: 'Grundbauform'    },
      { $Type: 'UI.DataField', Value: status,         Label: 'Status'          },
      { $Type: 'UI.DataField', Value: createdAt,      Label: 'Erstellt am'     },
      { $Type: 'UI.DataField', Value: submittedAt,    Label: 'Eingereicht am'  },
      { $Type: 'UI.DataField', Value: approvedAt,     Label: 'Freigegeben am'  },
      { $Type: 'UI.DataField', Value: derivedTPCount, Label: 'Anzahl TPs'      },
      { $Type: 'UI.DataField', Value: reviewComment,  Label: 'Prüfungsnotiz'   }
    ]
  },

  // Updatable: true makes the Edit button appear.
  // NonUpdatableProperties lists the identification fields that Thomas cannot
  // change — FE renders them read-only in edit mode without suppressing Edit.
  // (Thomas edits answers in the sub-table, not the header fields.)
  Capabilities.UpdateRestrictions: {
    Updatable:              true,
    NonUpdatableProperties: [ds100, switchNumber, basicForm]
  }
);

annotate WizardService.Sessions with {
  answersJson    @UI.Hidden;
  creationResult @UI.Hidden;
  // Identification fields — read-only via NonUpdatableProperties in UpdateRestrictions.
  // Server-side guard in wizard-service.js also strips these from any PATCH.
  // System-managed fields — server sets these, not the client
  status         @Core.Computed;
  createdAt      @Core.Computed;
  submittedAt    @Core.Computed;
  approvedAt     @Core.Computed;
  derivedTPCount @Core.Computed;
};

// ── SessionAnswers — sub-table in Object Page ─────────────────────────────────
annotate WizardService.SessionAnswers with {
  // Structural fields set at answer-recording time — cannot change
  questionId    @Core.Immutable;
  questionText  @Core.Immutable;
  area          @Core.Immutable;
  // Source, provenance and original proposal are server-managed
  source        @Core.Computed;
  herkunft      @Core.Computed;
  beleg         @Core.Computed;
  agentProposal @Core.Computed;
  // Technical FK — hide from all UI forms and tables
  session       @UI.Hidden;
  // `answer` is editable; multiline renders a textarea in edit mode
  answer        @UI.MultiLineText;
};

annotate WizardService.SessionAnswers with @(
  // Fiori Elements needs explicit capabilities to render edit controls in the sub-table.
  // Without UpdateRestrictions the table stays read-only even when the Object Page is in edit mode.
  Capabilities.UpdateRestrictions: { Updatable: true },
  // Answers are recorded by the wizard; Thomas corrects them but never adds/removes rows.
  Capabilities.InsertRestrictions: { Insertable: false },
  Capabilities.DeleteRestrictions: { Deletable: false },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: area,          Label: 'Bereich'          },
    { $Type: 'UI.DataField', Value: questionText,  Label: 'Frage'            },
    { $Type: 'UI.DataField', Value: answer,        Label: 'Antwort'          },
    { $Type: 'UI.DataField', Value: herkunft,      Label: 'Herkunft'         },
    { $Type: 'UI.DataField', Value: beleg,         Label: 'Beleg'            },
    { $Type: 'UI.DataField', Value: source,        Label: 'Quelle'           },
    { $Type: 'UI.DataField', Value: agentProposal, Label: 'Agent-Vorschlag'  }
  ]
);

// ── DerivedTPs — TP structure tree for Thomas ─────────────────────────────────
annotate WizardService.DerivedTPs with {
  session      @UI.Hidden;
  parentTpKey  @UI.HiddenFilter;
};

annotate WizardService.DerivedTPs with @(
  Capabilities.InsertRestrictions: { Insertable: false },
  Capabilities.UpdateRestrictions: { Updatable:  false },
  Capabilities.DeleteRestrictions: { Deletable:  false },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: level,         Label: 'Ebene'           },
    { $Type: 'UI.DataField', Value: posNr,         Label: 'Pos.-Nr.'        },
    { $Type: 'UI.DataField', Value: tpKey,         Label: 'TP-Schlüssel'    },
    { $Type: 'UI.DataField', Value: tpLabel,       Label: 'Bezeichnung'     },
    { $Type: 'UI.DataField', Value: area,          Label: 'Bereich'         },
    { $Type: 'UI.DataField', Value: planergruppe,  Label: 'Planergruppe'    },
    { $Type: 'UI.DataField', Value: isAutomatic,   Label: 'Automatisch'     },
    { $Type: 'UI.DataField', Value: parentTpKey,   Label: 'Übergeordnet'    }
  ]
);
