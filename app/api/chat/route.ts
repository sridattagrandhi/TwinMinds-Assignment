import { getApiKey, groqClient, LLM_MODEL, missingKeyResponse } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatRequest {
  systemPrompt: string;
  transcript: string;
  meetingType: string | null;
  history: { role: "user" | "assistant"; content: string }[];
}

export async function POST(req: Request) {
  const apiKey = getApiKey(req);
  if (!apiKey) return missingKeyResponse();

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const contextMsg = `MEETING_TYPE: ${body.meetingType ?? "unknown"}\n\nTRANSCRIPT:\n${
    body.transcript || "(empty)"
  }`;

  try {
    const groq = groqClient(apiKey);
    const stream = await groq.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.5,
      stream: true,
      messages: [
        { role: "system", content: body.systemPrompt },
        { role: "system", content: contextMsg },
        ...body.history,
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
    const message = err instanceof Error ? err.message : "Chat failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
