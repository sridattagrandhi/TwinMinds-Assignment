"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/lib/store";
import { DEFAULT_SETTINGS } from "@/lib/prompts";

export function SettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { settings, setSettings, resetSettings } = useSettings();
  const [local, setLocal] = useState(settings);

  useEffect(() => {
    if (open) setLocal(settings);
  }, [open, settings]);

  if (!open) return null;

  const save = () => {
    setSettings(local);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-neutral-900 border border-neutral-700 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-700 px-5 py-3">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-sm"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          <Field label="Groq API Key" hint="Stored locally in your browser. Never sent anywhere except Groq via this app's server routes.">
            <input
              type="password"
              className="w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2 font-mono text-xs"
              placeholder="gsk_..."
              value={local.apiKey}
              onChange={(e) => setLocal({ ...local, apiKey: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-4 gap-3">
            <Field label="Transcribe chunk (s)" hint="shorter = more real-time">
              <input
                type="number"
                min={3}
                max={30}
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2"
                value={local.transcribeChunkSec}
                onChange={(e) =>
                  setLocal({ ...local, transcribeChunkSec: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Suggest refresh (s)">
              <input
                type="number"
                min={10}
                max={120}
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2"
                value={local.refreshIntervalSec}
                onChange={(e) =>
                  setLocal({ ...local, refreshIntervalSec: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Live context (min)">
              <input
                type="number"
                min={1}
                max={30}
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2"
                value={local.liveContextMinutes}
                onChange={(e) =>
                  setLocal({ ...local, liveContextMinutes: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Expand context (min)" hint="0 = full">
              <input
                type="number"
                min={0}
                max={120}
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2"
                value={local.expandContextMinutes}
                onChange={(e) =>
                  setLocal({ ...local, expandContextMinutes: Number(e.target.value) })
                }
              />
            </Field>
          </div>

          <Field label="Live suggestion prompt">
            <textarea
              rows={8}
              className="w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2 font-mono text-xs"
              value={local.suggestPrompt}
              onChange={(e) => setLocal({ ...local, suggestPrompt: e.target.value })}
            />
          </Field>
          <Field label="Detailed answer (expand) prompt">
            <textarea
              rows={5}
              className="w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2 font-mono text-xs"
              value={local.expandPrompt}
              onChange={(e) => setLocal({ ...local, expandPrompt: e.target.value })}
            />
          </Field>
          <Field label="Chat prompt">
            <textarea
              rows={4}
              className="w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2 font-mono text-xs"
              value={local.chatPrompt}
              onChange={(e) => setLocal({ ...local, chatPrompt: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between border-t border-neutral-700 px-5 py-3">
          <button
            onClick={() => {
              resetSettings();
              setLocal(DEFAULT_SETTINGS);
            }}
            className="text-xs text-neutral-400 hover:text-white"
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="rounded bg-white text-black px-3 py-1.5 text-sm font-medium hover:bg-neutral-200"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-300">{label}</span>
        {hint && <span className="text-[10px] text-neutral-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
