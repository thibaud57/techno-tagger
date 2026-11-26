// Manier la barre de titre de la fenêtre : réduire, agrandir et fermer sont nommés pour un lecteur d'écran,
// agrandir puis rétablir change la taille de la fenêtre et la rend. La fenêtre est lancée par `tauri dev`
// sur un port libre et pilotée aux vrais clics souris. « Réduire » et « Fermer » ne se jouent pas : l'un
// cache la fenêtre au pilotage, l'autre écrit le fichier de préférences de l'utilisateur (non isolable).

import { WindowSession, scratch, waitUntil } from "./_common.mjs"
import { play, windowCleanup, windowSteps } from "./report.mjs"

const session = new WindowSession(scratch("window-controls"))
const frame = windowSteps(session)
const MAXIMIZE = 'app-window-controls [data-action="maximize"]'

await play(
  "window-controls",
  [
    ...frame.start,
    ["noms accessibles", async (report) => {
      const labels = await session.app.evaluate(
        "['minimize','maximize','close'].map((n) => document.querySelector(`app-window-controls [data-action=\"${n}\"]`)?.getAttribute('aria-label') ?? null)",
      )
      report.check(labels.every(Boolean), "réduire, agrandir et fermer ont un nom accessible", labels.join(" | "))
    }],
    ["agrandir puis rétablir", async (report) => {
      const { app } = session
      const size = () => app.evaluate("[window.outerWidth, window.outerHeight].join('x')")
      const start = await size()
      await app.clickOn(MAXIMIZE)
      const grown = await waitUntil(async () => (await size()) !== start, 5000)
      await app.clickOn(MAXIMIZE)
      const restored = await waitUntil(async () => (await size()) === start, 5000)
      report.check(grown && restored, "agrandir puis rétablir change la taille de la fenêtre et la rend", `${start} puis ${await size()}`)
    }],
    ...frame.end,
  ],
  windowCleanup(session),
)
