#!/usr/bin/env bash
# After the first deployment of a service, its container app still listens on the placeholder
# image's port (80); provisioning once more switches it to the service's port and adds its health probe
# (modules/container-app). Later deployments find every app on its port: nothing to do.
set -euo pipefail
: "${AZURE_ENV_NAME:?}" "${AZURE_RESOURCE_GROUP:?}"

on_placeholder_port="$(az containerapp list -g "$AZURE_RESOURCE_GROUP" \
  --query "[?tags.\"azd-service-name\" && properties.configuration.ingress.targetPort == \`80\`].name" -o tsv)"
if [[ -n "$on_placeholder_port" ]]; then
  echo "Apps still on the placeholder's port, provisioning again for their ports and probes:"
  echo "$on_placeholder_port"
  azd provision -e "$AZURE_ENV_NAME" --no-prompt
fi
