# Infrastructure as code

The Vercel project behind CinemaRate is described here instead of being clicked
together in the dashboard, so the whole environment is reviewable in git and can
be rebuilt from scratch.

## What is managed

- the Vercel project itself (framework `null`, static site plus `api/` functions);
- the GitHub connection, so `main` deploys production and pull requests get
  preview URLs;
- environment variables: `TMDB_KEY` and the optional `FAVORITES_TOKEN`,
  both marked sensitive and never stored in this repository;
- deployment protection and the production alias.

Blob storage is intentionally *not* managed here: Vercel has no public Terraform
resource for Blob stores yet, so it stays attached through the dashboard. That
gap is documented rather than hidden - see `MANUAL.md`.

## Prerequisites

- Terraform >= 1.6
- a Vercel access token: <https://vercel.com/account/tokens> (scope: the team
  that owns the project)

## Usage

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # fill in the values
export VERCEL_API_TOKEN=...                    # never put the token in a file
terraform init
terraform plan     # shows the drift between this code and the real project
terraform apply
```

The existing project is adopted instead of recreated, so the first run is an
import, not a rebuild:

```bash
terraform import vercel_project.cinemarate prj_ecIqqMGqOXvA7xmFcM62hSCQypyw
terraform plan     # must come back with no destructive changes
```

`terraform plan` is safe to run at any time and is the fastest way to see
whether somebody changed something in the dashboard by hand.

## State

State is local (`terraform.tfstate`) and git-ignored, because it contains the
values of sensitive environment variables. For a shared setup move it to a
remote backend - the free tier of Terraform Cloud or an S3-compatible bucket is
enough:

```hcl
terraform {
  backend "remote" {
    organization = "your-org"
    workspaces { name = "cinemarate" }
  }
}
```
