import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { registerTelemetry } from "ai";

// instrumentation.ts and route handlers are bundled separately, so share the processor through
// globalThis, as the AI SDK and OpenTelemetry already do for their own registrations.
const globalForTracing = globalThis as { langfuseSpanProcessor?: LangfuseSpanProcessor };

/**
 * Sends AI SDK telemetry to Langfuse. Does nothing unless LANGFUSE_PUBLIC_KEY and
 * LANGFUSE_SECRET_KEY are set; LANGFUSE_BASE_URL picks the region or a self-hosted server.
 * Call once at server startup, from instrumentation.ts.
 */
export function registerTracing() {
  if (globalForTracing.langfuseSpanProcessor) return;
  if (!langfuseConfigured()) return;

  const processor = new LangfuseSpanProcessor({ environment: langfuseEnvironment() });
  new NodeTracerProvider({
    // Without a name, OpenTelemetry falls back to the node binary's path, which ends up in every observation's metadata.
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "hop-hop-go" }),
    spanProcessors: [processor],
  }).register();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  globalForTracing.langfuseSpanProcessor = processor;
}

/** Exports buffered spans. Call from after() so a serverless instance doesn't freeze with spans unsent. */
export async function flushTraces() {
  await globalForTracing.langfuseSpanProcessor?.forceFlush();
}

/** Whether LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are both set. */
export function langfuseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

/** Traces and scores share it. Keeps local runs out of production dashboards when LANGFUSE_TRACING_ENVIRONMENT is unset. */
export function langfuseEnvironment(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.LANGFUSE_TRACING_ENVIRONMENT || env.NODE_ENV;
}
