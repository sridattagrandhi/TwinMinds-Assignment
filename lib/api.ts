"use client";

import type { Suggestion } from "./types";
import { blobExtension } from "./recorder";

function authHeaders(apiKey: string): HeadersInit {
  return { "x-groq-key": apiKey };
}

export async function transcribeChunk(
  blob: Blob,
  apiKey: string,
  opts?: { priorText?: string; language?: string },
): Promise<string> {
  const form = new FormData();
  const ext = blobExtension(blob);
  form.append("audio", new File([blob], `chunk.${ext}`, { type: blob.type }));
  if (opts?.priorText) form.append("prompt", opts.priorText);
  if (opts?.language) form.append("language", opts.language);
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: authHeaders(apiKey),
    body: form,
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error || "Transcription failed");
  }
  const { text } = await res.json();
  return text || "";
}

export interface SuggestResponse {
  meeting_type?: string;
  insufficient_signal?: boolean;
  suggestions: Omit<Suggestion, "id">[];
}

export async function fetchSuggestions(args: {
  apiKey: string;
  systemPrompt: string;
  recentTranscript: string;
  priorSummary: string;
  previousPreviews: string[];
  meetingType: string | null;
}): Promise<SuggestResponse> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { ...authHeaders(args.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      systemPrompt: args.systemPrompt,
      recentTranscript: args.recentTranscript,
      priorSummary: args.priorSummary,
      previousPreviews: args.previousPreviews,
      meetingType: args.meetingType,
    }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error || "Suggest failed");
  }
  const data = await res.json();
  if (data.insufficient_signal) {
    return { insufficient_signal: true, suggestions: [], meeting_type: data.meeting_type };
  }
  return {
    meeting_type: data.meeting_type,
    insufficient_signal: false,
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
  };
}

export async function streamExpand(
  args: {
    apiKey: string;
    systemPrompt: string;
    transcript: string;
    meetingType: string | null;
    suggestion: { type: string; preview: string; detail_seed?: string };
  },
  onDelta: (delta: string) => void,
): Promise<void> {
  const res = await fetch("/api/expand", {
    method: "POST",
    headers: { ...authHeaders(args.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      systemPrompt: args.systemPrompt,
      transcript: args.transcript,
      meetingType: args.meetingType,
      suggestion: args.suggestion,
    }),
  });
  await readStream(res, onDelta);
}

export async function streamChat(
  args: {
    apiKey: string;
    systemPrompt: string;
    transcript: string;
    meetingType: string | null;
    history: { role: "user" | "assistant"; content: string }[];
  },
  onDelta: (delta: string) => void,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { ...authHeaders(args.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  await readStream(res, onDelta);
}

async function readStream(res: Response, onDelta: (d: string) => void) {
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || "Stream failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) onDelta(chunk);
  }
}
