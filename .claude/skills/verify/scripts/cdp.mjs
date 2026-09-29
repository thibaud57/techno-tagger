// Pilote CDP de WebView2 : evalue un script de page dans la fenetre Tauri et rend son
// resultat en JSON sur stdout. Usage :
//   node cdp.mjs <script-de-page.js> [argument ...]
//   node cdp.mjs --key <touche>              vraie touche clavier (Escape, Enter, ArrowDown...)
//   node cdp.mjs --screenshot <sortie.png>   capture de la fenetre
//   node cdp.mjs --click <x> <y>             vrai clic souris, coordonnees CSS de la page
//   node cdp.mjs --move <x> <y>              survol seul, sans clic
// Le script recoit ses arguments dans `__args`, et le prealable `page/preamble.js` devant lui
// (`wait`, `until`, `__sidecarService()`).
//
// `fetch` et `WebSocket` natifs plutot que curl, que les hooks bloquent.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const fail = (message) => {
  console.log(JSON.stringify({ error: true, message }))
  process.exit(1)
}

const [scriptPath, ...args] = process.argv.slice(2)
if (!scriptPath) {
  fail(
    "usage : node cdp.mjs <script-de-page.js> [argument ...] | --key <touche> | " +
      "--screenshot <sortie.png> | --click <x> <y> | --move <x> <y>",
  )
}

// `Input.dispatchKeyEvent` passe par le navigateur comme une frappe reelle, la ou un
// `dispatchEvent` de page ne declenche pas les comportements natifs (Echap d'un dialog).
const KEYS = {
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { code: "ArrowRight", windowsVirtualKeyCode: 39 },
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

const evaluation = () => {
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
    preamble = readFileSync(join(here, "page", "preamble.js"), "utf8")
  } catch {
    fail(`prealable illisible : ${join(here, "page", "preamble.js")}`)
  }
  // Dans un bloc : un `const` de premier niveau survit a l'evaluation dans la portee globale
  // de la page, et un second script sur la meme fenetre leverait « already been declared ».
  // La valeur du bloc reste celle de sa derniere expression, la promesse du script.
  return ["{", preamble, `const __args = ${JSON.stringify(args)};`, body, "}"].join("\n")
}

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

let nextId = 0
// Une page qui meurt pendant l'appel ferme la socket sans repondre : sans ce cas, la promesse
// resterait pendante.
const call = (method, params) =>
  new Promise((resolve) => {
    nextId += 1
    const id = nextId
    const settle = (value) => {
      socket.removeEventListener("message", onMessage)
      socket.removeEventListener("close", onClose)
      resolve(value)
    }
    const onMessage = (message) => {
      const payload = JSON.parse(message.data)
      if (payload.id === id) settle(payload)
    }
    const onClose = () => settle({ pageClosed: true })
    socket.addEventListener("message", onMessage)
    socket.addEventListener("close", onClose)
    socket.send(JSON.stringify({ id, method, params }))
  })

const check = (response) => {
  if (response.pageClosed) {
    console.log(JSON.stringify({ success: true, pageClosed: true }))
    process.exit(0)
  }
  if (response.error) {
    socket.close()
    fail(`CDP : ${JSON.stringify(response.error)}`)
  }
  return response.result
}

if (scriptPath === "--key") {
  const [key] = args
  const known = KEYS[key]
  if (!known) fail(`touche inconnue : ${key} (connues : ${Object.keys(KEYS).join(", ")})`)
  const base = { key, ...known, nativeVirtualKeyCode: known.windowsVirtualKeyCode }
  check(await call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }))
  check(await call("Input.dispatchKeyEvent", { type: "keyUp", ...base }))
  socket.close()
  console.log(JSON.stringify({ success: true, key }))
  process.exit(0)
}

// Pression puis relachement : un `element.click()` de page ne produit ni `mousedown` ni
// deplacement du focus, ce qu'un composant peut ecouter a la place du `click`.
if (scriptPath === "--click" || scriptPath === "--move") {
  const [x, y] = args.map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`usage : node cdp.mjs ${scriptPath} <x> <y>`)
  check(await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }))
  if (scriptPath === "--click") {
    const base = { x, y, button: "left", clickCount: 1 }
    check(await call("Input.dispatchMouseEvent", { type: "mousePressed", ...base }))
    check(await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...base }))
  }
  socket.close()
  console.log(JSON.stringify({ success: true, [scriptPath.slice(2)]: [x, y] }))
  process.exit(0)
}

if (scriptPath === "--screenshot") {
  const [output] = args
  if (!output) fail("chemin de sortie manquant : node cdp.mjs --screenshot <sortie.png>")
  const { data } = check(await call("Page.captureScreenshot", { format: "png" }))
  socket.close()
  writeFileSync(output, Buffer.from(data, "base64"))
  console.log(JSON.stringify({ success: true, output }))
  process.exit(0)
}

const result = check(
  await call("Runtime.evaluate", { expression: evaluation(), awaitPromise: true, returnByValue: true }),
)
socket.close()

if (result.exceptionDetails) {
  const thrown = result.exceptionDetails.exception
  fail(`exception dans la page : ${thrown?.description ?? thrown?.value ?? "inconnue"}`)
}
console.log(JSON.stringify({ success: true, result: result.result.value }, null, 2))
process.exit(0)
