# Cantonese Speaking Coach

A responsive, voice-first Cantonese practice app for an English-fluent learner who wants to speak better rather than study reading and writing.

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Add your OpenAI API key:

```bash
cp .env.local.example .env.local
```

Then set `OPENAI_API_KEY` in `.env.local`.

3. Start the app:

```bash
npm run dev
```

The app uses a local Next.js route at `POST /api/realtime/session` to mint ephemeral Realtime credentials for the browser.
