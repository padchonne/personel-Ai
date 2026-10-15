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

To enable AI chat, deploy the backend separately. This repository includes a
Dockerfile and instructions for Google Cloud Run with Cloud SQL PostgreSQL in
[backend/README.md](backend/README.md). Configure Gemini and a private backend
access code as Secret Manager secrets, allow the Pages origin with
`ASSISTANT_ALLOWED_ORIGINS=https://padchonne.github.io`, and set the
`api-base-url` meta tag in `index.html` to the deployed backend's HTTPS URL.
Never put API keys or access codes in the site or browser code.

## Privacy and deployment

Local chats and memories are saved to a SQLite database, which is excluded
from Git. Cloud Run deployments use PostgreSQL and require the configured
private access code for API requests. Cloud Run and Cloud SQL may incur charges.
