# TwinMind · Live Suggestions

A browser-based real-time meeting copilot. It listens to your mic, transcribes
the conversation with Whisper, and every ~30 seconds surfaces 3 suggestion
cards (questions to ask, talking points, fact-checks, clarifications, answers,
or definitions). Tap a card to drop it into the chat panel, where a streamed
detailed answer picks up where the card left off. You can also chat freely at
any time — the assistant has the full transcript as context.

**Deployed:** _set after Vercel deploy_ → `https://<your-project>.vercel.app`

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
