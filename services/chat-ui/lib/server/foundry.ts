// Foundry mode: calls a Foundry hosted agent's Responses endpoint as the signed-in user, and turns its stream into
// AG-UI events. The agent runs its tools itself; it acts for the user with the two tokens forwarded to it in x-client-*
// headers, which Foundry passes on to the agent's container: the user's gateway token (MCP servers through the
// gateway) and Foundry token (other Foundry agents, over A2A through the gateway). This server never calls the gateway.
import { EventType, type BaseEvent } from "@ag-ui/client";
import { encodeToolResult } from "../tool-result";
import { responsesUrl, type FoundryConfig } from "./config";
import { ChatError } from "./errors";
import { rememberSession, sessionFor } from "./foundry-sessions";
import { refusal, streamResponses, type ChatMessage, type ResponsesEvent } from "./responses-stream";
import { failureMessage, textEvent, toolOutcome } from "./responses-to-ag-ui";

// Starts a session of the hosted agent as the user (its container starts now, so that the chat's first message finds
// it running); returns its id.
export async function createFoundrySession({
  config, foundryToken, fetchImpl = fetch,
}: {
  config: FoundryConfig; foundryToken: string; fetchImpl?: typeof fetch;
}): Promise<string> {
  const url = `${config.GATEWAY_URL}/agents/${config.FOUNDRY_AGENT}/endpoint/sessions?api-version=v1`;
  const response = await fetchImpl(url, {
    method: "POST", redirect: "error", body: "{}",
    headers: { Authorization: `Bearer ${foundryToken}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw await refusal(response);
  const session = await response.json() as { agent_session_id?: unknown };
  if (typeof session.agent_session_id !== "string" || !session.agent_session_id) {
    throw new ChatError("gateway", "invalid_session", "Foundry did not return a session id.");
  }
  return session.agent_session_id;
}

// sessionKey: the user and the chat thread, whose hosted-agent session is reused (foundry-sessions.ts).
export async function* streamFoundryAgent({
  config, messages, signal, foundryToken, gatewayToken, sessionKey, fetchImpl,
}: {
  config: FoundryConfig; messages: ChatMessage[]; signal: AbortSignal; foundryToken: string; gatewayToken: string;
  sessionKey: string; fetchImpl?: typeof fetch;
}): AsyncGenerator<ResponsesEvent> {
  const headers = {
    Authorization: `Bearer ${foundryToken}`,
    "x-client-foundry-token": foundryToken,
    "x-client-gateway-token": gatewayToken,
    "Content-Type": "application/json",
  };
  // With the Responses protocol, the session goes in the body; Foundry returns it in x-agent-session-id.
  const sessionId = await sessionFor(sessionKey);
  yield* streamResponses({
    url: responsesUrl(config), model: config.CHAT_MODEL, headers, signal, fetchImpl,
    body: { input: messages, stream: true, ...(sessionId ? { agent_session_id: sessionId } : {}) },
    onResponseHeaders: (responseHeaders) => {
      const returned = responseHeaders.get("x-agent-session-id");
      if (returned) rememberSession(sessionKey, returned);
    },
  });
}

// The agent reports each tool call as a function_call item (its name and arguments), then a function_call_output item
// with the same call_id (its result). Unlike the gateway modes, tool calls are shown as soon as the agent reports them:
// a hosted agent can take several seconds per tool (another agent over A2A), and the user sees its progress.
export async function* foundryToAgUiEvents(
  events: AsyncIterable<ResponsesEvent>, idPrefix: string,
): AsyncGenerator<BaseEvent> {
  const id = (callId: string) => `${idPrefix}-${callId}`;
  for await (const event of events) {
    const text = textEvent(event, idPrefix);
    if (text) {
      yield text;
      continue;
    }
    const item = event.item;
    if (event.type === "response.output_item.done" && item?.type === "function_call" && item.call_id) {
      const toolCallId = id(item.call_id);
      yield { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: item.name ?? "unknown tool" };
      yield { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: item.arguments || "{}" };
      yield { type: EventType.TOOL_CALL_END, toolCallId };
      continue;
    }
    if (event.type === "response.output_item.done" && item?.type === "function_call_output" && item.call_id) {
      yield {
        type: EventType.TOOL_CALL_RESULT, role: "tool", messageId: id(`${item.call_id}-result`),
        toolCallId: id(item.call_id), content: encodeToolResult(toolOutcome(item)),
      } as BaseEvent;
      continue;
    }
    switch (event.type) {
      case "response.completed":
        if (event.response?.status !== "completed") throw new ChatError("gateway", "response_failed", failureMessage(event));
        return;
      case "response.failed":
      case "response.incomplete":
      case "error":
        throw new ChatError("gateway", "response_failed", failureMessage(event));
    }
  }
  throw new ChatError("gateway", "truncated_stream", "The agent closed the stream before the response was complete.");
}
