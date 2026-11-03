// Calls LiteLLM's Responses API with the team key (and the user's gateway token when the Agent 365 guardrail is on)
// and LiteLLM's own MCP tool, and yields the streamed events.
// LiteLLM runs the MCP tools itself ("server_url": "litellm_proxy"); this app only shows what it reports.
import { responsesUrl, type LiteLLMConfig } from "./config";
import { streamResponses, type ChatMessage, type ResponsesEvent } from "./responses-stream";

// Lets the gateway expose every MCP server the team's key may use, and run their tools without asking.
export const litellmMcpTool = { type: "mcp", server_label: "litellm", server_url: "litellm_proxy", require_approval: "never" };

// Without a gateway token the team key is the bearer token, as before. With one, the Agent 365 guardrail reads the
// user's token from Authorization, so LiteLLM takes the team key from its own header instead.
function gatewayHeaders(config: LiteLLMConfig, gatewayToken?: string): Record<string, string> {
  if (!gatewayToken) {
    return { Authorization: `Bearer ${config.LITELLM_API_KEY}`, "Content-Type": "application/json" };
  }
  return {
    "x-litellm-api-key": config.LITELLM_API_KEY,
    Authorization: `Bearer ${gatewayToken}`,
    "Content-Type": "application/json",
  };
}

export function streamLiteLLM({
  config, messages, signal, gatewayToken, fetchImpl,
}: {
  config: LiteLLMConfig; messages: ChatMessage[]; signal: AbortSignal; gatewayToken?: string; fetchImpl?: typeof fetch;
}): AsyncGenerator<ResponsesEvent> {
  return streamResponses({
    url: responsesUrl(config), model: config.CHAT_MODEL, headers: gatewayHeaders(config, gatewayToken), signal, fetchImpl,
    body: {
      model: config.CHAT_MODEL, stream: true, instructions: config.CHAT_INSTRUCTIONS, input: messages,
      tools: [litellmMcpTool],
    },
  });
}
