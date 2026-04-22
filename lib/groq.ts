import Groq from "groq-sdk";

export const TRANSCRIBE_MODEL = "whisper-large-v3";
export const LLM_MODEL = "openai/gpt-oss-120b";

export function getApiKey(req: Request): string | null {
  const header = req.headers.get("x-groq-key");
  if (header && header.trim()) return header.trim();
  return null;
}

export function groqClient(apiKey: string) {
  return new Groq({ apiKey });
}

export function missingKeyResponse() {
  return new Response(
    JSON.stringify({ error: "Missing Groq API key. Add it in Settings." }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

// Translate a thrown Groq/SDK error into a JSON Response that preserves the
// upstream status (401 invalid key, 429 rate-limited, etc.) so the client can
// show a useful message instead of a generic 500.
export function errorResponse(err: unknown, fallback: string) {
  const e = err as { status?: number; message?: string };
  const status =
    typeof e?.status === "number" && e.status >= 400 && e.status < 600
      ? e.status
      : 500;
  const message = e?.message || fallback;
  return Response.json({ error: message }, { status });
}
