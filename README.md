# CinemaRate

Live demo: https://cinemarate.vercel.app

CinemaRate is a single-page web app that aggregates movie and TV ratings from
several public sources into one card, keeps a shared "Favorites" list in the
cloud, and lets you discover titles by genre, country, language, year and
rating. The UI is in English and still understands Cyrillic queries, including
transliteration ("artur stron" -> "Artur Stron").

A one-page brief for a live walkthrough: [English](docs/PITCH.en.md) ·
[Hebrew](docs/PITCH.he.md).

Step-by-step guides in Russian: [the whole flow](docs/FLOW.ru.md) ·
[AI setup](docs/AI_SETUP.ru.md) · [skills to claim](docs/SKILLS.ru.md).

## Features

- **One card, many ratings** - IMDb, Kinopoisk, Rotten Tomatoes, Metacritic and
  a computed average score, plus poster, year, description and watch links.
- **Cyrillic-aware search** - transliteration, key normalization and a relevance
  score (`relScore`, threshold 0.34) so a Russian query no longer returns junk.
- **Progressive rendering** - every remote call has its own time budget
  (`withBudget`) and the card is painted as soon as partial data arrives, so a
  result appears in seconds instead of waiting for the slowest source.
- **Shared Favorites** - four categories (to watch / maybe / loved / watched)
  with type tabs (all / films / series / documentaries), notes, JSON export and
  import, and server-side sync through Vercel Blob so the list follows you
  across devices.
- **Discovery panel** - TMDB-backed browsing by type, genre, country, original
  language, year range, minimum rating and sort order; results open straight
  into the rating card.
- **Detective filter** - TMDB has no detective genre, so the genre list offers a
  synthetic *Detective (mystery + crime)* option that queries both ids at once.
- **Pick for tonight** - one button ranks the watchlist and answers with a title
  and a one-line reason. With `MISTRAL_API_KEY` set the ranking is done by
  Mistral; without it a local heuristic answers in the same shape, so the
  feature never depends on an external provider being reachable.
- **Three themes** - dark, high-contrast and light, cycled by one small button
  and remembered in `localStorage`.

## How to use

1. **Search a title** - type a name in the field (English, Russian or a
   transliteration) and pick one of the live suggestions, or paste an IMDb or
   Kinopoisk link and press *Search*.
2. **Read the card** - ratings from every source that answered, an average
   score out of 100, poster, genres, runtime, director, cast, one review and
   trailer links.
3. **Save it** - choose a category (*Want to watch*, *Maybe*, *Loved*,
   *Watched*) and press *Add*. Open *Favorites* to filter by category and by
   type (*Movies*, *Series*, *Documentaries*).
4. **Discover something new** - press *Discover by filters* and combine type,
   genre, country, original language, year range, minimum rating and sort
   order; press a result to open its full rating card.
5. **Back up or move the list** - *Export JSON* writes `favorites.json`;
   *Import JSON* merges or replaces, and dropping the file into the window
   works too.
6. **Switch the theme** - the small button in the header cycles dark,
   high-contrast and light.

If a query cannot be resolved, the card shows a *Link to a title* box: paste an
IMDb or Kinopoisk URL and the entry becomes a normal, saveable card.

## How it works

```
query -> suggestions -> candidate list -> card -> favorites
```

1. **Query normalization** - the query is lower-cased, `e/yo` folded and
   transliterated, producing several key variants for the sources.
2. **Candidate search** - IMDb suggest, Cinemeta, TVmaze, Wikidata and
   Kinopoisk suggest are queried in parallel; each candidate is scored against
   the query (`relScore`, threshold 0.34) and everything below the threshold is
   dropped, which is what keeps Cyrillic searches relevant.
3. **Card build** - for the chosen candidate the app resolves the IMDb id
   (directly or through the Wikidata link to the Kinopoisk id), then fetches
   IMDb, Rotten Tomatoes, Metacritic and Kinopoisk in parallel. Every call has
   its own timeout budget and the card is rendered progressively: partial data
   appears immediately, missing sources are simply marked as unavailable.
4. **Average score** - all available scores are normalized to a 0-100 scale and
   averaged, so one number is comparable across sources.
5. **Caching** - resolved cards and searches are cached in `localStorage` for
   24 hours; empty or failed results are never cached.
6. **Favorites** - entries are written to `localStorage` and, on the deployed
   site, merged into the shared store through `/api/favorites`, so several
   devices see the same list.
7. **Discovery** - filters are sent to `/api/discover`, which calls TMDB
   server-side with the secret key, caches the response at the edge and returns
   a normalized list; picking an item resolves its IMDb id and reuses the same
   card pipeline.

## Tech stack

- Vanilla JavaScript, HTML and CSS in a single `index.html` (no build step,
  no framework, no bundler).
- Vercel serverless functions (CommonJS) for anything that needs a secret or a
  server: `api/discover.js` and `api/favorites.js`.
- Vercel Blob as the storage layer for the shared favorites file.
- Public data sources: TMDB, IMDb suggest, Cinemeta, TVmaze, Wikidata,
  Kinopoisk suggest, with a selectable CORS proxy for browser-side calls.

## Architecture

