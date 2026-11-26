// Primitives des scénarios `verify-all` : état de départ jetable, processus de l'app, fenêtre par CDP,
// navigateur et gestes de la démo. Aucun import de l'app : elle se pilote par son protocole NDJSON,
// ses écrans et ses processus. Aucune primitive ne rend de verdict : celui-ci vit dans `report.mjs`.

import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { createServer, connect } from "node:net"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
export const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version
export const BUNDLE_ID = "fr.empiricmind.techno-tagger"

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

export async function waitUntil(condition, timeout, interval = 250) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await condition()) return true
    await sleep(interval)
  }
  return Boolean(await condition())
}

export const last = (events) => events.at(-1) ?? {}

export const flat = (text) => (text ?? "").replace(/\s+/g, " ").trim()

export const scratch = (label) => mkdtempSync(join(tmpdir(), `techno-tagger-verify-${label}-`))

export const removeTree = (folder) => rmSync(folder, { recursive: true, force: true })

// Empreinte d'un dossier : chemin, taille et SHA-256 de chaque fichier. Deux empreintes égales disent
// que rien n'a été ajouté, retiré, renommé ni réécrit, ce qu'un comptage de fichiers ne voit pas.
export const folderFingerprint = (folder) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return `${relative(folder, path)}:${statSync(path).size}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
    })
    .sort()
    .join("\n")

// ── Processus et ports ───────────────────────────────────────────────────────

export const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer()
    server.once("error", fail)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })

export const portAnswers = (port) =>
  new Promise((done) => {
    const socket = connect({ port, host: "localhost" })
    socket.once("connect", () => (socket.destroy(), done(true)))
    socket.once("error", () => done(false))
  })

// Table des processus du poste, lue une fois : `taskkill` seul ne dit pas qui descend de qui
export function processTable() {
  const command =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{n='CommandLine';e={$_.CommandLine -replace '[\\x00-\\x1f]',' '}} | ConvertTo-Json -Compress"
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`liste des processus illisible : ${result.stderr.trim()}`)
  return JSON.parse(result.stdout).map((row) => ({ pid: row.ProcessId, parent: row.ParentProcessId, name: row.Name, cmd: row.CommandLine ?? "" }))
}

export function descendants(rootPid, table = processTable()) {
  const found = new Map()
  const visit = (pid) => {
    for (const row of table) {
      if (row.parent === pid && !found.has(row.pid)) {
        found.set(row.pid, row)
        visit(row.pid)
      }
    }
  }
  visit(rootPid)
  return [...found.values()]
}

export const running = (...names) => processTable().filter((row) => names.includes(row.name.toLowerCase()))

// Le sidecar et la webview lisent cette variable à chaque lancement : héritée du shell, elle enverrait
// un événement de test à Sentry. Toute valeur autre que `1` la désarme.
export const NO_SENTRY_SELFTEST = { TECHNO_TAGGER_SENTRY_SELFTEST: "" }

export const APP = "techno-tagger.exe"
export const SIDECAR = "tagger.exe"

// Instances de l'app (fenêtre ou sidecar) déjà lancées par quelqu'un d'autre : l'app est en instance
// unique, une seconde fenêtre donnerait le focus à l'instance personnelle. Jamais touchée.
export const otherInstances = () => running(APP, SIDECAR).map((row) => `${row.name} ${row.pid}`)

// Arrête ce que le scénario a lancé, par PID. L'arbre du lanceur est relevé avant de le tuer : un
// serveur de dev survit à son lanceur, et une fois celui-ci mort la filiation se perd. Jamais par
// nom d'image. La lecture de la table des processus peut lever : le `taskkill` du lanceur passe
// quand même, l'erreur est relancée une fois tout ce qui pouvait être arrêté l'est.
export function stopTree(rootPid, known = []) {
  let failure = null
  const read = (action) => {
    try {
      return action()
    } catch (error) {
      failure ??= error
      return null
    }
  }
  const before = read(() => descendants(rootPid)) ?? []
  spawnSync("taskkill", ["/PID", String(rootPid), "/T", "/F"], { encoding: "utf8" })
  const alive = read(processTable)
  for (const row of alive ? [...known, ...before] : []) {
    if (alive.some((current) => current.pid === row.pid && current.name === row.name)) {
      spawnSync("taskkill", ["/PID", String(row.pid), "/T", "/F"], { encoding: "utf8" })
    }
  }
  if (failure) throw failure
}

// Un serveur lancé par le scénario peut survivre à son lanceur : on l'arrête par le PID qui écoute sur
// le port que le scénario a choisi, après avoir vu ce port dans sa ligne de commande (jamais un autre)
export function stopListeners(port) {
  // Sans `-p tcp`, qui ne montre pas l'IPv6 : `ng serve` écoute sur `[::1]`
  const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout
  const pids = new Set(
    out
      .split("\n")
      .filter((line) => /LISTENING/.test(line) && new RegExp(`:${port}\\s`).test(line))
      .map((line) => Number(line.trim().split(/\s+/).at(-1))),
  )
  for (const row of processTable()) {
    if (pids.has(row.pid) && row.cmd.includes(String(port))) spawnSync("taskkill", ["/PID", String(row.pid), "/T", "/F"], { encoding: "utf8" })
  }
}

// Lance une commande longue (serveur de dev) dont la sortie va dans un fichier du dossier jetable
export function startLogged(command, args, { cwd = ROOT, env = {}, shell = false, log }) {
  const out = openSync(log, "a")
  return spawn(command, args, { cwd, shell, env: { ...process.env, ...env }, stdio: ["ignore", out, out], windowsHide: true })
}

export const readLogTail = (log, lines = 15) => {
  try {
    return readFileSync(log, "utf8").split("\n").slice(-lines).join("\n")
  } catch {
    return "(journal absent)"
  }
}

// ── Démo web : serveur ───────────────────────────────────────────────────────

// `pnpm start:demo` sur un port libre (le 4200 est souvent tenu par un autre projet), rendu aussitôt :
// l'attente est une étape à part, pour que le nettoyage connaisse le serveur même si elle échoue.
// `DEMO_URL` vise un serveur déjà lancé (`just dev-demo`, image nginx, URL publique) : rien n'est lancé.
export async function startDemo(workdir) {
  if (process.env.DEMO_URL) return { base: process.env.DEMO_URL, server: null }
  const port = await freePort()
  const log = join(workdir, "demo-server.log")
  const child = startLogged(`pnpm start:demo --port ${port}`, [], { shell: true, log, env: { NG_CLI_ANALYTICS: "false", CI: "1" } })
  return { base: `http://localhost:${port}`, server: { child, pid: child.pid, port, log } }
}

