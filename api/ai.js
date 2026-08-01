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
async function askForTitles(prov, wish, kind, count) {
	const messages = [
		{ role: "system", content: SUGGEST_SYSTEM },
		{
			role: "user",
			content: JSON.stringify({
				wish: wish,
				constraint: KINDS[kind] || KINDS.any,
				how_many: count,
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
			const prov = await ai.chosen({})
			if (!prov) {
				res.status(503).json({
					error: "no AI provider is available right now",
					hint: "open /api/pick?probe=1 to see what each configured provider answers",
				})
				return
			}
			let items = []
			try {
				items = await askForTitles(prov, wish, kind, count)
			} catch (e) {
				ai.invalidate()
				res.status(502).json({
					error: "the model did not answer",
					detail: String((e && e.message) || e).slice(0, 200),
					engine: prov.name + "/" + prov.model,
				})
				return
			}
			if (!items.length) {
				res.status(502).json({
					error: "the model returned no usable titles",
					engine: prov.name + "/" + prov.model,
				})
				return
			}
			const enriched = await Promise.all(
				items.map(function (it) {
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
			enriched.sort(function (a, b) {
				return (b.average || 0) - (a.average || 0)
			})
			res.status(200).json({
				engine: prov.name + "/" + prov.model,
				verifiedWith: process.env.TMDB_KEY ? "tmdb" : "none",
				kind: kind,
				items: enriched,
			})
			return
		}

		res.status(400).json({ error: "unknown action" })
	} catch (e) {
		res.status(500).json({ error: String((e && e.message) || e).slice(0, 300) })
	}
}
