#!/usr/bin/env bash
# azd preprovision hook (project level, before every layer): makes sure the Terraform remote state backend exists and
# is configured for this environment (idempotent; skipped when RS_* are already set). `azd provision --preview` does
# not run hooks: run `azd hooks run preprovision` once before the first preview.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${RS_STORAGE_ACCOUNT:-}" && -n "${RS_RESOURCE_GROUP:-}" && -n "${RS_CONTAINER_NAME:-}" ]]; then
  echo "Terraform state backend: $RS_STORAGE_ACCOUNT/$RS_CONTAINER_NAME"
  exit 0
fi
"$HERE/../scripts/bootstrap-tfstate.sh" "${AZURE_LOCATION:-francecentral}"
