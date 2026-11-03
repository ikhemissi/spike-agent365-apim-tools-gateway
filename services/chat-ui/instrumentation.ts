// Next.js calls register() once when the server starts, before it serves requests: OpenTelemetry starts here when an
// Application Insights connection string is set (in Azure); otherwise nothing is exported.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    // The role name in Application Insights; without it, "unknown_service:node".
    process.env.OTEL_SERVICE_NAME ??= "chat-ui";
    // The gateway call has its own span (lib/server/telemetry.ts); Next.js's span for every fetch would repeat it.
    process.env.NEXT_OTEL_FETCH_DISABLED = "1";
    const { startAzureMonitor } = await import("./lib/server/azure-monitor");
    startAzureMonitor(process.env);
  }
}
