// Pilote CDP de WebView2 : evalue un script de page dans la fenetre Tauri et rend son
// resultat en JSON sur stdout. Usage :
//   node cdp.mjs <script-de-page.js> [argument ...]
// Le script recoit ses arguments dans `__args` et `__sidecarService()` en prealable.
//
// `fetch` et `WebSocket` natifs plutot que curl, que les hooks bloquent.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const fail = (message) => {
  console.log(JSON.stringify({ error: true, message }))
  process.exit(1)
}

const [scriptPath, ...args] = process.argv.slice(2)
if (!scriptPath) {
  fail("usage : node cdp.mjs <script-de-page.js> [argument ...]")
}

const target = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const pages = await (await fetch("http://127.0.0.1:9222/json")).json()
      const page = pages.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // WebView2 pas encore la
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  fail(
    "aucune page CDP sur 127.0.0.1:9222 : lancer la fenetre par " +
      'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" just dev',
  )
}

const here = dirname(fileURLToPath(import.meta.url))
let body
try {
  body = readFileSync(scriptPath, "utf8")
} catch {
  fail(`script de page illisible : ${scriptPath}`)
}
// Les chemins passent par `__args` et non par l'expression : un chemin Windows colle dans
// le code perdrait ses backslashes.
let preamble
try {
  preamble = readFileSync(join(here, "page", "sidecar-service.js"), "utf8")
} catch {
  fail(`prealable illisible : ${join(here, "page", "sidecar-service.js")}`)
}
const expression = [preamble, `const __args = ${JSON.stringify(args)};`, body].join("\n")

const page = await target()
const socket = new WebSocket(page.webSocketDebuggerUrl)
try {
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve)
    socket.addEventListener("error", reject)
  })
} catch {
  fail(`connexion CDP refusee sur ${page.webSocketDebuggerUrl} : la page s'est-elle rechargee ?`)
}

const result = await new Promise((resolve) => {
  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(message.data)
    if (payload.id === 1) resolve(payload)
  })
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  )
})
socket.close()

if (result.error) fail(`CDP : ${JSON.stringify(result.error)}`)
if (result.result.exceptionDetails) {
  const thrown = result.result.exceptionDetails.exception
  fail(`exception dans la page : ${thrown?.description ?? thrown?.value ?? "inconnue"}`)
}
console.log(JSON.stringify({ success: true, result: result.result.result.value }, null, 2))
process.exit(0)
