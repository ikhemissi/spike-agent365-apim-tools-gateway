#!/usr/bin/env bash
# Pre-provision check: fail fast when the Foundry model cannot be deployed in the region (not offered with the SKU, or
# not enough quota), instead of failing late in `terraform apply`. Mirrors the model defaults of
# infra/foundry-model/main.tf.
#   infra/foundry-model/scripts/check-model-quota.sh
#   reads AZURE_SUBSCRIPTION_ID, AZURE_ENV_NAME, AZURE_LOCATION, MODEL_NAME, MODEL_VERSION, MODEL_SKU, MODEL_CAPACITY
set -euo pipefail

location="${AZURE_LOCATION:-francecentral}"
subscription="${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID is required}"
resource_group="rg-${AZURE_ENV_NAME:?AZURE_ENV_NAME is required}"

# check <model> <version> <sku> <capacity> <quota prefix> <deployment name> <how to change it>
check() {
  local name="$1" version="$2" sku="$3" capacity="$4" quota_prefix="$5" deployment="$6" hint="$7"
  fail() {
    echo "ERROR: model preflight: $*" >&2
    echo "$hint" >&2
    exit 1
  }

  if ! [[ "$capacity" =~ ^[1-9][0-9]*$ ]]; then
    fail "the capacity of $name must be a positive integer, got '$capacity'."
  fi

  local offered
  offered=$(az cognitiveservices model list --subscription "$subscription" -l "$location" \
    --query "[?kind=='AIServices' && model.name=='$name' && model.version=='$version'] | [0].model.skus[?name=='$sku'] | length(@)" \
    -o tsv 2>/dev/null || true)
  if [[ "${offered:-0}" == "0" || -z "$offered" ]]; then
    fail "$name version $version is not offered with SKU $sku in $location."
  fi

  local used limit
  read -r used limit < <(az cognitiveservices usage list --subscription "$subscription" -l "$location" \
    --query "[?name.value=='$quota_prefix.$sku.$name'] | [0].join(' ', [to_string(currentValue), to_string(limit)])" -o tsv) || true
  if [[ -z "${limit:-}" || "$limit" == "None" ]]; then
    fail "no $sku quota found for $name in $location."
  fi

  # Capacity already held by this environment's deployment is reused, not added.
  local existing=0 held account
  if [[ "$(az group exists --subscription "$subscription" -n "$resource_group")" == "true" ]]; then
    for account in $(az cognitiveservices account list --subscription "$subscription" -g "$resource_group" --query "[].name" -o tsv); do
      held=$(az cognitiveservices account deployment list --subscription "$subscription" -g "$resource_group" -n "$account" \
        --query "[?name=='$deployment' && sku.name=='$sku'] | [0].sku.capacity" -o tsv)
      [[ -n "$held" && "$held" != "None" ]] && existing=$((existing + held))
    done
  fi

  local available=$(( ${limit%.*} - ${used%.*} + existing ))
  if (( capacity > available )); then
    fail "$name ($sku) needs $capacity capacity units in $location but only $available are available (limit ${limit%.*}, used ${used%.*}, of which $existing by this environment)."
  fi
  echo "Model preflight: $name $version ($sku) capacity $capacity in $location — OK ($available available)."
}

# Add a check per model deployment (e.g. a second model with quota prefix AIServices for non-OpenAI models).
check "${MODEL_NAME:-gpt-6-luna}" "${MODEL_VERSION:-2026-09-22}" "${MODEL_SKU:-DataZoneStandard}" \
  "${MODEL_CAPACITY:-50}" OpenAI "${MODEL_NAME:-gpt-6-luna}" \
  "Choose another model, SKU, capacity or region (azd env set MODEL_NAME / MODEL_VERSION / MODEL_SKU / MODEL_CAPACITY / AZURE_LOCATION) or request quota: https://aka.ms/oai/quotaincrease"
