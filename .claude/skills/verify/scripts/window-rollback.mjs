// Annuler le dernier run depuis les Réglages : le dump des tags d'origine, posé dans un dossier de données
// jetable avant l'ouverture, désigne le run annulable ; « Annuler le dernier run » puis la confirmation
// rendent à chaque fichier son nom et ses tags d'origine, et le run n'est plus proposé. La fenêtre est
// lancée par `tauri dev` sur un port libre et pilotée aux vrais clics souris.
// Le run lui-même ne se joue pas (il appelle l'API de production) : son dump et ses fichiers écrits sont
// fabriqués au format du sidecar, dans un dossier temporaire. Le fichier de préférences de l'utilisateur
// n'est pas isolable : aucun geste de réglage n'est joué.

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  WindowSession,
  answerConfirmation,
  dataFolder,
  flat,
  openSettingsSection,
  plantWrittenRun,
  readTaggedMp3,
  scratch,
  waitUntil,
} from "./_common.mjs"
import { REQUIRED, play, windowCleanup, windowSteps } from "./report.mjs"

const session = new WindowSession(scratch("window-rollback"))
let written = null
const restoreEnabled = () => session.app.evaluate("document.querySelector('[data-action=\"restore-last\"]')?.disabled === false")
const frame = windowSteps(session, {
  prepare: (appData) => {
    written = plantWrittenRun(appData, session.workdir)
  },
})

await play(
  "window-rollback",
  [
    ...frame.start,
    ["run annulable proposé", async (report) => {
      const { app } = session
      await openSettingsSection(app, 3)
      const offered = await waitUntil(restoreEnabled, 20_000)
      report.check(offered, "Réglages : « Annuler le dernier run » est actif, le dump désigne un run annulable")
      const target = flat(await app.text("[data-rollback-target]"))
      report.check(target.includes("written-run"), "la ligne du run nomme son dossier", target)
    }, REQUIRED],
    ["confirmation puis annulation", async (report) => {
      const { app } = session
      await app.clickOn('[data-action="restore-last"]')
      const message = flat(await answerConfirmation(app, "accept"))
      report.check(message.includes("written-run"), "la confirmation nomme le dossier du run", message.slice(0, 120))
      const settled = await waitUntil(async () => !(await app.exists("[data-rollback-target]")), 20_000)
      report.check(settled, "le run n'est plus proposé une fois annulé")
      report.check(!(await restoreEnabled()), "« Annuler le dernier run » est grisé : plus rien à annuler")
    }],
    ["fichiers restaurés", async (report) => {
      const files = readdirSync(written.music).sort()
      const expected = written.tracks.map((track) => track.origin).sort()
      report.check(files.join("|") === expected.join("|"), "chaque fichier a retrouvé son nom d'origine, aucun autre ne reste", files.join(" | "))
      for (const track of written.tracks) {
        const tags = readTaggedMp3(join(written.music, track.origin))
        report.check(tags.TPE1 === track.artist && tags.TIT2 === track.title, `${track.origin} : artiste et titre d'origine rendus`, JSON.stringify(tags))
        report.check(tags.TCON === undefined && tags.TPUB === undefined, `${track.origin} : les champs ajoutés par l'écriture sont retirés`, Object.keys(tags).join(","))
      }
      const dumps = join(dataFolder(session.appData), "dumps")
      report.check(!existsSync(dumps) || readdirSync(dumps).filter((name) => name.endsWith(".json")).length === 0, "le dump, vidé de ses entrées, est supprimé")
    }],
    ...frame.end,
  ],
  windowCleanup(session),
)
