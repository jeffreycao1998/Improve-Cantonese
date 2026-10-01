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

The app uses GPT-Live 1 (`gpt-live-1`) for voice practice. The local Next.js route at `POST /api/realtime/session` exchanges the browser's WebRTC offer for a GPT-Live session and SDP answer. Your OpenAI API key stays on the server.

Start a conversation and speak naturally, including while the coach is speaking. Your microphone stays on; use **Mute mic** or **Unmute mic** when needed, and **Finish** to end practice. The coach offers occasional corrections at natural pauses. Captions show each speaker separately, and learning notes are saved when you finish.

Choose **Cantonese** or **Mandarin** with the language switch above the practice area. Cantonese targets Guangzhou speech with tone-number Jyutping; Mandarin targets Putonghua with tone-marked pinyin and coaching for Mandarin tones, neutral tone, and tone sandhi. Greetings, scenarios, repair prompts, and resumed conversations use the selected language. Finish an active or paused conversation before switching languages. The language choice is remembered locally, and progress is stored separately for each language while preserving existing Cantonese progress. Older saved conversations without a language are treated as Cantonese.

Select **Normal** for flowing conversation or **Super beginner** if you know zero words. Super beginner leads the lesson in English, explains one useful word or tiny phrase, models it slowly, and gives a concrete practice action. After an attempt or acknowledgment, the coach gives brief feedback and guides the next tiny step without needing "keep going." It offers at most one gentle correction at a time and explains new vocabulary before using it. The coach is instructed to pair praise with the next concrete activity. After six seconds of detected silence, the browser requests one follow-up in either mode: a natural conversational continuation in Normal, or a guided tiny activity with English support in Super beginner. Actual microphone and incoming audio activity, with transcript activity as a fallback, determine the quiet gap. Only learner activity rearms the follow-up, so coach speech alone cannot produce an endless chain of nudges. Muting, pausing, and closing disable these requests; the 30-second silence timeout and server watchdog still apply. It accepts English questions and avoids untranslated questions and full roleplays. The scenario supplies context for the tiny lesson. Help buttons request a new word, slower repetition, or pronunciation help. The mode is remembered locally and saved with paused conversations; older pauses default to Normal. Finish before changing modes. Both modes use the same voice session, pricing meter, and safeguards.

Captions show Jyutping or pinyin beneath each recognized Chinese character, for both the coach and learner. Pronunciation is generated locally with `to-jyutping` or `pinyin-pro`, without additional API calls. English and punctuation remain unchanged. Automatic dictionary readings are a pronunciation guide and may differ from the exact spoken reading for names, ambiguous characters, or tone changes in connected speech.

Pronunciation conversion runs in background workers so dictionaries do not initialize or convert streaming captions on the UI thread. Raw captions update in 50 ms batches without waiting for pronunciation; existing annotations remain while appended text is converted. If workers are unavailable, captions still display without annotations. Visible captions are limited to the latest 600 characters while the full transcript remains available for conversation memory. The precise meter updates independently of the rest of the UI. These changes reduce local rendering overhead but cannot eliminate provider transcript delay, network loss, or audio interruptions caused by echo. To compare development overhead, stop `npm run dev`, then run `npm run build` and `npm start`.

Super beginner sets the initial difficulty, not a permanent ceiling. Say "teach me something more complex," "I know this already," or use **Teach me something harder** to request longer useful sentences, new patterns, or a supported roleplay. The coach is instructed to honor these requests over default beginner pacing, keep English support for unfamiliar content, and preserve the requested difficulty through automatic follow-ups, New prompt, and Pause / Resume.

Use **Pause** to stop microphone input and audio playback and request closure through both the browser and server watchdog. The UI waits for OpenAI's `session.closed` acknowledgment before enabling **Resume**. Once paused, no voice session remains open. Resume creates a fresh session with a compact extractive conversation summary in its initial instructions, so the coach can continue the previous discussion. The summary preserves opening context and recent dialogue within 12,000 characters; older detail may be shortened. It is built locally without an additional model call and saved in browser local storage after closure, including across page reloads. **Finish** clears the saved conversation. Scenarios are locked while practicing or paused.

Elapsed time and total cost accumulate across resumed connections and exclude paused time. API duration and API cost show the latest connection separately. Each resumed connection has its own startup minimum. If final API usage is missing, that connection's cost remains estimated. A closure failure does not enable Resume; the watchdog continues attempting closure.

The session meter shows elapsed time and estimated voice cost in USD at $0.05/minute. Muted and silent time count. Usage updates are cumulative, and the final cost uses the API's reported duration after the session closes. WebRTC initialization bills 15 seconds, credited against running duration rather than added to it. If final usage is unavailable, the meter keeps an estimate. This app does not currently make separately billed backend model calls. [Pricing and usage details](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live).

Elapsed time uses a monotonic clock and displays milliseconds, refreshing every 100 ms while running. The meter separately shows the latest API-reported seconds and their calculated cost, without extrapolation. Dollar amounts display six decimal places. The running estimate is not an exact live invoice; the final usage event supplies the authoritative voice duration.

After 30 seconds of detected silence from both speakers, the browser requests session closure and waits for final usage. Microphone and incoming audio activity reset the timeout, including while speech transcripts are delayed. Muting the microphone does not pause the timeout. This browser safeguard depends on the page running; it is not an independent server watchdog.

An independent watchdog in the Next.js Node server attaches to each OpenAI session before the browser receives its connection answer. The browser sends a heartbeat every 10 seconds. If no heartbeat arrives for 45 seconds, the server sends `session.close` over its own authenticated sideband connection. Finish also requests server closure. The watchdog waits for `session.closed` and reconnects to retry when closure is unconfirmed; a lost sideband triggers closure as well. Heartbeats use a random per-session capability token, and the API key stays on the server.

Run this with the long-lived local `npm run dev` server or `npm run build` followed by `npm start`. The watchdog survives browser freezes, but cannot run if the Node process stops, the computer sleeps, or the network remains unavailable. It is an in-process safeguard, not a durable worker for serverless hosting, and does not impose a maximum duration on a healthy session. Background tabs whose heartbeats are heavily throttled can be closed for safety. Confirmed final voice usage is still required to verify session cost.
