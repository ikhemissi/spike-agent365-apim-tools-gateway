#!/usr/bin/env bash
# azd postdeploy hook of the notes-mcp service: after the first deployment, the container app still listens on the
# placeholder image's port (80), so the notes-mcp layer is provisioned once more to switch to the app's port (8080)
# and add its health probe. Later deployments are already on the app's port: nothing to do.
set -euo pipefail
: "${AZURE_ENV_NAME:?}" "${AZURE_RESOURCE_GROUP:?}" "${NOTES_MCP_APP_NAME:?}"

port="$(az containerapp show -n "$NOTES_MCP_APP_NAME" -g "$AZURE_RESOURCE_GROUP" \
  --query properties.configuration.ingress.targetPort -o tsv)"
if [[ "$port" == "80" ]]; then
  echo "First deployment of $NOTES_MCP_APP_NAME: provisioning the notes-mcp layer again for its port and probe"
  azd provision notes-mcp -e "$AZURE_ENV_NAME" --no-prompt
fi
