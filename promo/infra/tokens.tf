# Optional: a narrow token for automated deploys (GitHub Actions): the promo Worker, its D1 database and its route.
# terraform output -raw ci_token   → add it as the CLOUDFLARE_API_TOKEN secret of the deploy workflow.
locals {
  ci_groups = {
    workers = "Workers Scripts Write"
    d1      = "D1 Write"
    account = "Account Settings Read"
    r2      = "Workers R2 Storage Write"
    routes  = "Workers Routes Write"
  }
}

data "cloudflare_api_token_permission_groups_list" "ci" {
  for_each = var.create_ci_token ? local.ci_groups : {}
  name     = urlencode(each.value)
}

resource "cloudflare_api_token" "ci" {
  count = var.create_ci_token ? 1 : 0
  name  = "locato-promo-deploy"
  policies = [
    {
      effect            = "allow"
      permission_groups = [for k in ["workers", "d1", "account", "r2"] : { id = data.cloudflare_api_token_permission_groups_list.ci[k].result[0].id }]
      resources         = jsonencode({ "com.cloudflare.api.account.${var.account_id}" = "*" })
    },
    {
      effect            = "allow"
      permission_groups = [{ id = data.cloudflare_api_token_permission_groups_list.ci["routes"].result[0].id }]
      resources         = jsonencode({ "com.cloudflare.api.account.zone.${var.zone_id}" = "*" })
    },
  ]
}
