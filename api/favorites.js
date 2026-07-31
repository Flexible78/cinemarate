// Общая база Избранного. Хранится в Vercel Blob рядом с сайтом.
// Авторизация идёт через OIDC: Vercel сам выдаёт функции короткоживущий
// токен, если к проекту подключён Blob-сторадж. Ничего вводить руками не нужно.
// Если в проекте остался старый BLOB_READ_WRITE_TOKEN, он тоже подойдёт.

const FILE = "favorites.json"
const EMPTY = { version: 2, updated: "", items: [] }

function opts() {
	const token = process.env.BLOB_READ_WRITE_TOKEN
	return token ? { token } : {}
}

async function sdk() {
	return await import("@vercel/blob")
}

async function readDb() {
	const { list } = await sdk()
	const res = await list({ prefix: FILE, limit: 100, ...opts() })
	const hit = (res.blobs || []).filter((b) => b.pathname === FILE)[0]
	if (!hit) return EMPTY
	const r = await fetch(hit.url + "?ts=" + Date.now(), { cache: "no-store" })
	if (!r.ok) return EMPTY
	try {
		const db = await r.json()
		return db && Array.isArray(db.items) ? db : EMPTY
	} catch (e) {
		return EMPTY
	}
}

async function writeDb(db) {
	const { put } = await sdk()
	await put(FILE, JSON.stringify(db), {
		access: "public",
		contentType: "application/json",
		addRandomSuffix: false,
		allowOverwrite: true,
		cacheControlMaxAge: 0,
		...opts(),
	})
	return true
}

module.exports = async function (req, res) {
	res.setHeader("Cache-Control", "no-store")
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type")
	if (req.method === "OPTIONS") {
		res.status(204).end()
		return
	}

	if (req.query && req.query.debug === "1") {
		let probe = "не проверялось"
		try {
			const db = await readDb()
			probe = "чтение прошло, записей: " + db.items.length
		} catch (e) {
			probe = "ошибка чтения: " + String(e && e.message ? e.message : e)
		}
		res.status(200).json({
			node: process.version,
			hasStoreId: Boolean(process.env.BLOB_STORE_ID),
			hasOidc: Boolean(process.env.VERCEL_OIDC_TOKEN),
			hasStaticToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
			probe: probe,
		})
		return
	}

	try {
		if (req.method === "GET") {
			res.status(200).json(await readDb())
			return
		}
		if (req.method === "POST") {
			let body = req.body
			if (typeof body === "string") body = JSON.parse(body || "{}")
			if (!body || !Array.isArray(body.items)) {
				res.status(400).json({ error: "жду JSON с полем items" })
				return
			}
			const clean = {
				version: 2,
				updated: new Date().toISOString().slice(0, 19).replace("T", " "),
				items: body.items.filter((i) => i && i.key && i.title).slice(0, 5000),
			}
			await writeDb(clean)
			res.status(200).json({ ok: true, count: clean.items.length })
			return
		}
		res.status(405).json({ error: "метод не поддерживается" })
	} catch (e) {
		res.status(500).json({ error: String(e && e.message ? e.message : e) })
	}
}
