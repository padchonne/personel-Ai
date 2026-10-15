# Assistant backend

This dependency-free Python API serves the web app, stores chats and memories
in SQLite, and uses Google Gemini for chat replies. It binds to
`127.0.0.1:8000` by default. Open `http://127.0.0.1:8000` after starting it.

From the project root, set the key in the environment and start the server:

```sh
export GEMINI_API_KEY="your-rotated-gemini-key"
python3 -m backend.main
```

Do not put API keys in source files or browser code. The backend sends the key
to Gemini in the `x-goog-api-key` request header. The default model is
`gemini-flash-latest`; set `GEMINI_MODEL` to change it, `PORT` or `HOST` to
change the listen address, and `ASSISTANT_DATABASE_PATH` to change the SQLite
file location.

The default CORS allowlist covers common local development ports. Set
`ASSISTANT_ALLOWED_ORIGINS` to a comma-separated allowlist when serving the UI
from a different origin. CORS is not authentication; keep this server on a
trusted machine/network unless authentication and HTTPS are added.

## Endpoints

- `GET /api/health` — database and Gemini configuration status
- `GET /api/chats` — list chats
- `POST /api/chats` — create a chat; optional JSON `{"title":"..."}`
- `GET /api/chats/{chat_id}` — chat and messages
- `POST /api/chats/{chat_id}/messages` — send JSON `{"text":"..."}` and get
  the user and Gemini messages back
- `DELETE /api/chats/{chat_id}` — delete a chat and its messages
- `DELETE /api/chats` — clear all chats and messages
- `GET /api/memories` — list saved memories
- `POST /api/memories` — create a memory with JSON `{"text":"..."}`
- `PUT /api/memories/{memory_id}` — update a memory
- `DELETE /api/memories/{memory_id}` — delete a memory
- `DELETE /api/memories` — clear all memories

Run the backend tests with `python3 -m unittest backend.test_main`.
