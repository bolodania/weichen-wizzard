'use strict';

const { ableiten, istSichtbar, vervollstaendige, schluessel } = require('./engine');

// ===========================================================================
// CAP-Glue rund um die reine Engine: Zustand einer Session -> Angaben-Map,
// Ableitung in die DerivedTP-Form, nächste Frage, Vorgaben, Wertprüfung,
// Übernahme von Dokumentwerten mit wörtlicher Textstelle, Validierung.
// ===========================================================================

function kopfVon(session) {
  return {
    betriebsstelle: session.ds100 || '',
    weichennummer: session.switchNumber || '',
    grundbauform: session.basicForm || 'EWR',
  };
}

function angabenMap(session) {
  const m = {};
  for (const a of session.answers || []) {
    if (a.answer !== undefined && a.answer !== null && a.answer !== '') m[a.questionId] = String(a.answer);
  }
  if (session.basicForm) m.grundbauform = session.basicForm;
  return m;
}

// Ableitung für eine Session -> TPs in DerivedTP-Form + offene Angaben + Hinweise.
function ableitenTps(katalog, session) {
  const kopf = kopfVon(session);
  const erg = ableiten(katalog, kopf, angabenMap(session));
  const hinweise = [...erg.hinweise];
  if (kopf.grundbauform !== 'EWR') {
    hinweise.unshift(
      `Für Grundbauform "${kopf.grundbauform}" liegt noch kein Regelwerk vor — es werden keine TPs abgeleitet.`,
    );
  }
  const tps = erg.plaetze.map((p) => ({
    tpKey: p.schluessel,
    posNr: p.positionsnummer,
    tpLabel: p.bezeichnung,
    area: p.bereich,
    level: p.ebene,
    parentTpKey: p.elternSuffix && p.elternSuffix !== '' ? schluessel(kopf, p.elternSuffix) : null,
    isAutomatic: p.automatisch,
    planergruppe: p.planergruppe,
    klassen: p.klassen,
    regel: p.regel,
    muster: p.muster,
  }));
  return { tps, offeneAngaben: erg.offeneAngaben, hinweise, angaben: erg.angaben };
}

function mapFrage(e) {
  return {
    id: e.ID,
    area: e.bereich,
    areaName: e.bereich,
    text: e.frage,
    answerType: e.typ,
    options: e.werte ? e.werte.split(';').filter(Boolean) : [],
    required: !!e.fuerTpNoetig,
    isAutomatic: false,
  };
}

// Nächste zu stellende Frage: erste nicht abgeleitete, sichtbare, noch nicht
// beantwortete Angabe in Katalogreihenfolge (grundbauform kommt aus basicForm).
function naechsteFrage(katalog, session) {
  const beantwortet = new Set((session.answers || []).map((a) => a.questionId));
  beantwortet.add('grundbauform');
  const angaben = vervollstaendige(katalog, angabenMap(session));
  for (const e of katalog.eingaben) {
    if (e.formel) continue;
    if (beantwortet.has(e.ID)) continue;
    if (!istSichtbar(e, angaben)) continue;
    return mapFrage(e);
  }
  return null;
}

// Vorgaben (Standardwerte) aus dem Eingabenkatalog — nur dort, wo ein Regelwerk existiert.
function vorgaben(katalog, grundbauform) {
  if (grundbauform && grundbauform !== 'EWR') return [];
  return katalog.eingaben
    .filter((e) => !e.formel && e.vorgabe)
    .map((e) => ({
      questionId: e.ID,
      defaultAnswer: e.vorgabe,
      confidence: 'medium',
      rationale: `Vorgabe aus dem Regelwerk (${e.bereich})`,
    }));
}

function normalisiereWert(e, wert) {
  if (wert === undefined || wert === null) return null;
  const w = String(wert).trim();
  if (w === '') return null;
  if (e.typ === 'JaNein') {
    if (/^(ja|true|yes|vorhanden)$/i.test(w)) return 'Ja';
    if (/^(nein|false|no|ohne|keine?)$/i.test(w)) return 'Nein';
    return w;
  }
  if (e.typ === 'Auswahl' || e.typ === 'Einbauorte') {
    const erlaubt = (e.werte || '').split(';').map((s) => s.trim()).filter(Boolean);
    const treffer = (tok) => erlaubt.find((a) => a.toLowerCase() === tok.trim().toLowerCase()) || tok.trim();
    return w.split(';').map(treffer).join(';');
  }
  return w;
}

