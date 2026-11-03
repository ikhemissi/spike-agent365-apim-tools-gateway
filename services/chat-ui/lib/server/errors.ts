// Errors the chat can explain to the user, and the one place that turns any error into a safe response.
// Only the stage and code are logged: never tokens, keys or message contents.

export class ChatError extends Error {
  constructor(
    public readonly stage: "authentication" | "gateway" | "request",
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
  }
}

export function reportError(error: unknown, requestId: string) {
  const known = error instanceof ChatError;
  const code = known ? error.code : "internal_error";
  const stage = known ? error.stage : "request";
  console.error(JSON.stringify({ requestId, stage, code }));
  return {
    status: known ? error.status : 500,
    body: {
      error: {
        stage, code, requestId,
        message: known ? error.message : "The chat could not complete the request. Check the server configuration.",
      },
    },
  };
}

// LiteLLM's messages explain refusals well, but some echo a masked key and the key's hash,
// and a guardrail message could echo the user's token (a JWT: three base64url parts starting with "eyJ").
export function redactGatewayText(text: string, maxLength = 400): string {
  const redacted = text
    .replace(/eyJ[\w-]*\.[\w-]*\.[\w-]*/g, "…")
    .replace(/sk-[^\s,"']*/g, "sk-…")
    .replace(/\b[0-9a-f]{32,}\b/gi, "…")
    .replace(/Bearer\s+\S+/gi, "Bearer …");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}
