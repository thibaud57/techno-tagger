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
    KEYS.map(([field, key]) => ({ field, key, value: { artist: t.artist, title: `${t.title} (Original Mix)`, genre: "Techno", bpm: "130", label: "Kestrel", date: "2023", source: "beatport", url: link }[field] ?? null }))
  const LONG = "https://www.beatport.com/track/dim-orbit-kaelen-mirandor-extended-remix-with-a-very-long-slug/99000101"
  const track = (id, artist, title) => ({ track_id: id, file_name: `${artist} - ${title}.mp3`, artist, title, tags_before: tagsBefore(artist, title) })
  const A = track("a.mp3", "Lior Vance", "Dim Orbit")
  const B = track("b.mp3", "Orla Quenby", "Kelvor")
  const C = track("c.mp3", "Ria Javel", "Over the Moor")
  const D = track("d.mp3", "Ilan Thorne", "Tidewater")
  const E = track("e.mp3", "Nobody", "Nothing Here")
  const F = track("f.mp3", "Valka", "Ark")
  const linkOf = { "a.mp3": LONG, "b.mp3": "https://www.beatport.com/track/kelvor/99000102", "c.mp3": "https://orlaquenby.bandcamp.com/track/over-the-moor", "d.mp3": "https://www.beatport.com/track/tidewater/99000104", "f.mp3": "https://www.beatport.com/track/ark/99000106" }
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

  // 0. Sans run : etat encadre sous l'en-tete reduit au retour et au titre, jamais une impasse.
  await navigate("/tagging/recap")
  await page.waitForSelector("app-recap-page")
  await settle()
  const none = await page.evaluate(() => ({
    text: document.querySelector("app-recap-page").textContent,
    list: document.querySelector("app-recap-page app-run-list") !== null,
    back: document.querySelector('app-recap-page [data-action="back"]') !== null,
  }))
  check("no run: framed empty state with the way back", /Aucun run à récapituler|No run to summarize/.test(none.text) && !none.list && none.back, none)
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
  await page.evaluate((id) => window.__svc.rollback(id, "f.mp3"), RUN)
  await line({ event: "track_resolved", track_id: F.track_id, state: "rolled_back", resolution: "auto", failure_reason: null, source: null, after: null, scores: null, artwork_path: null, tags_after: null, restorable: false, source_url: null })
  await line({ event: "rollback_finished", run_id: RUN, track_id: "f.mp3", restored: ["f.mp3"], failed: [] })
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
  check("write error arbitrated only under failures", has(byFilter.failed, "Tidewater") && !has(byFilter.arbitrated, "Tidewater"), byFilter.failed)
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
  await search("  DIM orbit ")
  const found = await rows()
  check("search ignores case and edge spaces", found.length === 1 && found[0].includes("Dim Orbit"), found)
  await search("Ark.mp3")
  check("search covers the file name", (await rows()).length === 1, await rows())
  await filter("validated")
  await search("kelvorians")
  const empty = await page.evaluate(() => document.querySelector("app-recap-page app-run-list")?.textContent.replace(/[ \t\r\n]+/g, " "))
  check("empty state when nothing matches", (await rows()).length === 0 && /Aucun morceau ne correspond/.test(empty) && /Changez de filtre ou videz la recherche/.test(empty), empty)
  await shot("03-empty-search")
  await search("")
  await filter("all")

  // 4. Detail deplie : lien de la ligne URL, URL longue tronquee, ligne a la hauteur des autres, rien ne defile.
  const toggleOf = (name) => page.locator("app-recap-page tr", { hasText: name }).locator("[data-row-toggle]")
  await toggleOf("Dim Orbit").click()
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
    const btn = (s) => host.querySelector(s)
    const restore = btn('[data-action="restore-run"]')
    const fresh = btn('[data-action="new-run"]')
    const back = btn('[data-action="back"]')
    const kids = [...host.children].flatMap((k) => (getComputedStyle(k).display === "contents" ? [...k.children] : [k])).filter((k) => k.getBoundingClientRect().height > 0)
    const gaps = kids.slice(1).map((k, i) => Math.round(k.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom))
    return {
      gaps,
      writeFailure: host.querySelector("[data-write-failures]")?.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
      restore: restore && { cls: restore.className, icon: restore.querySelector("[data-p-icon]")?.getAttribute("data-p-icon"), text: restore.textContent.trim() },
      newRun: fresh && { cls: fresh.className, icon: fresh.querySelector("[data-p-icon]")?.getAttribute("data-p-icon"), text: fresh.textContent.trim(), right: Math.round(host.getBoundingClientRect().right - fresh.getBoundingClientRect().right) },
      back: back && { cls: back.className, icon: back.querySelector("[data-p-icon]")?.getAttribute("data-p-icon"), text: back.textContent.trim(), beforeTitle: back.getBoundingClientRect().right <= host.querySelector("h1").getBoundingClientRect().left },
      sendReport: /Envoyer ce rapport|Send this report/.test(host.textContent),
      pageScroll: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight || document.querySelector("main").scrollHeight > document.querySelector("main").clientHeight + 1,
    }
  })
  out.measures.layout = layout
  check("write failure message counts the displayed tracks", /: 1\b|:\s*1\b/.test(layout.writeFailure ?? ""), layout.writeFailure)
  check("sections 24px apart", layout.gaps.every((g) => g === 24), layout.gaps)
  check("restore run: outlined primary small, refresh", layout.restore && /p-button-outlined/.test(layout.restore.cls) && !/p-button-secondary|p-button-danger/.test(layout.restore.cls) && /p-button-sm/.test(layout.restore.cls) && layout.restore.icon === "refresh", layout.restore)
  check("new run: text secondary small, plus, at the right edge", layout.newRun && /p-button-text/.test(layout.newRun.cls) && /p-button-secondary/.test(layout.newRun.cls) && /p-button-sm/.test(layout.newRun.cls) && layout.newRun.icon === "plus" && layout.newRun.right <= 1, layout.newRun)
  check("back: text secondary small, chevron-left, before the title", layout.back && /p-button-text/.test(layout.back.cls) && /p-button-secondary/.test(layout.back.cls) && /p-button-sm/.test(layout.back.cls) && layout.back.icon === "chevron-left" && layout.back.beforeTitle, layout.back)
  check("no send-report button (Feature 9)", layout.sendReport === false, null)
  check("no page scroll at 1280 x 800", layout.pageScroll === false, null)
  await shot("05-recap-1280")

  // 8. En-tete au plancher 1024 x 700, FR puis EN : aucun debordement.
  const header = async () =>
    page.evaluate(() => {
      const h1 = document.querySelector("app-recap-page h1")
      // La rangee est l'en-tete `flex-wrap` : depuis le sub-project 07, la ligne de contexte d'un run passe a sa propre rangee dessous.
      const row = h1.closest(".flex-wrap")
      const r = row.getBoundingClientRect()
      const kids = [...row.querySelectorAll(":scope > *, :scope > * > *")].map((k) => k.getBoundingClientRect())
      return {
        overflow: row.scrollWidth > row.clientWidth + 1 || kids.some((k) => k.right > r.right + 1),
        // Titre et retour sur une ligne chacun : un libelle coupe en deux trahit un en-tete sans `flex-wrap`.
        titleHeight: Math.round(h1.getBoundingClientRect().height),
        backHeight: Math.round(row.querySelector('[data-action="back"]').getBoundingClientRect().height),
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
  check("header fits at 1024px in FR", !fr.overflow && !fr.pageWide && fr.titleHeight <= 32 && fr.backHeight <= 32, fr)
  check("header fits at 1024px in EN", !en.overflow && !en.pageWide && en.titleHeight <= 32 && en.backHeight <= 32, en)
  check("filter labels follow the language", /All/.test(enCounts.all ?? "") && /Failures/.test(enCounts.failed ?? ""), enCounts)
  await page.setViewportSize({ width: 1280, height: 800 })
  await settle()

  // 9. Clic sur l'onglet Tagging deja actif : ne navigue pas, d'ou « Retour a la liste ».
  await page.locator("p-tab", { hasText: "Tagging" }).click()
  await settle()
  check("active Tagging tab click stays on the recap", (await url()) === "/tagging/recap", await url())

  // 7. Restauration en cours : « Restaurer le run » desactive.
  await page.evaluate((id) => window.__svc.rollback(id, null), RUN)
  await settle()
  const busy = await page.evaluate(() => document.querySelector('app-recap-page [data-action="restore-run"]')?.disabled)
  await shot("07-restore-busy")
  await line({ event: "rollback_finished", run_id: RUN, track_id: null, restored: [], failed: [] })
  await settle()
  check("restore run disabled while a restore runs", busy === true, busy)

  // 5. Retour a la liste : /tagging, run garde.
  await page.locator('app-recap-page [data-action="back"]').click()
  await page.waitForSelector("app-tagging-page")
  await settle()
  const back = await page.evaluate(() => ({ path: location.pathname, tracks: window.__svc.taggingTracks().length, recap: document.querySelector('[data-action="recap"]') !== null }))
  check("back to the list keeps the run", back.path === "/tagging" && back.tracks === 6 && back.recap, back)

  // 6. Nouveau run : onglet vide, puis un run repart.
  await page.locator('[data-action="recap"]').click()
  await page.waitForSelector('app-recap-page [data-action="new-run"]')
  await page.locator('app-recap-page [data-action="new-run"]').click()
  await page.waitForSelector("app-tagging-page")
  await settle()
  const cleared = await page.evaluate(() => ({
    path: location.pathname,
    tracks: window.__svc.taggingTracks().length,
    requested: window.__svc.requestedFolder(),
    tagging: window.__svc.tagging(),
    recap: document.querySelector('[data-action="recap"]') !== null,
  }))
  check("new run empties the Tagging tab", cleared.path === "/tagging" && cleared.tracks === 0 && cleared.requested === null && cleared.tagging === false && !cleared.recap, cleared)
  await shot("06-after-new-run")
  await page.evaluate(() => window.__svc.startTagging("C:/Other"))
  const relaunched = await page.evaluate(() => ({ tagging: window.__svc.tagging(), sent: window.__sent.filter((c) => c.command === "start_tagging").length }))
  check("a new run starts after clearing", relaunched.tagging === true && relaunched.sent === 2, relaunched)

  out.sent = await page.evaluate(() => window.__sent.map((c) => c.command))
  out.success = out.failures.length === 0
  return out
}
