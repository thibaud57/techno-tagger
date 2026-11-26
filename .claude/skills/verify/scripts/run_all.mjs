// Joue les scénarios de `verify-all` à la suite, puis rend une ligne de synthèse par scénario.
// Séquentiel : les scénarios `window-*` tiennent l'instance unique de l'app, chaque scénario `demo*`
// lance son propre serveur de dev. Chaque scénario est un process fils relié par un canal IPC : un
// Ctrl+C, un SIGTERM ou la disparition de ce lanceur lui fait nettoyer ce qu'il a lancé (cf. `play`).

import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Seul endroit à compléter pour ajouter un scénario à `verify-all`
const SCENARIOS = [
  "extraction",
  "engine",
  "window",
  "window-single-instance",
  "window-controls",
  "window-cache",
  "window-past-runs",
  "window-rollback",
  "window-resume",
  "demo",
  "demo-choices",
  "demo-order",
  "demo-restart",
  "demo-language",
  "demo-settings",
]
const here = dirname(fileURLToPath(import.meta.url))

let current = null
let interrupted = null
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  process.on(signal, () => {
    interrupted ??= signal
    current?.send({ type: "stop" })
  })
}

const run = (name) =>
  new Promise((done) => {
    const started = Date.now()
    current = spawn(process.execPath, [join(here, `${name}.mjs`)], { stdio: ["inherit", "inherit", "inherit", "ipc"] })
    current.on("exit", (status) => done({ name, ok: status === 0, seconds: Math.round((Date.now() - started) / 1000) }))
  })

const results = []
for (const name of SCENARIOS) {
  if (interrupted) break
  console.log(`\n######## ${name}`)
  results.push(await run(name))
}

console.log("\n######## synthèse")
for (const { name, ok, seconds } of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name} en ${seconds} s`)
if (interrupted) {
  console.log(`== verify-all : interrompu (${interrupted}), ${SCENARIOS.length - results.length} scénario(s) non joué(s)`)
  process.exit(130)
}
const failed = results.filter((result) => !result.ok).length
console.log(`== verify-all : ${failed ? "FAIL" : "PASS"} (${failed} échec(s))`)
process.exit(failed ? 1 : 0)
