"""Tests for natural language entity extraction patterns."""
import re
import pytest


def extract_grundbauform(text: str) -> str | None:
    """Extract Grundbauform from natural language input."""
    mapping = {
        r'einfache\s+weiche\s+links': 'EWL',
        r'einfache\s+weiche\s+rechts': 'EWR',
        r'doppelte\s+kreuzungsweiche': 'DKW',
        r'dkw': 'DKW',
        r'einfache\s+kreuzungsweiche': 'EKW',
        r'innenbogenweiche': 'IBW',
        r'dreiwegweiche': 'DW',
        r'außenbogenweiche': 'ABW',
    }
    text_lower = text.lower()
    for pattern, form in mapping.items():
        if re.search(pattern, text_lower):
            return form
    return None


def extract_antriebe(text: str) -> int | None:
    """Extract number of Antriebe from natural language."""
    match = re.search(r'(\d+)\s*(?:antriebe?|antrieb)', text.lower())
    return int(match.group(1)) if match else None


def extract_heizung(text: str) -> str | None:
    """Extract heating type from natural language."""
    text_lower = text.lower()
    if 'elektrisch' in text_lower or 'eeh' in text_lower:
        return 'elektrisch'
    if 'gas' in text_lower or 'ghe' in text_lower:
        return 'gas'
    if 'öl' in text_lower or 'odh' in text_lower:
        return 'öl'
    if 'dampf' in text_lower or 'sph' in text_lower:
        return 'dampf'
    return None


# ── Tests ────────────────────────────────────────────────────────────────────

def test_extract_einfache_weiche_links():
    assert extract_grundbauform("Ich möchte eine einfache Weiche links anlegen") == 'EWL'


def test_extract_einfache_weiche_rechts():
    assert extract_grundbauform("einfache Weiche rechts, 2 Antriebe") == 'EWR'


def test_extract_dkw():
    assert extract_grundbauform("Bitte DKW anlegen") == 'DKW'


def test_extract_doppelte_kreuzungsweiche():
    assert extract_grundbauform("Doppelte Kreuzungsweiche mit Heizung") == 'DKW'


def test_no_grundbauform():
    assert extract_grundbauform("Ich habe eine Frage") is None


def test_extract_2_antriebe():
    assert extract_antriebe("einfache Weiche links, 2 Antriebe, 4 Isolierstöße") == 2


def test_extract_1_antrieb():
    assert extract_antriebe("1 Antrieb, elektrische Heizung") == 1


def test_no_antriebe():
    assert extract_antriebe("einfache Weiche ohne weitere Details") is None


def test_extract_elektrische_heizung():
    assert extract_heizung("elektrische Heizung") == 'elektrisch'


def test_extract_gas_heizung():
    assert extract_heizung("mit Gasheizung") == 'gas'


def test_extract_no_heizung():
    assert extract_heizung("keine Heizung vorhanden") is None


def test_full_free_text_extraction():
    """Test full entity extraction from typical user input."""
    text = "Ich möchte eine einfache Weiche links anlegen, 2 Antriebe, elektrische Heizung"
    assert extract_grundbauform(text) == 'EWL'
    assert extract_antriebe(text) == 2
    assert extract_heizung(text) == 'elektrisch'


def test_partial_extraction_triggers_followup():
    """Partial extraction should leave some attributes as None → follow-up needed."""
    text = "einfache Weiche links"
    grundbauform = extract_grundbauform(text)
    antriebe = extract_antriebe(text)
    heizung = extract_heizung(text)
    
    assert grundbauform == 'EWL'  # known
    assert antriebe is None       # unknown → follow-up question needed
    assert heizung is None        # unknown → follow-up question needed
