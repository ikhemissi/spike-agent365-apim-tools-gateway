#!/usr/bin/env bash
# Makes sure the Terraform state backend exists and is configured for this environment (provider.conf.json).
# `azd provision --preview` does not run hooks: run `azd hooks run preprovision` once before the first preview.
set -euo pipefail

if [[ -n "${RS_STORAGE_ACCOUNT:-}" && -n "${RS_RESOURCE_GROUP:-}" && -n "${RS_CONTAINER_NAME:-}" ]]; then
  echo "Terraform state backend: $RS_STORAGE_ACCOUNT/$RS_CONTAINER_NAME"
else
  infra/scripts/bootstrap-tfstate.sh "${AZURE_LOCATION:-francecentral}"
fi
