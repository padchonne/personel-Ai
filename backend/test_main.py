import io
import json
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend import main


class BackendAPITest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "test.sqlite3"
        self.database_patch = patch.object(main, "DATABASE_PATH", self.database_path)
        self.database_patch.start()
        self.key_patch = patch.object(main, "GEMINI_API_KEY", "")
        self.key_patch.start()
        main.initialize_database()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), main.AssistantHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join()
        self.key_patch.stop()
        self.database_patch.stop()
        self.temp_dir.cleanup()

    def request(self, method, path, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request_headers = {"Content-Type": "application/json"} if data is not None else {}
        request_headers.update(headers or {})
        request = Request(
            self.base_url + path,
            data=data,
            method=method,
            headers=request_headers,
        )
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            payload = response.read()
            if not payload:
                body = None
            elif response.headers.get_content_type() == "application/json":
                body = json.loads(payload)
            else:
                body = payload
            return response.status, body

    def test_health_reports_database_and_missing_gemini_configuration(self):
        status, body = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(
            body,
            {
                "status": "ok",
                "database": "connected",
                "databaseEngine": "SQLite",
                "geminiConfigured": False,
            },
        )

    def test_api_rejects_missing_or_invalid_access_code_when_configured(self):
        with patch.dict("os.environ", {"ASSISTANT_ACCESS_TOKEN": "private-code"}):
            self.assertEqual(self.request("GET", "/api/health")[0], 401)
            self.assertEqual(
                self.request(
                    "GET",
                    "/api/health",
                    headers={"Authorization": "Bearer wrong-code"},
                )[0],
                401,
            )
            status, body = self.request(
                "GET",
                "/api/health",
                headers={"Authorization": "Bearer private-code"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(body["database"], "connected")

    def test_cors_allows_github_pages_origin_and_authorization_header(self):
        request = Request(
            self.base_url + "/api/health",
            headers={"Origin": "https://padchonne.github.io"},
        )
        with urlopen(request, timeout=3) as response:
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://padchonne.github.io")
            self.assertIn("Authorization", response.headers["Access-Control-Allow-Headers"])

    def test_postgres_connection_translates_placeholders(self):
        raw_connection = Mock()
        connection = main.PostgresConnection(raw_connection)
        connection.execute("SELECT * FROM chats WHERE id = ?", ("chat-id",))
        raw_connection.execute.assert_called_once_with(
            "SELECT * FROM chats WHERE id = %s", ("chat-id",)
        )

    def test_postgres_host_configuration_initializes_without_sqlite_pragmas(self):
        raw_connection = Mock()
        postgres = SimpleNamespace(connect=Mock(return_value=raw_connection))
        with (
            patch.object(main, "psycopg", postgres),
            patch.object(main, "dict_row", object()),
            patch.dict(
                "os.environ",
                {
                    "PGHOST": "/cloudsql/example",
                    "PGDATABASE": "personal_ai",
                    "PGUSER": "assistant",
                    "PGPASSWORD": "test-password",
                },
            ),
        ):
            main.initialize_database()

        executed_sql = [call.args[0] for call in raw_connection.execute.call_args_list]
        self.assertTrue(executed_sql)
        self.assertFalse(any(statement.startswith("PRAGMA") for statement in executed_sql))
        raw_connection.commit.assert_called_once()

    def test_server_serves_the_app_from_project_root(self):
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Personal AI Assistant", body)
        status, body = self.request("GET", "/app.js")
        self.assertEqual(status, 200)
        self.assertIn(b"/api/chats", body)

    def test_chat_lifecycle_persists_messages_and_deletes_cascade(self):
        status, created = self.request("POST", "/api/chats", {})
        self.assertEqual(status, 201)
        chat_id = created["chat"]["id"]

        with patch.object(main, "generate_reply", return_value="Hello from Gemini."):
            status, sent = self.request(
                "POST", f"/api/chats/{chat_id}/messages", {"text": "Hello"}
            )
        self.assertEqual(status, 200)
        self.assertEqual(sent["title"], "Hello")
        self.assertEqual([item["role"] for item in sent["messages"]], ["user", "assistant"])

        status, detail = self.request("GET", f"/api/chats/{chat_id}")
        self.assertEqual(status, 200)
        self.assertEqual([item["text"] for item in detail["messages"]], ["Hello", "Hello from Gemini."])
        self.assertLess(
            detail["messages"][0]["createdAt"],
            detail["messages"][1]["createdAt"],
        )

        status, chats = self.request("GET", "/api/chats")
        self.assertEqual(status, 200)
        self.assertEqual(chats["chats"][0]["messageCount"], 2)
        self.assertEqual(self.request("DELETE", f"/api/chats/{chat_id}")[0], 200)
        self.assertEqual(self.request("GET", f"/api/chats/{chat_id}")[0], 404)

    def test_memory_create_update_list_and_delete(self):
        status, created = self.request("POST", "/api/memories", {"text": "Prefers concise replies"})
        self.assertEqual(status, 201)
        memory_id = created["memory"]["id"]
        status, updated = self.request("PUT", f"/api/memories/{memory_id}", {"text": "Prefers examples"})
        self.assertEqual(status, 200)
        self.assertEqual(updated["memory"]["text"], "Prefers examples")
        self.assertEqual(self.request("GET", "/api/memories")[1]["memories"][0]["text"], "Prefers examples")
        self.assertEqual(self.request("DELETE", f"/api/memories/{memory_id}")[0], 200)
        self.assertEqual(self.request("DELETE", f"/api/memories/{memory_id}")[0], 404)

    def test_saved_memories_are_passed_as_gemini_context_when_enabled(self):
        _, created_chat = self.request("POST", "/api/chats", {})
        _, created_memory = self.request(
            "POST", "/api/memories", {"text": "Prefers short explanations"}
        )
        with patch.object(main, "generate_reply", return_value="Sure.") as generate:
            status, _ = self.request(
                "POST",
                f"/api/chats/{created_chat['chat']['id']}/messages",
                {"text": "Explain AI", "memoryEnabled": True},
            )
        self.assertEqual(status, 200)
        self.assertEqual(generate.call_args.args[1], [created_memory["memory"]["text"]])
        self.assertEqual(generate.call_args.args[2], "both")

        with patch.object(main, "generate_reply", return_value="Okay.") as generate:
            self.request(
                "POST",
                f"/api/chats/{created_chat['chat']['id']}/messages",
                {"text": "One more", "memoryEnabled": False, "language": "ml"},
            )
        self.assertEqual(generate.call_args.args[1], [])
        self.assertEqual(generate.call_args.args[2], "ml")

    def test_invalid_message_is_rejected(self):
        _, created = self.request("POST", "/api/chats", {})
        status, body = self.request(
            "POST", f"/api/chats/{created['chat']['id']}/messages", {"text": "  "}
        )
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_invalid_language_is_rejected(self):
        _, created = self.request("POST", "/api/chats", {})
        status, body = self.request(
            "POST",
            f"/api/chats/{created['chat']['id']}/messages",
            {"text": "Hello", "language": "unsupported"},
        )
        self.assertEqual(status, 400)
        self.assertIn("language", body["error"])

    def test_chat_message_returns_explicit_error_when_gemini_is_not_configured(self):
        _, created = self.request("POST", "/api/chats", {})
        status, body = self.request(
            "POST", f"/api/chats/{created['chat']['id']}/messages", {"text": "Hello"}
        )
        self.assertEqual(status, 503)
        self.assertIn("GEMINI_API_KEY", body["error"])

    def test_gemini_request_uses_api_key_header_and_parses_text(self):
        response = io.BytesIO(
            b'{"candidates":[{"content":{"parts":[{"text":"Hello back."}]}}]}'
        )
        with (
            patch.object(main, "GEMINI_API_KEY", "test-key"),
            patch.object(main, "urlopen", return_value=response) as mocked_urlopen,
        ):
            reply = main.generate_reply([{"role": "user", "text": "Hello"}])

        request = mocked_urlopen.call_args.args[0]
        headers = {name.lower(): value for name, value in request.headers.items()}
        self.assertEqual(headers["x-goog-api-key"], "test-key")
        self.assertEqual(reply, "Hello back.")


if __name__ == "__main__":
    unittest.main()
