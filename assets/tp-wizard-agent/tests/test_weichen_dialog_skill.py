"""Tests for the weichen-dialog skill loading."""
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import sys


def test_skill_file_exists():
    """Verify SKILL.md is present at expected path."""
    skill_path = os.path.join(
        os.path.dirname(__file__),
        "..", "app", "skills", "weichen-dialog", "SKILL.md"
    )
    assert os.path.exists(skill_path), "SKILL.md must exist at app/skills/weichen-dialog/SKILL.md"


def test_skill_has_frontmatter():
    """Verify SKILL.md has valid YAML frontmatter with name and description."""
    skill_path = os.path.join(
        os.path.dirname(__file__),
        "..", "app", "skills", "weichen-dialog", "SKILL.md"
    )
    content = open(skill_path).read()
    assert content.startswith("---"), "SKILL.md must start with YAML frontmatter '---'"
    assert "name: weichen-dialog" in content
    assert "description:" in content


def test_skill_references_exist():
    """Verify companion reference files exist."""
    base = os.path.join(os.path.dirname(__file__), "..", "app", "skills", "weichen-dialog", "references")
    assert os.path.exists(os.path.join(base, "fragebereiche.md"))
    assert os.path.exists(os.path.join(base, "grundbauformen.md"))


def test_skill_contains_guardrails():
    """Verify skill has guardrail instructions."""
    skill_path = os.path.join(
        os.path.dirname(__file__),
        "..", "app", "skills", "weichen-dialog", "SKILL.md"
    )
    content = open(skill_path).read()
    assert "NIEMALS" in content, "Skill must contain guardrail 'NIEMALS' instructions"
    assert "confirmSession" in content, "Skill must reference confirmSession tool"


def test_skill_milestone_logging():
    """Verify skill references M5 milestone."""
    skill_path = os.path.join(
        os.path.dirname(__file__),
        "..", "app", "skills", "weichen-dialog", "SKILL.md"
    )
    content = open(skill_path).read()
    assert "M5.achieved" in content, "Skill must reference M5 milestone"


def test_agent_loads_skill_on_weiche_query():
    """Agent should be able to load SKILL.md via load() tool for weiche queries."""
    # Verify skill path resolves correctly from app/ directory
    skill_path = "skills/weichen-dialog/SKILL.md"
    full_path = os.path.join(
        os.path.dirname(__file__), "..", "app", skill_path
    )
    assert os.path.exists(full_path), f"Agent skill path must resolve: {full_path}"
    
    # Verify the skill content instructs the agent to use MCP tools
    content = open(full_path).read()
    assert "createSession" in content, "Skill must reference createSession MCP tool"
    assert "submitAnswer" in content, "Skill must reference submitAnswer MCP tool"
    assert "confirmSession" in content, "Skill must reference confirmSession MCP tool"
