import { convertToModelMessages, safeValidateUIMessages, type ModelMessage } from "ai";
import { CHAT_LIMITS } from "@/lib/chat-limits";
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
  const body = (await readJson(req, limits.maxBodyBytes)) as { id?: unknown; messages?: unknown } | null;
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
  return { chatId, messages: modelMessages };
}

/** Parses the body as JSON, reading no more than maxBytes. */
async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (declared > maxBytes) throw new ChatRequestError(TOO_LONG, 413);
  if (!req.body) throw new ChatRequestError(INVALID, 400);

  // Content-Length may be missing or wrong, so count while reading.
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ChatRequestError(TOO_LONG, 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text);
  } catch {
    throw new ChatRequestError(INVALID, 400);
  }
}

const isFinished = (part: ChatMessage["parts"][number]) =>
  !("state" in part) || part.state === "output-available" || part.state === "output-error";

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
