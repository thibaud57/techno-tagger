// Les choix du visiteur changent la fin de la démo : deux visites, l'une accepte le premier candidat
// Beatport de « Sub Rosa », l'autre le refuse. Chacune va jusqu'au récapitulatif, et la confirmation
// d'écriture comme le récapitulatif diffèrent selon ce que l'enregistrement a produit pour chaque choix.
// `DEMO_URL` vise un serveur déjà lancé, sinon le scénario lance le sien sur un port libre.

import { DemoSession, finishRun, scratch } from "./_common.mjs"
import { checkConsoleAndNetwork, demoCleanup, demoSteps, play } from "./report.mjs"

const workdir = scratch("demo-choices")
const session = new DemoSession()

await play(
  "demo-choices",
  [
    ...demoSteps(session, workdir),
    ["deux fins", async (report) => {
      const outcomes = {}
      for (const choice of ["accept", "refuse"]) {
        outcomes[choice] = await session.visit(`choix-${choice}`, {}, (page) => finishRun(page, session.base, choice))
      }
      report.check(
        outcomes.accept.count !== outcomes.refuse.count && JSON.stringify(outcomes.accept.recap) !== JSON.stringify(outcomes.refuse.recap),
        "Sub Rosa accepté ou refusé : la confirmation et le récapitulatif diffèrent",
        `${outcomes.accept.count} contre ${outcomes.refuse.count} fichiers`,
      )
    }],
    ["console et réseau", async (report) => checkConsoleAndNetwork(report, session.watch)],
  ],
  demoCleanup(session, workdir),
)
