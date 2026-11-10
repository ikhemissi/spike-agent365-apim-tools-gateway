// One streamed call to a gateway's Responses API (LiteLLM or API Management): posts the request, turns a refusal
// before the stream into a ChatError, and yields the streamed events. Each call is one client span.
import { z } from "zod";
import { ChatError, redactGatewayText } from "./errors";
import { endGatewaySpan, startGatewaySpan } from "./telemetry";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const itemSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  arguments: z.string().optional(),
  // A function_call item's id for its function_call_output (API Management mode).
  call_id: z.string().optional(),
  output: z.string().nullish(),
  error: z.unknown().optional(),
}).passthrough();

const eventSchema = z.object({
  type: z.string(),
  delta: z.unknown().optional(),
  item_id: z.string().optional(),
  item: itemSchema.optional(),
  message: z.string().optional(),
  error: z.object({ message: z.string().optional(), code: z.string().nullish() }).passthrough().nullish(),
  response: z.object({
    // The next round's previous_response_id (API Management mode).
    id: z.string().optional(),
    status: z.string().optional(),
    error: z.object({ message: z.string().optional() }).passthrough().nullish(),
  }).passthrough().optional(),
}).passthrough();

export type ResponsesItem = z.infer<typeof itemSchema>;
export type ResponsesEvent = z.infer<typeof eventSchema>;

const maxEventSize = 1_048_576;

// Server-sent events: yields the data of each event; the gateway sends one JSON object per event and maybe a final [DONE].
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (!line && data.length) {
          yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (buffer.length + data.join("").length > maxEventSize) {
        throw new ChatError("gateway", "invalid_stream", "The gateway sent an oversized stream event.");
      }
      if (done) break;
    }
    if (data.length) yield data.join("\n");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function refusal(response: Response): Promise<ChatError> {
  let detail = "";
  try {
    const body = await response.json();
    detail = [body?.error?.type, body?.error?.message].filter((part) => typeof part === "string").join(": ");
    // API Management's own refusals (validate-jwt, rate limits) are {statusCode, message}, without an error object.
    if (!body?.error && typeof body?.message === "string") detail = body.message;
  } catch {
    // Not every refusal has a JSON body; the status alone still explains it.
  }
  const reason = detail ? ` ${redactGatewayText(detail)}` : "";
  return new ChatError("gateway", "gateway_refused", `The gateway refused the request (HTTP ${response.status}).${reason}`);
}

export async function* streamResponses({
  url, model, headers, body, signal, fetchImpl = fetch, onResponseHeaders,
}: {
  url: string; model: string; headers: Record<string, string>; body: Record<string, unknown>;
  signal: AbortSignal; fetchImpl?: typeof fetch;
  // Foundry mode reads the hosted agent's session id from the response headers.
  onResponseHeaders?: (headers: Headers) => void;
}): AsyncGenerator<ResponsesEvent> {
  // The span lasts until the stream ends: with LiteLLM, it runs the model and the MCP tools while it streams.
  const span = startGatewaySpan(url, model, headers);
  let status: number | undefined;
  let failure: { stage: string; code: string } | undefined;
  try {
    const response = await fetchImpl(url, {
      method: "POST", redirect: "error", headers, body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    });
    status = response.status;
    if (!response.ok) throw await refusal(response);
    onResponseHeaders?.(response.headers);
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body?.cancel();
      throw new ChatError("gateway", "invalid_response", "The gateway did not return a Responses event stream.");
    }
    for await (const data of sseData(response.body)) {
      if (data === "[DONE]") return;
      let event;
      try {
        event = eventSchema.parse(JSON.parse(data));
      } catch {
        throw new ChatError("gateway", "invalid_stream", "The gateway sent an invalid Responses event.");
      }
      yield event;
    }
  } catch (error) {
    // A cancelled chat is not a gateway failure.
    if (!signal.aborted) failure = error instanceof ChatError ? error : { stage: "gateway", code: "request_failed" };
    throw error;
  } finally {
    endGatewaySpan(span, status, failure);
  }
}
