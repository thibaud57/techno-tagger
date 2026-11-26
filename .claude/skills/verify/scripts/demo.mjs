// Parcours complet d'un visiteur de la démo web, aux gestes réels : choisir les chemins, extraire, lancer
// le run, arbitrer, rattraper par URL, confirmer, écrire, relancer l'écriture, récapitulatif, restaurer,
// recommencer. Ni Tauri, ni sidecar, ni API : le transport rejoue les réponses enregistrées.
// `DEMO_URL` vise un serveur déjà lancé (`just dev-demo`, image nginx, URL publique), sinon le scénario
// lance le sien sur un port libre.

import {
  DISABLED_TIP,
  DemoSession,
  VERSION,
  badges,
  closeDialog,
  commandCount,
  confirmAccept,
  counter,
  dialogText,
  flat,
  goTagging,
  greyed,
  leaveRecovery,
  openLowlands,
  optionCount,
  pickAndExtract,
  recapFilters,
  refuse,
  rowsOf,
  scratch,
  settingsVisit,
  startRun,
  validateFirst,
  waitCounter,
  waitDialog,
  waitEvents,
  waitNoDialog,
} from "./_common.mjs"
import { checkConsoleAndNetwork, demoCleanup, demoSteps, play } from "./report.mjs"

const workdir = scratch("demo")
const session = new DemoSession()

