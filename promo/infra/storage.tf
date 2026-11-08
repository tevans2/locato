# ---- R2 ------------------------------------------------------------------------------------------------------
# The public bucket already exists: adopt it (no change to it). Its custom domain, media.locato.quest, was set up in
# the dashboard and stays there: the provider can't import R2 custom domains.
import {
  to = cloudflare_r2_bucket.media
  id = "${var.account_id}/${var.media_bucket}/default"
}

resource "cloudflare_r2_bucket" "media" {
  account_id = var.account_id
  name       = var.media_bucket
  lifecycle {
    prevent_destroy = true
  }
}

# Created by ./bootstrap (it has to exist before Terraform can keep its state in it), then adopted here.
import {
  to = cloudflare_r2_bucket.private
  id = "${var.account_id}/${var.private_bucket}/default"
}

resource "cloudflare_r2_bucket" "private" {
  account_id = var.account_id
  name       = var.private_bucket
  lifecycle {
    prevent_destroy = true
  }
}

# ---- D1: the promo service's records (videos, posts, content, voices, runs) ------------------------------------
resource "cloudflare_d1_database" "promo" {
  account_id            = var.account_id
  name                  = "locato-promo"
  primary_location_hint = var.d1_location
  lifecycle {
    prevent_destroy = true
  }
}
