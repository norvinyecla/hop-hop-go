import { convertToModelMessages, safeValidateUIMessages, type ModelMessage } from "ai";
import { CHAT_LIMITS } from "@/lib/chat-limits";
import { JsonBodyError, readJson } from "@/lib/read-json";
import { tools, type ChatMessage } from "@/lib/tools";

/** A request /api/chat refuses. The message is shown to the user. */
export class ChatRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "ChatRequestError";
  }
}

const TOO_LONG = "This conversation is too long. Please reload the page to start a new one.";
const INVALID = "That request wasn't understood. Please reload the page and try again.";

const ASSISTANT_PART_TYPES = new Set(["text", "reasoning", "step-start"]);
const TOOL_PART_TYPES = new Set(Object.keys(tools).map((name) => `tool-${name}`));

/** A chat request /api/chat accepted. */
export type ChatRequest = {
  /** The client's conversation ID, or undefined if missing or malformed. Not trusted: use it only to group traces. */
  chatId?: string;
  messages: ModelMessage[];
  /** The trace ID and feedback token /api/chat sent with the reply before the latest user message. Not trusted: check the token. */
  previousReply?: { traceId: string; feedbackToken: string };
};

const CHAT_ID = /^[\w-]{1,100}$/;

/**
 * Reads the chat history a client sent and returns it as model messages. The client is
 * not trusted: the history must be small, match the tool schemas, and contain only what
 * this app's own UI produces. A caller can still write a plausible tool result, since
 * nothing here records what the server actually returned.
 */
export async function parseChatRequest(
  req: Request,
  limits = CHAT_LIMITS,
): Promise<ChatRequest> {
  const body = (await readBody(req, limits.maxBodyBytes)) as { id?: unknown; messages?: unknown } | null;
  const raw = body?.messages;
  if (!Array.isArray(raw) || raw.length === 0) throw new ChatRequestError(INVALID, 400);
  if (raw.length > limits.maxMessages) throw new ChatRequestError(TOO_LONG, 413);

  const result = await safeValidateUIMessages<ChatMessage>({ messages: raw, tools });
  if (!result.success) {
    console.warn("Rejected chat history:", result.error.message);
    throw new ChatRequestError(INVALID, 400);
  }
  const messages = result.data.map(dropUnfinishedToolCalls);

  if (messages.at(-1)?.role !== "user") throw new ChatRequestError(INVALID, 400);
  for (const message of messages) {
    if (message.role === "user") checkUserMessage(message, limits.maxUserTextChars);
    else if (message.role === "assistant") checkAssistantMessage(message);
    // System prompts come from the server only.
    else throw new ChatRequestError(INVALID, 400);
  }

  // Pass tools so planTrip's toModelOutput also applies to results from earlier turns.
  const modelMessages = await convertToModelMessages(messages, { tools });
  if (JSON.stringify(modelMessages).length > limits.maxModelChars) {
    throw new ChatRequestError(TOO_LONG, 413);
  }
  const chatId = typeof body?.id === "string" && CHAT_ID.test(body.id) ? body.id : undefined;
  return { chatId, messages: modelMessages, previousReply: previousReply(messages) };
}

/** Message metadata isn't validated against a schema, so check its types here. */
function previousReply(messages: ChatMessage[]): ChatRequest["previousReply"] {
  const reply = messages.at(-2);
  if (reply?.role !== "assistant") return undefined;
  const { traceId, feedbackToken } = reply.metadata ?? {};
  if (typeof traceId !== "string" || typeof feedbackToken !== "string") return undefined;
  return { traceId, feedbackToken };
}

/** readJson, with the errors this route shows the user. */
async function readBody(req: Request, maxBytes: number): Promise<unknown> {
  try {
    return await readJson(req, maxBytes);
  } catch (error) {
    if (!(error instanceof JsonBodyError)) throw error;
    throw error.status === 413 ? new ChatRequestError(TOO_LONG, 413) : new ChatRequestError(INVALID, 400);
  }
}

// Only tool parts: text and reasoning parts carry a state too ("done"), and must be kept.
const isFinished = (part: ChatMessage["parts"][number]) =>
  !TOOL_PART_TYPES.has(part.type) ||
  ("state" in part && (part.state === "output-available" || part.state === "output-error"));

/** A reply that failed mid-call leaves calls without results; they would only confuse the model. */
function dropUnfinishedToolCalls(message: ChatMessage): ChatMessage {
  return message.role === "assistant" ? { ...message, parts: message.parts.filter(isFinished) } : message;
}

/** The UI only sends text. */
function checkUserMessage(message: ChatMessage, maxChars: number) {
  let chars = 0;
  for (const part of message.parts) {
    if (part.type !== "text") throw new ChatRequestError(INVALID, 400);
    chars += part.text.length;
  }
  if (chars > maxChars) {
    throw new ChatRequestError(`Please keep messages under ${maxChars.toLocaleString("en-AU")} characters.`, 400);
  }
}

/**
 * Only text, reasoning and calls to this app's tools. Validation turns finished calls to
 * unknown tools, or with inputs that fail the schema, into dynamic-tool parts, which this
 * rejects.
 */
function checkAssistantMessage(message: ChatMessage) {
  for (const part of message.parts) {
    if (!ASSISTANT_PART_TYPES.has(part.type) && !TOOL_PART_TYPES.has(part.type)) {
      throw new ChatRequestError(INVALID, 400);
    }
  }
}
