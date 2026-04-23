"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SettingsModal } from "@/components/SettingsModal";
import { TranscriptColumn } from "@/components/TranscriptColumn";
import { SuggestionsColumn } from "@/components/SuggestionsColumn";
import { ChatColumn } from "@/components/ChatColumn";
import { useSession, useSettings } from "@/lib/store";
import {
  fetchSuggestions,
  streamChat,
  streamExpand,
  summarizeTranscript,
  transcribeChunk,
} from "@/lib/api";
import { previousPreviews, transcriptWindow } from "@/lib/context";
import { startChunkedRecorder, type ChunkedRecorder } from "@/lib/recorder";
import type { Suggestion, SuggestionBatch } from "@/lib/types";
import { buildExport, downloadJson } from "@/lib/export";
import {
  Mic,
  Square,
  RefreshCw,
  Download,
  Trash2,
  Settings as SettingsIcon,
  AlertCircle,
} from "lucide-react";

export default function Home() {
  const { settings } = useSettings();
  const session = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const lastSuggestAtRef = useRef<number>(0);
  const [transcribingCount, setTranscribingCount] = useState(0);
  // Index (exclusive) of the last transcript chunk folded into rollingSummary.
  const summarizedUpToRef = useRef<number>(0);
  const summarizingRef = useRef<boolean>(false);
  const chatAbortRef = useRef<AbortController | null>(null);

  const sessionRef = useRef(session);
  const settingsRef = useRef(settings);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const runSuggest = useCallback(async () => {
    const s = settingsRef.current;
    const sess = sessionRef.current;
    if (!s.apiKey) {
      setError("Add your Groq API key in Settings.");
      return;
    }
    if (suggestLoading) return;
    setSuggestLoading(true);
    setError(null);
    try {
      const recent = transcriptWindow(sess.transcript, s.liveContextMinutes);
      const resp = await fetchSuggestions({
        apiKey: s.apiKey,
        systemPrompt: s.suggestPrompt,
        recentTranscript: recent,
        priorSummary: sess.rollingSummary,
        previousPreviews: previousPreviews(sess.batches, 2),
        meetingType: sess.meetingType,
      });
      if (resp.meeting_type && !sess.meetingType) {
        useSession.getState().setMeetingType(resp.meeting_type);
      }
      if (resp.insufficient_signal || !resp.suggestions.length) {
        lastSuggestAtRef.current = Date.now();
        return;
      }
      const batch: SuggestionBatch = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        meetingType: resp.meeting_type ?? sess.meetingType ?? undefined,
        clickedIds: [],
        suggestions: resp.suggestions.map((x) => ({
          id: crypto.randomUUID(),
          type: x.type,
          preview: x.preview,
          detail_seed: x.detail_seed,
        })),
      };
      useSession.getState().addBatch(batch);
      lastSuggestAtRef.current = Date.now();
    } catch (e) {
      setError(friendlyApiError(e));
    } finally {
      setSuggestLoading(false);
    }
  }, [suggestLoading]);

  const handleChunk = useCallback(async (blob: Blob) => {
    const apiKey = settingsRef.current.apiKey;
    if (!apiKey) return;
    setTranscribingCount((n) => n + 1);
    try {
      // Feed Whisper the tail of the running transcript so proper nouns and
      // vocabulary carry across chunks, and so it doesn't re-hallucinate a
      // language on short/quiet clips.
      const priorText = sessionRef.current.transcript
        .slice(-6)
        .map((c) => c.text)
        .join(" ");
      const text = await transcribeChunk(blob, apiKey, {
        priorText,
        language: "en",
      });
      if (text) useSession.getState().addChunk(text);
    } catch (e) {
      setError(friendlyApiError(e));
    } finally {
      setTranscribingCount((n) => Math.max(0, n - 1));
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!settingsRef.current.apiKey) {
      setError("Add your Groq API key in Settings first.");
      setSettingsOpen(true);
      return;
    }
    setError(null);
    try {
      const raw = Number(settingsRef.current.transcribeChunkSec);
      const chunkMs = Math.max(3, Number.isFinite(raw) ? raw : 5) * 1000;
      const rec = await startChunkedRecorder(handleChunk, chunkMs);
      recorderRef.current = rec;
      lastSuggestAtRef.current = Date.now();
      useSession.getState().startSession();
    } catch (e) {
      setError(friendlyMicError(e));
    }
  }, [handleChunk]);

  // Manual refresh: suggest immediately over whatever transcript we already
  // have (low latency), and kick off an audio flush in the background so the
  // next auto-suggest sees fresher context.
  const onManualRefresh = useCallback(async () => {
    if (recorderRef.current && sessionRef.current.isRecording) {
      recorderRef.current.flush();
    }
    const t0 = performance.now();
    await runSuggest();
    console.info(`[latency] refresh→rendered: ${Math.round(performance.now() - t0)}ms`);
  }, [runSuggest]);

  const stopRecording = useCallback(async () => {
    if (recorderRef.current) {
      await recorderRef.current.stop();
      recorderRef.current = null;
    }
    useSession.getState().stopSession();
  }, []);

  // Fire a suggest batch whenever a new transcript chunk arrives AND it's been
  // >= refreshIntervalSec since the last batch. Simpler and more reliable than
  // setInterval, which gets racy with React rerenders.
  const latestChunkTs =
    useSession((s) => s.transcript.at(-1)?.timestamp) ?? 0;
  useEffect(() => {
    if (!session.isRecording) return;
    if (!latestChunkTs) return;
    const intervalMs = Math.max(10, settings.refreshIntervalSec) * 1000;
    if (Date.now() - lastSuggestAtRef.current < intervalMs) return;
    void runSuggest();
  }, [latestChunkTs, session.isRecording, settings.refreshIntervalSec, runSuggest]);

  // Long-session memory: once the transcript grows past what fits in the live
  // window, fold the older chunks into rollingSummary so suggest still sees
  // that context. Leaves the last ~12 chunks in the live window.
  const transcriptLen = useSession((s) => s.transcript.length);
  useEffect(() => {
    const KEEP_LIVE = 12;
    const BATCH = 15;
    if (summarizingRef.current) return;
    const eligible = transcriptLen - KEEP_LIVE;
    if (eligible - summarizedUpToRef.current < BATCH) return;
    const apiKey = settingsRef.current.apiKey;
    if (!apiKey) return;
    summarizingRef.current = true;
    (async () => {
      const sess = sessionRef.current;
      const from = summarizedUpToRef.current;
      const to = sess.transcript.length - KEEP_LIVE;
      if (to <= from) {
        summarizingRef.current = false;
        return;
      }
      const slice = sess.transcript.slice(from, to).map((c) => c.text).join(" ");
      try {
        const summary = await summarizeTranscript({
          apiKey,
          priorSummary: sess.rollingSummary,
          transcript: slice,
          meetingType: sess.meetingType,
        });
        if (summary) useSession.getState().setRollingSummary(summary);
        summarizedUpToRef.current = to;
      } catch (e) {
        // Non-fatal: suggest still works without a fresh summary.
        console.warn("summarize failed", e);
      } finally {
        summarizingRef.current = false;
      }
    })();
  }, [transcriptLen]);

  const onClickSuggestion = useCallback(
    async (batch: SuggestionBatch, s: Suggestion) => {
      const st = settingsRef.current;
      if (!st.apiKey) {
        setError("Add your Groq API key in Settings.");
        return;
      }
      useSession.getState().markSuggestionClicked(batch.id, s.id);

      const userMsgId = crypto.randomUUID();
      useSession.getState().addChatMessage({
        id: userMsgId,
        role: "user",
        content: s.preview,
        timestamp: Date.now(),
        fromSuggestionId: s.id,
      });
      const asstId = crypto.randomUUID();
      useSession.getState().addChatMessage({
        id: asstId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      });

      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;
      setChatStreaming(true);
      const t0 = performance.now();
      let firstToken = true;
      try {
        const transcript = transcriptWindow(
          sessionRef.current.transcript,
          st.expandContextMinutes,
        );
        await streamExpand(
          {
            apiKey: st.apiKey,
            systemPrompt: st.expandPrompt,
            transcript,
            meetingType: sessionRef.current.meetingType,
            suggestion: {
              type: s.type,
              preview: s.preview,
              detail_seed: s.detail_seed,
            },
            signal: controller.signal,
          },
          (delta) => {
            if (firstToken) {
              firstToken = false;
              console.info(
                `[latency] expand→first token: ${Math.round(performance.now() - t0)}ms`,
              );
            }
            useSession.getState().appendToChatMessage(asstId, delta);
          },
        );
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        useSession
          .getState()
          .appendToChatMessage(
            asstId,
            `\n\n[error: ${e instanceof Error ? e.message : String(e)}]`,
          );
      } finally {
        if (chatAbortRef.current === controller) chatAbortRef.current = null;
        setChatStreaming(false);
      }
    },
    [],
  );

  const onChatSend = useCallback(async (text: string) => {
    const st = settingsRef.current;
    if (!st.apiKey) {
      setError("Add your Groq API key in Settings.");
      return;
    }
    const userId = crypto.randomUUID();
    useSession.getState().addChatMessage({
      id: userId,
      role: "user",
      content: text,
      timestamp: Date.now(),
    });
    const asstId = crypto.randomUUID();
    useSession.getState().addChatMessage({
      id: asstId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    });
    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;
    setChatStreaming(true);
    const t0 = performance.now();
    let firstToken = true;
    try {
      const transcript = transcriptWindow(
        sessionRef.current.transcript,
        st.expandContextMinutes,
      );
      const history = [
        ...sessionRef.current.chat.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ];
      await streamChat(
        {
          apiKey: st.apiKey,
          systemPrompt: st.chatPrompt,
          transcript,
          meetingType: sessionRef.current.meetingType,
          history,
          signal: controller.signal,
        },
        (delta) => {
          if (firstToken) {
            firstToken = false;
            console.info(
              `[latency] chat→first token: ${Math.round(performance.now() - t0)}ms`,
            );
          }
          useSession.getState().appendToChatMessage(asstId, delta);
        },
      );
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      useSession
        .getState()
        .appendToChatMessage(
          asstId,
          `\n\n[error: ${e instanceof Error ? e.message : String(e)}]`,
        );
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      setChatStreaming(false);
    }
  }, []);

  const onExport = () => {
    const s = useSession.getState();
    const data = buildExport({
      sessionStart: s.sessionStart,
      meetingType: s.meetingType,
      transcript: s.transcript,
      batches: s.batches,
      chat: s.chat,
    });
    downloadJson(
      `twinmind-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      data,
    );
  };

  const onReset = () => {
    if (session.isRecording) return;
    if (confirm("Clear this session? Transcript, suggestions, and chat will be erased.")) {
      useSession.getState().reset();
      summarizedUpToRef.current = 0;
      lastSuggestAtRef.current = 0;
    }
  };

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <TopBar
        isRecording={session.isRecording}
        meetingType={session.meetingType}
        onToggleMic={session.isRecording ? stopRecording : startRecording}
        onOpenSettings={() => setSettingsOpen(true)}
        onExport={onExport}
        onReset={onReset}
        onRefresh={onManualRefresh}
        hasData={session.transcript.length > 0 || session.batches.length > 0}
      />
      {error && (
        <div className="flex items-center gap-2 border-b border-red-900/60 bg-red-950/50 px-4 py-2 text-xs text-red-200">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-300/70 hover:text-red-100"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <TranscriptColumn transcribing={transcribingCount > 0} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <SuggestionsColumn
            onRefresh={onManualRefresh}
            onClickSuggestion={onClickSuggestion}
            isLoading={suggestLoading}
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <ChatColumn onSend={onChatSend} isStreaming={chatStreaming} />
        </div>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function TopBar({
  isRecording,
  meetingType,
  onToggleMic,
  onOpenSettings,
  onExport,
  onReset,
  onRefresh,
  hasData,
}: {
  isRecording: boolean;
  meetingType: string | null;
  onToggleMic: () => void;
  onOpenSettings: () => void;
  onExport: () => void;
  onReset: () => void;
  onRefresh: () => void;
  hasData: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950/80 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-gradient-to-br from-indigo-400 to-indigo-600" />
          <div className="text-sm font-semibold tracking-tight">
            TwinMind <span className="text-neutral-500">· Live</span>
          </div>
        </div>
        {isRecording && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-red-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            Rec
          </span>
        )}
        {meetingType && (
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
            {meetingType.replace(/_/g, " ")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <IconButton onClick={onRefresh} title="Refresh suggestions">
          <RefreshCw className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton onClick={onExport} disabled={!hasData} title="Export session">
          <Download className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          onClick={onReset}
          disabled={isRecording || !hasData}
          title="Reset session"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton onClick={onOpenSettings} title="Settings">
          <SettingsIcon className="h-3.5 w-3.5" />
        </IconButton>
        <button
          onClick={onToggleMic}
          className={`ml-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            isRecording
              ? "bg-red-500 text-white hover:bg-red-600"
              : "bg-indigo-500 text-white hover:bg-indigo-600"
          }`}
        >
          {isRecording ? (
            <>
              <Square className="h-3.5 w-3.5" fill="currentColor" />
              Stop
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5" />
              Start mic
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
    >
      {children}
    </button>
  );
}

function friendlyMicError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
    return "Microphone permission denied. Allow mic access in your browser, then click Start again.";
  }
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
    return "No microphone found. Plug one in or pick a different input device.";
  }
  return err?.message || "Couldn't start the microphone.";
}

// Translate messages thrown by lib/api.ts (which carry the server's error
// string verbatim) into something a user can act on.
function friendlyApiError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const low = msg.toLowerCase();
  if (low.includes("401") || low.includes("invalid_api_key") || low.includes("invalid api key")) {
    return "Groq rejected the API key. Double-check it in Settings.";
  }
  if (low.includes("429") || low.includes("rate") || low.includes("quota")) {
    return "Groq rate-limited this request. Wait a moment and try again.";
  }
  return msg;
}
