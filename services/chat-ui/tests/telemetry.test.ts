// The chat's OpenTelemetry spans: what a run did and who ran it, joined to the gateway's trace through traceparent,
// and never what was said or a credential. An in-memory exporter stands in for Application Insights.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { RunAgentInput } from "@ag-ui/client";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { lastValueFrom, toArray } from "rxjs";
import { GatewayAgent } from "../lib/server/agent";
import {
  answer, apimConfig, blockedByGateway, fakeGateway, fakeMcp, functionCalls, notesTools, userGatewayToken,
} from "./apim-helpers";
import { config, environment, gatewayConfig, id, observed, refusals, streamResponse, type GatewayEvent } from "./helpers";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();
beforeEach(() => exporter.reset());
after(() => provider.shutdown());

const input: RunAgentInput = {
  threadId: "thread", runId: "run", state: {}, tools: [], context: [], forwardedProps: {},
  messages: [{ id: "user-message", role: "user", content: "Add a note: buy milk" }],
};

async function runWith(response: () => Response, agentConfig = config, gatewayToken?: string) {
  let headers = new Headers();
  const agent = new GatewayAgent({
    config: agentConfig, signal: new AbortController().signal, requestId: "request-1", userId: id(5), gatewayToken,
    fetchImpl: async (_, init) => { headers = new Headers(init?.headers); return response(); },
  });
  await lastValueFrom(agent.run(input).pipe(toArray()));
  const spans = exporter.getFinishedSpans();
  const run = spans.find((span) => span.name === "chat run") as ReadableSpan;
  const gateway = spans.find((span) => span.kind === SpanKind.CLIENT) as ReadableSpan;
  return { spans, run, gateway, headers };
}

const streamed = (events: GatewayEvent[]) => () => streamResponse(events);

test("a run is one span with the user, the request id, the outcome and the tools it called", async () => {
  const { run } = await runWith(streamed(observed.noteAdded));
  assert.equal(run.attributes["enduser.id"], id(5));
  assert.equal(run.attributes["chat.request_id"], "request-1");
  assert.equal(run.attributes["gen_ai.request.model"], "gpt-6-luna");
  assert.equal(run.attributes["chat.outcome"], "completed");
  assert.equal(run.attributes["chat.tool_calls"], 1);
  assert.equal(run.attributes["chat.tool_errors"], 0);
  assert.deepEqual(run.attributes["chat.tool_names"], ["notes-add_note"]);
});

test("a tool that failed is counted, although LiteLLM reports it as completed", async () => {
  const { run } = await runWith(streamed(observed.toolFailed));
  assert.equal(run.attributes["chat.tool_errors"], 1);
  assert.equal(run.status.code, SpanStatusCode.UNSET);
});

test("the gateway call is a client span under the run, and its trace context goes to LiteLLM in traceparent", async () => {
  const { run, gateway, headers } = await runWith(streamed(observed.textReply));
  assert.equal(gateway.name, "POST /v1/responses");
  assert.equal(gateway.parentSpanContext?.spanId, run.spanContext().spanId);
  assert.equal(gateway.attributes["http.response.status_code"], 200);
  assert.equal(gateway.attributes["server.address"], "litellm.example.com");
  const { traceId, spanId } = gateway.spanContext();
  assert.equal(headers.get("traceparent"), `00-${traceId}-${spanId}-01`);
});

