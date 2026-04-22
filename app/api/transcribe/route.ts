import { errorResponse, getApiKey, groqClient, missingKeyResponse, TRANSCRIBE_MODEL } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const apiKey = getApiKey(req);
  if (!apiKey) return missingKeyResponse();

  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) {
    return Response.json({ error: "No audio file provided" }, { status: 400 });
  }
  const contextPrompt = (form.get("prompt") as string | null) ?? undefined;
  const language = (form.get("language") as string | null) ?? "en";

  try {
    const groq = groqClient(apiKey);
    const result = await groq.audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      response_format: "text",
      temperature: 0,
      language,
      ...(contextPrompt ? { prompt: contextPrompt.slice(-900) } : {}),
    });
    const text = typeof result === "string" ? result : (result as { text?: string }).text ?? "";
    return Response.json({ text: text.trim() });
  } catch (err) {
    return errorResponse(err, "Transcription failed");
  }
}
