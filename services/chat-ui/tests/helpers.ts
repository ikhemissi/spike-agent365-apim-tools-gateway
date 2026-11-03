// Shared test settings and the LiteLLM v1.106.6 event sequences observed live with a notes MCP server (ids shortened,
// encrypted reasoning removed).
import { getConfig } from "../lib/server/config";

export const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
export const environment = {
  GATEWAY_URL: "https://litellm.example.com/",
  LITELLM_API_KEY: "sk-test-team-key",
  CHAT_MODEL: "gpt-6-luna",
  UI_TENANT_ID: id(1),
  UI_CLIENT_ID: id(2),
  ALLOWED_USER_OBJECT_IDS: `${id(5)}, ${id(6)}`,
};
export const config = getConfig(environment);
// The same settings with LiteLLM's Agent 365 guardrail on: the gateway's app registration is id(3).
export const gatewayConfig = getConfig({ ...environment, GATEWAY_SCOPE: `api://${id(3)}/Tools.Use` });

export type GatewayEvent = Record<string, unknown> & { type: string };

export function sse(events: GatewayEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
}
export function streamResponse(events: GatewayEvent[]) {
  return new Response(sse(events), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

const started: GatewayEvent[] = [
  { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
  { type: "response.in_progress", response: { id: "resp_1", status: "in_progress" } },
];
const completed: GatewayEvent = { type: "response.completed", response: { id: "resp_1", status: "completed" } };

export function message(itemId: string, deltas: string[]): GatewayEvent[] {
  const text = deltas.join("");
  return [
    { type: "response.output_item.added", output_index: 3, item: { id: itemId, type: "message", status: "in_progress", content: [], role: "assistant" } },
    { type: "response.content_part.added", item_id: itemId, output_index: 3, content_index: 0, part: { type: "output_text", text: "" } },
    ...deltas.map((delta) => ({ type: "response.output_text.delta", item_id: itemId, output_index: 3, content_index: 0, delta })),
    { type: "response.output_text.done", item_id: itemId, output_index: 3, content_index: 0, text },
    { type: "response.content_part.done", item_id: itemId, output_index: 3, content_index: 0, part: { type: "output_text", text } },
    { type: "response.output_item.done", output_index: 3, item: { id: itemId, type: "message", status: "completed", content: [{ type: "output_text", text }], role: "assistant" } },
  ];
}

// The model asks for a function call; LiteLLM lists the MCP tools, runs the call, and reports it as an mcp_call item.
function mcpCall(callItemId: string, name: string, args: string, output: string): GatewayEvent[] {
  const functionItem = { id: "fc_1", type: "function_call", call_id: "call_1", name };
  return [
    { type: "response.output_item.added", output_index: 0, item: { ...functionItem, status: "in_progress", arguments: "" } },
    { type: "response.mcp_list_tools.in_progress", output_index: 0, item_id: "mcp_list" },
    { type: "response.mcp_list_tools.completed", output_index: 0, item_id: "mcp_list" },
    { type: "response.output_item.done", output_index: 0, item: { id: "mcp_list", type: "mcp_list_tools", server_label: "litellm", tools: [] } },
    { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: args },
    { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: args },
    { type: "response.output_item.done", output_index: 0, item: { ...functionItem, status: "completed", arguments: args } },
    { type: "response.output_item.added", output_index: 1, item: { id: callItemId, type: "mcp_call", status: "in_progress", arguments: args, name, server_label: "litellm" } },
    { type: "response.mcp_call.in_progress", output_index: 1, item_id: callItemId },
    { type: "response.mcp_call_arguments.delta", output_index: 1, item_id: callItemId, delta: args },
    { type: "response.mcp_call_arguments.done", output_index: 1, item_id: callItemId, arguments: args },
    { type: "response.mcp_call.completed", output_index: 1, item_id: callItemId },
    { type: "response.output_item.done", output_index: 1, item: {
      id: callItemId, type: "mcp_call", status: "completed", approval_request_id: "mcpr_1",
      arguments: args, name, output, server_label: "litellm",
    } },
    { type: "response.output_item.added", output_index: 2, item: { id: "rs_1", type: "reasoning", content: [] } },
    { type: "response.output_item.done", output_index: 2, item: { id: "rs_1", type: "reasoning", content: [] } },
  ];
}

export const observed = {
  textReply: [...started, ...message("msg_1", ["Hello", " team."]), completed],
  noteAdded: [
    ...started,
    ...mcpCall("mcp_d87a81de", "notes-add_note", '{"text":"ui spike live check"}',
      '{\n  "id": "8206382857658-4b5e6b35",\n  "created_at": "2026-11-02T10:59:02.342727+00:00"\n}'),
    ...message("msg_2", ["Added ", "the note."]),
    completed,
  ],
  // The notes server rejected limit 500; LiteLLM still marks the call "completed" and puts the error in its output.
  toolFailed: [
    ...started,
    ...mcpCall("mcp_7f32b4d6", "notes-list_notes", '{"limit":500}', "Error executing tool list_notes"),
    ...message("msg_3", ["Error executing tool list_notes"]),
    completed,
  ],
};

// The refusals LiteLLM returned live, before any stream: an unknown key, and a model the team may not use.
export const refusals = {
  unknownKey: {
    status: 401,
    body: { error: {
      message: "Authentication Error, Invalid proxy server token passed. Received API Key = sk-...test, Key Hash (Token) ="
        + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef. Unable to find token in cache or `LiteLLM_VerificationTokenTable`",
      type: "token_not_found_in_db", param: "key", code: "401",
    } },
  },
  modelNotAllowed: {
    status: 403,
    body: { error: {
      message: "The requested model 'not-a-model' is not available for this API key, or the model name is invalid.",
      type: "team_model_access_denied", param: "model", code: "403",
    } },
  },
};

export async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

export async function* fromArray<T>(values: T[]): AsyncGenerator<T> {
  yield* values;
}
