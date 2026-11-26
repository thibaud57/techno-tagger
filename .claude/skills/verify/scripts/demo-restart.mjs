// Recommencer la démo en plein run, en anglais : « Restart the demo » recharge la démo sur Playlist,
// sans run ni commande du run précédent, dans la langue du visiteur. Le clic part alors que le run est
// démarré et pas terminé, ce que le scénario constate sur les événements rejoués avant de cliquer.
// `DEMO_URL` vise un serveur déjà lancé, sinon le scénario lance le sien sur un port libre.

import { DemoSession, flat, goTagging, pickAndExtract, scratch, startRun, waitEvents } from "./_common.mjs"
import { checkConsoleAndNetwork, demoCleanup, demoSteps, play } from "./report.mjs"

const workdir = scratch("demo-restart")
const session = new DemoSession()

await play(
  "demo-restart",
  [
    ...demoSteps(session, workdir),
    ["recommencer en plein run", async (report) => {
      await session.visit("recommencer-en", {}, async (p) => {
        await pickAndExtract(p, session.base, "en")
        await goTagging(p)
        await startRun(p)
        await waitEvents(p, "run_started", 1)
        const events = await p.evaluate(() => window.__events)
        report.check(!events.includes("run_finished"), "le run est démarré et pas terminé au moment du clic", events.join(","))
        await Promise.all([p.waitForURL(`${session.base}/playlist`), p.locator('[data-action="restart"]').click()])
        await p.waitForSelector("app-playlist-page")
        await p.waitForFunction(() => window.__commands.length > 0 && window.__commands.every((c) => c === "get_version" || c === "get_interrupted_run"))
        const reset = await p.evaluate(() => ({
          lang: document.documentElement.lang,
          restart: document.querySelector('[data-action="restart"]')?.textContent.trim(),
          commands: window.__commands,
        }))
        await p.locator("p-tab").nth(1).click()
        await p.waitForSelector("app-tagging-page app-empty-state")
        const empty = flat(await p.locator("app-tagging-page app-empty-state").innerText())
        report.check(
          reset.lang === "en" && reset.restart === "Restart the demo" && /No run yet/.test(empty) && reset.commands.every((c) => c === "get_version" || c === "get_interrupted_run"),
          "« Restart the demo » en plein run : état vierge, anglais gardé",
        )
      })
    }],
    ["console et réseau", async (report) => checkConsoleAndNetwork(report, session.watch)],
  ],
  demoCleanup(session, workdir),
)