// Vrai quand la démo sert son scénario, faux si le serveur est mort ou n'a rien servi à temps
export async function demoReady({ base, server }, timeout = 240_000) {
  let dead = false
  const ready = await waitUntil(
    async () => {
      if (server && server.child.exitCode !== null) return (dead = true)
      try {
        return (await fetch(`${base}/demo/scenario.json`)).ok
      } catch {
        return false
      }
    },
    server ? timeout : 10_000,
    1000,
  )
  return ready && !dead
}

export const demoLogTail = ({ server }) => (server ? readLogTail(server.log, 6) : "")

// Le serveur est arrêté par son lanceur puis par son port : l'échec du premier n'épargne pas le second
export function stopDemo({ server }) {
  if (!server) return
  try {
    stopTree(server.pid)
  } finally {
    stopListeners(server.port)
  }
}

export const openBrowser = () => chromium.launch({ channel: "chrome", headless: true })

// ── Démo web : pages et gestes ───────────────────────────────────────────────

// Ce que les pages de la démo ont émis : console, exceptions, requêtes hors origine. Le verdict
// (`checkConsoleAndNetwork`) est dans `report.mjs`.
export class DemoWatch {
  console = []
  pageErrors = []
  foreign = []
  environment = new Set()
}

// Ce qu'une page vide reçoit déjà de l'environnement du poste (outil qui injecte un script dans toute
// page HTTP), hors de toute app : origines à ignorer
export async function environmentOrigins(browser) {
  const server = createHttpServer((_request, response) => {
    response.setHeader("content-type", "text/html")
    response.end("<!doctype html><title>vide</title><p>vide</p>")
  })
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const origin = `http://127.0.0.1:${server.address().port}`
  const context = await browser.newContext()
  const page = await context.newPage()
  const seen = new Set()
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) seen.add(new URL(request.url()).origin)
  })
  await page.goto(origin)
  await page.waitForTimeout(3000)
  await context.close()
  await new Promise((done) => server.close(done))
  return seen
}

export const DISABLED_TIP = "Indisponible dans la démo."

// Espion posé avant l'app : les lignes du sidecar rejouées et les commandes de l'interface passent
// par un `JSON.parse`, ce qui permet d'attendre une fin de phase sans deviner un délai
const hooks = () => {
  window.__events = []
  window.__commands = []
  const parse = JSON.parse
  JSON.parse = function (text, reviver) {
    const value = parse.call(this, text, reviver)
    if (typeof text === "string" && value && typeof value === "object") {
      if (typeof value.event === "string") window.__events.push(value.event)
      else if (typeof value.command === "string") window.__commands.push(value.command)
    }
    return value
  }
}

// Une visite de la démo : son serveur (ou `DEMO_URL`), le navigateur et ce que les pages ont émis
export class DemoSession {
  watch = new DemoWatch()
  demo = null
  browser = null

  get base() {
    return this.demo.base
  }

  visitor(label, options) {
    return freshVisitor(this.browser, this.base, this.watch, label, options)
  }

  // Une visite : `run` reçoit la page, le contexte est fermé quoi qu'il arrive
  async visit(label, options, run) {
    const { context, page } = await this.visitor(label, options)
    try {
      return await run(page)
    } finally {
      await context.close()
    }
  }

  // Un navigateur qui refuse de se fermer ne doit pas laisser le serveur de dev tourner
  async close() {
    try {
      await this.browser?.close()
    } finally {
      if (this.demo) stopDemo(this.demo)
    }
  }
}

// Visiteur neuf : contexte vierge, 1280 × 800, français sauf `options.locale`
export async function freshVisitor(browser, base, watch, label, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "fr-FR", ...options })
  await context.addInitScript(hooks)
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  // `source` : l'URL qui a émis le message, pour distinguer l'app de l'outil du poste qui injecte un script
  page.on("console", (message) => watch.console.push({ label, type: message.type(), text: message.text(), source: message.location().url }))
  page.on("pageerror", (error) => watch.pageErrors.push({ label, text: String(error) }))
  // `data:` et `blob:` restent dans la page : seule une requête réseau vers un autre hôte compte
  page.on("request", (request) => {
    const url = request.url()
    if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin) watch.foreign.push({ label, url, type: request.resourceType() })
  })
  return { context, page }
}

export const dialogText = (p) =>
  p.evaluate(() => {
    const dialog = [...document.querySelectorAll(".p-dialog")].pop()
    return dialog ? dialog.innerText.replace(/\s+/g, " ").trim() : null
  })

export const waitDialog = (p, pattern, timeout = 8000) =>
  p.waitForFunction(
    (source) => {
      const dialog = [...document.querySelectorAll(".p-dialog")].pop()
      return !!dialog && new RegExp(source).test(dialog.innerText.replace(/\s+/g, " "))
    },
    pattern.source,
    { timeout },
  )

export const waitNoDialog = (p) => p.waitForFunction(() => !document.querySelector(".p-dialog"), null, { timeout: 8000 })

// La croix et non Échap : le focus reste sur la liste des candidats, qui garde la touche
export async function closeDialog(p) {
  await p.locator(".p-dialog .p-dialog-close-button").click()
  await waitNoDialog(p)
}

