# 05 — Re-provisioning while blocked, and discovery of a new server

**Date:** 2026-11-03 · **Answers:** Q4, Q1, Q2 · **Versions:** see [00](00-environment.md); Microsoft 365 admin center Agents > Tools (preview, November 2026); azd 1.37, azapi ~> 2.13

## Goal

Three checks on Standard v2, with the spike's own deployment tooling rather than raw API calls as in
[01](01-proof-on-public-servers.md):

1. The connection after a pause: "Team notes" listed, and a block and an unblock applied as in
   [02](02-block-and-unblock.md).
2. Does re-provisioning the layer that registers the MCP server (`azd provision apim-mcp`) keep a block?
3. How fast does Agent 365 list an MCP server added to API Management?

## Setup

- The environment of [00](00-environment.md), with the drift of [03](03-drift.md) still deployed (four notes tools).
- The notes API had been deleted and recreated earlier in the day, so it had no `accessState` (not blocked).
- `src/02_probe.py` every 5 s as the deployer ([assets/05-probe.log](assets/05-probe.log)).
- Times are UTC+1 (local) in the probe log and UTC in Azure's activity log.

## Steps

1. Block "Team notes" in Agents > Tools; watch the probe and the API's `accessState`.
2. Change the notes API's description in `infra/apim-mcp/main.tf`; `azd provision apim-mcp --preview` (the API
   updated in place, not replaced), then `azd provision apim-mcp`; read `accessState`, watch the probe; look at the
   server in the admin center.
3. Unblock it; watch the probe.
4. Add Microsoft Learn's public MCP server to the same layer (a backend, an MCP API `learn` named "Microsoft Learn
   docs", the same user-token policy), `azd provision apim-mcp` after a preview; refresh Agents > Tools until it
   appears.

## Result

**Block** (step 1): Agent 365 wrote the API at 20:17:57 UTC (activity log, Agent 365's service principal); the probe's
last success started at 21:17:58 local and the next round was refused at 21:18:03 on `tools/list`, after its
`initialize` had passed: about **6 s** after the write. Every round from then on was refused on `initialize` (HTTP
200, JSON-RPC `-32000`, `AccessBlockedByGateway`).

**Re-provisioning while blocked** (step 2): the plan changed the API in place (the description) and rewrote its
policy; the apply (21:19:33–21:20:00 local) sent the API's full definition, without `accessState`, at 20:19:55 UTC.
Afterwards `accessState` still read **`blocked`**, the description was the new one, and all 19 probe rounds from
21:19:34 to 21:21:05 were refused. The admin center still showed the server as **Blocked**. Its description field read
"No description provided.", as for the new server below, whose API also has a description.

**Unblock** (step 3): Agent 365 wrote the API at 20:24:05 UTC; the last refusal was at 21:24:13 local and the first
success at 21:24:19: within **8–14 s**. `accessState` read `active`.

**Discovery** (step 4): the API `learn` was created at 20:26:25 UTC; "Microsoft Learn docs" was listed at the first
refresh, at 21:27 local: within about **1 minute**, as **Available**, with the API Management instance as publisher and
no tools. Through the gateway, the server answered `initialize` with the user's token and 401 without it.

## Conclusion

On Standard v2 with azd and azapi, re-provisioning the layer that registers an MCP server keeps Agent 365's block: the
layer never sets `accessState`, and an in-place update leaves it as it is (only a replacement starts unblocked, see
[01](01-proof-on-public-servers.md)). Block and unblock applied within seconds, as before, and a server added to API
Management was listed within about a minute while the admin was on the Tools page.
