# Questions

The main question: when an Azure API Management gateway is connected to Agent 365, what is actually governed: which calls a block stops and how fast, at what granularity, how new or changed MCP servers are noticed, with which identity and permissions, which controls we have in Agent 365, and with which audit records? Split into:

| # | Question | Experiments | Status |
|---|---|---|---|
| Q1 | **Discovery:** what does Agent 365 show from API Management (servers, tools), and how fast does a newly registered server appear? | 01, 02, 05 | answered |
| Q2 | **Enforcement:** what does a block in the Microsoft 365 admin center change in API Management, which clients does it stop (the chat UI, a direct MCP client), how long does it take, and what does the caller receive? | 01, 02, 05 | answered |
| Q3 | **Granularity:** per server or per tool, on the Standard v2 tier? What would the AI Gateway tier add? | 01, 02 | partly answered |
| Q4 | **Drift:** when an approved MCP server changes or adds tools, is it noticed, flagged or re-approved? Does anything outside Agent 365 (a re-deployment, an Azure administrator) undo a block, and does Agent 365 notice? | 01, 03, 05 | answered |
| Q5 | **Identity and permissions:** what does the tenant consent grant Agent 365, and on what scope? Does the user's identity reach the gateway and the MCP servers? | 01, 04 | answered |
| Q6 | **Runtime controls and audit:** which records exist for a block and for tool calls (Agent 365, Azure activity log, API Management logs, the app's telemetry), and what do they name? | 01, 04 | answered |
| Q7 | **Compared with LiteLLM:** where does each gateway put the control, the identity and the audit, for the same app and MCP server? | the findings of both spikes | answered |

Status: `open`, `answered`, `partly answered`, `unanswered` (with what blocked it).

## References

- Microsoft Learn, "Manage Tools Gateway in Microsoft 365 admin center" (preview).
- Microsoft Learn, "Govern tools with Microsoft Agent 365 and Azure API Management (preview)".
- Microsoft Learn, "Connect and govern an existing MCP server" (Azure API Management).
- The LiteLLM variant of this spike: `ikhemissi/spike-agent365-litellm-tools-gateway` (its findings).
