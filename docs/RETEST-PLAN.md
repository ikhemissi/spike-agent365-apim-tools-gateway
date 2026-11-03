# Retest plan

What to run again when a product, an SDK or a policy changes, so that the findings stay true.

| Experiment | Retest when | How | Last run |
|---|---|---|---|
| [01](experiments/01-proof-on-public-servers.md) Proof | The Agent 365 gateway connection or its Azure role changes | Consent, then read the role assignment and its actions; block and unblock a public server | 2026-11-03 |
| [02](experiments/02-block-and-unblock.md) Block and unblock | The Tools page or API Management's MCP support changes | `src/02_probe.py` while blocking and unblocking; the chat in the same and in a new conversation | 2026-11-03 |
| [03](experiments/03-drift.md) Drift | The AI Gateway tier is generally available | The same drift on that tier: are tools shown, is a new tool held until approved? | 2026-11-03 |
| [04](experiments/04-identity-and-audit.md) Identity and audit | Logging or Defender records change | The same queries on the gateway logs, the app's telemetry, the activity log and Defender | 2026-11-03 |
| [05](experiments/05-redeploy-and-discovery.md) Re-provisioning and discovery | azapi, the API version or the AI Gateway tier changes | Block, `azd provision apim-mcp` with a changed description, read `accessState`; add a server and time its listing | 2026-11-03 |
