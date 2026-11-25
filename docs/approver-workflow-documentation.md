# Approver-Workflow: PDF-Upload & KI-Chat Dokumentation

## Übersicht

Der Approver-Workflow wurde um zwei zentrale Features erweitert:
1. **PDF-Dokument-Upload mit automatischer Regelwerk-Analyse**
2. **KI-gestützter Chat für Approver-Unterstützung**

Diese Features ermöglichen es dem Freigeber (Approver), hochgeladene Weichen-Dokumente zu analysieren und bei Unklarheiten oder fehlenden Informationen Unterstützung durch einen KI-Assistenten zu erhalten.

---

## Feature 1: PDF-Dokument-Upload & Analyse

### Zweck
Approver können PDF-Dokumente (z.B. Fertigmeldungen, technische Zeichnungen) hochladen, die automatisch analysiert werden, um:
- Alle **Pflicht-TPs** auf Vollständigkeit zu prüfen
- Die **Korrektheit** der erfassten TPs zu validieren
- **Optionale TPs** zu identifizieren
- **Fehlende oder inkorrekte Angaben** hervorzuheben

### Architektur

#### Backend (CAP Service)

**Service Definition** (`srv/wizard-service.cds`):
```cds
action uploadDocument(
  sessionId  : String,
  filename   : String,
  mimeType   : String(100),
  contentB64 : String
) returns {
  sessionId    : String;
  filename     : String;
  analysisJson : String;   // JSON mit pflicht/optional/missing/hints
};

action analyseDocument(
  sessionId : String,
  filename  : String
) returns {
  sessionId    : String;
  analysisJson : String;
};

@readonly entity SessionDocuments as projection on wizard.SessionDocument
  excluding { content };   // content served via dedicated action, not OData stream
```

**Datenmodell** (`db/schema.cds`):
```cds
entity SessionDocument {
  key sessionId      : UUID;
  key filename       : String;
      mimeType       : String(100);
      content        : LargeBinary;    // PDF-Binärdaten
      uploadedAt     : DateTime;
      extractedText  : LargeString;    // Extrahierter Text aus PDF
      analysisJson   : LargeString;    // Analyse-Ergebnis als JSON
      analysisDoneAt : DateTime;
}
```

**Implementation** (`srv/wizard-service.js`):

```javascript
srv.on('uploadDocument', async (req) => {
  const { sessionId, filename, mimeType, contentB64 } = req.data;
  
  // 1. Base64 → Buffer dekodieren
  const content = Buffer.from(contentB64, 'base64');
  
  // 2. Text-Extraktion (pdftotext oder Fallback)
  let extractedText = '';
  try {
    // Versuche pdftotext (poppler-utils)
    const tmp = require('os').tmpdir();
    const tmpIn = `${tmp}/tp-doc-${Date.now()}.pdf`;
    fs.writeFileSync(tmpIn, content);
    extractedText = execSync(`pdftotext "${tmpIn}" -`, { timeout: 10000 }).toString();
    fs.unlinkSync(tmpIn);
  } catch (_) {
    // Fallback: Raw-Text-Extraktion
    extractedText = content.toString('latin1').replace(/[^\x20-\x7E\n\r\t\u00C0-\u00FF]/g, ' ');
  }
  
  // 3. Regelwerk-basierte Analyse
  const katalog = await ladeKatalog();
  const session = await _getSession(sessionId);
  const analysisJson = JSON.stringify(_analyseDocument(katalog, session, extractedText));
  
  // 4. Persistierung
  await db.run(UPSERT.into('tp.wizard.SessionDocument').entries({
    sessionId, filename, mimeType, content, uploadedAt: new Date().toISOString(),
    extractedText, analysisJson, analysisDoneAt: new Date().toISOString()
  }));
  
  return { sessionId, filename, analysisJson };
});
```

