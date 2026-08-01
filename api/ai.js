// AI settings (gear menu) and the "describe what you want" search.
//
// Safety rules that must stay true:
// - No API key is ever sent to the browser, and none is ever accepted from it.
//   The browser sends only a provider NAME and a model ID.
// - Both are validated on the server against that provider's own live model
//   list, so a crafted request cannot point the app at another host or model.
// - When FAVORITES_TOKEN is set, every call here requires it, exactly like the
//   shared favorites list.
//
// GET  /api/ai?action=models
//        -> { providers: [{ provider, models[], error }], selection, pinned }
// POST /api/ai { action: "select", provider, model }
//        -> verifies the pair with a tiny live request and saves it (shared by
//           both devices); provider "auto" returns to automatic discovery.
// POST /api/ai { action: "suggest", wish, kind, count }
//        -> the model proposes titles, then every title is verified against
//           TMDB (real score and vote count) and linked to the rating sites.
const ai = require("../lib/ai-providers")

const AI_TIMEOUT_MS = 15000
const TMDB_TIMEOUT_MS = 8000
const TMDB = "https://api.themoviedb.org/3"
const IMG = "https://image.tmdb.org/t/p/w300"
const MAX_ITEMS = 8

const KINDS = {
	any: "any kind of title",
	movie: "feature films only",
	series: "TV series only",
	documentary: "documentaries only",
	animation: "animation or cartoons only",
}

const SUGGEST_SYSTEM = [
	"You recommend films and TV shows to a couple choosing something to watch.",
	"Answer with JSON only - no prose, no markdown fences:",
	'{"items":[{"title":"English title","year":2014,"kind":"movie|series|documentary|animation","why":"one short sentence"}]}',
	"Always give the English release title so it can be verified in a film database.",
	"Only real, released titles. Prefer well reviewed ones and vary the picks.",
].join(" ")

const RANK_SYSTEM = [
	"You choose the best matches for a viewer from a fixed candidate list.",
	"Use only the ids that were given. Never invent titles, ids or years.",
	'Answer with JSON only: {"items":[{"id":"movie:123","why":"one short sentence"}]}',
	"Best match first, and keep every why under 120 characters.",
].join(" ")

// Wish keywords -> TMDB movie genre ids (Russian and English wording).
const GENRE_WORDS = [
	{ id: 9648, words: ["детектив", "mystery", "whodunit", "загадк", "следовател", "расследов"] },
	{ id: 80, words: ["криминал", "crime", "мафи", "gangster", "банд"] },
	{ id: 53, words: ["триллер", "thriller", "захватыва", "напряж", "gripping", "suspense"] },
	{ id: 18, words: ["драм", "drama"] },
	{ id: 35, words: ["комеди", "comedy", "смешн", "funny"] },
	{ id: 878, words: ["фантастик", "sci-fi", "science fiction", "космос", "space"] },
	{ id: 27, words: ["ужас", "horror", "страшн"] },
	{ id: 99, words: ["документ", "documentary"] },
	{ id: 16, words: ["мультфильм", "мультик", "анимац", "animation", "cartoon"] },
	{ id: 10751, words: ["семейн", "family"] },
	{ id: 10749, words: ["романти", "romance", "любов", "love story"] },
	{ id: 28, words: ["боевик", "action"] },
	{ id: 12, words: ["приключен", "adventure"] },
	{ id: 14, words: ["фэнтези", "fantasy", "волшебн"] },
	{ id: 36, words: ["историч", "history", "historical"] },
	{ id: 10752, words: ["военн", "война"] },
	{ id: 37, words: ["вестерн", "western"] },
]

// TV uses a different genre table, so movie ids are translated or dropped.
const TV_GENRE_MAP = { 878: 10765, 14: 10765, 28: 10759, 12: 10759, 53: 9648, 10752: 10768 }
const TV_GENRE_OK = [9648, 80, 18, 35, 16, 99, 37, 10751, 10759, 10762, 10763, 10764, 10765, 10766, 10767, 10768]

