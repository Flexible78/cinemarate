// Provider registry and health checking for the "what do we watch tonight?" pick.
//
// Safety rules that must stay true:
// - API keys are read from process.env inside this module only. They are never
//   returned to the browser, never logged and never written to storage.
// - Only provider name, model id and a timestamp are persisted.
// - Every supported provider speaks the OpenAI chat-completions dialect, so one
//   request builder and one model-list parser cover all of them.
// - Model ids are not trusted blindly: GET {base}/models is parsed and the
//   preferred name is matched against what the provider actually offers, so a
//   renamed or retired model degrades instead of breaking the feature.
// - A combination that answered a real probe is saved (Vercel Blob plus an
//   in-process memo), so later requests skip discovery for CACHE_TTL_MS.

const FILE = "ai-provider.json"
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const NET_TIMEOUT_MS = 6000

// Order = preference. Set AI_PROVIDER=<name> to pin one provider.
// Endpoints can be corrected without touching code via <NAME>_BASE_URL.
const REGISTRY = [
	{
		name: "groq",
		envKey: "GROQ_API_KEY",
		base: "https://api.groq.com/openai/v1",
		baseEnv: "GROQ_BASE_URL",
		modelEnv: "GROQ_MODEL",
		prefer: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama"],
	},
	{
		name: "mistral",
		envKey: "MISTRAL_API_KEY",
		base: "https://api.mistral.ai/v1",
		baseEnv: "MISTRAL_BASE_URL",
		modelEnv: "MISTRAL_MODEL",
		prefer: ["mistral-large-latest", "mistral-small-latest", "mistral"],
	},
	{
		name: "inception",
		envKey: "INCEPTION_MERCURY_API_KEY",
		base: "https://api.inceptionlabs.ai/v1",
		baseEnv: "INCEPTION_BASE_URL",
		modelEnv: "INCEPTION_MODEL",
		prefer: ["mercury-2", "mercury"],
	},
	{
		name: "agnes",
		envKey: "AGNES_AI_20_FLASH_API_KEY",
		base: "https://apihub.agnes-ai.com/v1",
		baseEnv: "AGNES_BASE_URL",
		modelEnv: "AGNES_MODEL",
		prefer: ["agnes-ai-flash-2.0", "agnes-flash-2.0", "flash-2.0", "agnes"],
	},
]

let memo = null // { provider, model, verifiedAt }

function envStr(name) {
	return String(process.env[name] || "").trim()
}

function keyOf(p) {
	return envStr(p.envKey)
}

function baseOf(p) {
	return (envStr(p.baseEnv) || p.base).replace(/\/+$/, "")
}

function preferredOf(p) {
	return envStr(p.modelEnv) || p.prefer[0]
}

function configured() {
	const withKey = REGISTRY.filter(function (p) {
		return Boolean(keyOf(p))
	})
	const pinned = envStr("AI_PROVIDER").toLowerCase()
	if (!pinned) return withKey
	const hit = withKey.filter(function (p) {
		return p.name === pinned
	})
	return hit.length ? hit : withKey
}

function byName(name) {
	return (
		REGISTRY.filter(function (p) {
			return p.name === String(name || "")
		})[0] || null
	)
}

function errText(body, status) {
	const m =
		(body && body.error && (body.error.message || body.error)) ||
		(body && body.message) ||
		(body && body.detail) ||
		null
	return String(m || "http_" + status).slice(0, 200)
}

async function call(url, init, ms) {
	const ctrl = new AbortController()
	const timer = setTimeout(function () {
		ctrl.abort()
	}, ms || NET_TIMEOUT_MS)
	try {
		const args = Object.assign({}, init || {}, { signal: ctrl.signal })
		return await fetch(url, args)
	} finally {
		clearTimeout(timer)
	}
}

function authHeaders(p) {
	return {
		authorization: "Bearer " + keyOf(p),
		accept: "application/json",
	}
}

function norm(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
}

// Anything that cannot answer a chat request is not a candidate.
const NOT_CHAT = /embed|whisper|tts|audio|image|guard|rerank|moderat|ocr|clip/i

