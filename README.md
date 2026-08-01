# CinemaRate

[![CI](https://github.com/Flexible78/cinemarate/actions/workflows/ci.yml/badge.svg)](https://github.com/Flexible78/cinemarate/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Deployed on Vercel](https://img.shields.io/badge/deployed%20on-Vercel-black.svg)](https://cinemarate.vercel.app)
[![Build step](https://img.shields.io/badge/build%20step-none-brightgreen.svg)](#development)
[![Infrastructure](https://img.shields.io/badge/infrastructure-Terraform-7B42BC.svg)](infra/README.md)

> Every public rating of a film or show in one card, a favourites list shared
> between devices, and an AI helper that answers "what do we watch tonight?" -
> shipped as static files plus serverless functions, with no build step and on
> free tiers only.

**Live demo:** <https://cinemarate.vercel.app>

---

## Table of contents

- [Why it exists](#why-it-exists)
- [Features](#features)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Architecture](#architecture)
- [How a card is built](#how-a-card-is-built)
- [How the AI features work](#how-the-ai-features-work)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Development](#development)
- [Continuous integration](#continuous-integration)
- [Infrastructure as code](#infrastructure-as-code)
- [Operations and verification](#operations-and-verification)
- [Security model](#security-model)
- [Roadmap](#roadmap)
- [Documentation map](#documentation-map)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Why it exists

Choosing a film with someone else means opening four sites, comparing four
incompatible scales, and losing the shortlist by the next evening. CinemaRate
collapses that into one card, one comparable score out of 100, and one shared
list that is the same on every device in the household.

It is also a deliberately small, boring-by-design piece of infrastructure: no
framework, no bundler, no database server, no paid plan, and every secret kept
on the server side.

## Features

- **One card, many ratings** - IMDb, Kinopoisk, Rotten Tomatoes and Metacritic,
  normalised to a single 0-100 average, with poster, year, genres, runtime,
  director, cast, one review and trailer links.
- **Cyrillic-aware search** - folding, transliteration and a relevance score
  (`relScore`, threshold 0.34), so a Russian query or a transliteration such as
  `artur stron` resolves to the right title instead of noise.
- **Progressive rendering** - every remote call has its own time budget
  (`withBudget`); the card is painted from partial data and missing sources are
  marked as unavailable rather than blocking the page.
- **Favourites shared across devices** - four categories (want to watch / maybe
  / loved / watched), type tabs, notes, JSON import and export, and server-side
  merge through Vercel Blob so two people editing from two phones do not
  overwrite each other.
- **Discovery panel** - TMDB-backed browsing by type, genre, country, original
  language, year range, minimum rating and sort order.
- **Detective filter** - TMDB has no detective genre, so the list offers a
  synthetic *Detective (mystery + crime)* option that queries both ids at once.
- **Pick for tonight** - one button ranks the watchlist with an LLM and answers
  with a title and a one-line reason; without a provider key a local heuristic
  answers in the same shape.
- **Describe what you want** - free-text wish ("a clever gripping detective,
  2024-2026") returns real releases only: the year window and genre are parsed
  from the text, candidates come from the film database, and the model only
  ranks and explains them.
- **Provider and model picker** - a gear panel lists the providers that have a
  key on the server and the models each one really offers, validates a choice
  with a live probe, and stores it for every device. No key ever reaches the
  browser.
- **Self-healing provider selection** - model ids are resolved from each
  provider's own `/models` list, verified with a tiny request and cached for 12
  hours, so a renamed or retired model does not break the feature.
- **Three themes** - dark, high contrast and light, remembered in
  `localStorage`.

## Quick start

Nothing below requires a paid account.

| Requirement | Purpose | Cost |
| --- | --- | --- |
| Node.js 20+ | run and deploy | free |
| GitHub account | source, CI, automatic deploys | free |
| Vercel account | hosting, functions, Blob storage | free tier |
| TMDB API key | discovery panel and AI verification | free, issued instantly |
| Groq / Mistral / Inception / Agnes key | AI features | optional, free tier |

```bash
git clone https://github.com/Flexible78/cinemarate.git
cd cinemarate
npm install
npx vercel dev            # http://localhost:3000
```

Deploy your own copy:

```bash
npx vercel                # first deploy, accept the defaults
npx vercel --prod         # production
```

Then attach storage in the Vercel dashboard (*Storage -> Create Database ->
Blob -> Connect to Project*; access is granted through OIDC, so there is no
token to copy), set the variables from [Configuration](#configuration), and
redeploy. To deploy on every push:

```bash
gh repo create cinemarate --public --source=. --remote=origin --push
npx vercel git connect
```

`DEPLOY.md` covers the same path from the deployment side, including how to
troubleshoot favourites sync. [`docs/FLOW.ru.md`](docs/FLOW.ru.md) is the same
walkthrough in Russian.

## Usage

1. **Search a title** - type a name in English, Russian or a transliteration and
   pick a live suggestion, or paste an IMDb or Kinopoisk link.
2. **Read the card** - every source that answered, plus the average out of 100.
3. **Save it** - choose a category and press *Add*; open *Favorites* to filter
   by category and by type.
4. **Discover something new** - press *Discover by filters* and combine type,
   genre, country, language, year range, minimum rating and sort order.
5. **Ask for the evening** - *What do we watch tonight?* picks from your list;
   *Describe what you want* answers a free-text wish with verified releases.
6. **Choose the engine** - the gear panel switches provider and model, or
   returns to automatic selection.
7. **Back up or move the list** - *Export JSON* writes `favorites.json`;
   *Import JSON* merges or replaces, and dropping the file into the window works
   too.

If a query cannot be resolved, the card shows a *Link to a title* box: paste an
IMDb or Kinopoisk URL and the entry becomes a normal, saveable card.

## Architecture

```
index.html            UI, search pipeline, card builder, favourites, themes
ai-ui.js              gear panel (provider/model) and the wish search block
api/discover.js       TMDB proxy: health / genres / imdb / search / discover
api/favorites.js      shared favourites store on Vercel Blob, server-side merge
api/pick.js           picks one title from the watchlist (AI or heuristic)
api/ai.js             model catalogue, model selection, wish search
lib/ai-providers.js   provider registry, model discovery, live checks, cache
infra/                Terraform description of the Vercel environment
scripts/              local checks reused by CI
.github/workflows/    static checks on every push and pull request
```

```
browser (static)
  |-- /api/discover  --> TMDB                (key stays server-side, edge cache)
  |-- /api/favorites --> Vercel Blob         (merge, then one shared JSON file)
  |-- /api/pick      --> LLM or heuristic    (chosen provider, cached 12 h)
  '-- /api/ai        --> LLM + TMDB          (candidates from TMDB, model ranks)
```

Design rules that the code follows:

- No secret is ever sent to the browser; only names, ids and results are.
- Every outbound call has a timeout, and every feature has a degraded mode.
- State that must be shared lives in one place (Blob); state that may be local
  lives in `localStorage` with a 24 hour TTL.
- The model is never the source of truth about the world; a database is.

## How a card is built

```
query -> suggestions -> candidate list -> card -> favourites
```

1. **Normalisation** - the query is lower-cased, `e/yo` folded and
   transliterated into several key variants.
2. **Candidate search** - IMDb suggest, Cinemeta, TVmaze, Wikidata and Kinopoisk
   suggest are queried in parallel; candidates below `relScore` 0.34 are dropped.
3. **Card build** - the IMDb id is resolved directly or through the Wikidata
   link to the Kinopoisk id, then all rating sources are fetched in parallel
   under individual budgets and rendered progressively.
4. **Average score** - every available score is normalised to 0-100 and averaged.
5. **Caching** - resolved cards and searches are cached in `localStorage` for 24
   hours; empty or failed results are never cached.
6. **Favourites** - entries are written locally and merged into the shared store
   through `/api/favorites`.

## How the AI features work

**Provider selection.** `lib/ai-providers.js` holds a registry of
OpenAI-compatible providers in preference order (Groq, Mistral, Inception
Mercury, Agnes). For the first configured key it lists the real models from
`/models`, matches the preferred name by normalised comparison, sends a minimal
chat request as a probe, and caches the working `provider/model` pair in Blob for
12 hours. A failure invalidates the cache and the next provider is tried, so a
dead provider costs one request, not the feature.

**Wish search (retrieval first, model second).** A free-text wish is answered in
this order:

1. A year window is parsed from the text (`2024-2026`, `since 2024`, `new`) or
   taken from the two year fields; genre keywords are recognised in English and
   Russian and mapped to TMDB genre ids (translated for TV).
2. When a window is present, candidates are discovered from TMDB inside that
   window - two passes per media type, by score and by popularity.
3. The model receives that fixed candidate list and may only return ids from it,
   with one short reason each; it cannot invent titles.
4. Without a window the model proposes titles, each one is verified in TMDB, and
   anything that cannot be found is returned marked as unverified.

That ordering is deliberate: a model with a 2023 knowledge cutoff cannot answer
a question about 2026 releases from memory, so the database provides the facts
and the model provides the ranking and the explanation.

## API reference

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/discover?mode=health` | GET | reports whether the TMDB key is configured |
| `/api/discover?mode=genres` | GET | localised genre lists for movies and TV |
| `/api/discover?mode=imdb&id=...` | GET | resolves a TMDB id to an IMDb id |
| `/api/discover?mode=search&q=...` | GET | title search |
| `/api/discover?mode=discover&...` | GET | filtered browsing (default mode) |
| `/api/favorites` | GET | the shared list |
| `/api/favorites` | POST | merge a client list into the shared one |
| `/api/favorites?debug=1` | GET | storage diagnostics |
| `/api/pick` | GET | current engine: provider, model, verification time |
| `/api/pick?probe=1` | GET | live check of every configured provider |
| `/api/pick` | POST | pick one title from the given watchlist |
| `/api/ai?action=models` | GET | providers, their real model lists, current choice |
| `/api/ai` | POST `{action:"select"}` | validate and store a provider/model choice |
| `/api/ai` | POST `{action:"suggest"}` | wish search verified against TMDB |

Example: `/api/discover?mode=discover&type=tv&country=IL&sort=votes`

```bash
curl -s -X POST https://cinemarate.vercel.app/api/ai \
  -H 'content-type: application/json' \
  -d '{"action":"suggest","wish":"clever gripping detective 2024-2026","kind":"movie"}'
```

## Configuration

| Variable | Required | Effect |
| --- | --- | --- |
| `TMDB_KEY` | for discovery and AI verification | TMDB v3 key or v4 read token, server-side only |
| `FAVORITES_TOKEN` | no | when set, `/api/favorites`, `/api/pick` and `/api/ai` require the secret; the browser stores it once from `?token=...` |
| `GROQ_API_KEY` | no | enables the AI features through Groq |
| `MISTRAL_API_KEY` | no | enables the AI features through Mistral |
| `INCEPTION_MERCURY_API_KEY` | no | enables the AI features through Inception Mercury |
| `AGNES_AI_20_FLASH_API_KEY` | no | enables the AI features through Agnes AI |
| `AI_PROVIDER` | no | pin one provider: `groq`, `mistral`, `inception`, `agnes` |
| `GROQ_MODEL` / `MISTRAL_MODEL` / `INCEPTION_MODEL` / `AGNES_MODEL` | no | preferred model name, still matched against the provider's real list |
| `GROQ_BASE_URL` / `MISTRAL_BASE_URL` / `INCEPTION_BASE_URL` / `AGNES_BASE_URL` | no | override an OpenAI-compatible base URL without touching code |

Several provider keys can coexist. Blob credentials are injected by Vercel
through OIDC and are not part of this table.

## Development

```bash
npx vercel dev                          # local server with the functions
node --check api/ai.js                  # syntax check a function
node scripts/check-inline-js.mjs index.html   # parse the inline scripts
```

Conventions:

- Plain ES2020 in the browser, CommonJS in the functions; no build step and no
  runtime dependencies beyond `@vercel/blob`.
- `index.html` is the whole front end; new client behaviour goes into a small
  self-contained script such as `ai-ui.js`.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`).

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: it syntax-checks
every serverless function with `node --check` and parses the inline scripts of
`index.html` with `scripts/check-inline-js.mjs`. Vercel adds a preview
deployment per pull request and a production deployment for `main`.

## Infrastructure as code

`infra/` describes the Vercel project, its environment variables and the domain
with the official Vercel Terraform provider, so the hosting side is reviewable
and reproducible instead of being a memory of dashboard clicks.

```bash
cd infra
export VERCEL_API_TOKEN=...
terraform init
terraform plan
```

See [`infra/README.md`](infra/README.md) for adopting an existing project with
`terraform import`, and [`infra/MANUAL.md`](infra/MANUAL.md) for the steps that
stay manual and for the recovery drill.

## Operations and verification

| Check | Expected |
| --- | --- |
| `/api/discover?mode=health` | `hasKey: true` |
| `/api/favorites?debug=1` | `hasStoreId: true` and a successful read probe |
| `/api/pick` | provider, model and the verification timestamp |
| `/api/pick?probe=1` | one row per provider: model count, chosen model, sample answer or the exact error |
| `/api/ai?action=models` | providers with their real model lists and no secrets |
| Favourites panel | says *Shared store* with an entry count |
| Actions tab | the CI run is green |

A failing provider is visible in one request, and the answer says which
provider, which model and which error - the same shape of evidence you would
want from any production dependency.

## Security model

- **Secrets stay server-side.** TMDB and provider keys exist only as environment
  variables inside the functions. The browser sends and receives names, ids and
  results.
- **The gear panel is not an escape hatch.** A choice is accepted only if the
  provider has a key on the server and the model appears in that provider's own
  live model list, and it is probed before being stored.
- **Optional shared secret.** With `FAVORITES_TOKEN` set, the list and both AI
  endpoints require the token, which the browser stores once from `?token=...`.
- **No accounts, no tracking, no third-party analytics.** The only stored state
  is the favourites file and the cached provider choice.
- **Concurrent edits.** The favourites POST merges by key instead of replacing,
  so two devices editing the same list cannot silently drop entries.

## Roadmap

- Filters and sorting inside Favourites (year, rating, genre, country).
- Rate limiting on the AI endpoints and a nightly backup of the shared list.
- Log drain plus an SLO with alerting.
- Wikidata SPARQL as an optional second discovery source for small countries.
- PWA install support, personal ratings and statistics, CSV export.

## Documentation map

| Document | Language | Content |
| --- | --- | --- |
| [`DEPLOY.md`](DEPLOY.md) | English | deployment and troubleshooting |
| [`docs/PITCH.en.md`](docs/PITCH.en.md) | English | one-page brief for a walkthrough |
| [`docs/PITCH.he.md`](docs/PITCH.he.md) | Hebrew | the same brief |
| [`docs/FLOW.ru.md`](docs/FLOW.ru.md) | Russian | the whole flow, from zero |
| [`docs/AI_SETUP.ru.md`](docs/AI_SETUP.ru.md) | Russian | provider keys, models, the gear panel |
| [`docs/SKILLS.ru.md`](docs/SKILLS.ru.md) | Russian | which skills this project demonstrates |
| [`infra/README.md`](infra/README.md) | English | Terraform usage |
| [`infra/MANUAL.md`](infra/MANUAL.md) | English | manual steps and recovery drill |

## Contributing

Issues and pull requests are welcome. Please keep the project's constraints:
no build step, no runtime framework, no secret in client code, and every new
outbound call must have a timeout and a degraded path. Before opening a pull
request run the two checks from [Development](#development); CI runs the same
ones.

## License

MIT. This is a personal, non-commercial project.

## Acknowledgements

This product uses the TMDB API but is not endorsed or certified by TMDB. Ratings
belong to IMDb, Kinopoisk, Rotten Tomatoes and Metacritic respectively; metadata
comes from TMDB, Cinemeta, TVmaze and Wikidata. Hosting, functions and storage
are provided by Vercel.
