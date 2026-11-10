#!/usr/bin/env bash
# Deletes the environment's resource group in a single operation before `terraform destroy`.
# Deleting the resource group removes every resource and its child resources (e.g. PostgreSQL's Entra administrators
# and firewall rules) in one operation; Terraform then finds the resources gone and only cleans its state. Key Vaults,
# Foundry (Cognitive Services) accounts and API Management instances of the group are purged, and their diagnostic
# settings deleted by name, so that the environment can be recreated with the same names and starts clean.
# Works after a failed provision too (outputs missing): the group name follows the rg-<environment> convention.
set -euo pipefail
RG="${AZURE_RESOURCE_GROUP:-rg-${AZURE_ENV_NAME:?}}"

if [[ "$(az group exists -n "$RG")" != "true" ]]; then
  echo "Resource group $RG does not exist"
  exit 0
fi
VAULTS="$(az keyvault list -g "$RG" --query '[].name' -o tsv)"
AI_ACCOUNTS="$(az cognitiveservices account list -g "$RG" --query '[].[name, location]' -o tsv)"
GATEWAYS="$(az resource list -g "$RG" --resource-type Microsoft.ApiManagement/service --query '[].[name, location]' -o tsv)"
for id in $(az resource list -g "$RG" --query '[].id' -o tsv); do
  for setting in $(az monitor diagnostic-settings list --resource "$id" --query '[].name' -o tsv 2>/dev/null); do
    echo "Deleting diagnostic setting $setting of ${id##*/}"
    az monitor diagnostic-settings delete --resource "$id" -n "$setting" -o none
  done
done
echo "Deleting resource group $RG (this takes several minutes)..."
az group delete -n "$RG" --yes -o none
for vault in $VAULTS; do
  echo "Purging soft-deleted Key Vault $vault..."
  az keyvault purge -n "$vault" -o none
done
while read -r account location; do
  [[ -n "$account" ]] || continue
  echo "Purging soft-deleted Foundry account $account..."
  az cognitiveservices account purge -n "$account" -l "$location" -g "$RG" -o none
done <<< "$AI_ACCOUNTS"
while read -r gateway location; do
  [[ -n "$gateway" ]] || continue
  echo "Purging soft-deleted API Management instance $gateway..."
  az apim deletedservice purge -n "$gateway" -l "$location" -o none
done <<< "$GATEWAYS"
