// The CopilotKit runtime endpoint: checks origin, sign-in (and the gateway token when GATEWAY_SCOPE is set, and the
// Foundry token in Foundry mode) and request size, then runs the chat agent.
// Every response carries a request id, which error messages repeat so a failure can be found in the logs.
import { randomUUID } from "node:crypto";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { CopilotRuntime, createCopilotRuntimeHandler, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { agentId, GatewayAgent } from "./agent";
import { authenticate, verifyFoundryToken, verifyGatewayToken } from "./auth";
import { gatewayScope, getConfig } from "./config";
import { ChatError, reportError } from "./errors";
import type { McpConnect } from "./mcp-tools";

process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";

const maxBodySize = 131_072;
// The browser sends the user's token for the gateway (LiteLLM or API Management) here; Authorization carries the
// sign-in token.
export const gatewayTokenHeader = "x-gateway-token";
// Foundry mode: the browser sends the user's token for Foundry here.
export const foundryTokenHeader = "x-foundry-token";

async function readBoundedBody(request: Request) {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // Content-Length can lie, so the body is counted while it is read.
      if (size > maxBodySize) {
        await reader.cancel();
        throw new ChatError("request", "request_too_large", "The chat accepts requests up to 128 KiB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

// The browser may only send a conversation: no tools, context or runtime overrides of its own.
function checkRunRequest(body: Buffer) {
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString("utf8")); }
  catch { throw new ChatError("request", "invalid_json", "Send a valid AG-UI JSON request.", 400); }
  const input = RunAgentInputSchema.safeParse(parsed);
  if (!input.success) throw new ChatError("request", "invalid_run", "The AG-UI run request is invalid.", 400);
  if (input.data.tools.length || input.data.context.length || Object.keys(input.data.forwardedProps ?? {}).length) {
    throw new ChatError("request", "unsupported_context", "Browser-defined tools, context, and runtime overrides are not supported.", 400);
  }
}

// Rebuilds the request with only the headers the runtime needs, so the browser's tokens go no further.
async function boundedRequest(request: Request, signal: AbortSignal): Promise<Request> {
  const headers = new Headers();
  for (const name of ["content-type", "accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const body = await readBoundedBody(request);
  if (body && new URL(request.url).pathname.endsWith(`/agent/${agentId}/run`)) checkRunRequest(body);
  return new Request(request.url, { method: request.method, headers, signal, body });
}

// Passes the runtime's stream through; if it fails or the browser cancels, the gateway request is aborted.
function guardedStream(response: Response, cancellation: AbortController, requestId: string): ReadableStream<Uint8Array> {
  const reader = response.body!.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (cancellation.signal.aborted) return;
        if (result.done) { controller.close(); reader.releaseLock(); }
        else controller.enqueue(result.value);
      } catch (error) {
        cancellation.abort();
        const { body } = reportError(error, requestId);
        controller.error(new Error(`${body.error.message} Request: ${requestId}`));
        reader.releaseLock();
      }
    },
    async cancel() {
      cancellation.abort();
      try {
        while (!(await reader.read()).done) { /* Drain terminal events after aborting the gateway request. */ }
      } catch (error) {
        reportError(error, requestId);
        throw new Error(`Could not close the runtime stream. Request: ${requestId}`);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export async function handleRequest(
  request: Request,
  dependencies: {
    config?: typeof getConfig;
    authenticate?: typeof authenticate;
    verifyGatewayToken?: typeof verifyGatewayToken;
    verifyFoundryToken?: typeof verifyFoundryToken;
    fetchImpl?: typeof fetch;
    connectMcp?: McpConnect;
  } = {},
): Promise<Response> {
  const requestId = randomUUID();
  try {
    const config = (dependencies.config ?? getConfig)();
    const origin = request.headers.get("origin");
    if (origin && origin !== config.UI_ORIGIN) {
      throw new ChatError("request", "invalid_origin", "This origin is not permitted.", 403);
    }
    const user = await (dependencies.authenticate ?? authenticate)(request.headers.get("authorization"), config);
    const gateway = gatewayScope(config);
    const gatewayToken = gateway
      ? await (dependencies.verifyGatewayToken ?? verifyGatewayToken)(request.headers.get(gatewayTokenHeader), gateway, user, config)
      : undefined;
    const foundryToken = config.CHAT_GATEWAY === "foundry"
      ? await (dependencies.verifyFoundryToken ?? verifyFoundryToken)(request.headers.get(foundryTokenHeader), user, config)
      : undefined;
    const cancellation = new AbortController();
    const signal = AbortSignal.any([request.signal, cancellation.signal]);
    // The outer stream owns cancellation so the runtime can finalize its SSE writer.
    const bounded = await boundedRequest(request, new AbortController().signal);
    // Agents are request-owned; the runtime's thread coordination is process-local.
    const runtime = new CopilotRuntime({
      agents: { [agentId]: new GatewayAgent({
        config, signal, requestId, userId: user.oid, gatewayToken, foundryToken,
        fetchImpl: dependencies.fetchImpl, connectMcp: dependencies.connectMcp,
      }) },
      runner: new InMemoryAgentRunner(),
    });
    const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", activateChannels: false });
    const response = await handler(bounded);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("x-request-id", requestId);
    if (!response.body) return response;
    return new Response(guardedStream(response, cancellation, requestId), { status: response.status, headers: response.headers });
  } catch (error) {
    const { status, body } = reportError(error, requestId);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", "x-request-id": requestId } });
  }
}
