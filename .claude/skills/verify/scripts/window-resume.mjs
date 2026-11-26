// Run interrompu au lancement suivant : le plan laissé dans le dossier de données jetable, posé avant
// l'ouverture, fait proposer l'invite de reprise ; « Repartir de zéro » supprime le plan sans toucher au
// dossier de musique. La fenêtre est lancée par `tauri dev` sur un port libre et pilotée aux vrais clics.
// « Reprendre » ne se joue pas : la reprise rappelle l'API de production avec la clé du trousseau réel.
// Le run lui-même ne se joue pas non plus : son plan est fabriqué au format du sidecar. Le fichier de
// préférences de l'utilisateur n'est pas isolable : aucun geste de réglage n'est joué.

import { existsSync } from "node:fs"
import { WindowSession, flat, folderFingerprint, plantInterruptedRun, scratch, waitUntil } from "./_common.mjs"
import { REQUIRED, play, windowCleanup, windowSteps } from "./report.mjs"

const session = new WindowSession(scratch("window-resume"))
let interrupted = null
let musicBefore = null
const frame = windowSteps(session, {
  dialogExpected: true,
  prepare: (appData) => {
    interrupted = plantInterruptedRun(appData, session.workdir)
    musicBefore = folderFingerprint(interrupted.music)
  },
})

await play(
  "window-resume",
  [
    ...frame.start,
    ["invite de reprise", async (report) => {
      const { app } = session
      const shown = await waitUntil(() => app.exists("app-resume-dialog .p-dialog"), 30_000)
      report.check(shown, "l'invite de reprise s'ouvre au lancement")
      const text = flat(await app.text("app-resume-dialog .p-dialog"))
      report.check(/2\s*\/\s*3 traités/.test(text), "l'invite annonce les deux morceaux traités sur trois", text.slice(0, 160))
      report.check(text.includes("interrupted-run"), "l'invite nomme le dossier du run", text.slice(0, 160))
      report.check(await app.exists('app-resume-dialog [data-action="discard"]'), "« Repartir de zéro » est proposé")
    }, REQUIRED],
    ["repartir de zéro", async (report) => {
      const { app } = session
      await app.clickOn('app-resume-dialog [data-action="discard"]')
      const closed = await waitUntil(async () => !(await app.exists("app-resume-dialog .p-dialog")), 15_000)
      report.check(closed, "l'invite se ferme")
      report.check(await waitUntil(async () => !existsSync(interrupted.plan), 10_000), "le plan du run est supprimé du dossier de données")
      report.check(folderFingerprint(interrupted.music) === musicBefore, "le dossier de musique est intact : mêmes fichiers, mêmes tailles, mêmes contenus")
    }],
    ...frame.end,
  ],
  windowCleanup(session),
)
