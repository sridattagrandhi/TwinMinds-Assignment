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