function genresFor(wish) {
	const s = String(wish || "").toLowerCase()
	const ids = []
	GENRE_WORDS.forEach(function (g) {
		const hit = g.words.some(function (w) {
			return s.indexOf(w) !== -1
		})
		if (hit && ids.indexOf(g.id) === -1) ids.push(g.id)
	})
	return ids
}

function tvGenres(ids) {
	const out = []
	ids.forEach(function (id) {
		const v = TV_GENRE_MAP[id] !== undefined ? TV_GENRE_MAP[id] : id
		if (TV_GENRE_OK.indexOf(v) !== -1 && out.indexOf(v) === -1) out.push(v)
	})
	return out
}

// "2024-2026", "since 2024", "2025 года", "новинки" all become a real window.
// Explicit yearFrom/yearTo fields from the search panel always win.
function parseYears(wish, body) {
	const now = new Date().getFullYear()
	let from = Number(body && body.yearFrom) || null
	let to = Number(body && body.yearTo) || null
	const s = String(wish || "")
	if (!from && !to) {
		const range = s.match(/((?:19|20)\d{2})\s*(?:-{1,2}|\u2013|\u2014|\.\.|to|по)\s*((?:19|20)\d{2})/i)
		if (range) {
			from = Number(range[1])
			to = Number(range[2])
		}
	}
	if (!from && !to) {
		const since = s.match(/(?:since|after|from|начиная с|позже)\s*((?:19|20)\d{2})/i)
		if (since) {
			from = Number(since[1])
			to = now + 1
		}
	}
	if (!from && !to) {
		const one = s.match(/((?:19|20)\d{2})/)
		if (one) {
			from = Number(one[1])
			to = Number(one[1])
		}
	}
	if (!from && !to && /нов(ый|ые|инк|енько)|свеж|недавн|recent|latest|brand new/i.test(s)) {
		from = now - 2
		to = now + 1
	}
	if (from && !to) to = now + 1
	if (to && !from) from = 1900
	if (from && to && from > to) {
		const t = from
		from = to
		to = t
	}
	return from && to ? { from: from, to: to } : null
}

function inRange(year, years) {
	if (!years) return true
	const y = Number(year) || 0
	if (!y) return false
	return y >= years.from && y <= years.to
}

function tokenOk(req) {
	const want = String(process.env.FAVORITES_TOKEN || "").trim()
	if (!want) return true
	const got = String(
		req.headers["x-favorites-token"] || (req.query && req.query.token) || "",
	).trim()
	return got === want
}

async function readBody(req) {
	if (req.body && typeof req.body === "object") return req.body
	if (typeof req.body === "string" && req.body) {
		try {
			return JSON.parse(req.body)
		} catch (e) {
			return {}
		}
	}
	const chunks = []
	for await (const c of req) chunks.push(c)
	const raw = Buffer.concat(chunks).toString("utf8")
	if (!raw) return {}
	try {
		return JSON.parse(raw)
	} catch (e) {
		return {}
	}
}

function norm(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
}

function parseItems(text) {
	const tryParse = function (s) {
		try {
			return JSON.parse(s)
		} catch (e) {
			return null
		}
	}
	let data = tryParse(String(text || "").trim())
	if (!data) {
		const s = String(text || "")
		const a = s.indexOf("{")
		const b = s.lastIndexOf("}")
		if (a !== -1 && b > a) data = tryParse(s.slice(a, b + 1))
	}
	if (!data) {
		const s = String(text || "")
		const a = s.indexOf("[")
		const b = s.lastIndexOf("]")
		if (a !== -1 && b > a) data = tryParse(s.slice(a, b + 1))
	}
	const raw = Array.isArray(data)
		? data
		: (data && (data.items || data.results || data.titles)) || []
	return (Array.isArray(raw) ? raw : [])
		.map(function (it) {
			if (typeof it === "string") return { title: it, year: null, kind: "", why: "" }
			if (!it || !it.title) return null
			return {
				title: String(it.title).slice(0, 120),
				year: Number(it.year) || null,
				kind: String(it.kind || "").slice(0, 20),
				why: String(it.why || it.reason || "").slice(0, 200),
			}
		})
		.filter(Boolean)
}

