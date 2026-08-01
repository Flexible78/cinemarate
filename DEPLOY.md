# Deploying CinemaRate on Vercel

This folder is a self-contained site:

- `index.html` - the whole application (UI, search pipeline, favorites, themes);
- `api/discover.js` - TMDB proxy for the discovery panel;
- `api/favorites.js` - read and write the shared `favorites.json` store;
- `favicon.ico` - the icon.

## First deploy

1. Create a free account on vercel.com (sign in with GitHub or email).
2. Install Node.js, open a terminal in this folder and run:
   ```bash
   npx vercel
   ```
   Accept the defaults; at the end you get an address like `name.vercel.app`.
3. In the project dashboard open **Storage** -> **Create Database** -> **Blob**
   -> **Connect to Project**. Access is granted through OIDC: Vercel injects a
   short-lived token and `BLOB_STORE_ID` automatically, so there is nothing to
   copy or paste.
4. Open **Settings** -> **Environment Variables** and add `TMDB_KEY` with a
   TMDB v3 API key or a v4 read access token (Production and Preview). Mark it
   as sensitive. Without this variable everything works except the discovery
   panel, which reports that discovery is not configured.
5. Run `npx vercel --prod` again so the deployment picks up the storage and the
   environment variable.

Open the site from any device. The *My favorites* panel should say
*Shared store*, which means entries are stored on the server and visible
everywhere.

## Continuous deployment from GitHub

```bash
gh repo create cinemarate --public --source=. --remote=origin --push
npx vercel git connect
```

After that every push to `main` deploys production automatically and every pull
request gets its own preview URL.

## Infrastructure as code

The project, its GitHub connection and its environment variables are also
described with Terraform in [`infra/`](infra/README.md), so the environment is
reviewable in git and can be rebuilt from scratch. `terraform plan` is the
quickest way to see whether anything was changed in the dashboard by hand. The
steps that cannot be automated yet - the Blob store, above all - are listed in
[`infra/MANUAL.md`](infra/MANUAL.md) together with a recovery drill.

## Good to know

- The favorites store is shared on purpose: the same list is used from several
  devices. Writes are merged server-side - each request carries the keys the
  browser last saw, so an entry added on another device is never overwritten and
  only a real deletion removes anything. The page also re-reads the server copy
  once a minute and whenever the tab regains focus.
- By default anyone who knows the site address can read and edit that list. Set
  a `FAVORITES_TOKEN` environment variable to require a shared secret; the
  browser stores it once from `https://your-site/?token=THE-SECRET`. While the
  variable is unset the endpoint stays open and behaves exactly as before.
- On first open, local browser entries and server entries are merged, so nothing
  is lost.
- JSON export and import remain available as a manual backup.
- Discovery responses are cached at the edge (24 hours for search and discover,
  7 days for genre and IMDb lookups), so the TMDB rate limit is never an issue.

## Self-checks

- `your-site/api/discover?mode=health` - reports whether `TMDB_KEY` is
  configured and reachable.
- `your-site/api/favorites?debug=1` - reports:
  - `hasStoreId` - whether a Blob store is attached to the project;
  - `hasOidc` - whether Vercel issued a token to the function;
  - `probe` - the result of a real read, or the error text.

If `hasStoreId` is `false`, the store is not attached, or `npx vercel --prod`
was not run after attaching it.