// Rattrapé, Lowlands cède la modale au morceau suivant ou la ferme au dernier. Vrai si la modale a
// bien quitté Lowlands dans le délai
export async function leaveRecovery(p) {
  const left = await p
    .waitForFunction(
      () => {
        const dialog = [...document.querySelectorAll(".p-dialog")].pop()
        return !dialog || !/Lowlands/.test(dialog.innerText)
      },
      null,
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false)
  if (left && (await p.locator(".p-dialog").count()) > 0) await closeDialog(p)
  return left
}

export const counter = (p) =>
  p.evaluate(() => [...document.querySelectorAll("app-phase-progress span.tabular-nums")].map((e) => e.textContent.trim()).join("|"))

export const waitCounter = (p, pattern) =>
  p.waitForFunction(
    (source) =>
      new RegExp(source).test([...document.querySelectorAll("app-phase-progress span.tabular-nums")].map((e) => e.textContent.trim()).join("|")),
    pattern.source,
    { timeout: 10_000 },
  )

export const commandCount = (p) => p.evaluate(() => window.__commands.length)

export const waitEvents = (p, name, count, timeout = 20_000) =>
  p.waitForFunction(([wanted, total]) => window.__events.filter((event) => event === wanted).length >= total, [name, count], { timeout })

export const badges = (p) =>
  p.evaluate(() => ({
    arbitration: document.querySelector("[data-arbitration-badge]")?.textContent.trim() ?? null,
    recovery: document.querySelector("[data-recovery-badge]")?.textContent.trim() ?? null,
  }))

// Survol maintenu sur un contrôle grisé : son état et le tooltip qui en donne la raison
export async function greyed(p, selector) {
  await p.mouse.move(2, 2)
  await p.waitForTimeout(150)
  const box = await p.locator(selector).first().boundingBox()
  if (!box) return { missing: true }
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await p.waitForTimeout(1000)
  const state = await p.evaluate((css) => {
    const element = document.querySelector(css)
    return {
      disabled: element.disabled === true,
      label: element.textContent.replace(/\s+/g, " ").trim(),
      tip: document.querySelector(".p-tooltip")?.textContent.trim() ?? null,
    }
  }, selector)
  return { ...state, box }
}

export async function pickAndExtract(p, base, lang) {
  await p.goto(`${base}/?lang=${lang}`)
  await p.waitForSelector("p-tablist")
  await p.waitForSelector("app-playlist-page app-path-picker button")
  const pickers = p.locator("app-playlist-page app-path-picker button")
  for (let index = 0; index < 3; index += 1) await pickers.nth(index).click()
  await p.waitForSelector("app-playlist-page p-select")
  await p.locator("app-playlist-page p-select").click()
  const option = await p.locator(".p-select-option").first().innerText()
  await p.locator(".p-select-option").first().click()
  await p.waitForFunction(() => {
    const button = [...document.querySelectorAll("app-playlist-page button")].find((b) => /^(Extraire|Extract)/.test(b.textContent.trim()))
    return !!button && !button.disabled
  })
  await p.locator("app-playlist-page button", { hasText: /^\s*(Extraire|Extract)/ }).click()
  await waitEvents(p, "extraction_finished", 1)
  await p.locator("app-playlist-page button", { hasText: /tagging/i }).waitFor()
  return option
}

export async function goTagging(p) {
  await p.locator("app-playlist-page button", { hasText: /tagging/i }).click()
  await p.waitForSelector("app-tagging-page")
  await p.waitForFunction(() => document.querySelector('[data-action="start"]')?.disabled === false)
}

export const startRun = (p) => p.locator('[data-action="start"]').click()

export async function runFinished(p) {
  await waitEvents(p, "run_finished", 1)
  await p.waitForSelector(".p-dialog")
}

// Visite des Réglages (onglet puis Administration) : le cache est mesuré par une requête rejouée
export async function settingsVisit(p) {
  if ((await p.locator(".p-dialog").count()) > 0) await closeDialog(p)
  await p.locator("p-tab").nth(2).click()
  await p.locator("app-settings-page p-menu .p-menu-item-content").nth(3).click()
  await p.waitForFunction(() => !!document.querySelector("[data-cache-size]")?.getAttribute("data-cache-size"), null, { timeout: 4000 })
  const state = await p.evaluate(() => ({
    cacheSize: document.querySelector("[data-cache-size]")?.getAttribute("data-cache-size"),
    versionRow: document.querySelector("[data-version-row]")?.textContent.replace(/\s+/g, " ").trim() ?? null,
  }))
  await p.locator("p-tab").nth(1).click()
  await p.waitForSelector("app-tagging-page")
  return state
}

export const optionCount = (p) => p.locator(".p-dialog .p-listbox-option").count()

export const refuse = (p) => p.locator('.p-dialog [data-action="refuse"]').click()

export async function validateFirst(p) {
  await p.locator(".p-dialog .p-listbox-option").first().click()
  await p.locator('.p-dialog [data-action="validate"]').click()
}

export async function confirmAccept(p, pattern) {
  const dialog = p.locator(".p-confirmdialog")
  await dialog.waitFor({ state: "visible" })
  const message = flat(await dialog.innerText())
  await dialog.getByRole("button", { name: pattern }).click()
  return message
}

export async function openLowlands(p) {
  await p.locator("[data-recovery-badge]").click()
  await waitDialog(p, /Lowlands/)
  const before = await p.evaluate(() => {
    const input = document.querySelector('[data-field="url"]')
    return { url: input.value, readOnly: input.readOnly, resolveDisabled: document.querySelector('[data-action="resolve-url"]').disabled }
  })
  await p.locator('[data-action="resolve-url"]').click()
  return before
}

export const recapFilters = (p) =>
  p.evaluate(() => [...document.querySelectorAll("p-selectbutton [data-filter]")].map((e) => e.textContent.replace(/\s+/g, " ").trim()))

