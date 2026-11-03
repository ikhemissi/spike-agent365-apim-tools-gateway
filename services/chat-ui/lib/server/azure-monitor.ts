// Exports traces and metrics to Application Insights, which accepts only Entra-authenticated ingestion: in Azure with
// the app's managed identity (AZURE_CLIENT_ID), locally with your Azure CLI sign-in; either needs the "Monitoring
// Metrics Publisher" role on the Application Insights resource. Started once by instrumentation.ts.
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
// Renamed because ESLint's React rules take any use* function for a React hook.
import { useAzureMonitor as startAzureMonitorDistro } from "@azure/monitor-opentelemetry";

export function startAzureMonitor(env: Record<string, string | undefined>) {
  const credential = env.AZURE_CLIENT_ID
    ? new ManagedIdentityCredential({ clientId: env.AZURE_CLIENT_ID })
    : new AzureCliCredential();
  startAzureMonitorDistro({
    azureMonitorExporterOptions: { connectionString: env.APPLICATIONINSIGHTS_CONNECTION_STRING, credential },
  });
}