async function chat(prov, messages, maxTokens, wantJson) {
	const ctrl = new AbortController()
	const timer = setTimeout(function () {
		ctrl.abort()
	}, AI_TIMEOUT_MS)
	try {
		const payload = {
			model: prov.model,
			temperature: 0.7,
			max_tokens: maxTokens,
			messages: messages,
		}
		if (wantJson) payload.response_format = { type: "json_object" }
		const r = await fetch(prov.endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				authorization: "Bearer " + prov.key,
			},
			body: JSON.stringify(payload),
			signal: ctrl.signal,
		})
		const body = await r.json().catch(function () {
			return null
		})
		if (!r.ok) {
			const m =
				(body && body.error && (body.error.message || body.error)) ||
				(body && body.message) ||
				"http_" + r.status
			throw new Error(String(m).slice(0, 200))
		}
		return ai.answerText(body)
	} finally {
		clearTimeout(timer)
	}
}

// Not every provider supports JSON mode; the retry keeps the feature working.
async function askForTitles(prov, wish, kind, count, years) {
	const messages = [
		{ role: "system", content: SUGGEST_SYSTEM },
		{
			role: "user",
			content: JSON.stringify({
				wish: wish,
				constraint: KINDS[kind] || KINDS.any,
				how_many: count,
				released_between: years ? [years.from, years.to] : undefined,
				rule: years
					? "only titles first released between " + years.from + " and " + years.to
					: undefined,
			}),
		},
	]
	let text = ""
	try {
		text = await chat(prov, messages, 700, true)
	} catch (e) {
		text = await chat(prov, messages, 700, false)
	}
	let items = parseItems(text)
	if (!items.length) {
		text = await chat(prov, messages, 700, false)
		items = parseItems(text)
	}
	return items.slice(0, count)
}

async function tmdb(path, params) {
	const key = String(process.env.TMDB_KEY || "").trim()
	if (!key) return null
	const qs = new URLSearchParams(params || {})
	const headers = { accept: "application/json" }
	if (key.length > 60) headers.authorization = "Bearer " + key
	else qs.set("api_key", key)
	const ctrl = new AbortController()
	const timer = setTimeout(function () {
		ctrl.abort()
	}, TMDB_TIMEOUT_MS)
	try {
		const r = await fetch(TMDB + path + "?" + qs.toString(), {
			headers: headers,
			signal: ctrl.signal,
		})
		if (!r.ok) return null
		return await r.json()
	} catch (e) {
		return null
	} finally {
		clearTimeout(timer)
	}
}

function pickBest(results, item) {
	const list = (results || []).filter(function (r) {
		return r && (r.media_type === "movie" || r.media_type === "tv" || r.title || r.name)
	})
	if (!list.length) return null
	const want = norm(item.title)
	const year = Number(item.year) || null
	let best = null
	let bestScore = -1
	list.forEach(function (r) {
		const t = norm(r.title || r.name || "")
		const d = String(r.release_date || r.first_air_date || "")
		const y = Number(d.slice(0, 4)) || null
		let score = 0
		if (t && t === want) score += 6
		else if (t && want && (t.indexOf(want) === 0 || want.indexOf(t) === 0)) score += 3
		if (year && y && Math.abs(y - year) <= 1) score += 3
		score += Math.min(2, (Number(r.vote_count) || 0) / 5000)
		if (score > bestScore) {
			bestScore = score
			best = r
		}
	})
	return best
}

