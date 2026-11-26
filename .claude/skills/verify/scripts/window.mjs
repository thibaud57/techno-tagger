// Ouvrir l'application : la vraie fenêtre Tauri s'ouvre sur Playlist, son sidecar répond avec la version
// de l'interface, les trois onglets mènent à leur écran. La fenêtre est lancée par `tauri dev`
// (webview servie par `pnpm start` sur un port libre) et pilotée par CDP de WebView2 aux vrais clics.
// Le fichier de préférences de l'utilisateur n'est pas isolable : aucun geste de réglage n'est joué
// et la fenêtre est arrêtée par PID, jamais par sa croix (le plugin store réécrit le fichier à la sortie).

import { SIDECAR, WindowSession, currentPath, openSettingsSection, preferencesStamp, scratch, VERSION, waitUntil } from "./_common.mjs"
import { play, windowCleanup, windowSteps } from "./report.mjs"

const session = new WindowSession(scratch("window"))
const frame = windowSteps(session, {
  afterOpen: async (report) => {
    // L'adresse de départ `/` redirige vers Playlist une fois les onglets rendus
    const onPlaylist = await waitUntil(async () => (await currentPath(session.app)) === "/playlist", 10_000)
    report.check(onPlaylist, "la fenêtre s'ouvre sur Playlist", await currentPath(session.app))
    report.check(session.known.filter((row) => row.name === SIDECAR).length === 1, "un seul sidecar lancé par l'app")
    report.check(preferencesStamp() === session.preferencesBefore, "l'ouverture n'écrit pas le fichier de préférences")
  },
})

await play(
  "window",
  [
    ...frame.start,
    ["onglets", async (report) => {
      const { app } = session
      await app.clickOn("p-tab", 1)
      report.check(await waitUntil(async () => (await currentPath(app)).startsWith("/tagging"), 8000), "l'onglet Tagging mène à son écran", await currentPath(app))
      await app.clickOn("p-tab", 2)
      report.check(await waitUntil(async () => (await currentPath(app)) === "/settings", 8000), "l'onglet Réglages mène à son écran", await currentPath(app))
      await app.clickOn("p-tab", 0)
      report.check(await waitUntil(async () => (await currentPath(app)) === "/playlist", 8000), "l'onglet Playlist ramène à son écran", await currentPath(app))
    }],
    ["réglages : version et logs", async (report) => {
      const { app } = session
      await openSettingsSection(app, 3)
      const shown = await waitUntil(() => app.exists("[data-version-row]"), 8000)
      const text = shown ? await app.text("[data-version-row]") : ""
      report.check(text.includes(VERSION), "Réglages : la version de l'interface affichée est celle de package.json", text)
      // `reveal-logs` ne s'active qu'à l'annonce du fichier de logs par le sidecar
      const logs = await waitUntil(() => app.evaluate("document.querySelector('[data-action=\"reveal-logs\"]')?.disabled === false"), 8000)
      report.check(logs, "Réglages : « Ouvrir les logs » actif, le sidecar a annoncé son fichier de logs")
      await app.clickOn("p-tab", 0)
    }],
    ...frame.end,
  ],
  windowCleanup(session),
)