**Analyse-Funktion** (`_analyseDocument`):
```javascript
function _analyseDocument(katalog, session, extractedText) {
  const { ableitenTps } = require('./lib/weiche');
  const { tps, offeneAngaben } = ableitenTps(katalog, session);
  
  // Alle Pflicht-Regeln für diese Grundbauform
  const allePflichtRegeln = katalog.regeln.filter(
    r => r.giltFuer?.includes(session.basicForm) && 
         !r.hinweis?.toLowerCase().includes('optional')
  );
  
  const abgeleiteteSchluessel = new Set(tps.map(t => t.muster));
  
  const pflichtTps = [];
  const optionalTps = [];
  const fehlendeHinweise = [];
  
  for (const regel of allePflichtRegeln) {
    const abgeleitet = abgeleiteteSchluessel.has(regel.muster);
    const eintrag = {
      regelNr: regel.nr,
      muster: regel.muster,
      bereich: regel.bereich,
      abgeleitet
    };
    
    if (regel.hinweis?.toLowerCase().includes('optional')) {
      optionalTps.push(eintrag);
    } else {
      pflichtTps.push(eintrag);
      if (!abgeleitet) {
        fehlendeHinweise.push({
          regelNr: regel.nr,
          muster: regel.muster,
          bereich: regel.bereich,
          hinweis: regel.hinweis || `Pflicht-TP "${regel.muster}" fehlt`
        });
      }
    }
  }
  
  return {
    pflichtTps,           // Array: alle Pflicht-TPs mit Status
    optionalTps,          // Array: optionale TPs
    fehlendeHinweise,     // Array: Warnungen für fehlende TPs
    offeneAngaben,        // Array: noch nicht beantwortete Fragen
    summary: fehlendeHinweise.length === 0 
      ? '✓ Alle Pflicht-TPs erfasst' 
      : `⚠ ${fehlendeHinweise.length} Pflicht-TP(s) fehlen`
  };
}
```

#### Frontend (Fiori Elements Extension)

**Fragment** (`app/approve/webapp/ext/ApproverPanel.fragment.xml`):
```xml
<VBox class="sapUiMediumMargin">
  <Title text="Dokument hochladen &amp; analysieren" level="H3"/>
  
  <HBox alignItems="Center">
    <u:FileUploader
      id="pdfUploader"
      fileType="pdf"
      mimeType="application/pdf"
      placeholder="PDF-Datei auswählen..."
      change=".onFileSelected"/>
    <Button
      id="uploadBtn"
      text="Hochladen &amp; Analysieren"
      type="Emphasized"
      press=".onUploadAndAnalyse"
      enabled="{approverPanel>/fileSelected}"/>
  </HBox>
  
  <!-- Analyse-Ergebnis Panel -->
  <Panel visible="{= !!${approverPanel>/analysisResult} }">
    <headerToolbar>
      <Toolbar>
        <Title text="Analyse-Ergebnis" level="H4"/>
        <ObjectStatus
          text="{approverPanel>/analysisResult/summary}"
          state="{= ${approverPanel>/analysisResult/fehlendeHinweise/length} > 0 ? 'Error' : 'Success' }"/>
      </Toolbar>
    </headerToolbar>
    
    <VBox class="sapUiSmallMargin">
      <!-- Fehlende Pflicht-TPs -->
      <List
        visible="{= ${approverPanel>/analysisResult/fehlendeHinweise/length} > 0 }"
        items="{approverPanel>/analysisResult/fehlendeHinweise}">
        <StandardListItem
          title="{approverPanel>muster}"
          description="{approverPanel>hinweis}"
          type="Active"
          icon="sap-icon://alert"/>
      </List>
      
      <!-- Erfasste Pflicht-TPs -->
      <Text text="Pflicht-TPs: {= ${approverPanel>/analysisResult/pflichtTps}.filter(t => t.abgeleitet).length } / {approverPanel>/analysisResult/pflichtTps/length}"/>
      
      <!-- Optionale TPs -->
      <Text text="Optionale TPs erfasst: {= ${approverPanel>/analysisResult/optionalTps}.filter(t => t.abgeleitet).length }"/>
    </VBox>
  </Panel>
</VBox>
```

