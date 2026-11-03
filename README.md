# Governing API Management MCP servers with Agent 365

**Question:** When an Azure API Management gateway is connected to Agent 365, what is actually governed: which calls a block stops and how fast, at what granularity, how new or changed MCP servers are noticed, with which identity and permissions, which controls we have in Agent 365, and with which audit records?

**Time box:** 2 days · **Status:** in progress

| Document | Content |
|---|---|
| [Questions](docs/QUESTIONS.md) | What the spike must answer, and the status of each question |
| [Experiments](docs/experiments/README.md) | One file per experiment, numbered |
| [Findings](docs/FINDINGS.md) | The answers, with links to the evidence |
| [Retest plan](docs/RETEST-PLAN.md) | What to run again when a product changes |
| [Demo runbook](docs/DEMO-RUNBOOK.md) | How to show the results |

## Environment

The infrastructure is a set of azd layers (`infra/<layer>/`, one Terraform root each), listed in `azure.yaml` in the order they are provisioned. Each layer's README-level notes are at the top of its `main.tf`.

```bash
az login && azd auth login
azd env new spike-agent365-apim-tools-gateway --location francecentral
azd env set RESOURCE_TAGS "key=value,key=value"   # tags your tenant's policies require, if any
azd hooks run preprovision                        # remote state backend; run it before the preview
azd provision --preview                           # read the plan of every layer before applying
azd provision
```

The gateway is Azure API Management (Standard v2, about $1 an hour while it exists): `azd env get-value APIM_GATEWAY_URL`. Callers present their own Entra token for `APIM_GATEWAY_SCOPE`; it calls the model with its managed identity (`APIM_MODELS_URL`). Register MCP servers in it from a layer of the spike's own (azapi: a `backends` resource with the server's URL, and an `apis` resource of type `mcp` with `backendId` and `mcpProperties.transportType: streamable`); the MCP endpoint is then `<gateway>/<path>`. The notes MCP server accepts only the gateway's identity: give the server's API the policy `<authentication-managed-identity resource="NOTES_MCP_AUDIENCE" />` (the value of that azd variable).

The chat UI (`services/chat-ui`, settings in its README) signs the user in and calls API Management with the user's own token for the model and for the MCP servers listed in `CHAT_UI_MCP_SERVERS` (`label=url,...`, output by the layer that registers them), running the tool loop itself. Then:

```bash
# Optional: what the page shows and tells the model (also CHAT_UI_INTRO and CHAT_UI_INSTRUCTIONS)
azd env set CHAT_UI_TITLE "Governing API Management MCP servers with Agent 365"
azd provision chat-ui --preview && azd provision chat-ui
azd deploy chat-ui            # the first deployment provisions chat-ui again for its port
azd env get-value CHAT_UI_URL
```

Tear it down when the spike ends: `azd down --purge`.

## Run the experiments' code

```bash
uv sync
uv run python src/<script>.py
```
