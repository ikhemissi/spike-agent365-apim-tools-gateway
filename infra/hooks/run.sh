#!/usr/bin/env bash
# Runs the steps of one azd hook event: the scripts in infra/hooks/<event>/, in name order, from the repository root.
# Blocks add their own steps (e.g. preprovision/10-check-model-quota.sh); azure.yaml calls this script for each event:
#   bash ./infra/hooks/run.sh <preprovision|postprovision|postdeploy|predown>
set -euo pipefail
event="${1:?usage: run.sh <event>}"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

for step in infra/hooks/"$event"/*.sh; do
  [[ -e "$step" ]] || continue
  echo "== $event: ${step##*/}"
  bash "$step"
done
