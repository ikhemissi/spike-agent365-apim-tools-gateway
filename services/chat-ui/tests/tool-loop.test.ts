// API Management mode: this server runs the tool loop. What is sent to the model through API Management, which MCP
// tools are offered and called (as the signed-in user), and what the chat receives, including failures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { lastValueFrom, toArray } from "rxjs";
import { GatewayAgent, type InvocationContext } from "../lib/server/agent";
import { handleRequest } from "../lib/server/handler";
import { decodeToolResult } from "../lib/tool-result";
import {
  answer, apimConfig, blockedByGateway, fakeGateway, fakeMcp, functionCalls, notesTools, userGatewayToken, type FakeServer,
} from "./apim-helpers";
import { id } from "./helpers";

const input: RunAgentInput = {
  threadId: "thread", runId: "run", state: {}, tools: [], context: [], forwardedProps: {},
  messages: [{ id: "user-message", role: "user", content: "Add a note: buy milk" }],
};
const filesTools = [{ name: "read_file", description: "Reads a file.", inputSchema: { type: "object", properties: {} } }];
const bothServers = (notes: FakeServer = {}): Record<string, FakeServer> => ({
  notes: { tools: notesTools, ...notes }, files: { tools: filesTools },
});

async function runApim(gateway: ReturnType<typeof fakeGateway>, mcp: ReturnType<typeof fakeMcp>, overrides: Partial<InvocationContext> = {}) {
  const agent = new GatewayAgent({
    config: apimConfig, signal: new AbortController().signal, requestId: "request-1", userId: id(5),
    gatewayToken: userGatewayToken, fetchImpl: gateway.fetchImpl, connectMcp: mcp.connect, ...overrides,
  });
  return lastValueFrom(agent.run(input).pipe(toArray()));
}
const types = (events: BaseEvent[]) => events.map((event) => event.type);
const field = (event: BaseEvent | undefined, name: string) => (event as Record<string, unknown> | undefined)?.[name];
const text = (events: BaseEvent[]) => events.filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
  .map((event) => field(event, "delta")).join("");
const toolLines = (events: BaseEvent[]) => events.filter((event) => event.type === EventType.TOOL_CALL_START).map((start) => {
  const toolCallId = field(start, "toolCallId");
  const of = (type: EventType) => events.find((event) => event.type === type && field(event, "toolCallId") === toolCallId);
  return {
    name: field(start, "toolCallName"),
    args: field(of(EventType.TOOL_CALL_ARGS), "delta"),
    result: decodeToolResult(String(field(of(EventType.TOOL_CALL_RESULT), "content"))),
  };
});
const addNote = { callId: "call_1", name: "notes-add_note", arguments: '{"text":"buy milk"}' };

test("a tool round, then the answer: the answer is shown first and the tool line below it", async () => {
  const gateway = fakeGateway([functionCalls("resp_1", [addNote]), answer("resp_2", "msg_1", ["Added ", "the note."])]);
  const mcp = fakeMcp(bothServers({ call: () => ({ isError: false, text: '{"id":"note-1"}' }) }));
  const events = await runApim(gateway, mcp);
  assert.deepEqual(types(events), [
    EventType.RUN_STARTED,
    EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END,
    EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END, EventType.TOOL_CALL_RESULT,
    EventType.RUN_FINISHED,
  ]);
  assert.equal(text(events), "Added the note.");
  assert.deepEqual(toolLines(events), [
    { name: "notes-add_note", args: '{"text":"buy milk"}', result: { outcome: "ok", output: '{"id":"note-1"}' } },
  ]);
  assert.deepEqual(mcp.calls, [{ label: "notes", name: "add_note", args: { text: "buy milk" } }]);
  assert.deepEqual(mcp.closed.sort(), ["files", "notes"]);
});

test("round 1 sends the conversation and the MCP tools as function tools; round 2 only the tool results", async () => {
  const gateway = fakeGateway([functionCalls("resp_1", [addNote]), answer("resp_2", "msg_1", ["Done."])]);
  await runApim(gateway, fakeMcp(bothServers({ call: () => ({ isError: false, text: "note-1" }) })));
  const [first, second] = gateway.requests;
  assert.equal(first.url, "https://apim.example.com/openai/v1/responses");
  assert.equal(first.body.model, "gpt-6-luna");
  assert.equal(first.body.stream, true);
  assert.equal(first.body.instructions, apimConfig.CHAT_INSTRUCTIONS);
  assert.deepEqual(first.body.input, [{ role: "user", content: "Add a note: buy milk" }]);
  assert.equal(first.body.previous_response_id, undefined);
  assert.deepEqual(first.body.tools[0], {
    type: "function", name: "notes-add_note", description: "Adds a note.", parameters: notesTools[0].inputSchema, strict: false,
  });
  assert.deepEqual(first.body.tools.map((tool) => tool.name), ["notes-add_note", "notes-list_notes", "files-read_file"]);
  assert.equal(second.url, first.url);
  assert.equal(second.body.previous_response_id, "resp_1");
  assert.deepEqual(second.body.input, [{ type: "function_call_output", call_id: "call_1", output: "note-1" }]);
  assert.deepEqual(second.body.tools, first.body.tools);
});

