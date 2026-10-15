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
            // L'entree active se lit sans la couleur : une seule `aria-current`, celle de la section
            current: [...host.querySelectorAll('p-menu [aria-current="page"]')].map((link) => link.textContent.trim()),
            marked: [...host.querySelectorAll("p-menu .bg-emphasis")].map((content) => content.textContent.trim()),
          }
        }),
      )
    }
    measures[language] = { lang: await page.evaluate(() => document.documentElement.lang), sections }
    for (const section of sections) {
      if (section.sectionCount !== 1) failures.push(`${language} ${section.h2}: ${section.sectionCount} sections`)
      if (section.pageScrolls || section.mainScrolls) failures.push(`${language} ${section.h2}: defilement`)
      if (section.cutItems.length) failures.push(`${language} ${section.h2}: menu coupe ${section.cutItems}`)
      if (section.current.join() !== section.h2 || section.marked.join() !== section.h2) {
        failures.push(`${language} ${section.h2}: entree active ${section.current} / ${section.marked}`)
      }
    }
  }
  const widths = Object.values(measures).flatMap((m) => m.sections.map((s) => s.selectWidth).filter(Boolean))
  if (new Set(widths).size !== 1) failures.push(`largeur du select variable : ${widths}`)
  return { failures, measures }
}
