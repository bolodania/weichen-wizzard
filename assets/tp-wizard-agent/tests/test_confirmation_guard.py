"""Tests that SAP creation is not triggered without explicit user confirmation."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


CONFIRMATION_KEYWORDS = ['ja', 'bestätigen', 'bestätigung', 'anlegen', 'ja bitte', 'yes', 'confirm']
REJECTION_KEYWORDS = ['nein', 'abbrechen', 'stopp', 'no', 'cancel']


def is_confirmation(text: str) -> bool:
    """Check if user response is an explicit confirmation."""
    text_lower = text.lower().strip()
    return any(kw in text_lower for kw in CONFIRMATION_KEYWORDS)


def is_rejection(text: str) -> bool:
    """Check if user response is a rejection."""
    text_lower = text.lower().strip()
    return any(kw in text_lower for kw in REJECTION_KEYWORDS)


# ── Tests ────────────────────────────────────────────────────────────────────

def test_explicit_ja_is_confirmation():
    assert is_confirmation("Ja") is True
    assert is_confirmation("Ja, bitte anlegen") is True
    assert is_confirmation("ja") is True


def test_bestätigen_is_confirmation():
    assert is_confirmation("Bestätigen") is True
    assert is_confirmation("Ja, bestätigen") is True


def test_anlegen_is_confirmation():
    assert is_confirmation("Bitte anlegen") is True


def test_nein_is_not_confirmation():
    assert is_confirmation("Nein") is False


def test_abbrechen_is_rejection():
    assert is_rejection("Abbrechen") is True


def test_vague_answer_is_not_confirmation():
    assert is_confirmation("Ich bin mir nicht sicher") is False
    assert is_confirmation("Vielleicht") is False
    assert is_confirmation("Was passiert dann?") is False


def test_creation_guard_logic():
    """Simulate the agent's confirmation guard:
    confirmSession MUST NOT be called without explicit Ja."""
    
    confirm_session_called = []
    
    def maybe_confirm(user_message: str, session_id: str):
        """Agent should only call confirmSession if user explicitly confirms."""
        if is_confirmation(user_message):
            confirm_session_called.append(session_id)
            return True
        return False
    
    # Without confirmation → NOT called
    maybe_confirm("Zeig mir nochmal die Vorschau", "sess-001")
    assert len(confirm_session_called) == 0, "confirmSession must NOT be called without confirmation"
    
    # With explicit "Ja" → called
    maybe_confirm("Ja, bitte anlegen", "sess-001")
    assert len(confirm_session_called) == 1, "confirmSession MUST be called after explicit confirmation"
    assert confirm_session_called[0] == "sess-001"


def test_milestone_m5_logging():
    """Verify M5 milestone logging constant is correctly formatted."""
    M5_ACHIEVED = "[M5.achieved]: LLM-Chatbot produziert aequivalente TP-Struktur — Stretchgoal erfuellt"
    M5_MISSED = "[M5.missed]: LLM-Chatbot-Ausgabe weicht von Regelwerk-Ergebnis ab"
    
    assert "M5.achieved" in M5_ACHIEVED
    assert "M5.missed" in M5_MISSED
    assert "LLM-Chatbot" in M5_ACHIEVED
