"use client";

import { useSession } from "@/lib/store";
import type { Suggestion, SuggestionBatch, SuggestionType } from "@/lib/types";

const TYPE_LABEL: Record<SuggestionType, string> = {
  question: "Ask",
  talking_point: "Say",
  answer: "Answer",
  fact_check: "Fact-check",
  clarification: "Clarify",
  definition: "Define",
};

const TYPE_COLOR: Record<SuggestionType, string> = {
  question: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  talking_point: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  answer: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  fact_check: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  clarification: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  definition: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export function SuggestionsColumn({
  onRefresh,
  onClickSuggestion,
  isLoading,
}: {
  onRefresh: () => void;
  onClickSuggestion: (batch: SuggestionBatch, s: Suggestion) => void;
  isLoading: boolean;
}) {
  const batches = useSession((s) => s.batches);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold">Live suggestions</h2>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          {isLoading ? "Thinking…" : "Refresh"}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        {batches.length === 0 && (
          <p className="text-sm italic text-neutral-500">
            Suggestions will appear here every ~30 seconds. Click a card to get a detailed answer in the chat.
          </p>
        )}
        {batches.map((b) => (
          <div key={b.id} className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {new Date(b.timestamp).toLocaleTimeString()}
              {b.meetingType && ` · ${b.meetingType.replace(/_/g, " ")}`}
            </div>
            {b.suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => onClickSuggestion(b, s)}
                className="group block w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-600 hover:bg-neutral-800/60 transition"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      TYPE_COLOR[s.type] ?? "border-neutral-700 text-neutral-400"
                    }`}
                  >
                    {TYPE_LABEL[s.type] ?? s.type}
                  </span>
                  {b.clickedIds.includes(s.id) && (
                    <span className="text-[10px] text-neutral-500">opened</span>
                  )}
                </div>
                <p className="text-sm text-neutral-100 leading-snug">{s.preview}</p>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
