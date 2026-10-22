// Detail avant / apres deplie sous la ligne de la liste du run, sous `ng serve`, sidecar simule sur
// l'instance du service : un controle par regle de SKILL.md § Pilotage du detail deplie, puis un
// gros run (`BULK` morceaux) balaye detail ouvert.
// Lance par le MCP Playwright : `browser_run_code_unsafe` avec `filename` sur ce fichier,
// `just dev-ui` servant http://localhost:4200. Captures dans .playwright-mcp/verify-detail/.
async (page) => {
  const DIR = ".playwright-mcp/verify-detail/"
  const BULK = 2000
  const ROW = 56
  const out = { checks: {}, failures: [], measures: {} }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const shot = (name) => page.screenshot({ path: `${DIR}${name}.png` })
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const settle = (ms = 500) => page.waitForTimeout(ms)
  const row = (text) => page.locator("app-run-list tbody tr", { hasText: text }).first()
  const toggle = (text) => row(text).locator("[data-row-toggle]")
  const dialogShown = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("app-arbitration-dialog .p-dialog")].some((d) => d.offsetParent !== null),
    )
  const closeDialog = async () => {
    if (await dialogShown()) {
      await page.locator("app-arbitration-dialog .p-dialog-header button").first().click()
      await settle(600)
    }
  }
  const openCount = () => page.evaluate(() => document.querySelectorAll("app-run-list tr[data-detail-carrier]").length)
  /** Detail deplie sous la ligne du morceau `fileName` : null quand il est replie ou demonte. */
  const detail = (fileName) =>
    page.evaluate(
      ({ fileName, ROW }) => {
        const tr = [...document.querySelectorAll("app-run-list tbody tr")].find((r) => r.textContent.includes(fileName))
        const carrier = tr?.nextElementSibling
        if (!carrier?.hasAttribute("data-detail-carrier")) return null
        const frame = carrier.querySelector("td > div")
        const d = frame.querySelector("app-track-detail")
        const box = frame.getBoundingClientRect()
        const table = document.querySelector("app-run-list table").getBoundingClientRect()
        const art = d.querySelector("app-artwork")
        const grid = d.querySelector(".grid")
        const rows = [...d.querySelectorAll("div[data-detail-row]")]
        const cells = rows.map((r) => [...r.querySelectorAll("[data-cell]")])
        const last = rows.at(-1) ?? d.querySelector("[data-unreadable]")
        const fillers = []
        let next = carrier.nextElementSibling
        while (next?.getAttribute("aria-hidden") === "true") {
          fillers.push(next)
          next = next.nextElementSibling
        }
        return {
          toggleExpanded: tr.querySelector("[data-row-toggle]").getAttribute("aria-expanded"),
          highlighted: tr.hasAttribute("data-shown"),
          gapToRow: Math.round(box.top - tr.getBoundingClientRect().bottom),
          fullWidth: Math.abs(box.left - table.left) < 1.5 && Math.abs(box.width - table.width) < 1.5,
          frame: Math.round(box.height),
          span: 1 + fillers.length,
          spanMatchesFrame: Math.round(box.height) === (1 + fillers.length) * ROW,
          scrolls: frame.scrollHeight > frame.clientHeight + 1,
          gapUnderLast: last ? Math.round(box.bottom - last.getBoundingClientRect().bottom) : null,
          nextRowTop: next ? Math.round(next.getBoundingClientRect().top - box.bottom) : null,
          rows: cells.map((c) => c.map((x) => x.textContent.trim())),
          cut: cells.flatMap((c) => c.slice(0, 2).filter((x) => x.scrollWidth > x.clientWidth).map((x) => x.textContent.trim())),
          unreadable: d.querySelector("[data-unreadable]")?.textContent.trim() ?? null,
          art: art && {
            w: Math.round(art.querySelector("img, p-skeleton, div").getBoundingClientRect().width),
            skeleton: !!art.querySelector("p-skeleton"),
            frame: !!art.querySelector("div app-icon"),
            left: grid ? art.getBoundingClientRect().right <= grid.getBoundingClientRect().left : null,
          },
          valueWidth: cells[0] ? Math.round(cells[0][3].getBoundingClientRect().width) : null,
          // gap-4 entre la pochette et la grille ; cle (« TPE1 ») dans le gris du libelle, lui-meme `text-muted-color`.
          artToGrid: art && grid ? Math.round(grid.getBoundingClientRect().left - art.querySelector("img, p-skeleton, div").getBoundingClientRect().right) : null,
          keyColor: (() => {
            if (!cells[0]) return null
            const probe = document.createElement("span")
            probe.className = "text-muted-color"
            document.body.append(probe)
            const muted = getComputedStyle(probe).color
            probe.remove()
            const label = getComputedStyle(cells[0][0]).color
            const key = getComputedStyle(cells[0][1]).color
            return { label, key, sameAsLabel: key === label, labelMuted: label === muted }
          })(),
          rowHeights: rows.map((x) => Math.round(x.getBoundingClientRect().height)),
          restoreButtons: d.querySelectorAll('[data-action="restore-track"]').length,
          source: (() => {
            const r = rows.find((x) => x.querySelector("[data-cell]")?.textContent.trim() === "Source")
            const label = r?.querySelectorAll("[data-cell]")[3]?.querySelector("app-source-label")
            const logo = label?.querySelector("app-source-logo svg, app-source-logo img")?.getBoundingClientRect()
            return label && {
              text: label.textContent.trim(),
              display: getComputedStyle(label).display,
              logoFirst: label.firstElementChild?.tagName === "APP-SOURCE-LOGO",
              logoW: logo ? Math.round(logo.width) : null,
              logoBeforeText: logo ? logo.right <= label.getBoundingClientRect().right - 8 : null,
            }
          })(),
          zIndex: getComputedStyle(frame).zIndex,
        }
      },
      { fileName, ROW },
    )
  const chevronColumn = () =>
    page.evaluate(() => {
      const th = document.querySelector("app-run-list thead th")
      const button = document.querySelector("app-run-list [data-row-toggle]")
      const td = button.closest("td")
      const tdBox = td.getBoundingClientRect()
      const b = button.getBoundingClientRect()
      const cells = [...td.parentElement.children]
      const art = cells[1].querySelector("app-artwork").getBoundingClientRect()
      const textStyle = getComputedStyle(cells[2])
      return {
        th: Math.round(th.getBoundingClientRect().width),
        button: Math.round(b.width),
        buttonHeight: Math.round(b.height),
        iconOnly: button.classList.contains("p-button-icon-only"),
        clipped: b.right > tdBox.right || b.left < tdBox.left,
        label: button.getAttribute("aria-label"),
        // Colonne de 48px (`w-12`), cellule sans marge droite : les ecarts bouton / vignette et
        // vignette / texte sont releves, pas imposes egaux.
        padRight: getComputedStyle(td).paddingRight,
        padLeft: getComputedStyle(td).paddingLeft,
        buttonToArtwork: Math.round((art.left - b.right) * 10) / 10,
        artworkToText: Math.round((cells[2].getBoundingClientRect().left + parseFloat(textStyle.paddingLeft) - art.right) * 10) / 10,
      }
    })

  const value = (field, key, v) => ({ field, key, value: v })
  // Ordre et cles du sidecar (TAG_FIELDS, `shown_key`) : l'ecran les affiche tels quels, la cle des
  // frames personnalisees sans le prefixe `TXXX:`.
  const KEYS = [
    ["artist", "TPE1"], ["title", "TIT2"], ["remixer", "TPE4"], ["genre", "TCON"], ["bpm", "TBPM"],
    ["key", "TKEY"], ["label", "TPUB"], ["catalog_number", "CATALOGNUMBER"], ["isrc", "TSRC"],
    ["album", "TALB"], ["track_number", "TRCK"], ["date", "TYER"],
    ["source", "SOURCE"], ["url", "WOAS"], ["source_id", "SOURCE_ID"],
  ]
  const BEFORE = { artist: "adam beyer", title: "your mind", genre: "Techno", bpm: "130", date: "2019" }
  const AFTER = {
    artist: "Adam Beyer, Bart Skils", remixer: "Layton Giordani", title: "Your Mind (Layton Giordani Remix)",
    album: "Your Mind (The Remixes)", date: "2023", genre: "Techno (Peak Time / Driving)",
    label: "Drumcode", catalog_number: "DC293", bpm: "130", key: "8A", isrc: "SE5Q52300123", track_number: "2",
    url: "https://www.beatport.com/track/your-mind-layton-giordani-remix/99000101", source_id: "99000101", source: "beatport",
  }
  const tagsBefore = (comment) => ({ system: "id3", comment, fields: KEYS.map(([f, k]) => value(f, k, BEFORE[f] ?? null)) })
  const tagsAfter = KEYS.map(([f, k]) => value(f, k, AFTER[f] ?? null))
  const track = (i, artist, title, before = tagsBefore(null)) => ({
    track_id: `${String(i).padStart(4, "0")} ${artist.toLowerCase()} - ${title.toLowerCase()}.mp3`,
    file_name: `${String(i).padStart(4, "0")} ${artist} - ${title}.mp3`,
    artist,
    title,
    tags_before: before,
  })
  const resolved = (t) => ({ event: "track_resolved", track_id: t.track_id, state: "resolved", resolution: "auto", failure_reason: null, source: "beatport", after: { artist: "Adam Beyer, Bart Skils", title: "Your Mind (Layton Giordani Remix)" }, scores: { artist: 98, title: 95, average: 96 }, artwork_path: null, tags_after: tagsAfter })
  const unresolved = (t) => ({ event: "track_resolved", track_id: t.track_id, state: "unresolved", resolution: "none", failure_reason: "no_result", source: null, after: null, scores: null, artwork_path: null, tags_after: null })
  const arbitration = (t) => ({ event: "arbitration_required", track_id: t.track_id, source: "beatport", beatport_unavailable: false, empty_reason: null, other_source: "bandcamp", candidates: [{ artist: t.artist, title: `${t.title} (Original Mix)`, label: "Drumcode", year: 2021, scores: { artist: 96, title: 74, average: 85 } }] })

  const R = track(1, "Adam Beyer", "Your Mind", tagsBefore("Ripped by X"))
  const U = track(2, "Nur Jaber", "Into the Void")
  const A = track(3, "Amelie Lens", "Basiel")
  const P = track(4, "Hector Oaks", "Sentiment")
  const X = track(5, "Ignez", "Ark", null)
  const fillers = Array.from({ length: 30 }, (_, i) => track(10 + i, "Filler", `Track ${i}`))

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
    await window.__svc.startTagging("C:/Musique/Extraction")
    window.__sent = []
  })

  await line({ event: "run_started", run_id: "run-1", folder: "C:/Musique/Extraction", tracks: [R, U, A, P, X, ...fillers] })
  for (const e of [resolved(R), unresolved(U), arbitration(A), unresolved(X), ...fillers.map(resolved)]) await line(e)
  await settle(800)
  await closeDialog()

  // Bouton d'ouverture, FR puis EN.
  out.measures.chevronFr = await chevronColumn()
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("en"))
  await settle()
  out.measures.chevronEn = await chevronColumn()
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("fr"))
  await settle()
  check("button fits its 48px column (fr, en), cell without right padding", !out.measures.chevronFr.clipped && !out.measures.chevronEn.clipped && out.measures.chevronFr.th === 48 && out.measures.chevronEn.th === 48 && out.measures.chevronFr.button === 28 && out.measures.chevronFr.buttonHeight === 28 && out.measures.chevronFr.iconOnly && out.measures.chevronEn.button === 28 && out.measures.chevronEn.buttonHeight === 28 && out.measures.chevronFr.padRight === "0px", [out.measures.chevronFr, out.measures.chevronEn])
  check("button label translated", out.measures.chevronFr.label === "Afficher le détail" && out.measures.chevronEn.label === "Show details", [out.measures.chevronFr.label, out.measures.chevronEn.label])
  check("button closed: aria-expanded false", (await toggle(R.file_name).getAttribute("aria-expanded")) === "false", await toggle(R.file_name).getAttribute("aria-expanded"))

  // Resolu : sous la ligne, pleine largeur, pochette a gauche, 14 champs + commentaire, 7 lignes.
  await toggle(R.file_name).click()
  await settle()
  const r = await detail(R.file_name)
  out.measures.resolved = r && { ...r, rows: undefined }
  check("detail opens right under its row, full width", r !== null && r.gapToRow === 0 && r.fullWidth, r && { gap: r.gapToRow, full: r.fullWidth })
  check("open row highlighted and expanded", r?.highlighted === true && r.toggleExpanded === "true", r && { h: r.highlighted, e: r.toggleExpanded })
  check("resolved: 14 fields plus comment, no source id", r?.rows.length === 15 && !r?.rows.some((x) => x[1] === "SOURCE_ID"), r?.rows.map((x) => x[1]))
  check("resolved: fields in the sidecar order, custom keys without the TXXX: prefix", JSON.stringify(r?.rows.map((x) => x[0])) === JSON.stringify(["Artiste", "Titre", "Remixeur", "Genre", "BPM", "Key", "Label", "Numéro de catalogue", "ISRC", "Album", "Numéro de piste", "Année", "Source", "URL", "Commentaire"]) && JSON.stringify(r.rows.map((x) => x[1])) === JSON.stringify(["TPE1", "TIT2", "TPE4", "TCON", "TBPM", "TKEY", "TPUB", "CATALOGNUMBER", "TSRC", "TALB", "TRCK", "TYER", "SOURCE", "WOAS", ""]), r?.rows.map((x) => `${x[0]} ${x[1]}`))
  check("resolved: first row, key beside the label", JSON.stringify(r?.rows[0]) === JSON.stringify(["Artiste", "TPE1", "adam beyer", "Adam Beyer, Bart Skils"]), r?.rows[0])
  check("resolved: comment row, after em dash", JSON.stringify(r?.rows.at(-1)) === JSON.stringify(["Commentaire", "", "Ripped by X", "—"]), r?.rows.at(-1))
  check("artwork 168px left of the grid", r?.art?.w === 168 && r?.art?.left === true && r?.art?.frame, r?.art)
  check("artwork 16px (gap-4) before the grid", r?.artToGrid === 16, r?.artToGrid)
  check("key in the muted grey of its label", r?.keyColor?.labelMuted === true && r.keyColor.sameAsLabel === true, r?.keyColor)
  check("not restorable: no restore button, frame still 7 rows", r?.restoreButtons === 0 && r.frame === 7 * ROW, r && { buttons: r.restoreButtons, frame: r.frame })
  check("source row: brand logo 16px then the brand name, not the raw value", r?.source?.text === "Beatport" && r.source.display === "inline-flex" && r.source.logoFirst && r.source.logoW === 16 && r.source.logoBeforeText && r.rows[12][3] === "Beatport", r?.source)
  const listSource = await page.evaluate((name) => {
    const tr = [...document.querySelectorAll("app-run-list tbody tr")].find((x) => x.textContent.includes(name))
    const label = tr.querySelector("td app-source-label")
    return label && { text: label.textContent.trim(), logo: label.querySelector("app-source-logo svg, app-source-logo img") !== null, display: getComputedStyle(label).display }
  }, R.file_name)
  check("every detail row as tall as the others, Source row included", new Set(r?.rowHeights).size === 1, r?.rowHeights)
  check("list Source column: brand logo then brand name", listSource?.text === "Beatport" && listSource.logo && listSource.display === "inline-flex", listSource)
  check("frame of 7 rows, filled to the padding, next row right under it", r?.span === 7 && r.spanMatchesFrame && !r.scrolls && r.gapUnderLast <= 17 && r.nextRowTop === 0, r && { span: r.span, frame: r.frame, scrolls: r.scrolls, gap: r.gapUnderLast, next: r.nextRowTop })
  check("no z-index on the frame", r?.zIndex === "auto", r?.zIndex)
  check("no field label cut", r?.cut.length === 0, r?.cut)
  check("values get at least 160px each", r?.valueWidth >= 160, r?.valueWidth)
  check("no command sent by the button", (await page.evaluate(() => window.__sent.length)) === 0, await page.evaluate(() => window.__sent))
  await shot("1-resolved")

  // Second detail ouvert avec le premier, puis le meme bouton le replie.
  await toggle(U.file_name).click()
  await settle()
  const u = await detail(U.file_name)
  check("second detail opens while the first stays open", (await openCount()) === 2 && (await detail(R.file_name)) !== null, await openCount())
  check("unresolved: after em dashes, neutral artwork", u?.rows.every((x) => x[3] === "—") && u?.art?.frame === true, u?.rows.map((x) => x[3]))
  await shot("2-two-open")
  await toggle(U.file_name).click()
  await settle()
  check("same button folds its detail only", (await detail(U.file_name)) === null && (await detail(R.file_name)) !== null, await openCount())
  await toggle(R.file_name).click()
  await settle()
  check("all folded", (await openCount()) === 0, await openCount())

  // Illisible : 4 lignes ; en attente : squelette, puis le detail suit la resolution.
  await toggle(X.file_name).click()
  await settle()
  const x = await detail(X.file_name)
  check("unreadable: sentence shown on 4 rows", x?.unreadable === "Les tags de ce fichier n'ont pas pu être lus." && x.span === 4 && x.spanMatchesFrame && !x.scrolls, x && { u: x.unreadable, span: x.span, frame: x.frame })
  await toggle(X.file_name).click()
  await toggle(P.file_name).click()
  await settle()
  check("pending: skeleton artwork", (await detail(P.file_name))?.art?.skeleton === true, (await detail(P.file_name))?.art)
  await line(resolved(P))
  await settle()
  check("detail follows its track when resolved", (await detail(P.file_name))?.rows[0]?.[3] === "Adam Beyer, Bart Skils", (await detail(P.file_name))?.rows[0])
  await toggle(P.file_name).click()
  await settle()

  // Arbitrage : le bouton deplie sans modale, la ligne ouvre la modale au-dessus du detail.
  await toggle(A.file_name).click()
  await settle()
  check("arbitration button: detail, no dialog", (await detail(A.file_name)) !== null && !(await dialogShown()), { detail: (await detail(A.file_name)) !== null, dialog: await dialogShown() })
  await row(A.file_name).locator("td").nth(2).click()
  await settle(800)
  out.measures.stack = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll("app-arbitration-dialog .p-dialog")].find((d) => d.offsetParent !== null)
    if (!dialog) return null
    const box = dialog.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { dialogOnTop: !!hit?.closest("app-arbitration-dialog") }
  })
  check("row click opens the dialog above the detail", out.measures.stack?.dialogOnTop === true, out.measures.stack)
  await shot("3-dialog-over-detail")
  await closeDialog()

  // Clavier : Entree et Espace sur le bouton focalise, jamais la modale.
  await toggle(A.file_name).focus()
  await page.keyboard.press("Enter")
  await settle()
  const afterEnter = { detail: (await detail(A.file_name)) !== null, dialog: await dialogShown() }
  check("Enter on the button: folds, no dialog", !afterEnter.detail && !afterEnter.dialog, afterEnter)
  await closeDialog()
  await toggle(A.file_name).focus()
  await page.keyboard.press(" ")
  await settle()
  const afterSpace = { detail: (await detail(A.file_name)) !== null, dialog: await dialogShown() }
  check("Space on the button: unfolds, no dialog", afterSpace.detail && !afterSpace.dialog, afterSpace)
  check("focus stays on the button after unfolding", await page.evaluate(() => document.activeElement?.hasAttribute("data-row-toggle") ?? false), null)
  await closeDialog()
  await toggle(A.file_name).click()
  await settle()

  // Anneau de focus du bouton au clavier.
  await toggle(R.file_name).focus()
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Tab")
  // `outline-color` passe par une transition de 200ms, ralentie avec les images hors focus :
  // attendre la couleur finale plutot qu'un delai fixe.
  await page
    .waitForFunction(() => !(getComputedStyle(document.activeElement).outlineColor === "rgba(0, 0, 0, 0)"), null, { timeout: 3000 })
    .catch(() => {})
  out.measures.focus = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement)
    return { toggle: document.activeElement.hasAttribute("data-row-toggle"), visible: document.activeElement.matches(":focus-visible"), outline: `${s.outlineStyle} ${s.outlineColor}` }
  })
  check("focus ring visible on the button", out.measures.focus.toggle && out.measures.focus.visible && !out.measures.focus.outline.endsWith("rgba(0, 0, 0, 0)"), out.measures.focus)

  // En-tete collant : le detail glisse dessous.
  await toggle(R.file_name).click()
  await settle()
  out.measures.header = await page.evaluate(async () => {
    const box = [...document.querySelectorAll("app-run-list .p-virtualscroller, app-run-list .p-datatable-table-container")].sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0]
    box.scrollTop = 120
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const th = document.querySelector("app-run-list thead th:nth-child(4)").getBoundingClientRect()
    const hit = document.elementFromPoint(th.left + th.width / 2, th.top + th.height / 2)
    const result = { headerOnTop: !!hit?.closest("thead") }
    box.scrollTop = 0
    return result
  })
  check("detail slides under the sticky header", out.measures.header.headerOnTop, out.measures.header)
  await settle()

  // Plancher 1024 x 700, detail ouvert : ni defilement de page, ni libelle coupe.
  await page.setViewportSize({ width: 1024, height: 700 })
  await settle(600)
  const floor = await detail(R.file_name)
  out.measures.floor = floor && { frame: floor.frame, cut: floor.cut, scrolls: floor.scrolls, gap: floor.gapUnderLast }
  out.measures.noPageScroll1024 = await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)
  check("no page scroll at 1024 x 700", out.measures.noPageScroll1024, false)
  check("no field label cut at 1024 (fr)", floor?.cut.length === 0 && !floor.scrolls, floor && { cut: floor.cut, scrolls: floor.scrolls })
  await shot("4-floor-1024")
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("en"))
  await settle()
  const floorEn = await detail(R.file_name)
  check("no field label cut at 1024 (en)", floorEn?.cut.length === 0 && !floorEn.scrolls, floorEn && { cut: floorEn.cut, scrolls: floorEn.scrolls })
  await shot("5-floor-1024-en")
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("fr"))
  await page.setViewportSize({ width: 1280, height: 800 })

  // Nouveau run sans le morceau deplie : le detail se replie. Puis gros run, detail ouvert.
  await page.evaluate(() => window.__svc.startTagging("C:/Musique/Grand"))
  const many = Array.from({ length: BULK }, (_, i) => track(100 + i, "Bulk Artist", `Bulk Title ${i}`))
  await page.bringToFront()
  await page.evaluate(() => {
    window.__long = []
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: "longtask" })
  })
  // Rendu force a la main (`ng.applyChanges` puis lecture de mise en page) : synchrone, la mesure
  // ne depend pas de `requestAnimationFrame`, que Playwright ralentit des que sa fenetre passe
  // a l'arriere-plan (une seconde par image, sans aucune tache longue).
  out.measures.bulk = await page.evaluate(
    async ({ started, events }) => {
      const root = ng.getComponent(document.querySelector("app-root"))
      const render = () => {
        ng.applyChanges(root)
        return document.querySelector("app-run-list table").getBoundingClientRect().height
      }
      let t = performance.now()
      window.__svc.handleLine(JSON.stringify(started))
      render()
      const firstRender = Math.round(performance.now() - t)
      const perEvent = []
      for (let i = 0; i < events.length; i++) {
        if (i % 20 !== 0) {
          window.__svc.handleLine(JSON.stringify(events[i]))
          continue
        }
        render()
        t = performance.now()
        window.__svc.handleLine(JSON.stringify(events[i]))
        render()
        perEvent.push(performance.now() - t)
      }
      perEvent.sort((a, b) => a - b)
      return {
        mountedRows: document.querySelectorAll("app-run-list tbody tr").length,
        firstRenderMs: firstRender,
        eventMedianMs: Math.round(perEvent[Math.floor(perEvent.length / 2)] * 10) / 10,
        eventP95Ms: Math.round(perEvent[Math.floor(perEvent.length * 0.95)] * 10) / 10,
        longTasks: window.__long.length,
        longestTaskMs: Math.round(Math.max(0, ...window.__long)),
      }
    },
    {
      started: { event: "run_started", run_id: "run-2", folder: "C:/Musique/Grand", tracks: many },
      events: many.map((t, i) => (i % 3 === 0 ? unresolved(t) : resolved(t))),
    },
  )
  check("detail folds when its track leaves the list", (await openCount()) === 0, await openCount())
  check(`${BULK} tracks: only visible rows mounted`, out.measures.bulk.mountedRows < 60, out.measures.bulk.mountedRows)
  check(`${BULK} tracks: first render under 500ms, events under 50ms (p95), no task over 100ms`, out.measures.bulk.firstRenderMs < 500 && out.measures.bulk.eventP95Ms < 50 && out.measures.bulk.longestTaskMs < 100, out.measures.bulk)

  // Balayage fin, detail du deuxieme morceau ouvert : aucune ligne vide decouverte, en descendant
  // puis en remontant ; un evenement sur le morceau ouvert reste rapide.
  await page.bringToFront()
  const t0 = Date.now()
  await page.locator("app-run-list [data-row-toggle]").nth(1).click()
  await page.waitForSelector("app-run-list tr[data-detail-carrier] app-track-detail")
  out.measures.bulk.openDetailMs = Date.now() - t0
  out.measures.sweep = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const box = [...document.querySelectorAll("app-run-list .p-virtualscroller, app-run-list .p-datatable-table-container")].sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0]
    const holes = () => {
      const view = box.getBoundingClientRect()
      const covers = [...document.querySelectorAll("app-run-list tr[data-detail-carrier] td > div")].map((c) => c.getBoundingClientRect())
      return [...document.querySelectorAll("app-run-list tbody tr[aria-hidden='true']")].filter((tr) => {
        const b = tr.getBoundingClientRect()
        const visible = b.bottom > view.top + 1 && b.top < view.bottom - 1
        return visible && !covers.some((c) => c.top <= b.top + 1 && c.bottom >= b.bottom - 1)
      }).length
    }
    const frames = []
    let found = 0
    const visit = async (y) => {
      const t = performance.now()
      box.scrollTop = y
      await frame()
      frames.push(performance.now() - t)
      found += holes()
    }
    for (let y = 0; y <= 1400; y += 28) await visit(y)
    for (let y = 1400; y >= 0; y -= 28) await visit(y)
    frames.sort((a, b) => a - b)
    return { steps: frames.length, medianMs: Math.round(frames[Math.floor(frames.length / 2)]), maxMs: Math.round(frames.at(-1)), holes: found }
  })
  check("open detail never uncovers a filler row while scrolling", out.measures.sweep.holes === 0, out.measures.sweep)
  await shot("6-bulk")

  return out
}
