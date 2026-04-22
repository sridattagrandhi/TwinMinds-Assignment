import { errorResponse, getApiKey, groqClient, LLM_MODEL, missingKeyResponse } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ExpandRequest {
  systemPrompt: string;
  transcript: string;
  meetingType: string | null;
  suggestion: { type: string; preview: string; detail_seed?: string };
}

export async function POST(req: Request) {
  const apiKey = getApiKey(req);
  if (!apiKey) return missingKeyResponse();

  let body: ExpandRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userContent = [
    `MEETING_TYPE: ${body.meetingType ?? "unknown"}`,
    `TRANSCRIPT:\n${body.transcript || "(empty)"}`,
    `TAPPED_SUGGESTION:\n- type: ${body.suggestion.type}\n- preview: ${body.suggestion.preview}${
      body.suggestion.detail_seed ? `\n- angle: ${body.suggestion.detail_seed}` : ""
    }`,
  ].join("\n\n");

  try {
    const groq = groqClient(apiKey);
    const stream = await groq.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.5,
      stream: true,
      messages: [
        { role: "system", content: body.systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (delta) controller.enqueue(encoder.encode(delta));
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    return errorResponse(err, "Expand failed");
  }
}
