# Personal AI Assistant

A browser-based personal assistant with a Python backend, SQLite persistence,
and optional Google Gemini chat replies.

## Run locally

From this project directory, optionally set a Gemini API key in your shell,
then start the app:

```sh
export GEMINI_API_KEY="your-rotated-gemini-key"
python3 -m backend.main
```

Open <http://127.0.0.1:8000/>. The app and API run locally; without
`GEMINI_API_KEY`, chat and memory storage work but Gemini replies are
unavailable.

Never put API keys in source files, browser code, or Git. If a key has been
shared or committed, revoke it and create a replacement. The backend reads
`GEMINI_API_KEY` from its environment. See [backend/README.md](backend/README.md)
for configuration, API endpoints, and tests.

## Tests

```sh
python3 -m unittest backend.test_main
```

## GitHub Pages

The static interface is published at <https://padchonne.github.io/personel-Ai/>.
GitHub Pages cannot run the Python backend, so the hosted page reports that the
backend is not connected and disables chat until a backend URL is configured.

To enable AI chat, deploy the backend separately with HTTPS and appropriate
authentication/access controls, set `GEMINI_API_KEY` on that server, and allow
the Pages origin with `ASSISTANT_ALLOWED_ORIGINS=https://padchonne.github.io`.
Then set the `api-base-url` meta tag in `index.html` to the backend's base URL.
Never put API keys in the site or browser code.

## Privacy and deployment

Chats and memories are saved to a local SQLite database, which is excluded
from Git. This app does not currently provide user authentication. Keep the
backend on a trusted machine and do not expose it publicly without adding
authentication, HTTPS, and appropriate access controls.