export const rowsOf = (p, pattern) =>
  p.evaluate(
    (source) =>
      [...document.querySelectorAll("app-run-list tr")]
        .map((row) => row.textContent.replace(/\s+/g, " ").trim())
        .filter((text) => new RegExp(source).test(text)),
    pattern.source,
  )

// Parcours d'un visiteur jusqu'au récapitulatif, Sub Rosa accepté ou refusé : rend ce qui permet de
// comparer les deux fins
export async function finishRun(p, base, subRosa) {
  await pickAndExtract(p, base, "fr")
  await goTagging(p)
  await startRun(p)
  await runFinished(p)
  await waitDialog(p, /Sub Rosa/)
  if (subRosa === "accept") {
    await validateFirst(p)
  } else {
    await refuse(p)
    await waitDialog(p, /Aucun candidat trouvé/)
    await refuse(p)
    await waitDialog(p, /Étape facultative/)
    await p.locator('.p-dialog [data-action="skip"]').click()
    await p.waitForTimeout(700)
    if ((await p.locator(".p-dialog").count()) === 0) await p.locator("[data-arbitration-badge]").click()
  }
  await waitDialog(p, /Тишина/)
  await validateFirst(p)
  await waitNoDialog(p)
  await openLowlands(p)
  await leaveRecovery(p)
  await p.locator('[data-action="commit"]').click()
  const message = await confirmAccept(p, /Écrire les tags/)
  await waitEvents(p, "run_finished", 2)
  await p.waitForFunction(() => document.querySelector('[data-action="retry"]')?.disabled === false)
  await p.locator('[data-action="retry"]').click()
  await confirmAccept(p, /Relancer l'écriture/)
  await waitEvents(p, "run_finished", 3)
  await p.waitForSelector('[data-action="recap"]')
  await p.locator('[data-action="recap"]').click()
  await p.waitForURL(/\/tagging\/recap/)
  await p.waitForSelector("app-run-list tr")
  // Sans ce compte, deux visites comparées par `!==` sortiraient `NaN !== NaN` : vrai sans rien avoir mesuré
  const titles = message.match(/Titre » : (\d+)/)
  if (!titles) throw new Error(`la confirmation d'écriture n'annonce pas de compte « Titre » : ${message.slice(0, 160)}`)
  return { count: Number(titles[1]), recap: await recapFilters(p) }
}

// ── Fichiers de départ ───────────────────────────────────────────────────────

// Fichiers jetables d'une bibliothèque musicale fictive, bâtis hors du dépôt. Un dump VLC au schéma réel,
// un M3U8 copié des fichiers de test, des fichiers sans audio réel : l'extraction copie par nom et
// n'ouvre pas les morceaux.
//
// Schéma recopié de `sidecar/tests/helpers/vlc_dump.py` (relevé sur un dump réel, cf.
// `docs/knowledges/vlc-media-db.md`), sans importer ce helper. `Media.filename` porte la collation
// `FILENAME` de VLC, que le lecteur du sidecar doit enregistrer pour requêter : `node:sqlite` ne sait
// pas en déclarer une, donc `Media` est créée sans elle puis son DDL réel est écrit dans le schéma
// (`writable_schema`), de quoi rejouer le piège.
const DDL_PLAYLIST =
  "CREATE TABLE Playlist(id_playlist INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT COLLATE NOCASE,creation_date UNSIGNED INT NOT NULL,artwork_mrl TEXT,nb_video UNSIGNED INT NOT NULL DEFAULT 0,nb_audio UNSIGNED INT NOT NULL DEFAULT 0,nb_unknown UNSIGNED INT NOT NULL DEFAULT 0,nb_present_video UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_video <= nb_video),nb_present_audio UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_audio <= nb_audio),nb_present_unknown UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_unknown <= nb_unknown),duration UNSIGNED INT NOT NULL DEFAULT 0,nb_duration_unknown UNSIGNED INT NOT NULL DEFAULT 0, is_favorite BOOLEAN NOT NULL DEFAULT FALSE)"
const DDL_PLAYLIST_MEDIA_RELATION =
  "CREATE TABLE PlaylistMediaRelation(media_id INTEGER,playlist_id INTEGER,position INTEGER,FOREIGN KEY(media_id) REFERENCES Media(id_media) ON DELETE NO ACTION,FOREIGN KEY(playlist_id) REFERENCES Playlist(id_playlist) ON DELETE CASCADE)"
const DDL_MEDIA =
  "CREATE TABLE Media(id_media INTEGER PRIMARY KEY AUTOINCREMENT,type INTEGER,subtype INTEGER NOT NULL DEFAULT 0,duration INTEGER DEFAULT -1,last_position REAL DEFAULT -1,last_time INTEGER DEFAULT -1,play_count UNSIGNED INTEGER NOT NULL DEFAULT 0,last_played_date UNSIGNED INTEGER,insertion_date UNSIGNED INTEGER,release_date UNSIGNED INTEGER,title TEXT COLLATE NOCASE,filename TEXT COLLATE FILENAME,is_favorite BOOLEAN NOT NULL DEFAULT 0,is_present BOOLEAN NOT NULL DEFAULT 1,device_id INTEGER,nb_playlists UNSIGNED INTEGER NOT NULL DEFAULT 0,folder_id UNSIGNED INTEGER,import_type UNSIGNED INTEGER NOT NULL,group_id UNSIGNED INTEGER,forced_title BOOLEAN NOT NULL DEFAULT 0,artist_id UNSIGNED INTEGER,genre_id UNSIGNED INTEGER,track_number UNSIGNED INTEGER,album_id UNSIGNED INTEGER,disc_number UNSIGNED INTEGER,lyrics TEXT,is_public BOOLEAN NOT NULL DEFAULT FALSE,nb_subscriptions UNSIGNED INTEGER NOT NULL DEFAULT 0,description TEXT)"

const LIBRARY_TRACKS = [
  "artist one - Alpha Track.mp3",
  "Artist One - beta track.mp3",
  "Artist Two - Ambiance Éthérée.mp3",
  "Artist Two - Дорога.mp3",
  "artist three - Zulu.flac",
]
// Homonyme rangé deux fois : le sidecar garde le plus gros
export const HOMONYM = { name: LIBRARY_TRACKS[1], large: 2048, small: 512 }
export const PLAYLIST = "test playlist"
export const MISSING_TRACK = "absent track.mp3"

export function buildLibrary(root) {
  const library = join(root, "library")
  mkdirSync(join(library, "singles"), { recursive: true })
  mkdirSync(join(library, "albums"), { recursive: true })
  for (const name of LIBRARY_TRACKS) {
    // « beta » existe deux fois, en tailles différentes : l'homonyme est départagé
    const folder = name.includes("beta") ? join(library, "singles") : library
    writeFileSync(join(folder, name), Buffer.alloc(HOMONYM.large, 1))
  }
  writeFileSync(join(library, "albums", HOMONYM.name), Buffer.alloc(HOMONYM.small, 2))

  const dump = join(root, "vlc_media.db")
  const db = new DatabaseSync(dump)
  db.enableDefensive(false)
  db.exec(DDL_PLAYLIST)
  db.exec(DDL_PLAYLIST_MEDIA_RELATION)
  db.exec(DDL_MEDIA.replace("filename TEXT COLLATE FILENAME", "filename TEXT"))
  const names = [...LIBRARY_TRACKS, MISSING_TRACK]
  names.forEach((name, index) => db.prepare("INSERT INTO Media(id_media, filename, import_type) VALUES (?, ?, 0)").run(index + 1, name))
  db.prepare("INSERT INTO Playlist(id_playlist, name, creation_date) VALUES (1, ?, 0), (2, 'other playlist', 0)").run(PLAYLIST)
  const relation = db.prepare("INSERT INTO PlaylistMediaRelation(media_id, playlist_id, position) VALUES (?, ?, ?)")
  // La première piste figure deux fois : le sidecar doit dédupliquer
  const main = [...names.map((_, index) => index + 1), 1]
  main.forEach((media, position) => relation.run(media, 1, position + 1))
  relation.run(1, 2, 1)
  db.exec("PRAGMA writable_schema = ON")
  db.prepare("UPDATE sqlite_schema SET sql = ? WHERE type = 'table' AND name = 'Media'").run(DDL_MEDIA)
  db.exec("PRAGMA writable_schema = OFF")
  db.close()

  const m3u8 = join(root, "sample.m3u8")
  copyFileSync(join(ROOT, "sidecar", "tests", "fixtures", "sample.m3u8"), m3u8)
  return { library, dump, m3u8, tracks: LIBRARY_TRACKS }
}

// MP3 muet (huit trames MPEG-1 Layer III valides) précédé d'un tag ID3v2.3 : de quoi laisser le
// sidecar lire et réécrire les tags comme sur un vrai fichier
const syncsafe = (value) => Buffer.from([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f])

export function writeTaggedMp3(path, frames) {
  const encoded = Buffer.concat(
    Object.entries(frames).map(([id, text]) => {
      const body = Buffer.concat([Buffer.from([0]), Buffer.from(text, "latin1")])
      const head = Buffer.alloc(10)
      head.write(id, 0, "latin1")
      head.writeUInt32BE(body.length, 4)
      return Buffer.concat([head, body])
    }),
  )
  const header = Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), syncsafe(encoded.length)])
  const audio = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0xc0]), Buffer.alloc(413)])
  writeFileSync(path, Buffer.concat([header, encoded, ...Array(8).fill(audio)]))
}

