# CinemaRate - interview defense pack

What the project is, what my role was, the full flow from idea to production,
the decisions I am ready to defend, and ready-made paragraphs to say out loud.

Live: https://cinemarate.vercel.app
Code: https://github.com/Flexible78/cinemarate

## 1. What is in the pack

| File | Language | Purpose |
| --- | --- | --- |
| docs/DEFENSE.ru.md | RU | main defense text |
| docs/DEFENSE.en.md | EN | this file |
| docs/DEFENSE.he.md | HE | the same in Hebrew |
| docs/DEFENSE_PACK.md | RU/EN | pack index and a five-minute demo script |
| docs/FLOW.ru.md | RU | bring the project up from zero, all checks |
| docs/AI_SETUP.ru.md | RU | AI providers, keys, diagnostics |
| docs/SKILLS.ru.md | RU | CV lines and phrasings |
| docs/PITCH.en.md, docs/PITCH.he.md | EN, HE | one-page pitch |
| README.md, DEPLOY.md | RU | project overview and deploy procedure |

## 2. The project in three sentences

CinemaRate merges movie and TV ratings from several public sources into a
single card, keeps one shared watchlist in the cloud across two devices, and
suggests what to watch tonight.
The frontend is static - no framework, no build step - and everything that
needs secrets or outbound calls lives in Vercel serverless functions.
It is used every day, so the decisions were validated by real operation rather
than by demo data.

## 3. My role

I owned the whole cycle alone: product, frontend, serverless backend,
integrations, infrastructure as code, CI, deployment, operations and docs.

- Product: the requirements came from a real household scenario - two people
  picking a film for the evening.
- Frontend: `index.html` and `ai-ui.js` - search, card, watchlist, themes, the
  AI suggestion panel.
- Backend: four functions - `api/discover.js` (TMDB proxy),
  `api/favorites.js` (shared list on Vercel Blob), `api/pick.js` (pick for
  tonight), `api/ai.js` (filtered idea list).
- Integrations: TMDB plus several OpenAI-compatible model providers through
  `lib/ai-providers.js`.
- Infrastructure: `infra/` in Terraform plus an honest `infra/MANUAL.md` for
  the steps that are still manual.
- Quality: `scripts/check-inline-js.mjs` and GitHub Actions on every push.
- Operations: production deploys, live endpoint verification, debugging issues
  reported by real users.

## 4. The full flow

### 4.1 Delivery flow: how a change happens

1. The problem is stated in user words, not code words: the card does not open
   from the AI list.
2. I read the existing code and reproduce the behaviour before touching it.
3. I look for the cause, not the symptom: the outbound call had no timeout and
   the status line was never cleared, so the UI stayed on `opening the card`
   forever.
4. Minimal fix, one intent per commit.
5. Local checks: `node --check` on each function and
   `node scripts/check-inline-js.mjs index.html`.
6. Commit with a meaningful message, push to `main`.
7. CI on GitHub Actions: function syntax, inline script syntax, a guard
   against committing secrets.
8. Production deploy: `npx vercel --prod --yes`.
9. Verify on the live URL with a cache-busted request: the file is served, the
   expected functions are present, `age=0`.
10. Documentation is updated together with the code.

Operational lesson: `git push` alone is not enough - until the deploy runs and
a cache-busted request confirms it, users still see the old build.

### 4.2 User flow

1. Open the page, type a title or set filters.
2. Search goes through `api/discover.js`; the TMDB key stays on the server.
3. The card is built progressively: TMDB, IMDb, Rotten Tomatoes, Metacritic,
   Kinopoisk, trailer - a slow source degrades the card instead of blocking
   the page.
4. The add button stores the entry in the shared list; the select sets the
   category.
5. The shared list syncs through `api/favorites.js`: the server merges states,
   so an add from the other device is never lost.
6. AI panel: kind, years, find - the model returns an idea list, and every row
   can be opened as a card and saved to the list exactly like a plain search
   result.
7. If AI is unavailable, a local heuristic answers in the same shape.

## 5. Architecture

| Component | What it is | Responsibility |
| --- | --- | --- |
| `index.html` | static frontend | UI, search, card, watchlist, themes |
| `ai-ui.js` | client module | AI suggestion panel and card opening |
| `api/discover.js` | function | TMDB proxy: health, genres, imdb, search, discover |
| `api/favorites.js` | function | shared list on Vercel Blob, server-side merge |
| `api/pick.js` | function | one pick for tonight |
| `api/ai.js` | function | filtered idea list with relevance checks |
| `lib/ai-providers.js` | library | provider registry, model resolution and verification |
| `infra/` | Terraform | Vercel environment described as code |
| `.github/workflows/ci.yml` | CI | checks on every push and pull request |

