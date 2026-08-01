// TMDB proxy for the "discover" tab: filters by country, genre, years, rating.
// The API key never reaches the browser: it is read from the TMDB_KEY env var.
// Responses are cached on the CDN for a day, so TMDB rate limits are never hit.

const BASE = "https://api.themoviedb.org/3"

function keyInfo() {
	const raw = String(process.env.TMDB_KEY || "").trim()
	if (!raw) return { ok: false }
	// v4 read access tokens are JWTs and must go into the Authorization header
	const isJwt = raw.split(".").length === 3 && raw.slice(0, 2) === "ey"
	return { ok: true, raw: raw, jwt: isJwt }
}

async function tmdb(path, params) {
	const k = keyInfo()
	if (!k.ok) throw new Error("no_key")
	const u = new URL(BASE + path)
	Object.keys(params || {}).forEach(function (name) {
		const v = params[name]
		if (v !== undefined && v !== null && v !== "") u.searchParams.set(name, String(v))
	})
	const headers = { accept: "application/json" }
	if (k.jwt) headers.authorization = "Bearer " + k.raw
	else u.searchParams.set("api_key", k.raw)
	const ctrl = new AbortController()
	const timer = setTimeout(function () {
		ctrl.abort()
	}, 8000)
	try {
		const r = await fetch(u.toString(), { headers: headers, signal: ctrl.signal })
		const body = await r.json().catch(function () {
			return null
		})
		if (!r.ok) {
			const msg = body && body.status_message ? body.status_message : "http_" + r.status
			throw new Error(msg)
		}
		return body || {}
	} finally {
		clearTimeout(timer)
	}
}

function num(v, min, max, dflt) {
	const n = Number(v)
	if (!isFinite(n)) return dflt
	if (n < min) return min
	if (n > max) return max
	return n
}

function posterUrl(p) {
	return p ? "https://image.tmdb.org/t/p/w300" + p : ""
}

function mapItem(x, type) {
	const date = String((type === "tv" ? x.first_air_date : x.release_date) || "")
	const year = date.slice(0, 4)
	return {
		tmdb_id: x.id,
		type: type,
		title: (type === "tv" ? x.name : x.title) || "",
		orig_title: (type === "tv" ? x.original_name : x.original_title) || "",
		year: year ? Number(year) : null,
		poster: posterUrl(x.poster_path),
		score: typeof x.vote_average === "number" ? Math.round(x.vote_average * 10) / 10 : null,
		votes: x.vote_count || 0,
		description: x.overview || "",
		genre_ids: x.genre_ids || [],
		countries: x.origin_country || [],
	}
}

module.exports = async function (req, res) {
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type")
	if (req.method === "OPTIONS") {
		res.status(204).end()
		return
	}

	const q = req.query || {}
	const mode = String(q.mode || "discover")
	const type = String(q.type || "movie") === "tv" ? "tv" : "movie"

	if (mode === "health") {
		const k = keyInfo()
		res.setHeader("Cache-Control", "no-store")
		res.status(200).json({ hasKey: k.ok, kind: k.ok ? (k.jwt ? "v4_token" : "v3_key") : "none" })
		return
	}

	try {
		if (mode === "genres") {
			const both = await Promise.all([
				tmdb("/genre/movie/list", { language: "en-US" }),
				tmdb("/genre/tv/list", { language: "en-US" }),
			])
			res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400")
			res.status(200).json({ movie: both[0].genres || [], tv: both[1].genres || [] })
			return
		}

		if (mode === "imdb") {
			const id = String(q.id || "").replace(/[^0-9]/g, "")
			if (!id) {
				res.status(400).json({ error: "bad_id" })
				return
			}
			const ext = await tmdb("/" + type + "/" + id + "/external_ids", {})
			res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400")
			res.status(200).json({ imdb_id: ext.imdb_id || "", tvdb_id: ext.tvdb_id || null })
			return
		}

		// default: discover with filters
		if (mode === "search") {
			// search by name inside the discover tab: catches titles that popularity ranking buries
			const query = String(q.query || "").trim()
			if (!query) {
				res.status(400).json({ error: "bad_query" })
				return
			}
			const found = await tmdb("/search/" + type, {
				language: "en-US",
				include_adult: "false",
				query: query,
				page: num(q.page, 1, 500, 1),
			})
			const hits = (found.results || []).map(function (x) {
				return mapItem(x, type)
			})
			res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800")
			res.status(200).json({
				items: hits,
				page: found.page || 1,
				totalPages: Math.min(found.total_pages || 1, 500),
				total: found.total_results || hits.length,
			})
			return
		}

		const yearFrom = q.yearFrom ? num(q.yearFrom, 1900, 2100, null) : null
		const yearTo = q.yearTo ? num(q.yearTo, 1900, 2100, null) : null
		const dateKey = type === "tv" ? "first_air_date" : "primary_release_date"
		const sortAllowed = {
			popularity: "popularity.desc",
			rating: "vote_average.desc",
			votes: "vote_count.desc",
			newest: type === "tv" ? "first_air_date.desc" : "primary_release_date.desc",
			oldest: type === "tv" ? "first_air_date.asc" : "primary_release_date.asc",
		}
		const sort = sortAllowed[String(q.sort || "popularity")] || sortAllowed.popularity
		const params = {
			language: "en-US",
			include_adult: "false",
			sort_by: sort,
			page: num(q.page, 1, 500, 1),
			with_genres: String(q.genre || "").replace(/[^0-9,|]/g, ""),
			with_origin_country: String(q.country || "")
				.toUpperCase()
				.replace(/[^A-Z,|]/g, ""),
			with_original_language: String(q.lang || "").replace(/[^a-z,|]/g, ""),
		}
		if (yearFrom) params[dateKey + ".gte"] = yearFrom + "-01-01"
		if (yearTo) params[dateKey + ".lte"] = yearTo + "-12-31"
		if (q.ratingMin) params["vote_average.gte"] = num(q.ratingMin, 0, 10, 0)
		if (q.ratingMax) params["vote_average.lte"] = num(q.ratingMax, 0, 10, 10)
		// a rating without a votes floor is noise, but keep the floor low so that
		// titles from smaller countries are not cut out of the results
		params["vote_count.gte"] = num(q.votesMin, 0, 1000000, q.ratingMin ? 150 : 15)
		if (q.runtimeMin && type === "movie") params["with_runtime.gte"] = num(q.runtimeMin, 0, 1000, 0)
		if (q.runtimeMax && type === "movie") params["with_runtime.lte"] = num(q.runtimeMax, 0, 1000, 1000)

		const data = await tmdb("/discover/" + type, params)
		const items = (data.results || []).map(function (x) {
			return mapItem(x, type)
		})
		res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800")
		res.status(200).json({
			items: items,
			page: data.page || 1,
			totalPages: Math.min(data.total_pages || 1, 500),
			total: data.total_results || items.length,
		})
	} catch (e) {
		const msg = String((e && e.message) || e)
		res.setHeader("Cache-Control", "no-store")
		res.status(msg === "no_key" ? 503 : 502).json({ error: msg })
	}
}