// Frames texte d'un MP3, par identifiant (`TPE1`, `TIT2`...) : ce que le sidecar y a laissé
export function readTaggedMp3(path) {
  const data = readFileSync(path)
  const version = data[3]
  const end = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9])
  const decode = (body) => {
    const text = body.subarray(1)
    const utf16 = (buffer) => (buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.subarray(2).toString("utf16le") : Buffer.from(buffer.subarray(2)).swap16().toString("utf16le"))
    const decoded = { 0: () => text.toString("latin1"), 1: () => utf16(text), 3: () => text.toString("utf8") }[body[0]]?.() ?? ""
    return decoded.replace(/\0+$/, "")
  }
  const frames = {}
  for (let offset = 10; offset + 10 <= end && data[offset] !== 0; ) {
    const id = data.toString("latin1", offset, offset + 4)
    const size = version === 4 ? syncsafeRead(data, offset + 4) : data.readUInt32BE(offset + 4)
    frames[id] = decode(data.subarray(offset + 10, offset + 10 + size))
    offset += 10 + size
  }
  return frames
}

const syncsafeRead = (data, at) => (data[at] << 21) | (data[at + 1] << 14) | (data[at + 2] << 7) | data[at + 3]

// Dossier de données du sidecar (`LOCALAPPDATA` jetable) : ce que l'app lit au lancement
export const dataFolder = (appData) => join(appData, BUNDLE_ID)

const stamped = (date, runId, suffix) => `${date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${runId}${suffix}`
const slashed = (path) => path.replaceAll("\\", "/")
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

