variable "vercel_team_id" {
  description = "Vercel team (orgId from .vercel/project.json)."
  type        = string
  default     = "team_5whkIKtLLYx3NTxmUVmbCWFJ"
}

variable "project_name" {
  description = "Vercel project name."
  type        = string
  default     = "cinemarate"
}

variable "github_repo" {
  description = "GitHub repository connected for automatic deployments."
  type        = string
  default     = "Flexible78/cinemarate"
}

variable "tmdb_key" {
  description = "TMDB v3 API key or v4 read access token used by api/discover.js."
  type        = string
  sensitive   = true
}

variable "favorites_token" {
  description = <<-EOT
    Optional shared secret for api/favorites.js. Leave empty to keep the
    endpoint open, exactly like the current deployment behaves.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}
