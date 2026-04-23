#!/usr/bin/env node
// End-to-end simulator that drives our own API routes with a scripted 5-minute
// meeting transcript — exercising suggest, summarize, expand, and chat in the
// same order and shape the browser would.
//
// Usage:
//   GROQ_API_KEY=gsk_... node scripts/simulate-meeting.mjs
//   (optional) BASE_URL=http://localhost:3000
//
// Bypasses mic + Whisper by feeding in pre-written chunks; everything else is
// the real production code path.

import { SUGGEST_PROMPT, EXPAND_PROMPT, CHAT_PROMPT } from "../lib/prompts.ts";

const KEY = process.env.GROQ_API_KEY;
const BASE = process.env.BASE_URL || "http://localhost:3000";

if (!KEY) {
  console.error("Set GROQ_API_KEY to run this script.");
  process.exit(1);
}

// A scripted sales-discovery call. ~38 chunks of ~8s each = ~5 minutes.
const CHUNKS = [
  "Hey Priya, thanks for making time today. How's your week going?",
  "Pretty hectic — we're in the middle of rolling out our new data platform.",
  "Nice, that's actually what I wanted to dig into. Can you walk me through the current stack?",
  "Sure. We're on Snowflake for the warehouse, Fivetran for ingest, and dbt for modeling.",
  "Got it. And how many active dbt models are you running at this point?",
  "Around 450 production models. We added 80 in the last quarter alone.",
  "Wow, 80 in a quarter. Who's owning the review process for new models?",
  "That's actually the pain point. It's just me and one other analytics engineer.",
  "So two reviewers for 450 models. What happens when one of you is out?",
  "Things stall. Last month I was on PTO and we had a broken model in prod for four days.",
  "That's rough. How much revenue impact did that four-day outage cause?",
  "Marketing couldn't attribute campaigns so they over-spent by about 200 thousand dollars.",
  "Two hundred K from one broken model. Have you looked at automated testing tools?",
  "We use dbt tests but coverage is maybe 30 percent. We just don't have time to write more.",
  "What's your monthly Snowflake spend right now, roughly?",
  "About 85 thousand a month. CFO wants that down 20 percent by end of year.",
  "Twenty percent of 85K is 17K a month you need to claw back. Big target.",
  "Yeah. I've been trying to find query optimization wins but it's slow going.",
  "Have you profiled which models are the biggest compute drivers?",
  "Not systematically. I have a hunch it's our marketing attribution model.",
  "Hunches are fine but we should confirm. Our platform auto-ranks models by cost.",
  "That would save me a week of digging. How long does onboarding typically take?",
  "For a team your size, usually three to five business days.",
  "And pricing? I want to make sure this isn't out of range before we go further.",
  "For 450 models and two seats, you'd be on our growth tier — around 2K a month.",
  "2K a month versus 17K in savings. That math works if the tool actually delivers.",
  "We offer a 30-day proof-of-value. No commitment until you see the savings.",
  "That's fair. What do you need from me to kick off a POV?",
  "Read-only Snowflake credentials and a list of which schemas to scan.",
  "I can get that to you by Thursday. Who would be our main point of contact?",
  "I'd pair you with our solutions engineer, Dana. She's worked with three dbt shops.",
  "Okay. I do need to loop in our head of data, Marcus, before we formalize anything.",
  "Of course. Want me to send a one-page summary you can forward him?",
  "Yes, and include the cost-optimization case study if you have one.",
  "Will do. I'll also draft a mutual NDA — standard for read-only access.",
  "Perfect. Let's aim to have the POV live by next Monday.",
  "Next Monday works. I'll send the kickoff doc tonight.",
  "Thanks, this was actually useful. Talk soon.",
];

const PREVIEWS_WINDOW = 2; // last N batches of previews fed into next suggest
const CHUNKS_PER_SUGGEST = 4; // ~32s cadence if chunks are ~8s each

function transcriptTail(chunks, liveMinutes = 3) {
  // Approximation: last N chars, since we don't have real timestamps here.
  // The prompt already handles noisy input gracefully.
  const all = chunks.join(" ");
  if (liveMinutes <= 0) return all;
  // Rough: 150 words/min * 5 chars/word = 750 char/min
  const budget = liveMinutes * 900;
  return all.length > budget ? all.slice(-budget) : all;
}

