// Régler son interface dans la démo : la langue et le signal sonore se changent dans Réglages > Interface,
// l'interface passe aussitôt dans la langue choisie, et les deux choix sont retrouvés au rechargement
// (les réglages de la démo vivent dans le `localStorage` du navigateur, jamais dans un fichier du poste).
// Les seuils, la clé API et le mode « déplacer » ne se jouent pas dans la démo (cf. SKILL.md, Effets et limites).
// `DEMO_URL` vise un serveur déjà lancé, sinon le scénario lance le sien sur un port libre.

import { DemoSession, scratch } from "./_common.mjs"
import { checkConsoleAndNetwork, demoCleanup, demoSteps, play } from "./report.mjs"

const workdir = scratch("demo-settings")
const session = new DemoSession()
const INTERFACE = 2
const language = (p) => p.evaluate(() => document.documentElement.lang)
const soundOn = (p) => p.locator('[data-field="sound"] input').evaluate((input) => input.checked)

async function openInterface(p) {
  await p.locator("p-tab").nth(2).click()
  await p.locator("app-settings-page p-menu .p-menu-item-content").nth(INTERFACE).click()
  await p.waitForSelector('[data-field="language"]')
  await p.waitForSelector('[data-field="sound"] input')
}

await play(
  "demo-settings",
  [
    ...demoSteps(session, workdir),
    ["langue et signal sonore", async (report) => {
      await session.visit("reglages", {}, async (p) => {
        await p.goto(`${session.base}/?lang=fr`)
        await p.waitForSelector("p-tablist")
        await openInterface(p)
        const sound = await soundOn(p)
        report.check((await language(p)) === "fr", "la démo s'ouvre en français")

        await p.locator('[data-field="language"]').click()
        await p.locator(".p-select-option", { hasText: "English" }).click()
        await p.waitForFunction(() => document.documentElement.lang === "en")
        const title = await p.locator("app-settings-page h1").innerText()
        report.check(/^Settings$/i.test(title.trim()), "choisir English change l'interface aussitôt, sans rechargement", title)

        await p.locator('[data-field="sound"]').click()
        await p.waitForFunction((before) => document.querySelector('[data-field="sound"] input').checked !== before, sound)
        report.check((await soundOn(p)) === !sound, "la bascule du signal sonore change d'état", `${sound} puis ${!sound}`)

        await p.goto(session.base)
        await p.waitForSelector("p-tablist")
        await openInterface(p)
        report.check((await language(p)) === "en", "au rechargement, la langue choisie dans les Réglages est gardée")
        report.check((await soundOn(p)) === !sound, "au rechargement, le signal sonore garde son choix", String(await soundOn(p)))
      })
    }],
    ["console et réseau", async (report) => checkConsoleAndNetwork(report, session.watch)],
  ],
  demoCleanup(session, workdir),
)
