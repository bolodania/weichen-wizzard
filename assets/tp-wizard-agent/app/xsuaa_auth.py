"""XSUAA signature/audience validation and technical CAP tokens for CF.

Local development is explicit; CF always requires a valid binding and HTTPS.
"""
import asyncio
import json
import os
import time
from urllib.parse import urlparse

import httpx
from sap import xssec
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


def enabled():
    return bool(os.environ.get("VCAP_APPLICATION"))


def credentials():
    services = json.loads(os.environ.get("VCAP_SERVICES", "{}"))
    bindings = [s for group in services.values() for s in group
                if s.get("label") == "xsuaa" or "xsuaa" in s.get("tags", [])]
    if len(bindings) != 1:
        raise RuntimeError("Exactly one XSUAA binding is required")
    return bindings[0]["credentials"]


class XsuaaMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.binding = credentials()  # fail at startup if deployment is unbound

    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            return JSONResponse({"error": "Authentication required"}, status_code=401)
        try:
            context = await asyncio.to_thread(xssec.create_security_context, header[7:], self.binding)
        except Exception:
            return JSONResponse({"error": "Invalid access token"}, status_code=401)
        prefix = self.binding["xsappname"]
        if not any(context.check_scope(f"{prefix}.{scope}") for scope in ("AgentInvoke", "WizardUser")):
            return JSONResponse({"error": "Agent invocation scope required"}, status_code=403)
        return await call_next(request)


_token = None
_expires = 0


async def cap_headers():
    global _token, _expires
    if not enabled():
        return {}
    if urlparse(os.environ.get("CAP_BASE_URL", "")).scheme != "https":
        raise RuntimeError("Cloud CAP_BASE_URL must use HTTPS")
    if _token and _expires > time.monotonic():
        return {"Authorization": f"Bearer {_token}"}
    binding = credentials()
    url = binding["url"].rstrip("/") + "/oauth/token"
    if urlparse(url).scheme != "https":
        raise RuntimeError("XSUAA token endpoint must use HTTPS")
    async with httpx.AsyncClient() as client:
        response = await client.post(url, data={"grant_type": "client_credentials"},
                                     auth=(binding["clientid"], binding["clientsecret"]), timeout=15)
        response.raise_for_status()
        data = response.json()
    _token = data["access_token"]
    _expires = time.monotonic() + max(0, int(data.get("expires_in", 0)) - 60)
    return {"Authorization": f"Bearer {_token}"}