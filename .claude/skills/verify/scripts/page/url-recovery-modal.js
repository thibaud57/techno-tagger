// Rattrapage par modale sous `ng serve`, sidecar simule sur l'instance du service : badge,
// modale du lien, etape lien de l'arbitrage, etat vide, lien colle oublie au run suivant.
// Lance par le MCP Playwright : `browser_run_code_unsafe` avec `filename` sur ce fichier,
// `just dev-ui` servant http://localhost:4200. Captures dans .playwright-mcp/verify-recovery/.
async (page) => {
  const DIR = "C:/Users/thiba/Desktop/dev/techno-tagger/.playwright-mcp/verify-recovery/"
  const out = { checks: {}, failures: [] }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const shot = (name) => page.screenshot({ path: `${DIR}${name}.png` })
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const sent = () => page.evaluate(() => window.__sent.map((c) => `${c.command}:${c.track_id ?? ""}`))
  const settle = (ms = 400) => page.waitForTimeout(ms)
  const dialog = () =>
    page.evaluate(() => {
      const d = [...document.querySelectorAll(".p-dialog")].find((x) => x.offsetParent !== null)
      if (!d) return null
      const box = d.getBoundingClientRect()
      const footer = d.querySelector(".p-dialog-footer")
      const field = d.querySelector('[data-field="url"]')
      const error = d.querySelector("app-error-message .p-message")
      return {
        w: Math.round(box.width),
        h: Math.round(box.height),
        footerTop: footer ? Math.round(footer.getBoundingClientRect().top - box.top) : null,
        title: d.querySelector("h3")?.textContent.trim() ?? null,
        counter: d.querySelector("p-badge")?.textContent.trim() ?? null,
        field: field ? { disabled: field.disabled, value: field.value } : null,
        help: d.querySelector("[data-help]")?.textContent.trim() ?? null,
        error: error?.textContent.trim() ?? null,
        actions: [...d.querySelectorAll("[data-action]")].map((b) => b.getAttribute("data-action")),
        focus: document.activeElement?.getAttribute("data-action") ?? document.activeElement?.getAttribute("data-field") ?? document.activeElement?.tagName,
      }
    })
  const badges = () =>
    page.evaluate(() => ({
      arbitration: document.querySelector("[data-arbitration-badge]")?.textContent.trim() ?? null,
      recovery: document.querySelector("[data-recovery-badge]")?.textContent.trim() ?? null,
    }))
  const noScroll = () =>
    page.evaluate(() => {
      const main = document.querySelector("main")
      return document.documentElement.scrollHeight <= innerHeight && (!main || main.scrollHeight <= main.clientHeight)
    })
  const row = (text) => page.locator("app-run-list tbody tr", { hasText: text }).first()
  const scrollTableTo = (top) =>
    page.evaluate((y) => {
      const s = document.querySelector("app-run-list .p-virtualscroller, app-run-list .p-datatable-table-container")
      if (s) s.scrollTop = y
    }, top)

  const track = (i, artist, title) => ({
    track_id: `${String(i).padStart(2, "0")} ${artist.toLowerCase()} - ${title.toLowerCase()}.mp3`,
    file_name: `${String(i).padStart(2, "0")} ${artist} - ${title}.mp3`,
    artist,
    title,
  })
  const unresolved = (t, reason) => ({ event: "track_resolved", track_id: t.track_id, state: "unresolved", resolution: "none", failure_reason: reason, source: null, after: null, scores: null, artwork_path: null })
  const auto = (t) => ({ event: "track_resolved", track_id: t.track_id, state: "resolved", resolution: "auto", failure_reason: null, source: "beatport", after: { artist: t.artist, title: t.title }, scores: { artist: 98, title: 95, average: 96 }, artwork_path: null })
  const byUrl = (t, source) => ({ event: "track_resolved", track_id: t.track_id, state: "resolved", resolution: "url", failure_reason: null, source, after: { artist: t.artist, title: t.title }, scores: null, artwork_path: null })
  const arbitration = (t, source, other) => ({ track_id: t.track_id, source, beatport_unavailable: false, empty_reason: null, other_source: other, candidates: [{ artist: t.artist, title: `${t.title} (Original Mix)`, label: "Drumcode", year: 2021, scores: { artist: 96, title: 74, average: 85 } }] })

  const A = track(1, "Amelie Lens", "Basiel")
  const B = track(2, "Adam Beyer", "Your Mind")
  const K = track(9, "Klangkuenstler", "Untergang")
  const S = track(10, "SNTS", "Unkept Promises")
  const N = track(11, "Nur Jaber", "Into the Void")
  const H = track(12, "Hector Oaks", "Sentiment")
  const I = track(24, "Ignez", "Ion")
  const P = track(25, "Planetary Assault Systems", "Function Creep")

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
    ;[...document.querySelectorAll("p-tab")].find((t) => /tagging/i.test(t.textContent))?.click()
    await window.__svc.startTagging("C:/Musique/Extraction")
  })

  // Run 1 : deux auto, quatre non resolus dont un rattrape, deux arbitrages restes en file.
  await line({ event: "run_started", run_id: "run-1", tracks: [A, B, K, S, N, H, I, P] })
  for (const e of [auto(A), auto(B), unresolved(K, "no_result"), unresolved(S, "below_threshold"), unresolved(N, "no_result"), unresolved(H, "empty_query")]) await line(e)
  await line({ event: "arbitration_required", ...arbitration(I, "beatport", "bandcamp") })
  await line({ event: "arbitration_required", ...arbitration(P, "beatport", "bandcamp") })
  check("badge hidden during the search", (await badges()).recovery === null, await badges())
  await line({ event: "run_finished", phase: "network", run_id: "run-1", resolved: 2, unresolved: 4, awaiting_arbitration: 2 })
  await line({ event: "progress", phase: "url_recovery", processed: 0, total: 4 })
  await line(byUrl(S, "bandcamp"))
  await line({ event: "progress", phase: "url_recovery", processed: 1, total: 4 })
  await settle()
  await page.locator("app-arbitration-dialog .p-dialog-close-button, app-arbitration-dialog .p-dialog-header button").first().click()
  await page.waitForTimeout(4500)
  check("badges side by side", JSON.stringify(await badges()) === JSON.stringify({ arbitration: "2 à arbitrer", recovery: "3 à rattraper" }), await badges())
  await scrollTableTo(0)
  const hint = await page.evaluate(() => {
    const h = document.querySelector("[data-recover-hint]")
    return h && { text: h.textContent.trim(), size: getComputedStyle(h).fontSize, weight: getComputedStyle(h).fontWeight }
  })
  check("paste hint at the column size, bold", hint?.size === "14px" && hint?.weight === "600" && /Coller un lien/.test(hint.text), hint)
  await shot("1-badges")
  for (const [w, h] of [[1280, 800], [1024, 700]]) {
    await page.setViewportSize({ width: w, height: h })
    await settle()
    check(`no page scroll ${w}x${h}`, await noScroll(), "scroll")
  }
  await page.setViewportSize({ width: 1280, height: 800 })

  // Badge depuis Playlist : bascule sur Tagging, modale du lien sur le premier non resolu.
  await page.locator("p-tab", { hasText: "Playlist" }).click()
  await settle(600)
  await page.locator("[data-recovery-badge]").click()
  await settle(1500)
  const opened = await dialog()
  check("badge opens Tagging", page.url().endsWith("/tagging"), page.url())
  check("link dialog on the first unresolved, 720 wide", opened?.title === "Klangkuenstler - Untergang" && opened.w === 720 && opened.h < 400 && opened.counter === "1/4", opened)
  check("field focused", opened?.focus === "url", opened?.focus)
  await shot("2-modale-depuis-badge")

  // Collage puis Entree : geste en vol, puis refus sous le champ, pied immobile.
  await page.keyboard.type("https://www.youtube.com/watch?v=x")
  await page.keyboard.press("Enter")
  await settle()
  const busy = await page.evaluate(() => {
    const b = document.querySelector('[data-action="resolve-url"]')
    return { disabled: b?.disabled, spinner: !!b?.querySelector('[data-p-icon="spinner"], app-icon[name="spinner"]') }
  })
  check("enter sends the pasted link", (await sent()).includes(`resolve_by_url:${K.track_id}`), await sent())
  check("spinner while the gesture waits", busy.disabled === true && busy.spinner, busy)
  check("start blocked during a gesture", await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Lancer le run/.test(b.textContent))?.disabled === true), "enabled")
  await line({ event: "error", code: "unsupported_url", params: { track_id: K.track_id }, message: "unsupported url", command: "resolve_by_url" })
  await page.waitForTimeout(2500)
  const refused = await dialog()
  check("error under the field, footer still", refused?.error !== null && refused.footerTop === opened.footerTop && refused.h === opened.h && refused.field.value.startsWith("https://www.youtube"), { opened, refused })
  await shot("3-erreur-sous-le-champ")
  await page.locator('app-url-recovery-dialog [data-action="skip"]').click()
  await settle()
  check("skip moves to the next track", (await dialog())?.counter === "2/4", await dialog())
  await page.keyboard.press("Escape")
  await settle()

  // Ligne « Coller un lien » : ouvre la modale sur ce morceau.
  await scrollTableTo(150)
  await settle()
  await row("Nur Jaber").click()
  await settle(800)
  check("row opens its own link dialog", (await dialog())?.title === "Nur Jaber - Into the Void", await dialog())
  await page.keyboard.press("Escape")
  await settle()

  // Etape lien de l'arbitrage : refus Beatport puis Bandcamp, lien accepte, arbitrage suivant.
  await page.locator("[data-arbitration-badge]").click()
  await settle(800)
  await page.locator('[data-action="refuse"]').click()
  await line({ event: "arbitration_updated", ...arbitration(I, "bandcamp", "beatport") })
  await settle()
  const before = await dialog()
  await page.locator('[data-action="refuse"]').click()
  await line(unresolved(I, "user_refused"))
  await line({ event: "progress", phase: "url_recovery", processed: 1, total: 5 })
  await settle(1200)
  const step = await dialog()
  check("link step in the arbitration frame", step?.title === "Ignez - Ion" && step.w === before.w && step.h === before.h && step.counter === null && step.actions.includes("skip") && !step.actions.includes("refuse"), { before, step })
  check("link step field focused", step?.focus === "url", step?.focus)
  await shot("4-etape-lien")
  await page.keyboard.type("https://ignez.bandcamp.com/track/ion")
  await page.keyboard.press("Enter")
  await settle()
  check("link step sends its link", (await sent()).includes(`resolve_by_url:${I.track_id}`), await sent())
  await line(byUrl(I, "bandcamp"))
  await settle(800)
  check("accepted link moves to the next arbitration", (await dialog())?.title === "Planetary Assault Systems - Function Creep", await dialog())
  await page.locator('[data-action="refuse"]').click()
  await line(unresolved(P, "user_refused"))
  await settle(800)
  await page.locator('app-arbitration-dialog [data-action="skip"]').click()
  await settle(800)
  check("skip on the last link step closes", (await dialog()) === null, await dialog())
  check("refused track counted to recover", (await badges()).recovery === "4 à rattraper", await badges())

  // Run 2 : lien colle oublie, etape lien desactivee pendant la recherche, focus sur Passer.
  await page.evaluate(() => window.__svc.startTagging("C:/Musique/Extraction"))
  await line({ event: "run_started", run_id: "run-2", tracks: [K, I] })
  await line(unresolved(K, "no_result"))
  await line({ event: "arbitration_required", ...arbitration(I, "beatport", "bandcamp") })
  await settle(800)
  await page.locator('[data-action="refuse"]').click()
  await line({ event: "arbitration_updated", ...arbitration(I, "bandcamp", "beatport") })
  await settle()
  await page.locator('[data-action="refuse"]').click()
  await line(unresolved(I, "user_refused"))
  await settle(1500)
  const searching = await dialog()
  check("link step disabled during the search", searching?.field?.disabled === true && /fin de la recherche/.test(searching.help ?? "") && searching.focus === "skip", searching)
  check("badge hidden during the second search", (await badges()).recovery === null, await badges())
  await shot("5-etape-lien-pendant-recherche")
  await page.locator('app-arbitration-dialog [data-action="skip"]').click()
  await line({ event: "run_finished", phase: "network", run_id: "run-2", resolved: 0, unresolved: 2, awaiting_arbitration: 0 })
  await line({ event: "progress", phase: "url_recovery", processed: 0, total: 2 })
  await settle(4500)
  await row("Klangkuenstler").click()
  await settle(800)
  check("pasted link forgotten by the next run", (await dialog())?.field?.value === "", await dialog())
  await page.keyboard.press("Escape")

  // Rien a rattraper : la ligne d'etat vide remplace la barre.
  await line({ event: "progress", phase: "url_recovery", processed: 0, total: 0 })
  await settle()
  const empty = await page.evaluate(() => ({ bar: !!document.querySelector("app-phase-progress"), text: document.querySelector("[data-recovery-empty]")?.textContent.replace(/\s+/g, " ").trim() ?? null }))
  check("empty state replaces the bar", !empty.bar && /Aucun morceau non résolu/.test(empty.text ?? ""), empty)
  await shot("6-rien-a-rattraper")

  out.sent = await sent()
  return out
}
