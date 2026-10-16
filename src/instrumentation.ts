export async function register() {
  // The OpenTelemetry Node SDK doesn't run on the edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerTracing } = await import("@/lib/tracing");
    registerTracing();
  }
}
