# The whole runtime environment of CinemaRate.
# Everything a fresh deployment needs, except the Blob store (see MANUAL.md).

resource "vercel_project" "cinemarate" {
  name      = var.project_name
  framework = null # plain static site plus serverless functions in api/

  # a push to main becomes production, every pull request gets a preview URL
  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = "main"
  }

  # the functions are tiny proxies; a short limit fails fast instead of hanging
  serverless_function_region = "fra1"

  # OIDC is what lets api/favorites.js talk to Blob without a static token
  oidc_token_config = {
    enabled = true
    issuer_mode = "team"
  }
}

# api/discover.js proxies TMDB server-side so the key never reaches the browser
resource "vercel_project_environment_variable" "tmdb_key" {
  project_id = vercel_project.cinemarate.id
  key        = "TMDB_KEY"
  value      = var.tmdb_key
  target     = ["production", "preview", "development"]
  sensitive  = true
}

# Optional: setting this switches api/favorites.js from open to token-protected.
resource "vercel_project_environment_variable" "favorites_token" {
  count = var.favorites_token == "" ? 0 : 1

  project_id = vercel_project.cinemarate.id
  key        = "FAVORITES_TOKEN"
  value      = var.favorites_token
  target     = ["production", "preview"]
  sensitive  = true
}
