"use client";

import type { FinishReason } from "ai";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FEEDBACK_LIMITS, type ReplyRatingReason } from "@/lib/feedback-limits";

type Rating = { rating: "up" | "down" | null; reason?: ReplyRatingReason; comment?: string };

const REASONS: { value: ReplyRatingReason; label: string }[] = [
  { value: "wrong_place", label: "Wrong place" },
  { value: "bad_route", label: "Bad route" },
  { value: "wrong_time", label: "Wrong time" },
  { value: "other", label: "Other" },
];

/** Rapid taps collapse into one request. */
const DEBOUNCE_MS = 800;

const chip =
  "inline-flex h-11 items-center rounded-full border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";

/** Thumbs up or down on a finished reply. A thumbs-down can add a reason and a short comment. */
export function ReplyRating({
  traceId,
  token,
  hadTrips,
  finishReason,
}: {
  traceId: string;
  token: string;
  hadTrips: boolean;
  finishReason?: FinishReason;
}) {
  const [current, setCurrent] = useState<Rating>({ rating: null });
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  // What Langfuse has, to roll back to when a request fails.
  const saved = useRef<Rating>({ rating: null });
  // Requests go one at a time, so a clear can't overtake the rating before it.
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function change(next: Rating, delay = DEBOUNCE_MS) {
    setCurrent(next);
    setNotice("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send(next), delay);
  }

  function send(next: Rating) {
    queue.current = queue.current.then(async () => {
      if (JSON.stringify(next) === JSON.stringify(saved.current)) return;
      let status = 0;
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ traceId, token, ...next, hadTrips, finishReason }),
        });
        status = res.status;
      } catch {
        // Offline: status stays 0.
      }
      if (status === 204) {
        saved.current = next;
        setNotice(next.rating === null ? "Rating cleared." : "Thanks for the feedback.");
        return;
      }
      setCurrent(saved.current);
      setNotice(
        status === 429
          ? "Too many ratings. Please try again shortly."
          : status === 410
            ? "This reply can no longer be rated."
            : "Couldn't save your rating. Please try again.",
      );
    });
  }

  const rate = (rating: "up" | "down") =>
    change(current.rating === rating ? { rating: null } : { rating });

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Rate this reply" className="flex items-center gap-1">
        <ThumbButton label="Helpful" pressed={current.rating === "up"} onClick={() => rate("up")} />
        <ThumbButton label="Not helpful" pressed={current.rating === "down"} onClick={() => rate("down")} down />
        <p aria-live="polite" className="pl-2 text-sm opacity-60">
          {notice}
        </p>
      </div>

      {current.rating === "down" && (
        <div className="space-y-2">
          <div role="group" aria-label="What went wrong?" className="flex flex-wrap gap-2">
            {REASONS.map(({ value, label }) => {
              const selected = current.reason === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => change({ ...current, reason: selected ? undefined : value })}
                  className={`${chip} ${
                    selected
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-black/15 dark:border-white/20"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              change({ ...current, comment: draft.trim() || undefined }, 0);
            }}
          >
            <label htmlFor={`comment-${traceId}`} className="sr-only">
              What went wrong? (optional)
            </label>
            <input
              id={`comment-${traceId}`}
              className="h-11 min-w-0 flex-1 rounded-full border border-black/15 bg-transparent px-4 text-base outline-none focus:border-blue-600 dark:border-white/20"
              value={draft}
              maxLength={FEEDBACK_LIMITS.maxCommentChars}
              placeholder="What went wrong? (optional)"
              onChange={(e) => setDraft(e.currentTarget.value)}
            />
            <button
              type="submit"
              disabled={!draft.trim() || draft.trim() === current.comment}
              className="h-11 rounded-full border border-black/15 px-4 font-medium disabled:opacity-40 dark:border-white/20"
            >
              Send
            </button>
          </form>
          <p className="text-xs opacity-60">
            Please don&rsquo;t include personal details.{" "}
            {/* A new tab, since the chat isn't saved and would be lost on navigating away. */}
            <Link href="/privacy" target="_blank" rel="noopener" className="underline">
              Privacy note
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

function ThumbButton({
  label,
  pressed,
  onClick,
  down = false,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  down?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
        pressed ? "bg-black/5 dark:bg-white/10" : "opacity-60 hover:opacity-100"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill={pressed ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={down ? "rotate-180" : undefined}
      >
        <path d="M7 10v12" />
        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
      </svg>
    </button>
  );
}
