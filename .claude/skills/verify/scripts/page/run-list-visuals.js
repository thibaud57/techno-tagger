// Liste du run sous `ng serve`, sidecar simule : largeur reelle du contenu des colonnes Source et
// Etat (FR puis EN, chaque libelle rendu dans un vrai tag ou une vraie etiquette de source), fonds
// de ligne au survol et sur la ligne depliee. `OPTION` (A, B ou C) injecte une variante de survol
// pour un arbitrage visuel ; `WIDTHS` (`source,etat` en px) remplace les largeurs des deux colonnes.
// Captures dans SHOTS_DIR si pose.
async (page) => {
  const out = { checks: {}, failures: [], measures: {} }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const shots = process.env.SHOTS_DIR
  const option = process.env.OPTION ?? null
  const widths = process.env.WIDTHS?.split(",").map(Number) ?? null
  const settle = (ms = 500) => page.waitForTimeout(ms)
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const track = (i, artist, title) => ({
    track_id: `${String(i).padStart(2, "0")} ${artist.toLowerCase()} - ${title.toLowerCase()}.mp3`,
    file_name: `${String(i).padStart(2, "0")} ${artist} - ${title}.mp3`,
    artist,
    title,
    tags_before: { system: "id3", comment: null, fields: [] },
  })
  const resolved = (t, source, resolution) => ({ event: "track_resolved", track_id: t.track_id, state: "resolved", resolution, failure_reason: null, source, after: { artist: t.artist, title: t.title }, scores: { artist: 98, title: 95, average: 96 }, artwork_path: null, tags_after: [{ field: "artist", key: "TPE1", value: t.artist }], recoverable: resolution === "url" })
  const unresolved = (t) => ({ event: "track_resolved", track_id: t.track_id, state: "unresolved", resolution: "none", failure_reason: "no_result", source: null, after: null, scores: null, artwork_path: null, tags_after: null, recoverable: true })
  const T = [
    track(1, "Amelie Lens", "Basiel"),
    track(2, "Adam Beyer", "Your Mind"),
    track(3, "Nur Jaber", "Into the Void"),
    track(4, "Klangkuenstler", "Untergang"),
    track(5, "Hector Oaks", "Sentiment"),
    track(6, "SNTS", "Unkept Promises"),
  ]

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("http://localhost:4200/tagging")
  await page.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
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
    window.__svc._available.set(true)
    await new Promise((r) => setTimeout(r, 800))
    window.__svc.send = async () => {}
    await window.__svc.startTagging("C:/Musique/Extraction")
  })
  await line({ event: "run_started", run_id: "run-1", folder: "C:/Musique/Extraction", tracks: T })
  for (const e of [resolved(T[0], "beatport", "auto"), resolved(T[1], "bandcamp", "arbitration"), resolved(T[2], "soundcloud", "url"), unresolved(T[3]), unresolved(T[4])]) await line(e)
  await line({ event: "arbitration_required", track_id: T[5].track_id, source: "beatport", beatport_unavailable: false, empty_reason: null, other_source: "bandcamp", candidates: [] })
  await line({ event: "run_finished", phase: "network", run_id: "run-1", resolved: 3, unresolved: 2, awaiting_arbitration: 1 })
  await settle(800)
  await page.evaluate(() => document.querySelector("app-arbitration-dialog .p-dialog-header button")?.click())
  await settle(600)

  // Largeur rendue de chaque libelle : le tag et l'etiquette de source existants sont clones hors
  // de la table, leur texte remplace, leur largeur relevee dans la police reelle.
  const contentWidths = () =>
    page.evaluate(() => {
      const labels = (key) => Object.values(key)
      const t = window.__i18n
      const stateLabels = labels(t.tagging.state)
      const sourceLabels = ["Beatport", "Bandcamp", "SoundCloud"]
      const probe = (element, text) => {
        const clone = element.cloneNode(true)
        clone.style.position = "absolute"
        clone.style.visibility = "hidden"
        clone.style.whiteSpace = "nowrap"
        document.body.append(clone)
        const label = [...clone.querySelectorAll("*")].reverse().find((n) => n.childElementCount === 0 && n.textContent.trim() !== "") ?? clone
        label.textContent = text
        const width = clone.getBoundingClientRect().width
        clone.remove()
        return width
      }
      const tag = document.querySelector("app-run-list app-state-tag .p-tag")
      const source = document.querySelector("app-run-list app-source-label")
      const td = document.querySelector("app-run-list tbody tr td:nth-child(7)")
      const pad = parseFloat(getComputedStyle(td).paddingLeft) + parseFloat(getComputedStyle(td).paddingRight)
      const state = Math.max(...stateLabels.map((l) => probe(tag, l)))
      return {
        state: Math.round(state * 10) / 10,
        stateWithInfo: Math.round((state + 8 + 16) * 10) / 10,
        source: Math.round(Math.max(...sourceLabels.map((l) => probe(source, l))) * 10) / 10,
        cellPadding: pad,
        columns: [...document.querySelectorAll("app-run-list thead th")].map((th) => Math.round(th.getBoundingClientRect().width)),
      }
    })
  for (const lang of ["fr", "en"]) {
    await page.evaluate(async (lang) => {
      const app = ng.getComponent(document.querySelector("app-root"))
      await new Promise((resolve) => app.translate.use(lang).subscribe(resolve))
      window.__i18n = app.translate.translations?.[lang] ?? (await fetch(`/i18n/${lang}.json`).then((r) => r.json()))
    }, lang)
    await settle(600)
    out.measures[lang] = await contentWidths()
  }
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("fr"))
  await settle(400)

  // Variante d'arbitrage, injectee par-dessus les classes du template.
  const variants = {
    B: `app-run-list tr:is([data-arbitrable],[data-recoverable]):not([data-shown]):hover { background: color-mix(in oklab, var(--p-primary-color) 8%, transparent) !important }
        app-run-list tr[data-shown], app-run-list tr[data-shown]:hover { background: var(--p-highlight-background) !important }`,
    C: `app-run-list tbody tr:not([data-detail-carrier]):not([aria-hidden]):not([data-shown]):hover { background: color-mix(in oklab, var(--p-primary-color) 8%, transparent) !important }
        app-run-list tr[data-shown], app-run-list tr[data-shown]:hover { background: var(--p-highlight-background) !important }`,
  }
  if (variants[option]) await page.addStyleTag({ content: variants[option] })
  if (widths) {
    await page.evaluate(([source, state]) => {
      const th = document.querySelectorAll("app-run-list thead th")
      th[4].style.width = `${source}px`
      th[6].style.width = `${state}px`
    }, widths)
    await settle(300)
  }
  const rowBg = (fileName) =>
    page.evaluate((fileName) => {
      const tr = [...document.querySelectorAll("app-run-list tbody tr")].find((r) => r.textContent.includes(fileName))
      return getComputedStyle(tr).backgroundColor
    }, fileName)
  const row = (fileName) => page.locator("app-run-list tbody tr", { hasText: fileName }).first()

  // Ligne d'Amelie Lens depliee, survol d'une ligne rattrapable puis de la ligne depliee.
  await row(T[0].file_name).locator("[data-row-toggle]").click()
  await settle()
  await page.mouse.move(5, 5)
  await settle(300)
  out.measures.colors = { openIdle: await rowBg(T[0].file_name), actionableIdle: await rowBg(T[3].file_name), inertIdle: await rowBg(T[1].file_name) }
  await row(T[3].file_name).hover({ position: { x: 400, y: 20 } })
  await settle(400)
  out.measures.colors.actionableHover = await rowBg(T[3].file_name)
  if (shots) await page.screenshot({ path: `${shots}/run-list-${option ?? "A"}-hover-row.png` })
  await row(T[0].file_name).hover({ position: { x: 400, y: 20 } })
  await settle(400)
  out.measures.colors.openHover = await rowBg(T[0].file_name)
  if (shots) await page.screenshot({ path: `${shots}/run-list-${option ?? "A"}-hover-open.png` })
  await row(T[1].file_name).hover({ position: { x: 400, y: 20 } })
  await settle(400)
  out.measures.colors.inertHover = await rowBg(T[1].file_name)

  // Ligne rattrapable depliee : son vert ne cede pas au survol.
  await row(T[3].file_name).locator("[data-row-toggle]").click()
  await settle()
  await page.mouse.move(5, 5)
  await settle(300)
  out.measures.colors.openActionableIdle = await rowBg(T[3].file_name)
  await row(T[3].file_name).hover({ position: { x: 400, y: 20 } })
  await settle(400)
  out.measures.colors.openActionableHover = await rowBg(T[3].file_name)
  await row(T[3].file_name).locator("[data-row-toggle]").click()
  await settle()

  const c = out.measures.colors
  check("open row keeps its background under the pointer", c.openHover === c.openIdle, c)
  check("open actionable row keeps its background under the pointer", c.openActionableHover === c.openActionableIdle && c.openActionableIdle === c.openIdle, c)
  check("actionable row reacts to the pointer", c.actionableHover !== c.actionableIdle, c)
  check("inert row does not react to the pointer", c.inertHover === c.inertIdle, c)

  // Plancher 1024 x 700, FR puis EN : chaque tag d'etat, son icone et chaque source sur une ligne.
  await page.setViewportSize({ width: 1024, height: 700 })
  for (const lang of ["fr", "en"]) {
    await page.evaluate((lang) => ng.getComponent(document.querySelector("app-root")).translate.use(lang), lang)
    await settle(600)
    out.measures[`floor-${lang}`] = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("app-run-list tbody tr")].filter((r) => r.querySelector("app-state-tag"))
      const oneLine = (el) => el && el.getBoundingClientRect().height <= 28
      return {
        states: rows.every((r) => oneLine(r.querySelector("td:nth-child(7) > span"))),
        sources: rows.every((r) => !r.querySelector("app-source-label") || oneLine(r.querySelector("app-source-label"))),
        overflow: rows.some((r) => [...r.querySelectorAll("td:nth-child(5), td:nth-child(7)")].some((td) => td.scrollWidth > td.clientWidth)),
        pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
      }
    })
    const f = out.measures[`floor-${lang}`]
    check(`floor 1024 (${lang}): states and sources on one line, nothing overflows`, f.states && f.sources && !f.overflow && !f.pageScrolls, f)
  }
  return out
}
