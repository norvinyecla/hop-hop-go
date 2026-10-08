"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import { isToolPart, Thinking, ToolStatus } from "@/components/tool-status";
import type { ChatMessage } from "@/lib/tools";

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat<ChatMessage>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";
  // Show "Thinking…" while a reply is in progress but nothing else on screen is moving:
  // before the first part arrives, and between steps when no tool is running and no text is streaming.
  const last = messages.at(-1);
  const toolRunning = last?.parts.some(
    (part) => isToolPart(part) && part.state !== "output-available" && part.state !== "output-error",
  );
  const writing = last?.parts.at(-1)?.type === "text";
  const thinking = busy && (last?.role === "user" || (!toolRunning && !writing));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <header className="border-b border-black/10 px-4 py-3 dark:border-white/10">
        <h1 className="text-lg font-semibold">hop-hop-go</h1>
        <p className="text-sm opacity-60">Sydney public transport, by chat</p>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="pt-8 text-center text-sm opacity-60">
            Where are you going? Try &ldquo;Central to Parramatta, leaving now&rdquo;.
          </p>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-2 text-white"
            >
              {message.parts.map((part, i) =>
                part.type === "text" ? <span key={i}>{part.text}</span> : null,
              )}
            </div>
          ) : (
            <AssistantMessage key={message.id} message={message} />
          ),
        )}
        {thinking && <Thinking />}
        {error && (
          <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
        )}
        <div ref={bottomRef} />
      </main>

      <form
        className="flex gap-2 border-t border-black/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/10"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input
          className="flex-1 rounded-full border border-black/15 bg-transparent px-4 py-2 text-base outline-none focus:border-blue-600 dark:border-white/20"
          value={input}
          placeholder="From A to B…"
          onChange={(e) => setInput(e.currentTarget.value)}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-40"
        >
          Go
        </button>
      </form>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const toolParts = message.parts.filter(isToolPart);
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

  return (
    <div className="space-y-2">
      {toolParts.length > 0 && (
        <div className="space-y-1">
          {toolParts.map((part) => (
            <ToolStatus key={part.toolCallId} part={part} />
          ))}
        </div>
      )}
      {text && (
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-black/5 px-4 py-2 dark:bg-white/10">
          {text}
        </div>
      )}
    </div>
  );
}
