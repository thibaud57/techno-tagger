// Reglages au plancher 1024 x 700 sous `ng serve`, FR puis EN, sidecar simule sur l'instance du
// service : une section a la fois, aucun defilement, entrees du menu entieres, select de langue de
// meme largeur dans les deux langues. Sans fenetre Tauri ni port de debogage : a preferer quand seule
// la mise en page est en cause. Lance par `run_page.mjs`, `just dev-ui` servant :4200.
async (page) => {
  const failures = []
  const measures = {}
  await page.setViewportSize({ width: 1024, height: 700 })
  for (const language of ["fr-FR", "en-US"]) {
    await page.addInitScript((tag) => {
      Object.defineProperty(Navigator.prototype, "language", { get: () => tag, configurable: true })
    }, language)
    await page.goto("http://localhost:4200/settings")
    await page.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
    await page.evaluate(() => {
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
      window.__svc.send = async () => undefined
      window.__svc.handleLine(JSON.stringify({ event: "version", version: "0.0.0-probe", api_key_configured: true }))
      const ui = window.__svc.versionMismatch().ui
      window.__svc.handleLine(JSON.stringify({ event: "version", version: ui, api_key_configured: true }))
    })
    await page.waitForSelector("app-settings-page p-menu .p-menu-item")
    const count = await page.locator("app-settings-page p-menu .p-menu-item").count()
    const sections = []
    for (let i = 0; i < count; i += 1) {
      await page.locator("app-settings-page p-menu .p-menu-item-content").nth(i).click()
      await page.waitForTimeout(300)
      sections.push(
        await page.evaluate(() => {
          const main = document.querySelector("main")
          const host = document.querySelector("app-settings-page")
          const select = host.querySelector('p-select[data-field="language"]')
          return {
            h2: host.querySelector("section h2")?.textContent?.trim(),
            sectionCount: host.querySelectorAll("section").length,
            rows: [...host.querySelectorAll("app-settings-row")].length,
            pageScrolls: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
            mainScrolls: main.scrollHeight > main.clientHeight,
            cutItems: [...host.querySelectorAll(".p-menu-item-label")]
              .filter((label) => label.scrollWidth > label.clientWidth)
              .map((label) => label.textContent.trim()),
            selectWidth: select ? Math.round(select.getBoundingClientRect().width) : null,
            // Colonne des libelles de rangee (10rem) : libelle entier, sur une ligne, controles alignes
            labelColumn: [...host.querySelectorAll("app-settings-row")].map((row) => {
              const label = row.querySelector("[rowLabel]")
              const control = row.querySelector("[rowControl]")
              const range = document.createRange()
              range.selectNodeContents(label)
              const text = range.getBoundingClientRect()
              const box = label.getBoundingClientRect()
              return {
                text: label.textContent.trim(),
                // La rangee est un subgrid : les colonnes se lisent sur la grille parente (`settings-rows`).
                columns: getComputedStyle(row.parentElement).gridTemplateColumns,
                textWidth: Math.round(text.width * 10) / 10,
                boxWidth: Math.round(box.width * 10) / 10,
                lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
                cut: label.scrollWidth > label.clientWidth,
                labelLeft: Math.round(box.left * 10) / 10,
                controlLeft: Math.round(control.getBoundingClientRect().left * 10) / 10,
                rowOverflow: row.scrollWidth > row.clientWidth,
              }
            }),
            // Rangees jointives : le filet seul les separe, a egale distance (py-3) des contenus de part et d'autre
            rhythm: (() => {
              const n = (x) => Math.round(x * 10) / 10
              const rows = [...host.querySelectorAll("app-settings-row")]
              const extent = (row) => {
                // Le contenu d'une rangee : libelle, controle et action (colonne de droite, quand elle existe),
                // plus la zone des retours (`div.col-start-2`) quand elle est affichee.
                const parts = [row.querySelector("[rowLabel]"), row.querySelector("[rowControl]"), row.querySelector("[rowAction]")].filter(Boolean)
                const extra = row.querySelector(":scope > div.col-start-2")
                const shown = extra && extra.getBoundingClientRect().height > 0 ? extra : null
                const tops = parts.map((p) => p.getBoundingClientRect().top)
                const bottoms = [...parts.slice(1), shown].filter(Boolean).map((p) => p.getBoundingClientRect().bottom)
                return { top: Math.min(...tops), bottom: Math.max(...bottoms) }
              }
              const border = (row) => parseFloat(getComputedStyle(row).borderBottomWidth)
              const h2 = host.querySelector("section h2").getBoundingClientRect()
              const reset = host.querySelector('[data-action="reset-thresholds"]')
              return {
                h2ToFirstRow: n(rows[0].getBoundingClientRect().top - h2.bottom),
                firstContentFromTop: n(extent(rows[0]).top - rows[0].getBoundingClientRect().top),
                // contenu -> filet, puis filet -> contenu de la rangee suivante
                belowContent: rows.map((r) => n(r.getBoundingClientRect().bottom - border(r) - extent(r).bottom)),
                aboveContent: rows.map((r, i) => n(extent(r).top - r.getBoundingClientRect().top)),
                rowGaps: rows.slice(1).map((r, i) => n(r.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom)),
                lastRowToReset: reset ? n(reset.getBoundingClientRect().top - rows[rows.length - 1].getBoundingClientRect().bottom) : null,
              }
            })(),
            sectionOverflow: host.querySelector("section").scrollWidth > host.querySelector("section").clientWidth,
            // L'entree active se lit sans la couleur : une seule `aria-current`, celle de la section
            current: [...host.querySelectorAll('p-menu [aria-current="page"]')].map((link) => link.textContent.trim()),
            marked: [...host.querySelectorAll("p-menu .bg-highlight")].map((content) => content.textContent.trim()),
          }
        }),
      )
    }
    measures[language] = { lang: await page.evaluate(() => document.documentElement.lang), sections }
    for (const section of sections) {
      if (section.sectionCount !== 1) failures.push(`${language} ${section.h2}: ${section.sectionCount} sections`)
      if (section.pageScrolls || section.mainScrolls) failures.push(`${language} ${section.h2}: defilement`)
      if (section.cutItems.length) failures.push(`${language} ${section.h2}: menu coupe ${section.cutItems}`)
      const labels = section.labelColumn
      if (labels.some((l) => !l.columns.startsWith("160px "))) failures.push(`${language} ${section.h2}: colonne des libelles ${labels.map((l) => l.columns)}`)
      if (labels.some((l) => l.cut || l.lines !== 1 || l.textWidth > 160)) failures.push(`${language} ${section.h2}: libelle coupe ou sur deux lignes ${JSON.stringify(labels.filter((l) => l.cut || l.lines !== 1 || l.textWidth > 160))}`)
      if (new Set(labels.map((l) => l.controlLeft)).size > 1) failures.push(`${language} ${section.h2}: controles non alignes ${labels.map((l) => l.controlLeft)}`)
      const rh = section.rhythm
      if (rh.h2ToFirstRow !== 16) failures.push(`${language} ${section.h2}: h2 -> premiere rangee ${rh.h2ToFirstRow}px`)
      if (rh.rowGaps.some((g) => g !== 0)) failures.push(`${language} ${section.h2}: ecart entre rangees ${rh.rowGaps}`)
      if (rh.belowContent.some((g, i) => Math.abs(g - 12) > 0.6 || Math.abs(rh.aboveContent[i] - 12) > 0.6)) failures.push(`${language} ${section.h2}: filet pas a egale distance, dessous ${rh.belowContent}, dessus ${rh.aboveContent}`)
      if (rh.lastRowToReset !== null && rh.lastRowToReset !== 16) failures.push(`${language} ${section.h2}: derniere rangee -> Retablir ${rh.lastRowToReset}px`)
      if (labels.some((l) => l.rowOverflow) || section.sectionOverflow) failures.push(`${language} ${section.h2}: debordement`)
      if (section.current.join() !== section.h2 || section.marked.join() !== section.h2) {
        failures.push(`${language} ${section.h2}: entree active ${section.current} / ${section.marked}`)
      }
    }
  }
  const widths = Object.values(measures).flatMap((m) => m.sections.map((s) => s.selectWidth).filter(Boolean))
  if (new Set(widths).size !== 1) failures.push(`largeur du select variable : ${widths}`)
  return { failures, measures }
}
