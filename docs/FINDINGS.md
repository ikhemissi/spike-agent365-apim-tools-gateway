# Findings — Governing API Management MCP servers with Agent 365

**Date:** 2026-11-03 · **Versions tested:** Microsoft 365 admin center, Agents > Settings > Gateways and Agents > Tools (preview, November 2026); Azure API Management Standard v2 (management API 2024-06-01-preview and 2025-09-01-preview); MCP Python SDK 2.3.0; MCP TypeScript SDK 1.32.2; model gpt-6-luna

**Status:** first findings; the open points are listed at the end.

## Summary

Connecting Agent 365 to Azure is a tenant consent: it assigns Agent 365's service principal an Azure role that reads
API Management instances and writes their APIs, at the tenant root management group. Agent 365 then lists the MCP
servers registered in API Management without further action (within 5 minutes in this spike). A **Block** sets one
property of the API, `accessState: blocked`, which API Management enforces within 4–8 seconds for every client: the
caller gets HTTP 200 with the JSON-RPC error `-32000` `AccessBlockedByGateway`, already on `initialize`; an unblock
restores access within about 10 seconds. On Standard v2, governance is **per server**: a changed or added tool is
served at once, so block the server to stop it; tool-level control is a capability of the AI Gateway tier. Every call
carries the user's own Entra token, checked at the gateway, and API Management calls the model and the MCP server with
its managed identity: no keys anywhere. The block lives in API Management: a routine re-deployment keeps it, a
replaced API starts unblocked, and anyone with write access to the API can change it.

## Answers

### Q1 — Discovery

Agent 365 listed the API Management MCP servers within 5 minutes of the consent, by reading the APIs and backends
(activity log: from 4.5 minutes after the consent, then every 1–3 minutes); a server added later appeared without any
action (within 28 minutes, not timed closer). Each server shows the API's display name, with the API Management
instance as publisher and source; on Standard v2 no tools are shown, and governance is per server. Give each server a
distinct display name, so that administrators pick the right one at a glance.
([01](experiments/01-proof-on-public-servers.md), [02](experiments/02-block-and-unblock.md))

### Q2 — Enforcement

A block writes `accessState: blocked` on the API (one `apis/write`), and API Management refused the next request
within 4 s (8 s in the proof). Every client is refused, at the first MCP request: HTTP 200 with the JSON-RPC error
`-32000` "Access to MCP server 'notes' is blocked." (`AccessBlockedByGateway`). The chat shows the error and the model
gets no notes tools; in a conversation that already read notes, the model can still repeat them, so a block stops new
tool calls, not what is already in a conversation. An unblock sets `accessState: active`; calls worked again within
about 10 s. ([01](experiments/01-proof-on-public-servers.md), [02](experiments/02-block-and-unblock.md))

### Q3 — Granularity

Per server on Standard v2: a block applies to one MCP server (one API), for every caller, and the other servers keep
working. Tool-level control ("static list of allowed tools", tool discovery) is a capability of the AI Gateway tier,
not tested in this spike. ([01](experiments/01-proof-on-public-servers.md), [03](experiments/03-drift.md))

### Q4 — Drift

API Management passes the tool list through from the server: a changed description and a new destructive tool
(`delete_note`) were served as soon as the server's new revision ran, and the chat used the new tool at once. Agent 365
governs the server as a whole on Standard v2, so the way to stop a new tool is to block the server. Outside Agent 365:
re-applying the API's full definition (PUT, as infrastructure-as-code does) kept the block; deleting and recreating
the API gave a new API without the block; an identity with write access to the API set it back to `active`, and the
admin center then showed the live state. ([01](experiments/01-proof-on-public-servers.md), [03](experiments/03-drift.md))

### Q5 — Identity and permissions

The consent assigns the built-in role "A365 Gateway Policy Operator" to the service principal of Microsoft's
Agent365Observability app at the tenant root management group: read API Management instances and their APIs, write
APIs, and read and write tool servers (including AI gateways). Plan it with the tenant's Azure administrators. The
chat sends the user's own Entra token to the gateway, which checks the tenant, the audience and the `Gateway.Use`
scope on the model API and on the MCP API; API Management then calls Foundry and the notes server with its own managed
identity, the only identity the notes server accepts. The user's identity is checked at the gateway and is not passed
on to the MCP server. ([01](experiments/01-proof-on-public-servers.md), [04](experiments/04-identity-and-audit.md))

### Q6 — Runtime controls and audit

| Where | What it records |
|---|---|
| Azure activity log | each block and unblock: an `apis/write` on the API, by Agent 365's service principal |
| Microsoft Defender XDR (`CloudAppEvents`, `ApiEndpointCallEvent`) | each block and unblock: the administrator and the server |
| API Management gateway logs (`GatewayLogs`) | each MCP request: API, operation, caller IP, status, timings, backend call; a refused request has no backend fields |
| The app's telemetry (Application Insights) | each chat run, model call and tool call, with the user and the tool name |

To have the user and the tool name in API Management's own logs, add a policy for it; tool activity observability is
a capability of the AI Gateway tier. ([04](experiments/04-identity-and-audit.md))

### Q7 — Compared with LiteLLM

Same app and MCP server, compared with the [LiteLLM variant](https://github.com/ikhemissi/spike-agent365-litellm-tools-gateway)
of this spike:

| | LiteLLM | API Management Standard v2 |
|---|---|---|
| Connection | the gateway URL and a LiteLLM `proxy_admin` key, held by Agent 365 | a tenant consent: an Azure role on API Management |
| Where a block lives | the server's tool allowlist in LiteLLM (empty, enforced) | the API's `accessState` |
| Time to apply | about 2 s | 4–8 s |
| What a caller gets | the tool call refused ("Tool … is not allowed") | HTTP 200, JSON-RPC `-32000` `AccessBlockedByGateway` on `initialize` |
| Granularity | per server; per tool once under an enforced allowlist | per server; per tool with the AI Gateway tier |
| New or changed tool | a new tool is refused under an enforced allowlist until enabled | served at once; block the server to stop it |
| User identity | the user's token is sent to Agent 365 by the guardrail (On-Behalf-Of) | the user's token is checked at the gateway |
| Tool-call records | a Defender record per tool call (user, tool, server), +0.4–1.4 s per call | gateway logs per request; user and tool in the app's telemetry |
| Credentials to protect | the `proxy_admin` key; the gateway app's client secret (On-Behalf-Of) | none: user tokens and managed identities |

## What we would do differently

- Give every MCP server a distinct display name before connecting Agent 365.
- Block a replaced API again after a forced replacement, and limit write access to API Management's APIs: both
  change the block.
- Open points: re-provisioning the spike's `apim-mcp` layer with azd while the server is blocked; the exact discovery
  time of a new server; the AI Gateway tier (tool-level control and tool observability).