// Run écrit à rendre : un dump des tags d'origine et les fichiers tels que l'écriture les a laissés
// (renommés, tags de la source ajoutés). Le sidecar propose de l'annuler et restaure l'origine.
// Formats : `sidecar/src/tagger/tags/tag_dump.py`, `extra="forbid"` : un champ en trop ou en moins est
// refusé en clair.
export function plantWrittenRun(appData, root) {
  const music = join(root, "written-run")
  mkdirSync(music, { recursive: true })
  const tracks = [
    { origin: "artist one - alpha.mp3", written: "Artist One - Alpha (Original Mix).mp3", artist: "artist one", title: "alpha" },
    { origin: "artist two - beta.mp3", written: "Artist Two - Beta (Extended Mix).mp3", artist: "artist two", title: "beta" },
  ]
  for (const track of tracks) {
    writeTaggedMp3(join(music, track.written), {
      TPE1: track.artist.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      TIT2: track.written.split(" - ")[1].replace(".mp3", ""),
      TCON: "Techno",
      TPUB: "Acme Records",
    })
  }
  const runId = "a1b2c3"
  const createdAt = new Date()
  writeJson(join(dataFolder(appData), "dumps", stamped(createdAt, runId, ".json")), {
    schema_version: 1,
    run_id: runId,
    created_at: createdAt.toISOString(),
    folder: slashed(music),
    entries: Object.fromEntries(
      tracks.map((track) => [
        track.origin,
        {
          path: slashed(join(music, track.origin)),
          renamed_path: slashed(join(music, track.written)),
          system: "id3",
          id3_version: 3,
          fields: { artist: [track.artist], title: [track.title] },
        },
      ]),
    ),
  })
  return { music, runId, tracks }
}

// Run passé à rouvrir : son rapport JSON dans le dossier de musique et la ligne du registre
// (`reports.json`) qui permet de le retrouver. Formats : `sidecar/src/tagger/reports/`.
export function plantPastRun(appData, root) {
  const music = join(root, "past-run")
  mkdirSync(music, { recursive: true })
  const rows = (artist, title) => [
    { field: "artist", key: "TPE1", value: artist },
    { field: "title", key: "TIT2", value: title },
  ]
  const track = (name, overrides) => ({
    track_id: name,
    file_before: name,
    file_after: null,
    truncated: false,
    query: { text: name.replace(".mp3", ""), origin: "tags" },
    source: null,
    state: null,
    resolution: null,
    failure_reason: null,
    scores: null,
    artist: null,
    title: null,
    url: null,
    artwork_url: null,
    system: "id3",
    tags_before: rows("artist one", "alpha"),
    comment_before: null,
    tags_after: null,
    fields_written: [],
    artwork_written: false,
    ...overrides,
  })
  const written = track("artist one - alpha.mp3", {
    file_after: "Artist One - Alpha (Original Mix).mp3",
    source: "beatport",
    state: "written",
    resolution: "auto",
    scores: { artist: 98, title: 96, average: 97, version_mismatch: false, number_mismatch: false },
    artist: "Artist One",
    title: "Alpha (Original Mix)",
    url: "https://beatport.example/track/alpha",
    tags_after: rows("Artist One", "Alpha (Original Mix)"),
    fields_written: ["artist", "title"],
  })
  const missed = track("artist two - beta.mp3", { state: "unresolved", resolution: "none", failure_reason: "no_result", tags_before: rows("artist two", "beta") })
  const runId = "d4e5f6"
  const generatedAt = new Date()
  const reportPath = join(music, "tagging-report.json")
  writeJson(reportPath, {
    schema_version: 1,
    kind: "tagging",
    generated_at: generatedAt.toISOString(),
    run_id: runId,
    folder: slashed(music),
    thresholds: { floor: 70, ceiling: 90 },
    counts: { written: 1, write_error: 0, unresolved: 1, rolled_back: 0, not_processed: 0 },
    tracks: [written, missed],
  })
  writeJson(join(dataFolder(appData), "reports.json"), {
    schema_version: 1,
    entries: [{ run_id: runId, written_at: generatedAt.toISOString(), folder: slashed(music), report_path: slashed(reportPath) }],
  })
  return { music, runId, files: [written.file_before, missed.file_before] }
}

// Run interrompu avant sa confirmation : son plan sur le disque (deux morceaux décidés, un en
// attente) et le dossier de musique qu'il vise. Formats : `sidecar/src/tagger/run/plan.py`.
export function plantInterruptedRun(appData, root) {
  const music = join(root, "interrupted-run")
  mkdirSync(music, { recursive: true })
  const names = ["artist one - alpha.mp3", "artist two - beta.mp3", "artist three - gamma.mp3"]
  for (const name of names) {
    const [artist, title] = name.replace(".mp3", "").split(" - ")
    writeTaggedMp3(join(music, name), { TPE1: artist, TIT2: title })
  }
  const unresolved = (artist, title) => ({
    state: "unresolved",
    resolution: "none",
    failure_reason: "no_result",
    query: { artist, title, origin: "tags" },
  })
  const runId = "c3d4e5"
  const startedAt = new Date()
  const plan = join(dataFolder(appData), "plans", stamped(startedAt, runId, ".json"))
  writeJson(plan, {
    schema_version: 1,
    run_id: runId,
    folder: slashed(music),
    started_at: startedAt.toISOString(),
    thresholds: { floor: 70, ceiling: 90 },
    committed: false,
    tracks: { [names[0]]: unresolved("artist one", "alpha"), [names[1]]: unresolved("artist two", "beta"), [names[2]]: {} },
  })
  return { music, runId, plan, names }
}

// ── Sidecar ──────────────────────────────────────────────────────────────────

// Le vrai process du sidecar, lancé par `just dev-sidecar`, sur stdin et stdout. `LOCALAPPDATA`
// jetable : logs, plans et cache vont sous le dossier donné, jamais dans le profil réel.
// Le trousseau, lui, reste le vrai : seule la lecture (`get_version`) est jouée.
export class Sidecar {
  events = []
  invalid = []
  stderr = ""
  exitCode = null
  #buffer = ""