// Gibt eine deutsche Fehlermeldung zurück oder null, wenn der Wert zum Typ passt.
function pruefeWert(e, wert) {
  const w = String(wert ?? '').trim();
  switch (e.typ) {
    case 'Menge':
      return /^\d{1,3}$/.test(w) ? null : `"${wert}" ist ungültig für ${e.ID}: erwartet eine ganze Zahl ab 0`;
    case 'Zahl':
      return /^\d+(\.\d+)?$/.test(w) ? null : `"${wert}" ist ungültig für ${e.ID}: erwartet eine Zahl`;
    case 'JaNein':
      return w === 'Ja' || w === 'Nein' ? null : `"${wert}" ist ungültig für ${e.ID}: erwartet Ja oder Nein`;
    case 'Auswahl': {
      const erlaubt = (e.werte || '').split(';').map((s) => s.trim()).filter(Boolean);
      if (!erlaubt.length || erlaubt.some((v) => v.startsWith('['))) return null;
      return erlaubt.includes(w) ? null : `"${wert}" ist ungültig für ${e.ID}: erlaubt ${erlaubt.join(', ')}`;
    }
    case 'Einbauorte': {
      const erlaubt = (e.werte || '').split(';').map((s) => s.trim()).filter(Boolean);
      if (!erlaubt.length) return null;
      const unbekannt = w.split(';').map((s) => s.trim()).filter(Boolean).filter((t) => !erlaubt.includes(t));
      return unbekannt.length ? `Unbekannte Einbauorte für ${e.ID}: ${unbekannt.join(', ')}` : null;
    }
    default:
      return null;
  }
}

// Für den verbatim-Abgleich: Anführungszeichen entfernen, Whitespace normalisieren, klein.
function normalisiert(s) {
  return String(s || '').replace(/[„“"”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Übernimmt vom Agenten aus der Fertigmeldung gelesene Werte — nur mit gültiger,
// wörtlich im Fertigmeldungstext vorkommender Textstelle und gültigem Wert.
function uebernehmeDokumentwerte(katalog, session, werte) {
  const eingabeById = new Map(katalog.eingaben.map((e) => [e.ID, e]));
  const fertNorm = normalisiert(session.fertigmeldung);
  const uebernommen = [];
  const abgelehnt = [];
  for (const w of werte || []) {
    const e = eingabeById.get(w.angabe);
    if (!e) {
      abgelehnt.push({ angabe: w.angabe, grund: 'Unbekannte Angabe' });
      continue;
    }
    const norm = normalisiereWert(e, w.wert);
    const fehler = pruefeWert(e, norm);
    if (fehler) {
      abgelehnt.push({ angabe: w.angabe, grund: fehler });
      continue;
    }
    if (!session.fertigmeldung) {
      abgelehnt.push({ angabe: w.angabe, grund: 'Keine Fertigmeldung hinterlegt' });
      continue;
    }
    if (!w.textstelle || !fertNorm.includes(normalisiert(w.textstelle))) {
      abgelehnt.push({ angabe: w.angabe, grund: `Textstelle „${w.textstelle || ''}" steht nicht in der Fertigmeldung` });
      continue;
    }
    uebernommen.push({
      questionId: w.angabe,
      answer: norm,
      source: 'agent',
      herkunft: 'Dokument',
      beleg: `Textstelle: „${w.textstelle}"`,
    });
  }
  return { uebernommen, abgelehnt };
}

function validiere(tps) {
  const warnings = [];
  for (const tp of tps) if (!tp.tpKey) warnings.push(`TP ohne Schlüssel: ${tp.tpLabel || '?'}`);
  return { valid: warnings.length === 0, warnings };
}

module.exports = {
  kopfVon,
  angabenMap,
  ableitenTps,
  naechsteFrage,
  vorgaben,
  normalisiereWert,
  pruefeWert,
  uebernehmeDokumentwerte,
  validiere,
};
