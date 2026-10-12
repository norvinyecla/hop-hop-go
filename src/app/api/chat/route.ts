import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { instructionsAt } from "@/lib/instructions";
import { getModel } from "@/lib/llm";
import { tools } from "@/lib/tools";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: getModel(),
    instructions: instructionsAt(new Date()),
    // Pass tools so planTrip's toModelOutput also applies to results from earlier turns.
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: isStepCount(5),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
