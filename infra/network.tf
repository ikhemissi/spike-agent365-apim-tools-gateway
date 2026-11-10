# No virtual network: every service is reached over its public endpoint, with Entra authentication. Module calls read
# their subnet and private DNS zones from local.network. To use a virtual network, replace this file with a call to
# modules/network (copy it from the catalog) and set local.network from its outputs: subnet_ids by role
# ("container-apps", "private-endpoints") and private_dns_zone_ids.

locals {
  network = {
    subnet_ids           = {}
    private_dns_zone_ids = {}
  }
}