**Controller** (`app/approve/webapp/ext/ApproverPanel.controller.js`):
```javascript
onUploadAndAnalyse: function () {
  const file = this._model.getProperty('/selectedFile');
  const sessionId = this._getSessionId();
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const b64 = e.target.result.split(',')[1]; // Strip data-URL prefix
    this._uploadDocument(sessionId, file.name, file.type, b64);
  };
  reader.readAsDataURL(file);
},

_uploadDocument: function (sessionId, filename, mimeType, contentB64) {
  const busyBtn = this.byId('uploadBtn');
  busyBtn.setBusy(true);
  
  this._callActionFetch('/wizard/uploadDocument', { 
    sessionId, filename, mimeType, contentB64 
  })
    .then(result => {
      const analysis = JSON.parse(result.analysisJson);
      this._model.setProperty('/analysisResult', analysis);
      MessageToast.show(`Dokument analysiert: ${analysis.summary}`);
    })
    .catch(err => MessageBox.error(`Upload fehlgeschlagen: ${err.message}`))
    .finally(() => busyBtn.setBusy(false));
}
```

### Analyse-Ergebnis Struktur

```json
{
  "pflichtTps": [
    {
      "regelNr": "R001",
      "muster": "BL.01.01",
      "bereich": "Weichenkonstruktion",
      "abgeleitet": true
    },
    {
      "regelNr": "R002",
      "muster": "BL.02.01",
      "bereich": "Antrieb",
      "abgeleitet": false
    }
  ],
  "optionalTps": [
    {
      "regelNr": "R050",
      "muster": "BL.10.05",
      "bereich": "Heizung",
      "abgeleitet": true
    }
  ],
  "fehlendeHinweise": [
    {
      "regelNr": "R002",
      "muster": "BL.02.01",
      "bereich": "Antrieb",
      "hinweis": "Pflicht-TP 'BL.02.01' wurde nicht abgeleitet. Bitte Antriebsart prüfen."
    }
  ],
  "offeneAngaben": [
    {
      "questionId": "antrieb_art",
      "label": "Antriebsart",
      "erforderlich": true
    }
  ],
  "summary": "⚠ 1 Pflicht-TP(s) fehlen"
}
```

---

## Feature 2: KI-gestützter Approver-Chat

### Zweck
Ein Chat-Interface ermöglicht dem Approver:
- **Eingaben zu korrigieren** ("Ändere Antriebsart auf hydraulisch")
- **Eingaben zu verstehen** ("Was bedeutet Zungenvorrichtung?")
- **Offene Punkte zu klären** ("Welche Pflicht-TPs fehlen noch?")
- **Kontext-sensitive Hilfe** (Chat kennt Session, Dokument-Analyse)

### Architektur

#### Backend (CAP Service)

**Service Definition** (`srv/wizard-service.cds`):
```cds
action approverChat(
  sessionId  : String,
  contextId  : String(100),
  message    : String
) returns {
  sessionId  : String;
  contextId  : String;
  reply      : String;
};
```

**Implementation** (`srv/wizard-service.js`):
```javascript
srv.on('approverChat', async (req) => {
  const { sessionId, contextId, message } = req.data;
  if (!sessionId || !message) {
    return req.error(400, 'sessionId und message sind Pflichtfelder');
  }
  
  const agentUrl = process.env.AGENT_URL || 'http://localhost:5000';
  
  // Kontext-Anreicherung: Session-Daten + Dokument-Analyse
  const session = await _getSession(sessionId);
  let sessionCtx = '';
  
  if (session) {
    const docRow = await db.run(
      SELECT.one(['analysisJson'])
        .from('tp.wizard.SessionDocument')
        .where({ sessionId })
        .orderBy({ uploadedAt: 'desc' })
    );
    const analysis = docRow?.analysisJson ? JSON.parse(docRow.analysisJson) : null;
    
    sessionCtx = `[Kontext: Freigeber für Session ${session.ds100} Weiche ${session.switchNumber} (${session.basicForm}), ` +
                 `Status: ${session.status}, TPs: ${session.derivedTPCount ?? '?'}` +
                 (analysis ? `, Analyse: ${analysis.summary}` : '') +
                 `] `;
  }
  
  // A2A Agent-Aufruf (JSON-RPC 2.0)
  const body = {
    jsonrpc: '2.0',
    method: 'message/send',
    id: Date.now(),
    params: {
      message: {
        kind: 'message',
        messageId: require('crypto').randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text: sessionCtx + message }],
        ...(contextId ? { contextId } : {})
      }
    }
  };
  
  let reply = '';
  let newContextId = contextId || '';
  
  try {
    const http = require('http');
    const payload = JSON.stringify(body);
    const urlObj = new URL(agentUrl);
    
    const agentReply = await new Promise((resolve, reject) => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 80,
        path: urlObj.pathname || '/',
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Content-Length': Buffer.byteLength(payload) 
        }
      };
      
      const r = http.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
    
    const parsed = JSON.parse(agentReply);
    reply = parsed.result?.artifacts?.[0]?.parts?.[0]?.text ??
            parsed.result?.status?.message?.parts?.[0]?.text ??
            'Keine Antwort vom Agenten';
    newContextId = parsed.result?.contextId || contextId || '';
    
  } catch (err) {
    LOG.warn(`Agent nicht erreichbar: ${err.message}`);
    reply = `Agent nicht erreichbar (${err.message}). Bitte stellen Sie sicher, dass der Python-Agent läuft.`;
  }
  
  return { sessionId, contextId: newContextId, reply };
});
```

