"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/lib/store";

export function TranscriptColumn({ transcribing }: { transcribing: boolean }) {
  const transcript = useSession((s) => s.transcript);
  const isRecording = useSession((s) => s.isRecording);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [transcript.length]);

  const subtitle = !isRecording
    ? "Idle"
    : transcribing
      ? "Transcribing…"
      : "Recording…";

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold">Transcript</h2>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {isRecording && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          )}
          {subtitle}
        </span>
      </div>
      <div
        ref={ref}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 text-sm leading-relaxed"
      >
        {transcript.length === 0 && (
          <p className="text-neutral-500 italic">
            Press the mic to start. Transcript appears here in short chunks as you speak.
          </p>
        )}
        {transcript.map((c) => (
          <div key={c.id}>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {new Date(c.timestamp).toLocaleTimeString()}
            </div>
            <p className="text-neutral-200">{c.text}</p>
          </div>
        ))}
        {isRecording && transcribing && (
          <p className="text-neutral-500 italic text-xs">…</p>
        )}
      </div>
    </div>
  );
}
