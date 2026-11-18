# No virtual network: every service is reached over its public endpoint, with Entra authentication. Module calls read
# their subnet from local.network and their private endpoint from local.private_endpoint. To use a virtual network,
# replace this file with a call to modules/network (copy it from the catalog) and set, from its outputs:
#   local.network.subnet_ids: subnet ids by role ("container-apps", "private-endpoints");
#   local.network.subnet_address_prefixes: their address prefixes by role (subnet_address_prefixes);
#   local.private_endpoint: { subnet_id = <the private-endpoints subnet id>, private_dns_zone_ids = <the zones by name> }.
# Keep local.private_endpoint null or an object built from known values: whether it is null decides at plan time
# whether the private endpoints exist.

locals {
  network = {
    subnet_ids              = {}
    subnet_address_prefixes = {}
  }
  private_endpoint = null
}