function ratingLinks(title, year) {
	const q = encodeURIComponent(String(title || "") + (year ? " " + year : ""))
	return {
		imdb: "https://www.imdb.com/find/?q=" + q,
		rottenTomatoes: "https://www.rottentomatoes.com/search?search=" + q,
		metacritic: "https://www.metacritic.com/search/all/" + q + "/results",
		kinopoisk: "https://www.kinopoisk.ru/index.php?kp_query=" + q,
		trailer: "https://www.youtube.com/results?search_query=" + q + "+trailer",
	}
}

// Verify one proposed title against TMDB: real score, votes, poster, year.
async function enrich(item) {
	const out = {
		title: item.title,
		year: item.year,
		kind: item.kind || "",
		why: item.why || "",
		found: false,
		average: null,
		votes: null,
		poster: "",
		overview: "",
		links: ratingLinks(item.title, item.year),
	}
	const data = await tmdb("/search/multi", {
		query: item.title,
		include_adult: "false",
		language: "en-US",
		page: "1",
	})
	const hit = pickBest(data && data.results, item)
	if (!hit) return out
	const d = String(hit.release_date || hit.first_air_date || "")
	out.found = true
	out.title = String(hit.title || hit.name || item.title)
	out.year = Number(d.slice(0, 4)) || item.year
	out.kind = hit.media_type === "tv" ? "series" : item.kind || "movie"
	out.average = hit.vote_average ? Math.round(Number(hit.vote_average) * 10) : null
	out.votes = Number(hit.vote_count) || null
	out.poster = hit.poster_path ? IMG + hit.poster_path : ""
	out.overview = String(hit.overview || "").slice(0, 300)
	out.links = ratingLinks(out.title, out.year)
	out.links.tmdb =
		"https://www.themoviedb.org/" + (hit.media_type === "tv" ? "tv/" : "movie/") + hit.id
	return out
}

function parseRanked(text) {
	const s = String(text || "")
	const tryParse = function (x) {
		try {
			return JSON.parse(x)
		} catch (e) {
			return null
		}
	}
	let data = tryParse(s.trim())
	if (!data) {
		const a = s.indexOf("{")
		const b = s.lastIndexOf("}")
		if (a !== -1 && b > a) data = tryParse(s.slice(a, b + 1))
	}
	if (!data) {
		const a = s.indexOf("[")
		const b = s.lastIndexOf("]")
		if (a !== -1 && b > a) data = tryParse(s.slice(a, b + 1))
	}
	const raw = Array.isArray(data) ? data : (data && (data.items || data.picks || data.results)) || []
	return (Array.isArray(raw) ? raw : [])
		.map(function (it) {
			if (typeof it === "string") return { id: it, why: "" }
			if (!it || !it.id) return null
			return { id: String(it.id), why: String(it.why || it.reason || "").slice(0, 160) }
		})
		.filter(Boolean)
}

function fromTmdb(r) {
	const isTv = Boolean(r.first_air_date || r.name) && !r.title
	const d = String(r.release_date || r.first_air_date || "")
	const title = String(r.title || r.name || "")
	const year = Number(d.slice(0, 4)) || null
	const links = ratingLinks(title, year)
	links.tmdb = "https://www.themoviedb.org/" + (isTv ? "tv/" : "movie/") + r.id
	return {
		key: (isTv ? "tv:" : "movie:") + r.id,
		title: title,
		year: year,
		kind: isTv ? "series" : "movie",
		why: "",
		found: true,
		average: r.vote_average ? Math.round(Number(r.vote_average) * 10) : null,
		votes: Number(r.vote_count) || null,
		poster: r.poster_path ? IMG + r.poster_path : "",
		overview: String(r.overview || "").slice(0, 300),
		links: links,
	}
}

