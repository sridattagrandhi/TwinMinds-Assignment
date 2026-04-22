"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/store";
import { Markdown } from "./Markdown";

export function ChatColumn({
  onSend,
  isStreaming,
}: {
  onSend: (text: string) => void;
  isStreaming: boolean;
}) {
  const chat = useSession((s) => s.chat);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Recompute a cheap signature of the chat so we re-scroll on every token
  // stream delta, not just when a message is added or removed.
  const signature = chat.length + ":" + (chat.at(-1)?.content.length ?? 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-stick to bottom if the user is already near the bottom; lets
    // them scroll up to re-read without being yanked back down.
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [signature]);

  const submit = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold">Chat</h2>
        {isStreaming && <span className="text-xs text-neutral-500">Thinking…</span>}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 text-sm"
      >
        {chat.length === 0 && (
          <p className="italic text-neutral-500">
            Click a suggestion or type a question to start chatting. One continuous chat per session.
          </p>
        )}
        {chat.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-lg bg-white text-black px-3 py-2"
                  : "max-w-[92%] rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-100"
              }
            >
              {m.fromSuggestionId && m.role === "user" && (
                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
                  from suggestion
                </div>
              )}
              {m.role === "assistant" ? (
                m.content ? (
                  <Markdown text={m.content} />
                ) : (
                  <div className="text-neutral-500">…</div>
                )
              ) : (
                <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-neutral-800 p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask anything about the meeting…"
            className="flex-1 rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button
            onClick={submit}
            disabled={isStreaming || !input.trim()}
            className="rounded bg-white text-black px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
