'use strict';

// ===========================================================================
// Reine, deterministische TP-Ableitung aus dem Regelwerk.
// Keine DB-, Netz-, Zeit- oder Zufallszugriffe: gleiche Eingaben -> gleiches
// Ergebnis. Das ist die Invariante, auf der die Golden-Tests beruhen.
//
// Eingang:  katalog (Eingaben/Regeln/Forla), kopf (Weichenkopf), angaben-Map.
// Ausgang:  { plaetze, angaben, offeneAngaben, hinweise }.
// ===========================================================================

const OPERATOREN = ['EQ', 'NE', 'IN', 'BT', 'GE', 'GT', 'LE', 'LT', 'HAS'];
const UND = ' UND ';
const WURZEL_REGEL = 1;

// --- Bedingungsgrammatik: "angabe OP wert [ UND angabe OP wert ...]" ---------
function parseBedingungen(text) {
  if (!text) return [];
  return text.split(UND).map((teil) => {
    const stueck = teil.trim().split(/\s+/);
    const [angabe, operator, ...rest] = stueck;
    if (!OPERATOREN.includes(operator)) {
      throw new Error(`Unbekannter Operator "${operator}" in "${text}"`);
    }
    return { angabe, operator, wert: rest.join(' ') };
  });
}

// --- Dreiwert-Auswertung: true | false | null (null = unbestimmt/fehlt) ------
function erfuellt(angaben, bedingungen) {
  let fehlt = false;
  for (const b of bedingungen) {
    const v = angaben[b.angabe];
    const w = typeof b.wert === 'string' && b.wert.startsWith('@') ? angaben[b.wert.slice(1)] : b.wert;
    if (b.operator !== 'HAS' && (v === undefined || v === '' || w === undefined)) {
      fehlt = true;
      continue;
    }
    let ok;
    switch (b.operator) {
      case 'HAS': ok = (v ?? '').split(';').includes(w); break;
      case 'EQ': ok = v === w; break;
      case 'NE': ok = v !== w; break;
      case 'IN': ok = String(w).split(';').includes(v); break;
      case 'BT': {
        const [lo, hi] = String(w).split(';').map(Number);
        ok = Number(v) >= lo && Number(v) <= hi;
        break;
      }
      case 'GE': ok = Number(v) >= Number(w); break;
      case 'GT': ok = Number(v) > Number(w); break;
      case 'LE': ok = Number(v) <= Number(w); break;
      case 'LT': ok = Number(v) < Number(w); break;
      default: throw new Error(`Unbekannter Operator "${b.operator}"`);
    }
    if (!ok) return false;
  }
  return fehlt ? null : true;
}

function istSichtbar(eingabe, angaben) {
  if (!eingabe.sichtbarWenn) return true;
  return erfuellt(angaben, parseBedingungen(eingabe.sichtbarWenn)) !== false;
}

// --- Angaben vervollständigen: Rohwerte -> Vorgaben -> Formeln ---------------
function vervollstaendige(katalog, eingabe) {
  const angaben = {};
  for (const [k, v] of Object.entries(eingabe)) {
    if (v !== undefined && v !== null && v !== '') angaben[k] = String(v);
  }
  for (const e of katalog.eingaben) {
    if (!e.formel && e.vorgabe && angaben[e.ID] === undefined) angaben[e.ID] = e.vorgabe;
  }
  for (const e of katalog.eingaben) {
    if (e.formel) angaben[e.ID] = erfuellt(angaben, parseBedingungen(e.formel)) ? 'Ja' : 'Nein';
  }
  return angaben;
}

function offeneAngaben(katalog, angaben) {
  const offen = [];
  for (const e of katalog.eingaben) {
    if (e.formel) continue;
    if (!e.fuerTpNoetig) continue;
    if (e.typ === 'Einbauorte') continue;
    if (angaben[e.ID] !== undefined && angaben[e.ID] !== '') continue;
    if (!istSichtbar(e, angaben)) continue;
    offen.push(e.ID);
  }
  return offen;
}

// --- Laufnummern & Muster ----------------------------------------------------
function laufnummernMuster(eltern) {
  const escaped = eltern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/#/g, '\\d');
  return new RegExp(`^${escaped}$`);
}

