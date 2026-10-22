// Runs passes sous `ng serve`, sidecar simule sur l'instance du service : un controle par regle de
// SKILL.md § Pilotage des runs passes. Rangee « Runs passes » des Reglages, recapitulatif d'un run
// passe en lecture seule, refus de `load_run`. Captures dans `.playwright-mcp/verify-past-runs/`.
// Lance par `run_page.mjs` (ou le MCP Playwright, `browser_run_code_unsafe` avec `filename`),
// `just dev-ui` servant http://localhost:4200. Le transport est simule, pas `send` : le vrai `send`
// efface `lastError` a chaque commande, ce que le refus de `load_run` doit survivre.
async (page) => {
  const out = { checks: {}, failures: [], measures: {} }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const SHOTS = ".playwright-mcp/verify-past-runs"
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` })
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const settle = () => page.waitForTimeout(350)
  const url = () => page.evaluate(() => location.pathname)
  const navigate = (path) =>
    page.evaluate((p) => ng.getComponent(document.querySelector("app-root")).router.navigateByUrl(p), path)
  const setLang = async (lang) => {
    await page.evaluate((l) => {
      ng.getComponent(document.querySelector("app-root")).translate.use(l)
    }, lang)
    await page.waitForTimeout(600)
  }
  const sentOf = (command) => page.evaluate((c) => window.__sent.filter((s) => s.command === c), command)
  const clearSent = () => page.evaluate(() => { window.__sent = [] })
  // Chaque vue FR puis EN, 1280 x 800 puis 1024 x 700 : `fn(largeur, langue)`.
  const eachView = async (fn) => {
    for (const [w, h] of [[1280, 800], [1024, 700]]) {
      await page.setViewportSize({ width: w, height: h })
      for (const lang of ["fr", "en"]) {
        await setLang(lang)
        await settle()
        await fn(w, lang)
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await setLang("fr")
    await settle()
  }
  const pageScroll = () =>
    page.evaluate(() => ({
      v: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight || document.querySelector("main").scrollHeight > document.querySelector("main").clientHeight + 1,
      h: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth,
    }))
  // Le libelle d'un run tel que le produisent les Reglages et le recapitulatif (meme cle, meme date).
  const label = (iso, folder, lang) =>
    page.evaluate(
      ([i, f, l]) => `${l === "fr" ? "Run du" : "Run of"} ${new Intl.DateTimeFormat(l, { dateStyle: "medium", timeStyle: "short" }).format(new Date(i))} ${l === "fr" ? "sur" : "on"} ${f}`,
      [iso, folder, lang],
    )
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
  const num = (s) => Number((s ?? "").match(/(\d+)\s*$/)?.[1])
  const has = (list, name) => list.some((r) => r.includes(name))
  // Un deep-link neuf : on passe par /tagging pour une instance de page neuve.
  const deepLink = async (runId) => {
    await navigate("/tagging")
    await page.waitForSelector("app-tagging-page")
    await clearSent()
    await navigate(`/tagging/recap/${runId}`)
    await page.waitForSelector("app-recap-page")
    await settle()
  }
  // Mise en page du recapitulatif : en-tete (`flex-wrap`, enfant direct de la page), colonne
  // `flex-1 flex-col` qui porte la table (ou le cadre d'un refus) puis le pied, et ses mesures. Le pied
  // tient, pour un run passe comme pour le run vivant, le retour a gauche et le contexte a droite (celui du
  // run vivant vient de la cible de restauration). Le conteneur de la table sert de repere pour les bords.
  const block = () =>
    page.evaluate(() => {
      const host = document.querySelector("app-recap-page")
      const h1 = host.querySelector("h1")
      const head = h1.closest(".flex-wrap")
      const col = [...host.children].find((k) => k.matches("div.flex.min-h-0.flex-1.flex-col")) ?? null
      const tableBox = col?.firstElementChild ?? null
      const footer = col?.lastElementChild ?? null
      const list = host.querySelector("app-run-list")
      const back = host.querySelector('[data-action="back"]')
      const ctx = host.querySelector("[data-run-context]")
      const span = ctx?.querySelector("span") ?? null
      const filters = head.querySelector("p-selectbutton")
      const rect = (e) => e.getBoundingClientRect()
      const mid = (r) => (r.top + r.bottom) / 2
      const hr = rect(head)
      const t = rect(h1)
      const backInFooter = !!back && !!footer && footer.contains(back)
      return {
        h1InHead: h1.parentElement === head,
        headIsDirectChild: head.parentElement === host,
        noContextRow: host.querySelector(".min-h-5") === null,
        backInHead: !!back && head.contains(back),
        backInFooter,
        backCount: host.querySelectorAll('[data-action="back"]').length,
        headHeight: Math.round(hr.height),
        headOverflow: head.scrollWidth > head.clientWidth + 1 || [...head.children].some((k) => rect(k).right > hr.right + 1),
        titleHeight: Math.round(t.height),
        backHeight: back ? Math.round(rect(back).height) : null,
        backSameLineAsTitle: !!back && head.contains(back) && rect(back).right <= t.left && Math.abs(mid(rect(back)) - mid(t)) <= 2,
        filtersBelowTitle: filters ? rect(filters).top >= t.bottom - 1 : null,
        col: col !== null,
        colGap: col ? Math.round(parseFloat(getComputedStyle(col).rowGap)) : null,
        footer: footer !== null && footer !== tableBox,
        footerNextToTable: !!tableBox && tableBox.nextElementSibling === footer,
        footerClass: footer?.className ?? null,
        footerHeight: footer ? Math.round(rect(footer).height) : null,
        footerOverflow: footer ? footer.scrollWidth > footer.clientWidth + 1 : null,
        gap: tableBox && footer ? Math.round(rect(footer).top - rect(tableBox).bottom) : null,
        tableTop: tableBox ? Math.round(rect(tableBox).top) : null,
        tableIsList: !!list && !!tableBox && tableBox.contains(list),
        backLeftDelta: backInFooter ? Math.round((rect(back).left - rect(tableBox).left) * 10) / 10 : null,
        ctx: ctx !== null,
        ctxText: ctx?.textContent.trim() ?? null,
        ctxClass: ctx?.className ?? null,
        ctxSize: ctx ? getComputedStyle(ctx).fontSize : null,
        ctxColor: ctx ? getComputedStyle(ctx).color : null,
        titleColor: getComputedStyle(h1).color,
        ctxRightDelta: ctx ? Math.round((rect(ctx).right - rect(tableBox).right) * 10) / 10 : null,
        ctxCenterDelta: ctx && backInFooter ? Math.round(Math.abs(mid(rect(ctx)) - mid(rect(back))) * 10) / 10 : null,
        ctxAfterBack: ctx && backInFooter ? rect(ctx).left >= rect(back).right - 1 : null,
        ctxInFooter: ctx && footer ? footer.contains(ctx) && rect(ctx).right <= rect(footer).right + 1 : null,
        ctxCut: span ? span.scrollWidth > span.clientWidth : null,
        pageWide: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth,
      }
    })
  // Selecteur des Reglages.
  const selectState = () =>
    page.evaluate(() => {
      const host = document.querySelector("app-settings-page")
      const sel = host.querySelector('[data-field="past-run"]')
      const btn = host.querySelector('[data-action="open-past-run"]')
      const combo = sel.querySelector('[role="combobox"]')
      const component = ng.getComponent(host)
      return {
        shown: sel.querySelector(".p-select-label")?.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
        choice: component.pastChoice().runId,
        formDisabled: component.pastFields.runId().disabled(),
        comboDisabled: combo?.getAttribute("aria-disabled") === "true" || combo?.hasAttribute("disabled") || sel.className.includes("p-disabled"),
        buttonDisabled: btn.disabled,
      }
    })
  const openSelect = async () => {
    await page.locator('app-settings-page [data-field="past-run"]').click()
    await page.waitForSelector('.p-select-overlay [role="option"]')
    await page.waitForTimeout(250)
  }
  const optionTexts = async () => {
    await openSelect()
    const list = await page.evaluate(() =>
      [...document.querySelectorAll('.p-select-overlay [role="option"]')].map((o) => ({
        text: o.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
        selected: o.getAttribute("aria-selected") === "true",
      })),
    )
    await page.keyboard.press("Escape")
    await settle()
    return list
  }
  const pickOption = async (index) => {
    await openSelect()
    await page.locator('.p-select-overlay [role="option"]').nth(index).click()
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
  // Evenement du run vivant (`track_resolved`).
  const decided = (t, state, resolution, extra = {}) => ({
    event: "track_resolved", track_id: t.track_id, state, resolution, failure_reason: null, source: "beatport",
    after: { artist: t.artist, title: `${t.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 },
    artwork_path: null, tags_after: tagsAfter(t, linkOf[t.track_id]), restorable: state !== "resolved", source_url: linkOf[t.track_id], ...extra,
  })
  const unresolved = { event: "track_resolved", track_id: E.track_id, state: "unresolved", resolution: "none", failure_reason: "no_result", source: null, after: null, scores: null, artwork_path: null, tags_after: null, restorable: false, source_url: null }
  // Morceau relu dans un rapport (`TrackLoaded`) : jamais de `restorable`.
  const past = (t, state, resolution, extra = {}) => ({
    track_id: t.track_id, file_name: t.file_name, file_after: state === "written" ? `${t.artist} - ${t.title} (Original Mix).mp3` : null,
    artist: t.artist, title: t.title, state, resolution, failure_reason: null, source: "beatport",
    after: { artist: t.artist, title: `${t.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 },
    tags_before: t.tags_before, tags_after: tagsAfter(t, linkOf[t.track_id]), source_url: linkOf[t.track_id], artwork_path: null, ...extra,
  })
  const pastUnresolved = { track_id: E.track_id, file_name: E.file_name, file_after: null, artist: E.artist, title: E.title, state: "unresolved", resolution: "none", failure_reason: "no_result", source: null, after: null, scores: null, tags_before: E.tags_before, tags_after: null, source_url: null, artwork_path: null }
  // Six morceaux : trois auto, un arbitre, un echec d'ecriture arbitre, un non resolu.
  const PAST_TRACKS = [
    past(A, "written", "auto"), past(B, "written", "auto"), past(F, "written", "auto"),
    past(C, "written", "arbitration"), past(D, "write_error", "arbitration", { failure_reason: "file_locked" }), pastUnresolved,
  ]
  const run = (id, writtenAt, folder) => ({ run_id: id, written_at: writtenAt, folder, report_path: `${folder}/tagging-report.json` })
  const R6 = run("r6aug06", "2026-08-06T12:00:00Z", "D:/Sets/Aout-3")
  const R5 = run("r5aug05", "2026-08-05T12:00:00Z", "D:/Sets/Aout")
  const R2 = run("r2aug02", "2026-08-02T12:00:00Z", "D:/Sets/Juillet")
  const LONG_FOLDER = "D:/Sets/Techno/Archives 2026/Resident nights/Warehouse series/Saturday closing set with the long extended edits"
  const R3 = run("r3long01", "2026-08-03T12:00:00Z", LONG_FOLDER)
  const listed = (...runs) => line({ event: "runs_listed", runs })
  const loaded = (r, tracks = PAST_TRACKS) => line({ event: "run_loaded", run_id: r.run_id, folder: r.folder, generated_at: r.written_at, tracks })
  const refuse = (code, params, command = "load_run") => line({ event: "error", code, params, message: code, command })
  const LIVE = "r6live"

  // ---- Mise en place : meme mecanique que `recap.js`, transport simule au lieu de `send`.
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
    window.__svc.transport.send = async (text) => window.__sent.push(JSON.parse(text))
    window.__svc._available.set(true)
    // `openUrl` passe par l'IPC de Tauri, absent sous `ng serve` : le stub ne releve que l'ouverture
    // de la fiche et refuse le reste.
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
  await setLang("fr")

  // ======================================================================== Reglages
  // 1. Le moteur devient disponible : un seul `list_runs`, rien tant qu'il n'a pas repondu.
  await page.evaluate(() => window.__svc._available.set(null))
  await navigate("/settings")
  await page.waitForSelector("app-settings-page")
  // Une section a la fois depuis settings/02 : la rangee des runs passes est dans Administration (quatrieme entree)
  await page.locator("app-settings-page p-menu .p-menu-item-content").nth(3).click()
  await clearSent()
  await settle()
  const whileNull = (await sentOf("list_runs")).length
  await page.evaluate(() => window.__svc._available.set(true))
  await settle()
  await line({ event: "version", version, api_key_configured: true })
  await settle()
  const onceSent = { whileNull, list: (await sentOf("list_runs")).length, target: (await sentOf("get_rollback_target")).length }
  out.measures.listRunsOnAvailable = onceSent
  check("list_runs: none while the engine is unknown, one when it becomes available", onceSent.whileNull === 0 && onceSent.list === 1, onceSent)

  // 2. Registre vide (ou pas encore arrive) : select et bouton desactives, placeholder.
  const waiting = await selectState()
  await listed()
  await settle()
  const emptyFr = await selectState()
  await setLang("en")
  const emptyEn = await selectState()
  await setLang("fr")
  out.measures.empty = { waiting, emptyFr, emptyEn }
  check("empty registry: select and button disabled, placeholder in FR", emptyFr.formDisabled && emptyFr.comboDisabled && emptyFr.buttonDisabled && /Aucun run à rouvrir/.test(emptyFr.shown ?? ""), emptyFr)
  check("empty registry: placeholder in EN", emptyEn.formDisabled && emptyEn.buttonDisabled && /No run to reopen/.test(emptyEn.shown ?? ""), emptyEn)
  check("list not yet received: select and button disabled", waiting.formDisabled && waiting.buttonDisabled, waiting)
  await shot("00-settings-empty")

  // 3. Deux runs, le 5 puis le 2 aout : options dans l'ordre recu, le plus recent par defaut.
  await listed(R5, R2)
  await settle()
  const expected5 = await label(R5.written_at, R5.folder, "fr")
  const expected2 = await label(R2.written_at, R2.folder, "fr")
  const options = await optionTexts()
  const firstState = await selectState()
  out.measures.options = { options, firstState }
  check("options named Run du {date} sur {dossier}, in the received order", options.length === 2 && options[0].text === expected5 && options[1].text === expected2 && /5 août/.test(options[0].text) && /2 août/.test(options[1].text), { options, expected5, expected2 })
  check("most recent run selected by default", firstState.choice === R5.run_id && options[0].selected && firstState.shown === expected5 && !firstState.formDisabled && !firstState.buttonDisabled, firstState)

  // 4. Nom accessible, disposition de la rangee, aucun defilement.
  const rowInfo = () =>
    page.evaluate(() => {
      const host = document.querySelector("app-settings-page")
      const sel = host.querySelector('[data-field="past-run"]')
      const btn = host.querySelector('[data-action="open-past-run"]')
      const labelEl = host.querySelector("#past-run-label")
      const row = labelEl.closest("app-settings-row")
      const all = [...host.querySelectorAll("app-settings-row")]
      const rect = (e) => e.getBoundingClientRect()
      // Classe utilitaire `hint` : la taille se mesure ensuite sur le style calcule.
      const hint = [...row.querySelectorAll(".hint")].find((s) => !sel.contains(s))
      const labelled = sel.querySelector("[aria-labelledby]")
      const ref = labelled && document.getElementById(labelled.getAttribute("aria-labelledby"))
      const labelBox = rect(labelEl)
      const selBox = rect(sel)
      const btnBox = rect(btn)
      const hintBox = hint && rect(hint)
      const rowBox = rect(row)
      return {
        labels: all.map((r) => r.querySelector("[rowlabel]")?.textContent.trim()),
        sameSection: all.some((r) => r.nextElementSibling === row && r.querySelector("#past-run-label") === null && r.parentElement === row.parentElement),
        labelLeftOfControl: labelBox.right <= selBox.left && labelBox.left < selBox.left,
        labelSize: getComputedStyle(labelEl).fontSize,
        hintUnderControl: !!hintBox && hintBox.top >= Math.max(selBox.bottom, btnBox.bottom) - 1 && Math.abs(hintBox.left - selBox.left) <= 1,
        hintSize: hint && getComputedStyle(hint).fontSize,
        selWidth: Math.round(selBox.width),
        selStyle: sel.getAttribute("style"),
        gap: Math.round(btnBox.left - selBox.right),
        sameLine: Math.abs((selBox.top + selBox.bottom) / 2 - (btnBox.top + btnBox.bottom) / 2) <= 2,
        buttonInsideRow: btnBox.right <= rowBox.right + 1,
        rowOverflow: row.scrollWidth > row.clientWidth + 1,
        labelledBy: labelled?.getAttribute("aria-labelledby") ?? null,
        labelledText: ref?.textContent.trim() ?? null,
        btnClass: btn.className,
        size: getComputedStyle(sel.querySelector(".p-select-label")).fontSize,
      }
    })
  const info = await rowInfo()
  out.measures.row = info
  check("row sits right under Restauration", info.labels.indexOf(info.labels.find((l) => /Runs passés/.test(l ?? ""))) === info.labels.findIndex((l) => /Restauration/.test(l ?? "")) + 1, info.labels)
  check("row: label alone on the left, select then button on the right, same line", info.labelLeftOfControl && info.sameLine && info.labelSize === "14px", info)
  check("row: help under the control, text-xs", info.hintUnderControl && info.hintSize === "12px", info)
  check("select without fixed width, button inside the row", info.selStyle === null || !/width/.test(info.selStyle), info)
  check("select takes the rest of the line", info.selWidth > 300 && info.buttonInsideRow && !info.rowOverflow, info)
  check("select named by the row label", info.labelledBy === "past-run-label" && /Runs passés/.test(info.labelledText ?? ""), info)
  check("button secondary outlined small", /p-button-secondary/.test(info.btnClass) && /p-button-outlined/.test(info.btnClass) && /p-button-sm/.test(info.btnClass), info.btnClass)

  // 5. Choix : survit a une liste qui le contient et a un changement de langue, retombe sinon.
  await pickOption(1)
  const picked = await selectState()
  check("choosing the other run selects it", picked.choice === R2.run_id && picked.shown === expected2, picked)
  await listed(R6, R5, R2)
  await settle()
  const kept = await selectState()
  check("choice survives a new list that holds the run", kept.choice === R2.run_id && kept.shown === expected2, kept)
  await setLang("en")
  const keptEn = await selectState()
  const expected2En = await label(R2.written_at, R2.folder, "en")
  await setLang("fr")
  const backFr = await selectState()
  check("choice survives a language change, label follows the language", keptEn.choice === R2.run_id && keptEn.shown === expected2En && backFr.choice === R2.run_id && backFr.shown === expected2, { keptEn, expected2En, backFr })
  await listed(R6, R5)
  await settle()
  const fell = await selectState()
  check("choice falls back to the most recent when its run is gone", fell.choice === R6.run_id && !fell.formDisabled, fell)

  // 6. Dossier tres long : coupe avec tooltip, la colonne n'elargit pas.
  await listed(R3, R5, R2)
  await settle()
  const expected3 = await label(R3.written_at, R3.folder, "fr")
  await page.setViewportSize({ width: 1024, height: 700 })
  await settle()
  const longState = await selectState()
  const longInfo = await rowInfo()
  const longCut = await page.evaluate(() => {
    const span = document.querySelector('app-settings-page [data-field="past-run"] app-truncated-text span')
    return { truncated: span.scrollWidth > span.clientWidth }
  })
  await page.locator('app-settings-page [data-field="past-run"] app-truncated-text span').hover()
  await page.waitForTimeout(900)
  const tip = await page.evaluate(() => document.querySelector(".p-tooltip")?.textContent.replace(/[ \t\r\n]+/g, " ").trim() ?? null)
  const longScroll = await pageScroll()
  out.measures.longFolder = { longState, longInfo, longCut, tip, longScroll }
  check("long folder: selected label cut, row and page do not overflow", longState.choice === R3.run_id && longCut.truncated && longInfo.buttonInsideRow && !longInfo.rowOverflow && longScroll.h === false, { longState, longCut, longInfo, longScroll })
  check("long folder: the tooltip shows the whole label", tip === expected3, { tip, expected3 })
  await page.mouse.move(0, 0)
  await shot("01-settings-long-folder-1024")
  await page.setViewportSize({ width: 1280, height: 800 })
  await settle()

  // 7. Vues du plancher et du confortable, FR et EN : aucun defilement, captures.
  await listed(R5, R2)
  await settle()
  const noScroll = {}
  await eachView(async (w, lang) => {
    const s = await pageScroll()
    const r = await rowInfo()
    noScroll[`${w}-${lang}`] = { ...s, buttonInsideRow: r.buttonInsideRow, rowOverflow: r.rowOverflow, sameLine: r.sameLine }
    await shot(`settings-${w}-${lang}`)
  })
  out.measures.settingsScroll = noScroll
  check("no page scroll on the settings at 1280 x 800 and 1024 x 700, FR and EN", Object.values(noScroll).every((s) => !s.v && !s.h && s.buttonInsideRow && !s.rowOverflow && s.sameLine), noScroll)

  // ======================================================================== Ouvrir un run
  await pickOption(1)
  await clearSent()
  await page.locator('app-settings-page [data-action="open-past-run"]').click()
  await page.waitForSelector("app-recap-page")
  await settle()
  const skeleton = await page.evaluate(() => {
    const host = document.querySelector("app-recap-page")
    return {
      path: location.pathname,
      tab: document.querySelector('p-tab[aria-selected="true"], .p-tab-active')?.textContent.trim(),
      skeleton: host.querySelector("app-skeleton-rows") !== null,
      text: host.textContent.replace(/[ \t\r\n]+/g, " "),
      emptyStates: host.querySelectorAll("app-empty-state").length,
      rows: host.querySelectorAll("[data-row-toggle]").length,
      actions: host.querySelectorAll('[data-action="restore-run"], [data-action="new-run"], [data-write-failures]').length,
    }
  })
  const opened = await sentOf("load_run")
  const skeletonBlock = await block()
  out.measures.skeleton = { ...skeleton, block: skeletonBlock }
  check("open: route /tagging/recap/<runId>, Tagging tab active", skeleton.path === `/tagging/recap/${R2.run_id}` && /Tagging/.test(skeleton.tab ?? ""), skeleton)
  check("open: exactly one load_run, with the chosen run_id", opened.length === 1 && opened[0].run_id === R2.run_id, opened)
  check("open: skeleton rows until run_loaded, never the empty state", skeleton.skeleton && !/Aucun run à récapituler|No run to summarize/.test(skeleton.text) && skeleton.emptyStates === 0 && skeleton.rows === 0, skeleton)
  check("open: no back button in the header, no write gesture while loading", skeletonBlock.backInHead === false && skeleton.actions === 0, { skeleton, skeletonBlock })
  check("skeleton: header direct under the page, no context row, column of 8px (gap-2) with the table then the footer row", skeletonBlock.h1InHead && skeletonBlock.headIsDirectChild && skeletonBlock.noContextRow && skeletonBlock.col && skeletonBlock.colGap === 8 && skeletonBlock.tableIsList && skeletonBlock.footer && skeletonBlock.footerNextToTable, skeletonBlock)
  check("skeleton: back button first in the footer row (send-report disabled next to it) at the bottom left, 8px under the table, no context", skeletonBlock.backInFooter && skeletonBlock.backCount === 1 && Math.abs(skeletonBlock.backLeftDelta) <= 1 && skeletonBlock.gap === 8 && skeletonBlock.ctx === false && /flex/.test(skeletonBlock.footerClass ?? "") && /items-center/.test(skeletonBlock.footerClass ?? ""), skeletonBlock)
  await shot("02-past-skeleton")

  await loaded(R2)
  await settle()
  const reopened = (await sentOf("load_run")).length
  const body = await page.evaluate(() => {
    const host = document.querySelector("app-recap-page")
    return {
      skeleton: host.querySelector("app-skeleton-rows") !== null,
      h1: host.querySelector("h1").textContent.trim(),
    }
  })
  const loadedBlock = await block()
  out.measures.body = { ...body, block: loadedBlock }
  check("loaded: skeleton gone, title, then the context line in the footer (same date and key as the settings)", !body.skeleton && body.h1 === "Récapitulatif du run" && loadedBlock.ctxText === expected2 && loadedBlock.ctxInFooter === true, { body, loadedBlock, expected2 })
  check("loaded: no back button in the header, back in the footer row at the bottom left (table left edge within 1px), footer row next to the table and 8px under it", loadedBlock.backInHead === false && loadedBlock.backInFooter && loadedBlock.backCount === 1 && Math.abs(loadedBlock.backLeftDelta) <= 1 && loadedBlock.footerNextToTable && loadedBlock.gap === 8 && loadedBlock.colGap === 8 && loadedBlock.headIsDirectChild && loadedBlock.noContextRow, loadedBlock)
  check("loaded: context at the right of the footer row (table right edge within 1px), 14px muted, centered with the back button within 2px", loadedBlock.ctx && Math.abs(loadedBlock.ctxRightDelta) <= 1 && loadedBlock.ctxAfterBack === true && loadedBlock.ctxSize === "14px" && /text-muted-color/.test(loadedBlock.ctxClass ?? "") && /ml-auto/.test(loadedBlock.ctxClass ?? "") && loadedBlock.ctxColor !== loadedBlock.titleColor && loadedBlock.ctxCenterDelta <= 2, loadedBlock)
  check("no layout jump at run_loaded: table top and footer row height unchanged, header unchanged (1280 x 800)", skeletonBlock.ctx === false && loadedBlock.tableTop === skeletonBlock.tableTop && loadedBlock.footerHeight === skeletonBlock.footerHeight && loadedBlock.headHeight === skeletonBlock.headHeight && loadedBlock.gap === skeletonBlock.gap, { skeletonBlock, loadedBlock })
  check("load_run sent once per page instance", reopened === 1, reopened)

  const c = await counts()
  out.measures.counts = c
  check("filter counts 6 / 3 / 1 / 2", num(c.all) === 6 && num(c.validated) === 3 && num(c.arbitrated) === 1 && num(c.failed) === 2, c)
  const byFilter = {}
  for (const value of ["validated", "arbitrated", "failed", "all"]) {
    await filter(value)
    byFilter[value] = await rows()
  }
  check("filter rows follow the rule", byFilter.validated.length === 3 && byFilter.arbitrated.length === 1 && byFilter.failed.length === 2 && byFilter.all.length === 6, Object.fromEntries(Object.entries(byFilter).map(([k, v]) => [k, v.length])))
  check("write error arbitrated only under failures", has(byFilter.failed, "Sentiment") && !has(byFilter.arbitrated, "Sentiment") && has(byFilter.failed, "Nothing Here"), byFilter.failed)
  await search("  YOUR mind ")
  const found = await rows()
  check("search ignores case and edge spaces", found.length === 1 && found[0].includes("Your Mind"), found)
  await search("")

  // Detail avant / apres et lien source, comme `recap.js`.
  const toggleOf = (name) => page.locator("app-recap-page tr", { hasText: name }).locator("[data-row-toggle]")
  await toggleOf("Your Mind").click()
  await settle()
  const detail = await page.evaluate(() => {
    const host = document.querySelector("app-recap-page app-track-detail")
    const links = host.querySelectorAll('[data-action="open-source"]')
    return {
      links: links.length,
      ariaLabel: links[0]?.getAttribute("aria-label") ?? null,
      text: host.textContent.replace(/[ \t\r\n]+/g, " "),
      truncated: (() => { const inner = links[0]?.querySelector("app-truncated-text span") ?? links[0]; return inner ? inner.scrollWidth > inner.clientWidth : null })(),
      hostScrolls: host.scrollHeight > host.clientHeight + 1,
    }
  })
  out.measures.detail = detail
  check("detail: before and after, one source link on the url line", detail.links === 1 && /adam beyer/.test(detail.text) && /Original Mix/.test(detail.text) && detail.ariaLabel === null && detail.truncated === true && detail.hostScrolls === false, detail)
  await shot("03-past-detail")
  await page.locator('app-recap-page [data-action="open-source"]').click()
  await settle()
  const openedUrl = await page.evaluate(() => window.__opened)
  check("detail: the link opens the source page", openedUrl.length === 1 && openedUrl[0]?.url === LONG, openedUrl)
  await toggleOf("Sentiment").click()
  await settle()

  // Lecture seule : aucun geste de restauration, aucun « Nouveau run », ni message ni bilan du run vivant.
  const readOnly = () =>
    page.evaluate(() => {
      const host = document.querySelector("app-recap-page")
      const failures = host.querySelector("app-rollback-failures")
      return {
        restoreRun: host.querySelectorAll('[data-action="restore-run"]').length,
        restoreTrack: host.querySelectorAll('[data-action="restore-track"]').length,
        anyRestore: host.querySelectorAll('[data-action*="restore"]').length,
        newRun: host.querySelectorAll('[data-action="new-run"]').length,
        writeFailures: host.querySelectorAll("[data-write-failures]").length,
        rollbackFailures: host.querySelectorAll("app-rollback-failures").length,
        rollbackFailuresText: failures?.textContent.trim().length ?? 0,
        words: /Restaurer|Restore|Nouveau run|New run|Fichiers en échec|Files that failed/.test(host.textContent),
      }
    })
  const ro = await readOnly()
  out.measures.readOnly = ro
  check("read only: no restore, no new run, no write failure message, no restore summary", ro.anyRestore === 0 && ro.restoreRun === 0 && ro.restoreTrack === 0 && ro.newRun === 0 && ro.writeFailures === 0 && ro.rollbackFailures === 0 && ro.words === false, ro)

  const layout = await page.evaluate(() => {
    const host = document.querySelector("app-recap-page")
    const kids = [...host.children].flatMap((k) => (getComputedStyle(k).display === "contents" ? [...k.children] : [k])).filter((k) => k.getBoundingClientRect().height > 0)
    return { gaps: kids.slice(1).map((k, i) => Math.round(k.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom)), sendReport: host.querySelectorAll('[data-action="send-report"]').length }
  })
  const scroll = await pageScroll()
  out.measures.layout = layout
  // Le bouton « Envoyer ce rapport » est dans le pied du run passe depuis monitoring/04 (preuve : `page/feedback-send.js`).
  check("sections 24px apart, one send-report button, no page scroll at 1280 x 800", layout.gaps.every((g) => g === 24) && layout.sendReport === 1 && !scroll.v && !scroll.h, { layout, scroll })
  await toggleOf("Your Mind").click()
  await toggleOf("Sentiment").click()
  await settle()
  await eachView(async (w, lang) => {
    await shot(`recap-past-${w}-${lang}`)
  })

  // Plancher 1024 x 700, FR puis EN : contexte court puis dossier tres long. Rien ne deborde de la page,
  // le retour reste a gauche du pied sur une ligne, le contexte est coupe a droite avec son tooltip.
  await page.setViewportSize({ width: 1024, height: 700 })
  await settle()
  const shortFr = await block()
  await setLang("en")
  const shortEn = await block()
  await setLang("fr")
  await navigate("/tagging")
  await page.waitForSelector("app-tagging-page")
  await listed(R3, R5, R2)
  await navigate(`/tagging/recap/${R3.run_id}`)
  await page.waitForSelector("app-recap-page")
  await loaded(R3)
  await settle()
  const longFr = await block()
  await shot("04-footer-long-1024-fr")
  const tipOfContext = async () => {
    await page.locator("app-recap-page [data-run-context] span").hover()
    await page.waitForTimeout(900)
    const tip = await page.evaluate(() => document.querySelector(".p-tooltip")?.textContent.replace(/[ \t\r\n]+/g, " ").trim() ?? null)
    await page.mouse.move(0, 0)
    return tip
  }
  const longTip = await tipOfContext()
  await setLang("en")
  const longEn = await block()
  await shot("04-footer-long-1024-en")
  const expected3En = await label(R3.written_at, R3.folder, "en")
  const longTipEn = await tipOfContext()
  await setLang("fr")
  out.measures.floor = { shortFr, shortEn, longFr, longEn, longTip, longTipEn }
  const fits = (h) => !h.headOverflow && !h.pageWide && h.titleHeight <= 32 && h.footerOverflow === false && h.backHeight <= 32
  const footerLeft = (h) => h.backInFooter && !h.backInHead && Math.abs(h.backLeftDelta) <= 1 && h.gap === 8 && h.footerNextToTable
  check("past run at 1024px in FR and EN with the short context: nothing overflows, no back in the header, back at the bottom left, context right-aligned", fits(shortFr) && fits(shortEn) && footerLeft(shortFr) && footerLeft(shortEn) && Math.abs(shortFr.ctxRightDelta) <= 1 && Math.abs(shortEn.ctxRightDelta) <= 1 && shortFr.ctxCenterDelta <= 2 && shortEn.ctxCenterDelta <= 2, { shortFr, shortEn })
  check("very long folder (100 characters) at 1024 x 700, FR and EN: nothing overflows, back on one line at the left, context cut at the right of the same row", R3.folder.length >= 100 && fits(longFr) && fits(longEn) && footerLeft(longFr) && footerLeft(longEn) && longFr.ctxCut === true && longEn.ctxCut === true && longFr.ctxInFooter === true && longEn.ctxInFooter === true && longFr.ctxAfterBack === true && longEn.ctxAfterBack === true && longFr.ctxCenterDelta <= 2 && longEn.ctxCenterDelta <= 2, { longFr, longEn, folderLength: R3.folder.length })
  check("long context: the tooltip shows the whole line, FR and EN", longTip === expected3 && longTipEn === expected3En, { longTip, expected3, longTipEn, expected3En })
  await page.setViewportSize({ width: 1280, height: 800 })
  await settle()

  // Aucun saut a `run_loaded`, dans chaque vue, FR et EN : le haut de la table ne bouge que de ce que
  // l'en-tete lui-meme change (les filtres arrivent avec les morceaux et passent sous le titre en FR a
  // 1024px), la hauteur du pied jamais, et l'ecart de 8px reste le meme.
  const reserved = {}
  let n = 0
  await eachView(async (w, lang) => {
    n += 1
    const r = run(`rv${n}x`, R2.written_at, R2.folder)
    await deepLink(r.run_id)
    const before = await block()
    await loaded(r)
    await settle()
    const after = await block()
    reserved[`${w}-${lang}`] = { before, after, headDelta: after.headHeight - before.headHeight, tableDelta: after.tableTop - before.tableTop }
  })
  out.measures.reserved = reserved
  check("footer row in every view: same height before and after run_loaded, still 8px under the table, context only after, table moves only with the header", Object.values(reserved).every((v) => !v.before.ctx && v.after.ctx && v.before.footerHeight === v.after.footerHeight && v.before.gap === 8 && v.after.gap === 8 && v.tableDelta === v.headDelta), reserved)
  check("no layout jump: the table top and the footer row height do not move at 1280 x 800, FR and EN", ["1280-fr", "1280-en"].every((k) => reserved[k].tableDelta === 0 && reserved[k].headDelta === 0 && reserved[k].before.footerHeight === reserved[k].after.footerHeight), { fr: reserved["1280-fr"], en: reserved["1280-en"] })

  // ======================================================================== Refus
  const refusalView = () =>
    page.evaluate(() => {
      const host = document.querySelector("app-recap-page")
      const msg = host.querySelector("app-error-message")
      const empty = host.querySelector("app-empty-state")
      const back = host.querySelector('[data-action="back"]')
      return {
        message: msg?.textContent.replace(/[ \t\r\n]+/g, " ").trim() ?? null,
        messageAbove: !!msg && !!empty && msg.getBoundingClientRect().bottom <= empty.getBoundingClientRect().top + 1,
        messageBelowHeader: !!msg && msg.getBoundingClientRect().top >= host.querySelector("h1").getBoundingClientRect().bottom - 1,
        emptyText: empty?.textContent.replace(/[ \t\r\n]+/g, " ").trim() ?? null,
        // Cadre du panneau (hote de `app-empty-state` en `framed`) lu sur son style calcule : bordure de 1px, rayon de 8px, fond plein.
        emptyFramed: (() => {
          if (!empty) return false
          const style = getComputedStyle(empty)
          return style.borderTopWidth === "1px" && style.borderTopLeftRadius === "8px" && style.backgroundColor !== "rgba(0, 0, 0, 0)"
        })(),
        table: host.querySelector("table, app-run-list") !== null,
        skeleton: host.querySelector("app-skeleton-rows") !== null,
        back: back !== null,
        filters: host.querySelector("p-selectbutton") !== null,
        context: host.querySelector("[data-run-context]") !== null,
        backInHead: back !== null && host.querySelector("h1").closest(".flex-wrap").contains(back),
        footerUnderEmpty: (() => {
          const footer = back?.closest("div.flex.items-center")
          return !!footer && !!empty && footer.previousElementSibling === empty && Math.round(footer.getBoundingClientRect().top - empty.getBoundingClientRect().bottom) === 8 && Math.abs(back.getBoundingClientRect().left - empty.getBoundingClientRect().left) <= 1
        })(),
        actions: host.querySelectorAll('[data-action="restore-run"], [data-action="new-run"], [data-write-failures]').length,
      }
    })

  // 1. run_not_found
  await deepLink("000000")
  const sentNotFound = await sentOf("load_run")
  const loadingNotFound = await refusalView()
  await refuse("run_not_found", { run_id: "000000" })
  await settle()
  const notFound = await refusalView()
  out.measures.notFound = { sentNotFound, loadingNotFound, notFound }
  check("deep link: one load_run, skeleton first", sentNotFound.length === 1 && sentNotFound[0].run_id === "000000" && loadingNotFound.skeleton && loadingNotFound.message === null, { sentNotFound, loadingNotFound })
  check("refusal: back in the footer, no context, neither while loading nor once refused", !loadingNotFound.backInHead && loadingNotFound.back && !loadingNotFound.context && !notFound.backInHead && notFound.back && !notFound.context, { loadingNotFound, notFound })
  check("run_not_found: translated message, framed empty state, back kept, no table", /Ce run n'existe plus/.test(notFound.message ?? "") && /Impossible d'afficher ce run/.test(notFound.emptyText ?? "") && notFound.messageAbove && notFound.messageBelowHeader && notFound.emptyFramed && notFound.footerUnderEmpty && !notFound.table && !notFound.skeleton && notFound.back && !notFound.filters && notFound.actions === 0, notFound)
  // Une autre commande efface `lastError`, pas le refus de la page.
  await page.evaluate(async () => {
    await window.__svc.loadRollbackTarget()
    await window.__svc.listRuns()
  })
  await settle()
  const afterOther = await refusalView()
  const errorsKept = await page.evaluate(() => ({ lastError: window.__svc.lastError(), refusal: window.__svc.loadRefusal()?.runId ?? null }))
  out.measures.afterOther = { afterOther, errorsKept }
  check("run_not_found: another command neither clears the message nor brings the skeleton back", /Ce run n'existe plus/.test(afterOther.message ?? "") && !afterOther.skeleton && afterOther.back && errorsKept.lastError === null && errorsKept.refusal === "000000", { afterOther, errorsKept })
  await eachView(async (w, lang) => {
    await shot(`refusal-${w}-${lang}`)
  })
  await setLang("en")
  const notFoundEn = await refusalView()
  await setLang("fr")
  check("run_not_found: message follows the language", /This run no longer exists/.test(notFoundEn.message ?? "") && /This run cannot be shown/.test(notFoundEn.emptyText ?? ""), notFoundEn)
  await page.locator('app-recap-page [data-action="back"]').click()
  await page.waitForSelector("app-tagging-page")
  check("run_not_found: back leads to /tagging", (await url()) === "/tagging", await url())

  // 2. phase_busy (sans run_id : il vise le run en chargement)
  await deepLink("b1busy")
  await refuse("phase_busy", { phase: "write" })
  await settle()
  const busy = await refusalView()
  await page.evaluate(async () => { await window.__svc.loadRollbackTarget() })
  await settle()
  const busyAfter = await refusalView()
  await setLang("en")
  const busyEn = await refusalView()
  await setLang("fr")
  out.measures.phaseBusy = { busy, busyAfter, busyEn }
  check("phase_busy: the sentence of the running phase, framed empty state, no table", /L'écriture est en cours/.test(busy.message ?? "") && /Impossible d'afficher ce run/.test(busy.emptyText ?? "") && busy.emptyFramed && !busy.table && !busy.skeleton && busy.back, busy)
  check("phase_busy: back in the footer under the framed empty state, no context", busy.footerUnderEmpty && busyAfter.footerUnderEmpty && !busy.backInHead && !busy.context && !busyAfter.context, { busy, busyAfter })
  check("phase_busy: another command keeps the refusal", /L'écriture est en cours/.test(busyAfter.message ?? "") && !busyAfter.skeleton, busyAfter)
  check("phase_busy: message in EN", /Writing is in progress/.test(busyEn.message ?? ""), busyEn)
  await shot("05-refusal-phase-busy")
  // Une fois la phase finie, rouvrir le meme run renvoie la commande.
  await deepLink("b1busy")
  const retried = await sentOf("load_run")
  check("phase_busy: opening the run again sends load_run again", retried.length === 1 && retried[0].run_id === "b1busy", retried)
  await refuse("phase_busy", { phase: "tagging" })

  // 3. le refus d'un autre run ne s'affiche pas, la reponse d'un run que personne n'attend est ignoree
  await deepLink("w1wait")
  await refuse("run_not_found", { run_id: "other99" })
  await loaded({ ...R5, run_id: "zzz9" })
  await settle()
  const foreign = await refusalView()
  await loaded({ ...R5, run_id: "w1wait" }, [PAST_TRACKS[0]])
  await settle()
  const arrived = await page.evaluate(() => ({ rows: document.querySelectorAll("app-recap-page [data-row-toggle]").length, skeleton: document.querySelector("app-recap-page app-skeleton-rows") !== null, message: document.querySelector("app-recap-page app-error-message") !== null }))
  out.measures.foreign = { foreign, arrived }
  check("another run's refusal and answer leave the skeleton", foreign.skeleton && foreign.message === null && foreign.emptyText === null, foreign)
  check("the awaited answer still lands after them", arrived.rows === 1 && !arrived.skeleton && !arrived.message, arrived)

  // 4. moteur pas encore disponible : aucune commande, squelettes, une seule a la disponibilite
  await page.evaluate(() => window.__svc._available.set(null))
  await deepLink("d1late")
  const lateBefore = { sent: (await sentOf("load_run")).length, view: await refusalView() }
  await page.evaluate(() => window.__svc._available.set(true))
  await settle()
  const lateAfter = (await sentOf("load_run")).length
  out.measures.late = { lateBefore, lateAfter }
  check("engine not ready: skeleton, no load_run; one when it becomes available", lateBefore.sent === 0 && lateBefore.view.skeleton && lateAfter === 1, { lateBefore, lateAfter })
  await loaded({ ...R5, run_id: "d1late" })
  await settle()

  // ======================================================================== Run vivant puis run passe
  await navigate("/tagging")
  await page.waitForSelector("app-tagging-page")
  await clearSent()
  await page.evaluate(() => window.__svc.startTagging("C:/Sets"))
  await line({ event: "run_started", run_id: LIVE, folder: "C:\\Sets", tracks: [A, B, C, D, E, F] })
  for (const t of [A, B, F]) await line(decided(t, "resolved", "auto"))
  await line(decided(C, "resolved", "arbitration"))
  await line(decided(D, "resolved", "arbitration"))
  await line(unresolved)
  await line({ event: "run_finished", phase: "network", run_id: LIVE, resolved: 5, unresolved: 1, written: 0, write_error: 0, awaiting_arbitration: 0, report_path: null })
  await settle()
  const afterNetwork = (await sentOf("list_runs")).length
  await page.evaluate(() => window.__svc.commitRun())
  for (const t of [A, B, F]) await line(decided(t, "written", "auto"))
  await line(decided(C, "written", "arbitration"))
  await line(decided(D, "write_error", "arbitration", { failure_reason: "file_locked" }))
  await line({ event: "run_finished", phase: "write", run_id: LIVE, resolved: 0, unresolved: 1, written: 4, write_error: 1, awaiting_arbitration: 0, report_path: "C:/Sets/tagging-report-20261012T200000Z.json" })
  await settle()
  const afterWrite = (await sentOf("list_runs")).length
  check("list_runs: none after the search phase, one after the write phase", afterNetwork === 0 && afterWrite === 1, { afterNetwork, afterWrite })
  const LIVE_WRITTEN_AT = "2026-10-12T20:00:00Z"
  await page.evaluate((id) => window.__svc.rollback(id, "f.mp3"), LIVE)
  await line({ event: "track_resolved", track_id: F.track_id, state: "rolled_back", resolution: "auto", failure_reason: null, source: null, after: null, scores: null, artwork_path: null, tags_after: null, restorable: false, source_url: null })
  await line({ event: "rollback_finished", run_id: LIVE, track_id: "f.mp3", restored: ["f.mp3"], failed: [] })
  await page.evaluate((id) => window.__svc.rollback(id, "a.mp3"), LIVE)
  await line({ event: "rollback_finished", run_id: LIVE, track_id: "a.mp3", restored: [], failed: [{ track_id: "a.mp3", file_name: "Adam Beyer - Your Mind (Original Mix).mp3", reason: "name_taken" }] })
  await settle()

  // Le run vivant porte tout ce qu'un run passe ne doit pas montrer : on le prouve d'abord.
  await page.locator('[data-action="recap"]').click()
  await page.waitForSelector("app-recap-page app-run-list")
  await settle()
  await toggleOf("Your Mind").click()
  await settle()
  const liveRo = await readOnly()
  const liveCounts = await counts()
  out.measures.live = { liveRo, liveCounts }
  check("live run: the probe sees the per-track restore, failure message and restore summary; restore-run and new-run are gone from the recap", liveRo.restoreRun === 0 && liveRo.newRun === 0 && liveRo.restoreTrack === 1 && liveRo.writeFailures === 1 && liveRo.rollbackFailuresText > 0, liveRo)
  const liveBlock = await block()
  // Pied du run vivant, comme celui d'un run passe : retour a gauche, contexte a droite une fois la cible connue,
  // 8px sous la table, rien d'autre.
  const liveFoot = async (ctxAfterTarget) => {
    const extra = await page.evaluate(() => {
      const host = document.querySelector("app-recap-page")
      return {
        restoreRun: host.querySelectorAll('[data-action="restore-run"]').length,
        newRun: host.querySelectorAll('[data-action="new-run"]').length,
        footerButtons: [...host.querySelectorAll('[data-action="back"]')].map((b) => b.parentElement.querySelectorAll("button").length),
      }
    })
    return { ...(await block()), ...extra, ctxAfterTarget }
  }
  const liveNoTarget = await liveFoot(false)
  check("live run before the past runs list it: header holds the title only, back then the disabled send-report button in the footer 8px under the table, no context, no restore-run or new-run", liveNoTarget.h1InHead && liveNoTarget.headIsDirectChild && !liveNoTarget.backInHead && liveNoTarget.backInFooter && liveNoTarget.backCount === 1 && JSON.stringify(liveNoTarget.footerButtons) === JSON.stringify([2]) && Math.abs(liveNoTarget.backLeftDelta) <= 1 && liveNoTarget.gap === 8 && liveNoTarget.colGap === 8 && liveNoTarget.footerNextToTable && liveNoTarget.ctx === false && liveNoTarget.noContextRow && liveNoTarget.restoreRun === 0 && liveNoTarget.newRun === 0, liveNoTarget)
  // La date du run vivant vient des runs passes, relus apres l'ecriture ; une cible de restauration
  // passee a un autre run ne l'efface pas.
  const LIVE_RUN = run(LIVE, LIVE_WRITTEN_AT, "C:\\Sets")
  await listed(LIVE_RUN, R5, R2)
  await line({ event: "rollback_target", run: { run_id: R5.run_id, written_at: R5.written_at, folder: R5.folder, tracks: 3 } })
  await settle()
  const liveBlockCtx = await liveFoot(true)
  const expectedLive = await label(LIVE_WRITTEN_AT, "C:\\Sets", "fr")
  out.measures.liveFooter = { liveBlock, liveNoTarget, liveBlockCtx }
  check("live run once the past runs list it, the rollback target on another run: context at the bottom right of the footer (same line as the settings), 14px muted, centered with the back, footer still 8px under the table", liveBlockCtx.ctxText === expectedLive && liveBlockCtx.ctxInFooter === true && Math.abs(liveBlockCtx.ctxRightDelta) <= 1 && liveBlockCtx.ctxAfterBack === true && liveBlockCtx.ctxSize === "14px" && /text-muted-color/.test(liveBlockCtx.ctxClass ?? "") && liveBlockCtx.ctxColor !== liveBlockCtx.titleColor && liveBlockCtx.ctxCenterDelta <= 2 && liveBlockCtx.gap === 8 && liveBlockCtx.restoreRun === 0 && liveBlockCtx.newRun === 0, { liveBlockCtx, expectedLive })

  // Un run passe par-dessus le run vivant.
  await clearSent()
  await listed(LIVE_RUN, R5, R2)
  await navigate(`/tagging/recap/${R2.run_id}`)
  await page.waitForSelector("app-recap-page")
  await settle()
  await loaded(R2)
  await settle()
  const overlay = await readOnly()
  const overlayCounts = await counts()
  const overlayContext = (await block()).ctxText
  await toggleOf("Your Mind").click()
  await toggleOf("Sentiment").click()
  await settle()
  const overlayDetail = await readOnly()
  out.measures.overlay = { overlay, overlayCounts, overlayContext, overlayDetail }
  check("past run over a live run with restorable tracks, write failures and a restore summary: read only", overlay.anyRestore === 0 && overlay.newRun === 0 && overlay.writeFailures === 0 && overlay.rollbackFailures === 0 && overlay.words === false && overlayDetail.anyRestore === 0 && overlayDetail.words === false, { overlay, overlayDetail })
  check("past run shows its own tracks and context, not the live run's", num(overlayCounts.validated) === 3 && num(overlayCounts.all) === 6 && overlayContext === expected2, { overlayCounts, overlayContext })
  await shot("06-past-over-live")

  // Retour sur /tagging/recap sans runId : le run affiche revient, ses boutons aussi.
  await navigate("/tagging/recap")
  await page.waitForSelector("app-recap-page app-run-list")
  await settle()
  const live = await readOnly()
  const liveAgain = await counts()
  const liveAgainBlock = await block()
  const liveHeader = await page.evaluate((ctxFound) => ({ context: ctxFound, skeleton: document.querySelector("app-recap-page app-skeleton-rows") !== null, empty: document.querySelectorAll("app-recap-page app-empty-state").length }), liveAgainBlock.ctx)
  out.measures.liveAgain = { live, liveAgain, liveHeader }
  check("back on /tagging/recap: the live run returns with its own context and its messages, no restore-run or new-run", num(liveAgain.all) === 6 && num(liveAgain.validated) === 2 && num(liveAgain.arbitrated) === 1 && num(liveAgain.failed) === 2 && liveHeader.context === true && liveAgainBlock.ctxText === expectedLive && !liveHeader.skeleton && liveHeader.empty === 0 && live.restoreRun === 0 && live.newRun === 0 && live.writeFailures === 1 && live.rollbackFailuresText > 0, { liveAgain, liveHeader, live, ctxText: liveAgainBlock.ctxText })
  // Reference du run vivant au plancher : retour et contexte dans le pied, le titre du run passe est aussi haut.
  await page.setViewportSize({ width: 1024, height: 700 })
  await settle()
  const liveFr = await block()
  await setLang("en")
  const liveEn = await block()
  await setLang("fr")
  await page.setViewportSize({ width: 1280, height: 800 })
  await settle()
  out.measures.headerLive = { liveFr, liveEn }
  const liveFits = (h) => !h.backInHead && h.backInFooter && Math.abs(h.backLeftDelta) <= 1 && h.gap === 8 && !h.headOverflow && !h.pageWide && h.footerOverflow === false && h.ctx === true && Math.abs(h.ctxRightDelta) <= 1 && h.ctxCenterDelta <= 2 && h.titleHeight <= 32 && h.backHeight <= 32
  check("live run at 1024 x 700, FR and EN: back at the bottom left on one line, context at the right of the same row, nothing overflows", liveFits(liveFr) && liveFits(liveEn), { liveFr, liveEn })
  const sameTitle = (past, live) => past.titleHeight === live.titleHeight && past.headHeight <= live.headHeight
  check("past run header (short and 100-character folder) holds only the title: as high as the live run's at 1024 x 700, FR and EN", sameTitle(shortFr, liveFr) && sameTitle(longFr, liveFr) && sameTitle(shortEn, liveEn) && sameTitle(longEn, liveEn), { shortFr, longFr, liveFr, shortEn, longEn, liveEn })
  await page.locator('app-recap-page [data-action="back"]').click()
  await page.waitForSelector("app-tagging-page")
  check("back to the list from the live recap leads to /tagging", (await url()) === "/tagging", await url())
  await settle()
  const taggingBar = await page.evaluate(() => ({
    restoreRun: document.querySelectorAll('app-tagging-page [data-action="restore-run"]').length,
    newRun: document.querySelectorAll('[data-action="new-run"]').length,
    actions: [...document.querySelectorAll("app-tagging-page [data-action]")].map((b) => b.getAttribute("data-action")),
    svc: { writing: window.__svc.writing(), finished: window.__svc.writeFinished() !== null, rows: window.__svc.taggingTracks().map((r) => r.state + ":" + r.restorable) },
  }))
  check("Restaurer le run stays in the Tagging bar after the recap, no Nouveau run", taggingBar.restoreRun === 1 && taggingBar.newRun === 0, taggingBar)
  await navigate(`/tagging/recap/${R2.run_id}`)
  await page.waitForSelector("app-recap-page")
  await settle()
  await page.locator('app-recap-page [data-action="back"]').click()
  await page.waitForSelector("app-tagging-page")
  check("back to the list from a past run leads to /tagging", (await url()) === "/tagging", await url())

  // Nouvelle ecriture, Reglages ouverts : la liste est redemandee (deja prouve), et le choix survit.
  await navigate("/settings")
  await page.waitForSelector("app-settings-page")
  // Une section a la fois depuis settings/02 : la rangee des runs passes est dans Administration (quatrieme entree)
  await page.locator("app-settings-page p-menu .p-menu-item-content").nth(3).click()
  await listed(R5, R2)
  await settle()
  const settingsAgain = await selectState()
  check("settings reopened: the list is shown and a run is selected", settingsAgain.choice === R5.run_id && !settingsAgain.buttonDisabled, settingsAgain)

  out.sent = await page.evaluate(() => window.__sent.map((c) => c.command))
  out.success = out.failures.length === 0
  return out
}
