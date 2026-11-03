#!/usr/bin/env bash
# azd preprovision hook of the foundry-model layer: fail fast when the model cannot be deployed in the region (not
# offered with the SKU, or not enough quota), before Terraform runs.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/../scripts/check-model-quota.sh"
