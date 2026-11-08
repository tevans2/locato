# Cloudflare resources for the promo pipeline. Run through ./tf (it sets the R2 state credentials).
# State lives in the private R2 bucket (terraform/promo.tfstate); backend.hcl (made by ./bootstrap) adds the endpoint.
terraform {
  required_version = ">= 1.6"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.28" }
  }
  backend "s3" {
    bucket                      = "locato-promo-private"
    key                         = "terraform/promo.tfstate"
    region                      = "auto"
    use_path_style              = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment (the bootstrap token; see README).
provider "cloudflare" {}
