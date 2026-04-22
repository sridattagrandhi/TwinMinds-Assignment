import type { SuggestionBatch, TranscriptChunk } from "./types";

export function transcriptWindow(
  chunks: TranscriptChunk[],
  minutes: number,
): string {
  if (!chunks.length) return "";
  if (minutes <= 0) return chunks.map((c) => c.text).join(" ");
  const cutoff = Date.now() - minutes * 60_000;
  const windowed = chunks.filter((c) => c.timestamp >= cutoff);
  const used = windowed.length ? windowed : chunks.slice(-3);
  return used.map((c) => c.text).join(" ");
}

export function previousPreviews(
  batches: SuggestionBatch[],
  n = 2,
): string[] {
  return batches
    .slice(0, n)
    .flatMap((b) => b.suggestions.map((s) => s.preview));
}
