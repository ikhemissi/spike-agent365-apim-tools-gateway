#!/usr/bin/env bash
# Fails fast, before anything is deployed, if the model cannot be deployed in the region with the requested capacity.
set -euo pipefail
infra/scripts/check-model-quota.sh
