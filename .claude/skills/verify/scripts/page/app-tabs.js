// Sante de la webview sous `ng serve`, sidecar simule sur l'instance du service : le service est-il
// resolu par l'injecteur, l'ecran bloquant se leve-t-il sur un `version` a la version de l'interface,
// chaque onglet (route lazy) se charge-t-il avec son h1. Premier controle apres un deplacement de
// fichiers ou une montee de dependances. Lance par `run_page.mjs`, `just dev-ui` servant :44200.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("http://localhost:4200/")
  await page.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
  const bootstrap = await page.evaluate(() => {
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
    if (!window.__svc) return { service: false }
    window.__svc._available.set(true)
    window.__svc.send = async () => undefined
    // Une version quelconque d'abord : `versionMismatch().ui` rend celle de l'interface
    window.__svc.handleLine(JSON.stringify({ event: "version", version: "0.0.0-probe", api_key_configured: true }))
    const ui = window.__svc.versionMismatch().ui
    window.__svc.handleLine(JSON.stringify({ event: "version", version: ui, api_key_configured: true }))
    return { service: true, ui, available: window.__svc.available(), mismatch: window.__svc.versionMismatch() }
  })
  if (!bootstrap.service) throw new Error("SidecarService introuvable dans l'injecteur")
  await page.waitForSelector("p-tab")

  const visited = []
  const tabs = await page.locator("p-tab").count()
  for (const i of [...Array(tabs).keys(), 0]) {
    await page.locator("p-tab").nth(i).click()
    await page.waitForTimeout(500)
    visited.push(
      await page.evaluate(() => ({
        tab: [...document.querySelectorAll("p-tab")].find((t) => t.getAttribute("aria-selected") === "true")?.textContent.trim() ?? null,
        url: location.pathname,
        h1: document.querySelector("main h1")?.textContent?.trim() ?? null,
        page: document.querySelector("main [class*='page'], main > *")?.tagName.toLowerCase() ?? null,
      })),
    )
  }
  return { ...bootstrap, lang: await page.evaluate(() => document.documentElement.lang), visited }
}