// GET {base}/models, tolerating the shapes providers use in practice.
async function listModels(p) {
	const r = await call(baseOf(p) + "/models", { headers: authHeaders(p) })
	const body = await r.json().catch(function () {
		return null
	})
	if (!r.ok) throw new Error(errText(body, r.status))
	const raw = (body && (body.data || body.models || body.result)) || []
	const ids = (Array.isArray(raw) ? raw : [])
		.map(function (m) {
			if (typeof m === "string") return m
			return (m && (m.id || m.name || m.model)) || ""
		})
		.map(String)
		.filter(Boolean)
	if (!ids.length) throw new Error("model list is empty")
	return ids
}

// Match a wanted name against real ids: exact, normalised, then partial.
function matchModel(ids, wanted) {
	const w = norm(wanted)
	if (!w) return null
	let hit = ids.filter(function (id) {
		return id === wanted
	})[0]
	if (hit) return hit
	hit = ids.filter(function (id) {
		return norm(id) === w
	})[0]
	if (hit) return hit
	hit = ids.filter(function (id) {
		return norm(id).indexOf(w) === 0
	})[0]
	if (hit) return hit
	hit = ids.filter(function (id) {
		return norm(id).indexOf(w) !== -1
	})[0]
	if (hit) return hit
	hit = ids.filter(function (id) {
		return norm(id).length > 3 && w.indexOf(norm(id)) !== -1
	})[0]
	return hit || null
}

function chooseModel(p, ids) {
	const wants = [envStr(p.modelEnv)].concat(p.prefer).filter(Boolean)
	for (let i = 0; i < wants.length; i++) {
		const hit = matchModel(ids, wants[i])
		if (hit) return { model: hit, wanted: wants[i] }
	}
	const chat = ids.filter(function (id) {
		return !NOT_CHAT.test(id)
	})
	return { model: chat[0] || ids[0] || null, wanted: null }
}

// Providers disagree about where the answer lives: message.content may be a
// string or an array of parts, some fill reasoning_content, older or
// diffusion-style APIs use choices[].text. Read all of them.
function answerText(body) {
	const c = (body && body.choices && body.choices[0]) || null
	if (!c) return ""
	const msg = c.message || c.delta || null
	let raw = (msg && (msg.content || msg.reasoning_content)) || c.text || ""
	if (Array.isArray(raw)) {
		raw = raw
			.map(function (part) {
				if (typeof part === "string") return part
				return (part && (part.text || part.content)) || ""
			})
			.join(" ")
	}
	if (raw && typeof raw === "object") raw = raw.text || raw.content || ""
	return String(raw || "").trim()
}

// The only trustworthy availability test is a real (tiny) completion. Mercury
// and other non-autoregressive models can return nothing when max_tokens is
// very small, so an empty first answer is retried with more room instead of
// being reported as a dead provider.
async function probeChat(p, model) {
	const attempts = [
		{ temperature: 0, max_tokens: 24 },
		{ max_tokens: 160 },
	]
	for (let i = 0; i < attempts.length; i++) {
		const payload = Object.assign(
			{
				model: model,
				messages: [{ role: "user", content: "Reply with one word: ok" }],
			},
			attempts[i],
		)
		const r = await call(
			baseOf(p) + "/chat/completions",
			{
				method: "POST",
				headers: Object.assign({ "content-type": "application/json" }, authHeaders(p)),
				body: JSON.stringify(payload),
			},
			12000,
		)
		const body = await r.json().catch(function () {
			return null
		})
		if (!r.ok) throw new Error(errText(body, r.status))
		const text = answerText(body)
		if (text) return text.slice(0, 40)
	}
	throw new Error("empty completion (model returned no text)")
}

