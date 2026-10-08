import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { instructions } from "@/lib/instructions";
import { getModel } from "@/lib/llm";
import { resolveLocation } from "@/lib/tools/resolve-location";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: getModel(),
    instructions,
    messages: await convertToModelMessages(messages),
    tools: { resolveLocation },
    stopWhen: isStepCount(5),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
