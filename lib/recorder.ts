"use client";

// Chunked MediaRecorder: every `chunkMs`, stop the current recorder, hand the
// blob to `onChunk`, and start a fresh recorder. Each chunk is a standalone
// WebM file — safe to POST directly to Whisper.

export interface ChunkedRecorder {
  stop: () => Promise<void>;
  flush: () => void;
}

export async function startChunkedRecorder(
  onChunk: (blob: Blob) => void,
  chunkMs: number,
): Promise<ChunkedRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  const mime = pickMime();
  let recorder: MediaRecorder | null = null;
  let parts: Blob[] = [];
  let timer: number | null = null;
  let stopped = false;

  const startOne = () => {
    parts = [];
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    recorder.onerror = (ev) => {
      console.error("MediaRecorder error", ev);
    };
    recorder.onstop = () => {
      if (parts.length) {
        const blob = new Blob(parts, { type: mime || "audio/webm" });
        if (blob.size > 1024) onChunk(blob);
      }
      if (!stopped) startOne();
    };
    recorder.start();
    timer = window.setTimeout(() => {
      if (recorder && recorder.state === "recording") recorder.stop();
    }, chunkMs);
  };

  startOne();

  return {
    stop: async () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      if (recorder && recorder.state === "recording") {
        await new Promise<void>((resolve) => {
          recorder!.addEventListener("stop", () => resolve(), { once: true });
          recorder!.stop();
        });
      }
      stream.getTracks().forEach((t) => t.stop());
    },
    // Cut the current chunk early. onstop emits what's buffered and startOne()
    // begins a fresh chunk, so the cadence restarts from "now".
    flush: () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (recorder && recorder.state === "recording") recorder.stop();
    },
  };
}

function pickMime(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

export function blobExtension(blob: Blob): string {
  const t = blob.type;
  if (t.includes("webm")) return "webm";
  if (t.includes("mp4")) return "mp4";
  if (t.includes("ogg")) return "ogg";
  return "webm";
}
