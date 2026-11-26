// Rouvrir l'application alors qu'elle tourne : une seconde exécution passe la main à la première et sort,
// jamais deux fenêtres ni deux sidecars. La première instance est lancée par `tauri dev` sur un port libre,
// la seconde est le binaire de développement lancé à la main, comme un double clic sur l'icône.
// Le fichier de préférences de l'utilisateur n'est pas isolable : aucun geste de réglage n'est joué.

import { APP, SIDECAR, WindowSession, relaunchApp, running, scratch } from "./_common.mjs"
import { play, windowCleanup, windowSteps } from "./report.mjs"

const session = new WindowSession(scratch("single-instance"))
const counts = () => {
  const processes = running(APP, SIDECAR)
  return `${processes.filter((row) => row.name === APP).length} fenêtre(s), ${processes.filter((row) => row.name === SIDECAR).length} sidecar(s)`
}
const frame = windowSteps(session, {
  opening: "première instance",
  afterOpen: async (report) => {
    report.check(counts() === "1 fenêtre(s), 1 sidecar(s)", "une fenêtre et un sidecar au départ", counts())
  },
})

await play(
  "window-single-instance",
  [
    ...frame.start,
    ["seconde exécution", async (report) => {
      const left = await relaunchApp(session.launched)
      report.check(left !== "timeout", "la seconde exécution sort d'elle-même", String(left))
      report.check(counts() === "1 fenêtre(s), 1 sidecar(s)", "toujours une fenêtre et un sidecar", counts())
      report.check(await session.app.exists("p-tab"), "la première fenêtre répond toujours")
    }],
    ...frame.end,
  ],
  windowCleanup(session),
)