async function discoverPage(tv, years, genres, sort, minVotes) {
	const params = {
		include_adult: "false",
		language: "en-US",
		page: "1",
		sort_by: sort,
	}
	if (minVotes) params["vote_count.gte"] = String(minVotes)
	if (genres.length) params.with_genres = genres.join(",")
	if (tv) {
		params["first_air_date.gte"] = years.from + "-01-01"
		params["first_air_date.lte"] = years.to + "-12-31"
	} else {
		params["primary_release_date.gte"] = years.from + "-01-01"
		params["primary_release_date.lte"] = years.to + "-12-31"
	}
	const data = await tmdb(tv ? "/discover/tv" : "/discover/movie", params)
	return (data && data.results) || []
}

// Real releases inside the requested window, straight from TMDB. A model whose
// knowledge ends in 2023 cannot answer a 2024-2026 request from memory, so the
// candidate list has to come from the database, not from the model.
async function discoverCandidates(kind, years, genreIds) {
	const onlyTv = kind === "series"
	const alsoTv = kind === "any" || kind === "documentary" || kind === "animation"
	const genres = genreIds.slice()
	if (kind === "documentary" && genres.indexOf(99) === -1) genres.push(99)
	if (kind === "animation" && genres.indexOf(16) === -1) genres.push(16)
	const jobs = []
	if (!onlyTv) {
		jobs.push(discoverPage(false, years, genres, "vote_average.desc", 100))
		jobs.push(discoverPage(false, years, genres, "popularity.desc", 0))
	}
	if (onlyTv || alsoTv) {
		const tvg = tvGenres(genres)
		jobs.push(discoverPage(true, years, tvg, "vote_average.desc", 50))
		jobs.push(discoverPage(true, years, tvg, "popularity.desc", 0))
	}
	const pages = await Promise.all(
		jobs.map(function (p) {
			return p.catch(function () {
				return []
			})
		}),
	)
	const seen = {}
	const out = []
	pages.forEach(function (list) {
		list.forEach(function (r) {
			const item = fromTmdb(r)
			if (!item.title || !inRange(item.year, years) || seen[item.key]) return
			seen[item.key] = true
			out.push(item)
		})
	})
	out.sort(function (a, b) {
		return (b.average || 0) - (a.average || 0)
	})
	return out.slice(0, 40)
}

// The model only ranks and explains; it cannot add anything to the list.
async function rankCandidates(prov, wish, kind, years, cands, count) {
	const shortlist = cands.map(function (c) {
		return {
			id: c.key,
			title: c.title,
			year: c.year,
			kind: c.kind,
			score: c.average,
			votes: c.votes,
			plot: String(c.overview || "").slice(0, 160),
		}
	})
	const messages = [
		{ role: "system", content: RANK_SYSTEM },
		{
			role: "user",
			content: JSON.stringify({
				wish: wish,
				constraint: KINDS[kind] || KINDS.any,
				released_between: [years.from, years.to],
				how_many: count,
				candidates: shortlist,
			}),
		},
	]
	let text = ""
	try {
		text = await chat(prov, messages, 900, true)
	} catch (e) {
		text = await chat(prov, messages, 900, false)
	}
	let picked = parseRanked(text)
	if (!picked.length) {
		text = await chat(prov, messages, 900, false)
		picked = parseRanked(text)
	}
	const byKey = {}
	cands.forEach(function (c) {
		byKey[c.key] = c
	})
	const out = []
	const taken = {}
	picked.forEach(function (p) {
		const c = byKey[p.id]
		if (!c || taken[p.id] || out.length >= count) return
		taken[p.id] = true
		out.push(Object.assign({}, c, { why: p.why }))
	})
	for (let i = 0; i < cands.length && out.length < count; i++) {
		if (taken[cands[i].key]) continue
		taken[cands[i].key] = true
		out.push(Object.assign({}, cands[i]))
	}
	return out
}

