"""Tests für die Fertigmeldungs-/Zitatpflicht-Verdrahtung des Agenten.

Die eigentliche verbatim-Prüfung liegt im CAP-Backend (dort getestet). Hier wird
sichergestellt, dass Skill und MCP-Vertrag den Agenten auf applyDocumentValues mit
wörtlicher Textstelle festlegen.
"""
import json
import os

BASE = os.path.join(os.path.dirname(__file__), "..")
SKILL = os.path.join(BASE, "app", "skills", "weichen-dialog", "SKILL.md")
MCP = os.path.join(BASE, "cap-tools.json")


def test_skill_requires_citation_for_document_values():
    content = open(SKILL, encoding="utf-8").read()
    assert "applyDocumentValues" in content, "Skill muss applyDocumentValues referenzieren"
    assert "Textstelle" in content, "Skill muss die wörtliche Textstelle fordern"
    assert "Fertigmeldung" in content


def test_skill_forbids_inventing_values():
    content = open(SKILL, encoding="utf-8").read()
    assert "Erfinde niemals" in content or "erfinde niemals" in content


def test_mcp_mock_exposes_applyDocumentValues():
    tools = json.load(open(MCP, encoding="utf-8"))["servers"]["tp-wizard-cap"]["tools"]
    assert "applyDocumentValues" in tools, "MCP-Vertrag muss applyDocumentValues anbieten"
    tool = tools["applyDocumentValues"]
    assert "values" in tool["input_schema"]["properties"]
    assert set(tool["input_schema"]["required"]) >= {"sessionId", "values"}


def test_mcp_mock_still_hides_approveSession():
    """approveSession bleibt dem Agenten vorenthalten (Thomas-only)."""
    tools = json.load(open(MCP, encoding="utf-8"))["servers"]["tp-wizard-cap"]["tools"]
    assert "approveSession" not in tools
    assert "confirmSession" not in tools
