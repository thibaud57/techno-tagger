// Vider le cache depuis les Réglages : la taille du cache de re-tagging s'affiche, « Vider le cache »
// la remet à zéro et libère les fichiers, les plans de run restent. La fenêtre est lancée par
// `tauri dev` sur un port libre, avec un dossier de données jetable que le scénario remplit avant
// l'ouverture, et pilotée aux vrais clics souris.
// Le fichier de préférences de l'utilisateur n'est pas isolable : aucun geste de réglage n'est joué.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { WindowSession, dataFolder, openSettingsSection, scratch, waitUntil } from "./_common.mjs"
import { play, windowCleanup, windowSteps } from "./report.mjs"

const session = new WindowSession(scratch("window-cache"))
// L'écran affiche la taille formatée : 3000 octets s'y lisent « 3 ko », zéro « 0 o » (espace insécable possible)
const cacheSize = () => session.app.evaluate("document.querySelector('[data-cache-size]')?.getAttribute('data-cache-size') ?? null")
const reads = (size, expected) => new RegExp(`^${expected}$`).test((size ?? "").replace(/[\s  ]+/g, " "))
const frame = windowSteps(session, {
  prepare: (appData) => {
    const data = dataFolder(appData)
    mkdirSync(join(data, "cache", "responses"), { recursive: true })
    mkdirSync(join(data, "cache", "artworks"), { recursive: true })
    mkdirSync(join(data, "plans"), { recursive: true })
    writeFileSync(join(data, "cache", "responses", "a.json"), Buffer.alloc(1000))
    writeFileSync(join(data, "cache", "artworks", "b.jpg"), Buffer.alloc(2000))
    writeFileSync(join(data, "plans", "kept.json"), "{}")
  },
})

await play(
  "window-cache",
  [
    ...frame.start,
    ["taille mesurée", async (report) => {
      await openSettingsSection(session.app, 3)
      const measured = await waitUntil(async () => reads(await cacheSize(), "3 ko"), 10_000)
      report.check(measured, "Réglages : la taille du cache est mesurée sur les fichiers posés", String(await cacheSize()))
    }],
    ["cache vidé", async (report) => {
      await session.app.clickOn('[data-action="clear-cache"]')
      const cleared = await waitUntil(async () => reads(await cacheSize(), "0 o"), 10_000)
      report.check(cleared, "Réglages : la taille du cache retombe à zéro après « Vider le cache »", String(await cacheSize()))
      const data = dataFolder(session.appData)
      report.check(!existsSync(join(data, "cache", "responses", "a.json")) && !existsSync(join(data, "cache", "artworks", "b.jpg")), "les fichiers du cache sont supprimés")
      report.check(existsSync(join(data, "plans", "kept.json")), "les plans de run survivent au vidage")
    }],
    ...frame.end,
  ],
  windowCleanup(session),
)
