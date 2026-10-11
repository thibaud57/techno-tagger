// Lance une sonde de page (`page/*.js`, une expression `async (page) => {...}`) dans un Chromium
// headless, sans passer par le MCP Playwright : sa sortie ne recopie pas le code de la sonde, et un
// MCP bloqué n'arrête pas la recette. `PLAYWRIGHT_CORE` désigne le dossier d'un `playwright-core`
// installé (cache npx du MCP par exemple), dont les navigateurs sont déjà téléchargés.
// Usage, depuis la racine du dépôt (les captures des sondes sont relatives à elle) :
//   PLAYWRIGHT_CORE=<dossier playwright-core> node ${CLAUDE_SKILL_DIR}/scripts/run_page.mjs <sonde.js>
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const [probe] = process.argv.slice(2)
const core = process.env.PLAYWRIGHT_CORE
if (!probe || !core) {
  console.log(JSON.stringify({ error: true, message: "usage: PLAYWRIGHT_CORE=<dir> node run_page.mjs <probe.js>" }))
  process.exit(1)
}
const { chromium } = createRequire(import.meta.url)(join(core, "index.js"))
const run = (0, eval)(readFileSync(probe, "utf-8"))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  const out = await run(page)
  console.log(JSON.stringify({ success: true, ...out, consoleErrors: errors }))
} catch (error) {
  console.log(JSON.stringify({ error: true, message: String(error?.stack ?? error) }))
  process.exitCode = 1
} finally {
  await browser.close()
}
