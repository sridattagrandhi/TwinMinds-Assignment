# TwinMind · Live Suggestions

A browser-based real-time meeting copilot. It listens to your mic, transcribes
the conversation with Whisper, and every ~30 seconds surfaces 3 suggestion
cards (questions to ask, talking points, fact-checks, clarifications, answers,
or definitions). Tap a card to drop it into the chat panel, where a streamed
detailed answer picks up where the card left off. You can also chat freely at
any time — the assistant has the full transcript as context.

**Deployed:** https://twin-minds-assignment-bay.vercel.app

## Local dev

```bash
npm install
npm run dev
# open http://localhost:3000
# paste your Groq API key in Settings
# click Start mic
```

No `.env` needed — the key is supplied by the user at runtime and stored in
`localStorage`. Serve over `localhost` or HTTPS; `getUserMedia` requires a
secure context.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind v4 + lucide-react + react-markdown
- Zustand (persisted settings + in-memory session)
- `groq-sdk` server-side — Whisper Large V3 for ASR, `openai/gpt-oss-120b`
  for suggest / expand / chat / summarize

## Prompt strategy

The suggest prompt does a few things worth defending:

- **Mixed types enforced.** Exactly 3 per batch, different types where
  possible. The model knows *when* to pick each: `fact_check` when a
  numeric/named claim just landed, `answer` when a question was just asked,
  `clarification` when ambiguity appeared, etc. So the mix tracks the moment.
- **Preview stands alone.** The preview *is* the value — "click to learn
  more" style text is explicitly banned. Every card is useful unclicked.
- **No-repeat across batches.** The last 2 batches' previews are passed in
  as `PREVIOUS_PREVIEWS` and the prompt forbids near-duplicates.
- **Insufficient-signal escape hatch.** On silence, filler, or greetings,
  the model returns `{insufficient_signal: true}` and the UI shows nothing.
  No filler cards during dead air.
- **Open-ended meeting-type classification.** Not a closed enum — any
  snake_case label (`sales_discovery_call`, `therapy_session`,
  `code_review`, `performance_1on1`). Classified once, fed back every call
  so suggestion style stays in-mode.
- **Rolling summary for long sessions.** Once the transcript outgrows the
  live window, `/api/summarize` folds older chunks into a bulleted summary
  that's re-fed to every subsequent suggest. Minute-40 still remembers
  minute 3.

Expand and chat prompts enforce short, scannable, grounded answers — no
preamble, no restating the question, admit uncertainty rather than
fabricate.

### Context budget

| Call        | Context passed                                                      |
| ----------- | ------------------------------------------------------------------- |
| transcribe  | Last ~900 chars of transcript (Whisper prompt for vocab continuity) |
| suggest     | Meeting type + rolling summary + last 2 batches' previews + live transcript window (3 min default) |
| expand      | Meeting type + full transcript + tapped suggestion (type/preview/angle) |
| chat        | Meeting type + full transcript + full chat history + new user turn  |
| summarize   | Meeting type + prior summary + the slice being folded in            |

All window sizes are user-editable in Settings.

## Tradeoffs

- **Chunked MediaRecorder vs streaming ASR.** We stop/restart the recorder
  every ~8s to produce standalone Whisper-ready blobs. Simpler than a true
  streaming ASR pipeline and avoids WebSocket infrastructure. Cost:
  ~100ms of boundary audio loss per chunk and occasional mid-chunk word
  splits. Mitigated by passing the tail of the transcript as Whisper's
  `prompt` parameter for vocabulary continuity.
- **Node runtime over edge.** Route handlers use `runtime = "nodejs"` so
  the Groq SDK works without bundling headaches. Edge would save some
  cold-start time; not worth the integration cost for this.
- **BYO key vs managed backend.** Spec-mandated, but it's also the right
  shape for this — no user accounts, no billing, no key rotation on our
  side. Trade: the key sits in `localStorage`, which is XSS-vulnerable.
  Fine for an assignment; a real product would use OAuth + server-side
  vault.
- **Reactive suggest trigger over `setInterval`.** First approach used
  `setInterval` but it got racy with React 19 re-renders (the callback's
  identity churned, triggering cleanups). Rewrote as an effect on the
  latest transcript-chunk timestamp + a time gate — simpler, more
  reliable.
- **In-memory session store.** No persistence across reloads (per spec).
  Real product: Postgres + background jobs for summary regeneration, but
  that's a whole different codebase.
- **Polling for suggestions vs push.** Client asks every ~30s rather than
  server pushing. Simpler to reason about, fine at assignment scale. SSE
  would be slightly more efficient but add complexity that doesn't earn
  its keep here.
- **Rolling summary threshold = 15 chunks beyond the live window.** Picked
  empirically: earlier and the summary is noise (nothing substantive to
  compress); later and the live window starts losing important context.
  Editable in code if you're running very long sessions.
- **Temperature 0.4 on suggest, 0.5 on expand/chat, 0 on transcribe.**
  Suggest needs enough variety to not feel robotic but enough discipline
  to follow the JSON schema; expand/chat benefit from a little latitude
  for tone; transcribe is pure accuracy.
