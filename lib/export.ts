"use client";

import type {
  ChatMessage,
  SuggestionBatch,
  TranscriptChunk,
} from "./types";

export function buildExport(args: {
  sessionStart: number | null;
  meetingType: string | null;
  transcript: TranscriptChunk[];
  batches: SuggestionBatch[];
  chat: ChatMessage[];
}) {
  return {
    session_start: args.sessionStart ? new Date(args.sessionStart).toISOString() : null,
    exported_at: new Date().toISOString(),
    meeting_type: args.meetingType,
    transcript: args.transcript.map((c) => ({
      timestamp: new Date(c.timestamp).toISOString(),
      text: c.text,
    })),
    suggestion_batches: args.batches
      .slice()
      .reverse()
      .map((b) => ({
        timestamp: new Date(b.timestamp).toISOString(),
        meeting_type: b.meetingType,
        suggestions: b.suggestions.map((s) => ({
          type: s.type,
          preview: s.preview,
          detail_seed: s.detail_seed,
          clicked: b.clickedIds.includes(s.id),
        })),
      })),
    chat: args.chat.map((m) => ({
      timestamp: new Date(m.timestamp).toISOString(),
      role: m.role,
      content: m.content,
      from_suggestion: m.fromSuggestionId ? true : false,
    })),
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