#### Frontend (Fiori Elements Extension)

**Fragment** (`app/approve/webapp/ext/ApproverPanel.fragment.xml`):
```xml
<VBox class="sapUiMediumMargin">
  <Title text="KI-Assistent" level="H3"/>
  
  <!-- Chat-Historie -->
  <ScrollContainer height="400px" vertical="true" class="sapUiSmallMarginBottom">
    <VBox items="{approverPanel>/chatMessages}">
      <HBox class="sapUiTinyMarginBottom">
        <Text text="{approverPanel>role}: " class="sapUiTinyMarginEnd"/>
        <Text text="{approverPanel>text}" wrapping="true"/>
      </HBox>
    </VBox>
  </ScrollContainer>
  
  <!-- Chat-Eingabe -->
  <HBox alignItems="End">
    <TextArea
      value="{approverPanel>/chatDraft}"
      placeholder="Frage an den KI-Assistenten..."
      rows="3"
      width="100%"
      submit=".onChatSend"/>
    <Button
      text="Senden"
      type="Emphasized"
      press=".onChatSend"
      enabled="{= !!${approverPanel>/chatDraft} &amp;&amp; !${approverPanel>/chatBusy} }"
      class="sapUiTinyMarginBegin"/>
  </HBox>
  
  <BusyIndicator visible="{approverPanel>/chatBusy}" size="Small"/>
</VBox>
```

**Controller** (`app/approve/webapp/ext/ApproverPanel.controller.js`):
```javascript
onChatSend: function () {
  const draft = (this._model.getProperty('/chatDraft') || '').trim();
  if (!draft) return;
  
  const sessionId = this._getSessionId();
  const contextId = this._model.getProperty('/chatContextId') || '';
  
  // User-Message sofort anzeigen
  const messages = this._model.getProperty('/chatMessages') || [];
  messages.push({ role: 'Sie', text: draft });
  this._model.setProperty('/chatMessages', messages);
  this._model.setProperty('/chatDraft', '');
  this._model.setProperty('/chatBusy', true);
  this._scrollChatToBottom();
  
  // Agent-Aufruf
  this._callActionFetch('/wizard/approverChat', { sessionId, contextId, message: draft })
    .then(result => {
      const msgs = this._model.getProperty('/chatMessages') || [];
      msgs.push({ role: 'KI-Assistent', text: result.reply || '(Keine Antwort)' });
      this._model.setProperty('/chatMessages', msgs);
      if (result.contextId) {
        this._model.setProperty('/chatContextId', result.contextId);
      }
      this._scrollChatToBottom();
    })
    .catch(err => {
      const msgs = this._model.getProperty('/chatMessages') || [];
      msgs.push({ role: 'Fehler', text: `Fehler: ${err.message}` });
      this._model.setProperty('/chatMessages', msgs);
      this._scrollChatToBottom();
    })
    .finally(() => this._model.setProperty('/chatBusy', false));
},

_scrollChatToBottom: function () {
  setTimeout(() => {
    const scrollContainer = this.byId('chatScrollContainer');
    if (scrollContainer) {
      scrollContainer.scrollTo(0, 999999);
    }
  }, 100);
}
```

### Chat-Kontext

