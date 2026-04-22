# TwinMind · Live Suggestions

A real-time meeting copilot: listens to live mic audio, transcribes every ~30s, and surfaces 3 fresh, contextual suggestions per batch. Click any card to get a detailed answer streamed into the chat panel. Built on Groq (Whisper Large V3 + GPT-OSS 120B).

## Stack

- **Next.js 16 (App Router) + React 19 + Tailwind v4** — single repo, deployed on Vercel.
- **Zustand** for in-memory session state; `persist` middleware for settings in `localStorage`.
- **Groq SDK** server-side via Next.js Route Handlers (`/api/transcribe`, `/api/suggest`, `/api/expand`, `/api/chat`).
- **MediaRecorder** for chunked audio capture (one standalone WebM/Opus file per chunk).
- **Token streaming** for expand + chat via a plain `ReadableStream` response.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000, click **Settings**, paste a Groq API key from https://console.groq.com, then hit **Start mic**.

The API key never leaves the user's browser except as an `x-groq-key` header to this app's own API routes, which forward it to Groq. Nothing is persisted server-side.

## Architecture

```
 Browser (client)                          Next.js Route Handlers (Node runtime)
 ─────────────────────                     ─────────────────────────────────────
 MediaRecorder ──30s chunks──▶  POST /api/transcribe  ──▶ Groq Whisper Large V3
        │                                                        │
        ▼                                                         ▼
 Zustand session store ◀──────── transcript chunk (text) ◀────────┘
        │
        │ (every 30s if new transcript)
        ▼
 POST /api/suggest  ──▶ Groq GPT-OSS 120B (JSON mode)
        │
        ▼
 Batch of 3 suggestions prepended in UI.

 Click card  ──▶  POST /api/expand  ──stream──▶  Chat panel
 Type in chat ──▶  POST /api/chat    ──stream──▶  Chat panel
```

## Prompt strategy

Everything lives in [lib/prompts.ts](lib/prompts.ts) and is user-editable from the Settings modal.

### Live suggestion prompt (the core of the assignment)

For every batch we send the model:

1. **`MEETING_TYPE`** — classified on early batches (sales_call, job_interview, standup, lecture, brainstorm, one_on_one, customer_support) and reused thereafter to bias the mix.
2. **`PRIOR_SUMMARY`** — a rolling compression of the meeting so far. Keeps prompt size bounded on long meetings. (Wired through; auto-compression is a next add.)
3. **`RECENT_TRANSCRIPT`** — a sliding window over the last N minutes (configurable; default 3).
4. **`PREVIOUS_PREVIEWS`** — the preview text of the last two batches. The model is explicitly told not to repeat or paraphrase them.

Hard rules enforced in the system prompt:

- **Exactly 3 suggestions, mixed types.** Types: `question`, `talking_point`, `answer`, `fact_check`, `clarification`, `definition`.
- **Previews must stand alone.** No "click to learn more" — the card text is the value.
- **Fact-check bias on concrete claims** (numbers, names, dates). Real-time verification is the highest-leverage use case.
- **`insufficient_signal` escape hatch.** If the last 30s is silence/filler, the model returns `{"insufficient_signal": true}` and we keep the previous batch visible instead of cycling in junk.
- **JSON mode** so output is always parseable.

### Expand + chat prompts

- **Expand** gets the full transcript (or a user-chosen window), the tapped suggestion, and a directive to answer directly, cite the transcript where relevant, stay under ~200 words, and admit uncertainty rather than fabricate. Streamed for fast TTFT.
- **Chat** is the same pattern but with the running chat history instead of a single suggestion, so the conversation stays coherent.

## Improvements over the shipped TwinMind app

Recurring failure modes observed using the real app — all addressed here:

| Issue | Fix |
|---|---|
| Three near-duplicate "what is X" definition cards | Enforced type diversity per batch |
| Same suggestion resurfaces 30s later | Pass prior batch previews; prompt forbids repeats |
| Generic regardless of context | Meeting-type classification biases the mix |
| Card requires a click to be useful | Preview-is-the-answer rule in the prompt |
| Refresh fires on silence → junk cards | `insufficient_signal` flag keeps prior batch |
| Unverified claims slide by | Explicit fact-check type with numeric/named trigger |
| Slow feel on long answers | Expand + chat are token-streamed |

## Settings (all editable, all with defaults)

- Groq API key
- Live suggestion / expand / chat prompts
- Live context window (minutes)
- Expand context window (minutes; 0 = full transcript)
- Refresh interval (seconds) — also governs audio chunk length

## Export

One button → downloads a JSON file with `session_start`, every transcript chunk (timestamped), every suggestion batch (timestamped, with `clicked` booleans), and every chat message (timestamped, flagged if spawned from a suggestion).

## Tradeoffs / what I'd do with more time

- **Rolling summary** is wired through but not yet auto-generated. Would run a cheap summarization call every ~5 batches to keep the prompt small on hour-long meetings.
- **Voice activity detection** client-side before spending a Whisper call on pure silence.
- **Chunking with overlap** (2-3s tail between chunks) to avoid mid-word cuts — currently relying on Whisper's robustness, which is good enough in practice.
- **Speaker diarization** would meaningfully improve "answer-a-question-just-asked" detection (we'd know *who* asked).
- **Prompt eval harness** — record real meetings, run the suggest prompt over fixed windows, A/B new prompt versions against human-labeled gold batches. Where the next chunk of quality improvement lives.

## Deploy

```bash
# From repo root:
vercel
```

No env vars required — BYO API key, entered in-app.