module.exports = async function handler(req, res) {
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Favorites-Token")
	res.setHeader("Cache-Control", "no-store")
	if (req.method === "OPTIONS") {
		res.status(204).end()
		return
	}
	if (!tokenOk(req)) {
		res.status(401).json({ error: "token required" })
		return
	}

	try {
		if (req.method === "GET") {
			const action = String((req.query && req.query.action) || "models")
			if (action === "models") {
				res.status(200).json(await ai.catalog())
				return
			}
			res.status(400).json({ error: "unknown action" })
			return
		}

		if (req.method !== "POST") {
			res.status(405).json({ error: "method not allowed" })
			return
		}

		const body = await readBody(req)
		const action = String(body.action || "")

		if (action === "select") {
			const out = await ai.select({ provider: body.provider, model: body.model })
			res.status(out.ok ? 200 : 400).json(out)
			return
		}

		if (action === "suggest") {
			const wish = String(body.wish || "")
				.trim()
				.slice(0, 500)
			if (!wish) {
				res.status(400).json({ error: "describe what you feel like watching" })
				return
			}
			const kind = KINDS[String(body.kind || "any")] ? String(body.kind) : "any"
			const count = Math.max(3, Math.min(MAX_ITEMS, Number(body.count) || 6))
			const years = parseYears(wish, body)
			const prov = await ai.chosen({})
			if (!prov) {
				res.status(503).json({
					error: "no AI provider is available right now",
					hint: "open /api/pick?probe=1 to see what each configured provider answers",
				})
				return
			}

			let items = []
			let source = "model proposals verified against TMDB"
			let note = null

			// A year window is answered from the database first and only ranked by
			// the model, so an old knowledge cutoff cannot smuggle in a 2022 title.
			if (years) {
				let cands = []
				try {
					cands = await discoverCandidates(kind, years, genresFor(wish))
				} catch (e) {
					cands = []
				}
				if (cands.length) {
					source = "TMDB releases " + years.from + "-" + years.to + ", ranked by the model"
					try {
						items = await rankCandidates(prov, wish, kind, years, cands, count)
					} catch (e) {
						items = cands.slice(0, count)
						note = "the model could not rank the list, showing the best rated releases"
					}
				}
			}

			if (!items.length) {
				let proposed = []
				try {
					proposed = await askForTitles(prov, wish, kind, Math.min(MAX_ITEMS, count + 2), years)
				} catch (e) {
					ai.invalidate()
					res.status(502).json({
						error: "the model did not answer",
						detail: String((e && e.message) || e).slice(0, 200),
						engine: prov.name + "/" + prov.model,
					})
					return
				}
				if (!proposed.length) {
					res.status(502).json({
						error: "the model returned no usable titles",
						engine: prov.name + "/" + prov.model,
					})
					return
				}
				const enriched = await Promise.all(
					proposed.map(function (it) {
						return enrich(it).catch(function () {
							return {
								title: it.title,
								year: it.year,
								kind: it.kind || "",
								why: it.why || "",
								found: false,
								average: null,
								votes: null,
								poster: "",
								overview: "",
								links: ratingLinks(it.title, it.year),
							}
						})
					}),
				)
				if (years) {
					const inWindow = enriched.filter(function (x) {
						return inRange(x.year, years)
					})
					if (inWindow.length) {
						items = inWindow
					} else {
						items = enriched
						note =
							"nothing from " + years.from + "-" + years.to + " matched, showing the closest ideas"
					}
				} else {
					items = enriched
				}
			}

			items = items.slice(0, count)
			items.forEach(function (x) {
				if (!x.links) x.links = ratingLinks(x.title, x.year)
			})
			res.status(200).json({
				engine: prov.name + "/" + prov.model,
				verifiedWith: process.env.TMDB_KEY ? "tmdb" : "none",
				kind: kind,
				years: years,
				source: source,
				note: note,
				items: items,
			})
			return
		}

		res.status(400).json({ error: "unknown action" })
	} catch (e) {
		res.status(500).json({ error: String((e && e.message) || e).slice(0, 300) })
	}
}
