# 02 — Block and unblock the notes server from Agent 365

**Date:** 2026-11-03 · **Answers:** Q1, Q2, Q3 · **Versions:** see [00](00-environment.md); Microsoft 365 admin center Agents > Tools (preview, November 2026)

## Goal

On the real setup (the chat UI running the tool loop, the notes MCP server behind API Management, every call as the
signed-in user), check what Agent 365 shows and what a block and an unblock do: to a direct MCP client, to the chat,
and how fast. Experiment [01](01-proof-on-public-servers.md) did the same on public servers.

## Setup

- The environment of [00](00-environment.md); Agent 365 connected to Azure since experiment 01 (tenant consent).
- `src/02_probe.py`: every 5 s, as the deployer (Azure CLI token for the gateway), `initialize`, `tools/list` and
  `list_notes` through `<gateway>/notes`; one line per round in [assets/02-probe.log](assets/02-probe.log).

## Steps

1. Look for the notes server in Agents > Tools.
2. Block it; ask the chat "List the notes." in the same conversation as before, then in a new one.
3. Unblock it.

## Result

- **Discovery:** "Team notes" (the API's display name) was listed after a refresh, without any action: **Active**,
  publisher = the API Management instance's name, no tools ("doesn't support tool discovery", as on Standard v2 in 01).
- **Block:** Agent 365 wrote the API (`apis/write`) at 17:14:45; the probe's last success started at 17:14:44 and its
  next round, at 17:14:49, was refused: **within 4 s**. Every round from then on is refused on `initialize`, with HTTP
  200 and the JSON-RPC error `-32000` "Access to MCP server 'notes' is blocked." (`AccessBlockedByGateway`).
  `accessState` read `blocked`. Azure's activity log records the write by Agent 365's service principal.
- **The chat while blocked:** the chat shows an error line `notes (connect)` with "MCP error -32000: Access to MCP
  server 'notes' is blocked."; the model gets no notes tools.
  - In the **same conversation** as an earlier "list the notes", the answer **still listed the two notes**: the
    model repeated what it had read in an earlier turn. A block stops new tool calls, not what is already in the
    conversation.
  - In a **new conversation**: "I can't access the notes tool in this chat."
- **Unblock:** last refusal 17:21:06, first success 17:21:13 (the admin's click about 17:20–17:21); `accessState`
  back to `active`.

## Conclusion

The block behaves as in the proof with the real app: per server, applied within seconds by API Management, refused
at the very first MCP request, and the chat shows it clearly. Two things a governance story must say: data already
returned to the model stays in that conversation (the model can repeat it), and the server's tools are only removed
from new runs. On Standard v2, governance is per server; tool-level control is a capability of the AI Gateway tier.
