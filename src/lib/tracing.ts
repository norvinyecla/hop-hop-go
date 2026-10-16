import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
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
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return;

  const processor = new LangfuseSpanProcessor({
    // Keeps local runs out of production dashboards when LANGFUSE_TRACING_ENVIRONMENT is unset.
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.NODE_ENV,
  });
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  globalForTracing.langfuseSpanProcessor = processor;
}

/** Exports buffered spans. Call from after() so a serverless instance doesn't freeze with spans unsent. */
export async function flushTraces() {
  await globalForTracing.langfuseSpanProcessor?.forceFlush();
}