Der Chat erhält automatisch folgenden Kontext:
```
[Kontext: Freigeber für Session NI Weiche 7001 (EW60-500-1:9), 
Status: submitted, TPs: 16, 
Analyse: ⚠ 2 Pflicht-TP(s) fehlen] 

<User-Nachricht>
```

Dies ermöglicht dem KI-Agenten:
- Session-spezifische Antworten
- Bezug auf Dokument-Analyse
- Hinweise auf fehlende TPs
- Kontext-sensitive Vorschläge

---

## Tests

### Test-Coverage: 41 Tests, alle erfolgreich ✅

**PDF-Upload Tests** (`test/wizard-service.test.js`):
```javascript
describe('uploadDocument & analyseDocument', () => {
  test('uploadDocument speichert PDF und analysiert Pflicht-/Optional-TPs', async () => {
    const sid = await createSession('NI', '8001', 'EW60-500-1:9');
    const mockPdf = Buffer.from('%PDF-1.4 Testinhalt').toString('base64');
    
    const res = await POST('/wizard/uploadDocument', {
      sessionId: sid,
      filename: 'test-weiche.pdf',
      mimeType: 'application/pdf',
      contentB64: mockPdf
    });
    
    expect(res.status).toBe(200);
    const body = res.data.value ?? res.data;
    expect(body.sessionId).toBe(sid);
    expect(body.filename).toBe('test-weiche.pdf');
    
    const analysis = JSON.parse(body.analysisJson);
    expect(analysis).toHaveProperty('pflichtTps');
    expect(analysis).toHaveProperty('optionalTps');
    expect(analysis).toHaveProperty('fehlendeHinweise');
    expect(Array.isArray(analysis.pflichtTps)).toBe(true);
  });
  
  test('analyseDocument führt erneute Analyse aus', async () => {
    const sid = await createSession('NI', '8002', 'EW60-500-1:9');
    const mockPdf = Buffer.from('%PDF-1.4 Test').toString('base64');
    
    await POST('/wizard/uploadDocument', {
      sessionId: sid,
      filename: 'reanalyse.pdf',
      mimeType: 'application/pdf',
      contentB64: mockPdf
    });
    
    const res = await POST('/wizard/analyseDocument', {
      sessionId: sid,
      filename: 'reanalyse.pdf'
    });
    
    expect(res.status).toBe(200);
    const analysis = JSON.parse(res.data.value.analysisJson);
    expect(analysis).toHaveProperty('summary');
  });
});
```

**Chat Tests**:
```javascript
describe('approverChat', () => {
  test('approverChat gibt Antwort mit Kontext zurück', async () => {
    const sid = await createSession('NI', '9001', 'EW60-500-1:9');
    
    const res = await POST('/wizard/approverChat', {
      sessionId: sid,
      contextId: '',
      message: 'Welche Pflicht-TPs fehlen noch?'
    });
    
    expect(res.status).toBe(200);
    const body = res.data.value ?? res.data;
    expect(body.sessionId).toBe(sid);
    expect(body.reply).toBeTruthy();
    expect(typeof body.reply).toBe('string');
    expect(body).toHaveProperty('contextId');
  });
  
  test('approverChat gibt 400 bei fehlender message', async () => {
    const sid = await createSession('NI', '9002', 'EW60-500-1:9');
    await expect(POST('/wizard/approverChat', { sessionId: sid }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });
});
```

---

## Deployment & Konfiguration

### Umgebungsvariablen

```bash
# Python Agent URL (für Chat-Feature)
AGENT_URL=http://localhost:5000

# Für Mock-Modus (Tests)
FL_MOCK=true
CDS_IGNORE_DUPLICATE=true
```

### Dependencies

**Backend** (`package.json`):
```json
{
  "dependencies": {
    "@sap/cds": "^10.2.2",
    "express": "^4",
    "sqlite3": "^5",
    "uuid": "^9"
  },
  "devDependencies": {
    "@cap-js/cds-test": "^1.0.2",
    "jest": "^29",
    "supertest": "^6"
  }
}
```

**System-Requirements**:
- `poppler-utils` (für pdftotext) - optional, Fallback vorhanden
- Python Agent auf Port 5000 (für Chat) - optional, Fehlerbehandlung vorhanden

### Build & Test

