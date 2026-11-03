"use client";
// Shows one MCP tool call in the chat: the tool, its arguments, and its result or error.

import { defineToolCallRenderer } from "@copilotkit/react-core/v2";
import { decodeToolResult } from "@/lib/tool-result";

function ToolCallCard({ name, args, result }: { name: string; args: unknown; result?: string }) {
  const outcome = result === undefined ? undefined : decodeToolResult(result);
  const status = !outcome ? "running" : outcome.outcome === "error" ? "failed" : "done";
  // Details for checking what the gateway ran: one folded line under the reply; errors open, to stand out.
  return <details className={`tool-call tool-call-${status}`} open={status === "failed"}
    role={status === "failed" ? "alert" : undefined}>
    <summary><span className="tool-call-name">{name}</span> <span className="tool-call-status">{status}</span></summary>
    <pre aria-label="Arguments">{JSON.stringify(args, null, 2)}</pre>
    {outcome && <pre aria-label={status === "failed" ? "Error" : "Result"}>{outcome.output}</pre>}
  </details>;
}

// "*" renders every tool call, whatever the MCP server: the gateway decides which tools exist.
export const toolCallRenderer = defineToolCallRenderer({
  name: "*",
  render: ({ name, args, result }) => <ToolCallCard name={name} args={args} result={result} />,
});