## 6. Decisions I defend

- **Secrets server-side only.** TMDB and model provider keys are function
  environment variables; the browser never sees them. CI fails if a `.env`
  file or a key-shaped literal is committed.
- **Server-side merge instead of last-write-wins.** The shared list silently
  lost entries because the client shipped its whole state and overwrote the
  file. Now each POST carries both the items and the keys the browser last
  saw, so a concurrent add from another device survives and only a real
  deletion removes anything.
- **CDN caching.** Responses are cached at the edge - a day for search, a week
  for genre and IMDb lookups - so the upstream rate limit is never reached.
- **A time budget on every external call, plus progressive rendering.** A slow
  source degrades the card instead of freezing the page. The stuck-status bug
  was exactly this: I added an abort timeout, a single `finally` that clears
  the status, and two fallbacks - search by title and a direct IMDb link.
- **Provider-agnostic AI.** Several OpenAI-compatible providers are
  registered, the model id is resolved against the provider's own model list,
  verified with a tiny live request, and the working pair is cached for 12
  hours. With no key, or with every provider down, a local heuristic answers
  in the same shape.
- **The model answer is validated.** Titles and notes are marked as data, not
  instructions, and the key returned by the model is checked against the list
  that was sent. Genre, kind and year relevance filters were added because the
  model returned off-target rows.
- **Infrastructure as code with an honest boundary.** What can be automated is
  in Terraform; what cannot yet is documented in `infra/MANUAL.md` together
  with a recovery drill.

## 7. Interview paragraph

### 30 seconds

I built and still run CinemaRate in production - a site we use every day:
ratings from several sources in one card and one shared watchlist across two
devices. Static frontend, four serverless functions, the environment described
in Terraform, CI on every push. The interesting part is not the UI but the
reliability work: a server-side merge for the shared list instead of
last-write-wins, a timeout on every external call, and a fallback for the AI
suggestions.

### 2 minutes

CinemaRate solves an everyday problem: not opening five sites to decide
whether a film is worth watching, and not losing the watchlist. The frontend
is static, with no framework and no build step; everything that needs secrets
lives in serverless functions - a TMDB proxy, the shared list on Blob storage,
and the AI suggestion endpoint. Keys exist only as environment variables, and
CI fails if a secret is committed.
Two stories I am proud of. First, the shared list silently lost entries
because the client overwrote the whole file - a textbook lost update. I moved
writes to a server-side merge that carries the client's base state, and
concurrent adds from the other device stopped disappearing. Second, in the AI
panel the open-card button hung on `opening the card` because the outbound
request had no timeout and the status was never cleared. I added an abort
timeout, a single status reset and two fallbacks, so now any row in the list
opens exactly like a plain search result.
Next on the list: a log drain and an SLO with alerting, a nightly backup of
the shared list, and rate limiting on the functions. I deliberately do not
claim these are done - the docs keep what works separate from what is planned.

## 8. Expected questions

**Why no framework?** The scope did not need a build step, and skipping the
pipeline removed a whole class of problems. In exchange, CI checks the inline
browser script so the static HTML cannot break unnoticed.

**How did you find the lost entries?** From a real user symptom: an entry
added on the phone disappeared after a save from the laptop. Then
reproduction and a look at the write ordering.

**What if an external API is down?** Every call has a time budget, the card
renders in parts, and the AI pick falls back to a local heuristic. Health and
debug endpoints separate a missing key from a silent upstream.

**Why Terraform in such a small project?** So the environment can be
reproduced and reviewed in a pull request instead of rebuilt from memory in a
dashboard.

**What would you do next?** Monitoring and an SLO with alerting, then an
automatic backup of the list, then rate limiting on the functions.

## 9. Pre-demo checks

- `/api/discover?mode=health` returns `hasKey: true`.
- `/api/favorites?debug=1` returns `hasStoreId: true` and a successful read
  probe.
- `/api/pick` (GET) returns `ai`, `provider`, `model`, `engine`,
  `configured`, `verified`.
- The watchlist panel shows the shared store and the entry count.
- Actions tab: a green CI run.
- A cache-busted request for the static asset: `age=0` and the expected size.

## 10. Next

- log drain and an SLO with alerting;
- nightly backup of the shared list;
- rate limiting on the functions;
- filters and sorting inside the watchlist.
