"""Direct CAP tools and per-request conversation identity. No Agent Gateway."""

import json
import logging
import os
import base64
from contextvars import ContextVar, Token
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from xsuaa_auth import cap_headers, enabled
from langchain_core.tools import BaseTool, StructuredTool
from pydantic import Field, create_model
from util import minify_json, truncate_response

logger = logging.getLogger(__name__)

# Per-request user token, set by JWTContextMiddleware via set_user_token()
_user_token_context: ContextVar[str | None] = ContextVar("user_token", default=None)

_TOOLS_FILE = Path(__file__).parent.parent.parent / "cap-tools.json"


def set_user_token(token: str | None) -> Token:
    """Set the user token for the current async context (called by JWTContextMiddleware)."""
    return _user_token_context.set(token)


def _build_cap_tools() -> list[BaseTool]:
    """Build HTTP-backed LangChain tools from the checked-in CAP tool catalog."""
    tool_data = json.loads(_TOOLS_FILE.read_text(encoding="utf-8"))

    tools: list[BaseTool] = []

    for _server_slug, server in tool_data.get("servers", {}).items():
        for tool_name, tool_def in server.get("tools", {}).items():
            description = tool_def.get("description", "")
            input_schema = tool_def.get("input_schema", {})

            props = input_schema.get("properties", {})
            required_fields = set(input_schema.get("required", []))
            field_definitions: dict[str, Any] = {}
            for field_name, field_info in props.items():
                json_type = field_info.get("type", "string")
                if json_type == "integer":
                    python_type: type = int
                elif json_type == "number":
                    python_type = float
                elif json_type == "boolean":
                    python_type = bool
                else:
                    python_type = str

                if field_name in required_fields:
                    field_definitions[field_name] = (
                        python_type,
                        Field(description=field_info.get("description", "")),
                    )
                else:
                    field_definitions[field_name] = (
                        python_type,
                        Field(default=None, description=field_info.get("description", "")),
                    )

            args_schema = (
                create_model(f"{tool_name}_args", **field_definitions)
                if field_definitions
                else create_model(f"{tool_name}_args")
            )

            if "http_endpoint" in tool_def:
                _endpoint = tool_def["http_endpoint"]
                _method = tool_def.get("http_method", "GET").upper()
                _filter_fields: list[str] = tool_def.get("odata_filter_fields", [])

                async def _http_coroutine(
                    _ep: str = _endpoint,
                    _meth: str = _method,
                    _ff: list[str] = _filter_fields,
                    **kwargs: Any,
                ) -> str:
                    # Substitute {paramName} placeholders in the URL template
                    endpoint = _ep
                    for k, v in kwargs.items():
                        if v is not None:
                            endpoint = endpoint.replace(f"{{{k}}}", str(v))
                    base_url = os.environ.get("CAP_BASE_URL", "")
                    if not base_url:
                        if enabled():
                            raise RuntimeError("CAP_BASE_URL must be configured for cloud tool calls")
                        base_url = "http://127.0.0.1:4004"
                    url = f"{base_url.rstrip('/')}{endpoint}"
                    headers = await cap_headers()
                    async with httpx.AsyncClient() as client:
                        if _meth == "GET":
                            filter_parts = [
                                f"{f} eq '{kwargs[f]}'" for f in _ff if kwargs.get(f)
                            ]
                            if filter_parts:
                                filter_expr = " and ".join(filter_parts)
                                sep = "&" if "?" in url else "?"
                                url = f"{url}{sep}$filter={quote(filter_expr, safe='')}"
                            resp = await client.get(url, headers=headers, timeout=30.0)
                        else:
                            body = {k: v for k, v in kwargs.items() if v is not None}
                            resp = await client.post(url, json=body, headers=headers, timeout=30.0)
                    resp.raise_for_status()
                    return truncate_response(minify_json(resp.text))

                coroutine = _http_coroutine
            else:
                raise ValueError(f"CAP tool {tool_name} requires an http_endpoint")

            tools.append(
                StructuredTool(
                    name=tool_name,
                    description=description,
                    args_schema=args_schema,
                    coroutine=coroutine,
                    handle_tool_error=True,
                )
            )

    logger.info("Loaded %d CAP tools", len(tools))
    return sorted(tools, key=lambda tool: tool.name)


async def get_cap_tools() -> list[BaseTool]:
    return _build_cap_tools()

def get_user_sub() -> str:
    """Extract the JWT subject claim from the current request's token.

    Decodes the JWT payload (middle segment) without verifying the signature —
    XSUAA middleware has already verified it before the request reaches this code.

    Returns:
        The 'sub' claim from the token.

    Raises:
        ValueError: If the token is missing or the sub claim cannot be extracted,
                    in cloud deployments. Local conversations use 'local'.
    """
    token = _user_token_context.get()
    if not token:
        if not enabled():
            return "local"
        raise ValueError("No user token in context — cannot extract sub claim")

    try:
        payload_segment = token.split(".")[1]
        # Add padding if needed
        padding = 4 - len(payload_segment) % 4
        if padding != 4:
            payload_segment += "=" * padding
        payload = json.loads(base64.urlsafe_b64decode(payload_segment))
        sub = payload.get("sub")
        if not sub:
            raise ValueError("JWT payload contains no 'sub' claim")
        return sub
    except (IndexError, ValueError):
        raise
    except Exception as e:
        raise ValueError(f"Failed to decode JWT payload: {e}") from e

def reset_user_token(token: Token) -> None:
    """Restore the user token context to its previous value.

    Args:
        token: The Token returned by a prior set_user_token() call. Passing it to
            ContextVar.reset() unwinds the context stack to the value that was in
            effect before that set_user_token() call, rather than leaving a stale
            or None value behind.
    """
    _user_token_context.reset(token)
    logger.debug("User token context reset to previous value")