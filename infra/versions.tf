terraform {
  required_version = ">= 1.6.0"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 3.0"
    }
  }
}

# The token is read from the VERCEL_API_TOKEN environment variable so it never
# lands in a file that could be committed.
provider "vercel" {
  team = var.vercel_team_id
}
