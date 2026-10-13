using WizardService from '../../srv/wizard-service';

// ── Sessions — List Report + Object Page ─────────────────────────────────────
annotate WizardService.Sessions with @(

  UI.HeaderInfo: {
    TypeName:       'Einreichung',
    TypeNamePlural: 'Einreichungen',
    Title:       { $Type: 'UI.DataField', Value: sessionId },
    Description: { $Type: 'UI.DataField', Value: ds100 }
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
      { $Type: 'UI.DataField', Value: derivedTPCount, Label: 'Anzahl TPs'      }
    ]
  }
);

annotate WizardService.Sessions with {
  answersJson    @UI.Hidden;
  creationResult @UI.Hidden;
};

// ── SessionAnswers — sub-table in Object Page ─────────────────────────────────
annotate WizardService.SessionAnswers with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: area,          Label: 'Nr.'              },
    { $Type: 'UI.DataField', Value: areaName,      Label: 'Bereich'          },
    { $Type: 'UI.DataField', Value: questionText,  Label: 'Frage'            },
    { $Type: 'UI.DataField', Value: answer,        Label: 'Antwort'          },
    { $Type: 'UI.DataField', Value: source,        Label: 'Quelle'           },
    { $Type: 'UI.DataField', Value: agentProposal, Label: 'Agent-Vorschlag'  }
  ]
);
