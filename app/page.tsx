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

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [handleChunk]);

  // Manual refresh: if recording, force the current audio chunk to flush
  // through transcription first, then fire a suggest batch. When not
  // recording, just run suggest over whatever we have.
  const onManualRefresh = useCallback(async () => {
    if (recorderRef.current && sessionRef.current.isRecording) {
      const transcribedBefore = transcribingCount;
      const chunkCountBefore = sessionRef.current.transcript.length;
      recorderRef.current.flush();
      // Wait for the flushed chunk to be transcribed (appears as a new chunk
      // in the transcript). Give up after 10s either way.
      const start = Date.now();
      while (Date.now() - start < 10000) {
        await new Promise((r) => setTimeout(r, 150));
        const latestCount = useSession.getState().transcript.length;
        if (latestCount > chunkCountBefore) break;
        // Also break if no transcription is in flight (flush produced silence).
        if (transcribedBefore === 0 && transcribingCount === 0 && Date.now() - start > 2000) {
          break;
        }
      }
    }
    await runSuggest();
  }, [runSuggest, transcribingCount]);

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

      setChatStreaming(true);
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
          },
          (delta) => useSession.getState().appendToChatMessage(asstId, delta),
        );
      } catch (e) {
        useSession
          .getState()
          .appendToChatMessage(
            asstId,
            `\n\n[error: ${e instanceof Error ? e.message : String(e)}]`,
          );
      } finally {
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
    setChatStreaming(true);
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
        },
        (delta) => useSession.getState().appendToChatMessage(asstId, delta),
      );
    } catch (e) {
      useSession
        .getState()
        .appendToChatMessage(
          asstId,
          `\n\n[error: ${e instanceof Error ? e.message : String(e)}]`,
        );
    } finally {
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
