"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ChatMessage,
  Settings,
  Suggestion,
  SuggestionBatch,
  TranscriptChunk,
} from "./types";
import { DEFAULT_SETTINGS } from "./prompts";

// ---- Settings store (persisted) ----
interface SettingsState {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: "twinmind-settings",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted) => persisted as SettingsState,
      // Graft defaults onto persisted state so new fields aren't undefined
      // after a version upgrade.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
        };
      },
    },
  ),
);

// ---- Session store (in-memory, resets on reload) ----
interface SessionState {
  sessionStart: number | null;
  isRecording: boolean;
  transcript: TranscriptChunk[];
  batches: SuggestionBatch[]; // newest first
  chat: ChatMessage[];
  meetingType: string | null;
  rollingSummary: string;

  startSession: () => void;
  stopSession: () => void;
  addChunk: (text: string) => void;
  addBatch: (batch: SuggestionBatch) => void;
  markSuggestionClicked: (batchId: string, suggestionId: string) => void;
  addChatMessage: (msg: ChatMessage) => void;
  appendToChatMessage: (id: string, delta: string) => void;
  setMeetingType: (t: string) => void;
  setRollingSummary: (s: string) => void;
  reset: () => void;
}

export const useSession = create<SessionState>((set) => ({
  sessionStart: null,
  isRecording: false,
  transcript: [],
  batches: [],
  chat: [],
  meetingType: null,
  rollingSummary: "",

  startSession: () =>
    set((s) => ({
      sessionStart: s.sessionStart ?? Date.now(),
      isRecording: true,
    })),
  stopSession: () => set({ isRecording: false }),
  addChunk: (text) =>
    set((s) => ({
      transcript: [
        ...s.transcript,
        { id: crypto.randomUUID(), timestamp: Date.now(), text },
      ],
    })),
  addBatch: (batch) => set((s) => ({ batches: [batch, ...s.batches] })),
  markSuggestionClicked: (batchId, suggestionId) =>
    set((s) => ({
      batches: s.batches.map((b) =>
        b.id === batchId
          ? {
              ...b,
              clickedIds: b.clickedIds.includes(suggestionId)
                ? b.clickedIds
                : [...b.clickedIds, suggestionId],
            }
          : b,
      ),
    })),
  addChatMessage: (msg) => set((s) => ({ chat: [...s.chat, msg] })),
  appendToChatMessage: (id, delta) =>
    set((s) => ({
      chat: s.chat.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m,
      ),
    })),
  setMeetingType: (t) => set({ meetingType: t }),
  setRollingSummary: (s) => set({ rollingSummary: s }),
  reset: () =>
    set({
      sessionStart: null,
      isRecording: false,
      transcript: [],
      batches: [],
      chat: [],
      meetingType: null,
      rollingSummary: "",
    }),
}));

export function findSuggestion(
  batches: SuggestionBatch[],
  suggestionId: string,
): { batch: SuggestionBatch; suggestion: Suggestion } | null {
  for (const b of batches) {
    const s = b.suggestions.find((x) => x.id === suggestionId);
    if (s) return { batch: b, suggestion: s };
  }
  return null;
}
