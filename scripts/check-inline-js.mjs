// Parses every inline <script> block of an HTML file so a typo in the browser
// code fails the build instead of the page.
// Local use: node scripts/check-inline-js.mjs index.html
import { readFileSync } from "node:fs"
import vm from "node:vm"

const file = process.argv[2] || "index.html"
const html = readFileSync(file, "utf8")
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])

if (blocks.length === 0) {
	console.error(`${file}: no inline <script> block found`)
	process.exit(1)
}

blocks.forEach((code, i) => {
	new vm.Script(code, { filename: `${file}#script-${i + 1}` })
})

console.log(`${file}: ${blocks.length} inline script block(s) parsed without errors`)