await play(
  "demo",
  [
    ...demoSteps(session, workdir),
    ["parcours complet en français", async (report) => {
      await session.visit("parcours", {}, async (p) => {
        const option = await pickAndExtract(p, session.base, "fr")
        const extraction = flat(await p.locator("app-playlist-page").innerText())
        report.check(/Set du samedi/.test(option), "playlist de la démo proposée", option)
        report.check(
          /Extraction terminée \(\d+ sur \d+\)/.test(extraction) && /Sub Rosa/.test(extraction) && /Lowlands/.test(extraction),
          "rapport d'extraction affiché",
        )
        report.check((await p.locator("app-demo-banner").count()) === 1 && (await p.locator('app-demo-banner [data-action="contact"]').count()) === 1, "bandeau de démo et lien de contact présents")
        await goTagging(p)
        const folder = flat(await p.locator("app-tagging-page app-path-picker").innerText())
        report.check(/Set du samedi/.test(folder), "le dossier de tagging est la destination de l'extraction", folder)

        await startRun(p)
        await waitEvents(p, "run_started", 1)
        const cancel = await greyed(p, '[data-action="cancel"]')
        report.check(cancel.disabled && cancel.tip === DISABLED_TIP, "« Interrompre » grisé avec sa raison", `${cancel.disabled} / ${cancel.tip}`)
        const during = await settingsVisit(p)
        report.check(/^[1-9]/.test(during.cacheSize), "Réglages ouverts pendant le run : le cache mesuré n'est pas vide, le run l'a rempli", during.cacheSize)
        report.check(during.versionRow?.includes(VERSION) ?? false, "la version des Réglages est celle de package.json", during.versionRow)
        await p.waitForFunction(() => document.querySelectorAll("app-run-list tr").length > 1, null, { timeout: 4000 })

        await waitEvents(p, "run_finished", 1)
        if ((await p.locator(".p-dialog").count()) === 0) {
          await p.waitForSelector("[data-arbitration-badge]")
          await p.locator("[data-arbitration-badge]").click()
        }
        await waitDialog(p, /Sub Rosa/)
        let text = await dialogText(p)
        report.check(/Correspondances incertaines : 2/.test(text) && /1\/2/.test(text), "première modale d'arbitrage : Sub Rosa, deux à trancher", text.slice(0, 60))
        await refuse(p)
        await waitDialog(p, /Aucun candidat trouvé/)
        text = await dialogText(p)
        report.check(/Revenir à Beatport/.test(text) && /Passer/.test(text) && (await optionCount(p)) === 0, "refus Beatport : liste Bandcamp vide, retour proposé")
        await p.locator('.p-dialog [data-action="back"]').click()
        await waitDialog(p, /Correspondances incertaines : 2/)
        report.check((await optionCount(p)) === 2, "retour à Beatport : la liste revient")
        await validateFirst(p)
        await waitDialog(p, /Тишина/)
        report.check(/1 à arbitrer/.test((await badges(p)).arbitration ?? ""), "la file d'arbitrage diminue après Sub Rosa")

        await closeDialog(p)
        const mid = await settingsVisit(p)
        report.check(/^[1-9]/.test(mid.cacheSize), "Réglages ouverts au milieu des arbitrages : le cache mesuré n'est pas vide", mid.cacheSize)
        await p.locator("[data-arbitration-badge]").click()
        await waitDialog(p, /Тишина/)
        await refuse(p)
        await waitDialog(p, /Les candidats Beatport ont été refusés/)
        report.check((await optionCount(p)) === 1, "Тишина : un candidat Bandcamp après le refus Beatport")
        await refuse(p)
        await waitDialog(p, /Vous avez refusé tous les candidats/)
        text = await dialogText(p)
        report.check(/Étape facultative/.test(text) && /Résoudre/.test(text), "étape lien proposée après deux refus")
        const refused = await greyed(p, '[data-action="resolve-url"]')
        report.check(refused.disabled && refused.tip === DISABLED_TIP, "« Résoudre » grisé sur un morceau refusé", `${refused.disabled} / ${refused.tip}`)
        await p.locator('[data-field="url"]').fill("https://example.test/track/typed")
        report.check(await p.evaluate(() => document.querySelector('[data-action="resolve-url"]').disabled), "« Résoudre » reste grisé quand une URL est saisie")
        await p.locator('[data-field="url"]').fill("")
        await p.locator('.p-dialog [data-action="skip"]').click()
        await waitNoDialog(p)
        const afterTishina = await badges(p)
        const recovery = await counter(p)
        report.check(/2 à rattraper/.test(afterTishina.recovery ?? "") && afterTishina.arbitration === null && /0 sur 2 rattrapés/.test(recovery), "le total à rattraper suit les issues", `${afterTishina.recovery} / ${recovery}`)

        const lowlands = await openLowlands(p)
        report.check(/^https:\/\/[a-z0-9.-]+\.example\//.test(lowlands.url) && lowlands.readOnly && !lowlands.resolveDisabled, "Lowlands : URL enregistrée en lecture seule, « Résoudre » actif", lowlands.url)
        await waitCounter(p, /1 sur 2 rattrapés/)
        report.check(await leaveRecovery(p), "Lowlands rattrapé : la modale passe au suivant ou se ferme")
        await p.locator("app-run-list tr", { hasText: "Lowlands" }).first().click({ position: { x: 300, y: 20 } })
        await waitDialog(p, /Rattrapé sur/)
        const before = await commandCount(p)
        const again = await greyed(p, '[data-action="resolve-url"]')
        await p.mouse.click(again.box.x + again.box.width / 2, again.box.y + again.box.height / 2)
        await p.waitForTimeout(400)
        report.check(again.disabled && again.tip === DISABLED_TIP && before === (await commandCount(p)), "Lowlands rattrapé : « Résoudre » grisé, un clic n'envoie aucune commande")
        await closeDialog(p)

        await p.locator('[data-action="commit"]').click()
        const commit = await confirmAccept(p, /Écrire les tags/)
        report.check(/Dossier/.test(commit) && /Fichiers à réécrire/.test(commit), "confirmation d'écriture : dossier et fichiers à réécrire", commit.slice(0, 120))
        await waitEvents(p, "run_finished", 2)
        await p.waitForSelector("[data-write-failures]")
        report.check(/échec d'écriture : ?1\b/.test(flat(await p.locator("[data-write-failures]").innerText())), "écriture : un fichier verrouillé en échec")
        await p.waitForFunction(() => document.querySelector('[data-action="retry"]')?.disabled === false)
        await p.locator('[data-action="retry"]').click()
        await confirmAccept(p, /Relancer l'écriture/)
        await waitEvents(p, "run_finished", 3)
        await p.waitForSelector('[data-action="recap"]')
        const rewritten = await p
          .waitForFunction(() => !document.querySelector("[data-write-failures]"), null, { timeout: 8000 })
          .then(() => true)
          .catch(() => false)
        report.check(rewritten, "relance de l'écriture : le fichier verrouillé est écrit, plus aucun échec affiché")
        const written = await greyed(p, '[data-action="start"]')
        report.check(written.disabled && written.tip === DISABLED_TIP, "« Lancer le run » grisé après l'écriture", `${written.disabled} / ${written.tip}`)

        await p.locator('[data-action="recap"]').click()
        await p.waitForURL(/\/tagging\/recap/)
        await p.waitForSelector("app-run-list tr")
        const filters = await recapFilters(p)
        report.check(filters.length === 4 && filters.every((t) => /\d+$/.test(t)), "récapitulatif : quatre filtres comptés", filters.join(" | "))
        await p.locator('[data-action="back"]').click()
        await p.waitForSelector("app-tagging-page")

        await p.locator('[data-action="restore-run"]').click()
        const restore = await confirmAccept(p, /^Restaurer$/)
        await waitEvents(p, "rollback_finished", 1)
        await p.waitForTimeout(600)
        const restored = (await rowsOf(p, /Restauré/)).length
        const expected = Number((restore.match(/Fichiers à restaurer : (\d+)/) ?? [])[1])
        report.check(restored > 0 && restored === expected, "restauration du run : chaque fichier annoncé revient", `${restored} pour ${expected}`)

        await Promise.all([p.waitForURL(`${session.base}/playlist`), p.locator('[data-action="restart"]').click()])
        await p.waitForSelector("app-playlist-page")
        await p.waitForFunction(() => window.__commands.length > 0)
        await p.waitForTimeout(600)
        const reset = await p.evaluate(() => ({ lang: document.documentElement.lang, commands: window.__commands }))
        await p.locator("p-tab").nth(1).click()
        await p.waitForSelector("app-tagging-page app-empty-state")
        const empty = flat(await p.locator("app-tagging-page app-empty-state").innerText())
        report.check(
          reset.lang === "fr" && /Aucun run lancé/.test(empty) && reset.commands.length > 0 && reset.commands.every((c) => c === "get_version" || c === "get_interrupted_run"),
          "« Recommencer la démo » : état vierge, langue gardée",
        )
      })
    }],
    ["console et réseau", async (report) => checkConsoleAndNetwork(report, session.watch)],
  ],
  demoCleanup(session, workdir),
)