test("the user's gateway token is the bearer token for the model and for MCP; the LiteLLM key is never sent", async () => {
  const gateway = fakeGateway([functionCalls("resp_1", [addNote]), answer("resp_2", "msg_1", ["Done."])]);
  const mcp = fakeMcp(bothServers());
  await runApim(gateway, mcp);
  for (const request of gateway.requests) {
    assert.equal(request.headers.get("authorization"), `Bearer ${userGatewayToken}`);
    assert.equal(request.headers.get("x-litellm-api-key"), null);
    assert.equal(request.headers.get("api-key"), null);
  }
  assert.deepEqual(mcp.connections.map((connection) => connection.token), [userGatewayToken, userGatewayToken]);
  assert.equal("LITELLM_API_KEY" in apimConfig, false);
  assert.doesNotMatch(JSON.stringify(gateway.requests.map((request) => [...request.headers, request.body])), /sk-test-team-key/);
});

test("a server Agent 365 blocked is skipped and shown as a failed '(connect)' line; the other server's tools are offered", async () => {
  const gateway = fakeGateway([answer("resp_1", "msg_1", ["The files tools are blocked for you."])]);
  const mcp = fakeMcp({ notes: { tools: notesTools }, files: { connectError: blockedByGateway("files") } });
  const events = await runApim(gateway, mcp);
  assert.deepEqual(gateway.requests[0].body.tools.map((tool) => tool.name), ["notes-add_note", "notes-list_notes"]);
  assert.deepEqual(toolLines(events), [{
    name: "files (connect)", args: "{}",
    result: { outcome: "error", output: "MCP error -32000: Access to MCP server 'files' is blocked." },
  }]);
  // Shown below the answer, like any tool line; the run still succeeds.
  assert.ok(types(events).indexOf(EventType.TEXT_MESSAGE_END) < types(events).indexOf(EventType.TOOL_CALL_START));
  assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
});

test("a tool reporting an error and a tool that throws become error results, and the loop goes on", async () => {
  const listNotes = { callId: "call_2", name: "notes-list_notes", arguments: '{"limit":500}' };
  const gateway = fakeGateway([functionCalls("resp_1", [listNotes, addNote]), answer("resp_2", "msg_1", ["Both failed."])]);
  const mcp = fakeMcp(bothServers({
    call: (name) => {
      if (name === "list_notes") return { isError: true, text: "limit must be at most 100" };
      throw new Error(`Streamable HTTP error: Error POSTing to endpoint: Bearer ${userGatewayToken} expired`);
    },
  }));
  const events = await runApim(gateway, mcp);
  const [listed, added] = toolLines(events);
  assert.deepEqual(listed.result, { outcome: "error", output: "limit must be at most 100" });
  assert.equal(added.result.outcome, "error");
  assert.doesNotMatch(added.result.output, /eyJ/);
  assert.deepEqual(gateway.requests[1].body.input, [
    { type: "function_call_output", call_id: "call_2", output: "Error: limit must be at most 100" },
    { type: "function_call_output", call_id: "call_1", output: `Error: ${added.result.output}` },
  ]);
  assert.equal(text(events), "Both failed.");
  assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
});

test("arguments that are not valid JSON become an error result without calling the tool", async () => {
  const broken = { callId: "call_1", name: "notes-add_note", arguments: '{"text": "buy' };
  const gateway = fakeGateway([functionCalls("resp_1", [broken]), answer("resp_2", "msg_1", ["Sorry."])]);
  const mcp = fakeMcp(bothServers());
  const events = await runApim(gateway, mcp);
  assert.deepEqual(mcp.calls, []);
  const [line] = toolLines(events);
  assert.equal(line.result.outcome, "error");
  // Shown as a JSON string, so that the chat can still display the arguments.
  assert.equal(JSON.parse(String(line.args)), '{"text": "buy');
  assert.match(String((gateway.requests[1].body.input[0] as { output: string }).output), /^Error: .*not a JSON object/);
});

