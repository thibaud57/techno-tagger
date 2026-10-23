// Recapitulatif d'un run ecrit sous `ng serve`, sidecar simule sur l'instance du service : un
// controle par regle de SKILL.md § Pilotage du recapitulatif. Captures dans
// `.playwright-mcp/verify-recap/`. Lance par `run_page.mjs` (ou le MCP Playwright,
// `browser_run_code_unsafe` avec `filename`), `just dev-ui` servant http://localhost:4200.
async (page) => {
  const out = { checks: {}, failures: [], measures: {} }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const SHOTS = ".playwright-mcp/verify-recap"
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` })
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const settle = () => page.waitForTimeout(350)
  const url = () => page.evaluate(() => location.pathname)
  const navigate = (path) =>
    page.evaluate((p) => ng.getComponent(document.querySelector("app-root")).router.navigateByUrl(p), path)
  const rows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("app-recap-page [data-row-toggle]")].map((b) => b.closest("tr").textContent),
    )
  const counts = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("app-recap-page [data-filter]")].map((s) => [
          s.dataset.filter,
          s.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
        ]),
      ),
    )
  const filter = async (value) => {
    await page.locator(`app-recap-page [data-filter="${value}"]`).click()
    await settle()
  }
  const search = async (text) => {
    await page.locator('app-recap-page input[data-field="search"]').fill(text)
    await settle()
  }

  // Colonne `flex-1 flex-col` sous l'en-tete : la table (ou l'etat encadre) puis le pied, retour a gauche
  // et contexte du run a droite. Ni « Restaurer le run » ni « Nouveau run » : ils vivent dans l'onglet Tagging.
  const footerBlock = () =>
    page.evaluate(() => {
      const host = document.querySelector("app-recap-page")
      const rect = (e) => e.getBoundingClientRect()
      const col = [...host.children].find((k) => k.matches("div.flex.min-h-0.flex-1.flex-col")) ?? null
      const tableBox = col?.firstElementChild ?? null
      const footer = col?.lastElementChild ?? null
      const head = host.querySelector("h1").closest(".flex-wrap")
      const back = footer?.querySelector('[data-action="back"]') ?? null
      const ctx = footer?.querySelector("[data-run-context]") ?? null
      const muted = host.querySelector("[data-filter] .text-muted-color")
      return {
        col: col !== null,
        footerIsLast: !!footer && footer !== tableBox,
        footerClass: footer?.className ?? null,
        headIsDirectChild: head.parentElement === host,
        headHasBack: head.querySelector('[data-action="back"]') !== null,
        headKids: [...head.children].map((k) => k.tagName.toLowerCase()),
        backCount: host.querySelectorAll('[data-action="back"]').length,
        restoreRun: host.querySelectorAll('[data-action="restore-run"]').length,
        newRun: host.querySelectorAll('[data-action="new-run"]').length,
        gap: tableBox && footer ? Math.round(rect(footer).top - rect(tableBox).bottom) : null,
        footerAtColumnBottom: !!footer && Math.abs(rect(footer).bottom - rect(col).bottom) <= 1,
        back: back && {
          cls: back.className,
          icon: back.querySelector("[data-p-icon]")?.getAttribute("data-p-icon"),
          text: back.textContent.trim(),
          leftDelta: Math.round((rect(back).left - rect(tableBox).left) * 10) / 10,
        },
        ctx: ctx && {
          text: ctx.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
          size: getComputedStyle(ctx).fontSize,
          muted: !!muted && getComputedStyle(ctx).color === getComputedStyle(muted).color,
          rightDelta: Math.round((rect(tableBox).right - rect(ctx).right) * 10) / 10,
          afterBack: !!back && rect(back).right <= rect(ctx).left,
        },
      }
    })

  // Tags du sidecar (TAG_FIELDS) : la ligne URL porte la fiche de la source retenue.
  const KEYS = [
    ["artist", "TPE1"], ["title", "TIT2"], ["genre", "TCON"], ["bpm", "TBPM"], ["label", "TPUB"],
    ["date", "TYER"], ["source", "SOURCE"], ["url", "WOAS"],
  ]
  const tagsBefore = (artist, title) => ({
    system: "id3",
    comment: null,
    fields: KEYS.map(([field, key]) => ({ field, key, value: { artist: artist.toLowerCase(), title: title.toLowerCase() }[field] ?? null })),
  })
  const tagsAfter = (t, link) =>
    KEYS.map(([field, key]) => ({ field, key, value: { artist: t.artist, title: `${t.title} (Original Mix)`, genre: "Techno", bpm: "130", label: "Drumcode", date: "2023", source: "beatport", url: link }[field] ?? null }))
  const LONG = "https://www.beatport.com/track/your-mind-layton-giordani-extended-remix-with-a-very-long-slug/99000101"
  const track = (id, artist, title) => ({ track_id: id, file_name: `${artist} - ${title}.mp3`, artist, title, tags_before: tagsBefore(artist, title) })
  const A = track("a.mp3", "Adam Beyer", "Your Mind")
  const B = track("b.mp3", "Amelie Lens", "Basiel")
  const C = track("c.mp3", "Nur Jaber", "Into the Void")
  const D = track("d.mp3", "Hector Oaks", "Sentiment")
  const E = track("e.mp3", "Nobody", "Nothing Here")
  const F = track("f.mp3", "Ignez", "Ark")
  const linkOf = { "a.mp3": LONG, "b.mp3": "https://www.beatport.com/track/basiel/99000102", "c.mp3": "https://amelielens.bandcamp.com/track/into-the-void", "d.mp3": "https://www.beatport.com/track/tidewater/99000104", "f.mp3": "https://www.beatport.com/track/ark/99000106" }
  const decided = (t, state, resolution, extra = {}) => ({
    event: "track_resolved", track_id: t.track_id, state, resolution, failure_reason: null, source: "beatport",
    after: { artist: t.artist, title: `${t.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 },
    artwork_path: null, tags_after: tagsAfter(t, linkOf[t.track_id]), restorable: state !== "resolved", source_url: linkOf[t.track_id], ...extra,
  })
  const unresolved = { event: "track_resolved", track_id: E.track_id, state: "unresolved", resolution: "none", failure_reason: "no_result", source: null, after: null, scores: null, artwork_path: null, tags_after: null, restorable: false, source_url: null }
  const RUN = "r6recap"

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("http://localhost:4200/tagging")
  await page.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
  await page.bringToFront()
  await page.evaluate(async () => {
    const root = ng.getInjector(document.querySelector("app-root"))
    for (const injector of ng["ɵgetInjectorResolutionPath"](root)) {
      let providers
      try {
        providers = ng["ɵgetInjectorProviders"](injector)
      } catch {
        continue
      }
      for (const record of Object.values(providers)) {
        const provided = Object.values(record).find((v) => typeof v === "function" && /SidecarService$/.test(v.name))
        if (provided) window.__svc = injector.get(provided)
      }
      if (window.__svc) break
    }
    window.__sent = []
    window.__svc._available.set(true)
    await new Promise((r) => setTimeout(r, 800))
    window.__svc.send = async (command) => window.__sent.push(command)
    // `openUrl` passe par l'IPC de Tauri, absent sous `ng serve` : pose apres le demarrage, le
    // stub ne releve que l'ouverture de la fiche et refuse le reste comme le ferait l'absence de Tauri.
    window.__opened = []
    window.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => {
        if (cmd === "plugin:opener|open_url") {
          window.__opened.push(args)
          return Promise.resolve()
        }
        return Promise.reject(new Error(`no tauri: ${cmd}`))
      },
    }
  })
  // Version de l'interface lue sur la page (§ Gotchas : une version figee perime a chaque release).
  const version = await page.evaluate(() => {
    window.__svc.handleLine(JSON.stringify({ event: "version", version: "0.0.0-probe", api_key_configured: true }))
    return window.__svc.versionMismatch().ui
  })
  await line({ event: "version", version, api_key_configured: true })
  await page.waitForFunction(() => document.querySelector("app-tagging-page") !== null)

  // 0. Sans run : etat encadre sous l'en-tete reduit au titre, retour dans le pied, jamais une impasse.
  await navigate("/tagging/recap")
  await page.waitForSelector("app-recap-page")
  await settle()
  const none = await page.evaluate(() => ({
    text: document.querySelector("app-recap-page").textContent,
    list: document.querySelector("app-recap-page app-run-list") !== null,
    back: document.querySelector('app-recap-page [data-action="back"]') !== null,
  }))
  check("no run: framed empty state with the way back", /Aucun run à récapituler|No run to summarize/.test(none.text) && !none.list && none.back, none)
  const noneFoot = await footerBlock()
  check("no run: header holds the title only, footer holds the back at the left, no context, no restore or new run", noneFoot.col && noneFoot.footerIsLast && noneFoot.headIsDirectChild && !noneFoot.headHasBack && JSON.stringify(noneFoot.headKids) === JSON.stringify(["h1"]) && noneFoot.backCount === 1 && noneFoot.back?.leftDelta <= 1 && noneFoot.ctx === null && noneFoot.restoreRun === 0 && noneFoot.newRun === 0 && noneFoot.gap === 8, noneFoot)
  await shot("00-no-run")
  await navigate("/tagging")
  await page.waitForSelector("app-tagging-page")

  // Run de six morceaux ecrit : deux auto, un arbitre, un echec d'ecriture arbitre, un non resolu, un restaure.
  await page.evaluate(() => window.__svc.startTagging("C:/Sets"))
  await line({ event: "run_started", run_id: RUN, folder: "C:\\Sets", tracks: [A, B, C, D, E, F] })
  for (const t of [A, B, F]) await line(decided(t, "resolved", "auto"))
  await line(decided(C, "resolved", "arbitration"))
  await line(decided(D, "resolved", "arbitration"))
  await line(unresolved)
  await line({ event: "run_finished", phase: "network", run_id: RUN, resolved: 5, unresolved: 1, written: 0, write_error: 0, awaiting_arbitration: 0, report_path: null })
  await settle()
  const beforeWrite = await page.evaluate(() => document.querySelector('[data-action="recap"]') !== null)
  await page.evaluate(() => window.__svc.commitRun())
  for (const t of [A, B, F]) await line(decided(t, "written", "auto"))
  await line(decided(C, "written", "arbitration"))
  await line(decided(D, "write_error", "arbitration", { failure_reason: "file_locked" }))
  await line({ event: "run_finished", phase: "write", run_id: RUN, resolved: 0, unresolved: 1, written: 4, write_error: 1, awaiting_arbitration: 0, report_path: "C:/Sets/tagging-report-20261012T200000Z.json" })
  // Le contexte du pied vient des runs passes, relus juste apres l'ecriture.
  await line({ event: "runs_listed", runs: [{ run_id: RUN, written_at: "2026-10-12T20:00:00Z", folder: "C:\\Sets", report_path: "C:/Sets/tagging-report-20261012T200000Z.json" }] })
  await page.evaluate((id) => window.__svc.rollback(id, "f.mp3"), RUN)
  await line({ event: "track_resolved", track_id: F.track_id, state: "rolled_back", resolution: "auto", failure_reason: null, source: null, after: null, scores: null, artwork_path: null, tags_after: null, restorable: false, source_url: null })
  await line({ event: "rollback_finished", run_id: RUN, track_id: "f.mp3", restored: ["f.mp3"], failed: [] })
  // La cible de restauration passe a un autre run apres la restauration : le contexte doit rester.
  await line({ event: "rollback_target", run: { run_id: "0a1b2c", written_at: "2026-10-01T20:00:00Z", folder: "C:\\Old", tracks: 2 } })
  await settle()

  // 1. Entree : le bouton n'apparait qu'au bilan de l'ecriture, ouvre /tagging/recap, onglet Tagging gardé.
  const entry = await page.evaluate(() => {
    const b = document.querySelector('[data-action="recap"]')
    return b && { text: b.textContent.trim(), cls: b.className, small: b.classList.contains("p-button-sm") }
  })
  check("recap button absent before the write", beforeWrite === false, beforeWrite)
  check("recap button after the write", entry !== null && /Récapitulatif|Summary/.test(entry.text), entry)
  check("recap button outlined secondary small", entry && /p-button-outlined/.test(entry.cls) && /p-button-secondary/.test(entry.cls) && entry.small, entry)
  await shot("01-tagging-with-recap")
  await page.locator('[data-action="recap"]').click()
  await page.waitForSelector("app-recap-page app-run-list")
  await settle()
  const opened = await page.evaluate(() => ({
    path: location.pathname,
    tab: document.querySelector('p-tab[aria-selected="true"], .p-tab-active')?.textContent.trim(),
    h1: document.querySelector("app-recap-page h1")?.textContent.trim(),
    h1Size: getComputedStyle(document.querySelector("app-recap-page h1")).fontSize,
    h1Weight: getComputedStyle(document.querySelector("app-recap-page h1")).fontWeight,
  }))
  check("recap route with the Tagging tab selected", opened.path === "/tagging/recap" && /Tagging/.test(opened.tab ?? ""), opened)
  check("recap title 24px semibold", opened.h1 === "Récapitulatif du run" && opened.h1Size === "24px" && opened.h1Weight === "600", opened)

  // 2. Filtres et compteurs : un restaure n'est que sous « Tout ».
  const c = await counts()
  out.measures.counts = c
  const num = (s) => Number((s ?? "").match(/(\d+)\s*$/)?.[1])
  check("filter counts 6 / 2 / 1 / 2", num(c.all) === 6 && num(c.validated) === 2 && num(c.arbitrated) === 1 && num(c.failed) === 2, c)
  const byFilter = {}
  for (const value of ["validated", "arbitrated", "failed", "all"]) {
    await filter(value)
    byFilter[value] = await rows()
  }
  const has = (list, name) => list.some((r) => r.includes(name))
  check("filter rows follow the rule", byFilter.validated.length === 2 && byFilter.arbitrated.length === 1 && byFilter.failed.length === 2 && byFilter.all.length === 6, Object.fromEntries(Object.entries(byFilter).map(([k, v]) => [k, v.length])))
  check("write error arbitrated only under failures", has(byFilter.failed, "Sentiment") && !has(byFilter.arbitrated, "Sentiment"), byFilter.failed)
  check("restored track only under all", has(byFilter.all, "Ark") && !["validated", "arbitrated", "failed"].some((k) => has(byFilter[k], "Ark")), null)
  const select = await page.evaluate(() => {
    const group = document.querySelector("app-recap-page p-selectbutton")
    const buttons = [...group.querySelectorAll("button, [role='radio'], .p-togglebutton")]
    return {
      labelledBy: group.querySelector("[aria-labelledby]")?.getAttribute("aria-labelledby") ?? group.getAttribute("aria-labelledby"),
      ariaLabels: buttons.map((b) => b.getAttribute("aria-label")).filter(Boolean),
      small: /p-togglebutton-sm|p-selectbutton-sm/.test(group.innerHTML) || group.className.includes("sm"),
    }
  })
  out.measures.selectButton = select
  check("filter buttons named, never [object Object]", select.ariaLabels.length >= 4 && select.ariaLabels.every((l) => !l.includes("[object")), select)

  // 3. Recherche : casse et espaces de bord ignores, etat vide quand rien ne correspond.
  await search("  YOUR mind ")
  const found = await rows()
  check("search ignores case and edge spaces", found.length === 1 && found[0].includes("Your Mind"), found)
  await search("Ark.mp3")
  check("search covers the file name", (await rows()).length === 1, await rows())
  await filter("validated")
  await search("basielians")
  const empty = await page.evaluate(() => document.querySelector("app-recap-page app-run-list")?.textContent.replace(/[ \t\r\n]+/g, " "))
  check("empty state when nothing matches", (await rows()).length === 0 && /Aucun morceau ne correspond/.test(empty) && /Changez de filtre ou videz la recherche/.test(empty), empty)
  await shot("03-empty-search")
  await search("")
  await filter("all")

  // 4. Detail deplie : lien de la ligne URL, URL longue tronquee, ligne a la hauteur des autres, rien ne defile.
  const toggleOf = (name) => page.locator("app-recap-page tr", { hasText: name }).locator("[data-row-toggle]")
  await toggleOf("Your Mind").click()
  await settle()
  const detail = await page.evaluate(() => {
    const host = document.querySelector("app-recap-page app-track-detail")
    const links = host.querySelectorAll('[data-action="open-source"]')
    const link = links[0]
    const cell = link?.closest("[data-cell]")
    const grid = cell?.parentElement
    const rowHeights = [...grid.parentElement.children].map((r) => Math.round(r.getBoundingClientRect().height))
    const text = link?.querySelector("app-truncated-text") ?? link
    const inner = text?.querySelector("*") ?? text
    const lr = link?.getBoundingClientRect()
    const cr = cell?.getBoundingClientRect()
    return {
      links: links.length,
      ariaLabel: link?.getAttribute("aria-label"),
      linkClass: link?.className,
      fontSize: link && getComputedStyle(link).fontSize,
      icon: link?.querySelector('[data-p-icon="external-link"]') !== null,
      urlRowHeight: Math.round(grid.getBoundingClientRect().height),
      rowHeights,
      truncated: inner ? inner.scrollWidth > inner.clientWidth : null,
      linkInsideCell: lr && cr ? Math.round(lr.right) <= Math.round(cr.right) + 1 : null,
      hostScrolls: host.scrollHeight > host.clientHeight + 1,
    }
  })
  out.measures.detail = detail
  check("one source link, on the url line", detail.links === 1, detail)
  // Nom accessible = l'URL affichee (WCAG label-in-name) : aucun aria-label ne la masque.
  check("source link named by the url it shows", detail.ariaLabel === null, detail.ariaLabel)
  check("source link: link button, external-link icon, text-xs", /p-button-link/.test(detail.linkClass ?? "") && detail.icon && detail.fontSize === "12px", detail)
  check("long url truncated inside its cell", detail.truncated === true && detail.linkInsideCell === true, detail)
  // La premiere rangee est l'en-tete Champ / Avant / Apres, plus haute par son filet.
  const fields = detail.rowHeights.slice(1)
  check("url line as tall as the other lines", Math.max(...fields) === Math.min(...fields), detail.rowHeights)
  check("detail does not scroll", detail.hostScrolls === false, detail)
  await shot("04-detail-link")
  await page.locator('app-recap-page [data-action="open-source"]').click()
  await settle()
  const openedUrl = await page.evaluate(() => window.__opened)
  check("link opens the source page", openedUrl.length === 1 && openedUrl[0]?.url === LONG, openedUrl)

  // Filtre qui retire le morceau deplie : son detail se referme.
  await filter("failed")
  const afterHide = await page.evaluate(() => document.querySelectorAll("app-recap-page app-track-detail").length)
  await filter("all")
  const afterBack = await page.evaluate(() => document.querySelectorAll("app-recap-page app-track-detail").length)
  check("detail closes when the filter hides its track", afterHide === 0 && afterBack === 0, { afterHide, afterBack })

  // Pied, messages et ecarts de la colonne (fidelite a la maquette `Recap`).
  const layout = await page.evaluate(() => {
    const host = document.querySelector("app-recap-page")
    const kids = [...host.children].flatMap((k) => (getComputedStyle(k).display === "contents" ? [...k.children] : [k])).filter((k) => k.getBoundingClientRect().height > 0)
    const gaps = kids.slice(1).map((k, i) => Math.round(k.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom))
    return {
      gaps,
      writeFailure: host.querySelector("[data-write-failures]")?.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
      sendReport: (() => {
        const send = host.querySelectorAll('[data-action="send-report"]')
        const back = host.querySelector('[data-action="back"]')
        return { count: send.length, inBackFooter: !!back && send[0]?.parentElement === back.parentElement, afterBack: !!back && !!send[0] && back.getBoundingClientRect().right <= send[0].getBoundingClientRect().left, label: send[0]?.textContent.trim() }
      })(),
      pageScroll: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight || document.querySelector("main").scrollHeight > document.querySelector("main").clientHeight + 1,
    }
  })
  const foot = await footerBlock()
  out.measures.layout = { ...layout, foot }
  check("write failure message counts the displayed tracks", /: 1\b|:\s*1\b/.test(layout.writeFailure ?? ""), layout.writeFailure)
  check("sections 24px apart", layout.gaps.every((g) => g === 24), layout.gaps)
  check("live run: header holds the title then the filters, no back in it", foot.headIsDirectChild && !foot.headHasBack && JSON.stringify(foot.headKids) === JSON.stringify(["h1", "div"]), foot)
  check("live run: footer 8px under the table, at the bottom of the column", foot.col && foot.footerIsLast && foot.gap === 8 && foot.footerAtColumnBottom && /items-center/.test(foot.footerClass ?? "") && /gap-4/.test(foot.footerClass ?? ""), foot)
  check("live run: back at the bottom left, text secondary small, chevron-left", foot.backCount === 1 && foot.back && /p-button-text/.test(foot.back.cls) && /p-button-secondary/.test(foot.back.cls) && /p-button-sm/.test(foot.back.cls) && foot.back.icon === "chevron-left" && foot.back.leftDelta <= 1 && /Retour à la liste/.test(foot.back.text), foot.back)
  check("live run: context at the bottom right, 14px muted, from the past runs, kept when the rollback target moves to another run", foot.ctx && /^Run du .+ sur C:\\Sets$/.test(foot.ctx.text) && foot.ctx.size === "14px" && foot.ctx.muted && foot.ctx.rightDelta <= 1 && foot.ctx.afterBack, foot.ctx)
  check("live run: no Restaurer le run, no Nouveau run on the recap", foot.restoreRun === 0 && foot.newRun === 0, { restoreRun: foot.restoreRun, newRun: foot.newRun })
  // Le bouton existe depuis monitoring/04 : sa preuve detaillee est `page/feedback-send.js`.
  check("send-report button in the footer, right after the back", layout.sendReport.count === 1 && layout.sendReport.inBackFooter && layout.sendReport.afterBack && /Envoyer ce rapport/.test(layout.sendReport.label), layout.sendReport)
  check("no page scroll at 1280 x 800", layout.pageScroll === false, null)
  await shot("05-recap-1280")

  // 8. En-tete au plancher 1024 x 700, FR puis EN : aucun debordement.
  const header = async () =>
    page.evaluate(() => {
      const h1 = document.querySelector("app-recap-page h1")
      // La rangee est l'en-tete `flex-wrap` (titre puis filtres) ; le retour vit dans le pied.
      const row = h1.closest(".flex-wrap")
      const r = row.getBoundingClientRect()
      const kids = [...row.querySelectorAll(":scope > *, :scope > * > *")].map((k) => k.getBoundingClientRect())
      return {
        overflow: row.scrollWidth > row.clientWidth + 1 || kids.some((k) => k.right > r.right + 1),
        // Titre et retour sur une ligne chacun : un libelle coupe en deux trahit un en-tete sans `flex-wrap`.
        titleHeight: Math.round(h1.getBoundingClientRect().height),
        backHeight: Math.round(document.querySelector('app-recap-page [data-action="back"]').getBoundingClientRect().height),
        footerOverflow: (() => {
          const footer = document.querySelector('app-recap-page [data-action="back"]').parentElement
          return footer.scrollWidth > footer.clientWidth + 1
        })(),
        rowWidth: Math.round(r.width),
        height: Math.round(r.height),
        pageWide: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth,
      }
    })
  await page.setViewportSize({ width: 1024, height: 700 })
  await settle()
  const fr = await header()
  await shot("08-header-1024-fr")
  await page.evaluate(() => ng.getComponent(document.querySelector("app-recap-page")).translate.use("en"))
  await page.waitForTimeout(600)
  const en = await header()
  await shot("08-header-1024-en")
  const enCounts = await counts()
  await page.evaluate(() => ng.getComponent(document.querySelector("app-recap-page")).translate.use("fr"))
  await page.waitForTimeout(600)
  out.measures.header = { fr, en, enCounts }
  check("header and footer fit at 1024px in FR", !fr.overflow && !fr.footerOverflow && !fr.pageWide && fr.titleHeight <= 32 && fr.backHeight <= 32, fr)
  check("header and footer fit at 1024px in EN", !en.overflow && !en.footerOverflow && !en.pageWide && en.titleHeight <= 32 && en.backHeight <= 32, en)
  check("filter labels follow the language", /All/.test(enCounts.all ?? "") && /Failures/.test(enCounts.failed ?? ""), enCounts)
  await page.setViewportSize({ width: 1280, height: 800 })
  await settle()

  // 9. Clic sur l'onglet Tagging deja actif : ramene a la liste (`revisit`, 2026-10-23 ; avant, aucune
  // navigation, `p-tabs` n'emettant rien sur sa valeur courante), puis retour au recapitulatif.
  await page.locator("p-tab", { hasText: "Tagging" }).click()
  await settle()
  check("active Tagging tab click returns to the run list", (await url()) === "/tagging", await url())
  await navigate("/tagging/recap")
  await page.waitForSelector("app-recap-page")
  await settle()

  // 7. Restauration en cours : le recapitulatif n'offre toujours ni « Restaurer le run » ni « Nouveau run », le retour reste actif.
  await page.evaluate((id) => window.__svc.rollback(id, null), RUN)
  await settle()
  const busy = await footerBlock()
  const busyBack = await page.evaluate(() => document.querySelector('app-recap-page [data-action="back"]')?.disabled)
  await shot("07-restore-busy")
  await line({ event: "rollback_finished", run_id: RUN, track_id: null, restored: [], failed: [] })
  await settle()
  check("restore running: still no restore-run or new-run on the recap, back enabled", busy.restoreRun === 0 && busy.newRun === 0 && busyBack === false, { restoreRun: busy.restoreRun, newRun: busy.newRun, busyBack })

  // 5. Retour a la liste : /tagging, run garde, « Restaurer le run » toujours dans la barre de l'onglet Tagging.
  await page.locator('app-recap-page [data-action="back"]').click()
  await page.waitForSelector("app-tagging-page")
  await settle()
  const back = await page.evaluate(() => ({
    path: location.pathname,
    tracks: window.__svc.taggingTracks().length,
    recap: document.querySelector('[data-action="recap"]') !== null,
    restoreRun: document.querySelectorAll('app-tagging-page [data-action="restore-run"]').length,
    newRun: document.querySelectorAll('[data-action="new-run"]').length,
  }))
  check("back to the list keeps the run", back.path === "/tagging" && back.tracks === 6 && back.recap, back)
  check("Restaurer le run stays in the Tagging bar, no Nouveau run", back.restoreRun === 1 && back.newRun === 0, back)

  out.sent = await page.evaluate(() => window.__sent.map((c) => c.command))
  out.success = out.failures.length === 0
  return out
}
