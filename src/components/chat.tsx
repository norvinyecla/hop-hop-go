"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

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
            Where are you going? Try &ldquo;Central to Manly, leaving now&rdquo;.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 ${
              message.role === "user"
                ? "ml-auto bg-blue-600 text-white"
                : "bg-black/5 dark:bg-white/10"
            }`}
          >
            {message.parts.map((part, i) =>
              part.type === "text" ? <span key={i}>{part.text}</span> : null,
            )}
          </div>
        ))}
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