test("a tool the model made up is an error result", async () => {
  const unknown = { callId: "call_1", name: "notes-delete_everything", arguments: "{}" };
  const gateway = fakeGateway([functionCalls("resp_1", [unknown]), answer("resp_2", "msg_1", ["No such tool."])]);
  const [line] = toolLines(await runApim(gateway, fakeMcp(bothServers())));
  assert.deepEqual(line.result, { outcome: "error", output: "There is no tool named notes-delete_everything." });
});

test("after 6 model rounds that all ask for tools, the run ends with a ⚠️ message and RUN_ERROR too_many_tool_rounds", async () => {
  const rounds = Array.from({ length: 6 }, (_, index) => functionCalls(`resp_${index + 1}`, [{ ...addNote, callId: `call_${index + 1}` }]));
  const gateway = fakeGateway(rounds);
  const mcp = fakeMcp(bothServers());
  const events = await runApim(gateway, mcp);
  assert.equal(gateway.requests.length, 6);
  // The sixth round's calls are not run: their results could not be sent to the model.
  assert.equal(mcp.calls.length, 5);
  assert.equal(toolLines(events).length, 5);
  assert.match(text(events), /^⚠️ The model still asked for tools after 6 rounds.*Request: request-1$/);
  assert.equal(events.at(-1)?.type, EventType.RUN_ERROR);
  assert.equal(field(events.at(-1), "code"), "gateway:too_many_tool_rounds");
  // Tool lines come before the error message.
  assert.ok(types(events).lastIndexOf(EventType.TOOL_CALL_RESULT) < types(events).indexOf(EventType.TEXT_MESSAGE_START));
  assert.deepEqual(mcp.closed.sort(), ["files", "notes"]);
});

for (const [status, body] of [
  // API Management's validate-jwt policy refusing the token, in its own format.
  [401, { statusCode: 401, message: `Unauthorized. Access token is missing or invalid: Bearer ${userGatewayToken}` }],
  // The model's refusal, passed through by API Management.
  [403, { error: { code: "PermissionDenied", message: `The principal lacks access; token ${userGatewayToken}` } }],
] as const) {
  test(`an API Management refusal (HTTP ${status}) before the stream is shown in the chat, redacted`, async () => {
    const gateway = fakeGateway([() => Response.json(body, { status })]);
    const mcp = fakeMcp(bothServers());
    const events = await runApim(gateway, mcp);
    assert.match(text(events), new RegExp(`^⚠️ The gateway refused the request \\(HTTP ${status}\\)\\. .+Request: request-1$`));
    assert.doesNotMatch(JSON.stringify(events), /eyJ/);
    assert.equal(field(events.at(-1), "code"), "gateway:gateway_refused");
    assert.deepEqual(mcp.closed.sort(), ["files", "notes"]);
  });
}

test("cancelling the run closes the MCP sessions", async () => {
  let notify: (() => void) | undefined;
  const modelCalled = new Promise<void>((resolve) => { notify = resolve; });
  const mcp = fakeMcp(bothServers());
  const agent = new GatewayAgent({
    config: apimConfig, signal: new AbortController().signal, requestId: "request-1", userId: id(5),
    gatewayToken: userGatewayToken, connectMcp: mcp.connect,
    fetchImpl: async (_, init) => {
      notify?.();
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }));
    },
  });
  const subscription = agent.run(input).subscribe();
  await modelCalled;
  subscription.unsubscribe();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(mcp.closed.sort(), ["files", "notes"]);
});

test("the real CopilotKit runtime streams an API Management run with the checked gateway token", async () => {
  const gateway = fakeGateway([functionCalls("resp_1", [addNote]), answer("resp_2", "msg_1", ["Done."])]);
  const mcp = fakeMcp(bothServers());
  const response = await handleRequest(new Request("http://localhost:3000/api/copilotkit/agent/chat/run", {
    method: "POST", body: JSON.stringify(input),
    headers: { "Content-Type": "application/json", accept: "text/event-stream", "x-gateway-token": userGatewayToken },
  }), {
    config: () => apimConfig, authenticate: async () => ({ oid: id(5), tid: id(1) }),
    verifyGatewayToken: async (token) => token!, fetchImpl: gateway.fetchImpl, connectMcp: mcp.connect,
  });
  const events = await response.text();
  assert.match(events, /"toolCallName":"notes-add_note"/);
  assert.match(events, /RUN_FINISHED/);
  assert.doesNotMatch(events, /eyJ|sk-test-team-key/);
  assert.equal(mcp.connections[0].token, userGatewayToken);
});
