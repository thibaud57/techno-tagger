// Shell de la demo web sous `just dev-demo` (navigateur nu, aucun Tauri ni sidecar), un contexte de
// navigateur par scenario (stockage neuf). Rend `checks` et `failures`.
async (page) => {
  const base = "http://localhost:4200"
  // `SHOTS_DIR` facultatif : captures du shell et des Reglages pour le controle de fidelite.
  const shots = process.env.SHOTS_DIR
  const browser = page.context().browser()
  const failures = []
  const checks = {}
  const consoleErrors = []
  const check = (name, ok, detail) => {
    checks[name] = { ok, ...(detail === undefined ? {} : { detail }) }
    if (!ok) failures.push(name)
  }
  const fresh = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 700 }, ...options })
    const p = await context.newPage()
    p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()))
    p.on("pageerror", (e) => consoleErrors.push(String(e)))
    return { context, p }
  }
  const ready = (p) => p.waitForSelector("p-tablist", { timeout: 30000 })
  const settle = (p, ms) => p.waitForTimeout(ms)
  const hoverTip = async (p, selector) => {
    await p.mouse.move(2, 2)
    await settle(p, 450)
    const box = await p.locator(selector).first().boundingBox()
    if (!box) return { missing: true }
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await settle(p, 900)
    return p.evaluate((css) => {
      const el = document.querySelector(css)
      const tip = document.querySelector(".p-tooltip")
      return { disabled: el.disabled === true, tip: tip ? tip.textContent.trim() : null }
    }, selector)
  }
  const bannerLines = () => {
    const banner = document.querySelector("app-demo-banner")
    const text = banner?.querySelector("span, p")
    return text ? Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)) : null
  }
  const paths = await (await fetch(`${base}/demo/scenario.json`)).json().then((s) => s.paths)

  // Scenario 1 : ?lang=en, anglais, Playlist, bandeau, aucun ecran bloquant, URL sans lang.
  {
    const { context, p } = await fresh({ locale: "fr-FR" })
    await p.goto(`${base}/?lang=en`)
    await ready(p)
    await settle(p, 800)
    const state = await p.evaluate(() => {
      const bar = document.querySelector("p-tablist").getBoundingClientRect()
      const tabs = [...document.querySelectorAll("p-tab")].slice(0, 2).map((t) => t.getBoundingClientRect())
      const banner = document.querySelector("app-demo-banner")
      const tabsHost = document.querySelector("p-tabs")
      const link = banner?.querySelector("a")
      return {
        lang: document.documentElement.lang,
        url: location.href,
        path: location.pathname,
        h1: document.querySelector("h1")?.textContent.trim(),
        blocked: !!document.querySelector("p-card"),
        tabCount: document.querySelectorAll("p-tab").length,
        tabsOffset: Math.round((tabs[0].left + tabs[1].right) / 2 - (bar.left + bar.width / 2)),
        windowControls: document.querySelectorAll("app-window-controls").length,
        orphanSeparator: document.querySelectorAll("span.order-3.border-l").length,
        bannerAfterTabs: !!banner && !!(tabsHost.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING),
        bannerBeforeMain: !!banner && !!(banner.compareDocumentPosition(document.querySelector("main")) & Node.DOCUMENT_POSITION_FOLLOWING),
        bannerHeight: banner ? Math.round(banner.getBoundingClientRect().height) : null,
        bannerText: banner?.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
        link: link && { href: link.href, target: link.target, rel: link.rel, icon: !!link.querySelector("svg") },
        pageScroll: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
      }
    })
    const lines = await p.evaluate(bannerLines)
    if (shots) await p.screenshot({ path: `${shots}/demo-shell-en-1024.png` })
    check("s1.english", state.lang === "en" && state.h1 === "Playlist", { lang: state.lang, h1: state.h1 })
    check("s1.playlistTab", state.path === "/playlist", state.path)
    check("s1.noBlockingScreen", !state.blocked && state.tabCount === 3, { blocked: state.blocked, tabs: state.tabCount })
    check("s1.urlWithoutLang", !state.url.includes("lang="), state.url)
    check("s1.bannerUnderTabs", state.bannerAfterTabs && state.bannerBeforeMain && state.bannerHeight === 32, state.bannerHeight)
    check("s1.bannerOneLineEn", lines === 1, { lines, text: state.bannerText })
    check("shell.tabsCentred", state.tabsOffset === 0, state.tabsOffset)
    check("shell.noWindowControls", state.windowControls === 0 && state.orphanSeparator === 0, state)
    check(
      "s5.contactEn",
      state.link?.href === "https://thibaud-geisler.com/en/contact" &&
        state.link.target === "_blank" &&
        state.link.rel === "noopener noreferrer" &&
        state.link.icon,
      state.link,
    )
    check("shell.noPageScroll", !state.pageScroll)
    await context.close()
  }

  // Scenario 2 : choix FR enregistre, ?lang=en l'emporte puis tient au rechargement ; sans rien, le navigateur.
  {
    const { context, p } = await fresh({ locale: "en-US" })
    await p.goto(`${base}/?lang=fr`)
    await ready(p)
    await settle(p, 500)
    const frFirst = await p.evaluate(() => document.documentElement.lang)
    const lines = await p.evaluate(bannerLines)
    const href = await p.evaluate(() => document.querySelector("app-demo-banner a").href)
    check("s1.bannerOneLineFr", lines === 1, lines)
    check("s5.contactFr", href === "https://thibaud-geisler.com/fr/contact", href)
    await p.goto(`${base}/?lang=en`)
    await ready(p)
    await settle(p, 500)
    const afterQuery = await p.evaluate(() => document.documentElement.lang)
    await p.goto(`${base}/`)
    await ready(p)
    await settle(p, 500)
    const afterReload = await p.evaluate(() => document.documentElement.lang)
    check("s2.queryWinsOverStoredChoice", frFirst === "fr" && afterQuery === "en" && afterReload === "en", {
      frFirst,
      afterQuery,
      afterReload,
    })
    await p.goto(`${base}/?lang=de`)
    await ready(p)
    await settle(p, 500)
    const unknown = await p.evaluate(() => ({ lang: document.documentElement.lang, url: location.href }))
    check("s2.unknownQueryIgnored", unknown.lang === "en" && !unknown.url.includes("lang="), unknown)
    await context.close()
    for (const [locale, expected] of [
      ["fr-FR", "fr"],
      ["de-DE", "en"],
    ]) {
      const { context: c, p: q } = await fresh({ locale })
      await q.goto(`${base}/`)
      await ready(q)
      await settle(q, 500)
      const lang = await q.evaluate(() => document.documentElement.lang)
      check(`s2.browserLanguage.${locale}`, lang === expected, lang)
      await c.close()
    }
  }

  // Scenario 3 : les selecteurs remplissent les champs avec les chemins du scenario.
  {
    const { context, p } = await fresh({ locale: "fr-FR" })
    await p.goto(`${base}/?lang=fr`)
    await ready(p)
    await settle(p, 500)
    const pickers = p.locator("app-playlist-page app-path-picker button")
    await pickers.nth(0).click()
    await pickers.nth(1).click()
    await pickers.nth(2).click()
    await settle(p, 300)
    const playlist = await p.evaluate(() => {
      const c = ng.getComponent(document.querySelector("app-playlist-page"))
      return { library: c.sourceFolder(), destination: c.destinationFolder(), dump: c.playlistPath() }
    })
    check(
      "s3.playlistPickers",
      playlist.library === paths.library && playlist.destination === paths.destination && playlist.dump === paths.vlc_dump,
      { playlist, paths },
    )
    await p.locator("p-tab").nth(1).click()
    await p.waitForSelector("app-tagging-page app-path-picker button")
    await p.locator("app-tagging-page app-path-picker button").first().click()
    await settle(p, 300)
    const folder = await p.evaluate(() => ng.getComponent(document.querySelector("app-tagging-page")).folder())
    check("s3.taggingPicker", folder === paths.destination, folder)
    const noScroll = await p.evaluate(() => {
      const main = document.querySelector("main")
      return (
        document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight &&
        main.scrollHeight <= main.clientHeight
      )
    })
    check("shell.taggingNoScroll", noScroll)
    await context.close()
  }

  // Scenario 4 : actions grisees en demo, raison au survol ; actions restees libres.
  for (const [lang, reason] of [
    ["fr", "Indisponible dans la démo."],
    ["en", "Not available in the demo."],
  ]) {
    const { context, p } = await fresh({ viewport: { width: 1280, height: 800 } })
    await p.goto(`${base}/settings?lang=${lang}`)
    await p.waitForSelector("app-settings-page p-menu .p-menu-item")
    await settle(p, 600)
    const menu = (n) => p.locator("app-settings-page p-menu .p-menu-item-content").nth(n).click()
    const tips = {}
    tips.save = await hoverTip(p, '[data-action="save-api-key"]')
    tips.apiKeyField = await p.evaluate(
      () => document.querySelector("app-settings-page input[type=password]")?.disabled ?? null,
    )
    await menu(1)
    await settle(p, 400)
    tips.reset = await hoverTip(p, '[data-action="reset-thresholds"]')
    tips.thresholds = await p.evaluate(() => ({
      sliders: [...document.querySelectorAll("app-settings-page p-slider")].map((s) => s.classList.contains("p-disabled")),
      fields: [...document.querySelectorAll("app-settings-page p-inputnumber input")].map((i) => i.disabled),
    }))
    await menu(2)
    await settle(p, 400)
    tips.interface = await p.evaluate(() => ({
      select: !document.querySelector("app-settings-page p-select")?.classList.contains("p-disabled"),
      sound: document.querySelector("app-settings-page p-toggleswitch input")?.disabled === false,
    }))
    await menu(3)
    await settle(p, 400)
    for (const action of ["clear-cache", "reveal-logs", "check-update", "restore-last", "open-past-run"]) {
      tips[action] = await hoverTip(p, `[data-action="${action}"]`)
    }
    if (shots) {
      await hoverTip(p, '[data-action="check-update"]')
      await p.screenshot({ path: `${shots}/demo-settings-admin-${lang}.png` })
    }
    const blocked = ["save", "reset", "clear-cache", "reveal-logs", "check-update"]
    check(
      `s4.${lang}.greyedWithReason`,
      blocked.every((k) => tips[k].disabled && tips[k].tip === reason),
      Object.fromEntries(blocked.map((k) => [k, tips[k]])),
    )
    check(
      `s4.${lang}.apiKeyAndThresholdsGreyed`,
      tips.apiKeyField === true && tips.thresholds.sliders.every(Boolean) && tips.thresholds.fields.every(Boolean),
      { apiKeyField: tips.apiKeyField, thresholds: tips.thresholds },
    )
    check(`s4.${lang}.interfaceFree`, tips.interface.select && tips.interface.sound, tips.interface)
    // Le rejeu repond a `get_rollback_target` (aucune cible avant l'ecriture du visiteur : le bouton reste grise
    // pour sa raison habituelle, jamais celle de la demo) et a `list_runs` (un run passe enregistre : « Ouvrir le
    // recapitulatif » est actif).
    const noRestoreReason = lang === "fr" ? "Aucun run à restaurer : aucune sauvegarde de tags récente." : "No run to restore: no recent tag backup."
    check(
      `s4.${lang}.restoreGreyedForItsOwnReasonPastRunsOpen`,
      tips["restore-last"].disabled && tips["restore-last"].tip?.replace(/ /g, " ") === noRestoreReason && tips["open-past-run"].disabled === false,
      { restore: tips["restore-last"], past: tips["open-past-run"] },
    )
    if (lang === "fr") {
      await menu(2)
      await settle(p, 300)
      await p.locator("app-settings-page p-select").first().click()
      await settle(p, 300)
      await p.locator(".p-select-option", { hasText: "English" }).click()
      await settle(p, 600)
      const switched = await p.evaluate(() => document.documentElement.lang)
      check("s4.languageChangeApplies", switched === "en", switched)
    }
    await context.close()
  }

  // Scenario 8 : scenario lent, puis absent.
  {
    const { context, p } = await fresh()
    await p.route("**/demo/scenario.json", async (route) => {
      await new Promise((r) => setTimeout(r, 2500))
      await route.continue()
    })
    await p.goto(`${base}/?lang=en`)
    await settle(p, 1200)
    const during = await p.evaluate(() => ({ blocked: !!document.querySelector("p-card") }))
    await ready(p)
    await settle(p, 2500)
    const after = await p.evaluate(() => ({
      blocked: !!document.querySelector("p-card"),
      tabs: document.querySelectorAll("p-tab").length,
    }))
    check("s8.slowScenarioThenReady", !during.blocked && !after.blocked && after.tabs === 3, { during, after })
    await context.close()
  }
  {
    const { context, p } = await fresh()
    const before = consoleErrors.length
    await p.route("**/demo/scenario.json", (route) => route.fulfill({ status: 404, body: "" }))
    await p.goto(`${base}/?lang=en`)
    // Une carte absente est le verdict lu juste apres : seul le delai expire est attendu ici.
    await p.waitForSelector("p-card", { timeout: 15000 }).catch((error) => {
      if (error.name !== "TimeoutError") throw error
    })
    const blocked = await p.evaluate(() => ({
      card: !!document.querySelector("p-card"),
      title: document.querySelector("p-card h3")?.textContent.trim(),
      controls: document.querySelectorAll("app-window-controls").length,
    }))
    const logged = consoleErrors.slice(before).some((e) => e.includes("[demo] scenario illisible"))
    consoleErrors.splice(before)
    check("s8.missingScenarioBlocks", blocked.card && blocked.controls === 0 && logged, { ...blocked, logged })
    await context.close()
  }

  const unexpected = consoleErrors.filter((e) => !e.includes("Failed to load resource"))
  check("console.noErrors", unexpected.length === 0, unexpected)
  return { success: failures.length === 0, failures, checks, paths }
}
