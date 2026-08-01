# Deliberately manual steps

Not everything about this project can be expressed in Terraform today. Writing
the gaps down is part of the point: the next person should not have to guess
which parts of the environment are code and which are clicks.

| Step | Why it is manual | How to verify |
| --- | --- | --- |
| Blob store creation and attachment (`Storage` -> `Create Database` -> `Blob` -> `Connect to Project`) | The Vercel provider exposes no Blob resource yet. | `https://<site>/api/favorites?debug=1` reports `hasStoreId: true`. |
| TMDB key value | A secret; Terraform receives it through `TF_VAR_tmdb_key` or `terraform.tfvars`, it is never committed. | `https://<site>/api/discover?mode=health`. |
| Vercel access token | Bootstrapping credential - the thing Terraform authenticates with cannot be managed by Terraform. | `terraform plan` runs without an auth error. |

## Recovery drill

Rebuilding the environment from an empty Vercel account:

1. `export VERCEL_API_TOKEN=...`
2. `cd infra && terraform init && terraform apply` - project, GitHub connection
   and environment variables appear.
3. Attach a Blob store in the dashboard (one dialog, see the table above).
4. Restore the watchlist: upload the last `favorites.json` export through the
   import control in the *My favorites* panel, or `PUT` it into the new store.
5. Check both self-check endpoints listed above.

Expected time: a few minutes, and step 3 is the only one done by hand.
