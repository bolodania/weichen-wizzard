"""Direct CAP tool provider regression tests (no LLM calls)."""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from mcp_providers import cap


class CapToolsTests(unittest.IsolatedAsyncioTestCase):
    async def test_tools_load_without_testing_flag_or_gateway(self):
        with patch.dict(os.environ, {}, clear=True):
            tools = await cap.get_cap_tools()
        self.assertIn("submitAnswer", [t.name for t in tools])
        self.assertNotIn("approveSession", [t.name for t in tools])
        self.assertEqual([t.name for t in tools], sorted(t.name for t in tools))

    async def test_calls_cap_with_auth_and_correct_arguments(self):
        response = Mock()
        response.text = '{ "sessionId": "example" }'
        client = AsyncMock()
        client.post.return_value = response
        with patch.dict(os.environ, {"CAP_BASE_URL": "https://cap.example"}), \
             patch.object(cap, "cap_headers", AsyncMock(return_value={"Authorization": "Bearer test"})), \
             patch.object(cap.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            tool = next(t for t in await cap.get_cap_tools() if t.name == "createSession")
            result = await tool.ainvoke({"ds100": "NI", "switchNumber": "2006", "basicForm": "EWR"})
            self.assertEqual(json.loads(result)["sessionId"], "example")
            self.assertEqual(client.post.call_args.args[0], "https://cap.example/wizard/createSession")
            self.assertEqual(client.post.call_args.kwargs["headers"], {"Authorization": "Bearer test"})

    async def test_local_identity_and_cloud_missing_identity(self):
        token = cap.set_user_token(None)
        try:
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(cap.get_user_sub(), "local")
            with patch.dict(os.environ, {"VCAP_APPLICATION": "{}"}):
                with self.assertRaises(ValueError):
                    cap.get_user_sub()
        finally:
            cap.reset_user_token(token)

    async def test_default_submission_calls_existing_cap_action(self):
        response = Mock()
        response.text = '{"sessionId":"existing","status":"submitted","defaultedCount":12}'
        client = AsyncMock()
        client.post.return_value = response
        with patch.dict(os.environ, {"CAP_BASE_URL": "https://cap.example"}), \
             patch.object(cap, "cap_headers", AsyncMock(return_value={"Authorization": "Bearer test"})), \
             patch.object(cap.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            tool = next(t for t in await cap.get_cap_tools('field') if t.name == 'bulkSubmitWithDefaults')
            result = json.loads(await tool.ainvoke({"sessionId": "existing"}))
            self.assertEqual(result['status'], 'submitted')
            self.assertEqual(result['defaultedCount'], 12)
            client.post.assert_awaited_once_with(
                'https://cap.example/wizard/bulkSubmitWithDefaults',
                json={'sessionId': 'existing'}, headers={'Authorization': 'Bearer test'}, timeout=30.0,
            )


if __name__ == "__main__":
    unittest.main()