  constructor(appData) {
    this.appData = appData
    this.child = spawn("just", ["dev-sidecar"], {
      cwd: ROOT,
      env: { ...process.env, LOCALAPPDATA: appData, ...NO_SENTRY_SELFTEST },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.child.stdout.setEncoding("utf8")
    this.child.stdout.on("data", (chunk) => this.#read(chunk))
    this.child.stderr.setEncoding("utf8")
    this.child.stderr.on("data", (chunk) => (this.stderr += chunk))
    this.exited = new Promise((done) =>
      this.child.on("exit", (code) => {
        this.exitCode = code
        done(code)
      }),
    )
    this.child.stdin.on("error", () => {})
  }

  #read(chunk) {
    this.#buffer += chunk
    const lines = this.#buffer.split("\n")
    this.#buffer = lines.pop()
    for (const line of lines.filter(Boolean)) {
      try {
        this.events.push(JSON.parse(line))
      } catch {
        this.invalid.push(line)
      }
    }
  }

  get appDataFolder() {
    return dataFolder(this.appData)
  }

  sendLine(line) {
    this.child.stdin.write(`${line}\n`)
  }

  send(command) {
    this.sendLine(JSON.stringify(command))
  }

  // Envoie une commande et rend les événements reçus jusqu'au premier de `until` ou `error`
  async ask(command, until, timeout = 30_000) {
    const start = this.events.length
    this.send(command)
    const done = () => this.events.slice(start).some((event) => event.event === until || event.event === "error")
    if (!(await waitUntil(done, timeout, 50))) {
      throw new Error(`pas de réponse « ${until} » à ${command.command ?? "la ligne envoyée"} en ${timeout / 1000} s`)
    }
    return this.events.slice(start)
  }

  // Envoie une ligne brute (hors protocole) et rend le premier événement qu'elle provoque
  async askRaw(line, timeout = 10_000) {
    const start = this.events.length
    this.sendLine(line)
    await waitUntil(() => this.events.length > start, timeout, 50)
    return this.events[start] ?? null
  }

  async stop() {
    if (this.exitCode === null) {
      this.child.stdin.end()
      const quit = await Promise.race([this.exited, sleep(15_000).then(() => "timeout")])
      if (quit === "timeout") stopTree(this.child.pid)
    }
    return this.exitCode
  }
}

// ── Fenêtre Tauri ────────────────────────────────────────────────────────────

// Ce qu'un scénario de fenêtre tient d'une étape à l'autre : son dossier de travail, le dossier de données
// jetable, la fenêtre lancée et branchée, les processus relevés à l'ouverture, l'état des préférences avant
export class WindowSession {
  appData = null
  launched = null
  app = null
  known = []
  preferencesBefore = null

  constructor(workdir) {
    this.workdir = workdir
  }
}

// Dossier de données jetable de la fenêtre : y planter l'état de départ avant `launchWindow`
export function windowAppData(workdir) {
  const appData = join(workdir, "appdata")
  mkdirSync(appData)
  return appData
}

// `tauri dev` sur un port libre (le 4200 de `just dev` est souvent tenu) et son port de débogage
// WebView2. `LOCALAPPDATA` jetable pour le sidecar que la fenêtre lance, `WEBVIEW2_USER_DATA_FOLDER`
// pour le profil de la webview : Tauri résout le sien par l'API Windows, que `LOCALAPPDATA` ne
// détourne pas, et cette variable prime sur lui. Sentry de l'interface laissé vide et self-test
// neutralisé : une erreur pendant la vérification ne part nulle part. `CI` pour `ng serve`, comme
// `startDemo` (plusieurs `ng serve` de worktrees voisins se disputent le cache d'optimisation).
// Rendu aussitôt : l'ouverture de la fenêtre est une étape à part, pour que le nettoyage connaisse
// le lanceur même si elle échoue.
export async function launchWindow(workdir, appData) {
  const uiPort = await freePort()
  const cdpPort = await freePort()
  const config = join(workdir, "tauri.verify.json")
  writeFileSync(
    config,
    JSON.stringify({ build: { devUrl: `http://localhost:${uiPort}`, beforeDevCommand: `pnpm start --port ${uiPort}` } }),
  )
  const log = join(workdir, "window.log")
  const isolation = {
    LOCALAPPDATA: appData,
    WEBVIEW2_USER_DATA_FOLDER: join(workdir, "webview2"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    SENTRY_DSN_UI: "",
    ...NO_SENTRY_SELFTEST,
    NG_CLI_ANALYTICS: "false",
    CI: "1",
  }
  const child = startLogged(process.execPath, [join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js"), "dev", "--config", config], {
    log,
    env: isolation,
  })
  return { child, pid: child.pid, uiPort, cdpPort, log, appData, isolation }
}

// Branche une session CDP sur la page de l'app : évaluer une expression, cliquer à des coordonnées.
// Rend `null` si la page n'apparaît pas à temps ou si `tauri dev` est mort (inutile d'attendre).
export async function attachWindow({ cdpPort, uiPort, child }, timeout) {
  let page
  await waitUntil(
    async () => {
      if (child.exitCode !== null) return true
      try {
        const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()
        page = pages.find((entry) => entry.type === "page" && entry.url.startsWith(`http://localhost:${uiPort}`))
        return Boolean(page)
      } catch {
        return false
      }
    },
    timeout,
    1000,
  )
  if (!page) return null
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, fail) => {
    socket.addEventListener("open", done)
    socket.addEventListener("error", fail)
  })
  let nextId = 0
  const call = (method, params = {}) =>
    new Promise((done, fail) => {
      nextId += 1
      const id = nextId
      const onMessage = (message) => {
        const payload = JSON.parse(message.data)
        if (payload.id !== id) return
        socket.removeEventListener("message", onMessage)
        payload.error ? fail(new Error(JSON.stringify(payload.error))) : done(payload.result)
      }
      socket.addEventListener("message", onMessage)
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "exception dans la page")
    return result.value
  }
  const click = async (x, y) => {
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
    const base = { x, y, button: "left", clickCount: 1 }
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...base })
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...base })
  }
  // Vrai clic souris au centre de l'élément, comme le ferait l'utilisateur
  const clickOn = async (selector, index = 0) => {
    const rect = await evaluate(
      `(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    if (!rect) throw new Error(`élément absent : ${selector}`)
    await click(rect.x, rect.y)
  }
  const exists = (selector) => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText.replace(/\\s+/g, ' ').trim() ?? null`)
  return { evaluate, click, clickOn, exists, text, close: () => socket.close() }
}

