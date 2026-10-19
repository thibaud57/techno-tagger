// Bouton « Envoyer ce rapport » du recapitulatif sous `ng serve`, sidecar simule par le transport
// (`svc.transport.send` releve, le vrai `send` garde : il efface `lastError` a chaque commande) : un
// controle par regle de SKILL.md § Pilotage du bouton « Envoyer ce rapport ». Run courant puis run
// passe. `__TAURI_INTERNALS__` pose APRES le demarrage ne releve que `plugin:opener|open_url` et
// `plugin:opener|reveal_item_in_dir` : jamais rien de reel n'est ouvert. Lance par `run_page.mjs`,
// `just dev-ui` servant http://localhost:4200 ; `SHOTS_DIR` designe le dossier des captures.
async (page) => {
  const out = { checks: {}, failures: [], measures: {} }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const shots = process.env.SHOTS_DIR ?? ".playwright-mcp/verify-feedback-send"
  const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` })
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const settle = (ms = 350) => page.waitForTimeout(ms)
  const navigate = (path) =>
    page.evaluate((p) => ng.getComponent(document.querySelector("app-root")).router.navigateByUrl(p), path)
  const setLang = async (lang) => {
    await page.evaluate((l) => ng.getComponent(document.querySelector("app-root")).translate.use(l), lang)
    await page.waitForTimeout(600)
  }
  const tr = (key, params) =>
    page.evaluate(([k, p]) => ng.getComponent(document.querySelector("app-root")).translate.instant(k, p), [key, params])
  const flat = (s) => (s ?? "").replace(/[ \t\r\n]+/g, " ").trim()
  const sentOf = (command) => page.evaluate((c) => window.__sent.filter((s) => s.command === c), command)
  const clearSent = () => page.evaluate(() => { window.__sent = [] })
  const opener = () => page.evaluate(() => window.__opener.map((o) => ({ cmd: o.cmd, args: o.args, ok: o.ok })))
  const clearOpener = () => page.evaluate(() => { window.__opener = [] })
  const consoleErrors = []
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()))
  const SEND = 'app-recap-page [data-action="send-report"]'

  // Etat du bouton : grise ou non, icone, libelle, tooltip pose, attente du service.
  const button = () =>
    page.evaluate((sel) => {
      const b = document.querySelector(sel)
      if (b === null) return null
      return {
        disabled: b.disabled,
        icon: b.querySelector("[data-p-icon]")?.getAttribute("data-p-icon") ?? null,
        text: b.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
        cursor: getComputedStyle(b).cursor,
        pending: window.__svc.feedbackPending(),
      }
    }, SEND)
  const errorBlock = () =>
    page.evaluate(() => {
      const e = document.querySelector("app-recap-page [data-feedback-error]")
      return e === null ? null : e.textContent.replace(/[ \t\r\n]+/g, " ").trim()
    })

  // Survol reel puis lecture du `.p-tooltip` : texte, mise en forme, lignes rendues et position sous le bouton.
  const hover = async (selector = SEND) => {
    await page.mouse.move(2, 2)
    await settle(500)
    const box = await page.locator(selector).boundingBox({ timeout: 3000 }).catch(() => null)
    if (box === null) {
      return { missing: true, page: await page.evaluate(() => ({ path: location.pathname, text: document.body.textContent.replace(/\s+/g, " ").trim().slice(0, 300) })) }
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await settle(900)
    return page.evaluate((css) => {
      const tip = document.querySelector(".p-tooltip")
      if (tip === null) return null
      const host = document.querySelector(css).getBoundingClientRect()
      const r = tip.getBoundingClientRect()
      const textEl = tip.querySelector(".p-tooltip-text") ?? tip
      const range = document.createRange()
      range.selectNodeContents(textEl)
      const rects = [...range.getClientRects()]
      const lines = new Set(rects.map((q) => Math.round(q.top))).size
      // Un retour a la ligne de la traduction commence-t-il bien une ligne ? (premiere lettre apres le `\n`)
      const node = [...textEl.childNodes].find((n) => n.nodeType === 3)
      const cut = node ? node.data.indexOf("\n") : -1
      let secondStartsLine = null
      if (cut >= 0) {
        const a = document.createRange()
        a.setStart(node, cut + 1)
        a.setEnd(node, cut + 2)
        const first = document.createRange()
        first.setStart(node, 0)
        first.setEnd(node, 1)
        secondStartsLine = Math.abs(a.getBoundingClientRect().left - first.getBoundingClientRect().left) <= 1.5
      }
      return {
        text: tip.textContent,
        paragraphs: node ? node.data.split("\n").length : 1,
        lines,
        secondStartsLine,
        whiteSpace: getComputedStyle(textEl).whiteSpace,
        wide: tip.classList.contains("tt-tooltip-wide"),
        width: Math.round(r.width),
        below: Math.round(r.top - host.bottom),
        side: r.top >= host.bottom - 0.5 ? "below" : r.bottom <= host.top + 0.5 ? "above" : "overlap",
        height: Math.round(r.height),
        roomBelow: Math.round(innerHeight - host.bottom),
        centerOffset: Math.round(r.left + r.width / 2 - (host.left + host.width / 2)),
        inWindow: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        pointerEvents: getComputedStyle(tip).pointerEvents,
      }
    }, selector)
  }
  const away = async () => {
    await page.mouse.move(2, 2)
    await settle(500)
  }

  // Position : sous le bouton si la place sous lui suffit a la hauteur du tooltip, sinon au-dessus (PrimeNG
  // retourne le tooltip, decision du proprietaire du 2026-10-19). L'ecart n'est jamais masque : cote choisi,
  // place sous le bouton et hauteur du tooltip sont toujours releves dans `measures.tooltipSides`.
  out.measures.tooltipSides = []
  const under = (name, tip) => {
    const measure = tip && { side: tip.side, tipHeight: tip.height, roomBelowButton: tip.roomBelow, gap: tip.below }
    const expected = tip && (tip.roomBelow >= tip.height ? "below" : "above")
    out.measures.tooltipSides.push({ name, ...measure, expected })
    check(name, tip?.side !== undefined && tip.side === expected, { ...measure, expected })
  }

  // Pied du recapitulatif : retour, bouton, contexte sur UNE ligne, bouton sans largeur figee.
  const footer = () =>
    page.evaluate(() => {
      const host = document.querySelector("app-recap-page")
      const r = (e) => e.getBoundingClientRect()
      const back = host.querySelector('[data-action="back"]')
      const send = host.querySelector('[data-action="send-report"]')
      if (send === null) return { send: null, backCount: host.querySelectorAll('[data-action="back"]').length }
      const foot = back.parentElement
      const ctx = foot.querySelector("[data-run-context]")
      const col = foot.parentElement
      const tableBox = col.firstElementChild
      const icon = send.querySelector("[data-p-icon]")
      const labelNode = [...send.childNodes].find((n) => n.nodeType === 3 && n.data.trim() !== "")
      const labelRange = document.createRange()
      labelRange.selectNodeContents(labelNode)
      const label = labelRange.getBoundingClientRect()
      const centers = [back, send, ctx].filter(Boolean).map((e) => Math.round(r(e).top + r(e).height / 2))
      const main = document.querySelector("main")
      return {
        count: host.querySelectorAll('[data-action="send-report"]').length,
        cls: send.className,
        type: send.getAttribute("type"),
        styleAttr: send.getAttribute("style"),
        fixedWidthClass: /(^|\s)(w-|min-w-|max-w-)/.test(send.className),
        label: send.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
        icon: icon?.getAttribute("data-p-icon") ?? null,
        iconSize: icon ? Math.round(r(icon).width) : null,
        iconBeforeLabel: icon ? r(icon).right <= label.left + 0.5 : null,
        iconToLabel: icon ? Math.round((label.left - r(icon).right) * 10) / 10 : null,
        labelClipped: send.scrollWidth > send.clientWidth + 1,
        labelRight: Math.round(label.right),
        buttonRight: Math.round(r(send).right),
        width: Math.round(r(send).width),
        height: Math.round(r(send).height),
        backHeight: Math.round(r(back).height),
        afterBack: Math.round((r(send).left - r(back).right) * 10) / 10,
        footerClass: foot.className,
        footerHeight: Math.round(r(foot).height),
        footerOverflow: foot.scrollWidth > foot.clientWidth + 1,
        oneRow: Math.max(...centers) - Math.min(...centers) <= 1,
        order: [back, send, ctx].filter(Boolean).every((e, i, all) => i === 0 || r(all[i - 1]).right <= r(e).left + 0.5),
        ctxRightDelta: ctx ? Math.round((r(tableBox).right - r(ctx).right) * 10) / 10 : null,
        ctxText: ctx ? ctx.textContent.replace(/[ \t\r\n]+/g, " ").trim() : null,
        ctxSize: ctx ? getComputedStyle(ctx).fontSize : null,
        sendTop: Math.round(r(send).top),
        gapToTable: Math.round(r(foot).top - r(tableBox).bottom),
        pageScroll:
          document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight ||
          main.scrollHeight > main.clientHeight + 1,
        pageWide: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth,
      }
    })

  // ---- Donnees : un run vivant ecrit (trois morceaux) et un run passe relu.
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
  const track = (id, artist, title) => ({ track_id: id, file_name: `${artist} - ${title}.mp3`, artist, title, tags_before: tagsBefore(artist, title) })
  const A = track("a.mp3", "Adam Beyer", "Your Mind")
  const B = track("b.mp3", "Amelie Lens", "Basiel")
  const linkOf = { "a.mp3": "https://www.beatport.com/track/your-mind/99000101", "b.mp3": "https://www.beatport.com/track/basiel/99000102" }
  const decided = (t, state, resolution) => ({
    event: "track_resolved", track_id: t.track_id, state, resolution, failure_reason: null, source: "beatport",
    after: { artist: t.artist, title: `${t.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 },
    artwork_path: null, tags_after: tagsAfter(t, linkOf[t.track_id]), restorable: state !== "resolved", source_url: linkOf[t.track_id],
  })
  const past = (t) => ({
    track_id: t.track_id, file_name: t.file_name, file_after: `${t.artist} - ${t.title} (Original Mix).mp3`,
    artist: t.artist, title: t.title, state: "written", resolution: "auto", failure_reason: null, source: "beatport",
    after: { artist: t.artist, title: `${t.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 },
    tags_before: t.tags_before, tags_after: tagsAfter(t, linkOf[t.track_id]), source_url: linkOf[t.track_id], artwork_path: null,
  })
  const RUN = "r4send"
  const PAST = "r2past"
  const OTHER = "r9other"
  const FOLDER = "C:\\Sets\\Aout"
  const LONG_FOLDER = "D:/Sets/Techno/Archives 2026/Resident nights/Warehouse series/Saturday closing set with the long extended edits"
  const entry = (id, writtenAt, folder) => ({ run_id: id, written_at: writtenAt, folder, report_path: `${folder}/tagging-report.json` })
  const listed = (...runs) => line({ event: "runs_listed", runs })
  const URL_OF = (id) => `https://example.com/issues/new?template=matching-report.yml&run=${id}`
  const EXPORT_OF = (id) => `C:/Users/Jane Doe/AppData/Local/Acme/feedback/20261019T100000Z-${id}.json`
  const ready = (id) => line({ event: "feedback_ready", run_id: id, url: URL_OF(id), export_path: EXPORT_OF(id) })
  const refuse = (params) =>
    line({ event: "error", code: "feedback_export_write_failed", params, message: "feedback_export_write_failed", command: "prepare_feedback" })

  // ---- Mise en place : transport simule, `__TAURI_INTERNALS__` pose apres le demarrage.
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
    // L'opener ne passe que par l'IPC de Tauri, absent sous `ng serve` : le stub releve les deux appels
    // dans l'ordre et peut refuser l'un ou l'autre (`__fail`), rien de reel ne s'ouvre.
    window.__opener = []
    window.__fail = { open_url: false, reveal_item_in_dir: false }
    window.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => {
        if (cmd === "plugin:opener|open_url" || cmd === "plugin:opener|reveal_item_in_dir") {
          const refused = window.__fail[cmd.split("|")[1]]
          window.__opener.push({ cmd, args, ok: !refused })
          return refused ? Promise.reject(new Error(`refused: ${cmd}`)) : Promise.resolve()
        }
        return Promise.reject(new Error(`no tauri: ${cmd}`))
      },
    }
  })
  const version = await page.evaluate(() => {
    window.__svc.handleLine(JSON.stringify({ event: "version", version: "0.0.0-probe", api_key_configured: true }))
    return window.__svc.versionMismatch().ui
  })
  await line({ event: "version", version, api_key_configured: true })
  await page.waitForFunction(() => document.querySelector("app-tagging-page") !== null)
  await setLang("fr")

  // Run courant ecrit, sans encore d'entree dans `runs_listed` (le rapport n'a pas ete relu).
  await page.evaluate(() => window.__svc.startTagging("C:/Sets"))
  await line({ event: "run_started", run_id: RUN, folder: FOLDER, tracks: [A, B] })
  await line(decided(A, "resolved", "auto"))
  await line(decided(B, "resolved", "auto"))
  await line({ event: "run_finished", phase: "network", run_id: RUN, resolved: 2, unresolved: 0, written: 0, write_error: 0, awaiting_arbitration: 0, report_path: null })
  await settle()
  await page.evaluate(() => window.__svc.commitRun())
  await line(decided(A, "written", "auto"))
  await line(decided(B, "written", "auto"))
  await line({ event: "run_finished", phase: "write", run_id: RUN, resolved: 0, unresolved: 0, written: 2, write_error: 0, awaiting_arbitration: 0, report_path: "C:/Sets/tagging-report-20261019T100000Z.json" })
  await navigate("/tagging/recap")
  await page.waitForSelector("app-recap-page app-run-list")
  await settle()

  // ======================================================== (b) Raison du grise
  const unavailableFr = await tr("recap.feedback.unavailable")
  const startingFr = await tr("settings.admin.starting")
  const hintFr = await tr("recap.feedback.hint")
  const noReport = await button()
  if (noReport === null) {
    // Sans bouton rien d'autre ne se mesure : un diagnostic net plutot que trente secondes de delai.
    check("(a) bouton present sur le recapitulatif", false, await page.evaluate(() => ({ path: location.pathname, text: document.querySelector("app-recap-page")?.textContent.replace(/[ \t\r\n]+/g, " ").trim().slice(0, 400) ?? null })))
    await shot("0-no-button")
    out.success = false
    return out
  }
  const noReportTip = await hover()
  await shot("1-no-report-fr")
  check("(b) run courant sans entree dans runs_listed : bouton present, grise, libelle et curseur fleche gardes", noReport !== null && noReport.disabled === true && /Envoyer ce rapport/.test(noReport.text) && noReport.cursor === "default", noReport)
  check("(b) sa raison en tooltip : recap.feedback.unavailable, une ligne, sous le bouton, jeu large", noReportTip !== null && flat(noReportTip.text) === flat(unavailableFr) && noReportTip.lines === 1 && noReportTip.wide && noReportTip.whiteSpace === "pre-line", noReportTip)
  under("(b) tooltip de la raison du rapport absent : cote selon la place", noReportTip)
  await clearSent()
  await page.locator(SEND).click({ force: true })
  await settle()
  check("(b) un clic sur le bouton grise n'envoie rien", (await sentOf("prepare_feedback")).length === 0, await sentOf("prepare_feedback"))
  await away()

  // Moteur qui demarre : sa raison prime sur celle du rapport absent.
  await page.evaluate(() => window.__svc._available.set(null))
  await settle()
  const startingTip = await hover()
  const startingState = await button()
  await shot("2-engine-starting-fr")
  check("(b) moteur pas pret (_available null) : grise, raison du moteur prioritaire sur le rapport absent", startingState?.disabled === true && startingTip !== null && flat(startingTip.text) === flat(startingFr) && flat(startingTip.text) !== flat(unavailableFr) && startingTip.wide, { startingState, startingTip })
  under("(b) tooltip du moteur qui demarre : cote selon la place", startingTip)
  out.measures.startingTip = startingTip
  await away()
  await page.evaluate(() => window.__svc._available.set(true))
  await settle()

  // ======================================================== (a) Bouton actif du run courant
  await listed(entry(RUN, "2026-10-19T10:00:00Z", FOLDER))
  await settle()
  const active = await button()
  const f = await footer()
  out.measures.footerLive1280 = f
  check("(a) run courant : bouton present dans le pied, actif, icone external-link", active !== null && active.disabled === false && active.icon === "external-link" && f.count === 1, { active, count: f.count })
  check("(a) pied : retour a gauche, puis le bouton a 16px (gap-4), puis le contexte a droite, une seule ligne", f.order && f.oneRow && f.afterBack === 16 && /gap-4/.test(f.footerClass) && /items-center/.test(f.footerClass) && f.ctxRightDelta <= 1 && /^Run du .+ sur C:\\Sets\\Aout$/.test(f.ctxText ?? "") && f.ctxSize === "14px", f)
  check("(a) bouton : pButton outlined secondary small, type button, shrink-0 whitespace-nowrap, a la hauteur du retour", /p-button-outlined/.test(f.cls) && /p-button-secondary/.test(f.cls) && /p-button-sm/.test(f.cls) && !/p-button-text/.test(f.cls) && f.type === "button" && /shrink-0/.test(f.cls) && /whitespace-nowrap/.test(f.cls) && f.height === f.backHeight, f)
  check("(a) icone 16px a gauche du libelle, libelle entier, aucune largeur figee", f.iconSize === 16 && f.iconBeforeLabel === true && f.labelClipped === false && f.styleAttr === null && f.fixedWidthClass === false && f.label === "Envoyer ce rapport", f)
  check("(a) aucun defilement de page a 1280 x 800, pied a 8px sous la table", f.pageScroll === false && f.pageWide === false && f.gapToTable === 8, f)

  // ======================================================== Tooltip actif
  const hintTip = await hover()
  await shot("3-hint-tooltip-fr")
  out.measures.hintTip1280Fr = hintTip
  check("(h) tooltip actif : recap.feedback.hint, deux phrases sur deux paragraphes (la seconde commence une ligne), pre-line, jeu large, sous le bouton centre, dans la fenetre", hintTip !== null && flat(hintTip.text) === flat(hintFr) && hintTip.paragraphs === 2 && hintTip.secondStartsLine === true && hintTip.whiteSpace === "pre-line" && hintTip.wide && Math.abs(hintTip.centerOffset) <= 1 && hintTip.inWindow && hintTip.pointerEvents === "none" && hintTip.width <= 416, hintTip)
  under("(h) tooltip du hint (1280 x 800 FR) : cote selon la place", hintTip)
  await away()
  const gone = await page.evaluate(() => document.querySelector(".p-tooltip") === null)
  check("(h) tooltip retire des la sortie", gone, null)

  // ======================================================== (c) Un clic, une commande, spinner, double clic
  await clearSent()
  await page.locator(SEND).dblclick()
  await settle()
  const sentAfterDouble = await sentOf("prepare_feedback")
  const pendingState = await button()
  const pendingTip = await hover()
  await shot("4-pending-fr")
  check("(c) un double clic envoie exactement UNE commande prepare_feedback au run affiche", sentAfterDouble.length === 1 && sentAfterDouble[0].run_id === RUN && Object.keys(sentAfterDouble[0]).sort().join() === "command,run_id", sentAfterDouble)
  check("(c) pendant l'attente : icone spinner, feedbackPending au run, bouton actif, meme tooltip", pendingState.icon === "spinner" && pendingState.pending === RUN && pendingState.disabled === false && pendingTip !== null && flat(pendingTip.text) === flat(hintFr), { pendingState, pendingTip })
  await page.locator(SEND).click()
  await settle()
  check("(c) un clic de plus pendant l'attente n'envoie rien", (await sentOf("prepare_feedback")).length === 1, await sentOf("prepare_feedback"))
  check("(c) rien ne s'ouvre avant le feedback_ready", (await opener()).length === 0, await opener())
  await away()

  // ======================================================== (e) feedback_ready d'un autre run : rien
  await ready(OTHER)
  await settle()
  const afterOther = await button()
  check("(e) feedback_ready d'un autre run : aucun appel opener, l'attente du run affiche demeure", (await opener()).length === 0 && afterOther.icon === "spinner" && afterOther.pending === RUN, { opener: await opener(), afterOther })

  // ======================================================== (d) feedback_ready du run demande
  await ready(RUN)
  await settle()
  const calls = await opener()
  const afterReady = await button()
  out.measures.openerCalls = calls
  check("(d) feedback_ready du run : open_url avec l'URL puis reveal_item_in_dir avec le chemin, dans cet ordre, une fois chacun", calls.length === 2 && calls[0].cmd === "plugin:opener|open_url" && calls[0].args.url === URL_OF(RUN) && calls[1].cmd === "plugin:opener|reveal_item_in_dir" && JSON.stringify(calls[1].args.paths) === JSON.stringify([EXPORT_OF(RUN)]), calls)
  check("(d) spinner retombe : external-link, feedbackPending nul, bouton actif", afterReady.icon === "external-link" && afterReady.pending === null && afterReady.disabled === false, afterReady)
  // Un second clic ne rejoue pas l'ancien feedback_ready : seul le nouveau ouvre.
  await clearOpener()
  await page.locator(SEND).click()
  await settle()
  check("(d) second clic : aucune ouverture tant que le nouveau feedback_ready n'est pas la, ancien non rejoue", (await opener()).length === 0 && (await sentOf("prepare_feedback")).length === 2, { opener: await opener(), sent: (await sentOf("prepare_feedback")).length })
  await ready(RUN)
  await settle()
  check("(d) le nouveau feedback_ready ouvre a nouveau, dans l'ordre", JSON.stringify((await opener()).map((c) => c.cmd)) === JSON.stringify(["plugin:opener|open_url", "plugin:opener|reveal_item_in_dir"]), await opener())

  // open_url refuse : l'Explorateur part quand meme, l'echec est en console.
  await clearOpener()
  await page.evaluate(() => { window.__fail.open_url = true })
  const errs0 = consoleErrors.length
  await page.locator(SEND).click()
  await settle()
  await ready(RUN)
  await settle()
  const refusedOpen = await opener()
  const newErrs = consoleErrors.slice(errs0)
  check("(d) open_url refuse : reveal_item_in_dir part quand meme, dans l'ordre", refusedOpen.length === 2 && refusedOpen[0].cmd === "plugin:opener|open_url" && refusedOpen[0].ok === false && refusedOpen[1].cmd === "plugin:opener|reveal_item_in_dir" && refusedOpen[1].ok === true, refusedOpen)
  check("(d) l'echec d'open_url est en console.error", newErrs.some((m) => /issue de retour non ouverte/.test(m)), newErrs)
  // Explorateur refuse : l'issue reste ouverte, l'echec est en console.
  await clearOpener()
  await page.evaluate(() => { window.__fail.open_url = false; window.__fail.reveal_item_in_dir = true })
  const errs1 = consoleErrors.length
  await page.locator(SEND).click()
  await settle()
  await ready(RUN)
  await settle()
  const refusedReveal = await opener()
  check("(d) reveal_item_in_dir refuse : open_url avait abouti, l'echec est en console.error", refusedReveal.length === 2 && refusedReveal[0].ok === true && refusedReveal[1].ok === false && consoleErrors.slice(errs1).some((m) => /export du run non revele/.test(m)), { refusedReveal, errs: consoleErrors.slice(errs1) })
  await page.evaluate(() => { window.__fail.reveal_item_in_dir = false })

  // ======================================================== (e) Quitter l'ecran, revenir
  // Le feedback_ready est deja la : revenir ne rouvre rien. Un clic, une sortie, un retour : rien non plus.
  await clearOpener()
  await navigate("/tagging")
  await page.waitForSelector("app-tagging-page")
  await settle()
  await navigate("/tagging/recap")
  await page.waitForSelector("app-recap-page app-run-list")
  await settle()
  check("(e) feedback_ready deja recu avant d'ouvrir la page : aucun appel opener a l'arrivee", (await opener()).length === 0, await opener())
  await page.locator(SEND).click()
  await settle()
  await navigate("/tagging")
  await page.waitForSelector("app-tagging-page")
  await navigate("/tagging/recap")
  await page.waitForSelector("app-recap-page app-run-list")
  await settle()
  const comeback = await button()
  check("(e) clic, sortie, retour pendant l'attente : le spinner est toujours la (le service attend)", comeback.icon === "spinner" && comeback.pending === RUN, comeback)
  await ready(RUN)
  await settle()
  const comebackAfter = await button()
  check("(e) au feedback_ready de la demande perdue : rien ne s'ouvre, le spinner retombe seul", (await opener()).length === 0 && comebackAfter.icon === "external-link" && comebackAfter.pending === null, { opener: await opener(), comebackAfter })

  // ======================================================== (f) Refus
  const errText = await tr("errors.feedback_export_write_failed")
  await clearSent()
  await page.locator(SEND).click()
  await settle()
  // Refus d'un autre run : rien, l'attente du run affiche demeure.
  await refuse({ file: "x.json", run_id: OTHER })
  await settle()
  const otherRefusal = { block: await errorBlock(), state: await button() }
  check("(f) refus portant le run_id d'un autre run : rien ne s'affiche, l'attente demeure", otherRefusal.block === null && otherRefusal.state.icon === "spinner" && otherRefusal.state.pending === RUN, otherRefusal)
  await refuse({ file: "x.json", run_id: RUN })
  await settle()
  const refusal = { block: await errorBlock(), state: await button() }
  const gaps = await page.evaluate(() => {
    const host = document.querySelector("app-recap-page")
    const kids = [...host.children].flatMap((k) => (getComputedStyle(k).display === "contents" ? [...k.children] : [k])).filter((k) => k.getBoundingClientRect().height > 0)
    const i = kids.findIndex((k) => k.matches("[data-feedback-error]"))
    const rect = (e) => e.getBoundingClientRect()
    const err = kids[i]
    return {
      index: i,
      prevIsHeader: kids[i - 1]?.querySelector("h1") !== null && kids[i - 1] !== undefined,
      above: Math.round(rect(err).top - rect(kids[i - 1]).bottom),
      below: Math.round(rect(kids[i + 1]).top - rect(err).bottom),
      iconSize: Math.round(err.querySelector("[data-p-icon]").getBoundingClientRect().width),
      severity: /p-message-error/.test(err.querySelector(".p-message, [class*='p-message']")?.className ?? err.innerHTML) ,
      lines: err.textContent.split("\n").filter((l) => l.trim() !== "").length,
    }
  })
  await shot("5-refusal-fr")
  out.measures.refusal = { refusal, gaps }
  check("(f) refus du run affiche : phrase traduite sous l'en-tete, bouton redevenu actif sans spinner", refusal.block !== null && flat(refusal.block) === flat(errText) && refusal.state.icon === "external-link" && refusal.state.pending === null && refusal.state.disabled === false, refusal)
  check("(f) refus rendu par app-error-message : apres l'en-tete, meme ecart au-dessus et en dessous (24px), icone 20px, message d'erreur", gaps.prevIsHeader && gaps.above === 24 && gaps.below === 24 && gaps.iconSize === 20 && gaps.severity, gaps)
  await refuse({ file: "x.json" })
  await settle()
  check("(f) refus sans run_id : affiche sur le recapitulatif courant", (await errorBlock()) !== null, await errorBlock())
  await refuse({ file: "x.json", run_id: OTHER })
  await settle()
  check("(f) refus d'un autre run venant ensuite : il remplace l'erreur courante et ne s'affiche pas", (await errorBlock()) === null, await errorBlock())
  // Un nouvel envoi efface l'erreur (le vrai send) et repart.
  await clearSent()
  await page.locator(SEND).click()
  await settle()
  check("(f) renvoyer apres un refus : une commande de plus, spinner", (await sentOf("prepare_feedback")).length === 1 && (await button()).icon === "spinner", await sentOf("prepare_feedback"))
  // L'attente du run courant reste posee dans le service : le run passe ouvert ensuite ne doit pas la montrer.

  // ======================================================== Run passe
  await navigate("/tagging")
  await page.waitForSelector("app-tagging-page")
  await clearSent()
  await listed(entry(RUN, "2026-10-19T10:00:00Z", FOLDER), entry(PAST, "2026-08-02T12:00:00Z", "D:/Sets/Juillet"))
  await navigate(`/tagging/recap/${PAST}`)
  await page.waitForSelector("app-recap-page")
  await settle()
  const loadingState = await button()
  const loadingTip = await hover()
  check("(a) run passe en cours de chargement : bouton present, grise avec recap.feedback.unavailable", loadingState?.disabled === true && loadingTip !== null && flat(loadingTip.text) === flat(unavailableFr), { loadingState, loadingTip })
  await away()
  await line({ event: "run_loaded", run_id: PAST, folder: "D:/Sets/Juillet", generated_at: "2026-08-02T12:00:00Z", tracks: [past(A), past(B)] })
  await page.waitForSelector("app-recap-page app-run-list tr")
  await settle()
  const pastState = await button()
  const pastFoot = await footer()
  out.measures.footerPast1280 = pastFoot
  await shot("6-past-run-fr")
  check("(a) run passe charge : bouton present dans le pied, actif, meme pied (retour, bouton, contexte)", pastState?.disabled === false && pastState.icon === "external-link" && pastFoot.count === 1 && pastFoot.order && pastFoot.oneRow && pastFoot.afterBack === 16 && /Run du .+ sur D:\/Sets\/Juillet$/.test(pastFoot.ctxText ?? ""), { pastState, pastFoot })
  check("(c) le service attend le run courant, le run passe affiche n'a pas de spinner (pending suit le run affiche)", pastState.pending === RUN && pastState.icon === "external-link" && pastState.disabled === false, pastState)
  await clearSent()
  await page.locator(SEND).click()
  await settle()
  const pastSent = await sentOf("prepare_feedback")
  check("(c) run passe : prepare_feedback part avec le run_id de la route", pastSent.length === 1 && pastSent[0].run_id === PAST, pastSent)
  // feedback_ready du run courant pendant l'attente du run passe : rien.
  await ready(RUN)
  await settle()
  check("(e) run passe : feedback_ready d'un autre run (le run courant) n'ouvre rien", (await opener()).length === 0 && (await button()).icon === "spinner", await opener())
  await refuse({ file: "x.json", run_id: RUN })
  await settle()
  check("(f) run passe : refus du run courant (autre run) non affiche", (await errorBlock()) === null, await errorBlock())
  await ready(PAST)
  await settle()
  const pastCalls = await opener()
  check("(d) run passe : feedback_ready de la route ouvre l'URL puis l'Explorateur sur son export", pastCalls.length === 2 && pastCalls[0].args.url === URL_OF(PAST) && pastCalls[0].cmd === "plugin:opener|open_url" && pastCalls[1].cmd === "plugin:opener|reveal_item_in_dir" && pastCalls[1].args.paths[0] === EXPORT_OF(PAST), pastCalls)
  await clearSent()
  await page.locator(SEND).click()
  await settle()
  await refuse({ file: "x.json", run_id: PAST })
  await settle()
  check("(f) run passe : refus de la route affiche, bouton actif", (await errorBlock()) !== null && (await button()).disabled === false && (await button()).icon === "external-link", { block: await errorBlock(), state: await button() })
  await line({ event: "feedback_ready", run_id: PAST, url: URL_OF(PAST), export_path: EXPORT_OF(PAST) })
  await clearOpener()

  // Un run passe que le registre ne liste plus : grise.
  await navigate("/tagging")
  await page.waitForSelector("app-tagging-page")
  await navigate(`/tagging/recap/${OTHER}`)
  await page.waitForSelector("app-recap-page")
  await settle()
  const unknownRun = await button()
  check("(b) run passe pas encore charge (inconnu) : grise, libelle garde", unknownRun?.disabled === true && /Envoyer ce rapport/.test(unknownRun.text), unknownRun)

  // ======================================================== (h) Mise en page, FR et EN, 1280 x 800 puis 1024 x 700
  await navigate("/tagging")
  await page.waitForSelector("app-tagging-page")
  await navigate("/tagging/recap")
  await page.waitForSelector("app-recap-page app-run-list")
  await settle()
  const views = {}
  for (const [w, h] of [[1280, 800], [1024, 700]]) {
    await page.setViewportSize({ width: w, height: h })
    for (const lang of ["fr", "en"]) {
      await setLang(lang)
      await settle()
      const wantLabel = lang === "fr" ? "Envoyer ce rapport" : "Send this report"
      const wantHint = await tr("recap.feedback.hint")
      const v = await footer()
      const tip = await hover()
      await shot(`h-${w}-${lang}-tooltip`)
      await away()
      // Contexte long : le pied reste sur une ligne, le contexte se coupe, le bouton garde son libelle entier.
      await listed(entry(RUN, "2026-10-19T10:00:00Z", LONG_FOLDER))
      await settle()
      const vLong = await footer()
      await shot(`h-${w}-${lang}-long-context`)
      await listed(entry(RUN, "2026-10-19T10:00:00Z", FOLDER))
      await settle()
      views[`${w}-${lang}`] = { v, tip, vLong }
      const tag = `${w} x ${h} ${lang.toUpperCase()}`
      check(`(h) ${tag} : libelle entier sur une ligne, pied sur une ligne, aucun debordement ni defilement`, v.label === wantLabel && v.labelClipped === false && v.oneRow && v.footerOverflow === false && v.height === v.backHeight && v.pageScroll === false && v.pageWide === false && v.afterBack === 16 && v.order, v)
      check(`(h) ${tag} : tooltip du hint sous le bouton (centre, dans la fenetre), jeu large, pre-line, deux paragraphes`, tip !== null && flat(tip.text) === flat(wantHint) && tip.paragraphs === 2 && tip.secondStartsLine === true && tip.wide && tip.whiteSpace === "pre-line" && Math.abs(tip.centerOffset) <= 1 && tip.inWindow && tip.width <= 416, tip)
      under(`(h) ${tag} : tooltip du hint, cote selon la place`, tip)
      check(`(h) ${tag} : contexte long coupe dans le pied, pied sur une ligne, bouton intact`, vLong.oneRow && vLong.footerOverflow === false && vLong.label === wantLabel && vLong.labelClipped === false && vLong.width === v.width && vLong.footerHeight === v.footerHeight && vLong.pageScroll === false, vLong)
    }
  }
  out.measures.views = Object.fromEntries(Object.entries(views).map(([k, x]) => [k, { width: x.v.width, height: x.v.height, footerHeight: x.v.footerHeight, afterBack: x.v.afterBack, iconToLabel: x.v.iconToLabel, tipWidth: x.tip?.width, tipLines: x.tip?.lines, tipBelow: x.tip?.below }]))
  await page.setViewportSize({ width: 1280, height: 800 })
  await setLang("fr")
  await settle()

  // Raison du grise en anglais.
  await page.evaluate(() => window.__svc._available.set(null))
  await setLang("en")
  await settle()
  const startingEn = await hover()
  check("(b) EN : raison du moteur en tooltip", startingEn !== null && flat(startingEn.text) === flat(await tr("settings.admin.starting")) && /starts|starting/.test(startingEn.text), startingEn)
  await away()
  await page.evaluate(() => window.__svc._available.set(true))
  await setLang("fr")

  // ======================================================== (g) Moteur perdu pendant l'attente
  await settle()
  await page.locator(SEND).click()
  await settle()
  const beforeLoss = await button()
  // `endRun()` est ce que `onTerminated` appelle a la mort du process ; `available` passe ensuite a faux :
  // l'ecran bloquant du shell prend alors toute la place, le bouton n'est plus a l'ecran.
  await page.evaluate(() => {
    window.__svc.endRun()
    window.__svc._available.set(false)
  })
  await settle()
  const lostShell = await page.evaluate(() => ({
    pending: window.__svc.feedbackPending(),
    blocked: document.querySelector("app-recap-page") === null,
    shell: document.body.textContent.replace(/\s+/g, " ").trim().slice(0, 120),
    error: window.__svc.lastError(),
  }))
  await shot("7-engine-lost-blocking-fr")
  // Le moteur se relance (`restart` repasse a `null`) : la page revient, le bouton est grise avec la raison du moteur.
  await page.evaluate(() => window.__svc._available.set(null))
  await settle()
  const lostState = await button()
  const lostTip = await hover()
  const lastError = await page.evaluate(() => window.__svc.lastError())
  await shot("7-engine-restarting-fr")
  out.measures.engineLoss = { beforeLoss, lostShell, lostState, lostTip: lostTip && flat(lostTip.text), lastError }
  check("(g) avant la perte : spinner, attente au run", beforeLoss.icon === "spinner" && beforeLoss.pending === RUN, beforeLoss)
  check("(g) moteur perdu pendant l'attente : feedbackPending retombe, l'ecran bloquant prend la place, aucune erreur du bouton", lostShell.pending === null && lostShell.blocked === true && (lostShell.error === null || lostShell.error.command !== "prepare_feedback"), lostShell)
  check("(g) moteur relance (null) : spinner retombe, bouton grise avec la raison du moteur, aucune erreur sidecar_unavailable sous l'en-tete", lostState !== null && lostState.icon === "external-link" && lostState.pending === null && lostState.disabled === true && lostTip !== null && lostTip.missing !== true && flat(lostTip.text) === flat(startingFr) && (await errorBlock()) === null && (lastError === null || lastError.command !== "prepare_feedback"), { lostState, lostTip, lastError })

  out.opener = await opener()
  out.consoleErrorsSeen = consoleErrors.filter((m) => !/issue de retour non ouverte|export du run non revele|Failed to load resource|sidecar. lancement impossible/.test(m))
  out.success = out.failures.length === 0
  return out
}
