import type { ChatMessage } from "@/lib/tools";

type ToolPart = Extract<
  ChatMessage["parts"][number],
  { type: "tool-resolveLocation" | "tool-planTrip" }
>;

function describe(part: ToolPart): { label: string; done: boolean; failed?: boolean } {
  if (part.state === "output-error") {
    return { label: "Something went wrong with this step", done: true, failed: true };
  }

  if (part.type === "tool-resolveLocation") {
    const query = part.input?.query;
    if (part.state !== "output-available") {
      return { label: query ? `Looking up “${query}”…` : "Looking up a place…", done: false };
    }
    if ("error" in part.output && part.output.error) {
      return { label: part.output.error, done: true, failed: true };
    }
    const best = part.output.candidates[0];
    return best
      ? { label: `Found ${best.name}`, done: true }
      : { label: `No match for “${part.output.query}”`, done: true, failed: true };
  }

  if (part.state !== "output-available") {
    return { label: "Finding trains…", done: false };
  }
  if ("error" in part.output && part.output.error) {
    return { label: part.output.error, done: true, failed: true };
  }
  const count = part.output.journeys.length;
  return count > 0
    ? { label: `Found ${count} ${count === 1 ? "journey" : "journeys"}`, done: true }
    : { label: "No rail journey found", done: true, failed: true };
}

export function isToolPart(part: ChatMessage["parts"][number]): part is ToolPart {
  return part.type === "tool-resolveLocation" || part.type === "tool-planTrip";
}

export function ToolStatus({ part }: { part: ToolPart }) {
  const { label, done, failed } = describe(part);

  return (
    <div className="flex items-center gap-2 text-sm opacity-70">
      {done ? (
        <span aria-hidden className={failed ? "text-amber-500" : "text-green-600"}>
          {failed ? "!" : "✓"}
        </span>
      ) : (
        <span
          aria-hidden
          className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      <span>{label}</span>
    </div>
  );
}

export function Thinking() {
  return (
    <div className="flex items-center gap-2 text-sm opacity-70">
      <span
        aria-hidden
        className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span>Thinking…</span>
    </div>
  );
}