// One provider end to end: parse its model list, choose a model, prove it answers.
async function check(p) {
	const out = {
		provider: p.name,
		ok: false,
		model: null,
		models: 0,
		source: "preference",
		matched: null,
		sample: null,
		error: null,
	}
	let ids = []
	try {
		ids = await listModels(p)
		out.models = ids.length
		out.source = "models endpoint"
	} catch (e) {
		out.source = "preference (model list unavailable: " + String((e && e.message) || e).slice(0, 90) + ")"
	}
	const picked = ids.length ? chooseModel(p, ids) : { model: preferredOf(p), wanted: preferredOf(p) }
	out.model = picked.model
	out.matched = picked.wanted
	if (!out.model) {
		out.error = "no usable model id"
		return out
	}
	try {
		out.sample = await probeChat(p, out.model)
		out.ok = true
	} catch (e) {
		out.error = String((e && e.message) || e).slice(0, 200)
	}
	return out
}

function blobOpts() {
	const token = process.env.BLOB_READ_WRITE_TOKEN
	return token ? { token: token } : {}
}

async function sdk() {
	return await import("@vercel/blob")
}

// The cache is an optimisation only: every failure here is swallowed.
async function readCache() {
	try {
		const mod = await sdk()
		const res = await mod.list(Object.assign({ prefix: FILE, limit: 100 }, blobOpts()))
		const hit = (res.blobs || []).filter(function (b) {
			return b.pathname === FILE
		})[0]
		if (!hit) return null
		const r = await call(hit.url + "?ts=" + Date.now(), { cache: "no-store" })
		if (!r.ok) return null
		const j = await r.json()
		return j && j.provider && j.model ? j : null
	} catch (e) {
		return null
	}
}

async function writeCache(entry) {
	try {
		const mod = await sdk()
		await mod.put(
			FILE,
			JSON.stringify(entry),
			Object.assign(
				{
					access: "public",
					contentType: "application/json",
					addRandomSuffix: false,
					allowOverwrite: true,
					cacheControlMaxAge: 0,
				},
				blobOpts(),
			),
		)
		return true
	} catch (e) {
		return false
	}
}

// A manual choice made in the gear menu never expires: it is replaced only by
// another manual choice or by switching back to automatic mode.
function fresh(entry) {
	if (!entry || !entry.verifiedAt) return false
	if (entry.manual) return true
	const age = Date.now() - Date.parse(String(entry.verifiedAt))
	return age >= 0 && age < CACHE_TTL_MS
}

// Turn a stored { provider, model } into something callable, or null if that
// provider no longer has a key configured.
function resolve(entry) {
	const p = byName(entry && entry.provider)
	if (!p || !keyOf(p)) return null
	const pinned = envStr("AI_PROVIDER").toLowerCase()
	if (pinned && p.name !== pinned) return null
	return {
		name: p.name,
		endpoint: baseOf(p) + "/chat/completions",
		model: String(entry.model),
		key: keyOf(p),
		verifiedAt: entry.verifiedAt || null,
	}
}

function saveEntry(res) {
	return {
		provider: res.provider,
		model: res.model,
		models: res.models,
		source: res.source,
		sample: res.sample,
		verifiedAt: new Date().toISOString(),
	}
}

// The provider the pick endpoint should use right now.
async function chosen(args) {
	const refresh = Boolean(args && args.refresh)
	const list = configured()
	if (!list.length) return null

	if (!refresh) {
		if (fresh(memo)) {
			const warm = resolve(memo)
			if (warm) return warm
		}
		const saved = await readCache()
		if (fresh(saved)) {
			const cold = resolve(saved)
			if (cold) {
				memo = saved
				return cold
			}
		}
	}

	for (let i = 0; i < list.length; i++) {
		const res = await check(list[i])
		if (!res.ok) continue
		const entry = saveEntry(res)
		memo = entry
		await writeCache(entry) // auto-save on a successful check
		return resolve(entry)
	}
	return null
}

