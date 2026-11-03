// The MCP side of API Management mode with the official SDK client against in-process MCP servers over HTTP: the tools
// become function tools, calls carry the user's token and the call's trace context, and a server API Management
// blocks or refuses is left out with its reason.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { z } from "zod";
import { functionName, openToolbox } from "../lib/server/mcp-tools";
import { userGatewayToken } from "./apim-helpers";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();

// What each in-process server saw, so the tests can check the headers API Management would get.
const seen: { server: string; method: string; authorization?: string; traceparent?: string }[] = [];

async function readJson(request: IncomingMessage): Promise<{ id?: number; method?: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

// A notes MCP server, stateless: a new server and transport per request, as the SDK's examples do.
async function notesServer(request: IncomingMessage, response: ServerResponse) {
  const body = await readJson(request);
  seen.push({ server: "notes", method: body.method ?? request.method!, authorization: request.headers.authorization,
    traceparent: request.headers.traceparent as string | undefined });
  const mcp = new McpServer({ name: "notes", version: "1.0.0" });
  mcp.registerTool("add_note", { description: "Adds a note.", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text: `Added: ${text}` }] }));
  mcp.registerTool("list_notes", { description: "Lists notes.", inputSchema: { limit: z.number().int() } },
    async ({ limit }) => ({ isError: limit > 100, content: [{ type: "text", text: "limit must be at most 100" }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on("close", () => { void transport.close(); void mcp.close(); });
  await mcp.connect(transport);
  await transport.handleRequest(request, response, body);
}

// API Management when Agent 365 blocks the server for this user: HTTP 200 with a JSON-RPC error, already on initialize.
async function blockedServer(request: IncomingMessage, response: ServerResponse) {
  const body = await readJson(request);
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
    jsonrpc: "2.0", id: body.id ?? null,
    error: { code: -32000, message: "Access to MCP server 'files' is blocked.", data: { code: "AccessBlockedByGateway" } },
  }));
}

// API Management's validate-jwt refusing the token (echoing it, to check the redaction).
async function refusingServer(request: IncomingMessage, response: ServerResponse) {
  await readJson(request);
  response.writeHead(401, { "content-type": "application/json" })
    .end(JSON.stringify({ statusCode: 401, message: `Invalid JWT: Bearer ${userGatewayToken}` }));
}

let server: Server;
let base = "";
before(async () => {
  server = createServer((request, response) => {
    const route = { "/notes/mcp": notesServer, "/files/mcp": blockedServer, "/wiki/mcp": refusingServer }[request.url ?? ""];
    if (!route) return void response.writeHead(404).end();
    // GET (the optional server-to-client stream) is not offered, as the spec allows.
    if (request.method !== "POST") return void response.writeHead(405).end();
    route(request, response).catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await provider.shutdown();
});

const open = (labels: string[]) => openToolbox({
  servers: labels.map((label) => ({ label, url: `${base}/${label}/mcp` })),
  gatewayToken: userGatewayToken, signal: new AbortController().signal,
});

test("a server's MCP tools become function tools named <label>-<tool>, with their input schema", async () => {
  const toolbox = await open(["notes"]);
  try {
    assert.deepEqual(toolbox.unavailable, []);
    assert.deepEqual(toolbox.tools.map((tool) => tool.name), ["notes-add_note", "notes-list_notes"]);
    const [addNote] = toolbox.tools;
    assert.equal(addNote.type, "function");
    assert.equal(addNote.description, "Adds a note.");
    assert.equal(addNote.strict, false);
    assert.deepEqual((addNote.parameters as { properties: unknown }).properties, { text: { type: "string" } });
  } finally {
    await toolbox.close();
  }
});

test("a call returns the tool's text and its error flag, with the user's token and the call span's traceparent", async () => {
  exporter.reset();
  seen.length = 0;
  const toolbox = await open(["notes"]);
  try {
    assert.deepEqual(await toolbox.call("notes-add_note", { text: "buy milk" }), { isError: false, text: "Added: buy milk" });
    assert.deepEqual(await toolbox.call("notes-list_notes", { limit: 500 }), { isError: true, text: "limit must be at most 100" });
  } finally {
    await toolbox.close();
  }
  assert.ok(seen.length > 0);
  for (const request of seen) assert.equal(request.authorization, `Bearer ${userGatewayToken}`);
  const span = exporter.getFinishedSpans().find((finished) => finished.name === "MCP tools/call add_note");
  assert.ok(span);
  const { traceId, spanId } = span.spanContext();
  const call = seen.find((request) => request.method === "tools/call");
  assert.equal(call?.traceparent, `00-${traceId}-${spanId}-01`);
});

test("a server API Management blocks or refuses is left out with its reason, redacted; the others' tools stay", async () => {
  const toolbox = await open(["notes", "files", "wiki"]);
  try {
    assert.deepEqual(toolbox.tools.map((tool) => tool.name), ["notes-add_note", "notes-list_notes"]);
    assert.deepEqual(toolbox.unavailable.map((server) => server.label), ["files", "wiki"]);
    const [blocked, refused] = toolbox.unavailable;
    assert.equal(blocked.reason, "MCP error -32000: Access to MCP server 'files' is blocked.");
    assert.match(refused.reason, /401|Invalid JWT/);
    assert.doesNotMatch(refused.reason, /eyJ/);
  } finally {
    await toolbox.close();
  }
});

test("function names keep to the Responses API's limits, deterministically", () => {
  const taken = new Set<string>();
  assert.equal(functionName("notes", "add.note", taken), "notes-add_note");
  assert.equal(functionName("notes", "add note", taken), "notes-add_note_2");
  const long = functionName("notes", "x".repeat(100), taken);
  assert.equal(long.length, 64);
  assert.equal(functionName("notes", "x".repeat(101), taken), `${long.slice(0, 62)}_2`);
  assert.match(functionName("wiki", "página/ünïcode", taken), /^[a-zA-Z0-9_-]+$/);
});
