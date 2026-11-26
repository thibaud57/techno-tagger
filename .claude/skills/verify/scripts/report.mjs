// Verdict d'un scénario : lignes PASS/FAIL, déroulé des étapes, nettoyage garanti. Seul endroit des
// scripts qui rend un verdict : `_common.mjs` n'a que des primitives.

import {
  descendants,
  demoLogTail,
  demoReady,
  environmentOrigins,
  launchWindow,
  openAppWindow,
  openBrowser,
  otherInstances,
  preferencesStamp,
  readLogTail,
  removeTree,
  startDemo,
  stopWindow,
  windowAppData,
} from "./_common.mjs"

export const REQUIRED = "required"

export class Report {
  failures = 0

  check(ok, label, detail = "") {
    if (!ok) this.failures += 1
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` : ${detail}` : ""}`)
    return ok
  }

  note(label) {
    console.log(`NOTE  ${label}`)
  }
}

// Ouverture de la fenêtre (`openAppWindow`) : webview exposé, aucun dialogue imprévu (l'invite de mise
// à jour est fermée par la primitive ; `dialogExpected` pour un scénario dont un autre dialogue est le
// sujet), aucun écran bloquant, sidecar de la version de l'interface. Lève si la fenêtre n'existe pas.
export function checkOpened(report, opened, { launched, dialogExpected = false }) {
  report.check(Boolean(opened.app), "la fenêtre s'ouvre et expose son webview", opened.app ? "" : readLogTail(launched.log, 8))
  if (!opened.app) throw new Error("fenêtre absente")
  if (opened.invite) report.note(`invite de mise à jour à l'ouverture, fermée par « Plus tard » : ${opened.invite.slice(0, 80)}`)
  if (!dialogExpected) report.check(!opened.unexpected, "aucun autre dialogue à l'ouverture", opened.unexpected ?? "")
  report.check(opened.tabs, "trois onglets : aucun écran bloquant")
  report.check(opened.engine, "le sidecar lancé par l'app annonce, dans son journal, la version de l'interface")
}

// Ce que les pages de la démo ont émis (`DemoWatch`) : aucune erreur, aucune commande hors scénario,
// aucune violation de CSP, aucune requête hors origine
export function checkConsoleAndNetwork(report, watch) {
  // Le chargement raté du script injecté par l'environnement du poste est une erreur de console de la page, pas de l'app
  const fromEnvironment = (entry) => /^https?:/.test(entry.source) && watch.environment.has(new URL(entry.source).origin)
  const errors = watch.console.filter((entry) => entry.type === "error" && !fromEnvironment(entry))
  report.check(errors.length === 0, "aucune erreur de console", errors.slice(0, 2).map((e) => `${e.label}: ${e.text} (${e.source || "source inconnue"})`).join(" | "))
  report.check(watch.pageErrors.length === 0, "aucune exception de page", watch.pageErrors.slice(0, 1).map((e) => e.text).join(""))
  report.check(!watch.console.some((entry) => /commande hors scenario/.test(entry.text)), "aucune commande hors scénario")
  report.check(!watch.console.some((entry) => /Content Security Policy/i.test(entry.text)), "aucune violation de CSP")
  const outside = watch.foreign.filter((request) => !watch.environment.has(new URL(request.url).origin))
  if (watch.environment.size > 0) report.note(`origines que l'environnement du poste ajoute à toute page, ignorées : ${[...watch.environment].join(", ")}`)
  report.check(outside.length === 0, "aucune requête vers une autre origine", outside.slice(0, 1).map((r) => r.url).join(""))
}

const firstLines = (error, count) => String(error?.message ?? error).split("\n").slice(0, count).join(" | ")