// Check every configured provider and persist the first working combination.
async function probeAll() {
	const list = configured()
	const results = []
	for (let i = 0; i < list.length; i++) results.push(await check(list[i]))
	const winner = results.filter(function (r) {
		return r.ok
	})[0]
	let saved = null
	if (winner) {
		const entry = saveEntry(winner)
		memo = entry
		saved = {
			provider: entry.provider,
			model: entry.model,
			verifiedAt: entry.verifiedAt,
			persisted: await writeCache(entry),
		}
	}
	return {
		configured: list.map(function (p) {
			return p.name
		}),
		known: REGISTRY.map(function (p) {
			return p.name
		}),
		pinned: envStr("AI_PROVIDER") || null,
		results: results,
		saved: saved,
		engine: winner ? winner.provider + "/" + winner.model : "heuristic",
	}
}

async function status() {
	const list = configured()
	const saved = fresh(memo) ? memo : await readCache()
	return {
		configured: list.map(function (p) {
			return p.name
		}),
		known: REGISTRY.map(function (p) {
			return p.name
		}),
		pinned: envStr("AI_PROVIDER") || null,
		verified:
			saved && saved.provider
				? {
						provider: saved.provider,
						model: saved.model,
						verifiedAt: saved.verifiedAt || null,
						fresh: fresh(saved),
					}
				: null,
	}
}

// Called when a live request fails: drop the memo so the next request re-checks.
function invalidate() {
	memo = null
}

// Chat-capable model ids per configured provider, for the settings menu.
// Only provider names and model ids leave the server - never a key, never a
// base URL, never a request header.
async function catalog() {
	const list = configured()
	const providers = []
	for (let i = 0; i < list.length; i++) {
		const p = list[i]
		const row = { provider: p.name, models: [], preferred: preferredOf(p), error: null }
		try {
			const ids = await listModels(p)
			row.models = ids
				.filter(function (id) {
					return !NOT_CHAT.test(id)
				})
				.slice(0, 80)
		} catch (e) {
			row.error = String((e && e.message) || e).slice(0, 160)
			row.models = [preferredOf(p)]
		}
		providers.push(row)
	}
	const saved = fresh(memo) ? memo : await readCache()
	return {
		providers: providers,
		selection:
			saved && saved.provider
				? {
						provider: saved.provider,
						model: saved.model,
						manual: Boolean(saved.manual),
						verifiedAt: saved.verifiedAt || null,
					}
				: null,
		pinned: envStr("AI_PROVIDER") || null,
	}
}

// Save a manual choice. The provider must have a key configured here and the
// model must exist in that provider's own list, so a crafted request can only
// ever select something the server already trusts.
async function select(args) {
	const wantProvider = String((args && args.provider) || "")
		.toLowerCase()
		.trim()
	const wantModel = String((args && args.model) || "").trim()

	if (!wantProvider || wantProvider === "auto") {
		memo = null
		await writeCache({ provider: null, model: null, manual: false, verifiedAt: null })
		return { ok: true, mode: "auto", selection: null }
	}

	const p = configured().filter(function (x) {
		return x.name === wantProvider
	})[0]
	if (!p) return { ok: false, error: "this provider has no key configured on the server" }

	let ids = []
	try {
		ids = await listModels(p)
	} catch (e) {
		ids = []
	}
	const model = ids.length
		? matchModel(ids, wantModel)
		: wantModel === preferredOf(p)
			? wantModel
			: null
	if (!model) return { ok: false, error: "this model is not offered by " + p.name }

	let sample = null
	try {
		sample = await probeChat(p, model)
	} catch (e) {
		return {
			ok: false,
			error: "the model did not answer: " + String((e && e.message) || e).slice(0, 160),
		}
	}

	const entry = {
		provider: p.name,
		model: model,
		models: ids.length,
		source: "manual selection",
		sample: sample,
		manual: true,
		verifiedAt: new Date().toISOString(),
	}
	memo = entry
	const persisted = await writeCache(entry)
	return {
		ok: true,
		mode: "manual",
		sample: sample,
		selection: {
			provider: entry.provider,
			model: entry.model,
			manual: true,
			verifiedAt: entry.verifiedAt,
			persisted: persisted,
		},
	}
}

module.exports = {
	chosen: chosen,
	probeAll: probeAll,
	status: status,
	invalidate: invalidate,
	check: check,
	listModels: listModels,
	answerText: answerText,
	catalog: catalog,
	select: select,
}
