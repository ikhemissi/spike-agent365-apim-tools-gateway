# 01 — Proof: Agent 365 governing API Management MCP servers

**Date:** 2026-11-03 · **Answers:** Q1–Q6 (first pass) · **Versions:** Microsoft 365 admin center, Agents > Settings > Gateways and Agents > Tools (preview, November 2026); Azure API Management Standard v2 (management API 2024-06-01-preview and 2025-09-01-preview); MCP Python SDK 2.3.0

## Goal

Before building the real environment, prove how Agent 365 governs MCP servers registered in API Management: what the
connection grants, how servers are discovered, what a block changes, how fast it applies, what callers receive, and
what is recorded. Done with throwaway resources made with the Azure CLI, not the spike's layers.

## Setup

- One API Management instance, Standard v2, one unit, in France Central (about 1.5 minutes to create; created through
  the ARM API).
- Three MCP servers in it, all passing through to Microsoft Learn's public MCP server (`https://learn.microsoft.com/api/mcp`):
  `learn`, `learn-two` (to check that a block stays per server), and `learn-three` (added later, for discovery). No
  subscription key (the backend is public).
- A probe (MCP Python SDK) every 5 seconds per server: initialize, list tools, call `microsoft_docs_search`.

## Steps

1. Register the MCP servers in API Management.
2. Connect Agent 365 to Azure (admin center, Global Administrator): Agents > Settings > Gateways > Microsoft Azure.
3. Watch Agents > Tools for the servers; block `learn`, then unblock it; read what changed in API Management.
4. Add `learn-three`; block it; re-apply its definition as infrastructure-as-code would; set `accessState` from Azure;
   delete and recreate a blocked API.

## Result

**Registering an existing MCP server** (the working form on Standard v2):

- A `Microsoft.ApiManagement/service/backends` resource with the server's full MCP URL, and a
  `Microsoft.ApiManagement/service/apis` resource with `type: "mcp"`, `backendId`, and `mcpProperties.transportType:
  "streamable"`, without endpoints. The MCP endpoint is the API path itself: `https://<apim>.azure-api.net/learn`.
- A definition with `serviceUrl` and `mcpProperties.endpoints` (an object) behaves differently: API Management
  answers `initialize` itself (`serverInfo: Azure API Management`) and lists no tools. For a pass-through to an
  existing server, use `backendId` as above.
- Through API Management, the three Learn tools are listed and a call takes about 1.5–2.5 s.

**Connection (consent):**

- The admin center shows a check box ("I have reviewed the information access requirements of this gateway and I
  consent to its use.") and a toggle "Azure API Management service and Azure AI Gateway".
- Within the same minute, a role assignment appears: built-in role **"A365 Gateway Policy Operator"**, at the
  **tenant root management group**, for the service principal of Microsoft's app **Agent365Observability**.
- The role's actions: `Microsoft.ApiManagement/service/read`, `service/apis/read`, **`service/apis/write`**,
  `service/workspaces/toolServers/read|write`, `aigateways/read`, `aigateways/workspaces/toolServers/read|write`.
  At that scope, the role covers reading and writing the APIs of every API Management instance in the tenant: plan
  the consent with the tenant's Azure administrators.

**Discovery:**

- The servers were listed at the first check, 5 minutes after the consent. Azure's activity log shows Agent 365
  reading APIs and backends from 4.5 minutes after the consent, then every 1–3 minutes.
- Publisher and source are the API Management instance's name.
- Each server's page reads: "This server doesn't support tool discovery. You can still take governance actions at
  the server level." On Standard v2, governance is per server; tool-level control is a capability of the AI Gateway
  tier.
- A server added later (`learn-three`) appeared without any action (within 28 minutes; not timed closer).
- The three display names ("Learn docs", "… (second)", "… (third)") are close to each other, and one block was
  applied to a different server than intended: give each server a distinct display name.

**Block and unblock:**

- Block writes one property of the API, **`accessState: "blocked"`** (one `apis/write` in the activity log); read it
  with management API 2025-09-01-preview. The API's policies stay as they are.
- The block applied within about **8 seconds** of the write (last success 11:55:18, first refusal 11:55:26).
- Callers get **HTTP 200** with a JSON-RPC error, already on `initialize`:

  ```json
  {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Access to MCP server 'learn' is blocked.",
   "data":{"code":"AccessBlockedByGateway","target":"learn","correlationId":"…"}}}
  ```

- The other servers kept working. Unblock set `accessState: "active"`; calls worked again within about 10 seconds.
- `accessState` appears on an API when Agent 365 first writes it.

**Re-deployment, setting the state from Azure, replacement:**

- Re-applying the blocked API's full definition (PUT, with either management API version, without `accessState`)
  **kept the block**: routine infrastructure-as-code runs leave it in place.
- Deleting and recreating the API (what Terraform does on a forced replacement) gives a new API **without** the
  block: open again after about 15 seconds. Block a replaced API again from the admin center.
- An identity with write access to the API can set `accessState` back to `active`: the block was lifted at once, the
  API was still active 45 minutes later, and the admin center showed the server as **Available** (the live state).
  Grant write access to API Management accordingly.

**Audit of a block:**

- Azure's activity log records the block as an `apis/write` on the API.

## Conclusion

Agent 365 governs API Management MCP servers per server on Standard v2, within seconds, by setting a property of the
API (`accessState`) that API Management enforces. The consent assigns a role with read and write access to APIs at the
tenant root management group, discovery is automatic, and Azure's activity log records each block as a write to the
API. The block lives in API Management: grant write access to its APIs accordingly, and block an API again after
replacing it. Not shown here: the real app and notes server behind the gateway with the user's identity (experiments
02 and on), tool-level control (AI Gateway tier), and tool-call records.