async function post(path, body) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-groq-key": KEY },
    body: JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} ${res.status}: ${text}`);
  }
  return { ms, res };
}

async function postStream(path, body, onFirstToken) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-groq-key": KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${path} ${res.status}: ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  let firstTokenMs = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (firstTokenMs == null) {
      firstTokenMs = Math.round(performance.now() - t0);
      if (onFirstToken) onFirstToken(firstTokenMs);
    }
    out += dec.decode(value, { stream: true });
  }
  const totalMs = Math.round(performance.now() - t0);
  return { totalMs, firstTokenMs, text: out };
}

function hr(label) {
  console.log("\n" + "─".repeat(70));
  console.log(label);
  console.log("─".repeat(70));
}

async function main() {
  console.log(`simulator → ${BASE}`);
  console.log(`script length: ${CHUNKS.length} chunks`);

  const batches = [];
  let meetingType = null;
  let rollingSummary = "";
  const transcribed = [];
  let summarizedUpTo = 0;
  const KEEP_LIVE = 12;
  const BATCH = 15;

  const suggestLatencies = [];
  const summarizeLatencies = [];

  for (let i = 0; i < CHUNKS.length; i++) {
    transcribed.push(CHUNKS[i]);

    if ((i + 1) % CHUNKS_PER_SUGGEST !== 0) continue;

    // Suggest
    const recent = transcriptTail(transcribed, 3);
    const prevPreviews = batches
      .slice(-PREVIEWS_WINDOW)
      .flatMap((b) => b.suggestions.map((s) => s.preview));
    const { ms, res } = await post("/api/suggest", {
      systemPrompt: SUGGEST_PROMPT,
      recentTranscript: recent,
      priorSummary: rollingSummary,
      previousPreviews: prevPreviews,
      meetingType,
    });
    const json = await res.json();
    suggestLatencies.push(ms);
    hr(`suggest #${batches.length + 1} @ chunk ${i + 1}/${CHUNKS.length}  [${ms}ms]`);
    if (json.meeting_type && !meetingType) {
      meetingType = json.meeting_type;
      console.log(`  meeting_type classified → ${meetingType}`);
    }
    if (json.insufficient_signal) {
      console.log("  insufficient_signal → skipped");
    } else {
      const types = json.suggestions.map((s) => s.type).join(", ");
      console.log(`  types: ${types}`);
      json.suggestions.forEach((s, idx) => {
        console.log(`  [${idx + 1}] (${s.type}) ${s.preview}`);
      });
      batches.push({
        suggestions: json.suggestions,
      });
    }

    // Rolling-summary trigger
    const eligible = transcribed.length - KEEP_LIVE;
    if (eligible - summarizedUpTo >= BATCH) {
      const from = summarizedUpTo;
      const to = transcribed.length - KEEP_LIVE;
      const slice = transcribed.slice(from, to).join(" ");
      const t0 = performance.now();
      const { res: sres } = await post("/api/summarize", {
        priorSummary: rollingSummary,
        transcript: slice,
        meetingType,
      });
      const sjson = await sres.json();
      const sms = Math.round(performance.now() - t0);
      summarizeLatencies.push(sms);
      rollingSummary = sjson.summary || rollingSummary;
      summarizedUpTo = to;
      hr(`summarize folded chunks ${from}..${to}  [${sms}ms]`);
      console.log(rollingSummary.split("\n").map((l) => "  " + l).join("\n"));
    }
  }

  // Pick a suggestion to expand
  hr("expand: user taps a suggestion");
  const lastBatch = batches[batches.length - 1];
  const pick = lastBatch.suggestions[0];
  console.log(`  tapped: (${pick.type}) ${pick.preview}`);
  const expand = await postStream(
    "/api/expand",
    {
      systemPrompt: EXPAND_PROMPT,
      transcript: transcribed.join(" "),
      meetingType,
      suggestion: pick,
    },
    (ms) => console.log(`  first token: ${ms}ms`),
  );
  console.log(`  total: ${expand.totalMs}ms, ${expand.text.length} chars`);
  console.log("\n" + expand.text.split("\n").map((l) => "  " + l).join("\n"));

  // Free chat
  hr("chat: user types a free question");
  const question = "What's the strongest close I should go for on this call?";
  console.log(`  user: ${question}`);
  const chat = await postStream(
    "/api/chat",
    {
      systemPrompt: CHAT_PROMPT,
      transcript: transcribed.join(" "),
      meetingType,
      history: [{ role: "user", content: question }],
    },
    (ms) => console.log(`  first token: ${ms}ms`),
  );
  console.log(`  total: ${chat.totalMs}ms, ${chat.text.length} chars`);
  console.log("\n" + chat.text.split("\n").map((l) => "  " + l).join("\n"));

  // Report
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  hr("SUMMARY");
  console.log(`  suggest calls:   ${suggestLatencies.length}, avg ${avg(suggestLatencies)}ms, max ${Math.max(...suggestLatencies)}ms`);
  console.log(`  summarize calls: ${summarizeLatencies.length}, avg ${avg(summarizeLatencies)}ms`);
  console.log(`  expand first token: ${expand.firstTokenMs}ms`);
  console.log(`  chat first token:   ${chat.firstTokenMs}ms`);
  console.log(`  meeting_type: ${meetingType}`);
  console.log(`  rolling summary length: ${rollingSummary.length} chars`);
  console.log(`  total suggestion batches: ${batches.length}`);
}

main().catch((e) => {
  console.error("simulator failed:", e);
  process.exit(1);
});
