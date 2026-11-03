// The result of a tool call as the chat shows it. The server writes it into AG-UI's TOOL_CALL_RESULT content,
// and the page reads it back, so that a failed or refused tool call is shown as an error.

export interface ToolResult {
  outcome: "ok" | "error";
  output: string;
}

export function encodeToolResult(result: ToolResult): string {
  return JSON.stringify(result);
}

export function decodeToolResult(content: string): ToolResult {
  try {
    const parsed = JSON.parse(content);
    if ((parsed?.outcome === "ok" || parsed?.outcome === "error") && typeof parsed.output === "string") {
      return { outcome: parsed.outcome, output: parsed.output };
    }
  } catch {
    // Not written by this app's server: show it as it is.
  }
  return { outcome: "ok", output: content };
}
