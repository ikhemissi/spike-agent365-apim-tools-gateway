#!/usr/bin/env bash
# After `azd down`, nothing of the environment may be left. Purges what is still soft-deleted from the environment's
# resource group (Key Vaults, Foundry accounts, API Management instances: the predown step purges them, unless it
# stopped early), then fails, listing them, if anything remains: the resource group, a resource that cannot be purged
# (purge protection), or an Entra app or group of the environment (display name ending in "(<environment>)", owned
# by the signed-in deployer, as the blocks create them).
set -euo pipefail
ENV_NAME="${AZURE_ENV_NAME:?}"
RG="${AZURE_RESOURCE_GROUP:-rg-$ENV_NAME}"
left=()

# Soft-deleted resources keep their original resource ID: keep those of this resource group (IDs vary in case).
of_this_group() { grep -i "/resourcegroups/$RG/" || true; }

if [[ "$(az group exists -n "$RG")" == "true" ]]; then
  left+=("resource group $RG")
fi

while read -r vault _; do
  [[ -n "$vault" ]] || continue
  echo "Purging soft-deleted Key Vault $vault..."
  az keyvault purge -n "$vault" -o none || left+=("soft-deleted Key Vault $vault")
done < <(az keyvault list-deleted --resource-type vault --query "[].[name, properties.vaultId]" -o tsv | of_this_group)

while read -r account location _; do
  [[ -n "$account" ]] || continue
  echo "Purging soft-deleted Foundry account $account..."
  az cognitiveservices account purge -n "$account" -l "$location" -g "$RG" -o none ||
    left+=("soft-deleted Foundry account $account")
done < <(az cognitiveservices account list-deleted --query "[].[name, location, id]" -o tsv | of_this_group)

while read -r gateway location _; do
  [[ -n "$gateway" ]] || continue
  echo "Purging soft-deleted API Management instance $gateway..."
  az apim deletedservice purge -n "$gateway" -l "$location" -o none ||
    left+=("soft-deleted API Management instance $gateway")
done < <(az apim deletedservice list --query "[].[name, location, serviceId]" -o tsv | of_this_group)

if owned="$(az ad signed-in-user list-owned-objects \
  --query "[?ends_with(displayName, '($ENV_NAME)')].displayName" -o tsv 2>/dev/null)"; then
  while read -r object; do
    [[ -n "$object" ]] && left+=("Entra object \"$object\"")
  done <<<"$owned"
else
  echo "Entra apps and groups not checked: the deployer is not a signed-in user."
fi

if ((${#left[@]})); then
  echo "Left after azd down, to delete by hand:" >&2
  printf '  - %s\n' "${left[@]}" >&2
  exit 1
fi
echo "Nothing of $ENV_NAME is left."
