// Runs the hand-written cases in cases.ts through the chat model and checks its tool calls.
// TfNSW answers from fixtures, so results only change when the model or prompt does.
//
//   npm run eval                          every case, against recorded fixtures
//   EVAL_CASES=no-buses,fastest npm run eval
//   EVAL_RECORD=1 npm run eval            call TfNSW live and save new fixtures
//
// With Langfuse keys set, the cases are synced to the "chat-evals" dataset and each run is an
// experiment on it, with a score per check. Without them, results only print here.
import type { DatasetItem } from "@langfuse/core";
import { generateText, isStepCount } from "ai";
import { expect, it, vi } from "vitest";
import { RESPONSE_LIMITS } from "@/lib/chat-limits";
import { instructions } from "@/lib/instructions";
import { getModel } from "@/lib/llm";
import { langfuse } from "@/lib/scores";
import type * as TfnswClient from "@/lib/tfnsw/client";
import { flushTraces, langfuseConfigured, registerTracing } from "@/lib/tracing";
import { CASES, type EvalCase } from "./cases";
import { runChecks, type CaseOutput, type CheckResult, type ToolCallRecord } from "./checks";
import { loadFixtures, record, replay, saveFixtures, simulate } from "./fixtures";

const DATASET = "chat-evals";
const RECORD = process.env.EVAL_RECORD === "1";

// The tools reach TfNSW only through tfnswGet, so each case points it at its fixtures, or at TfNSW while recording.
const tfnsw = vi.hoisted(() => ({ get: undefined as typeof TfnswClient.tfnswGet | undefined }));
vi.mock("@/lib/tfnsw/client", () => ({
  tfnswGet: (...args: Parameters<typeof TfnswClient.tfnswGet>) => tfnsw.get!(...args),
}));

const wanted = process.env.EVAL_CASES?.split(",").map((id) => id.trim()).filter(Boolean);
const selected = wanted ? CASES.filter((c) => wanted.includes(c.id)) : CASES;

type CaseResult = { id: string; output?: CaseOutput; checks: CheckResult[]; error?: string; traceId?: string };

it("chat evals", async () => {
  const unknown = wanted?.filter((id) => !CASES.some((c) => c.id === id)) ?? [];
  expect(unknown, "unknown EVAL_CASES").toEqual([]);

  registerTracing();
  const results = langfuseConfigured() && !RECORD ? await runExperiment() : await runEachCase();
  await flushTraces();

  printSummary(results);
  const failed = results.filter((r) => r.error || r.checks.some((c) => !c.passed)).map((r) => r.id);
  expect(failed, "cases with failing checks").toEqual([]);
});

/** Runs one case: the same model, prompt, tools and limits as /api/chat, without streaming. */
async function runCase(evalCase: EvalCase): Promise<CaseOutput> {
  // Fresh tool modules, so the alerts cache can't carry one case's alerts into the next.
  vi.resetModules();
  const { tools } = await import("@/lib/tools");

  let fixtureMisses: string[] | undefined;
  let save: (() => Promise<void>) | undefined;
  if (RECORD) {
    const { tfnswGet: live } = await vi.importActual<typeof TfnswClient>("@/lib/tfnsw/client");
    const recording = record(live);
    tfnsw.get = recording.tfnswGet;
    save = () => saveFixtures(evalCase.id, recording.fixtures);
  } else {
    const fixtures = await loadFixtures(evalCase.id);
    if (!fixtures) throw new Error(`No fixtures for ${evalCase.id}. Record them: EVAL_RECORD=1 EVAL_CASES=${evalCase.id} npm run eval`);
    const replaying = replay(fixtures);
    tfnsw.get = replaying.tfnswGet;
    fixtureMisses = replaying.misses;
    // Runs as if it were the time the fixtures were recorded, so "tomorrow" and "leave now" match them.
    // Only Date is faked: timeouts and retries still run on real timers. Spans take their start time from
    // Date, so the case's trace shows the recording time, but durations are still right.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(fixtures.recordedAt) });
  }
  tfnsw.get = simulate(evalCase.tfnsw, tfnsw.get!);

  try {
    const now = new Date();
    const result = await generateText({
      model: getModel(),
      instructions: instructions(now),
      messages: evalCase.messages,
      tools,
      stopWhen: isStepCount(RESPONSE_LIMITS.maxSteps),
      maxOutputTokens: RESPONSE_LIMITS.maxOutputTokens,
      // Without it, a stalled model call hangs the whole run instead of failing its case.
      timeout: { totalMs: RESPONSE_LIMITS.maxResponseMs },
      telemetry: { functionId: "chat-eval" },
    });
    await save?.();
    const calls = result.content.flatMap((part): ToolCallRecord[] => {
      if (part.type === "tool-result") return [{ tool: part.toolName, input: part.input, output: part.output }];
      if (part.type === "tool-error") return [{ tool: part.toolName, input: part.input, error: String(part.error) }];
      return [];
    });
    return {
      now: now.toISOString(),
      reply: result.text,
      finishReason: result.finishReason,
      steps: result.steps.length,
      calls,
      fixtureMisses,
    };
  } finally {
    vi.useRealTimers();
    tfnsw.get = undefined;
  }
}

