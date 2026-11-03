// The chat's own OpenTelemetry spans: one per chat run, one per call to the gateway's Responses API and, in API
// Management mode, one per MCP tool call this server makes. They say what a run did
// (outcome, tool calls, refusal codes) and who ran it (the user's object id), never what was said: no prompts,
// answers, tool arguments, tool results or tokens. Without an exporter (tests, local runs) the API records nothing.
import { EventType, type BaseEvent } from "@ag-ui/client";
import { context, propagation, SpanKind, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { decodeToolResult } from "../tool-result";

const tracer = trace.getTracer("chat-ui");

// Tracks one chat run: start it, observe the events sent to the chat, then end it once.
export class RunTelemetry {
  private readonly span: Span;
  private readonly toolNames = new Set<string>();
  private toolCalls = 0;
  private toolErrors = 0;

  constructor({ requestId, userId, model }: { requestId: string; userId: string; model: string }) {
    this.span = tracer.startSpan("chat run", {
      attributes: {
        "chat.request_id": requestId,
        // Application Insights shows it as the authenticated user.
        "enduser.id": userId,
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": model,
      },
    });
  }

  // Runs fn as part of the run, so that the gateway call's span is a child of the run's.
  within<T>(fn: () => T): T {
    return context.with(trace.setSpan(context.active(), this.span), fn);
  }

  observe(event: BaseEvent) {
    if (event.type === EventType.TOOL_CALL_START) {
      this.toolCalls += 1;
      this.toolNames.add((event as BaseEvent & { toolCallName: string }).toolCallName);
    } else if (event.type === EventType.TOOL_CALL_RESULT) {
      if (decodeToolResult((event as BaseEvent & { content: string }).content).outcome === "error") this.toolErrors += 1;
    }
  }

  end(outcome: "completed" | "cancelled") {
    this.span.setAttribute("chat.outcome", outcome);
    this.finish();
  }

  fail(stage: string, code: string) {
    this.span.setAttributes({ "chat.outcome": "failed", "chat.error.stage": stage, "chat.error.code": code });
    this.span.setStatus({ code: SpanStatusCode.ERROR, message: `${stage}:${code}` });
    this.finish();
  }

  private finish() {
    this.span.setAttributes({
      "chat.tool_calls": this.toolCalls,
      "chat.tool_errors": this.toolErrors,
      "chat.tool_names": [...this.toolNames].sort(),
    });
    this.span.end();
  }
}

// A client span for one call to the gateway, whose W3C trace context goes in the request's headers (traceparent),
// so that the gateway's own spans (model, MCP tools, guardrail) join the same trace.
export function startGatewaySpan(url: string, model: string, headers: Record<string, string>): Span {
  const target = new URL(url);
  const span = tracer.startSpan(`POST ${target.pathname}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      "http.request.method": "POST",
      "url.full": target.href,
      "server.address": target.hostname,
      "gen_ai.request.model": model,
    },
  });
  propagation.inject(trace.setSpan(context.active(), span), headers);
  return span;
}

export function endGatewaySpan(span: Span, status?: number, error?: { stage: string; code: string }) {
  if (status !== undefined) span.setAttribute("http.response.status_code", status);
  if (error) {
    span.setAttribute("error.type", error.code);
    span.setStatus({ code: SpanStatusCode.ERROR, message: `${error.stage}:${error.code}` });
  }
  span.end();
}

// A client span for one MCP tool call through the gateway (API Management mode): which server and tool, and whether it
// failed, never the arguments or the result. call runs inside the span, so the MCP client's requests carry its
// traceparent (see mcp-tools.ts).
export async function traceMcpCall<T extends { isError: boolean }>(
  serverLabel: string, toolName: string, call: () => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(`MCP tools/call ${toolName}`, {
    kind: SpanKind.CLIENT,
    attributes: { "chat.mcp.server": serverLabel, "gen_ai.tool.name": toolName },
  });
  try {
    const result = await context.with(trace.setSpan(context.active(), span), call);
    if (result.isError) span.setStatus({ code: SpanStatusCode.ERROR, message: "tool_error" });
    return result;
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: "tool_call_failed" });
    throw error;
  } finally {
    span.end();
  }
}
