// API Management mode: the MCP servers API Management exposes, reached as the signed-in user. A toolbox connects to
// each server in MCP_SERVERS, lists its tools as function tools for the model, calls them, and is closed at the end of
// the chat run. A server that cannot be reached or listed is left out and reported, so the chat can show why.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { context, propagation } from "@opentelemetry/api";
import type { McpServerSetting } from "./config";
import { redactGatewayText } from "./errors";
import { traceMcpCall } from "./telemetry";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  isError: boolean;
  // The tool's text content, joined; other content (images, resources) is not shown.
  text: string;
}

// One connected MCP server. Kept this small so that tests can stand in for a server (see connectMcpServer).
export interface McpSession {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export type McpConnect = (server: McpServerSetting, gatewayToken: string, signal: AbortSignal) => Promise<McpSession>;

const toolCallTimeout = 60_000;
const maxToolPages = 10;

// The SDK takes headers once per transport, not per request, but it calls this fetch in the caller's async context:
// inside a tools/call span, the request carries that span's traceparent, so API Management's spans join the trace.
async function fetchWithTraceContext(url: string | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  propagation.inject(context.active(), headers, { set: (carrier, key, value) => carrier.set(key, value) });
  return fetch(url, { ...init, headers });
}

// The official MCP SDK over Streamable HTTP, with the user's own token for the gateway as the bearer token.
export const connectMcpServer: McpConnect = async (server, gatewayToken, signal) => {
  const client = new Client({ name: "chat-ui", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: { Authorization: `Bearer ${gatewayToken}` }, redirect: "error" },
    fetch: fetchWithTraceContext,
  });
  try {
    await client.connect(transport, { signal });
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return {
    async listTools() {
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < maxToolPages; page++) {
        const result = await client.listTools(cursor ? { cursor } : undefined, { signal });
        tools.push(...result.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      return tools;
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: toolCallTimeout });
      const content = "content" in result && Array.isArray(result.content) ? result.content : [];
      const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
      return { isError: result.isError === true, text };
    },
    close: () => client.close(),
  };
};

// A Responses API function tool; strict: false because MCP input schemas are not written for strict mode.
export interface FunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: false;
}

export interface UnavailableServer {
  label: string;
  // Why it was left out (redacted): e.g. "MCP error -32000: Access to MCP server 'notes' is blocked."
  reason: string;
}

export interface Toolbox {
  tools: FunctionTool[];
  unavailable: UnavailableServer[];
  // Throws when the tool is unknown or the call fails; a tool's own error is a result with isError.
  call(functionName: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

const maxFunctionNameLength = 64;

// "<label>-<tool>", as LiteLLM names them, within the Responses API's limits (64 characters of [a-zA-Z0-9_-]).
// Deterministic: servers in MCP_SERVERS order and tools in listed order; a name already taken gets a suffix "_2", "_3"…
export function functionName(label: string, tool: string, taken: Set<string>): string {
  const base = `${label}-${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  let name = base.slice(0, maxFunctionNameLength);
  for (let n = 2; taken.has(name); n++) {
    const suffix = `_${n}`;
    name = base.slice(0, maxFunctionNameLength - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}

async function openSession(server: McpServerSetting, gatewayToken: string, signal: AbortSignal, connect: McpConnect) {
  const session = await connect(server, gatewayToken, signal);
  try {
    return { session, tools: await session.listTools() };
  } catch (error) {
    await session.close().catch(() => undefined);
    throw error;
  }
}

export async function openToolbox({ servers, gatewayToken, signal, connect = connectMcpServer }: {
  servers: McpServerSetting[]; gatewayToken: string; signal: AbortSignal; connect?: McpConnect;
}): Promise<Toolbox> {
  const opened = await Promise.allSettled(servers.map((server) => openSession(server, gatewayToken, signal, connect)));
  const tools: FunctionTool[] = [];
  const unavailable: UnavailableServer[] = [];
  const sessions: McpSession[] = [];
  const targets = new Map<string, { label: string; tool: string; session: McpSession }>();
  const taken = new Set<string>();
  opened.forEach((result, index) => {
    const { label } = servers[index];
    if (result.status === "rejected") {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      unavailable.push({ label, reason: redactGatewayText(message || "The server could not be reached.") });
      return;
    }
    const { session } = result.value;
    sessions.push(session);
    for (const tool of result.value.tools) {
      const name = functionName(label, tool.name, taken);
      targets.set(name, { label, tool: tool.name, session });
      tools.push({
        type: "function", name, ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema, strict: false,
      });
    }
  });
  return {
    tools,
    unavailable,
    async call(name, args) {
      const target = targets.get(name);
      if (!target) throw new Error(`There is no tool named ${name}.`);
      return traceMcpCall(target.label, target.tool, () => target.session.callTool(target.tool, args));
    },
    async close() {
      await Promise.allSettled(sessions.map((session) => session.close()));
    },
  };
}