// Joue les étapes `[libellé, étape, REQUIRED?]` dans l'ordre. Une exception est un FAIL nommé qui
// n'interrompt que son étape ; un échec dans une étape REQUIRED arrête la suite (rien ne s'observe
// plus sans elle). Le nettoyage passe toujours : fin normale, SIGINT, SIGTERM, SIGBREAK ou lanceur
// disparu (canal IPC de `run_all`). Un arrêt forcé (`taskkill /F`) ne laisse la main à personne.
export async function play(name, steps, cleanup) {
  const started = Date.now()
  const report = new Report()
  let interruption = null
  let cleaning = null
  const clean = () =>
    (cleaning ??= (async () => {
      try {
        await cleanup?.(report)
      } catch (error) {
        report.check(false, "nettoyage", firstLines(error, 1))
      }
    })())

  const interrupt = (cause) => {
    if (interruption) return
    interruption = cause
    console.log(`== ${name} : interrompu (${cause}), nettoyage`)
    clean().then(() => process.exit(130))
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(signal, () => interrupt(signal))
  // Une erreur du scénario lui-même (hors d'une étape) ne doit pas laisser ses processus derrière elle
  for (const event of ["uncaughtException", "unhandledRejection"]) {
    process.on(event, (error) => {
      console.log(`FAIL  ${name} : erreur hors étape : ${firstLines(error, 3)}`)
      report.failures += 1
      clean().then(() => process.exit(1))
    })
  }
  // `run_all` tient un canal IPC : sa disparition ou son message d'arrêt vaut un signal, que Windows
  // ne sait pas transmettre à un processus fils
  process.on("disconnect", () => interrupt("lanceur disparu"))
  process.on("message", (message) => message?.type === "stop" && interrupt("arrêt demandé par le lanceur"))

  for (const [label, step, required] of steps) {
    if (interruption) break
    const before = report.failures
    try {
      await step(report)
    } catch (error) {
      report.check(false, `${label} : étape interrompue`, firstLines(error, 3))
    }
    if (required === REQUIRED && report.failures > before) {
      report.note(`« ${label} » est requise : les étapes suivantes ne sont pas jouées`)
      break
    }
  }
  await clean()
  if (interruption) return
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(`== ${name} : ${report.failures ? "FAIL" : "PASS"} (${report.failures} échec(s), ${seconds} s)`)
  process.exit(report.failures ? 1 : 0)
}

// Les trois premières étapes de tout scénario de la démo : serveur lancé, servant son scénario, navigateur
// ouvert. Le serveur est connu de la session avant qu'on l'attende : le nettoyage l'arrête même si l'attente échoue.
export function demoSteps(session, workdir) {
  return [
    ["lancement de la démo", async () => {
      session.demo = await startDemo(workdir)
    }],
    ["démo prête", async (report) => {
      const ready = await demoReady(session.demo)
      report.check(ready, "la démo sert son scénario", ready ? session.base : `${session.base} : ${demoLogTail(session.demo)}`)
    }, REQUIRED],
    ["navigateur", async () => {
      session.browser = await openBrowser()
      session.watch.environment = await environmentOrigins(session.browser)
    }, REQUIRED],
  ]
}

export const demoCleanup = (session, workdir) => async () => {
  try {
    await session.close()
  } finally {
    removeTree(workdir)
  }
}

// Encadrement de tout scénario de fenêtre : `start` vérifie qu'aucune autre instance ne tourne (l'app est en
// instance unique) puis ouvre la fenêtre sur un dossier de données jetable, `end` constate que le fichier de
// préférences de l'utilisateur n'a pas bougé. `prepare(appData)` plante l'état de départ avant le lancement,
// `afterOpen(report)` pose les constats propres au scénario sur la fenêtre ouverte. `opening` nomme l'étape
// d'ouverture, `dialogExpected` laisse un dialogue ouvert au lancement (cf. `checkOpened`).
export function windowSteps(session, { opening = "ouverture", dialogExpected = false, prepare, afterOpen } = {}) {
  const start = [
    ["aucune instance en cours", async (report) => {
      const other = otherInstances()
      report.check(other.length === 0, "aucune instance de l'app ne tourne déjà", other.join(", "))
    }, REQUIRED],
    [opening, async (report) => {
      session.preferencesBefore = preferencesStamp()
      session.appData = windowAppData(session.workdir)
      await prepare?.(session.appData)
      session.launched = await launchWindow(session.workdir, session.appData)
      const opened = await openAppWindow(session.launched)
      session.app = opened.app
      session.known = descendants(session.launched.pid)
      checkOpened(report, opened, { launched: session.launched, dialogExpected })
      await afterOpen?.(report)
    }, REQUIRED],
  ]
  const end = [
    ["préférences intactes", async (report) => {
      report.check(preferencesStamp() === session.preferencesBefore, "le fichier de préférences est resté identique pendant tout le passage")
    }],
  ]
  return { start, end }
}

// Arrête la fenêtre par PID, constate que rien de ce que le scénario a lancé ne tourne encore, supprime son dossier
export const windowCleanup = (session) => async (report) => {
  session.app?.close()
  try {
    if (session.launched) {
      const { free, survivors } = await stopWindow(session.launched, session.known)
      report.check(free && survivors.length === 0, "rien de lancé par le scénario ne tourne encore", survivors.join(", "))
    }
  } finally {
    removeTree(session.workdir)
  }
}
