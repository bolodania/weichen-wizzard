"""Exercise actual prompts, tool definitions and failed-turn behavior without LLM access."""
import json
from pathlib import Path
from unittest.mock import AsyncMock
import pytest


@pytest.fixture
def modules(add_agent_to_path):
    import agent
    from mcp_providers import cap
    return agent, cap


async def test_prompt_loads_existing_instruction(modules):
    agent, cap = modules
    from load_skill_resources import _load
    assert 'load("weichen-dialog/SKILL.md")' in agent.get_system_prompt()
    assert not (await _load('weichen-dialog/SKILL.md')).startswith('Error:')
    mode = cap.wizard_mode.set('review')
    try:
        assert 'approver-assist/SKILL.md' in agent.get_system_prompt()
    finally:
        cap.wizard_mode.reset(mode)


async def test_field_can_submit_with_defaults_but_neither_mode_can_approve(modules):
    _, cap = modules
    field = {tool.name for tool in await cap.get_cap_tools('field')}
    review = {tool.name for tool in await cap.get_cap_tools('review')}
    assert 'applyDocumentValues' in field
    assert 'editAnswer' not in field
    assert 'createSession' not in review
    assert 'bulkSubmitWithDefaults' in field
    assert 'bulkSubmitWithDefaults' not in review
    for tools in [field, review]:
        assert not tools & {'submitSession', 'approveSession'}


def test_field_prompt_allows_explicit_default_submission_only(modules):
    agent, cap = modules
    mode = cap.wizard_mode.set('field')
    try:
        prompt = agent.get_system_prompt()
        assert 'bulkSubmitWithDefaults' in prompt
        assert 'release with default values' in prompt
        assert 'nur nach erfolgreichem Tool-Ergebnis' in prompt
        assert 'Niemals endgültig freigeben' in prompt
        assert 'niemals einreichen' not in prompt
    finally:
        cap.wizard_mode.reset(mode)


async def test_failed_turn_is_not_successful_completion(modules):
    agent, _ = modules
    instance = object.__new__(agent.SampleAgent)
    instance._invoke_with_fallback = AsyncMock(side_effect=RuntimeError('upstream failed'))
    chunks = [chunk async for chunk in instance.stream('hello', 'context', tools=[])]
    assert chunks[-1]['failed'] is True
    assert 'upstream failed' not in chunks[-1]['content']


def test_tools_reference_declared_cap_operations():
    root = Path(__file__).resolve().parents[3]
    definitions = json.loads((root / 'assets/tp-wizard-agent/cap-tools.json').read_text())['servers']['tp-wizard-cap']['tools']
    cds = (root / 'assets/tp-wizard-cap/srv/wizard-service.cds').read_text()
    for name, definition in definitions.items():
        assert f'action {name}(' in cds or f'function {name}(' in cds
        assert definition['http_endpoint'].startswith('/wizard/')