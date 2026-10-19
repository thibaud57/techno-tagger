// Self-test Sentry de la webview sous `ng serve`, sidecar simule sur l'instance du service
// (`_available` a vrai, `transport.send` remplace, `handleLine` pour chaque `version`) : un controle
// par regle de SKILL.md § Pilotage du self-test Sentry. L'instance de `SentrySelftestService` se lit
// par l'injecteur (champ prive `sent`). Si `SENTRY_DSN_UI` pointe un DSN `http://127.0.0.1:<port>/1`
// (le meme que celui de `just dev-ui`), le SDK reel construit un vrai evenement et la sonde releve
// ses POST par `page.route`, sans serveur : rien ne quitte la machine. Lance par `run_page.mjs`,
// `just dev-ui` servant http://localhost:4200.
async (page) => {
  const out = { checks: {}, failures: [], measures: {} }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const dsn = process.env.SENTRY_DSN_UI ?? ""
  const observing = /^http:\/\/[^@]+@127\.0\.0\.1:\d+\/\d+$/.test(dsn)
  const FRAGMENTS = ["Nova", "Mind", "Musique"]

  // Les POST du SDK vers le faux serveur, relevés puis acquittés (CORS ouvert : le SDK lit la reponse).
  const posts = []
  await page.route(/^http:\/\/127\.0\.0\.1:\d+\/api\/\d+\/envelope\//, async (route) => {
    const request = route.request()
    posts.push(request.postDataBuffer())
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "{}" })
  })
  const decode = (buffer) => {
    if (buffer === null) return ""
    const bytes = buffer[0] === 0x1f && buffer[1] === 0x8b ? process.getBuiltinModule("node:zlib").gunzipSync(buffer) : buffer
    return bytes.toString("utf-8")
  }
  const envelopeEvents = () =>
    posts.flatMap((buffer) => {
      const lines = decode(buffer).split("\n")
      const events = []
      for (let i = 1; i + 1 < lines.length; i += 2) {
        try {
          if (JSON.parse(lines[i]).type === "event") events.push(JSON.parse(lines[i + 1]))
        } catch {
          // une ligne qui n'est pas du JSON n'est pas un evenement
        }
      }
      return events
    })
  const selftestEvents = () =>
    envelopeEvents().filter((e) => (e.exception?.values ?? []).some((v) => /sentry self test/.test(v.value ?? "")))

  const consoleErrors = []
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()))
  const settle = (ms = 500) => page.waitForTimeout(ms)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("http://localhost:4200/tagging")
  await page.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
  await page.bringToFront()
  await settle()

  // Services lus par l'injecteur : l'instance existe sans qu'aucun ecran ne l'ait demandee.
  const found = await page.evaluate(() => {
    const root = ng.getInjector(document.querySelector("app-root"))
    const wanted = { sidecar: /SidecarService$/, selftest: /SentrySelftestService$/ }
    const seen = {}
    for (const injector of ng["ɵgetInjectorResolutionPath"](root)) {
      let providers
      try {
        providers = ng["ɵgetInjectorProviders"](injector)
      } catch {
        continue
      }
      for (const record of Object.values(providers)) {
        for (const [key, pattern] of Object.entries(wanted)) {
          const provided = Object.values(record).find((v) => typeof v === "function" && pattern.test(v.name))
          if (provided && !(key in seen)) {
            seen[key] = { name: provided.name, instance: injector.get(provided) }
          }
        }
      }
    }
    window.__svc = seen.sidecar?.instance
    window.__selftest = seen.selftest?.instance
    return { sidecar: seen.sidecar?.name ?? null, selftest: seen.selftest?.name ?? null }
  })
  check("(a) service du self-test resolu par l'injecteur, construit des le demarrage", found.selftest !== null && found.sidecar !== null, found)

  const state = () => page.evaluate(() => ({ sent: window.__selftest.sent, signal: window.__svc.sentrySelftest() }))
  await page.evaluate(() => {
    window.__svc._available.set(true)
    window.__svc.transport.send = async () => undefined
  })
  const version = (selftest) =>
    page.evaluate((flag) => {
      window.__svc.handleLine(
        JSON.stringify({
          event: "version",
          version: "0.0.0",
          api_key_configured: false,
          default_thresholds: { floor: 70, ceiling: 90 },
          log_file: "C:/Users/Jane Doe/AppData/Local/Acme/logs/tagger.log",
          sentry_selftest: flag,
        }),
      )
    }, selftest)
  const step = async (label, flag) => {
    await version(flag)
    await settle()
    const s = await state()
    out.measures[label] = { ...s, posted: envelopeEvents().length, selftestEvents: selftestEvents().length }
    return out.measures[label]
  }

  const before = await state()
  out.measures.start = { ...before, posted: envelopeEvents().length }
  check("(b) `sent` faux et signal faux avant tout `version`", before.sent === false && before.signal === false, before)

  const off = await step("version(false)", false)
  check("(c) `version` a `sentry_selftest: false` : `sent` reste faux, aucun evenement", off.sent === false && off.signal === false && off.selftestEvents === 0, off)

  const on = await step("version(true)", true)
  check("(d) `version` a `sentry_selftest: true` : `sent` passe a vrai", on.sent === true && on.signal === true, on)

  const trail = []
  for (const [i, flag] of [true, false, true].entries()) {
    trail.push({ flag, ...(await step(`replay ${i + 1} (${flag})`, flag)) })
  }
  check("(e) vrai, faux, vrai de plus : `sent` reste vrai", trail.every((s) => s.sent === true), trail)

  if (observing) {
    const events = selftestEvents()
    const rendered = posts.map(decode).join("\n")
    const total = envelopeEvents()
    check("(f) exactement un evenement du self-test arrive au serveur, malgre quatre `version` vrais", events.length === 1, { selftest: events.length, posted: total.length })
    check("(g) aucun autre evenement que le self-test", total.length === events.length, { total: total.length })
    const value = events[0]?.exception?.values?.[0]?.value ?? ""
    check("(h) valeur masquee : `<path>` present, aucun fragment du faux morceau", value.includes("<path>") && !FRAGMENTS.some((f) => value.includes(f)), { value })
    check("(i) aucun fragment dans l'enveloppe entiere", FRAGMENTS.every((f) => !rendered.includes(f)), { found: FRAGMENTS.filter((f) => rendered.includes(f)) })
    out.measures.event = {
      exception: events[0]?.exception?.values?.map((v) => [v.type, v.value]) ?? null,
      release: events[0]?.release ?? null,
      environment: events[0]?.environment ?? null,
      hasVars: JSON.stringify(events[0] ?? {}).includes('"vars"'),
    }
  } else {
    out.measures.observation = "aucune : SENTRY_DSN_UI vide, le SDK est inerte (etat de `sent` seul)"
  }

  out.measures.found = found
  out.measures.consoleErrors = consoleErrors
  return out
}
