#!/usr/bin/env bash
# Makes sure the Terraform state backend exists and is configured for this environment (provider.conf.json).
# Runs the idempotent bootstrap on every provision, not only the first: it re-applies RESOURCE_TAGS and public network
# access to the state account, which a tenant policy may change when the account lacks the tags it expects (e.g. tags
# set after the account was created).
# `azd provision --preview` does not run hooks: run `azd hooks run preprovision` once before the first preview.
set -euo pipefail

infra/scripts/bootstrap-tfstate.sh "${AZURE_LOCATION:-francecentral}"
