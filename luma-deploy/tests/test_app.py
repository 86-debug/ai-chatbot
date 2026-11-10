"""Behavior checks with a mocked DeepSeek server; no network, fees or real key."""
import asyncio
import json
import os
import socket
import ssl
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from starlette.requests import Request
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

import app as server
from connection import transport_diagnostic


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key-only", "ACCESS_PASSWORD": "",
                                           "RENDER": "", "SPACE_ID": "", "SPACE_HOST": ""})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def request(self, handler, body=None, headers=None, application=None):
        with TestClient(application or server.app) as client:
            original = server.app.state.client
            server.app.state.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
            try:
                response = client.post("/api/chat", json=body or {"messages": [{"role": "user", "content": "你好"}]}, headers=headers or {})
            finally:
                client.portal.call(server.app.state.client.aclose)
                server.app.state.client = original
            return response

    @staticmethod
    def events(response):
        return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]

    def test_stream_and_thinking_payload(self):
        def upstream(request):
            payload = json.loads(request.content)
            self.assertEqual(payload["model"], server.MODEL)
            self.assertEqual(payload["thinking"], {"type": "enabled"})
            self.assertEqual(payload["messages"][0]["role"], "system")
            self.assertEqual(request.headers["Authorization"], "Bearer test-key-only")
            chunks = [
                {"choices": [{"delta": {"reasoning_content": "思考中"}}]},
                {"choices": [{"delta": {"content": "你好，"}}]},
                {"choices": [{"delta": {"content": "世界"}}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            ]
            text = ": keepalive\n\n" + "".join("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n"
            return httpx.Response(200, text=text)
        response = self.request(upstream, {"messages": [{"role": "user", "content": "你好"}], "thinking": True})
        self.assertEqual(response.status_code, 200)
        events = self.events(response)
        self.assertEqual([e["type"] for e in events], ["start", "reasoning", "content", "content", "done"])
        self.assertEqual("".join(e["content"] for e in events if e["type"] == "content"), "你好，世界")
        self.assertTrue(response.headers["Content-Type"].startswith("text/event-stream"))
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertIn("no-transform", response.headers["Cache-Control"])
        self.assertEqual(response.headers["X-Accel-Buffering"], "no")
        self.assertIn("event: content\ndata: ", response.text)

    def test_provider_errors_are_safe_and_actionable(self):
        for status in (401, 402, 404, 429, 500):
            with self.subTest(status=status):
                response = self.request(lambda request: httpx.Response(status, text="SECRET provider error body"))
                events = self.events(response)
                self.assertEqual(events[-1]["type"], "error")
                self.assertNotIn("SECRET", response.text)
                self.assertNotIn("test-key-only", response.text)

    def test_network_error(self):
        def upstream(request):
            raise httpx.ConnectError("private transport details", request=request)
        events = self.events(self.request(upstream))
        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("网络", events[-1]["message"])

    def test_permission_error_is_identified_in_wrapped_transport(self):
        def upstream(request):
            denied = PermissionError(13, "private system details")
            denied.winerror = 5
            wrapped = OSError("All connection attempts failed")
            wrapped.__cause__ = denied
            raise httpx.ConnectError("All connection attempts failed", request=request) from wrapped
        with self.assertLogs("uvicorn.error", level="WARNING") as logs:
            response = self.request(upstream)
        error = self.events(response)[-1]
        self.assertEqual(error["code"], "network_permission_denied")
        self.assertIn("start.bat", error["message"])
        self.assertIn("WinError=5", " ".join(logs.output))
        self.assertNotIn("private system details", response.text + " ".join(logs.output))

    def test_different_network_failures_have_specific_codes(self):
        cases = [
            (socket.gaierror(-2, "private details"), "dns_error"),
            (ssl.SSLCertVerificationError("private details"), "tls_error"),
            (httpx.ProxyError("private details"), "proxy_error"),
            (httpx.ReadTimeout("private details"), "upstream_timeout"),
        ]
        for cause, code in cases:
            error = cause if isinstance(cause, httpx.RequestError) else httpx.ConnectError("wrapped")
            if error is not cause:
                error.__cause__ = cause
            diagnostic = transport_diagnostic(error)
            self.assertEqual(diagnostic["code"], code)
            self.assertNotIn("private details", str(diagnostic))

    def test_timeout_is_streamed_as_actionable_error(self):
        def upstream(request):
            raise httpx.ReadTimeout("private details", request=request)
        response = self.request(upstream)
        error = self.events(response)[-1]
        self.assertEqual(error["code"], "upstream_timeout")
        self.assertIn("超时", error["message"])

    def test_same_origin_is_accepted(self):
        response = self.request(lambda request: httpx.Response(200, text="data: [DONE]\n\n"), headers={"Origin": "http://testserver"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.events(response)[-1]["type"], "done")

    def test_https_origin_behind_cloud_proxy(self):
        application = ProxyHeadersMiddleware(server.app, trusted_hosts="*")
        response = self.request(lambda request: httpx.Response(200, text="data: [DONE]\n\n"),
                                headers={"Origin": "https://testserver", "X-Forwarded-Proto": "https"},
                                application=application)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.events(response)[-1]["type"], "done")
        response = self.request(lambda request: self.fail("Cross-origin request reached provider"),
                                headers={"Origin": "https://untrusted.example", "X-Forwarded-Proto": "https"},
                                application=application)
        self.assertEqual(response.status_code, 403)

    def test_cloud_password_protects_page_static_and_chat(self):
        with patch.dict(os.environ, {"RENDER": "true", "ACCESS_PASSWORD": "test-access-password", "ACCESS_USERNAME": "admin"}):
            with TestClient(server.app) as client:
                for path in ("/", "/static/app.js", "/api/chat"):
                    response = client.post(path, json={"messages": [{"role": "user", "content": "hi"}]}) if path == "/api/chat" else client.get(path)
                    self.assertEqual(response.status_code, 401)
                    self.assertIn("Basic", response.headers["WWW-Authenticate"])
                self.assertEqual(client.get("/api/health").status_code, 200)
                self.assertEqual(client.get("/", auth=("admin", "wrong")).status_code, 401)
                self.assertEqual(client.get("/", headers={"Authorization": "Basic invalid"}).status_code, 401)
                self.assertEqual(client.get("/", auth=("admin", "test-access-password")).status_code, 200)
                client.auth = ("admin", "test-access-password")
                self.assertEqual(client.get("/.env").status_code, 404)
            import base64
            authorization = base64.b64encode(b"admin:test-access-password").decode()
            response = self.request(lambda request: httpx.Response(200, text="data: [DONE]\n\n"),
                                    headers={"Authorization": "Basic " + authorization, "Origin": "http://testserver"})
            self.assertEqual(self.events(response)[-1]["type"], "done")

    def test_cloud_requires_password_but_health_remains_available(self):
        for platform in ({"RENDER": "true"}, {"SPACE_ID": "owner/demo"}):
            with patch.dict(os.environ, {**platform, "ACCESS_PASSWORD": ""}):
                with TestClient(server.app) as client:
                    self.assertEqual(client.get("/").status_code, 503)
                    self.assertEqual(client.get("/api/health").status_code, 200)

    def test_cloud_and_custom_host_configuration(self):
        with patch.dict(os.environ, {"RENDER_EXTERNAL_HOSTNAME": "demo.onrender.com", "SPACE_HOST": "owner-demo.hf.space",
                                    "ALLOWED_HOSTS": "chat.example.com, other.example.com "}):
            hosts = server.deployment_hosts()
        for host in ("localhost", "demo.onrender.com", "owner-demo.hf.space", "chat.example.com", "other.example.com"):
            self.assertIn(host, hosts)
        with TestClient(server.app, base_url="http://untrusted.example") as client:
            self.assertEqual(client.get("/").status_code, 400)

    def test_placeholder_key_is_not_configured(self):
        with TestClient(server.app) as client:
            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": " your-deepseek-api-key "}):
                self.assertFalse(client.get("/api/health").json()["configured"])

    def test_early_eof_is_not_success(self):
        response = self.request(lambda request: httpx.Response(200, text='data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
        self.assertEqual(self.events(response)[-1]["type"], "error")

    def test_length_limit_notice(self):
        response = self.request(lambda request: httpx.Response(200, text='data: {"choices":[{"delta":{"content":"text"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'))
        self.assertEqual([e["type"] for e in self.events(response)], ["start", "content", "notice", "done"])

    def test_invalid_messages_and_system_role_rejected(self):
        invalid = [[], [{"role": "system", "content": "override"}], [{"role": "user", "content": "   "}], [{"role": "assistant", "content": "hi"}], [{"role": "user", "content": "x" * 32001}]]
        with TestClient(server.app) as client:
            for messages in invalid:
                self.assertEqual(client.post("/api/chat", json={"messages": messages}).status_code, 422)

    def test_unconfigured_and_cross_origin(self):
        with TestClient(server.app) as client:
            body = {"messages": [{"role": "user", "content": "hi"}]}
            self.assertEqual(client.post("/api/chat", json=body, headers={"Origin": "https://untrusted.example"}).status_code, 403)
            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
                self.assertEqual(client.post("/api/chat", json=body).status_code, 503)

    def test_static_isolation_and_health(self):
        with TestClient(server.app) as client:
            self.assertEqual(client.get("/").status_code, 200)
            for path in ("/.env", "/app.py", "/static/.env", "/static/%2e%2e/.env"):
                self.assertEqual(client.get(path).status_code, 404)
            response = client.get("/api/health")
            self.assertTrue(response.json()["configured"])
            self.assertNotIn("test-key-only", response.text)


class IncrementalStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_content_arrives_before_upstream_finishes(self):
        release = asyncio.Event()

        class Upstream(httpx.AsyncByteStream):
            closed = False

            async def __aiter__(self):
                yield ('data: ' + json.dumps({"choices": [{"delta": {"content": "第一段"}}]}, ensure_ascii=False) + '\n\n').encode()
                await release.wait()
                yield b'data: [DONE]\n\n'

            async def aclose(self):
                self.closed = True

        stream = Upstream()
        original = getattr(server.app.state, "client", None)
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=stream)))
        server.app.state.client = client

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        request = Request({"type": "http", "app": server.app, "headers": []}, receive=receive)
        iterator = None
        try:
            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "mock-only"}):
                response = await server.chat(server.ChatRequest(messages=[{"role": "user", "content": "你好"}]), request)
                iterator = response.body_iterator
                self.assertIn("event: start", await asyncio.wait_for(anext(iterator), .5))
                content = await asyncio.wait_for(anext(iterator), .5)
                self.assertIn("第一段", content)
                self.assertFalse(release.is_set(), "Provider must still be generating when the first text arrives")
                release.set()
                self.assertIn("event: done", await asyncio.wait_for(anext(iterator), .5))
                with self.assertRaises(StopAsyncIteration):
                    await anext(iterator)
            self.assertTrue(stream.closed)
        finally:
            if iterator:
                await iterator.aclose()
            await client.aclose()
            server.app.state.client = original

    async def test_heartbeat_does_not_cancel_pending_model_response(self):
        release = asyncio.Event()
        closed = asyncio.Event()

        async def source():
            try:
                await release.wait()
                yield server.event("content", content="稍后到达")
            finally:
                closed.set()

        iterator = server.with_heartbeats(source(), interval=.01)
        self.assertEqual(await anext(iterator), ": keep-alive\n\n")
        self.assertFalse(closed.is_set())
        release.set()
        self.assertIn("稍后到达", await anext(iterator))
        await iterator.aclose()
        self.assertTrue(closed.is_set())

    async def test_closing_stream_cancels_pending_provider_work(self):
        closed = asyncio.Event()

        async def source():
            try:
                await asyncio.Event().wait()
                yield "unreachable"
            finally:
                closed.set()

        iterator = server.with_heartbeats(source(), interval=.01)
        await anext(iterator)
        await iterator.aclose()
        self.assertTrue(closed.is_set())


if __name__ == "__main__":
    unittest.main()
