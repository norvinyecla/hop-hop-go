import { describe, expect, it } from "vitest";
import { parseChatRequest } from "./chat-request";
import { turnContext } from "./turn-context";

const user = (text: string, id: string) => ({ id, role: "user", parts: [{ type: "text", text }] });
const assistant = (id: string, ...parts: unknown[]) => ({ id, role: "assistant", parts });
const text = (value: string) => ({ type: "text", text: value });

const resolve = (id: string, query: string, candidates: { id: string; name: string }[]) => ({
  type: "tool-resolveLocation",
  toolCallId: id,
  state: "output-available",
  input: { query },
  output: { query, candidates: candidates.map((c, i) => ({ ...c, type: "stop", isBest: i === 0 })) },
});

const leg = {
  mode: "train",
  line: "T1",
  from: "Central Station",
  to: "Parramatta Station",
  departs: "08:10",
  arrives: "08:40",
  durationMin: 30,
  path: [
    [151.2, -33.88],
    [151.0, -33.81],
  ],
};

const plan = (id: string, output: Record<string, unknown>) => ({
  type: "tool-planTrip",
  toolCallId: id,
  state: "output-available",
  input: { originId: "200060", destinationId: "215020", preference: "balanced" },
  output,
});

async function contextOf(messages: unknown[], traceId?: string) {
  const { messages: model } = await parseChatRequest(
    new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ messages }) }),
  );
  return turnContext(model, traceId);
}

describe("turnContext", () => {
  it("has no previous turn for the first message", async () => {
    expect(await contextOf([user("Central to Parramatta", "u1")])).toEqual({ turn: 1, tags: [] });
  });

  it("records the reply the user is reacting to", async () => {
    const context = await contextOf(
      [user("hi", "u1"), assistant("a1", text("Where are you going?")), user("Parramatta", "u2")],
      "trace-1",
    );
    expect(context).toEqual({
      turn: 2,
      previousTurn: {
        traceId: "trace-1",
        userMessage: "hi",
        reply: "Where are you going?",
        tools: [],
        earlierUserMessages: [],
      },
      tags: ["followup"],
    });
  });

  it("summarises planTrip with place names, without map paths", async () => {
    const context = await contextOf([
      user("Central to Parramatta, no buses, arrive by 9", "u1"),
      assistant(
        "a1",
        { type: "step-start" },
        resolve("c1", "Central", [{ id: "200060", name: "Central Station, Sydney" }]),
        resolve("c2", "Parramatta", [
          { id: "215020", name: "Parramatta Park" },
          { id: "2150", name: "Parramatta Station" },
        ]),
        { type: "step-start" },
        plan("c3", {
          when: { type: "depart", date: "2026-10-23", time: "09:00" },
          avoid: ["bus"],
          journeys: [{ departs: "09:02", arrives: "09:32", durationMin: 30, changes: 0, legs: [leg] }],
        }),
        { type: "step-start" },
        text("Take the T1 at 09:02."),
      ),
      user("I said arrive by 9, not leave at 9", "u2"),
    ]);
    expect(context.tags).toEqual(["followup", "prev-tool:resolveLocation", "prev-tool:planTrip"]);
    expect(context.previousTurn?.tools).toEqual([
      { tool: "resolveLocation", query: "Central", candidates: ["Central Station, Sydney"] },
      { tool: "resolveLocation", query: "Parramatta", candidates: ["Parramatta Park", "Parramatta Station"] },
      {
        tool: "planTrip",
        from: "Central Station, Sydney",
        to: "Parramatta Park",
        when: { type: "depart", date: "2026-10-23", time: "09:00" },
        avoid: ["bus"],
        preference: "balanced",
        journeys: [
          { departs: "09:02", arrives: "09:32", changes: 0, legs: ["train T1: Central Station → Parramatta Station"] },
        ],
      },
    ]);
    expect(JSON.stringify(context)).not.toContain("151.2");
  });

  it("names places resolved in an earlier turn", async () => {
    const context = await contextOf([
      user("Central to Parramatta", "u1"),
      assistant(
        "a1",
        resolve("c1", "Central", [{ id: "200060", name: "Central Station, Sydney" }]),
        resolve("c2", "Parramatta", [{ id: "215020", name: "Parramatta Station" }]),
        text("Which Parramatta?"),
      ),
      user("The station", "u2"),
      assistant("a2", plan("c3", { journeys: [], error: "Trip planning is unavailable right now." })),
      user("try again", "u3"),
    ]);
    expect(context.turn).toBe(3);
    expect(context.previousTurn).toMatchObject({
      userMessage: "The station",
      reply: "",
      earlierUserMessages: ["Central to Parramatta"],
      tools: [
        {
          tool: "planTrip",
          from: "Central Station, Sydney",
          to: "Parramatta Station",
          journeys: [],
          error: "Trip planning is unavailable right now.",
        },
      ],
    });
    expect(context.tags).toEqual(["followup", "prev-tool:planTrip"]);
  });

  it("doesn't tag a follow-up to a reply that failed before saying anything", async () => {
    const context = await contextOf([user("hi", "u1"), assistant("a1", { type: "step-start" }), user("hello?", "u2")]);
    expect(context.previousTurn).toMatchObject({ userMessage: "hi", reply: "", tools: [] });
    expect(context.tags).toEqual([]);
  });

  it("doesn't tag a follow-up when the previous message got no reply at all", async () => {
    const context = await contextOf([user("hi", "u1"), user("hello?", "u2")]);
    expect(context.previousTurn).toMatchObject({ userMessage: "hi", reply: "" });
    expect(context.tags).toEqual([]);
  });

  it("keeps only the most recent earlier user messages", async () => {
    const messages = Array.from({ length: 13 }, (_, i) => [
      user(`message ${i}`, `u${i}`),
      assistant(`a${i}`, text("ok")),
    ]).flat();
    const context = await contextOf([...messages, user("last", "u99")]);
    expect(context.previousTurn?.userMessage).toBe("message 12");
    expect(context.previousTurn?.earlierUserMessages).toEqual(
      Array.from({ length: 10 }, (_, i) => `message ${i + 2}`),
    );
  });
});
