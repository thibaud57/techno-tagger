// Rollback depuis l'interface sous `ng serve`, sidecar simule sur l'instance du service, Reglages
// compris : un controle par regle de SKILL.md § Pilotage du rollback depuis l'interface.
// Lance par le MCP Playwright : `browser_run_code_unsafe` avec `filename` sur ce fichier,
// `just dev-ui` servant http://localhost:4200. Captures dans .playwright-mcp/verify-rollback/.
async (page) => {
  const DIR = ".playwright-mcp/verify-rollback/"
  const FOLDER = "C:\\Musique\\Extraction"
  const NBSP = "\u00a0"
  const out = { checks: {}, failures: [], measures: {}, errors: [] }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(`${name}: no exception`, false, String(e && e.message).slice(0, 400))
    }
  }
  const consoleLog = []
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleLog.push(`${m.type()}: ${m.text().slice(0, 300)}`)
  })
  page.on("pageerror", (e) => consoleLog.push(`pageerror: ${String(e.message).slice(0, 300)}`))

  const shot = (name) => page.screenshot({ path: `${DIR}${name}.png` })
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const settle = (ms = 500) => page.waitForTimeout(ms)
  const sent = () => page.evaluate(() => window.__sent.map((c) => ({ ...c })))
  const sentNames = () => page.evaluate(() => window.__sent.map((c) => c.command))
  const clearSent = () => page.evaluate(() => (window.__sent = []))
  const setFolder = (folder) =>
    page.evaluate((f) => ng.getComponent(document.querySelector("app-tagging-page")).folder.set(f), folder)
  const useLang = async (lang) => {
    await page.evaluate((l) => ng.getComponent(document.querySelector("app-root")).translate.use(l), lang)
    await settle(600)
  }
  const rect = (css) =>
    page.evaluate((c) => {
      const e = document.querySelector(c)
      if (!e) return null
      const r = e.getBoundingClientRect()
      const n = (x) => Math.round(x * 10) / 10
      return { l: n(r.left), t: n(r.top), r: n(r.right), b: n(r.bottom), w: n(r.width), h: n(r.height) }
    }, css)
  /** Le bouton d'action unique de la ligne du dossier (`data-action` : start, cancel, commit, retry). */
  const ACTION = "app-tagging-page .grid > button[data-action]"
  /** Etat d'un bouton `pButton` : classes de severite, icone, taille de l'icone, desactive. */
  const btn = (css) =>
    page.evaluate((c) => {
      const b = document.querySelector(c)
      if (!b) return null
      const cls = [...b.classList].filter((x) => x.startsWith("p-button-"))
      const svg = b.querySelector("svg")
      return {
        text: b.textContent.replace(/\s+/g, " ").trim(),
        action: b.getAttribute("data-action"),
        disabled: b.disabled,
        cls,
        small: cls.includes("p-button-sm"),
        primaryOutlined: cls.includes("p-button-outlined") && !cls.includes("p-button-danger") && !cls.includes("p-button-secondary"),
        primarySolid: !cls.includes("p-button-outlined") && !cls.includes("p-button-danger") && !cls.includes("p-button-secondary"),
        icon: b.querySelector("[data-p-icon]")?.getAttribute("data-p-icon") ?? null,
        iconSize: svg ? Math.round(svg.getBoundingClientRect().width) : null,
      }
    }, css)
  /** Survol reel puis lecture du `.p-tooltip` ; releve aussi les evenements souris vus par l'element. */
  const hoverTip = async (css, wait = 700) => {
    await page.mouse.move(2, 2)
    await settle(400)
    await page.evaluate((c) => {
      const b = document.querySelector(c)
      window.__ev = []
      for (const t of ["mouseenter", "mouseover", "pointerenter", "pointermove"]) b.addEventListener(t, () => window.__ev.push(t))
    }, css)
    await page.locator(css).first().hover({ timeout: 4000 })
    await settle(wait)
    const res = await page.evaluate((c) => ({
      // Tous les tooltips s'ouvrent sous l'element (TOOLTIP / WIDE_TOOLTIP), que PrimeNG retourne
      // au-dessus quand la fenetre manque de place dessous : les deux sont justes.
      below: (() => {
        const tip = document.querySelector(".p-tooltip")?.getBoundingClientRect()
        const host = document.querySelector(c).getBoundingClientRect()
        if (!tip) return null
        const flipped = tip.bottom <= host.top + 1 && innerHeight - host.bottom < tip.height + 4
        return tip.top >= host.bottom - 1 || flipped
      })(),
      tips: [...document.querySelectorAll(".p-tooltip")].map((x) => x.textContent.replace(/[  ]/g, " ").trim()),
      events: [...new Set(window.__ev)],
    }), css)
    await page.mouse.move(2, 2)
    await settle(450)
    return res
  }
  const confirmDialog = () =>
    page.evaluate(() => {
      const d = [...document.querySelectorAll(".p-confirmdialog")].find((x) => x.offsetParent !== null)
      if (!d) return null
      const buttons = [...d.querySelectorAll(".p-dialog-footer button")]
      const cls = (b) => [...b.classList].filter((c) => c.startsWith("p-button-"))
      const m = d.querySelector(".p-dialog-content p")
      return {
        header: d.querySelector(".p-dialog-title")?.textContent.trim(),
        message: m?.textContent.trim(),
        messageStyle: m && { size: getComputedStyle(m).fontSize, muted: m.classList.contains("text-muted-color"), whiteSpace: getComputedStyle(m).whiteSpace },
        icon: !!d.querySelector(".p-confirmdialog-icon"),
        buttonIcons: buttons.some((b) => !!b.querySelector("svg, i, [data-p-icon]")),
        buttons: buttons.map((b) => ({ text: b.textContent.trim(), cls: cls(b) })),
        dangers: buttons.filter((b) => b.classList.contains("p-button-danger")).map((b) => b.textContent.trim()),
        dangerInDialog: d.querySelectorAll(".p-button-danger").length,
        focused: document.activeElement?.textContent.trim() ?? null,
        width: Math.round(d.getBoundingClientRect().width),
        anim: getComputedStyle(d).animationName,
      }
    })
  const waitDialog = async () => {
    await page
      .waitForFunction(() => {
        const d = [...document.querySelectorAll(".p-confirmdialog")].find((x) => x.offsetParent !== null)
        return d && getComputedStyle(d).animationName === "none"
      }, null, { timeout: 4000 })
      .catch(() => {})
    await settle(350)
  }
  const dialogGone = async () => {
    await settle(600)
    return (await confirmDialog()) === null
  }
  const confirmButton = (text) => page.locator(".p-confirmdialog .p-dialog-footer button", { hasText: text }).first()
  const rowTrack = (text) =>
    page.evaluate((t) => {
      const r = [...document.querySelectorAll("app-run-list tbody tr")].find((x) => x.textContent.includes(t))
      if (!r) return null
      const tds = [...r.querySelectorAll("td")]
      const cell = r.querySelector("app-state-tag")
      const tag = cell?.querySelector(".p-tag")
      const td = cell?.closest("td")
      const span = cell?.closest("span.inline-flex")
      const style = td && getComputedStyle(td)
      const art = tds[1]
      return {
        label: tag?.textContent.trim(),
        severity: [...(tag?.classList ?? [])].find((c) => /^p-tag-(success|danger|info|warn|secondary)$/.test(c)) ?? null,
        icon: tag?.querySelector("[data-p-icon]")?.getAttribute("data-p-icon") ?? null,
        tagW: tag ? Math.round(tag.getBoundingClientRect().width * 10) / 10 : null,
        tagH: tag ? Math.round(tag.getBoundingClientRect().height) : null,
        wrapped: tag ? tag.getBoundingClientRect().height > 30 : null,
        tdInner: td ? Math.round((td.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) * 10) / 10 : null,
        spanW: span ? Math.round(span.getBoundingClientRect().width * 10) / 10 : null,
        spanFits: td ? span.getBoundingClientRect().width <= td.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 0.5 : null,
        info: !!r.querySelector('[data-p-icon="info-circle"]'),
        cells: tds.slice(3, 6).map((x) => x.textContent.replace(/\s+/g, " ").trim()),
        art: art && { img: !!art.querySelector("img"), skeleton: !!art.querySelector("p-skeleton"), frame: !!art.querySelector("div.border") },
      }
    }, text)
  /** Detail deplie sous la ligne : un seul ouvert a la fois dans cette sonde, null sinon. */
  const detail = () =>
    page.evaluate(() => {
      const d = document.querySelector("app-run-list tr[data-detail-carrier] app-track-detail")
      if (!d) return null
      const cells = [...d.querySelectorAll("div[data-detail-row]")].map((r) => [...r.querySelectorAll("[data-cell]")].map((x) => x.textContent.trim()))
      return {
        unreadable: d.querySelector("[data-unreadable]")?.textContent.trim() ?? null,
        rows: cells,
        hasButton: !!d.querySelector('[data-action="restore-track"]'),
        frame: Math.round(d.closest("td > div").getBoundingClientRect().height),
        scrolls: d.closest("td > div").scrollHeight > d.closest("td > div").clientHeight + 1,
      }
    })
  const closeDetail = async () => {
    for (let i = 0; i < 5; i++) {
      const open = page.locator("app-run-list tbody tr[data-shown] [data-row-toggle]").first()
      if ((await open.count()) === 0) return
      await open.click()
      await settle(300)
    }
  }
  const openDetail = async (text) => {
    const toggle = page.locator("app-run-list tbody tr", { hasText: text }).first().locator("[data-row-toggle]")
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await closeDetail()
      await toggle.click()
    }
    await page.waitForSelector("app-run-list tr[data-detail-carrier] app-track-detail")
    await settle(450)
  }
  const trackBtn = () => btn('app-run-list tr[data-detail-carrier] [data-action="restore-track"]')
  const bannerText = () =>
    page.evaluate(() => document.querySelector("[data-write-failures]")?.textContent.replace(/\s+/g, " ").trim() ?? null)
  const failuresBox = () =>
    page.evaluate(() => {
      const m = document.querySelector("app-tagging-page [data-rollback-failures], app-settings-page [data-rollback-failures]")
      if (!m) return null
      const svg = m.querySelector('[data-p-icon="times-circle"]')
      return {
        text: m.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
        error: !!m.querySelector(".p-message-error") || m.classList.contains("p-message-error"),
        whiteSpace: getComputedStyle(m.querySelector("li") ?? m).whiteSpace,
        icon: svg ? Math.round(svg.getBoundingClientRect().width) : null,
        items: [...m.querySelectorAll("li")].map((x) => x.textContent.replace(/[ \t\r\n]+/g, " ").replace(/ /g, " ").trim()),
      }
    })
  const columnGaps = () =>
    page.evaluate(() => {
      const root = document.querySelector("app-tagging-page")
      // L'hote de la liste des echecs est en `contents` : ses enfants sont ceux de la colonne.
      const flat = (el) => [...el.children].flatMap((e) => (e.tagName === "APP-ROLLBACK-FAILURES" ? flat(e) : [e]))
      const kids = flat(root).map((e) => ({
        tag: e.tagName.toLowerCase(),
        id: `${e.tagName.toLowerCase()}[${[...e.attributes].map((a) => a.name).filter((n) => n.startsWith("data-")).join(",")}] ${e.textContent.trim().slice(0, 50)}`,
        display: getComputedStyle(e).display,
        r: e.getBoundingClientRect(),
      }))
      const shown = kids.filter((k) => k.display !== "contents")
      const visible = shown.filter((k) => k.r.height > 0)
      const gaps = []
      for (let i = 1; i < visible.length; i++) gaps.push(Math.round((visible[i].r.top - visible[i - 1].r.bottom) * 10) / 10)
      return {
        zeroHeightBoxes: shown.filter((k) => k.r.height === 0).map((k) => k.id),
        gaps,
        order: visible.map((k) => k.tag),
        hostDisplay: getComputedStyle(document.querySelector("app-rollback-failures")).display,
      }
    })
  const scrolls = () =>
    page.evaluate(() => {
      const m = document.querySelector("main")
      return {
        pageV: document.scrollingElement.scrollHeight > innerHeight,
        pageH: document.scrollingElement.scrollWidth > innerWidth,
        mainV: m ? m.scrollHeight > m.clientHeight : null,
        mainH: m ? m.scrollWidth > m.clientWidth : null,
      }
    })
  const rawKeys = () =>
    page.evaluate(() =>
      (document.body.innerText.match(/\b(?:tagging|settings|rollback|confirm|app|errors|nav)\.[a-zA-Z_]+(?:\.[a-zA-Z_]+)*/g) ?? []).filter((k) => !/\.(mp3|flac|wav)$/i.test(k)),
    )
  const rawAll = []
  const scanKeys = async (where) => {
    const keys = await rawKeys()
    if (keys.length > 0) rawAll.push({ where, keys })
  }

  // Ordre et cles du sidecar (TAG_FIELDS, `shown_key`) : l'ecran les affiche tels quels, sans
  // retrier ni garder le prefixe `TXXX:` des frames personnalisees.
  const KEYS = [
    ["artist", "TPE1"], ["title", "TIT2"], ["remixer", "TPE4"], ["genre", "TCON"], ["bpm", "TBPM"],
    ["key", "TKEY"], ["label", "TPUB"], ["catalog_number", "CATALOGNUMBER"], ["isrc", "TSRC"],
    ["album", "TALB"], ["track_number", "TRCK"], ["date", "TYER"],
    ["source", "SOURCE"], ["url", "WOAS"], ["source_id", "SOURCE_ID"],
  ]
  const value = (field, key, v) => ({ field, key, value: v })
  const BEFORE = { artist: "adam beyer", title: "your mind", genre: "Techno", bpm: "130", date: "2019" }
  const AFTER = { artist: "Adam Beyer", title: "Your Mind (Original Mix)", genre: "Techno (Peak Time / Driving)", label: "Drumcode", bpm: "130", date: "2023" }
  const tagsBefore = { system: "id3", comment: null, fields: KEYS.map(([f, k]) => value(f, k, BEFORE[f] ?? null)) }
  const tagsAfter = KEYS.map(([f, k]) => value(f, k, AFTER[f] ?? null))
  const t = (i, artist, title) => ({
    track_id: `${i} ${artist.toLowerCase()} - ${title.toLowerCase()}.mp3`,
    file_name: `${i} ${artist} - ${title}.mp3`,
    artist,
    title,
    tags_before: tagsBefore,
  })
  // `restorable` vient du sidecar : vrai pour un morceau au dump du run (ecrit, ou en echec apres sauvegarde de son origine).
  const resolved = (x, state = "resolved") => ({ event: "track_resolved", track_id: x.track_id, state, resolution: "auto", failure_reason: null, source: "beatport", after: { artist: x.artist, title: `${x.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 }, artwork_path: null, tags_after: tagsAfter, restorable: state === "written" || state === "write_error" })
  const writeError = (x) => ({ ...resolved(x, "write_error"), failure_reason: "file_locked" })
  const rolledBack = (x) => ({ event: "track_resolved", track_id: x.track_id, state: "rolled_back", resolution: "auto", failure_reason: null, source: null, after: null, scores: null, artwork_path: null, tags_after: null, restorable: false })
  const unresolved = (x) => ({ event: "track_resolved", track_id: x.track_id, state: "unresolved", resolution: "none", failure_reason: "no_result", source: null, after: null, scores: null, artwork_path: null, tags_after: null, restorable: false, recoverable: true })
  const finished = (runId, phase, counts) => ({ event: "run_finished", phase, run_id: runId, resolved: 0, unresolved: 0, written: 0, write_error: 0, awaiting_arbitration: 0, ...counts })
  const rbFinished = (runId, trackId, restored, failed) => ({ event: "rollback_finished", run_id: runId, track_id: trackId, restored, failed })

  const R1 = t("01", "Adam Beyer", "Your Mind")
  const R2 = t("02", "Amelie Lens", "Basiel")
  const L = t("03", "Hector Oaks", "Sentiment")
  const L2 = t("04", "Ignez", "Ark")
  const U = t("05", "Nur Jaber", "Into the Void")

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
        const provided = Object.values(record).find((v) => typeof v === "function")
        if (provided && /SidecarService$/.test(provided.name)) window.__svc = injector.get(provided)
      }
    }
    window.__sent = []
    window.__svc._available.set(true)
    await new Promise((r) => setTimeout(r, 800))
    window.__svc.send = async (command) => window.__sent.push(command)
  })
  // Version de l'interface lue sur la page (celle que compare `versionMismatch`) : figee ici,
  // elle perimait a chaque release (0.5.0 restait apres la 0.6.0, ecran bloquant, 2026-10-12).
  const VERSION = await page.evaluate(() => {
    window.__svc.handleLine(JSON.stringify({ event: "version", version: "0.0.0-probe", api_key_configured: true }))
    return window.__svc.versionMismatch().ui
  })
  await line({ event: "version", version: VERSION, api_key_configured: true })
  await page.waitForSelector("app-tagging-page")
  await setFolder(FOLDER)
  await settle()

  // ---- 1. Run cherche, non confirme : aucune restauration offerte.
  await step("unconfirmed run", async () => {
    await page.locator('[data-action="start"]').click()
    await settle(300)
    await line({ event: "run_started", run_id: "run-1", folder: FOLDER, tracks: [R1, R2, L, L2, U] })
    for (const e of [resolved(R1), resolved(R2), resolved(L), resolved(L2), unresolved(U)]) await line(e)
    await line({ event: "progress", phase: "tagging", processed: 5, total: 5 })
    await line(finished("run-1", "network", { resolved: 4, unresolved: 1 }))
    await settle(800)
    await openDetail("Adam Beyer")
    check("2 not confirmed run: no restore button on a resolved row", !(await detail())?.hasButton, await detail())
    await openDetail("Nur Jaber")
    check("2 unresolved row: no restore button", (await detail())?.hasButton === false, await detail())
    await closeDetail()
    check("3 not confirmed run: no Restaurer le run", (await btn('[data-action="restore-run"]')) === null, await btn('[data-action="restore-run"]'))
  })

  // ---- 2. Ecriture en cours : tout est grise, rien n'est restaurable sur une ligne non ecrite.
  await step("writing", async () => {
    await page.locator('[data-action="commit"]').click()
    await waitDialog()
    await confirmButton("Écrire les tags").click()
    await settle(500)
    await line({ event: "progress", phase: "write", processed: 1, total: 4 })
    await line(resolved(R1, "written"))
    await settle(400)
    check("3 writing: no Restaurer le run", (await btn('[data-action="restore-run"]')) === null, await btn('[data-action="restore-run"]'))
    await openDetail("Adam Beyer")
    const written = await trackBtn()
    check("2 writing: written row button present but disabled", written?.disabled === true, written)
    const tip = await hoverTip('app-run-list tr[data-detail-carrier] [data-action="restore-track"]')
    out.measures.tipDisabledTrackWriting = tip
    check("2 writing: hover on the disabled track button shows the reason tooltip", tip.tips.includes("Une écriture ou une restauration est en cours."), tip)
    await openDetail("Amelie Lens")
    check("2 writing: a resolved-not-yet-written row has no button", (await detail())?.hasButton === false, await detail())
    await closeDetail()
    const commitTip = await hoverTip('[data-action="commit"]')
    out.measures.tipDisabledCommitWriting = commitTip
    check("2 writing: hover on the disabled commit button shows tagging.blocked.writing, under the button", commitTip.tips.includes("Attendez la fin de l'écriture en cours.") && commitTip.below === true, commitTip)
    check("2 writing: hover on the disabled track button opens the tooltip under it", tip.below === true, tip)
    await shot("1-writing")
  })

  // ---- 3. Ecriture finie : bouton du run, etats, message d'echec.
  await step("written", async () => {
    await line(resolved(R2, "written"))
    await line(writeError(L))
    await line({ event: "progress", phase: "write", processed: 3, total: 4 })
    await line(writeError(L2))
    await line({ event: "progress", phase: "write", processed: 4, total: 4 })
    await line(finished("run-1", "write", { written: 2, write_error: 2, unresolved: 1 }))
    await settle(900)
    const fail = await rowTrack("Hector Oaks")
    out.measures.writeErrorFr = fail
    check("7 two write_error rows: banner counts 2", /écriture\s*:\s*2(\s|$)/.test((await bannerText()) ?? ""), await bannerText())
    check("7 banner is text only: no button inside", (await page.locator("[data-write-failures] button").count()) === 0, await bannerText())
    const retry = await btn('app-tagging-page .grid > button[data-action="retry"]')
    check("7 retry is the action button: Relancer l'écriture, primary solid small, refresh, enabled", retry?.text === "Relancer l'écriture" && retry.primarySolid && retry.small && retry.icon === "refresh" && !retry.disabled, retry)

    const run = await btn('[data-action="restore-run"]')
    out.measures.runButton = run
    check("3 finished with written rows: button shown, Restaurer le run, outlined primary small, refresh 16px", run?.text === "Restaurer le run" && run.primaryOutlined && run.small && run.icon === "refresh" && run.iconSize === 16 && !run.disabled, run)
    const geo = await page.evaluate(() => {
      const R = (e) => {
        if (!e) return null
        const r = e.getBoundingClientRect()
        return { l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10 }
      }
      const p = document.querySelector("app-tagging-page")
      const b = p.querySelector('[data-action="restore-run"]')
      // Rangee de la barre : le bouton vit dans le groupe qu'il partage avec « Recapitulatif » (2026-10-12).
      const row = b.closest(".items-end") ?? b.parentElement
      const bar = row.querySelector("app-phase-progress")
      return {
        row: R(row),
        btn: R(b),
        bar: R(bar),
        track: R(bar?.querySelector(".p-progressbar")),
        action: R(p.querySelector(".grid > button[data-action]")),
        grid: R(p.querySelector(".grid")),
        list: R(p.querySelector("app-run-list")),
      }
    })
    out.measures.layoutWithBar = geo
    check("3 layout with bar: button at the right end of the row", Math.abs(geo.btn.r - geo.row.r) <= 0.5, geo)
    check("3 layout with bar: button bottom aligned with the progress bar block", Math.abs(geo.btn.b - geo.bar.b) <= 1, { btnBottom: geo.btn.b, barBottom: geo.bar?.b, trackBottom: geo.track?.b })
    check("3 layout: never side by side with the run action button", geo.action.b <= geo.btn.t, { actionBottom: geo.action.b, restoreTop: geo.btn.t, actionTop: geo.action.t })
    check("3 layout: bar does not overlap the button", geo.bar.r <= geo.btn.l + 0.5, { barRight: geo.bar.r, btnLeft: geo.btn.l })
    await shot("2-written-fr")

    // Etat d'ecriture en echec, largeur de colonne, EN.
    await useLang("en")
    out.measures.writeErrorEn = await rowTrack("Hector Oaks")
    const failEn = out.measures.writeErrorEn
    check("1 en: Write failed fits, one line", failEn?.label === "Write failed" && failEn.wrapped === false && failEn.spanFits === true, failEn)
    const runEn = await btn('[data-action="restore-run"]')
    check("3 en: run button label", runEn?.text === "Restore the run", runEn)
    check("7 en: the action button reads Retry writing", (await btn('app-tagging-page .grid > button[data-action="retry"]'))?.text === "Retry writing", await btn('app-tagging-page .grid > button[data-action="retry"]'))
    await openDetail("Adam Beyer")
    const trEn = await trackBtn()
    check("2 en: track button label", trEn?.text === "Restore this track", trEn)
    await closeDetail()
    await scanKeys("tagging en written")
    await shot("3-written-en")
    // Modale du run en EN : annulee.
    await page.locator('[data-action="restore-run"]').click()
    await waitDialog()
    const dEn = await confirmDialog()
    out.measures.runModalEn = dEn
    check("4 en: header, message count 4, Cancel secondary outlined, Restore danger", dEn?.header === "Restore files" && /^Files to restore:\s*4\n\nThey get back/.test(dEn.message) && dEn.buttons[0].text === "Cancel" && dEn.buttons[1].text === "Restore" && dEn.buttons[1].cls.includes("p-button-danger"), dEn)
    await confirmButton("Cancel").click()
    check("4 en: Cancel closes and sends nothing", (await dialogGone()) && (await sent()).filter((c) => c.command === "rollback").length === 0, await sent())
    await useLang("fr")

    // Modale du run en FR : 4 fichiers (2 ecrits + 2 en echec).
    await clearSent()
    await page.locator('[data-action="restore-run"]').click()
    await waitDialog()
    const d = await confirmDialog()
    out.measures.runModalFr = d
    check("4 run modal: header Restaurer les fichiers", d?.header === "Restaurer les fichiers", d?.header)
    check("4 run modal: exact count 4 on its own line (written + write_error rows)", /restaurer\s*:\s*4\n\nIls retrouvent/.test(d?.message ?? ""), d?.message)
    check("4 run modal: artwork kept, comments not recovered, one sentence each", /pochettes posées par l'écriture restent en place\.\nLes commentaires retirés par l'écriture ne sont pas récupérés/.test(d?.message ?? ""), d?.message)
    check("4 run modal: message text-sm muted, one sentence per line", d?.messageStyle?.size === "14px" && d.messageStyle.muted && d.messageStyle.whiteSpace === "pre-line", d?.messageStyle)
    check("4 run modal: 30rem (480px) after the entry animation", d?.width === 480 && d.anim === "none", { width: d?.width, anim: d?.anim })
    check("4 run modal: Annuler secondary outlined, both small, no icon, accept Restaurer the only danger", JSON.stringify(d?.buttons.map((b) => b.text)) === JSON.stringify(["Annuler", "Restaurer"]) && d.buttons.every((b) => b.cls.includes("p-button-sm")) && d.buttons[0].cls.includes("p-button-secondary") && d.buttons[0].cls.includes("p-button-outlined") && JSON.stringify(d.dangers) === JSON.stringify(["Restaurer"]) && d.dangerInDialog === 1 && !d.icon && !d.buttonIcons, d)
    check("4 run modal: focus on Annuler", d?.focused === "Annuler", d?.focused)
    await shot("4-run-modal")
    await confirmButton("Annuler").click()
    check("4 run modal: Annuler sends nothing", (await dialogGone()) && (await sent()).length === 0, await sent())

    await page.setViewportSize({ width: 1024, height: 700 })
    await settle(600)
    out.measures.scroll1024 = await scrolls()
    const s = out.measures.scroll1024
    check("3 no scroll at 1024 x 700 with the bar and the button", !s.pageV && !s.pageH && !s.mainV && !s.mainH, s)
    const floorRun = await rect('[data-action="restore-run"]')
    check("3 1024: button inside the viewport", floorRun && floorRun.r <= 1024 && floorRun.b <= 700, floorRun)
    await shot("5-floor-1024")
    await page.setViewportSize({ width: 1280, height: 800 })
    await settle(500)
  })

  // ---- 4. Restaurer un morceau (ecrit) depuis son detail deplie.
  await step("track restore", async () => {
    await clearSent()
    await openDetail("Adam Beyer")
    const b = await trackBtn()
    out.measures.trackButton = b
    const restorableDetail = await detail()
    check("2 written row: detail frame of 7 rows, same as without the button, nothing scrolls", restorableDetail?.frame === 7 * 56 && restorableDetail.scrolls === false, restorableDetail && { frame: restorableDetail.frame, scrolls: restorableDetail.scrolls })
    // Bouton sous la pochette : meme largeur que la grande pochette (168px), 16px dessous, a gauche de la grille.
    const underArt = await page.evaluate(() => {
      const d = document.querySelector("app-run-list tr[data-detail-carrier] app-track-detail")
      const art = d.querySelector("app-artwork").getBoundingClientRect()
      const btn = d.querySelector('[data-action="restore-track"]').getBoundingClientRect()
      const grid = d.querySelector(".grid").getBoundingClientRect()
      return {
        artW: Math.round(art.width),
        btnW: Math.round(btn.width),
        leftAligned: Math.abs(btn.left - art.left) < 1,
        gap: Math.round(btn.top - art.bottom),
        leftOfGrid: btn.right <= grid.left,
        outsideGrid: d.querySelector(".grid [data-action='restore-track']") === null,
      }
    })
    check("2 written row: restore button under the artwork, same 168px width, 16px below, left of the grid", underArt.artW === 168 && underArt.btnW === 168 && underArt.leftAligned && underArt.gap === 16 && underArt.leftOfGrid && underArt.outsideGrid, underArt)
    check("2 written row: Restaurer ce morceau, outlined primary, refresh 16px, enabled", b?.text === "Restaurer ce morceau" && b.primaryOutlined && b.icon === "refresh" && b.iconSize === 16 && !b.disabled, b)
    // Ordre et cles du sidecar, source avant URL, identifiant a la source masque, cle sans `TXXX:`.
    const labelsFr = ["Artiste", "Titre", "Remixeur", "Genre", "BPM", "Key", "Label", "Numéro de catalogue", "ISRC", "Album", "Numéro de piste", "Année", "Source", "URL"]
    const keysShown = ["TPE1", "TIT2", "TPE4", "TCON", "TBPM", "TKEY", "TPUB", "CATALOGNUMBER", "TSRC", "TALB", "TRCK", "TYER", "SOURCE", "WOAS"]
    check("2 written row: 14 fields in the sidecar order, keys without the TXXX: prefix", JSON.stringify(restorableDetail?.rows.map((r) => r[0])) === JSON.stringify(labelsFr) && JSON.stringify(restorableDetail.rows.map((r) => r[1])) === JSON.stringify(keysShown), restorableDetail?.rows.map((r) => `${r[0]} ${r[1]}`))
    await page.locator('app-run-list tr[data-detail-carrier] [data-action="restore-track"]').click()
    await waitDialog()
    const d = await confirmDialog()
    out.measures.trackModalFr = d
    check("2 click on the track button opens the confirmation", d !== null && d.header === "Restaurer les fichiers", d)
    check("4 track modal: count 1", /restaurer\s*:\s*1\n\nIls retrouvent/.test(d?.message ?? ""), d?.message)
    check("4 track modal: 480px, danger only on Restaurer, focus on Annuler", d?.width === 480 && JSON.stringify(d.dangers) === JSON.stringify(["Restaurer"]) && d.focused === "Annuler", { w: d?.width, dangers: d?.dangers, focused: d?.focused })
    await shot("6-track-modal")
    await page.keyboard.press("Enter")
    check("4 track modal: Enter on the focused Annuler does not validate", (await dialogGone()) && (await sent()).length === 0, await sent())
    await page.locator('app-run-list tr[data-detail-carrier] [data-action="restore-track"]').click()
    await waitDialog()
    await confirmButton("Annuler").click()
    check("4 track modal: Annuler click sends nothing", (await dialogGone()) && (await sent()).length === 0, await sent())
    await page.locator('app-run-list tr[data-detail-carrier] [data-action="restore-track"]').click()
    await waitDialog()
    await confirmButton("Restaurer").click()
    await settle(500)
    const cmds = await sent()
    check("4 track modal: accept sends exactly one rollback with the row id", cmds.length === 1 && cmds[0].command === "rollback" && cmds[0].run_id === "run-1" && cmds[0].track_id === R1.track_id, cmds)

    // En vol : le bouton du morceau tourne, tout le reste est grise.
    const spin = await trackBtn()
    check("2 restoring track: spinner icon and disabled", spin?.icon === "spinner" && spin.disabled, spin)
    await openDetail("Hector Oaks")
    const other = await trackBtn()
    check("2 other restorable row while restoring: disabled, no spinner", other?.disabled === true && other.icon === "refresh", other)
    const tipOther = await hoverTip('app-run-list tr[data-detail-carrier] [data-action="restore-track"]')
    check("2 hover on disabled track button while restoring shows the reason", tipOther.tips.includes("Une écriture ou une restauration est en cours."), tipOther)
    await closeDetail()
    const run = await btn('[data-action="restore-run"]')
    check("3 run button while a track restores: disabled, refresh (not its own operation)", run?.disabled === true && run.icon === "refresh", run)
    const tipRun = await hoverTip('[data-action="restore-run"]')
    out.measures.tipDisabledRun = tipRun
    check("3 hover on the disabled Restaurer le run shows the reason, under the button", tipRun.tips.includes("Une écriture ou une restauration est en cours.") && tipRun.below === true, tipRun)
    await clearSent()
    await page.locator('[data-action="restore-run"]').click({ force: true, timeout: 3000 }).catch(() => {})
    await settle(500)
    check("4 busy: forced click on the disabled run button sends nothing and opens no modal", (await sent()).length === 0 && (await confirmDialog()) === null, await sent())
    // Deux echecs d'ecriture restent : le bouton d'action est la relance, pas le lancement.
    const start = await btn(ACTION)
    check("6 action button blocked while a rollback runs: Relancer l'écriture disabled", start?.disabled === true && start.action === "retry", start)
    const tipStart = await hoverTip(ACTION)
    out.measures.tipDisabledStart = tipStart
    check("6 action tooltip is tagging.blocked.restoring, under the button", tipStart.tips.includes("Attendez la fin de la restauration en cours.") && tipStart.below === true, tipStart)
    await shot("7-restoring-track")

    // Fin du morceau.
    await line(rolledBack(R1))
    await line(rbFinished("run-1", R1.track_id, [R1.file_name], []))
    await settle(700)
    const rb = await rowTrack("Adam Beyer")
    out.measures.rolledBackFr = rb
    check("1 rolled_back: p-tag-secondary, undo icon, Restauré on one line", rb?.severity === "p-tag-secondary" && rb.icon === "undo" && rb.label === "Restauré" && rb.wrapped === false && rb.tagH <= 30, rb)
    check("1 rolled_back fr: fits the State column", rb?.spanFits === true, rb)
    check("1 rolled_back: em dashes for After / Source / Score", rb?.cells.every((c) => c === "—"), rb?.cells)
    check("1 rolled_back: neutral artwork frame (no image, no skeleton)", rb?.art.frame === true && !rb.art.img && !rb.art.skeleton, rb?.art)
    const wide = out.measures.writeErrorFr
    check("1 rolled_back narrower than Échec d'écriture (fr)", rb && wide && rb.tagW < wide.tagW, { restore: rb?.tagW, failed: wide?.tagW, inner: rb?.tdInner })
    check("rollback_finished reloads the rollback target", (await sentNames()).includes("get_rollback_target"), await sentNames())
    const partial = await btn('[data-action="restore-run"]')
    check("3 partial restore: Restaurer le run still shown and enabled again", partial?.primaryOutlined && !partial.disabled, partial)
    check("7 banner still counts 2 (restored row was written)", /écriture\s*:\s*2(\s|$)/.test((await bannerText()) ?? ""), await bannerText())
    const retryBack = await btn(ACTION)
    check("7 action button is Relancer l'écriture again, enabled", retryBack?.action === "retry" && !retryBack.disabled, retryBack)
    await openDetail("Adam Beyer")
    const dr = await detail()
    out.measures.rolledBackDetail = dr
    check("2 rolled_back row: no restore button", dr?.hasButton === false, dr)
    check("2 rolled_back detail: Avant only (Apres cells em dashes)", dr?.rows.length > 0 && dr.rows.every((r) => r[3] === "—") && dr.rows.some((r) => r[2] !== "—"), dr?.rows?.slice(0, 4))
    await closeDetail()
    await shot("8-rolled-back-track")
  })

  // ---- 5. Restaurer un morceau en echec d'ecriture : sort du message.
  await step("write_error track restore", async () => {
    await clearSent()
    await openDetail("Ignez")
    const b = await trackBtn()
    check("2 write_error row: button present and enabled", b?.text === "Restaurer ce morceau" && !b.disabled && b.primaryOutlined, b)
    await page.locator('app-run-list tr[data-detail-carrier] [data-action="restore-track"]').click()
    await waitDialog()
    await confirmButton("Restaurer").click()
    await settle(500)
    const cmds = await sent()
    check("2 write_error restore sends one rollback with its id", cmds.length === 1 && cmds[0].track_id === L2.track_id, cmds)
    await line(rolledBack(L2))
    await line(rbFinished("run-1", L2.track_id, [L2.file_name], []))
    await settle(700)
    await closeDetail()
    check("7 one write_error left after one is rolled_back: banner counts 1", /écriture\s*:\s*1(\s|$)/.test((await bannerText()) ?? ""), await bannerText())
    const retry = await btn(ACTION)
    check("7 retry stays the action button, primary solid", retry?.action === "retry" && retry.primarySolid, retry)
  })

  // ---- 6. Restaurer le run : spinner, bilan avec echecs.
  await step("run restore and failures", async () => {
    await clearSent()
    await page.locator('[data-action="restore-run"]').click()
    await waitDialog()
    const d = await confirmDialog()
    check("4 run modal after partial restores: count 2 (Amelie Lens, Hector Oaks)", /restaurer\s*:\s*2\n\nIls retrouvent/.test(d?.message ?? ""), d?.message)
    await confirmButton("Restaurer").click()
    await settle(500)
    const cmds = await sent()
    check("4 run modal: accept sends exactly one rollback with track_id null", cmds.length === 1 && cmds[0].command === "rollback" && cmds[0].run_id === "run-1" && cmds[0].track_id === null, cmds)
    const run = await btn('[data-action="restore-run"]')
    check("3 run restoring: spinner icon and disabled", run?.icon === "spinner" && run.disabled, run)
    await shot("9-restoring-run")

    await line(rolledBack(R2))
    await line(rbFinished("run-1", null, [R2.file_name], [{ track_id: L.track_id, file_name: L.file_name, reason: "name_taken" }]))
    await settle(700)
    const f = await failuresBox()
    out.measures.failuresNameTaken = f
    check("5 failures list: app-message error, times-circle 20px", f?.error === true && f.icon === 20, f)
    check("5 failures list: header with NBSP before the colon and count 1", f?.text.includes(`Fichiers non restaurés${NBSP}: 1`), f?.text)
    check("5 failures list: file name and name_taken sentence", f?.items.length === 1 && f.items[0].includes(L.file_name) && f.items[0].includes("Un autre fichier porte déjà son nom d'origine"), f?.items)
    const rowL = await rowTrack("Hector Oaks")
    check("5 failed row keeps its write_error state", rowL?.label === "Échec d'écriture", rowL)
    const stay = await btn('[data-action="restore-run"]')
    check("5 failed row keeps the run button", stay?.primaryOutlined && !stay.disabled && stay.icon === "refresh", stay)
    check("7 banner still counts 1 (failed row remains write_error)", /écriture\s*:\s*1(\s|$)/.test((await bannerText()) ?? ""), await bannerText())
    check("5 failures list: one sentence per line (pre-line)", f?.whiteSpace === "pre-line", f?.whiteSpace)
    const gaps = await columnGaps()
    out.measures.gapsWithFailures = gaps
    check("5 gaps with the list shown: every gap 24px", gaps.gaps.every((g) => g === 24) && gaps.zeroHeightBoxes.length === 0, gaps)
    await shot("10-failures-name-taken")

    await line(rbFinished("run-1", null, [], [{ track_id: L.track_id, file_name: L.file_name, reason: "file_locked" }]))
    await settle(500)
    const f2 = await failuresBox()
    check("5 failures list: file_locked sentence", f2?.items.length === 1 && f2.items[0].includes("Le fichier est ouvert dans un autre programme"), f2?.items)
    check("5 failures list fr: restore wording, never the write retry (name_taken and file_locked)", /puis relancez la restauration\.$/.test(f2?.items[0] ?? "") && /puis relancez la restauration\.$/.test(f?.items[0] ?? "") && ![f, f2].some((x) => /écriture/i.test((x?.items[0] ?? "").replace(L.file_name, ""))), { nameTaken: f?.items, fileLocked: f2?.items })
    await useLang("en")
    const f2En = await failuresBox()
    out.measures.failuresFileLockedEn = f2En
    check("5 failures list en: restore wording, no write retry wording", f2En?.text.includes("Files not restored: 1") && /Close it, then restore again\.$/.test(f2En.items[0] ?? "") && !/rerun|retry the write|write again|writing/i.test((f2En.items[0] ?? "").replace(L.file_name, "")), f2En)
    await scanKeys("tagging en failures")
    await useLang("fr")

    await line(rbFinished("other-run", null, [], [{ track_id: "x.mp3", file_name: "x.mp3", reason: "name_taken" }]))
    await settle(500)
    check("5 rollback_finished of another run: nothing shown in Tagging", (await failuresBox()) === null, await failuresBox())
  })

  // ---- 7. Tout restaure : plus de message, plus de bouton, hote vide sans gap.
  await step("all rolled back", async () => {
    await line(rolledBack(L))
    await line(rbFinished("run-1", null, [L.file_name], []))
    await settle(700)
    check("7 both write_error rolled_back: banner gone", (await bannerText()) === null, await bannerText())
    check("3 every row rolled_back or unresolved: no Restaurer le run", (await btn('[data-action="restore-run"]')) === null, await btn('[data-action="restore-run"]'))
    check("7 no write_error left: the action button is back to Lancer le run", (await btn(ACTION))?.action === "start", await btn(ACTION))
    check("5 empty failures: nothing rendered", (await failuresBox()) === null, await failuresBox())
    const gaps = await columnGaps()
    out.measures.gapsEmptyHost = gaps
    check("5 empty failures host is display contents, no extra gap (every gap 24px, no zero-height box)", gaps.hostDisplay === "contents" && gaps.gaps.length > 0 && gaps.gaps.every((g) => g === 24) && gaps.zeroHeightBoxes.length === 0, gaps)
    const rbL = await rowTrack("Hector Oaks")
    check("1 rolled_back after a write_error: Restauré", rbL?.label === "Restauré" && rbL.icon === "undo", rbL)
    await useLang("en")
    const en = await rowTrack("Adam Beyer")
    out.measures.rolledBackEn = en
    check("1 rolled_back en: Restored on one line, fits the State column", en?.label === "Restored" && en.wrapped === false && en.spanFits === true, en)
    const enWide = out.measures.writeErrorEn
    check("1 rolled_back narrower than Write failed (en)", en && enWide && en.tagW < enWide.tagW, { restored: en?.tagW, failed: enWide?.tagW, inner: en?.tdInner })
    await scanKeys("tagging en all rolled back")
    await useLang("fr")
    await scanKeys("tagging fr all rolled back")
    await shot("11-all-rolled-back")
  })

  // ---- 8. Run 2 : lancement et confirmation bloques par un rollback, barre absente.
  await step("run 2", async () => {
    await clearSent()
    await page.locator('[data-action="start"]').click()
    await settle(300)
    await line({ event: "run_started", run_id: "run-2", folder: FOLDER, tracks: [R1, R2, U] })
    for (const e of [resolved(R1), resolved(R2), unresolved(U)]) await line(e)
    await line(finished("run-2", "network", { resolved: 2, unresolved: 1 }))
    await settle(700)
    check("8 run 2 ready: Confirmer l'ecriture offered", (await btn('[data-action="commit"]'))?.disabled === false, await btn('[data-action="commit"]'))
    await page.evaluate(() => window.__svc.rollback("old-run", null))
    await settle(400)
    const commit = await btn('[data-action="commit"]')
    check("6 commit disabled while a rollback runs", commit?.disabled === true, commit)
    const tip = await hoverTip('[data-action="commit"]')
    out.measures.tipDisabledCommitRollback = tip
    check("6 commit tooltip is tagging.blocked.restoring, under the button", tip.tips.includes("Attendez la fin de la restauration en cours.") && tip.below === true, tip)
    await line({ event: "error", code: "tag_dump_unreadable", params: {}, message: "", command: "rollback" })
    await settle(600)
    const err = await page.evaluate(() => document.querySelector("app-tagging-page app-error-message")?.textContent.replace(/\s+/g, " ").trim() ?? null)
    out.measures.rollbackErrorOnTagging = err
    check("12 rollback error also shows on the Tagging tab, translated (known: errorFor is global)", err !== null && !err.includes("tag_dump_unreadable") && err.includes("sauvegarde des tags d'origine"), err)
    check("6 error clears rollingBack: commit enabled again", (await btn('[data-action="commit"]'))?.disabled === false, await btn('[data-action="commit"]'))

    await page.locator('[data-action="commit"]').click()
    await waitDialog()
    await confirmButton("Écrire les tags").click()
    await settle(400)
    await line(resolved(R1, "written"))
    await line(resolved(R2, "written"))
    await line(finished("run-2", "write", { written: 2, unresolved: 1 }))
    await settle(900)
    const run = await btn('[data-action="restore-run"]')
    check("3 no write progress ever received: button still shown", run?.primaryOutlined && !run.disabled, run)
    const geo = await page.evaluate(() => {
      const R = (e) => {
        if (!e) return null
        const r = e.getBoundingClientRect()
        return { l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10 }
      }
      const p = document.querySelector("app-tagging-page")
      const b = p.querySelector('[data-action="restore-run"]')
      const row = b.closest(".items-end") ?? b.parentElement
      return { row: R(row), btn: R(b), bar: R(row.querySelector("app-phase-progress")), action: R(p.querySelector(".grid > button[data-action]")), list: R(p.querySelector("app-run-list")) }
    })
    out.measures.layoutNoBar = geo
    check("3 layout without bar: bar absent, button at the right end", geo.bar === null && Math.abs(geo.btn.r - geo.row.r) <= 0.5, geo)
    check("3 layout without bar: below the action button, above the list", geo.action.b <= geo.btn.t && geo.btn.b <= geo.list.t, geo)
    const s = await scrolls()
    check("3 no scroll without bar", !s.pageV && !s.pageH && !s.mainV && !s.mainH, s)
    await shot("12-no-bar")
  })

  // ---- 9. Reglages.
  // Depuis settings/02 : une section a la fois, choisie dans le menu (0 API, 1 Matching, 2 Interface, 3 Administration)
  const openSection = async (index) => {
    await page.locator("app-settings-page p-menu .p-menu-item-content").nth(index).click()
    await settle(400)
  }
  const gotoSettings = async () => {
    // Onglet a icone seule : son nom est son aria-label, plus aucun texte.
    await page.locator("p-tab[aria-label='Réglages'], p-tab[aria-label='Settings']").click()
    await page.waitForSelector("app-settings-page")
    await settle(700)
  }
  const rowBox = () =>
    page.evaluate(() => {
      // Rangees en `app-settings-row` : grille 10rem, libelle a gauche, controle au bout de la ligne,
      // retours dessous dans la seconde colonne. L'aide est dessous (cle API) ou dans le controle,
      // sur la ligne du bouton (Restauration).
      const rows = [...document.querySelectorAll("app-settings-page app-settings-row")]
      const mutedProbe = document.createElement("span")
      mutedProbe.className = "text-muted-color"
      document.body.append(mutedProbe)
      const mutedColor = getComputedStyle(mutedProbe).color
      mutedProbe.remove()
      const info = (r) => {
        if (!r) return null
        const label = r.querySelector("[rowLabel]")
        const control = r.querySelector("[rowControl]")
        const below = r.querySelector(":scope > div.col-start-2")
        // Classe utilitaire `hint` : son style (12px, muted, pre-line) se mesure sur l'element.
        // Sans champ (Restauration), le controle est l'aide elle-meme et le bouton est l'action de la rangee.
        const hint = (control.matches(".hint") ? control : control.querySelector(".hint")) ?? below.querySelector(".hint")
        const button = r.querySelector("[rowAction]") ?? control.querySelector("button")
        const cs = getComputedStyle(r)
        const rb = r.getBoundingClientRect()
        const cb = control.getBoundingClientRect()
        const hb = hint.getBoundingClientRect()
        const bb = button.getBoundingClientRect()
        return {
          display: cs.display,
          rowPad: `${cs.paddingTop}/${cs.paddingBottom}`,
          border: `${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`,
          // La rangee est un subgrid : la colonne des libelles se lit sur la grille parente.
          colW: Math.round(parseFloat(getComputedStyle(r.parentElement).gridTemplateColumns.split(" ")[0])),
          labelSize: getComputedStyle(label).fontSize,
          hintSize: getComputedStyle(hint).fontSize,
          hintColor: getComputedStyle(hint).color,
          hintMuted: getComputedStyle(hint).color === mutedColor,
          hintWhiteSpace: getComputedStyle(hint).whiteSpace,
          hintBelowControl: hb.top >= cb.bottom - 0.5,
          hintOnButtonLine: control.contains(hint) && hb.top < bb.bottom && hb.bottom > bb.top,
          hintLeft: Math.round(hb.left - rb.left),
          controlRightGap: Math.round((rb.right - parseFloat(cs.paddingRight) - cb.right) * 10) / 10,
          buttonRightGap: Math.round((rb.right - parseFloat(cs.paddingRight) - bb.right) * 10) / 10,
          labelText: label.textContent.trim(),
          hintText: hint.textContent.trim(),
        }
      }
      const h2s = [...document.querySelectorAll("app-settings-page h2")].map((h) => ({ text: h.textContent.trim(), size: getComputedStyle(h).fontSize, weight: getComputedStyle(h).fontWeight, top: Math.round(h.getBoundingClientRect().top) }))
      const sections = [...document.querySelectorAll("app-settings-page section")]
      return { rows: rows.map(info), h2s, order: sections.map((s) => s.querySelector("h2").textContent.trim()), rowCount: rows.length }
    })
  const targetEl = () =>
    page.evaluate(() => {
      // Sous la ligne du bouton, seulement avec un run : « Run du … sur … » (tronquee), puis son compte.
      const e = document.querySelector("app-settings-page [data-rollback-target]")
      if (!e) return null
      const inner = e.querySelector("span, div") ?? e
      const count = e.nextElementSibling
      const r = e.getBoundingClientRect()
      return {
        text: e.textContent.replace(/\s+/g, " ").trim(),
        count: count ? count.textContent.replace(/\s+/g, " ").trim() : null,
        mutedXs: getComputedStyle(e).fontSize === "12px" && e.closest(".text-muted-color") !== null,
        fontSize: getComputedStyle(e).fontSize,
        stacked: !count || r.bottom <= count.getBoundingClientRect().top + 0.5,
        underButton: r.top >= document.querySelector('app-settings-page [data-action="restore-last"]').getBoundingClientRect().bottom - 0.5,
        truncated: [e, ...e.querySelectorAll("*")].some((x) => x.scrollWidth > x.clientWidth + 1),
        w: Math.round(r.width),
        inner: inner.tagName,
      }
    })
  const settingsBtn = () => btn('app-settings-page [data-action="restore-last"]')
  const settingsError = () =>
    page.evaluate(() => {
      const e = document.querySelector('app-settings-page app-settings-row:has([data-action="restore-last"]) app-error-message')
      return e ? e.textContent.replace(/\s+/g, " ").trim() : null
    })
  // Ecart d'une erreur de la rangee Restauration a ce qui la precede (cible ou bouton) et au filet du
  // bas : attendus egaux au py-3 de la rangee (DESIGN.md § Feedback et chargement).
  const settingsErrorGaps = () =>
    page.evaluate(() => {
      const row = document.querySelector('app-settings-page app-settings-row:has([data-action="restore-last"])')
      const host = row?.querySelector(":scope > div.col-start-2 > app-error-message")
      if (!host) return null
      const r = (host.querySelector(".p-message") ?? host).getBoundingClientRect()
      const prev = host.previousElementSibling
      // Sans retour avant lui, l'ecart se mesure depuis le plus bas du controle et de l'action (le bouton).
      const above = prev ? prev.getBoundingClientRect().bottom : Math.max(...[row.querySelector("[rowControl]"), row.querySelector("[rowAction]")].filter(Boolean).map((e) => e.getBoundingClientRect().bottom))
      const bottom = row.getBoundingClientRect().bottom - parseFloat(getComputedStyle(row).borderBottomWidth)
      return { first: prev === null, above: Math.round(r.top - above), below: Math.round(bottom - r.bottom) }
    })
  const TARGET = { run_id: "a3f9c1", written_at: "2026-10-06T14:30:00Z", folder: "D:\\Music\\Promo Octobre", tracks: 87 }

  await step("settings layout", async () => {
    await clearSent()
    await gotoSettings()
    check("9 opening Settings asks for the target exactly once", (await sentNames()).filter((c) => c === "get_rollback_target").length === 1, await sentNames())
    // API (section affichee a l'ouverture) puis Administration : la rangee Restauration est la troisieme
    const apiGeo = await rowBox()
    await openSection(3)
    const admGeo = await rowBox()
    const geo = { api: apiGeo.rows[0], rollback: admGeo.rows[2], h2s: [...apiGeo.h2s, ...admGeo.h2s], order: [...apiGeo.order, ...admGeo.order], rowCount: apiGeo.rowCount + admGeo.rowCount }
    out.measures.settingsRows = geo
    check("8 section order: API then Administration", JSON.stringify(geo.order) === JSON.stringify(["API", "Administration"]), geo.order)
    const adm = geo.h2s.find((h) => h.text === "Administration")
    check("8 h2 Administration text-lg semibold", adm?.size === "18px" && adm.weight === "600", adm)
    const a = geo.api
    const r = geo.rollback
    check("8 two app-settings-row: same grid (10rem label column, py-3, bottom border), text-xs muted hint starting at the second column, control at the end of the line", r && a && r.display === "grid" && a.display === "grid" && r.rowPad === "12px/12px" && r.rowPad === a.rowPad && r.border === a.border && r.colW === 160 && a.colW === 160 && r.hintSize === "12px" && a.hintSize === "12px" && r.hintMuted && a.hintMuted && r.hintColor === a.hintColor && r.hintLeft === a.hintLeft && Math.abs(a.controlRightGap) <= 1 && Math.abs(r.buttonRightGap) <= 1, { api: a, rollback: r })
    check("8 API hint below the control, Restauration hint on the button line with the button at the end of the row", a?.hintBelowControl && r?.hintOnButtonLine && !r.hintBelowControl && Math.abs(r.buttonRightGap) <= 1, { api: a, rollback: r })
    // Deux phrases sur une ligne : exception a la rule ngx-translate, decidee le 2026-10-11 (DESIGN.md § Arbitrages).
    check("8 API row: label Clé API (14px), hint on one line under the field", a?.labelText === "Clé API" && a.labelSize === "14px" && a.hintBelowControl && !a.hintText.includes("\n") && a.hintText.startsWith("Enregistrée de façon sécurisée sur cet ordinateur. Elle ne s'affiche plus ensuite"), a)
    check("8 Restauration row: label Restauration (14px), hint text", r?.labelText === "Restauration" && r.labelSize === "14px" && r.hintWhiteSpace === "pre-line" && r.hintText === "Restaure le nom et les tags d'origine des fichiers du dernier run écrit.", r)
    const b = await settingsBtn()
    out.measures.settingsButton = b
    check("8 button: Restaurer le dernier run, outlined PRIMARY (no danger, no secondary), small, refresh 16px", b?.text === "Restaurer le dernier run" && b.primaryOutlined && b.small && b.icon === "refresh" && b.iconSize === 16, b)

    // Rangee de la cle : une cle enregistree se signale par 24 points en placeholder, sans tag d'etat
    // (remplace « Clé enregistrée » / « Aucune clé »), l'oeil n'apparaissant que pendant une saisie.
    const keyState = () =>
      page.evaluate(() => {
        const input = document.querySelector("app-settings-page #api-key")
        const save = [...document.querySelectorAll("app-settings-page button")].find((x) => x.textContent.trim() === "Enregistrer")
        return {
          placeholder: input?.placeholder ?? null,
          value: input?.value ?? null,
          tag: document.querySelector("app-settings-page p-tag, app-settings-page .p-tag") !== null,
          eye: document.querySelector("app-settings-page p-inputicon") !== null,
          saveDisabled: save?.disabled ?? null,
          saveSmall: save?.classList.contains("p-button-sm") ?? null,
        }
      })
    await openSection(0)
    const keyStored = await keyState()
    out.measures.keyStored = keyStored
    check("8 key saved: placeholder of 24 dots, empty value, no state tag, no eye, Enregistrer small and disabled", keyStored.placeholder === "•".repeat(24) && keyStored.value === "" && !keyStored.tag && !keyStored.eye && keyStored.saveDisabled === true && keyStored.saveSmall === true, keyStored)
    await page.locator("app-settings-page #api-key").fill("abc")
    await settle(200)
    const keyTyping = await keyState()
    check("8 key typing: the eye appears and Enregistrer is enabled", keyTyping.eye && keyTyping.saveDisabled === false && !keyTyping.tag, keyTyping)
    await page.locator("app-settings-page #api-key").fill("")
    await settle(200)
    check("8 key cleared: the eye is gone again", (await keyState()).eye === false, await keyState())
    await line({ event: "version", version: VERSION, api_key_configured: false })
    await settle(300)
    const keyMissing = await keyState()
    out.measures.keyMissing = keyMissing
    check("8 no key saved: the usual placeholder, still no state tag and no eye", keyMissing.placeholder === "Saisir la clé reçue" && !keyMissing.tag && !keyMissing.eye, keyMissing)
    await line({ event: "version", version: VERSION, api_key_configured: true })
    await settle(300)
    await openSection(3)
    await shot("13-settings-undefined")
    await scanKeys("settings fr")
  })

  await step("settings target states", async () => {
    // undefined : rien ne s'est repondu
    const undef = await settingsBtn()
    const el0 = await targetEl()
    check("9 undefined target: no target line", el0 === null, el0)
    check("9 undefined target: button disabled", undef?.disabled === true, undef)
    const tip0 = await hoverTip('app-settings-page [data-action="restore-last"]')
    out.measures.tipSettingsUndefined = tip0
    check("9 undefined target: tooltip Recherche du dernier run ecrit, under the button", tip0.tips.includes("Recherche du dernier run écrit…") && tip0.below === true, tip0)

    await line({ event: "rollback_target", run: null })
    await settle(500)
    const el1 = await targetEl()
    const emptyBelow = await page.evaluate(() => {
      const b = document.querySelector('app-settings-page app-settings-row:has([data-action="restore-last"]) > div.col-start-2')
      return {
        display: b ? getComputedStyle(b).display : null,
        children: b ? [...b.children].map((c) => `${c.tagName.toLowerCase()}: ${c.textContent.trim().slice(0, 80)}`) : null,
        // « Aucun run à rouvrir » est le placeholder de la rangée des runs passés (sub-project 07), pas la raison du bouton.
        pageHasNoRunText: !/Aucun run(?! à rouvrir)/.test(document.querySelector("app-settings-page").textContent),
      }
    })
    check("9 null target: no target line, no « Aucun run » text, the area under the row hidden (the reason lives in the button tooltip)", el1 === null && emptyBelow.pageHasNoRunText && emptyBelow.display === (emptyBelow.children?.length ? "flex" : "none"), { el1, emptyBelow })
    check("9 null target: button disabled", (await settingsBtn())?.disabled === true, await settingsBtn())
    const tip1 = await hoverTip('app-settings-page [data-action="restore-last"]')
    out.measures.tipSettingsNull = tip1
    check("9 null target: tooltip about the missing recent backup", tip1.tips.includes("Aucun run à restaurer : aucune sauvegarde de tags récente.") && tip1.below === true, tip1)
    await shot("14-settings-null")

    await line({ event: "rollback_target", run: TARGET })
    await settle(500)
    const el2 = await targetEl()
    out.measures.targetFr = el2
    check("9 target: run line with date and folder, then the count on its own line", /^Run du \d{1,2} \S+ 2026.*sur D:\\Music\\Promo Octobre$/.test((el2?.text ?? "").replace(/[\u00a0\u202f]/g, " ")) && el2.count?.replace(/[\u00a0\u202f]/g, " ") === "Morceaux à restaurer : 87", el2)
    check("9 target: text-xs muted under the hint and the button, one line each, button enabled", el2?.mutedXs && el2.stacked && el2.underButton && (await settingsBtn())?.disabled === false, { el2, btn: await settingsBtn() })
    await shot("15-settings-target-fr")

    // Date reformatee a la bascule de langue, libelles sans cle brute.
    await useLang("en")
    const en = await targetEl()
    out.measures.targetEn = en
    check("9 en: target line re-formatted (Oct 6, 2026 style), count and labels switch", /^Run of [A-Z][a-z]{2} \d{1,2}, 2026.* on D:\\Music\\Promo Octobre$/.test((en?.text ?? "").replace(/[\u00a0\u202f]/g, " ")) && en.count === "Tracks to restore: 87" && (await settingsBtn())?.text === "Restore the last run", en)
    check("9 date differs between FR and EN", el2?.text !== en?.text, { fr: el2?.text, en: en?.text })
    const geoEn = await rowBox()
    check("8 en: Administration, Restore, hint", geoEn.rows[2]?.labelText === "Restore" && geoEn.rows[2].hintText === "Restores the original name and tags of the files from the last written run." && geoEn.h2s.some((h) => h.text === "Administration"), geoEn.rows[2])
    await scanKeys("settings en")
    await shot("16-settings-target-en")
    await useLang("fr")

    // Cible longue : tronquee avec tooltip.
    await line({ event: "rollback_target", run: { ...TARGET, folder: "D:\\Music\\" + "Un dossier tres long ".repeat(12) + "Promo Octobre" } })
    await settle(500)
    const long = await targetEl()
    check("9 long folder: target truncated on one line", long?.truncated === true, long)
    const tipLong = await hoverTip('app-settings-page [data-rollback-target]', 800)
    out.measures.tipTargetLong = tipLong.tips.map((x) => x.slice(0, 60))
    check("9 long folder: tooltip with the full run line on hover, under it", tipLong.tips.some((x) => x.includes("Promo Octobre") && x.startsWith("Run du")) && tipLong.below === true, tipLong)
    await shot("17-settings-target-long")
    // Date illisible : la ligne garde la chaine brute, la page ne tombe pas.
    const errorsBefore = consoleLog.length
    await line({ event: "rollback_target", run: { ...TARGET, written_at: "pas une date" } })
    await settle(500)
    const bad = await targetEl()
    const alive = await page.evaluate(() => ({ settings: !!document.querySelector("app-settings-page"), apiKey: !!document.querySelector("app-settings-page #api-key"), h2: [...document.querySelectorAll("app-settings-page h2")].map((h) => h.textContent.trim()) }))
    out.measures.invalidDate = { bad, alive, newConsole: consoleLog.slice(errorsBefore) }
    check("9 invalid written_at: raw string shown in the target line, count kept, button enabled", /^Run du pas une date sur D:\\Music\\Promo Octobre$/.test((bad?.text ?? "").replace(/[\u00a0\u202f]/g, " ")) && bad.count?.replace(/[\u00a0\u202f]/g, " ") === "Morceaux à restaurer : 87" && (await settingsBtn())?.disabled === false, { bad, btn: await settingsBtn() })
    check("9 invalid written_at: Settings page still rendered (Administration section only) and no console error", alive.settings && !alive.apiKey && alive.h2.join() === "Administration" && consoleLog.slice(errorsBefore).length === 0, out.measures.invalidDate)
    await shot("17b-settings-invalid-date")
    await line({ event: "rollback_target", run: TARGET })
    await settle(300)
  })

  await step("settings blocked reasons", async () => {
    const hover = () => hoverTip('app-settings-page [data-action="restore-last"]')
    const RUN = "Attendez la fin du run en cours."
    const BUSY = "Une écriture ou une restauration est en cours."
    // run en cours
    await page.evaluate(() => window.__svc.startTagging("C:\\Musique\\Extraction"))
    await settle(300)
    const b1 = await settingsBtn()
    const t1 = await hover()
    check("10 run in progress: disabled with tagging.blocked.running", b1?.disabled && t1.tips.includes(RUN), { b1, t1 })
    // run en cours ET ecriture : le run prime
    await page.evaluate(() => window.__svc.writePhase.retrying())
    await settle(300)
    const t2 = await hover()
    check("10 priority: running beats writing", t2.tips.includes(RUN) && !t2.tips.includes(BUSY), t2)
    await page.evaluate(() => window.__svc.cancelTagging())
    await settle(300)
    const b3 = await settingsBtn()
    const t3 = await hover()
    check("10 writing: disabled with tagging.rollback.blocked, no spinner", b3?.disabled && b3.icon === "refresh" && t3.tips.includes(BUSY), { b3, t3 })
    await page.evaluate(() => window.__svc.writePhase.retryFailed())
    await settle(300)
    check("10 write over: enabled again", (await settingsBtn())?.disabled === false, await settingsBtn())
    // restauration en cours (autre que le clic)
    await page.evaluate(() => window.__svc.rollback("zz-run", null))
    await settle(300)
    const b4 = await settingsBtn()
    const t4 = await hover()
    check("10 rollingBack: disabled, spinner icon, tagging.rollback.blocked", b4?.disabled && b4.icon === "spinner" && t4.tips.includes(BUSY), { b4, t4 })
    await line({ event: "error", code: "tag_dump_unreadable", params: {}, message: "", command: "rollback" })
    await settle(500)
    check("10 rollback error clears the spinner", (await settingsBtn())?.icon === "refresh" && (await settingsBtn())?.disabled === false, await settingsBtn())
    // 12 : l'erreur du rollback sous la rangee
    const e1 = await settingsError()
    out.measures.settingsRollbackError = e1
    check("12 rollback error under the row: translated, no raw code", e1 !== null && !e1.includes("tag_dump_unreadable") && e1.includes("sauvegarde des tags d'origine"), e1)
    const g1 = await settingsErrorGaps()
    out.measures.settingsErrorGapsWithTarget = g1
    check("12 rollback error under the target: 12px above and below", g1 !== null && !g1.first && g1.above === 12 && g1.below === 12, g1)
    await line({ event: "rollback_target", run: null })
    await settle(400)
    const g0 = await settingsErrorGaps()
    out.measures.settingsErrorGapsAlone = g0
    check("12 rollback error alone under the button: 12px above and below, as under the target", g0 !== null && g0.first && g0.above === 12 && g0.below === 12, g0)
    await line({ event: "rollback_target", run: TARGET })
    await settle(400)
    await line({ event: "error", code: "tag_dump_unreadable", params: {}, message: "", command: "get_rollback_target" })
    await settle(500)
    const e2 = await settingsError()
    check("12 get_rollback_target error under the row: translated, no raw code", e2 !== null && !e2.includes("tag_dump_unreadable") && e2.includes("sauvegarde des tags d'origine"), e2)
    await shot("18-settings-error")
  })

  await step("settings modal", async () => {
    await clearSent()
    await page.locator('app-settings-page [data-action="restore-last"]').click()
    await waitDialog()
    const d = await confirmDialog()
    out.measures.settingsModal = d
    check("11 modal header Restaurer le dernier run", d?.header === "Restaurer le dernier run", d?.header)
    const msg = (d?.message ?? "").replace(/[\u00a0\u202f]/g, " ")
    check("11 modal message: run line, count on its own line, then the artwork / comments sentence", /^Run du \d{1,2} \S+ 2026.*sur D:\\Music\\Promo Octobre\nFichiers à restaurer : 87\n\nIls retrouvent/.test(msg) && /pochettes posées par l'écriture restent en place\.\nLes commentaires retirés par l'écriture ne sont pas récupérés/.test(msg), d?.message)
    check("11 modal look: 480px, text-sm muted, one sentence per line, both buttons small, Annuler secondary outlined focused, Restaurer the only danger, no icon", d?.width === 480 && d.anim === "none" && d.messageStyle.size === "14px" && d.messageStyle.muted && d.messageStyle.whiteSpace === "pre-line" && d.buttons.every((x) => x.cls.includes("p-button-sm")) && d.buttons[0].text === "Annuler" && d.buttons[0].cls.includes("p-button-secondary") && d.buttons[0].cls.includes("p-button-outlined") && JSON.stringify(d.dangers) === JSON.stringify(["Restaurer"]) && d.dangerInDialog === 1 && d.focused === "Annuler" && !d.icon && !d.buttonIcons, d)
    await shot("19-settings-modal")
    await confirmButton("Annuler").click()
    check("11 Annuler sends nothing", (await dialogGone()) && (await sent()).length === 0, await sent())
    await page.locator('app-settings-page [data-action="restore-last"]').click()
    await waitDialog()
    await confirmButton("Restaurer").click()
    await settle(500)
    const cmds = await sent()
    check("11 accept sends exactly one rollback with the target run_id and track_id null", cmds.filter((c) => c.command === "rollback").length === 1 && cmds.some((c) => c.command === "rollback" && c.run_id === "a3f9c1" && c.track_id === null), cmds)
    const b = await settingsBtn()
    check("11 in flight: spinner and disabled", b?.icon === "spinner" && b.disabled, b)
    await line(rbFinished("a3f9c1", null, [], [{ track_id: "a.mp3", file_name: "a.mp3", reason: "name_taken" }, { track_id: "b.mp3", file_name: "b.mp3", reason: "file_locked" }]))
    await settle(600)
    const f = await failuresBox()
    out.measures.settingsFailures = f
    // Message `small` dans une rangee des Reglages : icone de 16px (20px hors rangee, cf. controle 5).
    check("12 rollback_finished with failures: list under the row (error, small message, times-circle 16px, 2 files)", f?.error && f.icon === 16 &&f.text.includes(`Fichiers non restaurés${NBSP}: 2`) && f.items.length === 2, f)
    check("12 settings failures use the restore wording (no write retry)", f?.items.every((x) => /puis relancez la restauration\.$/.test(x)), f?.items)
    const under = await page.evaluate(() => {
      const btnR = document.querySelector('app-settings-page [data-action="restore-last"]').getBoundingClientRect()
      const list = document.querySelector("app-settings-page [data-rollback-failures]")?.getBoundingClientRect()
      return list ? { buttonBottom: btnR.bottom, listTop: list.top } : null
    })
    check("12 failures list is under the button row", under && under.listTop >= under.buttonBottom, under)
    await shot("20-settings-failures")
    const s = await scrolls()
    out.measures.settingsScroll = s
    await page.setViewportSize({ width: 1024, height: 700 })
    await settle(500)
    out.measures.settingsScroll1024 = await scrolls()
    const hr = await page.evaluate(() => ({ docW: document.scrollingElement.scrollWidth, innerW: innerWidth }))
    check("8 settings at 1024: no horizontal scroll", !out.measures.settingsScroll1024.pageH && !out.measures.settingsScroll1024.mainH, { scroll: out.measures.settingsScroll1024, hr })
    await shot("21-settings-1024")
    await page.setViewportSize({ width: 1280, height: 800 })
    await settle(400)
  })

  await step("tagging after settings", async () => {
    await page.locator("p-tab", { hasText: /Tagging/ }).click()
    await page.waitForSelector("app-tagging-page")
    await settle(600)
    out.measures.rollbackFailuresOnTaggingAfterSettingsRun = await failuresBox()
    check("12 failures of the Settings run (other run_id) not shown in Tagging", (await failuresBox()) === null, await failuresBox())
  })

  // ---- 10. Ouverture a froid des Reglages.
  await step("cold open of Settings", async () => {
    const consoleBefore = consoleLog.length
    await page.goto("http://localhost:4200/settings")
    await page.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
    await page.bringToFront()
    await settle(1500)
    const blockedOnLoad = await page.evaluate(() => ({ blockingCard: !!document.querySelector("app-root p-card"), settingsMounted: !!document.querySelector("app-settings-page") }))
    out.measures.coldBlockedOnLoad = blockedOnLoad
    // Le service est neuf (page rechargee) : on rejoue le lancement tel que le vit Tauri, `available` nul puis vrai.
    const result = await page.evaluate(async (version) => {
      const root = ng.getInjector(document.querySelector("app-root"))
      let svc
      for (const injector of ng["ɵgetInjectorResolutionPath"](root)) {
        let providers
        try {
          providers = ng["ɵgetInjectorProviders"](injector)
        } catch {
          continue
        }
        for (const record of Object.values(providers)) {
          const provided = Object.values(record).find((v) => typeof v === "function")
          if (provided && /SidecarService$/.test(provided.name)) svc = injector.get(provided)
        }
      }
      const sent = []
      svc.send = async (c) => sent.push(c.command)
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const snap = () => ({
        available: svc.available(),
        blockingCard: !!document.querySelector("app-root p-card"),
        settingsMounted: !!document.querySelector("app-settings-page"),
        tabs: document.querySelectorAll("p-tab").length,
        target: String(svc.rollbackTarget()),
        button: document.querySelector('app-settings-page [data-action="restore-last"]')?.disabled ?? null,
      })
      const log = { sent }
      // Etat « lancement pas encore repondu » : le shell n'affiche pas l'ecran bloquant (il ne le fait que sur `false`).
      svc._available.set(null)
      await wait(600)
      // Une section a la fois : la rangee Restauration est dans Administration (quatrieme entree du menu)
      document.querySelectorAll("app-settings-page p-menu .p-menu-item-content")[3].click()
      await wait(400)
      log.whileNull = snap()
      log.sentWhileNull = [...sent]
      svc._available.set(true)
      await wait(900)
      log.afterTrue = snap()
      log.sentAfterTrue = [...sent]
      svc.handleLine(JSON.stringify({ event: "version", version, api_key_configured: true }))
      await wait(600)
      log.afterVersion = snap()
      log.sentAfterVersion = [...sent]
      svc.handleLine(JSON.stringify({ event: "rollback_target", run: { run_id: "a3f9c1", written_at: "2026-10-06T14:30:00Z", folder: "D:\\Music\\Promo Octobre", tracks: 87 } }))
      await wait(500)
      log.withTarget = { ...snap(), text: document.querySelector("app-settings-page [data-rollback-target]")?.parentElement.textContent.replace(/\s+/g, " ").trim() ?? null }
      // Redemarrage du moteur : `restart()` repasse par `null`, la mort du process par `false` (page demontee puis remontee).
      const count = () => sent.filter((c) => c === "get_rollback_target").length
      const before = count()
      svc._available.set(null)
      await wait(500)
      log.restartNull = { sentDuringNull: count() - before }
      svc._available.set(true)
      await wait(700)
      log.restartNull.sentAfterTrue = count() - before
      const before2 = count()
      svc._available.set(false)
      await wait(500)
      log.restartFalse = { blockingCard: !!document.querySelector("app-root p-card"), sentDuringFalse: count() - before2 }
      svc._available.set(true)
      await wait(900)
      log.restartFalse.sentAfterTrue = count() - before2
      log.restartFalse.settingsMounted = !!document.querySelector("app-settings-page")
      log.total = count()
      return log
    }, VERSION)
    out.measures.coldOpen = result
    check("14 shell: no blocking screen while available is null (page is constructed then)", result.whileNull.available === null && result.whileNull.blockingCard === false && result.whileNull.settingsMounted === true, result.whileNull)
    check("14 cold open: nothing sent while the service was not available", !result.sentWhileNull.includes("get_rollback_target"), result.sentWhileNull)
    check("14 cold open: get_rollback_target sent exactly once when the service becomes available, not again on version", result.sentAfterTrue.filter((c) => c === "get_rollback_target").length === 1 && result.sentAfterVersion.filter((c) => c === "get_rollback_target").length === 1, { sentAfterTrue: result.sentAfterTrue, sentAfterVersion: result.sentAfterVersion })
    check("14 cold open: the target then shows (button enabled, line with the run)", result.withTarget.button === false && /Run du .* sur D:\\Music\\Promo Octobre\s*Morceaux à restaurer : 87/.test(result.withTarget.text ?? ""), result.withTarget)
    check("14 restart through null: nothing during null, exactly one request after true", result.restartNull.sentDuringNull === 0 && result.restartNull.sentAfterTrue === 1, result.restartNull)
    check("14 restart through false: blocking screen, nothing during false, exactly one request after true, page back", result.restartFalse.blockingCard === true && result.restartFalse.sentDuringFalse === 0 && result.restartFalse.sentAfterTrue === 1 && result.restartFalse.settingsMounted === true, result.restartFalse)
    check("14 whole cold-open sequence: three requests in total (open, restart null, restart false)", result.total === 3, result.total)
    await shot("22-cold-open")
    out.measures.consoleColdOpen = consoleLog.slice(consoleBefore)
  })

  // ---- Console et cles brutes.
  const unexpected = consoleLog.filter((m) => !m.includes("[sidecar] lancement impossible"))
  out.measures.consoleAll = consoleLog.length
  check("13 console: only the expected [sidecar] lancement impossible", unexpected.length === 0, unexpected.slice(0, 8))
  check("13 console: no NG0 warning or error", !consoleLog.some((m) => /NG0\d/.test(m)), consoleLog.filter((m) => /NG0\d/.test(m)).slice(0, 4))
  check("13 no raw i18n key on the checked screens (fr, en, modals)", rawAll.length === 0, rawAll)

  out.total = Object.keys(out.checks).length
  out.passed = out.total - out.failures.length
  return out
}
