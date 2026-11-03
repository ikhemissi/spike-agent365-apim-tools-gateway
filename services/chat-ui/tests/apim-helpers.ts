// API Management mode fixtures: the Responses API events API Management streams from the model (shaped like Azure
// OpenAI's: function calls, then an answer), a fake gateway that records what this server sends, and a stand-in for
// the MCP servers behind API Management.
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { getConfig, type ApimConfig } from "../lib/server/config";
import type { McpConnect, McpTool, McpToolResult } from "../lib/server/mcp-tools";
import { environment, id, message, streamResponse, type GatewayEvent } from "./helpers";

// The LiteLLM key stays in the environment on purpose: apim mode must ignore it.
export const apimEnvironment = {
  ...environment,
  CHAT_GATEWAY: "apim",
  GATEWAY_URL: "https://apim.example.com/openai/v1/",
  GATEWAY_SCOPE: `api://${id(3)}/Tools.Use`,
  MCP_SERVERS: "notes=https://apim.example.com/notes/mcp, files=https://apim.example.com/files/mcp",
};
export const apimConfig = getConfig(apimEnvironment) as ApimConfig;

// Shaped like a JWT so the redaction is exercised; not a real token (assembled at runtime for the leak check).
export const userGatewayToken = ["eyJ" + "hbGciOiJSUzI1NiJ9", "eyJ" + "vaWQiOiJ0ZXN0In0", "c2lnbmF0dXJl"].join(".");

function response(responseId: string, output: GatewayEvent[]): GatewayEvent[] {
  return [
    { type: "response.created", response: { id: responseId, object: "response", status: "in_progress", output: [] } },
    { type: "response.in_progress", response: { id: responseId, object: "response", status: "in_progress", output: [] } },
    ...output,
    { type: "response.completed", response: { id: responseId, object: "response", status: "completed" } },
  ].map((event, index) => ({ ...event, sequence_number: index }));
}

export interface ModelCall {
  callId: string;
  name: string;
  arguments: string;
}

// The model asks for one or more function calls and stops: the response completes with them as its output.
export function functionCalls(responseId: string, calls: ModelCall[]): GatewayEvent[] {
  return response(responseId, calls.flatMap((call, outputIndex) => {
    const item = { id: `fc_${call.callId}`, type: "function_call", call_id: call.callId, name: call.name };
    return [
      { type: "response.output_item.added", output_index: outputIndex, item: { ...item, status: "in_progress", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: item.id, output_index: outputIndex, delta: call.arguments },
      { type: "response.function_call_arguments.done", item_id: item.id, output_index: outputIndex, arguments: call.arguments },
      { type: "response.output_item.done", output_index: outputIndex, item: { ...item, status: "completed", arguments: call.arguments } },
    ];
  }));
}

export function answer(responseId: string, itemId: string, deltas: string[]): GatewayEvent[] {
  return response(responseId, message(itemId, deltas));
}

export interface SentRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown> & { input: unknown[]; tools: { name: string }[] };
}

// API Management's Responses API: answers each model call with the next round's events, and records the requests.
export function fakeGateway(rounds: (GatewayEvent[] | (() => Response))[]) {
  const requests: SentRequest[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const round = rounds[requests.length - 1];
    if (!round) throw new Error(`Model call ${requests.length} was not expected`);
    return typeof round === "function" ? round() : streamResponse(round);
  };
  return { fetchImpl, requests };
}

export const notesTools: McpTool[] = [
  { name: "add_note", description: "Adds a note.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "list_notes", description: "Lists notes.", inputSchema: { type: "object", properties: { limit: { type: "integer" } } } },
];

export interface FakeServer {
  tools?: McpTool[];
  connectError?: Error;
  call?: (name: string, args: Record<string, unknown>) => McpToolResult | Promise<McpToolResult>;
}

// What API Management answers on initialize when Agent 365 blocks the server for this user, as the SDK reports it.
export const blockedByGateway = (label: string) => new McpError(-32000, `Access to MCP server '${label}' is blocked.`,
  { code: "AccessBlockedByGateway" });

// The MCP servers behind API Management, by label; records who connected, what was called and what was closed.
export function fakeMcp(servers: Record<string, FakeServer>) {
  const connections: { label: string; url: string; token: string }[] = [];
  const calls: { label: string; name: string; args: Record<string, unknown> }[] = [];
  const closed: string[] = [];
  const connect: McpConnect = async (server, token) => {
    connections.push({ label: server.label, url: server.url, token });
    const fake = servers[server.label];
    if (!fake) throw new Error(`Unexpected server ${server.label}`);
    if (fake.connectError) throw fake.connectError;
    return {
      listTools: async () => fake.tools ?? [],
      callTool: async (name, args) => {
        calls.push({ label: server.label, name, args });
        return fake.call ? fake.call(name, args) : { isError: false, text: `${name} done` };
      },
      close: async () => { closed.push(server.label); },
    };
  };
  return { connect, connections, calls, closed };
}
