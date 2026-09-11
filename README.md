# CalApp

Upload a course syllabus (PDF, DOCX, or TXT), Claude reads it and pulls out every due date,
you review/edit the list, then click a button to add them straight to your Google Calendar —
so they show up on your phone automatically, same as any other calendar event.

Runs entirely on your own laptop (`localhost`) — nothing is deployed anywhere.

## One-time setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get a Google Cloud OAuth client (for Calendar access)

Google requires an OAuth client so the app can ask your permission to add events —
this is a few clicks, no cost, and stays entirely under your own Google account.

1. Go to https://console.cloud.google.com/ and create a new project (any name).
2. Go to **APIs & Services → Library**, search for **Google Calendar API**, click **Enable**.
3. Go to **APIs & Services → OAuth consent screen**. Choose **External**, fill in the
   required fields (app name, your email). You can leave it in "Testing" mode — add your
   own Google account under **Test users**.
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
     (change `3000` if you set a different `PORT` in `.env`)
5. Copy the **Client ID** and **Client Secret** it gives you.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `ANTHROPIC_API_KEY` — your Claude API key from https://console.anthropic.com/settings/keys
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from step 2

### 4. Run it

```bash
npm start
```

Open http://localhost:3000

1. Click **Connect Google Calendar** and approve access (one-time — it's remembered in
   a local `token.json` file, which is gitignored and never leaves your machine).
2. Upload a syllabus file.
3. Review the due dates Claude found — edit titles/dates/times, uncheck anything you
   don't want, add rows it missed.
4. Click **Add checked items to Google Calendar**. Open Google Calendar on your phone —
   they'll be there.

## How it works

- `lib/extractText.js` — pulls plain text out of the uploaded PDF/DOCX/TXT file.
- `lib/claude.js` — sends that text to the Claude API (`claude-opus-5`) with a strict
  tool schema, so it always gets back reliable structured JSON (title/date/time/type)
  instead of free-form text it would have to parse itself.
- `lib/googleCalendar.js` — handles the Google OAuth flow and creates one Calendar
  event per due date via the Calendar API.
- `server.js` — a small Express server wiring the above together.
- `public/` — the browser UI (plain HTML/CSS/JS, no build step).

## Notes / things you might want to change

- **Model cost**: `lib/claude.js` uses `claude-opus-5`. For a straightforward extraction
  task like this, `claude-sonnet-5` or even `claude-haiku-4-5` will likely work fine at a
  fraction of the cost — just change the `MODEL` constant.
- **Year inference**: if a syllabus only says "Sept 20" with no year, Claude infers the
  year from context (today's date / semester dates mentioned). Always double-check the
  review table before submitting.
- **Multiple syllabi**: just repeat the upload step — each upload/submit cycle is independent.
- **Revoking access**: click **Disconnect** in the app, or revoke it directly at
  https://myaccount.google.com/permissions.
