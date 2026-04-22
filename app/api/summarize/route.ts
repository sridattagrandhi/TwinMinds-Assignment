import { errorResponse, getApiKey, groqClient, LLM_MODEL, missingKeyResponse } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 30;

interface SummarizeRequest {
  priorSummary: string;
  transcript: string;
  meetingType: string | null;
}

const SYSTEM_PROMPT = `You are compressing the earlier portion of a live meeting so a copilot can retain long-horizon context once those chunks scroll out of the live window.

Output a compact bulleted summary (<=180 words total) covering: participants/roles if stated, the main topics touched, open questions, decisions, numeric/named claims, and action items. Merge the PRIOR_SUMMARY into the new one — do not drop facts from it. Plain text, no preamble, no meta-commentary.`;

export async function POST(req: Request) {
  const apiKey = getApiKey(req);
  if (!apiKey) return missingKeyResponse();

  let body: SummarizeRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userContent = [
    `MEETING_TYPE: ${body.meetingType ?? "unknown"}`,
    `PRIOR_SUMMARY:\n${body.priorSummary || "(none)"}`,
    `NEW_TRANSCRIPT:\n${body.transcript || "(empty)"}`,
  ].join("\n\n");

  try {
    const groq = groqClient(apiKey);
    const completion = await groq.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });
    const summary = completion.choices[0]?.message?.content?.trim() ?? "";
    return Response.json({ summary });
  } catch (err) {
    return errorResponse(err, "Summarize failed");
  }
}
