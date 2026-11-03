# Governing API Management MCP servers with Agent 365

**Question:** When an Azure API Management gateway is connected to Agent 365, what is actually governed: which calls a block stops and how fast, at what granularity, how new or changed MCP servers are noticed, with which identity and permissions, which controls we have in Agent 365, and with which audit records?

**Time box:** 2 days · **Status:** first findings — see [the findings](docs/FINDINGS.md) · **Variant:** the same question with a LiteLLM gateway, in [spike-agent365-litellm-tools-gateway](https://github.com/ikhemissi/spike-agent365-litellm-tools-gateway)

## The setup

A chat app signs the user in with Entra ID and runs the agent's tool loop on its server: it calls the model and the
MCP server **through Azure API Management, with the user's own token**. API Management checks that token on every
call, then calls the Foundry model and the notes MCP server with its managed identity; the notes server accepts no
other caller. Agent 365 is connected to Azure by a tenant consent: it lists the MCP servers registered in API
Management, and an administrator blocks or unblocks them from the Microsoft 365 admin center. No keys: user tokens
and managed identities only.

```mermaid
flowchart LR
    user(["User"]) -->|"Entra sign-in"| chat

    subgraph azure["Azure"]
        chat["Chat UI<br/>(agent: runs the tool loop)"]
        subgraph apim["API Management Standard v2"]
            models["/openai/v1<br/>model API"]
            notesApi["/notes<br/>MCP server (pass-through)"]
        end
        model["Foundry model<br/>gpt-6-luna"]
        notes["Notes MCP server<br/>(accepts only API Management)"]
        logs[("Log Analytics<br/>Application Insights")]
    end

    subgraph m365["Microsoft 365"]
        admin(["Administrator"]) --> a365["Agent 365<br/>admin center: Agents > Tools"]
        defender["Defender XDR"]
    end

    chat -->|"user's token"| models
    chat -->|"user's token"| notesApi
    models -->|"managed identity"| model
    notesApi -->|"managed identity"| notes
    a365 -->|"Azure role from the consent:<br/>reads the APIs, writes accessState"| apim
    a365 -.->|"admin actions"| defender
    apim -.->|"gateway logs"| logs
    chat -.->|"user and tool spans"| logs
```

| Component | Where | Role |
|---|---|---|
| Chat UI | `services/chat-ui`, `infra/chat-ui` | Signs the user in; runs the tool loop (model → tool calls → MCP → model) with the user's token |
| API Management | `infra/apim-gateway` | The gateway: validates the user's token, calls the model and the MCP servers with its managed identity |
| MCP server registration | `infra/apim-mcp` (the spike's own layer) | Registers the notes server in API Management as a pass-through MCP API |
| Notes MCP server | `services/notes-mcp`, `infra/notes-mcp` | Three tools (`add_note`, `list_notes`, `count_notes`) on Container Apps |
| Foundry model | `infra/foundry-model` | The model the chat uses |
| Agent 365 | Microsoft 365 admin center | Lists the gateway's MCP servers; blocks and unblocks them |

## Key findings

What a block does, end to end ([02](docs/experiments/02-block-and-unblock.md)):

```mermaid
sequenceDiagram
    actor Admin as Administrator
    participant A365 as Agent 365
    participant APIM as API Management
    participant Client as Chat UI or any MCP client

    Admin->>A365: Block "Team notes"
    A365->>APIM: write the API: accessState = blocked
    Note over APIM: enforced within 4–8 s, for every client
    Client->>APIM: initialize (user's token)
    APIM-->>Client: HTTP 200, JSON-RPC -32000 AccessBlockedByGateway
    Admin->>A365: Unblock
    A365->>APIM: accessState = active
    Note over APIM: calls work again within about 10 s
```

| Question | Finding |
|---|---|
| Discovery | MCP servers listed within 5 minutes of the consent, without any action; new servers appear on their own |
| Enforcement | A block is one property of the API (`accessState`), enforced by API Management within 4–8 s for every client |
| Granularity | Per server on Standard v2; tool-level control is a capability of the AI Gateway tier |
| Drift | A changed or added tool is served at once (the chat used a new `delete_note` tool); block the server to stop it |
| Re-deployment | Re-applying the API's definition keeps the block; a deleted and recreated API starts unblocked |
| Identity | The consent grants an Azure role at the tenant root management group (read API Management, write APIs); the user's token is checked at the gateway, API Management's identity reaches the MCP server |
| Audit | Activity log (each block, by Agent 365), Defender (the administrator), gateway logs (each MCP request), the app's telemetry (user and tool) |
| Compared with LiteLLM | The same per-server block within seconds, with no gateway key to hold; LiteLLM adds per-tool toggles and, with its guardrail, a Defender record of every tool call |

The answers to every question, with the evidence and the open points: **[docs/FINDINGS.md](docs/FINDINGS.md)**.

## Documents

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
