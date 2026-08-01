output "project_id" {
  description = "Vercel project id - must match .vercel/project.json."
  value       = vercel_project.cinemarate.id
}

output "favorites_endpoint_protected" {
  description = "Whether FAVORITES_TOKEN is configured for this project."
  value       = var.favorites_token != ""
}
