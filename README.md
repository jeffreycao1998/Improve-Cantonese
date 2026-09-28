# Cantonese Speaking Coach

A responsive, voice-first Cantonese practice app for an English-fluent learner who wants to speak better rather than study reading and writing.

## Training Journey

The app now builds a personalized seven-day speaking plan from a short onboarding flow. Completed sessions produce a structured coach report, update five skill scores, and add useful corrections to a spaced-repetition queue. A session-history dashboard visualizes score trends and keeps every coach report available for comparison. Learners can also create their own real-life scenarios and export or import their local progress.

Session reviews use the OpenAI Responses API with Structured Outputs. If the review request fails, the browser creates a local fallback report so the completed session is still saved.

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

## Checks

```bash
npm run typecheck
npm test
npm run build
```