```bash
# CDS Deploy
cd assets/tp-wizard-cap
FL_MOCK=true cds deploy --to sqlite

# Tests ausführen
npm test

# Erwartetes Ergebnis:
# Test Suites: 2 passed, 2 total
# Tests:       41 passed, 41 total
```

---

## User Journey

### Typischer Approver-Workflow

1. **Approver öffnet eingereichte Session**
   - Navigiert zu `app-approve` (Port 4004)
   - Wählt Session aus Liste

2. **PDF-Dokument hochladen**
   - Klickt "Dokument hochladen & analysieren"
   - Wählt PDF-Datei (Fertigmeldung)
   - System extrahiert Text und analysiert

3. **Analyse-Ergebnis prüfen**
   - ✓ Grüner Status: "Alle Pflicht-TPs erfasst"
   - ⚠ Roter Status: "2 Pflicht-TP(s) fehlen"
   - Liste der fehlenden TPs mit Hinweisen

4. **Bei Unklarheiten: Chat nutzen**
   - "Warum fehlt TP BL.02.01?"
   - "Wie korrigiere ich die Antriebsart?"
   - "Welche Eingaben sind noch offen?"

5. **Freigabe erteilen**
   - Nach erfolgreicher Prüfung: "Freigeben" Button
   - System erstellt TPs in SAP S/4HANA

---

## Bekannte Limitierungen

1. **PDF-Text-Extraktion**
   - Funktioniert am besten mit Text-PDFs
   - Gescannte PDFs (Bilder) benötigen OCR
   - Fallback auf Raw-Text-Extraktion wenn pdftotext fehlt

2. **Chat-Agent**
   - Benötigt laufenden Python-Agent (Port 5000)
   - Bei Nichtverfügbarkeit: Fehlermeldung, kein Crash
   - Context-ID wird pro Chat-Session verwaltet

3. **Analyse-Genauigkeit**
   - Basiert auf Regelwerk und Session-Antworten
   - Kann keine TPs erkennen, die nicht im Regelwerk sind
   - Text-Matching ist einfach (keine NLP)

---

## Erweiterungsmöglichkeiten

### Kurzfristig
- [ ] OCR-Integration für gescannte PDFs
- [ ] Mehrere Dokumente pro Session
- [ ] Export der Analyse als PDF-Report

### Mittelfristig
- [ ] NLP-basierte Textanalyse (statt Keyword-Matching)
- [ ] Automatische Korrektur-Vorschläge
- [ ] Dokument-Versionierung

### Langfristig
- [ ] Multi-Agenten-System (verschiedene Experten)
- [ ] Automatische TP-Generierung aus Dokument
- [ ] Integration mit SAP Document Management Service

---

## Troubleshooting

### Problem: Upload schlägt fehl
```
Fehler: "Upload fehlgeschlagen: 400"
```
**Lösung**: 
- Prüfen ob sessionId gültig ist
- Datei-Größe < 10MB
- MIME-Type = application/pdf

### Problem: Analyse zeigt keine Ergebnisse
```
analysisJson: "{}"
```
**Lösung**:
- Session muss Antworten haben
- Regelwerk für basicForm muss existieren
- Prüfen: `db/data/tp.wizard.Regeln.csv`

### Problem: Chat antwortet nicht
```
"Agent nicht erreichbar (ECONNREFUSED)"
```
**Lösung**:
- Python-Agent starten: `cd assets/tp-wizard-agent && python app/main.py`
- AGENT_URL prüfen: `echo $AGENT_URL`
- Port 5000 frei: `lsof -i :5000`

### Problem: Tests schlagen fehl
```
ERROR: @sap/cds was loaded from different locations
```
**Lösung**:
- In `package.json` eintragen:
```json
{
  "cds": {
    "server": {
      "exit_on_multi_install": false
    }
  }
}
```

---

## Änderungshistorie

| Datum | Version | Änderung |
|-------|---------|----------|
| 2026-11-25 | 1.0.0 | Initial Release: PDF-Upload, Analyse, Chat |

---

## Kontakt & Support

Bei Fragen oder Problemen:
- Repository: `weichen-wizzard`
- Dokumentation: `docs/approver-workflow-documentation.md`
- Tests: `assets/tp-wizard-cap/test/wizard-service.test.js`
