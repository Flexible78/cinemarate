# CinemaRate - one-page brief

**What it is.** A single-page web app that merges movie and TV ratings from
several public sources into one card, keeps a watchlist shared across devices,
and finds titles by filters. Two people use it daily.

**Architecture.** A static `index.html` (no framework, no build step) plus four
Vercel serverless functions: `api/discover.js` (TMDB proxy), `api/favorites.js`
(shared store on Vercel Blob), `api/pick.js` ("what do we watch tonight?").

**Engineering decisions worth defending.**

- The TMDB key lives only in a server-side environment variable; the browser
  never sees it.
- Responses are cached at the CDN edge - one day for search, one week for genre
  and IMDb lookups - so the upstream rate limit is never reached.
- Writes to the shared list are merged on the server: every request carries the
  keys the client last saw, so a concurrent add from another device survives and
  only a real deletion removes anything. This replaced a last-write-wins
  overwrite that silently lost entries.
- Every external call has its own time budget and the card renders
  progressively, so a slow source degrades the page instead of blocking it.
- The AI pick works without any provider configured: with a key it uses Mistral,
  without one a local heuristic answers in the same response shape.
- The prompt treats titles and notes as untrusted data, and the key the model
  returns is validated against the list that was sent.

**Operations.** GitHub Actions checks the syntax of every function and of the
inline browser script on each push, and fails the build if an `.env` file or a
key-shaped literal is ever committed. The Vercel environment is described with
Terraform in `infra/`; the steps that cannot be automated yet - the Blob store
above all - are documented in `infra/MANUAL.md` along with a recovery drill.

**Next.** Log drain and an SLO with alerting, a nightly backup of the shared
list, rate limiting on the functions.
