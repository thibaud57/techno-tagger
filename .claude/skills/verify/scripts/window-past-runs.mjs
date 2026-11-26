// Rouvrir un run passé depuis les Réglages : le registre des rapports, posé dans un dossier de données
// jetable avant l'ouverture, propose le run, « Ouvrir » affiche son récapitulatif relu dans son rapport,
// sans rien rejouer ni écrire dans le dossier de musique. La fenêtre est lancée par `tauri dev` sur un
// port libre et pilotée aux vrais clics souris.
// Le run lui-même ne se joue pas (il appelle l'API de production) : son rapport est fabriqué au format
// du sidecar. Le fichier de préférences de l'utilisateur n'est pas isolable : aucun geste de réglage.

import {
  WindowSession,
  currentPath,
  flat,
  folderFingerprint,
  openSettingsSection,
  plantPastRun,
  scratch,
  waitUntil,
} from "./_common.mjs"
import { play, windowCleanup, windowSteps } from "./report.mjs"

const session = new WindowSession(scratch("window-past-runs"))
let past = null
let musicBefore = null
const rowsText = () => session.app.evaluate("[...document.querySelectorAll('app-run-list tr')].map((row) => row.textContent.replace(/\\s+/g, ' ').trim()).join(' || ')")
const frame = windowSteps(session, {
  prepare: (appData) => {
    past = plantPastRun(appData, session.workdir)
    musicBefore = folderFingerprint(past.music)
  },
})

await play(
  "window-past-runs",
  [
    ...frame.start,
    ["run proposé", async (report) => {
      const { app } = session
      await openSettingsSection(app, 3)
      const offered = await waitUntil(() => app.evaluate("document.querySelector('[data-action=\"open-past-run\"]')?.disabled === false"), 20_000)
      report.check(offered, "Réglages : « Ouvrir » est actif, le registre propose un run passé")
      const label = flat(await app.text('[data-field="past-run"]'))
      report.check(label.includes("past-run"), "le run proposé nomme son dossier", label)
    }],
    ["récapitulatif rouvert", async (report) => {
      const { app } = session
      await app.clickOn('[data-action="open-past-run"]')
      const routed = await waitUntil(async () => (await currentPath(app)) === `/tagging/recap/${past.runId}`, 8000)
      report.check(routed, "« Ouvrir » mène au récapitulatif du run", await currentPath(app))
      const loaded = await waitUntil(async () => /alpha/i.test(await rowsText()) && /beta/i.test(await rowsText()), 15_000)
      const rows = await rowsText()
      report.check(loaded, "le récapitulatif liste les deux morceaux du rapport", rows.slice(0, 200))
      report.check(/Alpha \(Original Mix\)/.test(rows), "le morceau écrit montre le nom que le run lui a donné", rows.slice(0, 200))
    }],
    ["dossier de musique intact", async (report) => {
      report.check(folderFingerprint(past.music) === musicBefore, "le dossier de musique est intact : mêmes fichiers, mêmes tailles, mêmes contenus")
    }],
    ...frame.end,
  ],
  windowCleanup(session),
)
