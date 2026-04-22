import { errorResponse, getApiKey, groqClient, LLM_MODEL, missingKeyResponse } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 30;

interface SuggestRequest {
  systemPrompt: string;
  recentTranscript: string;
  priorSummary: string;
  previousPreviews: string[];
  meetingType: string | null;
}

export async function POST(req: Request) {
  const apiKey = getApiKey(req);
  if (!apiKey) return missingKeyResponse();

  let body: SuggestRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userContent = [
    `MEETING_TYPE: ${body.meetingType ?? "unknown"}`,
    `PRIOR_SUMMARY:\n${body.priorSummary || "(none yet)"}`,
    `PREVIOUS_PREVIEWS:\n${
      body.previousPreviews.length
        ? body.previousPreviews.map((p) => `- ${p}`).join("\n")
        : "(none)"
    }`,
    `RECENT_TRANSCRIPT:\n${body.recentTranscript || "(silence)"}`,
  ].join("\n\n");

  try {
    const groq = groqClient(apiKey);
    const completion = await groq.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: body.systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    return Response.json(parsed);
  } catch (err) {
    return errorResponse(err, "Suggest failed");
  }
}
