variable "account_id" {
  type        = string
  description = "Cloudflare account ID (terraform.tfvars, written by ./bootstrap)."
}

variable "zone_id" {
  type        = string
  description = "Zone ID of locato.quest (terraform.tfvars, written by ./bootstrap)."
}

variable "media_bucket" {
  type        = string
  default     = "locato-social"
  description = "PUBLIC bucket (media.locato.quest): rendered videos for Buffer and voice clips. Nothing private."
}

variable "private_bucket" {
  type        = string
  default     = "locato-promo-private"
  description = "PRIVATE bucket: licensed music, backups and this Terraform state."
}

variable "d1_location" {
  type        = string
  default     = "weur"
  description = "Where D1 keeps its primary copy (weur is the closest region to South Africa)."
}

variable "create_ci_token" {
  type        = bool
  default     = false
  description = "Create a narrow deploy token (Worker + D1 + the promo route) for GitHub Actions."
}
