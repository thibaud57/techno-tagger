// Arbitrer dans l'ordre de son choix : avec les deux arbitrages en file, le visiteur rattrape « Lowlands »
// d'abord, passe à l'arbitrage suivant, tranche « Тишина » avant « Sub Rosa ». Chaque réponse correspond à
// l'état du moment et le compteur de rattrapage suit les issues courantes.
// `DEMO_URL` vise un serveur déjà lancé, sinon le scénario lance le sien sur un port libre.

import {
  DemoSession,
  closeDialog,
  dialogText,
  goTagging,
  leaveRecovery,
  openLowlands,
  pickAndExtract,
  rowsOf,
  runFinished,
  scratch,
  startRun,
  validateFirst,
  waitCounter,
  waitDialog,
  waitNoDialog,
} from "./_common.mjs"
import { checkConsoleAndNetwork, demoCleanup, demoSteps, play } from "./report.mjs"

const workdir = scratch("demo-order")
const session = new DemoSession()

await play(
  "demo-order",
  [
    ...demoSteps(session, workdir),
    ["arbitrages dans le désordre", async (report) => {
      await session.visit("ordre-libre", {}, async (p) => {
        await pickAndExtract(p, session.base, "fr")
        await goTagging(p)
        await startRun(p)
        await runFinished(p)
        await closeDialog(p)
        await waitCounter(p, /0 sur 1 rattrapés/)
        await openLowlands(p)
        await waitCounter(p, /1 sur 1 rattrapés/)
        report.check(await leaveRecovery(p), "Lowlands rattrapé en premier : la modale le quitte")
        await p.locator("[data-arbitration-badge]").click()
        await waitDialog(p, /Sub Rosa/)
        await p.getByRole("button", { name: /Arbitrage suivant/ }).click()
        await waitDialog(p, /Тишина/)
        await validateFirst(p)
        await waitDialog(p, /Sub Rosa/)
        report.check(/1\/1/.test(await dialogText(p)), "Тишина tranché avant Sub Rosa : il reste Sub Rosa seul")
        await validateFirst(p)
        await waitNoDialog(p)
        await p.waitForFunction(() => !document.querySelector("[data-arbitration-badge]"))
        const rows = await rowsOf(p, /Lowlands|Sub Rosa|Тишина/)
        report.check(rows.length === 3 && rows.filter((t) => /Arbitré$/.test(t)).length === 2 && rows.filter((t) => /URL$/.test(t)).length === 1, "états finals : deux arbitrés, un rattrapé par URL")
      })
    }],
    ["console et réseau", async (report) => checkConsoleAndNetwork(report, session.watch)],
  ],
  demoCleanup(session, workdir),
)
