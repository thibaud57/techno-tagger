// Habillage du shell et gestes de fond sous `ng serve`, FR puis EN a 1024 x 700, sidecar simule sur
// l'instance du service : fond de page (`bg-surface-950`), ecran bloquant (`missing` puis
// `versionMismatch`), entree active du menu des Reglages (`bg-highlight`) et survol d'une autre,
// « Vider le cache » (`cacheClearing` : grise, spinner, un seul `clear_cache` sur un double clic, reprise
// a `cache_cleared` et au refus), mouvement reduit sur une modale PrimeNG (entree, sortie, retrait du DOM)
// avec et sans la preference, spinner et squelettes qui tournent toujours, `title` du chevron du detail,
// page Tagging (enfants directement dans l'hote, aucune marge sous la liste, aucun defilement).
// Lance par `run_page.mjs`, `just dev-ui` servant :4200 ; `SHOTS_DIR` designe le dossier des captures.
async (page) => {
  const failures = []
  const measures = {}
  const shots = process.env.SHOTS_DIR ?? ".playwright-mcp/verify-shell"
  const check = (ok, message) => {
    if (!ok) failures.push(message)
  }
  const browser = page.context().browser()
  const FOLDER = "C:\\Musique\\Extraction"
  // Tailwind 4 rend ses couleurs en `color(srgb r g b)` (0..1) : ramene a `rgb(r, g, b)` pour comparer aux tokens
  const rgb = (s) => {
    const m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(s)
    return m ? `rgb(${m.slice(1, 4).map((v) => Math.round(Number(v) * 255)).join(", ")})` : s
  }
  const flat = (text) => String(text).replace(/[\u00a0\u202f]/g, " ").replace(/[ \t\r\n]+/g, " ").trim()

  const track = (id, artist, title) => ({
    track_id: `${id}.mp3`,
    file_name: `${id}.mp3`,
    artist,
    title,
    tags_before: { system: "id3", comment: null, fields: [] },
  })
  const T = [track("01 jane doe - first", "Jane Doe", "First"), track("02 john roe - second", "John Roe", "Second"), track("03 ann lee - third", "Ann Lee", "Third")]
  const resolved = (t) => ({
    event: "track_resolved", track_id: t.track_id, state: "resolved", resolution: "auto", failure_reason: null, source: "beatport",
    after: { artist: t.artist, title: `${t.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 }, artwork_path: null, tags_after: [], restorable: false,
  })
  const version = (ui, sidecar) =>
    JSON.stringify({ event: "version", version: sidecar ?? ui, api_key_configured: true, default_thresholds: { floor: 70, ceiling: 90 }, log_file: "C:/Users/Jane Doe/logs/tagger.log" })

  /** Ouvre une page neuve dans la langue et la preference de mouvement voulues ; le service est resolu, `send` releve. */
  const open = async (language, { reduced = false, path = "/settings" } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 700 }, reducedMotion: reduced ? "reduce" : "no-preference" })
    const p = await context.newPage()
    await p.addInitScript((tag) => {
      Object.defineProperty(Navigator.prototype, "language", { get: () => tag, configurable: true })
    }, language === "fr" ? "fr-FR" : "en-US")
    await p.goto(`http://localhost:4200${path}`)
    await p.waitForFunction(() => typeof ng !== "undefined" && document.querySelector("app-root")?.children.length > 0)
    await p.bringToFront()
    await p.evaluate(() => {
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
    })
    return { context, p }
  }
  /** Leve l'ecran bloquant : le moteur repond, a la version de l'interface. */
  const unblock = async (p) => {
    await p.evaluate((mk) => {
      window.__svc._available.set(true)
      window.__svc.send = async (command) => {
        window.__sent.push(command)
      }
      window.__svc.handleLine(mk)
    }, version("0.0.0"))
    // `versionMismatch().ui` n'existe que tant que les versions different : on la relit puis on aligne
    await p.evaluate(() => {
      const ui = window.__svc.versionMismatch()?.ui
      if (ui) {
        window.__svc.handleLine(JSON.stringify({ event: "version", version: ui, api_key_configured: true, default_thresholds: { floor: 70, ceiling: 90 }, log_file: "C:/Users/Jane Doe/logs/tagger.log" }))
      }
    })
    await p.waitForSelector("p-tabs")
    await p.waitForTimeout(400)
  }
  const line = (p, event) => p.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)

  // Premier plan opaque derriere un point : le fond que la personne voit
  const backdrop = (p, x, y) =>
    p.evaluate(([px, py]) => {
      let el = document.elementFromPoint(px, py)
      while (el) {
        const bg = getComputedStyle(el).backgroundColor
        if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return { tag: el.tagName.toLowerCase(), bg }
        el = el.parentElement
      }
      return { tag: null, bg: "transparent" }
    }, [x, y])

  for (const language of ["fr", "en"]) {
    const out = {}
    measures[language] = out

    // ---- Points 1 et 5 : ecran bloquant, tel que le produit `ng serve` (moteur absent)
    {
      const { context, p } = await open(language)
      await p.waitForSelector("app-root p-card", { timeout: 8000 })
      await p.waitForTimeout(700)
      const card = () =>
        p.evaluate(() => {
          const n = (x) => Math.round(x * 10) / 10
          const host = document.querySelector("app-root p-card")
          const box = host.getBoundingClientRect()
          const column = host.querySelector(".p-card-body .flex.flex-col.gap-4, .flex.flex-col.gap-4")
          const texts = column.querySelector(".flex.flex-col.gap-2")
          const title = texts.children[0]
          const text = texts.children[1]
          const wrapper = column.querySelector(".flex.justify-end")
          const button = wrapper?.querySelector("button")
          const muted = (() => {
            const probe = document.createElement("span")
            probe.className = "text-muted-color"
            document.body.append(probe)
            const color = getComputedStyle(probe).color
            probe.remove()
            return color
          })()
          const t = title.getBoundingClientRect()
          const x = text.getBoundingClientRect()
          const c = column.getBoundingClientRect()
          const w = wrapper?.getBoundingClientRect()
          return {
            cardWidth: n(box.width),
            cardClass: host.className,
            bodyBg: getComputedStyle(document.querySelector("app-root")).backgroundColor,
            align: [getComputedStyle(title).textAlign, getComputedStyle(text).textAlign],
            title: { text: title.textContent.trim(), font: getComputedStyle(title).fontSize, weight: getComputedStyle(title).fontWeight },
            text: { font: getComputedStyle(text).fontSize, muted: getComputedStyle(text).color === muted, whiteSpace: getComputedStyle(text).whiteSpace, hasNewline: text.textContent.includes("\n"), lines: new Set([...(() => { const r = document.createRange(); r.selectNodeContents(text); return [...r.getClientRects()].map((q) => Math.round(q.top)) })()]).size },
            titleToText: n(x.top - t.bottom),
            textToButton: w ? n(w.top - texts.getBoundingClientRect().bottom) : null,
            button: button ? { text: button.textContent.trim(), classes: [...button.classList].filter((c) => /^p-button/.test(c)).join(" "), rightToColumn: n(c.right - button.getBoundingClientRect().right), justify: getComputedStyle(wrapper).justifyContent } : null,
            cardCenterX: n(box.left + box.width / 2),
            tabs: document.querySelectorAll("p-tab").length,
          }
        })
      out.blockedMissing = await card()
      out.blockedMissing.rootBackground = (await backdrop(p, 30, 600)).bg
      await p.screenshot({ path: `${shots}/${language}-1-blocked-missing.png` })
      const m = out.blockedMissing
      check(m.cardWidth === 480 && /w-120/.test(m.cardClass), `${language} bloquant : carte ${m.cardWidth}px (${m.cardClass})`)
      check(m.align.every((a) => a === "start" || a === "left"), `${language} bloquant : texte aligne ${m.align}`)
      check(m.title.font === "18px" && m.title.weight === "600", `${language} bloquant : titre ${m.title.font}/${m.title.weight}`)
      check(m.text.font === "14px" && m.text.muted && m.text.whiteSpace === "pre-line" && m.text.hasNewline, `${language} bloquant : texte ${JSON.stringify(m.text)}`)
      check(m.titleToText === 8 && m.textToButton === 16, `${language} bloquant : ecarts ${m.titleToText} puis ${m.textToButton}`)
      check(m.button && m.button.classes.includes("p-button-sm") && m.button.classes.includes("p-button-outlined") && m.button.classes.includes("p-button-secondary") && m.button.justify === "flex-end" && m.button.rightToColumn === 0, `${language} bloquant : bouton ${JSON.stringify(m.button)}`)
      check(rgb(m.bodyBg) === "rgb(9, 9, 11)" && rgb(m.rootBackground) === "rgb(9, 9, 11)" && m.tabs === 0, `${language} fond de l'ecran bloquant : hote ${m.bodyBg}, derriere un point ${m.rootBackground}`)
      // Version divergente : meme anatomie, aucun bouton
      await p.evaluate(() => {
        window.__svc._available.set(true)
        window.__svc.handleLine(JSON.stringify({ event: "version", version: "0.0.1", api_key_configured: true, default_thresholds: { floor: 70, ceiling: 90 }, log_file: null }))
      })
      await p.waitForTimeout(700)
      out.blockedMismatch = await card().catch((e) => ({ error: String(e).slice(0, 200) }))
      await p.screenshot({ path: `${shots}/${language}-2-blocked-version.png` })
      const v = out.blockedMismatch
      check(!v.error && v.cardWidth === 480 && v.title.font === "18px" && v.text.whiteSpace === "pre-line" && v.titleToText === 8, `${language} version divergente : ${JSON.stringify(v).slice(0, 400)}`)
      await context.close()
    }

    // ---- Points 1 et 2 : fond sous la barre d'onglets, menu des Reglages
    {
      const { context, p } = await open(language)
      await unblock(p)
      out.pageBackground = {
        root: await p.evaluate(() => getComputedStyle(document.querySelector("app-root")).backgroundColor),
        body: await p.evaluate(() => getComputedStyle(document.body).backgroundColor),
        underTabs: await backdrop(p, 900, 660),
        tabBarEmptyArea: await backdrop(p, 700, 24),
      }
      check(rgb(out.pageBackground.root) === "rgb(9, 9, 11)" && rgb(out.pageBackground.underTabs.bg) === "rgb(9, 9, 11)", `${language} fond de page : ${JSON.stringify(out.pageBackground)}`)
      await p.locator("app-settings-page p-menu .p-menu-item-content").nth(1).click()
      await p.waitForTimeout(400)
      await p.mouse.move(2, 690)
      await p.waitForTimeout(300)
      const menu = () =>
        p.evaluate(() =>
          [...document.querySelectorAll("app-settings-page p-menu .p-menu-item")].map((item) => {
            const content = item.querySelector(".p-menu-item-content")
            return {
              label: item.textContent.trim(),
              highlight: content.classList.contains("bg-highlight"),
              emphasis: content.classList.contains("bg-emphasis"),
              bg: getComputedStyle(content).backgroundColor,
              current: item.querySelector("a")?.getAttribute("aria-current") ?? null,
            }
          }),
        )
      out.menuRest = await menu()
      const active = out.menuRest.filter((i) => i.highlight)
      const rgba = (s) => (s.match(/[\d.]+/g) ?? []).map(Number)
      check(active.length === 1 && active[0].label === "Matching" && !out.menuRest.some((i) => i.emphasis), `${language} menu : entree active ${JSON.stringify(active)}`)
      const [r, g, b, a] = rgba(active[0].bg)
      check(g > r && g > b && a !== undefined && Math.abs(a - 0.16) < 0.02, `${language} menu : fond de l'entree active ${active[0].bg}`)
      check(out.menuRest.filter((i) => i.current === "page").map((i) => i.label).join() === "Matching", `${language} menu : aria-current ${JSON.stringify(out.menuRest.map((i) => i.current))}`)
      const hoverBox = await p.locator("app-settings-page p-menu .p-menu-item-content").nth(3).boundingBox()
      await p.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2)
      await p.waitForTimeout(500)
      out.menuHover = await menu()
      const hovered = out.menuHover.find((i) => i.label === "Administration")
      const [hr, hg, hb] = rgba(hovered.bg)
      check(!hovered.highlight && Math.abs(hr - hg) <= 3 && Math.abs(hg - hb) <= 6 && hovered.bg !== "rgba(0, 0, 0, 0)", `${language} menu : survol d'Administration ${hovered.bg} (gris attendu, sans teinte)`)
      check(out.menuHover.find((i) => i.label === "Matching").highlight && out.menuHover.find((i) => i.label === "Matching").bg === active[0].bg, `${language} menu : l'entree active garde son fond au survol d'une autre`)
      await p.screenshot({ path: `${shots}/${language}-3-menu-highlight-hover.png` })
      await context.close()
    }

    // ---- Point 4 : « Vider le cache », un seul envoi, spinner, reprise
    {
      const { context, p } = await open(language)
      await unblock(p)
      await line(p, { event: "cache_size", size_bytes: 3_200_000 })
      await p.locator("app-settings-page p-menu .p-menu-item-content").nth(3).click()
      await p.waitForSelector('[data-action="clear-cache"]')
      await p.waitForTimeout(500)
      const state = () =>
        p.evaluate(() => {
          const b = document.querySelector('[data-action="clear-cache"]')
          return {
            clearing: window.__svc.cacheClearing(),
            disabled: b.disabled,
            icon: b.querySelector("svg")?.getAttribute("data-p-icon"),
            sent: window.__sent.filter((c) => c.command === "clear_cache").length,
          }
        })
      out.cacheIdle = await state()
      check(out.cacheIdle.clearing === false && out.cacheIdle.disabled === false && out.cacheIdle.icon === "trash", `${language} cache au repos : ${JSON.stringify(out.cacheIdle)}`)
      await p.locator('[data-action="clear-cache"]').dblclick({ delay: 30 })
      await p.waitForTimeout(400)
      out.cacheBusy = await state()
      check(out.cacheBusy.clearing && out.cacheBusy.disabled && out.cacheBusy.icon === "spinner" && out.cacheBusy.sent === 1, `${language} double clic : ${JSON.stringify(out.cacheBusy)}`)
      await p.screenshot({ path: `${shots}/${language}-4-cache-clearing.png` })
      await line(p, { event: "cache_cleared", freed_bytes: 3_200_000, size_bytes: 0 })
      await p.waitForTimeout(400)
      out.cacheDone = await state()
      check(!out.cacheDone.clearing && !out.cacheDone.disabled && out.cacheDone.icon === "trash" && out.cacheDone.sent === 1, `${language} apres cache_cleared : ${JSON.stringify(out.cacheDone)}`)
      await p.locator('[data-action="clear-cache"]').click()
      await p.waitForTimeout(300)
      out.cacheSecond = await state()
      check(out.cacheSecond.clearing && out.cacheSecond.sent === 2 && out.cacheSecond.icon === "spinner", `${language} second vidage : ${JSON.stringify(out.cacheSecond)}`)
      await line(p, { event: "error", code: "phase_busy", params: { phase: "tagging" }, message: "busy", command: "clear_cache" })
      await p.waitForTimeout(400)
      out.cacheRefused = await state()
      check(!out.cacheRefused.clearing && !out.cacheRefused.disabled && out.cacheRefused.icon === "trash", `${language} apres le refus : ${JSON.stringify(out.cacheRefused)}`)
      await context.close()
    }

    // ---- Points 7 et 8 : page Tagging, chevron du detail
    {
      const { context, p } = await open(language, { path: "/tagging" })
      await unblock(p)
      await p.evaluate(async (folder) => {
        window.__svc.send = async (command) => {
          window.__sent.push(command)
        }
        await window.__svc.startTagging(folder)
      }, FOLDER)
      await line(p, { event: "run_started", run_id: "run-1", folder: FOLDER, tracks: T })
      for (const t of T) await line(p, resolved(t))
      await line(p, { event: "progress", phase: "tagging", processed: 3, total: 3 })
      await line(p, { event: "run_finished", phase: "network", run_id: "run-1", resolved: 3, unresolved: 0, written: 0, write_error: 0, awaiting_arbitration: 0 })
      await p.waitForSelector("[data-row-toggle]")
      await p.waitForTimeout(600)
      out.chevron = await p.evaluate(() => {
        const b = document.querySelector("[data-row-toggle]")
        return { title: b.getAttribute("title"), aria: b.getAttribute("aria-label"), all: [...document.querySelectorAll("[data-row-toggle]")].map((x) => x.getAttribute("title")) }
      })
      const wantTitle = language === "fr" ? "Afficher le détail" : "Show details"
      check(out.chevron.title === wantTitle && out.chevron.aria === wantTitle && out.chevron.all.every((t) => t === wantTitle), `${language} chevron : ${JSON.stringify(out.chevron)}`)
      out.tagging = await p.evaluate(() => {
        const n = (x) => Math.round(x * 10) / 10
        const main = document.querySelector("main")
        const host = document.querySelector("main > app-tagging-page")
        const cs = getComputedStyle(host)
        const kids = [...host.children].map((el) => {
          const r = el.getBoundingClientRect()
          return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 36), display: getComputedStyle(el).display, top: n(r.top), height: n(r.height) }
        })
        const visible = kids.filter((k) => k.display !== "contents" && k.height > 0)
        const last = visible.at(-1)
        const mainInner = main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom)
        return {
          hostClass: host.className,
          hostDisplay: cs.display,
          rowGap: cs.rowGap,
          kids,
          h1Top: n(document.querySelector("app-tagging-page > h1").getBoundingClientRect().top - main.getBoundingClientRect().top),
          gaps: visible.slice(1).map((k, i) => n(k.top - (visible[i].top + visible[i].height))),
          belowList: last ? n(mainInner - (last.top + last.height)) : null,
          directGrid: host.querySelector(":scope > div.grid") !== null,
          innerContainer: host.querySelector(":scope > div.h-full") !== null,
          scroll: { page: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight, main: main.scrollHeight > main.clientHeight, host: host.scrollHeight > host.clientHeight + 1 },
        }
      })
      const g = out.tagging
      check(g.directGrid && !g.innerContainer && g.kids[0].tag === "h1", `${language} tagging : structure ${JSON.stringify(g.kids.map((k) => k.tag + "." + k.cls))}`)
      check(g.gaps.every((x) => x === 24) && g.rowGap === "24px", `${language} tagging : ecarts entre enfants ${g.gaps}, gap ${g.rowGap}`)
      check(g.belowList === 0, `${language} tagging : ${g.belowList}px sous la liste`)
      check(!g.scroll.page && !g.scroll.main && !g.scroll.host, `${language} tagging : defilement ${JSON.stringify(g.scroll)}`)
      await p.screenshot({ path: `${shots}/${language}-5-tagging.png` })
      await context.close()
    }
  }

  // ---- Point 6 : mouvement reduit sur une modale PrimeNG, avec puis sans la preference (francais)
  for (const reduced of [true, false]) {
    const key = reduced ? "reduced" : "normal"
    const { context, p } = await open("fr", { reduced })
    await unblock(p)
    await line(p, { event: "rollback_target", run: { run_id: "a3f9c1", written_at: "2026-10-06T14:30:00Z", folder: "D:\\Music\\Promo Octobre", tracks: 87 } })
    await p.locator("app-settings-page p-menu .p-menu-item-content").nth(3).click()
    await p.waitForSelector('[data-action="restore-last"]:not([disabled])')
    await p.waitForTimeout(400)
    const media = await p.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
    // Echantillonne toutes les 16 ms ce que PrimeNG pose sur la modale pendant son entree et sa sortie
    await p.evaluate(() => {
      window.__motion = { samples: [], removedAt: null, started: performance.now() }
      const read = () => {
        const nodes = [...document.querySelectorAll('.p-dialog, .p-dialog-mask, .p-confirmdialog, [class*="-enter-active"], [class*="-leave-active"]')]
        for (const el of nodes) {
          const cs = getComputedStyle(el)
          const cls = String(el.className)
          window.__motion.samples.push({
            t: Math.round(performance.now() - window.__motion.started),
            cls: cls.split(/\s+/).filter((c) => /enter|leave|dialog|mask/.test(c)).join(" ").slice(0, 80),
            animation: cs.animationName,
            animationDuration: cs.animationDuration,
            transitionDuration: cs.transitionDuration,
            transitionProperty: cs.transitionProperty,
            phase: /enter-active/.test(cls) ? "enter" : /leave-active/.test(cls) ? "leave" : "rest",
          })
        }
      }
      window.__motionTimer = setInterval(read, 16)
    })
    await p.locator('[data-action="restore-last"]').click()
    await p.waitForSelector(".p-confirmdialog", { timeout: 3000 })
    await p.waitForTimeout(700)
    await p.screenshot({ path: `${shots}/fr-6-modal-open-${key}.png` })
    await p.evaluate(() => {
      window.__motion.closeAt = performance.now()
    })
    await p.locator(".p-confirmdialog .p-dialog-footer button", { hasText: /Annuler/ }).first().click()
    const removed = await p
      .waitForFunction(() => document.querySelector(".p-confirmdialog .p-dialog, .p-confirmdialog") === null || !document.querySelector(".p-confirmdialog .p-dialog"), null, { timeout: 4000 })
      .then(() => true, () => false)
    await p.waitForTimeout(500)
    const motion = await p.evaluate(() => {
      clearInterval(window.__motionTimer)
      const s = window.__motion.samples
      const parse = (v) => Math.max(0, ...String(v).split(",").map((x) => parseFloat(x) * (x.includes("ms") ? 1 : 1000)))
      const animated = s.filter((x) => x.animation !== "none")
      return {
        samples: s.length,
        phases: [...new Set(s.map((x) => x.phase))],
        enterSamples: s.filter((x) => x.phase === "enter").length,
        leaveSamples: s.filter((x) => x.phase === "leave").length,
        animationNames: [...new Set(animated.map((x) => x.animation))],
        maxAnimationMs: Math.round(Math.max(0, ...s.map((x) => parse(x.animationDuration)))),
        maxTransitionMs: Math.round(Math.max(0, ...s.map((x) => parse(x.transitionDuration)))),
        animatedWhileEntering: animated.filter((x) => x.phase === "enter").length,
        animatedWhileLeaving: animated.filter((x) => x.phase === "leave").length,
        classes: [...new Set(s.map((x) => x.cls))].slice(0, 8),
        sampleEnter: s.find((x) => x.phase === "enter") ?? null,
        sampleLeave: s.find((x) => x.phase === "leave") ?? null,
        dialogLeft: document.querySelectorAll(".p-dialog").length,
      }
    })
    measures[`motion_${key}`] = { media, removed, ...motion }
    if (reduced) {
      check(media === true, `mouvement reduit : la preference n'est pas emulee (${media})`)
      check(motion.animatedWhileEntering === 0 && motion.animatedWhileLeaving === 0 && motion.maxAnimationMs === 0, `mouvement reduit : animation encore posee ${JSON.stringify({ names: motion.animationNames, max: motion.maxAnimationMs, enter: motion.animatedWhileEntering, leave: motion.animatedWhileLeaving })}`)
      check(motion.maxTransitionMs === 0, `mouvement reduit : transition de ${motion.maxTransitionMs}ms`)
    } else {
      check(media === false, `sans preference : emulee quand meme (${media})`)
      check(motion.maxAnimationMs >= 200 || motion.maxTransitionMs >= 200, `sans preference : plus de fondu (animation ${motion.maxAnimationMs}ms, transition ${motion.maxTransitionMs}ms)`)
    }
    check(removed && motion.dialogLeft === 0, `${key} : la modale reste dans le DOM apres sa fermeture (retiree=${removed}, restantes=${motion.dialogLeft})`)

    // Spinner et squelettes : tournent toujours, preference ou pas
    await p.locator("app-settings-page p-menu .p-menu-item-content").nth(3).click().catch(() => undefined)
    await p.evaluate(() => {
      window.__sent = []
    })
    await p.locator('[data-action="clear-cache"]').click()
    await p.waitForTimeout(300)
    const spinner = await p.evaluate(() => {
      const svg = document.querySelector('[data-action="clear-cache"] svg[data-p-icon="spinner"]')
      if (!svg) return null
      const cs = getComputedStyle(svg)
      const inner = svg.querySelector("*")
      return { name: cs.animationName, duration: cs.animationDuration, iteration: cs.animationIterationCount, svgClass: String(svg.getAttribute("class")).slice(0, 60), inner: inner ? getComputedStyle(inner).animationName : null }
    })
    measures[`motion_${key}`].spinner = spinner
    check(spinner !== null && spinner.name !== "none", `${key} : le spinner du bouton ne tourne pas ${JSON.stringify(spinner)}`)
    await line(p, { event: "cache_cleared", freed_bytes: 0, size_bytes: 0 })
    // Squelettes : une ligne de la liste Tagging tant que la pochette attend
    await p.evaluate(() => document.querySelectorAll("p-tab")[1].click())
    await p.waitForSelector("app-tagging-page")
    await p.evaluate(async (folder) => {
      await window.__svc.startTagging(folder)
    }, FOLDER)
    await line(p, { event: "run_started", run_id: "run-2", folder: FOLDER, tracks: T })
    await p.waitForSelector("p-skeleton", { timeout: 4000 }).catch(() => undefined)
    await p.waitForTimeout(400)
    const skeleton = await p.evaluate(() => {
      const el = document.querySelector("app-run-list p-skeleton, app-run-list .p-skeleton")
      if (!el) return null
      const own = getComputedStyle(el)
      const after = getComputedStyle(el, "::after")
      return { own: own.animationName, after: after.animationName, afterDuration: after.animationDuration, count: document.querySelectorAll("app-run-list p-skeleton").length }
    })
    measures[`motion_${key}`].skeleton = skeleton
    check(skeleton !== null && (skeleton.after !== "none" || skeleton.own !== "none"), `${key} : le squelette ne tourne pas ${JSON.stringify(skeleton)}`)
    await context.close()
  }

  return { failures, measures }
}