```
index.html          UI, search pipeline, card builder, favorites, themes
api/discover.js     TMDB proxy: health / genres / imdb / search / discover
api/favorites.js    shared favorites store on Vercel Blob (GET, POST, ?debug=1)
api/pick.js         picks one title from the watchlist (Mistral or heuristic)
infra/              Terraform description of the Vercel environment
scripts/            local checks reused by CI
.github/workflows/  static checks on every push and pull request
favicon.ico
```

The TMDB key never reaches the browser: it lives in the `TMDB_KEY` environment
variable and is used only inside the serverless function, which also caches
responses at the edge (`s-maxage=86400` for search and discover,
`s-maxage=604800` for genre and IMDb lookups).

### `api/discover.js` modes

| Mode | Purpose |
| --- | --- |
| `health` | reports whether the TMDB key is configured |
| `genres` | localized genre lists for movies and TV |
| `imdb` | resolves a TMDB id to an IMDb id |
| `search` | title search, used when the name field is filled |
| `discover` | filtered browsing (default mode) |

Example: `/api/discover?mode=discover&type=tv&country=IL&sort=votes`

## From zero to your own copy

The complete path from an empty machine to a deployed site. Nothing below
requires a paid account.

### 0. What you need

| Thing | What it is for | Cost |
| --- | --- | --- |
| Node.js 20+ | running and deploying | free |
| GitHub account | source, CI, automatic deploys | free |
| Vercel account | hosting, functions, Blob storage | free tier |
| TMDB API key | the discovery panel | free, issued instantly |
| Mistral API key | AI pick of the evening | optional, free tier |

### 1. Get the code

```bash
git clone https://github.com/Flexible78/cinemarate.git
cd cinemarate
npm install
```

### 2. Get a TMDB key

Register on themoviedb.org, open *Settings* -> *API* and copy either the v3 API
key or the v4 read access token. Both are accepted: the function detects a JWT
and sends it as a bearer token instead of a query parameter.

### 3. Run it locally

```bash
npx vercel dev
```

Open <http://localhost:3000>. Set `TMDB_KEY` in your shell or in `.env.local`
(git-ignored) to enable the discovery panel. Without it the rest of the app
still works. Without a Blob store the favorites panel says *Local store* and
keeps everything in the browser.

Run the same checks CI runs:

```bash
node --check api/favorites.js
node scripts/check-inline-js.mjs index.html
```

### 4. First deploy

```bash
npx vercel
```

Accept the defaults; you get a `name.vercel.app` address.

### 5. Attach Blob storage

In the project dashboard: *Storage* -> *Create Database* -> *Blob* -> *Connect
to Project*. Access is granted through OIDC, so Vercel injects a short-lived
token and there is nothing to copy by hand.

### 6. Set the environment variables

| Variable | Required | Effect |
| --- | --- | --- |
| `TMDB_KEY` | for discovery | TMDB v3 key or v4 read token, server-side only |
| `FAVORITES_TOKEN` | no | when set, `/api/favorites` and `/api/pick` require the secret; the browser stores it once from `?token=...` |
| `GROQ_API_KEY` | no | switches the evening pick from the local heuristic to Groq (preferred: fastest free tier) |
| `GROQ_MODEL` | no | model override, default `llama-3.3-70b-versatile` |
| `MISTRAL_API_KEY` | no | same, using Mistral; used when `GROQ_API_KEY` is absent |
| `MISTRAL_MODEL` | no | model override, default `mistral-small-latest` |

Then redeploy so the functions pick them up:

```bash
npx vercel --prod
```

### 7. Deploy automatically from GitHub

```bash
gh repo create cinemarate --public --source=. --remote=origin --push
npx vercel git connect
```

From now on a push to `main` deploys production and every pull request gets its
own preview URL. The CI workflow runs on both.

### 8. Verify the deployment

| Check | Expected |
| --- | --- |
| `/api/discover?mode=health` | `hasKey: true` |
| `/api/favorites?debug=1` | `hasStoreId: true` and a successful read probe |
| `/api/pick` (GET) | `engine: "mistral"` or `"heuristic"` |
| Favorites panel | says *Shared store* with an entry count |
| Actions tab | the CI run is green |

### 9. Optional: manage the project as code

```bash
cd infra
export VERCEL_API_TOKEN=...
terraform init
terraform plan
```

See [`infra/README.md`](infra/README.md) for adopting the existing project with
`terraform import`, and [`infra/MANUAL.md`](infra/MANUAL.md) for the steps that
are still manual and for the recovery drill.

`DEPLOY.md` covers the same ground from the deployment side, including how to
troubleshoot favorites sync.

## Roadmap

- Filters and sorting inside Favorites (year, rating, genre, country).
- Wikidata SPARQL as an optional second discovery source for small countries.
- PWA install support, personal ratings and statistics, CSV export.
- Log drain, an SLO with alerting, and a nightly backup of the shared list.

## Notes

This is a personal, non-commercial project. It uses the TMDB API but is not
endorsed or certified by TMDB; all ratings belong to their respective sources.
The favorites store is shared on purpose - the same list is used from several
devices - and it is open unless `FAVORITES_TOKEN` is configured, in which case
the list and the evening pick both require that secret.