test("with the guardrail's user token, traceparent goes alongside it", async () => {
  const token = ["eyJ" + "hbGciOiJSUzI1NiJ9", "eyJ" + "vaWQiOiJ0ZXN0In0", "c2lnbmF0dXJl"].join(".");
  const { headers } = await runWith(streamed(observed.textReply), gatewayConfig, token);
  assert.equal(headers.get("authorization"), `Bearer ${token}`);
  assert.match(headers.get("traceparent") ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

test("a gateway refusal marks the run and the gateway call as failed, with the refusal's code", async () => {
  const refusal = refusals.modelNotAllowed;
  const { run, gateway } = await runWith(() => Response.json(refusal.body, { status: refusal.status }));
  assert.equal(run.status.code, SpanStatusCode.ERROR);
  assert.equal(run.attributes["chat.outcome"], "failed");
  assert.equal(run.attributes["chat.error.stage"], "gateway");
  assert.equal(run.attributes["chat.error.code"], "gateway_refused");
  assert.equal(gateway.status.code, SpanStatusCode.ERROR);
  assert.equal(gateway.attributes["http.response.status_code"], 403);
  assert.equal(gateway.attributes["error.type"], "gateway_refused");
});

test("no span holds what was said, the tool arguments or results, or a credential", async () => {
  const { spans } = await runWith(streamed(observed.noteAdded));
  const recorded = JSON.stringify(spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events })));
  for (const secret of ["buy milk", "Added the note", "ui spike live check", "8206382857658", environment.LITELLM_API_KEY, config.CHAT_INSTRUCTIONS]) {
    assert.ok(!recorded.includes(secret), `a span holds "${secret}"`);
  }
});

// API Management mode: this server calls the MCP tools, so each call is a span of its own.
async function runApim(call: (name: string) => { isError: boolean; text: string }) {
  const addNote = { callId: "call_1", name: "notes-add_note", arguments: '{"text":"buy milk"}' };
  const gateway = fakeGateway([functionCalls("resp_1", [addNote]), answer("resp_2", "msg_1", ["Added the note."])]);
  const mcp = fakeMcp({ notes: { tools: notesTools, call }, files: { connectError: blockedByGateway("files") } });
  const agent = new GatewayAgent({
    config: apimConfig, signal: new AbortController().signal, requestId: "request-1", userId: id(5),
    gatewayToken: userGatewayToken, fetchImpl: gateway.fetchImpl, connectMcp: mcp.connect,
  });
  await lastValueFrom(agent.run(input).pipe(toArray()));
  const spans = exporter.getFinishedSpans();
  return {
    spans, gateway,
    run: spans.find((span) => span.name === "chat run") as ReadableSpan,
    models: spans.filter((span) => span.name === "POST /openai/v1/responses"),
    mcpCalls: spans.filter((span) => span.name.startsWith("MCP tools/call")),
  };
}

test("with API Management, each MCP tool call is a client span under the run, with only the server and the tool", async () => {
  const { run, models, mcpCalls, gateway } = await runApim(() => ({ isError: false, text: "note 8206382857658" }));
  assert.equal(models.length, 2);
  assert.deepEqual(gateway.requests.map((request) => request.headers.get("traceparent")),
    models.map((span) => `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`));
  assert.equal(mcpCalls.length, 1);
  const [call] = mcpCalls;
  assert.equal(call.name, "MCP tools/call add_note");
  assert.equal(call.kind, SpanKind.CLIENT);
  assert.deepEqual(call.attributes, { "chat.mcp.server": "notes", "gen_ai.tool.name": "add_note" });
  assert.equal(call.parentSpanContext?.spanId, run.spanContext().spanId);
  assert.equal(call.status.code, SpanStatusCode.UNSET);
  // The run counts the tool call and the server that was blocked, as the chat shows them.
  assert.equal(run.attributes["chat.tool_calls"], 2);
  assert.equal(run.attributes["chat.tool_errors"], 1);
  assert.deepEqual(run.attributes["chat.tool_names"], ["files (connect)", "notes-add_note"]);
});

test("with API Management, a tool error marks its span as failed, and no span holds arguments, results or the token", async () => {
  const { spans, mcpCalls } = await runApim(() => ({ isError: true, text: "note 8206382857658 is locked" }));
  assert.equal(mcpCalls[0].status.code, SpanStatusCode.ERROR);
  const recorded = JSON.stringify(spans.map((span) => ({ name: span.name, attributes: span.attributes, events: span.events })));
  for (const secret of ["buy milk", "8206382857658", "Added the note", userGatewayToken, apimConfig.CHAT_INSTRUCTIONS]) {
    assert.ok(!recorded.includes(secret), `a span holds "${secret}"`);
  }
});
