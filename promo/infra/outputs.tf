output "d1_database_id" {
  value       = cloudflare_d1_database.promo.id
  description = "Goes into worker/wrangler.jsonc (./sync-wrangler does it)."
}

output "media_bucket" {
  value = cloudflare_r2_bucket.media.name
}

output "private_bucket" {
  value = cloudflare_r2_bucket.private.name
}

output "ci_token" {
  value     = var.create_ci_token ? cloudflare_api_token.ci[0].value : null
  sensitive = true
}
