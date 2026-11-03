# 00 — Environment

**Date:** 2026-11-03 · **Versions:** Azure API Management Standard v2 (1 unit); Foundry model `gpt-6-luna` (DataZoneStandard); Terraform azurerm ~> 4.81, azuread ~> 3.10, azapi ~> 2.13; azd 1.37; MCP Python SDK 2.3.0; MCP TypeScript SDK 1.32.2; Next.js 16.4

## Goal

Record the environment every experiment runs in, so that results can be compared and retested.

## Setup

| Item | Value |
|---|---|
| Region | francecentral |
| Layers (`azure.yaml`) | `azure-platform`, `foundry-model`, `apim-gateway`, `notes-mcp`, `apim-mcp` (the spike's own: the notes server registered in API Management), `chat-ui` |
| Identities | users of the tenant, with their own Entra token for the gateway's app registration (scope `Gateway.Use`); API Management's system-assigned managed identity ("Foundry User" on the Foundry account; the only caller the notes server accepts); the notes server's managed identity (its storage table); the chat UI's managed identity (telemetry only) |
| Keys | none: no subscription keys, no LiteLLM-style team key, storage and Foundry keys disabled |
| Products and versions | see the line above |

```text
browser (MSAL: one sign-in, consent for the chat and the gateway)
  ──user token (chat)──▶ chat UI server ──user token (gateway)──▶ API Management
      /openai/v1/responses ──API Management's identity──▶ Foundry model
      /notes (MCP)          ──API Management's identity──▶ notes MCP server (accepts only that identity)
  the chat UI server runs the tool loop: model → function calls → MCP tools/call → results → model
```

## Steps

1. `azd hooks run preprovision`, then for each layer in order: `azd provision <layer> --preview`, review, `azd provision <layer>`.
2. `azd deploy notes-mcp`, `azd deploy chat-ui` (the first deployment of each provisions its layer again for its port).
3. Checks by hand, as the deployer, with `az account get-access-token --scope "$(azd env get-value APIM_GATEWAY_SCOPE)"`.

## Result

- Provisioning times: azure-platform 5 min; foundry-model about 2 min; apim-gateway 3 min, of which **API Management
  Standard v2 itself 1 min 34 s**; notes-mcp with its first deployment about 6 min; apim-mcp under 1 min; chat-ui
  with its first deployment about 8 min.
- **Model through the gateway:** `POST <gateway>/openai/v1/responses` without a token → 401 ("A signed-in user's token
  for the AI gateway is required."); with the user's token → 200 in 4.4 s; streaming passes through unbuffered.
- **Notes server:** `/health` 200; `/mcp` without a token → 401 (its own check: only API Management's identity).
- **MCP through the gateway, as the user:** without a token → 401 from API Management; with it, `initialize`,
  `tools/list` (`add_note`, `list_notes`, `count_notes`), `add_note` and `list_notes` work.
- **Chat UI:** after one sign-in (one consent screen for both app registrations), "Add a note: APIM spike works, then
  list the notes" → two tool lines (`notes-add_note`, `notes-list_notes`) and the answer listing both notes.

Two settings added on the way, in the shared building blocks:

- The gateway's app registration pre-authorizes the Azure CLI, so that the CLI gets a user token for the gateway
  without an interactive consent.
- The sign-in popup asks both consents (`extraScopesToConsent`), so that the gateway's consent needs no second popup
  (the browser blocked a second popup, with `popup_window_error`).