// Empreinte (date et contenu) du fichier de préférences de l'utilisateur, jamais affiché : Tauri le
// résout par l'API Windows (Roaming), aucune variable ne l'isole. Sert à constater qu'un scénario n'y touche pas.
const PREFERENCES = join(process.env.APPDATA ?? "", BUNDLE_ID, "preferences.json")
export const preferencesStamp = () =>
  existsSync(PREFERENCES) ? `${statSync(PREFERENCES).mtimeMs}:${createHash("sha256").update(readFileSync(PREFERENCES)).digest("hex")}` : "absent"

export const tabCount = (app) => app.evaluate("document.querySelectorAll('p-tab').length")

export const currentPath = (app) => app.evaluate("location.pathname")

// Les trois onglets n'apparaissent qu'une fois le sidecar joint et de la bonne version : sinon
// l'écran bloquant les remplace
export const waitTabs = (app, timeout = 180_000) => waitUntil(async () => (await tabCount(app)) === 3, timeout, 1000)

// Invite de mise à jour qui couvre la fenêtre à l'ouverture : la fermer par « Plus tard », jamais
// « Installer ». Rend le texte de l'invite fermée et celui de tout autre dialogue resté ouvert (qui
// n'a rien à faire là : le verdict en revient au scénario).
export async function closeUpdateInvite(app) {
  const invite = await app.text("app-update-dialog .p-dialog")
  if (invite) {
    await app.clickOn('app-update-dialog [data-action="later"]')
    await waitUntil(async () => !(await app.exists("app-update-dialog .p-dialog")), 5000)
  }
  const unexpected = await app.text(".p-dialog")
  return { invite, unexpected }
}

// Le sidecar lancé par l'app a écrit sa première ligne de journal, qui porte sa version : la
// preuve qu'il tourne et qu'il est de celle de l'interface. Les onglets, eux, s'affichent dès le
// départ : l'écran bloquant n'apparaît que sur un refus, jamais pendant les ~20 s de démarrage.
export const waitEngine = (launched, timeout = 180_000) =>
  waitUntil(
    () => {
      try {
        return readFileSync(join(dataFolder(launched.appData), "logs", "tagger.log"), "utf8").includes(`sidecar started techno-tagger@${VERSION}`)
      } catch {
        return false
      }
    },
    timeout,
    1000,
  )

// Branche la fenêtre lancée, attend ses trois onglets, le sidecar et ferme l'invite de mise à jour
// éventuelle. `app` est nul si la fenêtre n'apparaît pas (ou si `tauri dev` est mort) ; `unexpected`
// est le texte d'un dialogue resté ouvert après l'invite, `null` s'il n'y en a pas.
export async function openAppWindow(launched) {
  const app = await attachWindow(launched, 1_500_000)
  if (!app) return { app: null, tabs: false, engine: false, invite: null, unexpected: null }
  const tabs = await waitTabs(app)
  const engine = await waitEngine(launched)
  return { app, tabs, engine, ...(await closeUpdateInvite(app)) }
}

// Section des Réglages par son rang dans le menu (Administration : 3)
export async function openSettingsSection(app, index) {
  await app.clickOn("p-tab", 2)
  await waitUntil(async () => (await currentPath(app)) === "/settings", 8000)
  // L'adresse change avant que la page des Réglages (chargée à la demande) ne soit rendue : sur un profil
  // WebView2 vierge, sans cache HTTP, l'écart se compte en secondes
  const menu = "app-settings-page p-menu .p-menu-item-content"
  if (!(await waitUntil(() => app.exists(menu), 30_000))) throw new Error("menu des Réglages absent")
  await app.clickOn(menu, index)
}

// Réponse à la modale de confirmation des gestes sur les fichiers : `accept` ou `reject`. Rend le texte de la modale.
export async function answerConfirmation(app, which) {
  const selector = `.p-confirmdialog .p-confirmdialog-${which}-button`
  if (!(await waitUntil(() => app.exists(selector), 8000))) throw new Error("modale de confirmation absente")
  const message = await app.text(".p-confirmdialog")
  await app.clickOn(selector)
  return message
}

// Seconde exécution de l'app pendant que la première tourne : elle doit passer la main et sortir
export async function relaunchApp(launched, timeout = 20_000) {
  const exe = join(ROOT, "src-tauri", "target", "debug", "techno-tagger.exe")
  const second = spawn(exe, [], { cwd: ROOT, stdio: "ignore", windowsHide: true, env: { ...process.env, ...launched.isolation } })
  const left = await Promise.race([new Promise((done) => second.on("exit", done)), sleep(timeout).then(() => "timeout")])
  if (left === "timeout") stopTree(second.pid)
  return left
}

// Arrête la fenêtre et ce qu'elle a lancé, par PID, puis attend que tout soit parti. `known` : les
// processus relevés à l'ouverture. Rend les ports libérés et les noms des survivants.
export async function stopWindow(launched, known = []) {
  try {
    stopTree(launched.pid, known)
  } finally {
    stopListeners(launched.uiPort)
    stopListeners(launched.cdpPort)
  }
  const free = await waitUntil(async () => !(await portAnswers(launched.uiPort)) && !(await portAnswers(launched.cdpPort)), 20_000, 500)
  const remaining = () => processTable().filter((row) => known.some((old) => old.pid === row.pid && old.name === row.name))
  // Les processus de WebView2 sortent quelques secondes après leur hôte
  await waitUntil(() => remaining().length === 0, 30_000, 1000)
  return { free, survivors: remaining().map((row) => row.name) }
}
