// Tiroir du detail avant / apres de la liste du run sous `ng serve`, sidecar simule sur
// l'instance du service : bouton d'ouverture (largeur FR et EN, clavier, focus), detail d'un
// resolu, d'un non resolu, d'un illisible, d'un en attente et d'un arbitrage, bascule d'une
// ligne a l'autre, modale d'arbitrage au-dessus, plancher, puis gros run (`BULK` morceaux).
// Lance par le MCP Playwright : `browser_run_code_unsafe` avec `filename` sur ce fichier,
// `just dev-ui` servant http://localhost:4200. Captures dans .playwright-mcp/verify-drawer/.
async (page) => {
  const DIR = "C:/Users/thiba/Desktop/dev/techno-tagger/.playwright-mcp/verify-drawer/"
  const BULK = 2000
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
  const shownRows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("app-run-list tbody tr[data-shown]")].map((r) => r.querySelector("app-truncated-text")?.textContent.trim()),
    )
  /** Etat du tiroir : null quand il n'est pas affiche. */
  const drawer = () =>
    page.evaluate(() => {
      // `position: fixed` : `offsetParent` vaut null meme affiche. Ferme, le tiroir reste dans le
      // DOM, glisse hors ecran : seul un rectangle dans la fenetre dit qu'il est affiche.
      const d = [...document.querySelectorAll(".p-drawer")].find((x) => {
        const b = x.getBoundingClientRect()
        return b.width > 0 && b.left < innerWidth - 1
      })
      if (!d) return null
      const box = d.getBoundingClientRect()
      const detail = d.querySelector("app-track-detail")
      const art = detail?.querySelector("app-artwork")
      const grid = detail?.querySelector(".grid")
      const cells = [...(detail?.querySelectorAll("[data-detail-row]") ?? [])].map((r) => [...r.querySelectorAll("[data-cell]")])
      const content = d.querySelector(".p-drawer-content")
      return {
        x: Math.round(box.left),
        w: Math.round(box.width),
        h: Math.round(box.height),
        right: Math.round(innerWidth - box.right),
        zIndex: Number(getComputedStyle(d).zIndex) || Number(getComputedStyle(d.parentElement).zIndex) || null,
        mask: !!document.querySelector(".p-drawer-mask.p-overlay-mask"),
        header: d.querySelector(".p-drawer-header app-truncated-text")?.textContent.trim() ?? null,
        rows: cells.map((c) => c.map((x) => x.textContent.trim())),
        cut: cells.flatMap((c) => c.slice(0, 2).filter((x) => x.scrollWidth > x.clientWidth).map((x) => x.textContent.trim())),
        unreadable: detail?.querySelector("[data-unreadable]")?.textContent.trim() ?? null,
        art: art && {
          // L'hote s'etire dans la colonne du tiroir : seule la pochette rendue fait 160px.
          w: Math.round(art.querySelector("img, p-skeleton, div").getBoundingClientRect().width),
          skeleton: !!art.querySelector("p-skeleton"),
          frame: !!art.querySelector("div app-icon"),
          above: grid ? art.getBoundingClientRect().bottom <= grid.getBoundingClientRect().top : null,
        },
        contentScrolls: content ? content.scrollHeight > content.clientHeight : null,
        valueWidth: cells[0] ? Math.round(cells[0][3].getBoundingClientRect().width) : null,
      }
    })
  const chevronColumn = () =>
    page.evaluate(() => {
      const th = document.querySelector("app-run-list thead th")
      const button = document.querySelector("app-run-list [data-row-toggle]")
      const td = button.closest("td")
      const tdBox = td.getBoundingClientRect()
      const b = button.getBoundingClientRect()
      return {
        th: Math.round(th.getBoundingClientRect().width),
        button: Math.round(b.width),
        clipped: b.right > tdBox.right || b.left < tdBox.left,
        label: button.getAttribute("aria-label"),
      }
    })
  const activeInDrawer = () =>
    page.evaluate(() => ({
      inDrawer: !!document.activeElement?.closest(".p-drawer"),
      tag: document.activeElement?.tagName,
      toggle: document.activeElement?.hasAttribute("data-row-toggle") ?? false,
    }))

  const value = (field, key, v) => ({ field, key, value: v })
  const KEYS = [
    ["artist", "TPE1"], ["remixer", "TPE4"], ["title", "TIT2"], ["album", "TALB"], ["date", "TYER"],
    ["original_date", "TORY"], ["genre", "TCON"], ["label", "TPUB"], ["catalog_number", "TXXX:CATALOGNUMBER"],
    ["bpm", "TBPM"], ["key", "TKEY"], ["isrc", "TSRC"], ["track_number", "TRCK"], ["url", "WOAS"],
    ["source_id", "TXXX:SOURCE_ID"], ["source", "TXXX:SOURCE"],
  ]
  const BEFORE = { artist: "adam beyer", title: "your mind", genre: "Techno", bpm: "130", date: "2019" }
  const AFTER = {
    artist: "Adam Beyer, Bart Skils", remixer: "Layton Giordani", title: "Your Mind (Layton Giordani Remix)",
    album: "Your Mind (The Remixes)", date: "2023", original_date: "2019", genre: "Techno (Peak Time / Driving)",
    label: "Drumcode", catalog_number: "DC293", bpm: "130", key: "8A", isrc: "SE5Q52300123", track_number: "2",
    url: "https://www.beatport.com/track/your-mind-layton-giordani-remix/17492013", source_id: "17492013", source: "beatport",
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
  const X = track(5, "Ignez", "Ion", null)
  const fillers = Array.from({ length: 20 }, (_, i) => track(10 + i, "Filler", `Track ${i}`))

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
  check("button fits its column (fr, en)", !out.measures.chevronFr.clipped && !out.measures.chevronEn.clipped, [out.measures.chevronFr, out.measures.chevronEn])
  check("button label translated", out.measures.chevronFr.label === "Afficher le détail" && out.measures.chevronEn.label === "Show details", [out.measures.chevronFr.label, out.measures.chevronEn.label])

  // Resolu : tiroir non modal a droite, pochette en haut, 15 champs + commentaire.
  await toggle(R.file_name).click()
  await settle()
  const r = await drawer()
  out.measures.resolved = r
  check("drawer opens on the right, 560px, no mask", r !== null && r.right === 0 && r.w === 560 && !r.mask, r && { right: r.right, w: r.w, mask: r.mask })
  check("drawer header is the track line", r?.header === "Adam Beyer, Bart Skils - Your Mind (Layton Giordani Remix)", r?.header)
  check("resolved: 15 fields plus comment, no source id", r?.rows.length === 16 && !r?.rows.some((x) => x[1] === "TXXX:SOURCE_ID"), r?.rows.map((x) => x[1]))
  check("resolved: first row", JSON.stringify(r?.rows[0]) === JSON.stringify(["Artiste", "TPE1", "adam beyer", "Adam Beyer, Bart Skils"]), r?.rows[0])
  check("resolved: comment row, after em dash", JSON.stringify(r?.rows.at(-1)) === JSON.stringify(["Commentaire", "", "Ripped by X", "—"]), r?.rows.at(-1))
  check("artwork 160px above the grid", r?.art?.w === 160 && r?.art?.above === true && r?.art?.frame, r?.art)
  check("no field label cut in the drawer", r?.cut.length === 0, r?.cut)
  check("values get at least 160px each", r?.valueWidth >= 160, r?.valueWidth)
  check("shown row highlighted and pressed", JSON.stringify(await shownRows()) === JSON.stringify(["Adam Beyer - Your Mind"]) && (await toggle(R.file_name).getAttribute("aria-pressed")) === "true", await shownRows())
  check("no command sent by the button", (await page.evaluate(() => window.__sent.length)) === 0, await page.evaluate(() => window.__sent))
  await shot("1-resolved")

  // Autre ligne : le detail est remplace, puis le meme bouton ferme.
  await toggle(U.file_name).click()
  await settle()
  const u = await drawer()
  check("another row replaces the detail", u?.rows.every((x) => x[3] === "—") && u?.art?.frame === true, u?.rows.map((x) => x[3]))
  check("highlight follows", JSON.stringify(await shownRows()) === JSON.stringify(["Nur Jaber - Into the Void"]), await shownRows())
  await toggle(U.file_name).click()
  await settle()
  check("same button closes the drawer", (await drawer()) === null && (await shownRows()).length === 0, await drawer())

  // Illisible, en attente.
  await toggle(X.file_name).click()
  await settle()
  check("unreadable: sentence shown", (await drawer())?.unreadable === "Les tags de ce fichier n'ont pas pu être lus.", (await drawer())?.unreadable)
  await toggle(P.file_name).click()
  await settle()
  check("pending: skeleton artwork", (await drawer())?.art?.skeleton === true, (await drawer())?.art)

  // Ouvert, le morceau en attente se resout : le detail suit.
  await line(resolved(P))
  await settle()
  check("detail follows its track when resolved", (await drawer())?.rows[0]?.[3] === "Adam Beyer, Bart Skils", (await drawer())?.rows[0])

  // Arbitrage : le bouton ouvre le tiroir sans modale, la ligne ouvre la modale au-dessus.
  await toggle(A.file_name).click()
  await settle()
  check("arbitration button: drawer, no dialog", (await drawer()) !== null && !(await dialogShown()), { drawer: (await drawer()) !== null, dialog: await dialogShown() })
  await row(A.file_name).locator("td").nth(2).click()
  await settle(800)
  out.measures.stack = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll("app-arbitration-dialog .p-dialog")].find((d) => d.offsetParent !== null)
    if (!dialog) return null
    const box = dialog.getBoundingClientRect()
    const hit = document.elementFromPoint(box.right - 20, box.top + box.height / 2)
    return { dialogOnTop: !!hit?.closest("app-arbitration-dialog"), dialogRight: Math.round(box.right) }
  })
  check("row click opens the dialog above the drawer", out.measures.stack?.dialogOnTop === true, out.measures.stack)
  await shot("2-dialog-over-drawer")
  await closeDialog()

  // Clavier : Entree et Espace sur le bouton focalise, jamais la modale.
  await toggle(A.file_name).focus()
  await page.keyboard.press("Enter")
  await settle()
  const afterEnter = { drawer: (await drawer()) !== null, dialog: await dialogShown() }
  check("Enter on the button: closes, no dialog", !afterEnter.drawer && !afterEnter.dialog, afterEnter)
  await closeDialog()
  await toggle(A.file_name).focus()
  await page.keyboard.press(" ")
  await settle()
  out.measures.focusAfterSpace = await activeInDrawer()
  const afterSpace = { drawer: (await drawer()) !== null, dialog: await dialogShown() }
  check("Space on the button: opens, no dialog", afterSpace.drawer && !afterSpace.dialog, afterSpace)
  await closeDialog()

  // Tab depuis le tiroir ouvert : le relever (piege a focus de PrimeNG, meme non modal).
  const tabs = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab")
    tabs.push(await activeInDrawer())
  }
  out.measures.tabFromDrawer = tabs
  // Echap ferme le tiroir : ou va le focus ?
  await page.keyboard.press("Escape")
  await settle()
  out.measures.focusAfterEscape = await activeInDrawer()
  check("Escape closes the drawer", (await drawer()) === null, await drawer())

  // Anneau de focus du bouton au clavier.
  await toggle(R.file_name).focus()
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Tab")
  // `outline-color` passe par une transition de 200ms : mesuree avant, elle est encore transparente.
  await settle()
  out.measures.focus = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement)
    return { toggle: document.activeElement.hasAttribute("data-row-toggle"), visible: document.activeElement.matches(":focus-visible"), outline: `${s.outlineStyle} ${s.outlineColor}` }
  })
  check("focus ring visible on the button", out.measures.focus.toggle && out.measures.focus.visible && !out.measures.focus.outline.endsWith("rgba(0, 0, 0, 0)"), out.measures.focus)

  // Plancher 1024 x 700, tiroir ouvert : ni defilement de page, ni libelle coupe.
  await toggle(R.file_name).click()
  await page.setViewportSize({ width: 1024, height: 700 })
  await settle(600)
  const floor = await drawer()
  out.measures.floor = floor && { w: floor.w, h: floor.h, cut: floor.cut, contentScrolls: floor.contentScrolls }
  out.measures.noPageScroll1024 = await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)
  check("no page scroll at 1024 x 700", out.measures.noPageScroll1024, false)
  check("no field label cut at 1024 (fr)", floor?.cut.length === 0, floor?.cut)
  await shot("3-floor-1024")
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("en"))
  await settle()
  check("no field label cut at 1024 (en)", (await drawer())?.cut.length === 0, (await drawer())?.cut)
  await shot("4-floor-1024-en")
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("fr"))
  await page.setViewportSize({ width: 1280, height: 800 })

  // Nouveau run sans le morceau affiche : le tiroir se ferme.
  await page.evaluate(() => window.__svc.startTagging("C:/Musique/Grand"))
  const many = Array.from({ length: BULK }, (_, i) => track(100 + i, "Bulk Artist", `Bulk Title ${i}`))
  await page.evaluate(() => {
    window.__long = []
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: "longtask" })
  })
  out.measures.bulk = await page.evaluate(
    async ({ started, events }) => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      let t = performance.now()
      window.__svc.handleLine(JSON.stringify(started))
      await frame()
      const firstRender = Math.round(performance.now() - t)
      // Un evenement sur 20 mesure seul, rendu compris : les autres passent par lots, sans quoi
      // deux frames par evenement font durer un gros run plusieurs minutes.
      const perEvent = []
      for (let i = 0; i < events.length; i++) {
        if (i % 20 !== 0) {
          window.__svc.handleLine(JSON.stringify(events[i]))
          continue
        }
        await frame()
        t = performance.now()
        window.__svc.handleLine(JSON.stringify(events[i]))
        await frame()
        perEvent.push(performance.now() - t)
      }
      perEvent.sort((a, b) => a - b)
      const box = document.querySelector("app-run-list .p-virtualscroller, app-run-list .p-datatable-table-container")
      const frames = []
      for (let y = 0; y <= box.scrollHeight; y += 2000) {
        t = performance.now()
        box.scrollTop = y
        await frame()
        frames.push(performance.now() - t)
      }
      frames.sort((a, b) => a - b)
      return {
        mountedRows: document.querySelectorAll("app-run-list tbody tr").length,
        firstRenderMs: firstRender,
        eventMedianMs: Math.round(perEvent[Math.floor(perEvent.length / 2)]),
        eventP95Ms: Math.round(perEvent[Math.floor(perEvent.length * 0.95)]),
        eventMaxMs: Math.round(perEvent.at(-1)),
        scrollMedianMs: Math.round(frames[Math.floor(frames.length / 2)]),
        scrollMaxMs: Math.round(frames.at(-1)),
        longTasks: window.__long.length,
        longestTaskMs: Math.round(Math.max(0, ...window.__long)),
      }
    },
    {
      started: { event: "run_started", run_id: "run-2", folder: "C:/Musique/Grand", tracks: many },
      events: many.map((t, i) => (i % 3 === 0 ? unresolved(t) : resolved(t))),
    },
  )
  check("drawer closes when its track leaves the list", (await drawer()) === null, await drawer())
  check(`${BULK} tracks: only visible rows mounted`, out.measures.bulk.mountedRows < 60, out.measures.bulk.mountedRows)
  // Tiroir ouvert pendant un gros run : la bascule reste immediate.
  await page.evaluate(() => (document.querySelector("app-run-list .p-virtualscroller, app-run-list .p-datatable-table-container").scrollTop = 0))
  await settle()
  const t0 = Date.now()
  await page.locator("app-run-list [data-row-toggle]").first().click()
  await page.waitForSelector(".p-drawer app-track-detail")
  out.measures.bulk.openDrawerMs = Date.now() - t0
  await shot("5-bulk")

  return out
}