/** One at a time: cases share the faked clock and the tfnswGet mock. */
async function runEachCase(): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const evalCase of selected) {
    try {
      const output = await runCase(evalCase);
      results.push({ id: evalCase.id, output, checks: runChecks(evalCase.expect, output) });
    } catch (error) {
      results.push({ id: evalCase.id, checks: [], error: String(error) });
    }
  }
  return results;
}

const itemId = (caseId: string) => `${DATASET}-${caseId}`;

/** Makes the Langfuse dataset match cases.ts: upserts every case and archives items whose case is gone. */
async function syncDataset(): Promise<void> {
  const api = langfuse().api;
  try {
    await api.datasets.get(DATASET);
  } catch {
    await api.datasets.create({
      name: DATASET,
      description: "Hand-written chat cases from evals/cases.ts. Edit them there; npm run eval syncs this dataset.",
    });
  }
  for (const evalCase of CASES) {
    await api.datasetItems.create({
      datasetName: DATASET,
      id: itemId(evalCase.id),
      input: { messages: evalCase.messages },
      expectedOutput: evalCase.expect,
      metadata: { caseId: evalCase.id, description: evalCase.description, tfnsw: evalCase.tfnsw },
      status: "ACTIVE",
    });
  }
  const current = new Set(CASES.map((c) => itemId(c.id)));
  const { items } = await langfuse().dataset.get(DATASET);
  for (const item of items) {
    if (current.has(item.id) || item.status === "ARCHIVED") continue;
    await api.datasetItems.create({ datasetName: DATASET, id: item.id, input: item.input, status: "ARCHIVED" });
  }
}

const caseFor = (item: { metadata?: unknown }) => CASES.find((c) => c.id === (item.metadata as { caseId?: string })?.caseId);

async function runExperiment(): Promise<CaseResult[]> {
  await syncDataset();
  const ids = new Set(selected.map((c) => itemId(c.id)));
  const items: DatasetItem[] = (await langfuse().dataset.get(DATASET)).items.filter((item) => ids.has(item.id));
  const checks = new Map<string, CheckResult[]>();

  const result = await langfuse().experiment.run({
    name: DATASET,
    description: "Deterministic checks on tool calls and reply format, against recorded TfNSW fixtures.",
    metadata: { provider: process.env.LLM_PROVIDER ?? "google", model: process.env.LLM_MODEL },
    data: items,
    maxConcurrency: 1,
    task: async (item) => runCase(caseFor(item)!),
    evaluators: [
      async ({ output, metadata }) => {
        const evalCase = caseFor({ metadata })!;
        const results = runChecks(evalCase.expect, output as CaseOutput);
        checks.set(evalCase.id, results);
        return [
          ...results.map((c) => ({
            name: `check_${c.name}`,
            value: c.passed ? 1 : 0,
            dataType: "BOOLEAN" as const,
            comment: c.detail,
          })),
          {
            name: "checks_passed",
            value: results.filter((c) => c.passed).length / results.length,
            dataType: "NUMERIC" as const,
          },
        ];
      },
    ],
    runEvaluators: [
      async ({ itemResults }) => {
        const passed = itemResults.filter((r) => checks.get(caseFor(r.item)!.id)?.every((c) => c.passed)).length;
        return { name: "pass_rate", value: passed / Math.max(itemResults.length, 1), dataType: "NUMERIC" as const };
      },
    ],
  });
  await langfuse().flush();
  if (result.experimentUrl) console.log(`Langfuse experiment: ${result.experimentUrl}`);

  return result.itemResults.map((r) => {
    const id = caseFor(r.item)!.id;
    const ran = checks.get(id);
    return ran
      ? { id, output: r.output as CaseOutput, checks: ran, traceId: r.traceId }
      : { id, checks: [], error: "The case threw before it could be checked; see its trace.", traceId: r.traceId };
  });
}

function printSummary(results: CaseResult[]): void {
  const lines = results.map((r) => {
    if (r.error) return `✗ ${r.id}: ${r.error}`;
    const failed = r.checks.filter((c) => !c.passed);
    if (failed.length === 0) return `✓ ${r.id}`;
    return [`✗ ${r.id}`, ...failed.map((c) => `    ${c.name}: ${c.detail}`), `    reply: ${r.output?.reply}`].join("\n");
  });
  const passed = results.filter((r) => !r.error && r.checks.every((c) => c.passed)).length;
  console.log([...lines, "", `${passed}/${results.length} cases passed${RECORD ? " (recorded new fixtures)" : ""}`].join("\n"));
}
