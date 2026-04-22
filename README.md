# TwinMind · Live Suggestions

A browser-based real-time meeting copilot. It listens to your mic, transcribes
the conversation with Whisper, and every ~30 seconds surfaces 3 suggestion
cards (questions to ask, talking points, fact-checks, clarifications, answers,
or definitions). Tap a card to drop it into the chat panel, where a streamed
detailed answer picks up where the card left off. You can also chat freely at
any time — the assistant has the full transcript as context.

**Deployed:** _set after Vercel deploy_ → `https://<your-project>.vercel.app`

## What it does

- **Mic capture** in fixed-length WebM/Opus chunks (default 8s) via
  `MediaRecorder`, stopping and restarting each chunk so every blob is a
  standalone file Whisper can accept.
- **Transcription** through Groq's Whisper Large V3. Each call passes the tail
  of the running transcript as a `prompt` so proper nouns and vocabulary carry
  across chunks, plus `language: "en"` to stop Whisper from hallucinating a
  foreign language on near-silence.
- **Suggestions** from Groq's `openai/gpt-oss-120b` in JSON mode. The prompt
  enforces 3 mixed-type suggestions per batch, bans repeats of the previous
  two batches, and returns `insufficient_signal: true` to skip batches when
  the transcript is filler — so the user never sees filler cards.
- **Rolling summary** kicks in once the transcript outgrows the live window.
  Older chunks are compressed into a bulleted summary that is re-fed into
  every subsequent suggest call, so long meetings keep long-horizon context.
- **Streaming expand & chat** via a single `ReadableStream` per response;
  the first token is typically on screen in well under a second.
- **BYO key.** No keys on the server. The user pastes a Groq API key into
  Settings, it lives in `localStorage`, and is forwarded on each request as
  an `x-groq-key` header. Route handlers read that header and nothing else.
- **Export.** One click produces a timestamped JSON file with the full
  transcript, all suggestion batches (including which ones were clicked), and
  the chat history.

## Architecture

```
Browser                                Next.js Route Handlers         Groq
───────────                            ──────────────────────         ────
MediaRecorder ──8s blob──▶ /api/transcribe ────────────────▶ whisper-large-v3
                                                │
Zustand store ◀──text─────────────────── JSON   │
      │                                         │
      ├── every ~30s ──▶ /api/suggest ──────────▶ gpt-oss-120b (JSON mode)
      │                                         │
      ├── click card ──▶ /api/expand  ──stream──▶ gpt-oss-120b (streaming)
      │                                         │
      ├── send chat ───▶ /api/chat    ──stream──▶ gpt-oss-120b (streaming)
      │                                         │
      └── transcript > live window ──▶ /api/summarize ─▶ gpt-oss-120b
```

Why this shape:

- **Route handlers, not edge.** `runtime = "nodejs"` so the Groq SDK works
  without bundling headaches. The handlers are thin — auth-header check,
  request assembly, one Groq call, return.
- **Single source of truth in Zustand.** One in-memory session store
  (transcript, batches, chat, meeting type, rolling summary) and one
  persisted settings store (`version: 2` with a `merge` function so adding
  fields to `DEFAULT_SETTINGS` doesn't break old localStorage state).
- **Reactive suggest trigger, not `setInterval`.** A `useEffect` watches the
  latest transcript-chunk timestamp and fires a suggest once the refresh
  interval has elapsed. Avoids race conditions `setInterval` had with React
  19 re-renders.
- **Manual refresh is non-blocking.** The button fires `runSuggest()` against
  whatever transcript is already in the store and kicks off
  `recorder.flush()` in the background; the freshly-transcribed chunk lands
  before the next auto-pass rather than blocking this click.

## Prompt engineering (the interesting part)

The suggest prompt does a few things worth calling out:

1. **Mixed types enforced.** "Return EXACTLY 3 suggestions, each a different
   type when possible. Never 3 of the same type." Paired with per-type
   guidance so the model knows when to pick `fact_check` (a numeric/named
   claim just landed) vs `answer` (a question just got asked).
2. **Preview stands alone.** The preview *is* the value. No "click to learn
   more" — every card is usable without expanding it.
3. **No-repeat.** The previous 1–2 batches' previews are passed in as
   `PREVIOUS_PREVIEWS` and the prompt explicitly bans near-duplicates.
4. **Insufficient-signal escape hatch.** If the recent transcript is silence,
   filler, or greetings, the model returns `{"insufficient_signal": true}`
   and the client quietly skips the batch. No garbage cards.
5. **Meeting type.** Classified once, then fed back in every call so the
   model stays in the right mode (sales call vs interview vs lecture).
6. **Rolling summary for long sessions.** Once the live window fills,
   `/api/summarize` compresses older chunks into a bulleted summary that is
   persisted in the session store and re-passed to every later suggest.

The expand/chat prompts enforce short, scannable, grounded answers — no
preamble, no "great question", admit uncertainty rather than fabricate.

## Context budget

| Call        | Context passed                                                      |
| ----------- | ------------------------------------------------------------------- |
| transcribe  | Last ~900 chars of transcript (biases vocabulary)                   |
| suggest     | Meeting type + rolling summary + last 2 batches' previews + live transcript window (default 3 min) |
| expand      | Meeting type + full transcript + tapped suggestion (type/preview/angle) |
| chat        | Meeting type + full transcript + full chat history + new user turn  |
| summarize   | Meeting type + prior summary + the transcript slice being folded in |

All window sizes are user-editable in Settings.

## Local dev

```bash
npm install
npm run dev
# open http://localhost:3000
# paste your Groq API key in Settings
# click Start mic
```

No `.env` needed. The key is supplied by the user at runtime. Serve over
`localhost` or HTTPS — `getUserMedia` requires a secure context.

## Deploying to Vercel

1. Push this repo to GitHub (already done if you're reading this).
2. Import it on [vercel.com/new](https://vercel.com/new). No env vars needed.
3. Deploy.

Route handlers use `runtime = "nodejs"` and `maxDuration` of 30–60s to cover
long Whisper transcriptions and LLM streaming.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind v4 + lucide-react icons + react-markdown (assistant rendering)
- Zustand (persisted settings + in-memory session)
- `groq-sdk` server-side
- Whisper Large V3 for ASR, `openai/gpt-oss-120b` for suggest/expand/chat/summarize

## Project layout

```
app/
  page.tsx                 main wiring (recorder, timers, suggest/expand/chat)
  layout.tsx globals.css   fonts, dark theme
  api/
    transcribe/route.ts    Whisper call
    suggest/route.ts       JSON-mode suggest
    expand/route.ts        streamed detailed answer
    chat/route.ts          streamed free chat
    summarize/route.ts     rolling summary for long sessions
components/
  TranscriptColumn.tsx  SuggestionsColumn.tsx  ChatColumn.tsx
  SettingsModal.tsx  Markdown.tsx
lib/
  recorder.ts    MediaRecorder chunking with stop() + flush()
  api.ts         typed fetch wrappers
  store.ts       Zustand stores (persisted settings, in-memory session)
  prompts.ts     system prompts + DEFAULT_SETTINGS
  context.ts     transcript windowing + previous-preview extraction
  groq.ts        SDK client, auth header, shared error response
  export.ts      JSON session dump
  types.ts       shared types
```

## Latency

Lightweight timing is logged to the console in dev:

- `[latency] refresh→rendered` — click the Refresh button to suggestions drawn
- `[latency] expand→first token` / `chat→first token` — click/send to first
  streamed token
