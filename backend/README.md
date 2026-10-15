# Assistant backend

This Python API serves the web app, stores chats and memories in SQLite for
local development or PostgreSQL for Cloud Run, and uses Google Gemini for chat
replies. It binds to
`127.0.0.1:8000` by default. Open `http://127.0.0.1:8000` after starting it.

From the project root, set the key in the environment and start the server:

```sh
export GEMINI_API_KEY="your-rotated-gemini-key"
python3 -m backend.main
```

Do not put API keys or access codes in source files or browser code. The backend
sends the Gemini key in the `x-goog-api-key` request header. The default model
is `gemini-flash-latest`; set `GEMINI_MODEL` to change it, `PORT` or `HOST` to
change the listen address, and `ASSISTANT_DATABASE_PATH` to change the SQLite
file location.

Set `DATABASE_URL` for a PostgreSQL connection string, or use `PGHOST`,
`PGDATABASE`, `PGUSER`, and `PGPASSWORD` for separate PostgreSQL settings. If
`ASSISTANT_ACCESS_TOKEN` is set, all API routes require it as a Bearer token.
The GitHub Pages frontend prompts for the code and holds it only in the
current browser tab. Set `ASSISTANT_ALLOWED_ORIGINS` to a comma-separated
allowlist for other UI origins. CORS is not authentication; use HTTPS and keep
the access code private.

## Deploy to Google Cloud Run

The repository root has a Dockerfile for Cloud Run. Cloud Run needs a
billing-enabled Google Cloud project, a Cloud SQL for PostgreSQL instance, and
Secret Manager secrets for `GEMINI_API_KEY`, `ASSISTANT_ACCESS_TOKEN`, and the
database password. Rotate any Gemini key previously pasted into chat before
adding a new key to Secret Manager. Never commit deployment secrets.

1. In Google Cloud Console, select the intended project, enable billing, and
   enable Cloud Run, Cloud SQL Admin, Secret Manager, and Cloud Build APIs.
2. Create a PostgreSQL instance and database named `personal_ai`, and a
   database user named `assistant`. Choose a supported Cloud SQL region and
   instance size after reviewing its pricing.
3. Create a Cloud Run service account with the Cloud SQL Client role and
   Secret Manager Secret Accessor access for only the three secrets above.
4. In Secret Manager, create `gemini-api-key`, `assistant-access-token`, and
   `assistant-db-password`. Keep the access code in a password manager so it
   can be entered into the website's connect prompt.
5. Deploy this repository from its root to Cloud Run. Set the environment:
   `HOST=0.0.0.0`, `PGHOST=/cloudsql/PROJECT_ID:REGION:INSTANCE`,
   `PGDATABASE=personal_ai`, `PGUSER=assistant`, and
   `ASSISTANT_ALLOWED_ORIGINS=https://padchonne.github.io`. Mount the Cloud SQL
   instance, attach the service account, and map `GEMINI_API_KEY`,
   `ASSISTANT_ACCESS_TOKEN`, and `PGPASSWORD` from Secret Manager. Allow
   unauthenticated Cloud Run transport only because the API itself validates
   the private Bearer access code; do not expose the Gemini key to the browser.
6. Copy the deployed Cloud Run HTTPS URL into the `api-base-url` meta tag in
   the root `index.html`, commit that change, and wait for GitHub Pages to
   rebuild. Open the site and enter the access code when prompted.

Do not send either key or access code in chat or commit them to Git. This
single shared access code protects a personal deployment; rotate it if shared.
Cloud Run and Cloud SQL may incur charges.

## Endpoints

- `GET /api/health` — database and Gemini configuration status
- `GET /api/settings` — load persisted assistant preferences
- `PUT /api/settings` — update assistant preferences
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
