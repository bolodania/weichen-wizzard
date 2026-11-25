"""CAP tool response formatting."""
import json

MCP_MAX_RESPONSE_CHARS = 30_000

def minify_json(text: str) -> str:
    """Return a whitespace-stripped form of ``text`` if it is valid JSON.

    Pretty-printed JSON carries indentation and spacing that cost tokens on every
    turn the result stays in context. Re-serializing with compact separators is
    lossless and typically saves ~30%. Non-JSON input is returned
    unchanged.
    """
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        return text
    return json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)


def truncate_response(text: str, max_chars: int = MCP_MAX_RESPONSE_CHARS) -> str:
    """Truncate ``text`` to ``max_chars``, cutting at a structural boundary.

    A raw character cut can leave the model with a half-written JSON object or a
    token split mid-word. When possible we back up to the last newline, comma, or
    whitespace before the limit so the truncated output ends cleanly. A marker is
    always appended so the model knows content was dropped.
    """
    if len(text) <= max_chars:
        return text
    window = text[:max_chars]
    # Back up to the last clean boundary within the final 10% of the window so we
    # never cut mid-token; fall back to the hard cut if none is found.
    floor = int(max_chars * 0.9)
    boundary = max(window.rfind("\n"), window.rfind(","), window.rfind(" "))
    if boundary >= floor:
        window = window[:boundary]
    return window + "\n...[truncated]"


