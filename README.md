# CinemaRate

Live demo: https://cinemarate.vercel.app

CinemaRate is a single-page web app that aggregates movie and TV ratings from
several public sources into one card, keeps a shared "Favorites" list in the
cloud, and lets you discover titles by genre, country, language, year and
rating. The UI is in Russian and understands Cyrillic queries, including
transliteration ("artur stron" -> "Artur Stron").

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
- **Three themes** - dark, high-contrast and light, cycled by one small button
  and remembered in `localStorage`.

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

## Run locally

```bash
npm install
npx vercel dev
```

Set `TMDB_KEY` (a TMDB v3 key or a v4 read token) in your local environment or
in the Vercel project settings; the discovery panel is disabled without it.
`api/favorites.js` needs a Vercel Blob store connected to the project, and the
rest of the app works without any key at all.

## Deploy

```bash
npx vercel --prod
```

See `DEPLOY.md` (Russian) for the step-by-step setup of the Blob store and for
troubleshooting favorites sync.

## Roadmap

- Filters and sorting inside Favorites (year, rating, genre, country).
- Wikidata SPARQL as an optional second discovery source for small countries.
- PWA install support, personal ratings and statistics, CSV export.

## Notes

This is a personal, non-commercial project. It uses the TMDB API but is not
endorsed or certified by TMDB; all ratings belong to their respective sources.
The shared favorites store is public by design: anyone who knows the site
address can read and edit that list.
