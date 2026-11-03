// Turns LiteLLM's Responses events into AG-UI events: the assistant's text, and each MCP call LiteLLM ran
// with its arguments and its result or error. Everything else LiteLLM streams is not shown.
import { EventType, type BaseEvent } from "@ag-ui/client";
import { encodeToolResult, type ToolResult } from "../tool-result";
import { ChatError, redactGatewayText } from "./errors";
import type { ResponsesEvent, ResponsesItem } from "./responses-stream";

// LiteLLM v1.106.6 reports a failed or blocked tool as a "completed" mcp_call whose output starts like this.
const toolErrorPrefixes = ["Error executing tool", "Tool call failed:", "Tool call blocked:"];
export const maxToolOutputLength = 16_384;

export function toolOutcome(item: ResponsesItem): ToolResult {
  if (item.error) {
    const message = typeof item.error === "string" ? item.error : JSON.stringify(item.error);
    return { outcome: "error", output: redactGatewayText(message, maxToolOutputLength) };
  }
  const output = (item.output ?? "").slice(0, maxToolOutputLength);
  const failed = item.status === "failed" || toolErrorPrefixes.some((prefix) => output.startsWith(prefix));
  return { outcome: failed ? "error" : "ok", output: failed ? redactGatewayText(output, maxToolOutputLength) : output };
}

export function failureMessage(event: ResponsesEvent): string {
  const message = event.error?.message ?? event.message ?? event.response?.error?.message;
  const detail = message ? ` ${redactGatewayText(message)}` : "";
  return `The gateway could not complete the response (${event.type}).${detail}`;
}

// The assistant's text, the same with both gateways: a response can hold several messages, each with its deltas.
// idPrefix (the run id) keeps the gateway's item ids unique within a chat thread.
export function textEvent(event: ResponsesEvent, idPrefix: string): BaseEvent | undefined {
  const item = event.item;
  if (event.type === "response.output_item.added" && item?.type === "message") {
    return { type: EventType.TEXT_MESSAGE_START, messageId: `${idPrefix}-${item.id}`, role: "assistant" };
  }
  if (event.type === "response.output_text.delta" && event.item_id && typeof event.delta === "string" && event.delta) {
    return { type: EventType.TEXT_MESSAGE_CONTENT, messageId: `${idPrefix}-${event.item_id}`, delta: event.delta };
  }
  if (event.type === "response.output_item.done" && item?.type === "message") {
    return { type: EventType.TEXT_MESSAGE_END, messageId: `${idPrefix}-${item.id}` };
  }
  return undefined;
}

// The model's own function_call items are skipped: LiteLLM reports the same call again as an mcp_call item,
// with the output, once it has run the tool. Tool calls are held back and shown after the assistant's reply, so that
// the answer comes first and the tool details below it; they are also flushed before a failure is reported.
export async function* toAgUiEvents(events: AsyncIterable<ResponsesEvent>, idPrefix: string): AsyncGenerator<BaseEvent> {
  // LiteLLM's mcp_call ids are short; the run id keeps them unique within a chat thread.
  const id = (itemId: string) => `${idPrefix}-${itemId}`;
  const toolEvents: BaseEvent[] = [];
  for await (const event of events) {
    const text = textEvent(event, idPrefix);
    if (text) {
      yield text;
      continue;
    }
    const item = event.item;
    switch (event.type) {
      case "response.output_item.added":
        if (item?.type === "mcp_call") {
          const toolCallId = id(item.id);
          toolEvents.push(
            { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: item.name ?? "unknown tool" },
            { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: item.arguments || "{}" },
            { type: EventType.TOOL_CALL_END, toolCallId },
          );
        }
        break;
      case "response.output_item.done":
        if (item?.type === "mcp_call") {
          toolEvents.push({
            type: EventType.TOOL_CALL_RESULT, role: "tool", messageId: id(`${item.id}-result`),
            toolCallId: id(item.id), content: encodeToolResult(toolOutcome(item)),
          } as BaseEvent);
        }
        break;
      case "response.completed":
        yield* toolEvents.splice(0);
        if (event.response?.status !== "completed") throw new ChatError("gateway", "response_failed", failureMessage(event));
        return;
      case "response.failed":
      case "response.incomplete":
      case "error":
        yield* toolEvents.splice(0);
        throw new ChatError("gateway", "response_failed", failureMessage(event));
    }
  }
  yield* toolEvents.splice(0);
  throw new ChatError("gateway", "truncated_stream", "The gateway closed the stream before the response was complete.");
}
