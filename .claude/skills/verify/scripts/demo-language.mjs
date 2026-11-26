// Accueil du visiteur dans sa langue : la locale du navigateur, le paramètre `?lang` (retiré de l'URL) et
// le choix gardé au rechargement décident de la langue de la démo, avec le français et l'anglais pour
// seules langues. `DEMO_URL` vise un serveur déjà lancé, sinon le scénario lance le sien sur un port libre.

import { DemoSession, scratch } from "./_common.mjs"
import { checkConsoleAndNetwork, demoCleanup, demoSteps, play } from "./report.mjs"

const workdir = scratch("demo-language")
const session = new DemoSession()
const CASES = [
  ["fr-FR", "/", "fr"],
  ["de-DE", "/", "en"],
  ["fr-FR", "/?lang=en", "en"],
  ["fr-FR", "/?lang=de", "fr"],
]

await play(
  "demo-language",
  [
    ...demoSteps(session, workdir),
    ["langue à l'arrivée", async (report) => {
      for (const [locale, path, expected] of CASES) {
        await session.visit(`langue-${locale}`, { locale }, async (p) => {
          await p.goto(`${session.base}${path}`)
          await p.waitForSelector("p-tablist")
          const state = await p.evaluate(() => ({ lang: document.documentElement.lang, search: location.search }))
          report.check(state.lang === expected && state.search === "", `navigateur ${locale}, ${path} : interface en ${expected}, URL sans paramètre`, `${state.lang} ${state.search}`)
          if (path === "/?lang=en") {
            await p.goto(session.base)
            await p.waitForSelector("p-tablist")
            report.check((await p.evaluate(() => document.documentElement.lang)) === "en", "le choix `?lang=en` est gardé au rechargement")
          }
        })
      }
    }],
    ["console et réseau", async (report) => checkConsoleAndNetwork(report, session.watch)],
  ],
  demoCleanup(session, workdir),
)
