# 04 — Identity and audit

**Date:** 2026-11-03 · **Answers:** Q5, Q6 · **Versions:** see [00](00-environment.md)

## Goal

For the chat's tool calls and the administrator's block and unblock in [02](02-block-and-unblock.md) and
[03](03-drift.md): which records exist, where, and whom do they name? Does the user's identity reach the gateway
and the MCP server?

## Setup

The environment of [00](00-environment.md), with API Management's gateway logs sent to Log Analytics (diagnostic
setting, `AzureDiagnostics` table, category `GatewayLogs`), the chat UI's OpenTelemetry in Application Insights, and
Agent 365 connected to Azure (experiment [01](01-proof-on-public-servers.md)).

## Steps

1. Query the gateway logs and Application Insights for the period of experiments 02 and 03.
2. Read Azure's activity log for the block and the unblock.

## Result

**Identity on the way:**

- The chat sends the user's own token for the gateway; API Management checks it (tenant, audience, `Gateway.Use`) on
  the model API and on the MCP API, and calls Foundry and the notes server with **its own** managed identity. The
  notes server receives API Management's identity, the only one it accepts.

**Records of the tool calls:**

| Where | What it records |
|---|---|
| API Management gateway logs (`AzureDiagnostics`, `GatewayLogs`) | each MCP request: API `notes`, type `mcp`, operation `passThroughMcp`, caller IP, user agent, status, sizes, timings, backend URL and status |
| Chat UI telemetry (Application Insights) | one span per chat run, one per model call, one per `MCP tools/call <tool>`, with the user (`enduser.id`), the tool names, counts and errors |

- A request refused by a block reaches no backend: its gateway log entry has no backend fields.

**Records of the administrator's actions:**

- Azure's activity log: an `apis/write` on the API at the block (16:14:45 UTC) and at the unblock (about 16:21 UTC),
  by **Agent 365's service principal**.
- Microsoft Defender XDR (Advanced Hunting, `CloudAppEvents`): one `ApiEndpointCallEvent` record per admin action
  (16:14:45 and 16:21:04 UTC), naming **the administrator** and the server
  (`PATCH …/services/<apim>/mcpservers/notes/access/all`). The new state (blocked or active) is read from the activity
  log or from the API's `accessState`.

## Conclusion

The user's token is checked at the gateway on every call, and API Management calls the model and the notes server with
its own identity. API Management's gateway logs record each MCP request (API, operation, caller IP, status, timings,
backend call), the chat UI's telemetry records the user and the tool names, Azure's activity log records Agent
365's write to the API at each block and unblock, and Defender records the administrator who made each change. To add the user (`oid`) and the JSON-RPC method or tool name to API
Management's logs, add a policy for it (e.g. `trace` or `log-to-eventhub`); "tool activity observability" is a
capability of the AI Gateway tier.
