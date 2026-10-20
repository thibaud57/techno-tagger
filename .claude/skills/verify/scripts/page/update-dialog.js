// Invite de mise a jour sous `ng serve`, FR puis EN a 1024 x 700 : controles decrits dans la ligne
// de `SKILL.md`. Le champ `updater` d'`UpdateService` est remplace par un faux, rien ne part sur le
// reseau ni vers le plugin. Lance par `run_page.mjs`, `just dev-ui` servant :4200 ; `SHOTS_DIR`
// designe le dossier des captures.
async (page) => {
  const failures = []
  const measures = {}
  const shots = process.env.SHOTS_DIR ?? ".playwright-mcp/verify-update"
  const check = (ok, message) => {
    if (!ok) failures.push(message)
  }
  const flat = (text) => String(text ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/[ \t\r\n]+/g, " ").trim()
  const RELEASE_PAGE = "https://example.com/releases/tag/v2.0.0"

  const EXPECTED = {
    fr: {
      tag: "fr-FR",
      title: "Mise à jour disponible",
      body: "La version 2.0.0 est disponible, vous utilisez la 1.0.0.\nL'application se ferme le temps de l'installation.",
      notes: "Voir les nouveautés",
      later: "Plus tard",
      install: "Installer",
      retry: "Réessayer",
      busy: "Disponible à la fin du travail en cours",
      counter: "4 Mo sur 10 Mo",
      failed: "La mise à jour a échoué.\nVérifiez votre connexion, puis réessayez.",
      badge: "Mise à jour 2.0.0",
    },
    en: {
      tag: "en-US",
      title: "Update available",
      body: "Version 2.0.0 is available, you are using 1.0.0.\nThe application closes during the installation.",
      notes: "See what's new",
      later: "Later",
      install: "Install",
      retry: "Retry",
      busy: "Available once the current work is done",
      counter: "4 MB of 10 MB",
      failed: "The update failed.\nCheck your connection, then try again.",
      badge: "Update 2.0.0",
    },
  }

  const browser = page.context().browser()

  for (const language of ["fr", "en"]) {
    const want = EXPECTED[language]
    const out = {}
    measures[language] = out
    const context = await browser.newContext({ viewport: { width: 1024, height: 700 } })
    const p = await context.newPage()
    const pageErrors = []
    const consoleErrors = []
    p.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 300)))
    p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)))
    await p.addInitScript((tag) => {
      Object.defineProperty(Navigator.prototype, "language", { get: () => tag, configurable: true })
    }, want.tag)
    const shot = (name) => p.screenshot({ path: `${shots}/${language}-${name}.png` })
    const settle = (ms = 500) => p.waitForTimeout(ms)

    await p.goto("http://localhost:4200/playlist")
    await p.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
    await p.bringToFront()
    const boot = await p.evaluate(() => {
      const root = ng.getInjector(document.querySelector("app-root"))
      const find = (suffix) => {
        for (const injector of ng["ɵgetInjectorResolutionPath"](root)) {
          let providers
          try {
            providers = ng["ɵgetInjectorProviders"](injector)
          } catch {
            continue
          }
          for (const record of Object.values(providers)) {
            const provided = Object.values(record).find((v) => typeof v === "function" && v.name.endsWith(suffix))
            if (provided) return injector.get(provided)
          }
        }
        return null
      }
      window.__svc = find("SidecarService")
      window.__upd = find("UpdateService")
      if (!window.__svc || !window.__upd) return { found: false }
      window.__svc._available.set(true)
      window.__svc.send = async () => undefined
      window.__svc.handleLine(JSON.stringify({ event: "version", version: "0.0.0-probe", api_key_configured: true }))
      const ui = window.__svc.versionMismatch().ui
      window.__svc.handleLine(JSON.stringify({ event: "version", version: ui, api_key_configured: true }))
      return { found: true, ui }
    })
    if (!boot.found) throw new Error("SidecarService ou UpdateService introuvable dans l'injecteur")
    await p.waitForSelector("p-tab")
    await settle(1500)

    // Hors Tauri : la verification du demarrage a leve, rien n'est propose.
    out.startup = await p.evaluate(() => ({
      kind: window.__upd.state().kind,
      dialog: !!document.querySelector(".p-dialog"),
      badge: !!document.querySelector("[data-update-badge]"),
    }))
    check(out.startup.kind === "none" && !out.startup.dialog && !out.startup.badge, `${language} demarrage hors Tauri : ${JSON.stringify(out.startup)}`)
    check(pageErrors.length === 0, `${language} erreur non geree au demarrage : ${pageErrors.join(" | ")}`)

    // Faux updater, ouverture du canal releve, fondus enregistres.
    await p.evaluate((page) => {
      window.__invoked = []
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          window.__invoked.push({ cmd, args })
          return null
        },
      }
      const offer = () => ({
        version: "2.0.0",
        currentVersion: "1.0.0",
        releasePage: page,
        downloadAndInstall: (onProgress) =>
          new Promise((resolve, reject) => {
            window.__dl = { onProgress, resolve, reject }
          }),
      })
      window.__upd.updater = { check: async () => offer() }
      window.__entered = []
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue
            // La premiere ouverture insere la modale entiere : son corps arrive dans le sous-arbre.
            const bodies = n.parentElement?.classList.contains("p-dialog-content") ? [n] : [...n.querySelectorAll(".p-dialog-content > *")]
            for (const b of bodies) {
              window.__entered.push({ tag: b.tagName.toLowerCase(), fade: b.classList.contains("animate-fadein") })
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true })
    }, RELEASE_PAGE)

    const dialog = () =>
      p.evaluate(() => {
        const d = document.querySelector(".p-dialog")
        if (!d) return null
        const content = d.querySelector(".p-dialog-content")
        const body = content?.firstElementChild
        const cs = (e) => (e ? getComputedStyle(e) : null)
        const probe = document.createElement("span")
        probe.className = "text-muted-color"
        document.body.append(probe)
        const muted = getComputedStyle(probe).color
        probe.remove()
        const h3 = d.querySelector(".p-dialog-header h3")
        const buttons = [...d.querySelectorAll(".p-dialog-footer button")].map((b) => ({
          action: b.dataset.action,
          text: b.textContent.trim(),
          classes: [...b.classList].filter((c) => c.startsWith("p-button")),
          disabled: b.disabled,
        }))
        const bodyRect = body?.getBoundingClientRect()
        const contentRect = content?.getBoundingClientRect()
        return {
          width: Math.round(d.getBoundingClientRect().width),
          title: h3?.textContent.trim() ?? null,
          titleFont: h3 ? `${cs(h3).fontSize}/${cs(h3).fontWeight}` : null,
          cross: !!d.querySelector(".p-dialog-close-button"),
          crossLabel: d.querySelector(".p-dialog-close-button")?.getAttribute("aria-label") ?? null,
          bodyTag: body?.tagName.toLowerCase() ?? null,
          bodyText: body?.textContent ?? null,
          bodyFont: cs(body)?.fontSize ?? null,
          bodyColor: cs(body)?.color ?? null,
          muted,
          whiteSpace: cs(body)?.whiteSpace ?? null,
          bodyPadBottom: cs(body)?.paddingBottom ?? null,
          bodyMarginBottom: cs(body)?.marginBottom ?? null,
          contentPadBottom: cs(content)?.paddingBottom ?? null,
          gapBelowBody: bodyRect && contentRect ? Math.round(contentRect.bottom - bodyRect.bottom) : null,
          notes: (() => {
            const n = d.querySelector('[data-action="notes"]')
            return n ? { text: n.textContent.trim(), classes: [...n.classList].filter((c) => c.startsWith("p-button")), icon: !!n.querySelector('[data-p-icon="external-link"], svg') } : null
          })(),
          buttons,
          progress: (() => {
            const bar = d.querySelector("app-phase-progress p-progressbar")
            return bar
              ? {
                  determinate: bar.classList.contains("p-progressbar-determinate"),
                  indeterminate: bar.classList.contains("p-progressbar-indeterminate"),
                  value: bar.getAttribute("aria-valuenow"),
                  counter: d.querySelector("app-phase-progress .tabular-nums")?.textContent.trim() ?? null,
                }
              : null
          })(),
          message: (() => {
            const m = d.querySelector("app-message .p-message")
            return m ? { error: m.classList.contains("p-message-error"), text: m.textContent, icon: !!m.querySelector("svg") } : null
          })(),
        }
      })
    const waitStable = () =>
      p
        .waitForFunction(() => {
          const d = document.querySelector(".p-dialog")
          return d && document.getAnimations().filter((a) => a.effect?.target && d.contains(a.effect.target)).length === 0
        }, null, { timeout: 4000 })
        .catch(() => undefined)
    const badge = () =>
      p.evaluate(() => {
        const b = document.querySelector("[data-update-badge]")
        if (!b) return null
        const tag = b.querySelector(".p-tag")
        const svg = tag?.querySelector("svg")
        const group = b.parentElement
        return {
          text: tag?.textContent.trim() ?? null,
          info: tag?.classList.contains("p-tag-info") ?? false,
          icon: svg?.getAttribute("data-p-icon") ?? svg?.closest("[data-icon]")?.getAttribute("data-icon") ?? null,
          iconSize: svg ? Math.round(svg.getBoundingClientRect().width) : null,
          label: b.getAttribute("aria-label"),
          type: b.getAttribute("type"),
          groupGap: getComputedStyle(group).columnGap,
          groupClasses: group.className,
          cursor: getComputedStyle(b).cursor,
        }
      })

    // 1. Mise a jour trouvee, ecran libre : la modale s'ouvre.
    await p.evaluate(() => window.__upd.check())
    await p.waitForSelector(".p-dialog", { timeout: 6000 })
    await waitStable()
    out.available = await dialog()
    const a = out.available
    check(a.width === 480, `${language} largeur : ${a.width}`)
    check(a.title === want.title && a.titleFont === "18px/600", `${language} titre : ${a.title} ${a.titleFont}`)
    check(a.cross && flat(a.crossLabel) === flat(want.later), `${language} croix : ${a.cross} ${a.crossLabel}`)
    check(a.bodyText?.includes(want.body.split("\n")[0]) && a.bodyText?.includes(want.body.split("\n")[1]), `${language} corps : ${flat(a.bodyText)}`)
    check(a.bodyFont === "14px" && a.bodyColor === a.muted && a.whiteSpace === "pre-line", `${language} corps style : ${a.bodyFont} ${a.bodyColor} ${a.muted} ${a.whiteSpace}`)
    check(a.notes?.text === want.notes && a.notes.classes.includes("p-button-link") && a.notes.icon, `${language} lien nouveautes : ${JSON.stringify(a.notes)}`)
    check(
      a.buttons.map((b) => b.action).join(",") === "later,install" &&
        a.buttons[0].classes.includes("p-button-text") &&
        a.buttons[0].classes.includes("p-button-secondary") &&
        a.buttons.every((b) => b.classes.includes("p-button-sm")) &&
        !a.buttons[1].classes.includes("p-button-secondary") &&
        !a.buttons[1].classes.includes("p-button-text") &&
        a.buttons[0].text === want.later &&
        a.buttons[1].text === want.install &&
        !a.buttons[1].disabled,
      `${language} pied : ${JSON.stringify(a.buttons)}`,
    )
    check(a.bodyPadBottom === "0px" && a.bodyMarginBottom === "0px" && a.gapBelowBody === parseFloat(a.contentPadBottom), `${language} marge basse disponible : ${a.bodyPadBottom} ${a.bodyMarginBottom} ${a.gapBelowBody} ${a.contentPadBottom}`)
    await shot("1-available")

    // 2. Lien des nouveautes.
    await p.click('[data-action="notes"]')
    await settle(300)
    out.opened = await p.evaluate(() => window.__invoked.filter((c) => c.cmd === "plugin:opener|open_url").map((c) => c.args?.url))
    check(out.opened.length === 1 && out.opened[0] === RELEASE_PAGE, `${language} nouveautes : ${JSON.stringify(out.opened)}`)

    // 3. « Plus tard » vers le badge, le badge rouvre.
    await p.click('[data-action="later"]')
    await settle(800)
    out.afterLater = { dialog: await p.evaluate(() => !!document.querySelector(".p-dialog")), badge: await badge() }
    const b = out.afterLater.badge
    check(!out.afterLater.dialog, `${language} « Plus tard » laisse la modale`)
    check(
      b && b.text === want.badge && b.info && b.iconSize === 16 && b.type === "button" && b.groupGap === "8px" && b.groupClasses.includes("gap-2"),
      `${language} badge : ${JSON.stringify(b)}`,
    )
    await shot("2-badge")
    await p.click("[data-update-badge]")
    await p.waitForSelector(".p-dialog", { timeout: 4000 })
    await waitStable()
    out.reopened = { dialog: true, badge: await p.evaluate(() => !!document.querySelector("[data-update-badge]")) }
    check(!out.reopened.badge, `${language} badge encore la apres reouverture`)

    // 4. La croix renvoie aussi au badge.
    await p.click(".p-dialog-close-button")
    await settle(800)
    out.afterCross = { dialog: await p.evaluate(() => !!document.querySelector(".p-dialog")), badge: !!(await badge()) }
    check(!out.afterCross.dialog && out.afterCross.badge, `${language} croix : ${JSON.stringify(out.afterCross)}`)

    // 5. Recherche en cours : badge, « Installer » grise avec sa raison sous le bouton.
    await p.evaluate(() => {
      window.__svc.startTagging("C:\\Musique\\Extraction")
      window.__svc.handleLine(JSON.stringify({ event: "run_started", run_id: "run-probe", folder: "C:\\Musique\\Extraction", tracks: [] }))
    })
    await settle(300)
    out.busyPhase = await p.evaluate(() => window.__svc.phase())
    await p.click("[data-update-badge]")
    await p.waitForSelector(".p-dialog", { timeout: 4000 })
    await waitStable()
    out.busy = await dialog()
    const install = out.busy.buttons.find((x) => x.action === "install")
    check(out.busyPhase === "searching" && install?.disabled, `${language} installer pendant la recherche : ${out.busyPhase} ${JSON.stringify(install)}`)
    const box = await p.locator('[data-action="install"]').boundingBox()
    await p.mouse.move(2, 2)
    await settle(200)
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await settle(900)
    out.busyTip = await p.evaluate(() => {
      const t = document.querySelector(".p-tooltip")
      const btn = document.querySelector('[data-action="install"]').getBoundingClientRect()
      if (!t) return null
      const r = t.getBoundingClientRect()
      return { text: t.textContent.trim(), below: Math.round(r.top - btn.bottom), cursor: getComputedStyle(document.querySelector('[data-action="install"]')).cursor }
    })
    check(out.busyTip && flat(out.busyTip.text) === flat(want.busy) && out.busyTip.below >= 0, `${language} tooltip installer : ${JSON.stringify(out.busyTip)}`)
    await shot("3-busy")
    await p.mouse.move(2, 2)
    await p.evaluate(() =>
      window.__svc.handleLine(
        JSON.stringify({ event: "run_finished", phase: "network", run_id: "run-probe", resolved: 0, unresolved: 0, written: 0, write_error: 0, awaiting_arbitration: 0 }),
      ),
    )
    await settle(500)
    out.idleInstall = await p.evaluate(() => ({ phase: window.__svc.phase(), disabled: document.querySelector('[data-action="install"]')?.disabled ?? null }))
    check(out.idleInstall.phase === "idle" && out.idleInstall.disabled === false, `${language} installer apres la recherche : ${JSON.stringify(out.idleInstall)}`)

    // 6. Telechargement, total connu : ni croix, ni bouton, Echap sans effet.
    await p.click('[data-action="install"]')
    await settle(200)
    await p.evaluate(() => window.__dl.onProgress({ received: 4_000_000, total: 10_000_000 }))
    await waitStable()
    await settle(300)
    out.downloading = await dialog()
    const d1 = out.downloading
    check(!d1.cross && d1.buttons.length === 0, `${language} telechargement, croix ou boutons : ${d1.cross} ${JSON.stringify(d1.buttons)}`)
    check(d1.progress?.determinate && d1.progress.value === "40" && flat(d1.progress.counter) === flat(want.counter), `${language} progression connue : ${JSON.stringify(d1.progress)}`)
    check(d1.bodyPadBottom === "0px" && d1.bodyMarginBottom === "0px" && d1.gapBelowBody === parseFloat(d1.contentPadBottom), `${language} marge basse telechargement : ${d1.bodyPadBottom} ${d1.gapBelowBody} ${d1.contentPadBottom}`)
    await p.keyboard.press("Escape")
    await settle(500)
    out.escapeKeeps = await p.evaluate(() => !!document.querySelector(".p-dialog") && window.__upd.state().kind === "downloading")
    check(out.escapeKeeps, `${language} Echap a ferme le telechargement`)
    await shot("4-downloading-known")

    // 7. Total inconnu : barre indeterminee, aucun compteur.
    await p.evaluate(() => window.__dl.onProgress({ received: 4_000_000, total: null }))
    await settle(300)
    out.unknown = (await dialog()).progress
    check(out.unknown?.indeterminate && out.unknown.counter === null, `${language} progression inconnue : ${JSON.stringify(out.unknown)}`)
    await shot("5-downloading-unknown")

    // 8. Echec : message d'erreur, « Plus tard » et « Reessayer », croix revenue.
    await p.evaluate(() => window.__dl.reject(new Error("signature")))
    await p.waitForSelector(".p-dialog app-message", { timeout: 4000 })
    await waitStable()
    out.failed = await dialog()
    const f = out.failed
    check(f.message?.error && f.message.icon && flat(f.message.text) === flat(want.failed), `${language} message d'echec : ${JSON.stringify(f.message)}`)
    check(
      f.cross && f.buttons.map((x) => x.action).join(",") === "later,install" && f.buttons[1].text === want.retry && f.buttons[0].text === want.later,
      `${language} pied d'echec : ${f.cross} ${JSON.stringify(f.buttons)}`,
    )
    check(f.bodyPadBottom === "0px" && f.bodyMarginBottom === "0px" && f.gapBelowBody === parseFloat(f.contentPadBottom), `${language} marge basse echec : ${f.bodyPadBottom} ${f.gapBelowBody} ${f.contentPadBottom}`)
    await shot("6-failed")

    // 9. « Reessayer » repasse en telechargement.
    await p.click('[data-action="install"]')
    await settle(500)
    out.retry = await p.evaluate(() => window.__upd.state().kind)
    check(out.retry === "downloading", `${language} reessayer : ${out.retry}`)

    // Fondu de chaque corps : disponible, telechargement, echec, puis telechargement.
    out.entered = await p.evaluate(() => window.__entered)
    const bodies = out.entered.filter((e) => e.tag !== "ng-template")
    check(bodies.length >= 4 && bodies.every((e) => e.fade), `${language} fondus : ${JSON.stringify(out.entered)}`)

    out.pageErrors = pageErrors
    out.consoleErrors = consoleErrors
    check(pageErrors.length === 0, `${language} erreurs non gerees : ${pageErrors.join(" | ")}`)
    await context.close()
  }

  return { failures, measures }
}