// Erstinstanz-Muster für den Forla-Lookup: jede #-Gruppe -> 1 (passend aufgefüllt)
function forlaMuster(muster) {
  return muster.replace(/#+/g, (m) => '1'.padStart(m.length, '0'));
}

function schluessel(kopf, suffix) {
  const bst = (kopf.betriebsstelle || '').padEnd(7, '-');
  const nr = (kopf.weichennummer || '').padStart(7, '-');
  return `${bst}WE${nr}${suffix}`;
}

function wurzelPlatz(kopf, regel) {
  return {
    suffix: '',
    elternSuffix: null,
    schluessel: schluessel(kopf, ''),
    bezeichnung: 'Weiche, Kreuzungsweiche',
    positionsnummer: '0000',
    planergruppe: '',
    klassen: '',
    bereich: (regel && regel.bereich) || 'Weiche',
    regel: regel ? regel.nr : WURZEL_REGEL,
    muster: '',
    automatisch: true,
    nummer: null,
  };
}

function platzAnlegen(katalog, kopf, regel, suffix, elternSuffix, nummer) {
  const forla = katalog.forla.get(forlaMuster(regel.muster));
  const roh = (forla && forla.bezeichnung) || regel.muster;
  const bezeichnung = nummer === null ? roh : roh.replace(/\bN\b/, String(nummer));
  return {
    suffix,
    elternSuffix,
    schluessel: schluessel(kopf, suffix),
    bezeichnung,
    positionsnummer: (forla && forla.positionsnummer) || '',
    planergruppe: (forla && forla.planergruppe) || '',
    klassen: (forla && forla.klassen) || '',
    bereich: regel.bereich || '',
    regel: regel.nr,
    muster: regel.muster,
    automatisch: (regel.bedingungen || []).length === 0,
    nummer,
  };
}

// Tiefensuche: Eltern vor Kindern, Geschwister nach Positionsnummer dann Suffix.
// Setzt zugleich die Ebene (0 = oberste sichtbare Ebene, Wurzel ist entfernt).
function baumreihenfolge(liste) {
  const kinder = new Map();
  for (const p of liste) {
    const key = p.elternSuffix === null || p.elternSuffix === undefined ? '' : p.elternSuffix;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key).push(p);
  }
  for (const arr of kinder.values()) {
    arr.sort(
      (a, b) =>
        (a.positionsnummer || '').localeCompare(b.positionsnummer || '') ||
        a.suffix.localeCompare(b.suffix),
    );
  }
  const ergebnis = [];
  const gesehen = new Set();
  (function besuche(elternKey, ebene) {
    for (const p of kinder.get(elternKey) || []) {
      p.ebene = ebene;
      ergebnis.push(p);
      gesehen.add(p);
      besuche(p.suffix, ebene + 1);
    }
  })('', 0);
  for (const p of liste) {
    if (!gesehen.has(p)) {
      p.ebene = 0;
      ergebnis.push(p);
    }
  }
  return ergebnis;
}

// --- Hauptfunktion -----------------------------------------------------------
function ableiten(katalog, kopf, eingabe) {
  const angaben = vervollstaendige(katalog, eingabe);
  const hinweise = [];
  const plaetze = new Map(); // suffix -> Platz
  const grundbauform = kopf.grundbauform || 'EWR';

  const wurzel = katalog.regeln.find((r) => r.nr === WURZEL_REGEL);
  plaetze.set('', wurzelPlatz(kopf, wurzel));

  const sortierte = [...katalog.regeln].sort((a, b) => a.nr - b.nr);
  for (const regel of sortierte) {
    if (regel.nr === WURZEL_REGEL) continue;

    const formen = (regel.giltFuer || '').split(/[;, ]+/).filter(Boolean);
    if (formen.length && !formen.includes(grundbauform)) continue;

    if (!regel.muster.startsWith(regel.eltern)) {
      hinweise.push(`Regel ${regel.nr}: Muster "${regel.muster}" beginnt nicht mit Eltern "${regel.eltern}"`);
      continue;
    }

    const status = erfuellt(angaben, regel.bedingungen || []);
    if (status === false) continue;
    if (status === null) {
      hinweise.push(`Regel ${regel.nr} wartet auf eine offene Angabe`);
      continue;
    }

    const elternRegex = laufnummernMuster(regel.eltern);
    const elternKeys = [...plaetze.keys()].filter((k) => elternRegex.test(k));
    if (elternKeys.length === 0) {
      if ((regel.bedingungen || []).length) hinweise.push(`Elternplatz für Regel ${regel.nr} fehlt`);
      continue;
    }

    let anzahl;
    if (/^\d+$/.test(regel.anzahl)) {
      anzahl = parseInt(regel.anzahl, 10);
    } else {
      const wert = angaben[regel.anzahl];
      if (wert === undefined || wert === '') {
        hinweise.push(`Anzahl "${regel.anzahl}" für Regel ${regel.nr} ist offen`);
        continue;
      }
      anzahl = parseInt(wert, 10);
    }
    if (!Number.isFinite(anzahl) || anzahl <= 0) continue;

    const rest = regel.muster.slice(regel.eltern.length);
    const start = regel.start || 1;
    const eigeneNummer = rest.includes('#');

    for (const pk of elternKeys) {
      for (let i = 0; i < anzahl; i++) {
        const nummer = start + i;
        const restMat = rest.replace(/#+/g, (m) => String(nummer).padStart(m.length, '0'));
        const suffix = pk + restMat;
        if (!plaetze.has(suffix)) {
          plaetze.set(suffix, platzAnlegen(katalog, kopf, regel, suffix, pk, eigeneNummer ? nummer : null));
        }
      }
    }
  }

  plaetze.delete('');
  const liste = baumreihenfolge([...plaetze.values()]);
  return {
    plaetze: liste,
    angaben,
    offeneAngaben: offeneAngaben(katalog, angaben),
    hinweise,
  };
}

module.exports = {
  OPERATOREN,
  ableiten,
  erfuellt,
  istSichtbar,
  vervollstaendige,
  offeneAngaben,
  parseBedingungen,
  forlaMuster,
  schluessel,
  wurzelPlatz,
};
