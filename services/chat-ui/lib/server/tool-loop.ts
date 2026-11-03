// API Management mode: API Management is only a proxy, so this server runs the tool loop. It offers the model the
// tools of the MCP servers in MCP_SERVERS as function tools, runs the calls the model asks for (through the gateway,
// as the signed-in user), sends the results back and repeats, until the model answers without asking for a tool.
// Like LiteLLM mode, the answer comes first and the tool calls of all rounds are shown below it.
import { EventType, type BaseEvent } from "@ag-ui/client";
import { encodeToolResult, type ToolResult } from "../tool-result";
import { responsesUrl, type ApimConfig } from "./config";
import { ChatError, redactGatewayText } from "./errors";
import { openToolbox, type McpConnect, type Toolbox } from "./mcp-tools";
import { streamResponses, type ChatMessage, type ResponsesEvent } from "./responses-stream";
import { failureMessage, maxToolOutputLength, textEvent } from "./responses-to-ag-ui";

export const maxModelRounds = 6;

interface FunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

interface Round {
  responseId?: string;
  calls: FunctionCall[];
}

// One model call: yields the assistant's text as it streams, and returns the function calls the model asked for.
async function* modelRound(events: AsyncIterable<ResponsesEvent>, idPrefix: string): AsyncGenerator<BaseEvent, Round> {
  const calls: FunctionCall[] = [];
  for await (const event of events) {
    const text = textEvent(event, idPrefix);
    if (text) {
      yield text;
      continue;
    }
    const item = event.item;
    switch (event.type) {
      case "response.output_item.done":
        if (item?.type === "function_call") {
          if (!item.call_id || !item.name) {
            throw new ChatError("gateway", "invalid_stream", "The gateway sent a function call without its id or name.");
          }
          calls.push({ callId: item.call_id, name: item.name, arguments: item.arguments ?? "" });
        }
        break;
      case "response.completed":
        if (event.response?.status !== "completed") throw new ChatError("gateway", "response_failed", failureMessage(event));
        return { responseId: event.response.id, calls };
      case "response.failed":
      case "response.incomplete":
      case "error":
        throw new ChatError("gateway", "response_failed", failureMessage(event));
    }
  }
  throw new ChatError("gateway", "truncated_stream", "The gateway closed the stream before the response was complete.");
}

function shownResult(isError: boolean, text: string): ToolResult {
  return isError
    ? { outcome: "error", output: redactGatewayText(text || "The tool reported an error.", maxToolOutputLength) }
    : { outcome: "ok", output: text.slice(0, maxToolOutputLength) };
}

function parseArguments(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

// Whatever goes wrong with one call becomes an error result: the model is told and can explain it, as with LiteLLM.
async function runCall(toolbox: Toolbox, call: FunctionCall): Promise<ToolResult> {
  const args = parseArguments(call.arguments);
  if (!args) return { outcome: "error", output: "The model sent arguments that are not a JSON object." };
  try {
    const result = await toolbox.call(call.name, args);
    return shownResult(result.isError, result.text);
  } catch (error) {
    return shownResult(true, error instanceof Error ? error.message : "The tool call failed.");
  }
}

// The same four events LiteLLM mode sends for an mcp_call. Arguments that are not JSON are shown as a JSON string,
// so that the chat can still parse and display them.
function toolCallEvents(toolCallId: string, name: string, args: string, result: ToolResult): BaseEvent[] {
  return [
    { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: name },
    { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: parseArguments(args) ? args || "{}" : JSON.stringify(args) },
    { type: EventType.TOOL_CALL_END, toolCallId },
    {
      type: EventType.TOOL_CALL_RESULT, role: "tool", messageId: `${toolCallId}-result`, toolCallId,
      content: encodeToolResult(result),
    } as BaseEvent,
  ];
}

export async function* runToolLoop({
  config, messages, gatewayToken, signal, runId, fetchImpl, connectMcp,
}: {
  config: ApimConfig; messages: ChatMessage[]; gatewayToken?: string; signal: AbortSignal; runId: string;
  fetchImpl?: typeof fetch; connectMcp?: McpConnect;
}): AsyncGenerator<BaseEvent> {
  // The handler always checks one in this mode (GATEWAY_SCOPE is required); API Management never gets a key.
  if (!gatewayToken) {
    throw new ChatError("authentication", "missing_gateway_token", "The chat needs your token for the gateway. Sign in again.", 401);
  }
  const headers = { Authorization: `Bearer ${gatewayToken}`, "Content-Type": "application/json" };
  // Held back until the answer has been shown, and flushed before a failure is reported.
  const toolEvents: BaseEvent[] = [];
  let toolbox: Toolbox | undefined;
  try {
    toolbox = await openToolbox({ servers: config.MCP_SERVERS, gatewayToken, signal, connect: connectMcp });
    // A server left out is shown like a failed tool call, with the gateway's reason (e.g. blocked by Agent 365).
    for (const { label, reason } of toolbox.unavailable) {
      toolEvents.push(...toolCallEvents(`${runId}-connect-${label}`, `${label} (connect)`, "{}", { outcome: "error", output: reason }));
    }
    let next: Record<string, unknown> = { input: messages };
    for (let round = 1; ; round++) {
      const events = streamResponses({
        url: responsesUrl(config), model: config.CHAT_MODEL, headers, signal, fetchImpl,
        body: { model: config.CHAT_MODEL, stream: true, instructions: config.CHAT_INSTRUCTIONS, tools: toolbox.tools, ...next },
      });
      const { responseId, calls } = yield* modelRound(events, runId);
      if (!calls.length) break;
      if (round === maxModelRounds) {
        throw new ChatError("gateway", "too_many_tool_rounds",
          `The model still asked for tools after ${maxModelRounds} rounds, so the chat stopped. Try a simpler request.`);
      }
      if (!responseId) throw new ChatError("gateway", "invalid_stream", "The gateway sent a response without its id.");
      const outputs = [];
      for (const call of calls) {
        const result = await runCall(toolbox, call);
        signal.throwIfAborted();
        toolEvents.push(...toolCallEvents(`${runId}-${call.callId}`, call.name, call.arguments, result));
        const output = result.outcome === "error" ? `Error: ${result.output}` : result.output;
        outputs.push({ type: "function_call_output", call_id: call.callId, output });
      }
      // The gateway's model keeps the conversation, its own function calls and reasoning: only the results are sent.
      next = { previous_response_id: responseId, input: outputs };
    }
    yield* toolEvents.splice(0);
  } catch (error) {
    if (!signal.aborted) yield* toolEvents.splice(0);
    throw error;
  } finally {
    await toolbox?.close();
  }
}
