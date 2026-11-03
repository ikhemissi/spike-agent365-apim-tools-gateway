// How LiteLLM's Responses events become the AG-UI events the chat shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EventType, type BaseEvent } from "@ag-ui/client";
import { toAgUiEvents } from "../lib/server/responses-to-ag-ui";
import type { ResponsesEvent } from "../lib/server/responses-stream";
import { decodeToolResult } from "../lib/tool-result";
import { collect, fromArray, observed, type GatewayEvent } from "./helpers";

const translate = (events: GatewayEvent[]) => collect(toAgUiEvents(fromArray(events as ResponsesEvent[]), "run"));
const types = (events: BaseEvent[]) => events.map((event) => event.type);
const field = (event: BaseEvent | undefined, name: string) => (event as Record<string, unknown> | undefined)?.[name];

test("a text reply becomes one assistant text message with its deltas", async () => {
  const events = await translate(observed.textReply);
  assert.deepEqual(types(events), [
    EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END,
  ]);
  assert.equal(field(events[0], "messageId"), "run-msg_1");
  assert.equal(events.map((event) => field(event, "delta") ?? "").join(""), "Hello team.");
});

test("an MCP call LiteLLM ran becomes one tool call with its name, arguments and result, after the reply", async () => {
  const events = await translate(observed.noteAdded);
  assert.deepEqual(types(events), [
    EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END,
    EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END, EventType.TOOL_CALL_RESULT,
  ]);
  const [start, args, , result] = events.slice(4);
  assert.equal(field(start, "toolCallName"), "notes-add_note");
  assert.equal(field(start, "toolCallId"), "run-mcp_d87a81de");
  assert.equal(field(args, "delta"), '{"text":"ui spike live check"}');
  assert.equal(field(result, "toolCallId"), "run-mcp_d87a81de");
  const outcome = decodeToolResult(String(field(result, "content")));
  assert.equal(outcome.outcome, "ok");
  assert.match(outcome.output, /8206382857658-4b5e6b35/);
});

test("the model's function_call item is not shown as a second tool call", async () => {
  const events = await translate(observed.noteAdded);
  assert.equal(events.filter((event) => event.type === EventType.TOOL_CALL_START).length, 1);
});

test("a tool that failed is shown as an error result, although LiteLLM reports it as completed", async () => {
  const events = await translate(observed.toolFailed);
  const result = events.find((event) => event.type === EventType.TOOL_CALL_RESULT);
  assert.deepEqual(decodeToolResult(String(field(result, "content"))), {
    outcome: "error", output: "Error executing tool list_notes",
  });
});

test("a guardrail or permission block from LiteLLM is shown as an error result", async () => {
  for (const output of ["Tool call blocked: Guardrail 'notes-guard' violation.", "Tool call failed: 403: not allowed"]) {
    const events = await translate(observed.noteAdded.map((event) => event.type === "response.output_item.done"
      && (event.item as { type: string }).type === "mcp_call"
      ? { ...event, item: { ...(event.item as object), output } } : event));
    const result = events.find((event) => event.type === EventType.TOOL_CALL_RESULT);
    assert.equal(decodeToolResult(String(field(result, "content"))).outcome, "error");
  }
});

test("a stream error event fails the run with the gateway's message, without keys", async () => {
  const failing: GatewayEvent[] = [
    ...observed.textReply.slice(0, 2),
    { type: "error", error: { type: "mcp_gateway_error", code: "403", message: "Server not allowed for key sk-abc123" } },
  ];
  await assert.rejects(translate(failing), (error: Error) => {
    assert.match(error.message, /Server not allowed for key sk-…/);
    assert.doesNotMatch(error.message, /abc123/);
    return true;
  });
});

test("a failed or unfinished response fails the run", async () => {
  await assert.rejects(translate([...observed.textReply.slice(0, -1),
    { type: "response.failed", response: { status: "failed", error: { message: "Upstream timeout" } } }]), /Upstream timeout/);
  await assert.rejects(translate(observed.textReply.slice(0, -1)), /closed the stream/);
});

test("tool calls are still shown when the response then fails", async () => {
  const failing = [...observed.noteAdded.slice(0, -1),
    { type: "response.failed", response: { status: "failed", error: { message: "Upstream timeout" } } }] as GatewayEvent[];
  const seen: BaseEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of toAgUiEvents(fromArray(failing as ResponsesEvent[]), "run")) seen.push(event);
  }, /Upstream timeout/);
  assert.ok(seen.some((event) => event.type === EventType.TOOL_CALL_RESULT));
});
