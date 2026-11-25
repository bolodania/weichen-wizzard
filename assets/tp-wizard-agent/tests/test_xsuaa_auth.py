"""Standalone auth tests: python -m unittest discover -s tests -p test_xsuaa_auth.py."""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, Mock, AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import xsuaa_auth as auth
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

BINDING = {"clientid": "client", "clientsecret": "secret", "url": "https://auth.example", "xsappname": "wizard"}
ENV = {"VCAP_APPLICATION": "{}", "CAP_BASE_URL": "https://cap.example",
       "VCAP_SERVICES": json.dumps({"xsuaa": [{"label": "xsuaa", "credentials": BINDING}]})}


class MiddlewareTests(unittest.TestCase):
    def setUp(self):
        async def endpoint(request):
            return JSONResponse({"ok": True})
        self.app = Starlette(routes=[Route("/", endpoint), Route("/health", endpoint)])
        self.app.add_middleware(auth.XsuaaMiddleware)

    def test_missing_token_and_public_health(self):
        with patch.dict(os.environ, ENV), TestClient(self.app) as client:
            self.assertEqual(client.get("/").status_code, 401)
            self.assertEqual(client.get("/health").status_code, 200)

    def test_invalid_signature_is_rejected(self):
        with patch.dict(os.environ, ENV), TestClient(self.app) as client:
            self.assertEqual(client.get("/", headers={"Authorization": "Bearer invalid"}).status_code, 401)

    def test_valid_token_scope_authorization(self):
        context = Mock()
        context.check_scope.return_value = False
        with patch.dict(os.environ, ENV), patch.object(auth.xssec, "create_security_context", return_value=context), TestClient(self.app) as client:
            self.assertEqual(client.get("/", headers={"Authorization": "Bearer signed"}).status_code, 403)
            context.check_scope.side_effect = lambda scope: scope == "wizard.AgentInvoke"
            self.assertEqual(client.get("/", headers={"Authorization": "Bearer signed"}).status_code, 200)

    def test_cf_fails_closed_without_binding(self):
        with patch.dict(os.environ, {"VCAP_APPLICATION": "{}", "VCAP_SERVICES": "{}"}):
            self.assertTrue(auth.enabled())
            with self.assertRaises(RuntimeError):
                auth.credentials()


class TokenTests(unittest.IsolatedAsyncioTestCase):
    async def test_client_credentials_token_cached(self):
        auth._token = None
        auth._expires = 0
        response = Mock()
        response.json.return_value = {"access_token": "token", "expires_in": 3600}
        client = AsyncMock()
        client.post.return_value = response
        with patch.dict(os.environ, ENV), patch.object(auth.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            self.assertEqual(await auth.cap_headers(), {"Authorization": "Bearer token"})
            await auth.cap_headers()
            client.post.assert_awaited_once()
            self.assertEqual(client.post.call_args.kwargs["auth"], ("client", "secret"))

    async def test_cloud_requires_https(self):
        with patch.dict(os.environ, {**ENV, "CAP_BASE_URL": "http://cap.example"}):
            with self.assertRaises(RuntimeError):
                await auth.cap_headers()


if __name__ == "__main__":
    unittest.main()