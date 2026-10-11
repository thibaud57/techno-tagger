// « Extraire » sous `ng serve`, sidecar simule sur l'instance du service : desactive pendant
// la recherche d'un run, tooltip `playlist.blocked.tagging`, reactive a `run_finished`.
// Lance par le MCP Playwright : `browser_run_code_unsafe` avec `filename` sur ce fichier,
// `just dev-ui` servant http://localhost:4200.
async (page) => {
  const out = { checks: {}, failures: [] }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const onPage = (fn, arg) =>
    page.evaluate(
      ([source, value]) => new Function("c", "value", source)(ng.getComponent(document.querySelector("app-playlist-page")), value),
      [fn, arg],
    )
  const tooltip = () => page.evaluate(() => document.querySelector(".p-tooltip")?.textContent.trim() ?? null)
  const BLOCKED = ["Attendez la fin du run en cours sur l'onglet Tagging.", "Wait for the current run to finish on the Tagging tab."]

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("http://localhost:4200/playlist")
  // Sans sidecar, `ng serve` montre l'ecran bloquant : la page n'apparait qu'une fois `available` pose.
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
  })
  await line({ event: "version", version: "0.5.0", api_key_configured: true })
  await page.waitForFunction(() => document.querySelector("app-playlist-page") !== null)
  await onPage(`c.sourceFolder.set("C:/lib"); c.destinationFolder.set("C:/work"); c.playlistPath.set("C:/x/vlc_media.db")`)
  await line({ event: "playlists_listed", playlist_format: "vlc_dump", playlists: [{ playlist_id: 1, name: "set", track_count: 8 }] })
  await onPage(`c.choice.update((v) => ({ ...v, playlist: "set" }))`)
  await page.waitForTimeout(300)

  const button = page.locator("app-playlist-page button[pbutton]", { hasText: /Extraire la playlist|Extract playlist/ })
  check("enabled before the run", await button.isEnabled(), "disabled")

  await page.evaluate(() => window.__svc.startTagging("C:/Musique"))
  await page.waitForTimeout(300)
  check("disabled during the search", await button.isDisabled(), "enabled")
  const box = await button.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(900)
  const tip = await tooltip()
  check("tooltip names the running search", BLOCKED.includes(tip), tip)
  // Tous les tooltips s'ouvrent sous l'element (TOOLTIP), plus a gauche du bouton.
  const place = await page.evaluate((b) => {
    const t = document.querySelector(".p-tooltip")?.getBoundingClientRect()
    return t && { tipTop: Math.round(t.top), buttonBottom: Math.round(b.y + b.height) }
  }, box)
  check("tooltip opens under the button", place !== null && place.tipTop >= place.buttonBottom - 1, place)
  await page.mouse.move(0, 0)

  await line({ event: "run_started", run_id: "r", tracks: [] })
  await line({ event: "run_finished", phase: "network", run_id: "r", resolved: 0, unresolved: 0, written: 0, write_error: 0, awaiting_arbitration: 0 })
  await page.waitForTimeout(300)
  check("enabled again once the search is over", await button.isEnabled(), "disabled")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(900)
  check("no tooltip once enabled", (await tooltip()) === null, await tooltip())
  out.sent = await page.evaluate(() => window.__sent.map((c) => c.command))
  return out
}
