# Experiments

Numbered in the order they run; never renumbered. Copy [TEMPLATE.md](TEMPLATE.md) to `NN-<slug>.md`.

| # | Experiment | Questions | Result |
|---|---|---|---|
| 00 | [Environment](00-environment.md) | — | All layers up; model and MCP through API Management with the user's token; the chat runs the tool loop end to end |
| 01 | [Proof: Agent 365 governing API Management MCP servers](01-proof-on-public-servers.md) | Q1–Q6 | Per-server block in ~8 s via the API's `accessState`; the consent assigns a role at the tenant root management group; the block is a property of the API in API Management |
| 02 | [Block and unblock the notes server from Agent 365](02-block-and-unblock.md) | Q1, Q2, Q3 | Block applied within 4 s, refused on initialize; the chat shows it; earlier results stay in the conversation |
| 03 | [Drift: a changed and an added tool](03-drift.md) | Q4, Q3 | Governance on Standard v2 is per server: a changed and an added tool were served at once, and the chat used the new destructive tool; tool-level control is an AI Gateway tier capability |
| 04 | [Identity and audit](04-identity-and-audit.md) | Q5, Q6 | The user's token is checked at the gateway on every call; the gateway logs record each MCP request, the app's telemetry the user and the tool names, the activity log Agent 365's writes |
