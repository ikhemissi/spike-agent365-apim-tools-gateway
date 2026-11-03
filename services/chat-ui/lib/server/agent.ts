// The chat's one agent ("chat"): sends the conversation to the gateway and streams back AG-UI events. With LiteLLM,
// LiteLLM runs the MCP tools; with API Management, this server runs them (tool-loop.ts).
// Errors, including gateway refusals, are shown as a chat message and end the run with RUN_ERROR.
import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable, type Subscriber } from "rxjs";
import { z } from "zod";
import type { ChatConfig } from "./config";
import { ChatError, reportError } from "./errors";
import { streamLiteLLM } from "./litellm";
import type { McpConnect } from "./mcp-tools";
import type { ChatMessage } from "./responses-stream";
import { toAgUiEvents } from "./responses-to-ag-ui";
import { RunTelemetry } from "./telemetry";
import { runToolLoop } from "./tool-loop";

export const agentId = "chat";

export interface InvocationContext {
  config: ChatConfig;
  signal: AbortSignal;
  requestId: string;
  // The signed-in user's object id, recorded on the run's span.
  userId: string;
  // The signed-in user's token for the gateway, checked by the handler; only set when GATEWAY_SCOPE is.
  gatewayToken?: string;
  fetchImpl?: typeof fetch;
  // API Management mode only: how to reach an MCP server (tests stand in for the servers).
  connectMcp?: McpConnect;
}

const conversationSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(16_000),
})).min(1).max(40);

// Tool calls and their results are shown in the chat but not sent back: they ran in an earlier turn,
// and the assistant's text that follows them is what the model needs.
export function conversation(messages: RunAgentInput["messages"]): ChatMessage[] {
  const text: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    if (message.role === "assistant") {
      if (typeof message.content === "string" && message.content) text.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.role !== "user" || typeof message.content !== "string") {
      throw new ChatError("request", "unsupported_message", "Only text messages are supported; system messages and attachments are not.", 400);
    }
    text.push({ role: "user", content: message.content });
  }
  const valid = conversationSchema.safeParse(text);
  if (!valid.success || text.at(-1)?.role !== "user") {
    throw new ChatError("request", "invalid_messages", "Send 1-40 text messages of up to 16,000 characters, ending with your message.", 400);
  }
  return valid.data;
}

function showError(subscriber: Subscriber<BaseEvent>, messageId: string, text: string) {
  subscriber.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
  subscriber.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: `⚠️ ${text}` });
  subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId });
}

export class GatewayAgent extends AbstractAgent {
  private cancellation?: AbortController;

  constructor(private context: InvocationContext) {
    super({ agentId, description: "Answers with the MCP tools the gateway allows." });
  }

  override clone(): GatewayAgent {
    const copy: GatewayAgent = super.clone();
    copy.context = this.context;
    copy.cancellation = undefined;
    return copy;
  }

  override abortRun(): void {
    this.cancellation?.abort();
  }

  // The one difference between the gateways: who runs the MCP tools.
  private events(messages: ChatMessage[], signal: AbortSignal, runId: string): AsyncGenerator<BaseEvent> {
    const { config, gatewayToken, fetchImpl, connectMcp } = this.context;
    if (config.CHAT_GATEWAY === "apim") {
      return runToolLoop({ config, messages, gatewayToken, signal, runId, fetchImpl, connectMcp });
    }
    return toAgUiEvents(streamLiteLLM({ config, messages, signal, gatewayToken, fetchImpl }), runId);
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      const controller = new AbortController();
      this.cancellation = controller;
      const signal = AbortSignal.any([controller.signal, this.context.signal]);
      const finish = () => subscriber.complete();
      signal.addEventListener("abort", finish, { once: true });
      const { threadId, runId } = input;
      const { config, requestId, userId } = this.context;
      const telemetry = new RunTelemetry({ requestId, userId, model: config.CHAT_MODEL });
      subscriber.next({ type: EventType.RUN_STARTED, threadId, runId });
      const execute = async () => {
        if (input.tools.length) throw new ChatError("request", "unsupported_tools", "The chat does not accept tools from the browser.", 400);
        for await (const event of this.events(conversation(input.messages), signal, runId)) {
          signal.throwIfAborted();
          telemetry.observe(event);
          subscriber.next(event);
        }
        subscriber.next({ type: EventType.RUN_FINISHED, threadId, runId });
      };
      // Two callbacks rather than then().catch(): the run's span ends exactly once.
      telemetry.within(execute).then(() => {
        telemetry.end("completed");
        subscriber.complete();
      }, (error: unknown) => {
        if (subscriber.closed || signal.aborted) {
          telemetry.end("cancelled");
          subscriber.complete();
          return;
        }
        const { body } = reportError(error, requestId);
        telemetry.fail(body.error.stage, body.error.code);
        const text = `${body.error.message} Request: ${body.error.requestId}`;
        // CopilotChat does not display RUN_ERROR, and blocked calls are what the demos show.
        showError(subscriber, `${runId}-error`, text);
        subscriber.next({ type: EventType.RUN_ERROR, message: text, code: `${body.error.stage}:${body.error.code}` });
        subscriber.complete();
      });
      return () => {
        signal.removeEventListener("abort", finish);
        controller.abort();
        if (this.cancellation === controller) this.cancellation = undefined;
      };
    });
  }
}
