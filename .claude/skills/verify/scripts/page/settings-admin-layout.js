// Section Administration des Reglages (rangees Cache et Logs) sous `ng serve`, sidecar simule sur
// l'instance du service, FR puis EN a 1024 x 700 (plancher), un contexte de navigateur par langue :
// quatre rangees dans l'ordre, mise en page des rangees Cache et Logs, taille du cache, toast de
// vidage (une ligne puis deux), aucun contexte audio, etats grises du bouton Cache et leur tooltip
// (`phase`, run non ecrit, run perdu avec le moteur, run ecrit), refus du sidecar sous la rangee,
// bouton Logs grise tant que `logFile` est nul, `revealItemInDir` reussi puis rejete (message sous la
// rangee, ecarts egaux au-dessus et en dessous). Le vrai Explorateur, le vrai vidage et la
// persistance se prouvent dans la fenetre (`page/settings-admin.js`). Lance par `run_page.mjs`,
// `just dev-ui` servant :4200 ; `SHOTS_DIR` designe le dossier des captures (scratchpad).
async (page) => {
  const failures = []
  const measures = {}
  const shots = process.env.SHOTS_DIR ?? ".playwright-mcp/verify-settings-admin"
  const check = (ok, message) => {
    if (!ok) failures.push(message)
  }
  const flat = (text) => String(text).replace(/[\u00a0\u202f]/g, " ").replace(/[ \t\r\n]+/g, " ").trim()
  const FOLDER = "C:\\Musique\\Extraction"
  const LOG_FILE = "C:/Users/Jane Doe/AppData/Local/fr.example.app/logs/tagger.log"
  const CACHE_BYTES = 3_200_000

  const EXPECTED = {
    fr: {
      tag: "fr-FR",
      labels: ["Cache", "Logs", "Restauration", "Runs passés", "Version"],
      version: {
        action: "Rechercher une mise à jour",
        hint: /^Version \S+ installée\.$/,
        failed: "Vérification impossible.\nVérifiez votre connexion, puis réessayez.",
      },
      cache: {
        action: "Vider le cache",
        hint: "Réponses de l'API et pochettes déjà téléchargées.\nLe vider ne touche à aucun fichier de musique : les prochains runs les retéléchargent.",
        size: "3,2 Mo",
        freed: "3,2 Mo libérés.",
        partial: "1,7 Mo libérés.\n1,5 Mo restent, utilisés par un autre programme.",
        summary: "Cache vidé",
        busy: "Une opération est en cours.\nAttendez sa fin.",
        unwritten: "Le run affiché attend l'écriture de ses tags.\nTerminez-la avant de vider le cache.",
        phaseBusy: "Une recherche est en cours.\nAttendez sa fin.",
        notWritten: "Le run affiché attend l'écriture de ses tags.\nTerminez-la avant de vider le cache.",
      },
      logs: {
        action: "Ouvrir le dossier des logs",
        hint: "Pour signaler un problème, joignez le fichier sélectionné à votre message.",
        starting: "Le moteur de l'application démarre.\nPatientez un instant.",
        unavailable: "Le fichier de logs est introuvable.\nRelancez l'application pour le recréer.",
      },
    },
    en: {
      tag: "en-US",
      labels: ["Cache", "Logs", "Restore", "Past runs", "Version"],
      version: {
        action: "Check for updates",
        hint: /^Version \S+ installed\.$/,
        failed: "Check failed.\nCheck your connection, then try again.",
      },
      cache: {
        action: "Clear the cache",
        hint: "API responses and artwork already downloaded.\nClearing it touches no music file: the next runs download them again.",
        size: "3.2 MB",
        freed: "3.2 MB freed.",
        partial: "1.7 MB freed.\n1.5 MB left, used by another program.",
        summary: "Cache cleared",
        busy: "An operation is in progress.\nWait for it to finish.",
        unwritten: "The run on screen is waiting for its tags to be written.\nFinish writing before clearing the cache.",
        phaseBusy: null,
        notWritten: "The run on screen is waiting for its tags to be written.\nFinish writing before clearing the cache.",
      },
      logs: {
        action: "Open the logs folder",
        hint: "To report a problem, attach the selected file to your message.",
        starting: "The application engine is starting.\nWait a moment.",
        unavailable: "The log file cannot be found.\nRestart the application to create it again.",
      },
    },
  }

  const track = (id, artist, title) => ({
    track_id: `${id}.mp3`,
    file_name: `${id}.mp3`,
    artist,
    title,
    tags_before: { system: "id3", comment: null, fields: [] },
  })
  const T1 = track("01 jane doe - first", "Jane Doe", "First")
  const T2 = track("02 john roe - second", "John Roe", "Second")
  const resolved = (t, state = "resolved") => ({
    event: "track_resolved",
    track_id: t.track_id,
    state,
    resolution: "auto",
    failure_reason: state === "write_error" ? "file_locked" : null,
    source: "beatport",
    after: { artist: t.artist, title: `${t.title} (Original Mix)` },
    scores: { artist: 98, title: 95, average: 96 },
    artwork_path: null,
    tags_after: [],
    restorable: state === "written" || state === "write_error",
  })
  const finished = (runId, phase, counts) => ({
    event: "run_finished",
    phase,
    run_id: runId,
    resolved: 0,
    unresolved: 0,
    written: 0,
    write_error: 0,
    awaiting_arbitration: 0,
    ...counts,
  })

  const browser = page.context().browser()

  for (const language of ["fr", "en"]) {
    const want = EXPECTED[language]
    const out = {}
    measures[language] = out
    const context = await browser.newContext({ viewport: { width: 1024, height: 700 } })
    const p = await context.newPage()
    const consoleErrors = []
    p.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 300)))
    await p.addInitScript((tag) => {
      Object.defineProperty(Navigator.prototype, "language", { get: () => tag, configurable: true })
      // Compte les contextes audio : un vidage de cache ne fait pas de bruit.
      window.__audio = 0
      const Original = window.AudioContext
      if (Original) {
        window.AudioContext = class extends Original {
          constructor(...args) {
            super(...args)
            window.__audio += 1
          }
        }
      }
    }, want.tag)
    const shot = (name) => p.screenshot({ path: `${shots}/${language}-${name}.png` })
    const line = (event) => p.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
    const settle = (ms = 400) => p.waitForTimeout(ms)
    const sent = () => p.evaluate(() => window.__sent.map((c) => c.command))

    await p.goto("http://localhost:4200/settings")
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
      window.__svc._available.set(true)
      window.__svc.send = async (command) => {
        window.__sent.push(command)
      }
    })
    // Moteur disponible mais muet : aucun `version`, donc aucun `logFile`
    await p.waitForSelector("app-settings-page p-menu .p-menu-item")
    await p.locator("app-settings-page p-menu .p-menu-item-content").nth(3).click()
    await p.waitForSelector('[data-action="clear-cache"]')
    await settle(600)

    /** Etat d'un bouton `pButton` : classes de severite, icone, desactive. */
    const button = (selector) =>
      p.evaluate((css) => {
        const b = document.querySelector(css)
        if (!b) return null
        const classes = [...b.classList].filter((c) => /^p-button-/.test(c))
        const svg = b.querySelector("svg")
        const range = document.createRange()
        range.selectNodeContents(b)
        const texts = [...b.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim() !== "")
        const labelLeft = texts.length > 0 ? (range.selectNodeContents(texts[0]), range.getBoundingClientRect().left) : null
        return {
          text: b.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
          disabled: b.disabled,
          small: classes.includes("p-button-sm"),
          outlined: classes.includes("p-button-outlined"),
          secondary: classes.includes("p-button-secondary"),
          icon: svg?.getAttribute("data-p-icon") ?? null,
          iconSize: svg ? Math.round(svg.getBoundingClientRect().width) : null,
          iconBeforeLabel: svg && labelLeft !== null ? svg.getBoundingClientRect().right <= labelLeft + 0.5 : null,
        }
      }, selector)
    /** Survol reel (souris de Playwright) puis lecture du `.p-tooltip` : texte et position sous l'element. */
    const hover = async (selector) => {
      await p.mouse.move(2, 2)
      await settle(450)
      const box = await p.locator(selector).boundingBox()
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await settle(900)
      const result = await p.evaluate((css) => {
        const tip = document.querySelector(".p-tooltip")
        const host = document.querySelector(css).getBoundingClientRect()
        if (!tip) return null
        const r = tip.getBoundingClientRect()
        return {
          text: tip.textContent,
          below: Math.round(r.top - host.bottom),
          centerOffset: Math.round(r.left + r.width / 2 - (host.left + host.width / 2)),
        }
      }, selector)
      return result
    }
    const away = async () => {
      await p.mouse.move(2, 2)
      await settle(500)
    }
    const hint = (row) => p.evaluate((i) => document.querySelectorAll("app-settings-row")[i].querySelector(".text-xs").textContent, row)
    const scrolls = () =>
      p.evaluate(() => {
        const main = document.querySelector("main")
        return {
          pageV: document.scrollingElement.scrollHeight > innerHeight,
          mainV: main.scrollHeight > main.clientHeight,
          mainH: main.scrollWidth > main.clientWidth,
          pageH: document.scrollingElement.scrollWidth > innerWidth,
          overshoot: Math.max(document.scrollingElement.scrollHeight - innerHeight, main.scrollHeight - main.clientHeight),
        }
      })
    const cacheState = () =>
      p.evaluate(() => {
        const svc = window.__svc
        return {
          phase: svc.phase(),
          runId: svc.taggingRunId(),
          committed: svc.committed(),
          failures: svc.writeFailureCount(),
          awaits: svc.runAwaitsWrite(),
          lost: svc.taggingRun.lost(),
          size: document.querySelector("[data-cache-size]")?.textContent.trim() ?? null,
          error: document.querySelector("[data-cache-error]")?.textContent.replace(/[ \t\r\n]+/g, " ").trim() ?? null,
        }
      })
    const stable = (selector) =>
      p
        .waitForFunction((css) => {
          const e = document.querySelector(css)
          if (!e || e.getBoundingClientRect().height === 0) return false
          return document.getAnimations().filter((a) => a.effect?.target && e.contains(a.effect.target)).length === 0
        }, selector, { timeout: 4000 })
        .then(
          () => true,
          () => false,
        )
    /** Ecart de l'erreur : controle de la rangee jusqu'au message, puis message jusqu'au filet du bas. */
    const gaps = (selector) =>
      p.evaluate((css) => {
        const host = document.querySelector(css)
        const box = host.querySelector(".p-message") ?? host
        const row = host.closest("app-settings-row")
        const control = row.querySelector("[rowControl]").getBoundingClientRect()
        const b = box.getBoundingClientRect()
        const r = row.getBoundingClientRect()
        const border = parseFloat(getComputedStyle(row).borderBottomWidth)
        const range = document.createRange()
        range.selectNodeContents(box.querySelector(".whitespace-pre-line") ?? box)
        const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size
        const icon = box.querySelector("svg")
        return {
          above: Math.round((b.top - control.bottom) * 10) / 10,
          below: Math.round((r.bottom - border - b.bottom) * 10) / 10,
          height: Math.round(b.height * 10) / 10,
          lines,
          severity: box.classList.contains("p-message-error") ? "error" : [...box.classList].find((c) => /^p-message-/.test(c)) ?? null,
          icon: icon?.getAttribute("data-p-icon") ?? null,
          iconSize: icon ? Math.round(icon.getBoundingClientRect().width) : null,
          text: box.textContent,
        }
      }, selector)
    const toast = () =>
      p.evaluate(() => {
        const m = [...document.querySelectorAll(".p-toast-message")].pop()
        if (!m) return null
        const d = m.querySelector(".p-toast-detail")
        const s = m.querySelector(".p-toast-summary")
        const range = document.createRange()
        range.selectNodeContents(d)
        const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size
        return {
          severity: [...m.classList].find((c) => /^p-toast-message-/.test(c)) ?? null,
          summary: s.textContent.trim(),
          detailText: d.textContent,
          whiteSpace: getComputedStyle(d).whiteSpace,
          detailWeight: getComputedStyle(d).fontWeight,
          summaryWeight: getComputedStyle(s).fontWeight,
          width: Math.round(m.getBoundingClientRect().width),
          height: Math.round(d.getBoundingClientRect().height * 10) / 10,
          lineHeight: getComputedStyle(d).lineHeight,
          visualLines: lines,
          count: document.querySelectorAll(".p-toast-message").length,
        }
      })
    const toastGone = () => p.waitForFunction(() => document.querySelectorAll(".p-toast-message").length === 0, null, { timeout: 7000 }).catch(() => undefined)

    // ---- 1. Avant `version` : Logs grise (tooltip), Cache actif sans taille
    out.beforeVersion = {
      labels: await p.evaluate(() => [...document.querySelectorAll("app-settings-row [rowLabel]")].map((e) => e.textContent.trim())),
      logs: await button('[data-action="reveal-logs"]'),
      cache: await button('[data-action="clear-cache"]'),
      size: await p.evaluate(() => document.querySelector("[data-cache-size]")?.textContent ?? null),
    }
    check(out.beforeVersion.logs?.disabled === true, `${language} avant version : Logs actif sans logFile`)
    check(out.beforeVersion.cache?.disabled === false, `${language} avant version : Cache grise alors que le moteur repond`)
    check(out.beforeVersion.size === null, `${language} avant version : taille affichee sans cache_size (${out.beforeVersion.size})`)
    const blockedTip = await hover('[data-action="reveal-logs"]')
    out.logsBlockedTooltip = blockedTip
    check(blockedTip !== null && flat(blockedTip.text) === flat(want.logs.starting), `${language} tooltip Logs grise : ${JSON.stringify(blockedTip)}`)
    check(blockedTip !== null && blockedTip.below >= 0, `${language} tooltip Logs grise pas sous le bouton : ${blockedTip?.below}`)
    await shot("1-logs-blocked-tooltip")
    await away()
    // Sans moteur (`null`) : Cache grise, aucune raison en tooltip (decision du spec)
    await p.evaluate(() => window.__svc._available.set(null))
    await settle(300)
    const noEngine = await button('[data-action="clear-cache"]')
    const noEngineTip = await hover('[data-action="clear-cache"]')
    out.cacheNoEngine = { disabled: noEngine.disabled, tooltip: noEngineTip }
    // Depuis la seconde passe : le moteur pas pret donne sa raison (cle partagee `settings.admin.starting`)
    check(
      noEngine.disabled === true && noEngineTip !== null && flat(noEngineTip.text) === flat(want.logs.starting) && noEngineTip.below >= 0,
      `${language} Cache sans moteur : ${JSON.stringify(out.cacheNoEngine)}`,
    )
    await shot("1b-cache-engine-not-ready-tooltip")
    await away()
    await p.evaluate(() => window.__svc._available.set(true))

    // ---- 2. `version` puis `cache_size`
    await p.evaluate(() => {
      const mk = (version, logFile) =>
        JSON.stringify({
          event: "version",
          version,
          api_key_configured: true,
          default_thresholds: { floor: 70, ceiling: 90 },
          log_file: logFile,
        })
      window.__svc.handleLine(mk("0.0.0-probe", null))
      window.__svc.handleLine(mk(window.__svc.versionMismatch().ui, "C:/Users/Jane Doe/AppData/Local/fr.example.app/logs/tagger.log"))
    })
    await line({ event: "cache_size", size_bytes: CACHE_BYTES })
    await p.waitForSelector("[data-cache-size]")
    await settle(500)
    await shot("2-admin")

    out.layout = await p.evaluate(() => {
      const n = (x) => Math.round(x * 10) / 10
      const host = document.querySelector("app-settings-page")
      const section = host.querySelector("section")
      const rows = [...host.querySelectorAll("app-settings-row")]
      const muted = (() => {
        const probe = document.createElement("span")
        probe.className = "text-muted-color"
        document.body.append(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      })()
      const lines = (element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size
      }
      const describe = (row) => {
        const label = row.querySelector("[rowLabel]")
        const control = row.querySelector("[rowControl]")
        const hint = control.querySelector(".text-xs")
        const action = row.querySelector("button[data-action]")
        const size = row.querySelector("[data-cache-size]")
        const c = control.getBoundingClientRect()
        const h = hint.getBoundingClientRect()
        const a = action.getBoundingClientRect()
        const l = label.getBoundingClientRect()
        const result = {
          columns: getComputedStyle(row).gridTemplateColumns,
          labelText: label.textContent.trim(),
          labelFont: getComputedStyle(label).fontSize,
          labelAlone: row.querySelectorAll("[rowLabel]").length === 1 && label.querySelector(".text-xs") === null,
          controlLeft: n(c.left),
          controlLeftFromLabel: n(c.left - l.left),
          hintText: hint.textContent,
          hintFont: getComputedStyle(hint).fontSize,
          hintMuted: getComputedStyle(hint).color === muted,
          hintWhiteSpace: getComputedStyle(hint).whiteSpace,
          hintLeftOnControl: n(h.left - c.left),
          hintLines: lines(hint),
          hintWidth: n(h.width),
          hintCenterToButtonCenter: n(h.top + h.height / 2 - (a.top + a.height / 2)),
          hintToButton: n(a.left - h.right),
          controlRightToSection: n(section.getBoundingClientRect().right - c.right),
          buttonHeight: n(a.height),
          rowHeight: n(row.getBoundingClientRect().height),
        }
        if (size) {
          const s = size.getBoundingClientRect()
          const style = getComputedStyle(size)
          result.size = {
            text: size.textContent.trim(),
            font: style.fontSize,
            muted: style.color === muted,
            tabular: style.fontVariantNumeric,
            rightOfButton: s.left >= a.right - 0.5,
            buttonToSize: n(s.left - a.right),
            rightEdgeToControl: n(c.right - s.right),
            centerToButtonCenter: n(s.top + s.height / 2 - (a.top + a.height / 2)),
          }
        } else {
          result.buttonRightToControl = n(c.right - a.right)
        }
        return result
      }
      const main = document.querySelector("main")
      return {
        h2: section.querySelector("h2").textContent.trim(),
        menu: [...host.querySelectorAll(".p-menu-item-label")].map((e) => e.textContent.trim()),
        labels: rows.map((r) => r.querySelector("[rowLabel]").textContent.trim()),
        rowTops: rows.map((r) => n(r.getBoundingClientRect().top)),
        cache: describe(rows[0]),
        logs: describe(rows[1]),
        version: describe(rows[4]),
        scroll: {
          page: document.scrollingElement.scrollHeight > innerHeight,
          main: main.scrollHeight > main.clientHeight,
          section: section.scrollHeight > section.clientHeight,
          bottomRoom: Math.round(main.getBoundingClientRect().bottom - rows[rows.length - 1].getBoundingClientRect().bottom),
        },
      }
    })
    const lay = out.layout
    check(lay.labels.join("|") === want.labels.join("|"), `${language} rangees : ${lay.labels.join("|")}`)
    check(lay.rowTops.every((t, i, all) => i === 0 || t > all[i - 1]), `${language} ordre des rangees : ${lay.rowTops}`)
    check(!lay.scroll.page && !lay.scroll.main && !lay.scroll.section, `${language} defilement : ${JSON.stringify(lay.scroll)}`)
    for (const [name, row, text] of [["cache", lay.cache, want.cache], ["logs", lay.logs, want.logs]]) {
      check(row.columns.startsWith("160px "), `${language} ${name} colonne de gauche : ${row.columns}`)
      check(row.labelAlone && row.labelFont === "14px", `${language} ${name} libelle : ${row.labelFont}`)
      check(row.controlLeftFromLabel === 176, `${language} ${name} controle a ${row.controlLeftFromLabel}px du libelle (160 + gap 16)`)
      check(row.hintFont === "12px" && row.hintMuted && row.hintWhiteSpace === "pre-line", `${language} ${name} aide : ${row.hintFont} muted=${row.hintMuted} ${row.hintWhiteSpace}`)
      check(Math.abs(row.hintLeftOnControl) < 0.6, `${language} ${name} aide pas a gauche du controle : ${row.hintLeftOnControl}`)
      check(Math.abs(row.hintCenterToButtonCenter) < 1.5, `${language} ${name} aide pas sur la ligne du bouton : ${row.hintCenterToButtonCenter}`)
      check(row.hintToButton >= 15.5, `${language} ${name} aide trop pres du bouton : ${row.hintToButton}`)
      check(flat(row.hintText) === flat(text.hint ?? ""), `${language} ${name} aide : ${JSON.stringify(row.hintText)}`)
    }
    check(lay.cache.size?.text !== undefined && flat(lay.cache.size.text) === want.cache.size, `${language} taille du cache : ${JSON.stringify(lay.cache.size)}`)
    check(
      lay.cache.size?.font === "14px" && lay.cache.size.muted && lay.cache.size.tabular.includes("tabular-nums") && lay.cache.size.rightOfButton,
      `${language} taille du cache (style, a droite du bouton) : ${JSON.stringify(lay.cache.size)}`,
    )
    check(Math.abs(lay.cache.size?.rightEdgeToControl ?? 99) < 0.6, `${language} taille du cache pas au bout de la ligne : ${lay.cache.size?.rightEdgeToControl}`)
    check(lay.cache.size?.buttonToSize === 8, `${language} ecart bouton Cache -> taille : ${lay.cache.size?.buttonToSize}`)
    check(Math.abs(lay.logs.buttonRightToControl) < 0.6, `${language} bouton Logs pas au bout de la ligne : ${lay.logs.buttonRightToControl}`)
    const ver = lay.version
    check(ver.columns.startsWith("160px ") && ver.labelAlone && ver.controlLeftFromLabel === 176, `${language} version colonnes : ${ver.columns} ${ver.controlLeftFromLabel}`)
    check(ver.hintFont === "12px" && ver.hintMuted && Math.abs(ver.hintCenterToButtonCenter) < 1.5 && ver.hintToButton >= 15.5, `${language} version aide : ${JSON.stringify(ver)}`)
    check(want.version.hint.test(flat(ver.hintText)), `${language} version texte : ${JSON.stringify(ver.hintText)}`)
    check(Math.abs(ver.buttonRightToControl) < 0.6, `${language} bouton Version pas au bout de la ligne : ${ver.buttonRightToControl}`)
    await p.click('[data-action="check-update"]')
    await p.waitForSelector("[data-version-error]")
    const versionFeedback = await p.evaluate(() => {
      const e = document.querySelector("[data-version-error]")
      const b = document.querySelector('[data-action="check-update"]')
      return { text: e.textContent, disabled: b.disabled, label: b.textContent, scroll: document.querySelector("main").scrollHeight > document.querySelector("main").clientHeight }
    })
    out.version = versionFeedback
    check(flat(versionFeedback.text) === flat(want.version.failed), `${language} version echec : ${JSON.stringify(versionFeedback.text)}`)
    check(!versionFeedback.disabled && flat(versionFeedback.label) === want.version.action && !versionFeedback.scroll, `${language} version bouton/defilement : ${JSON.stringify(versionFeedback)}`)
    const cacheButton = await button('[data-action="clear-cache"]')
    const logsButton = await button('[data-action="reveal-logs"]')
    out.buttons = { cache: cacheButton, logs: logsButton }
    for (const [name, b, label, icon] of [["cache", cacheButton, want.cache.action, "trash"], ["logs", logsButton, want.logs.action, "external-link"]]) {
      check(b.small && b.outlined && b.secondary, `${language} bouton ${name} : small/outlined/secondary ${JSON.stringify(b)}`)
      check(b.icon === icon && b.iconSize === 16 && b.iconBeforeLabel === true, `${language} bouton ${name} : icone ${b.icon} ${b.iconSize}px avant le libelle=${b.iconBeforeLabel}`)
      check(flat(b.text) === flat(label), `${language} bouton ${name} : libelle ${JSON.stringify(b.text)}`)
      check(b.disabled === false, `${language} bouton ${name} : grise avec le moteur pret`)
    }
    check(lay.menu.join("|") === "API|Matching|Interface|Administration", `${language} menu : ${lay.menu}`)
    check(lay.h2 === "Administration", `${language} titre de section : ${lay.h2}`)

    // ---- 3. Vidage par un vrai clic : commande, toast, taille, aucun contexte audio
    await p.evaluate(() => {
      window.__sent = []
    })
    await p.locator('[data-action="clear-cache"]').click()
    await settle(200)
    out.clearCommands = await sent()
    check(out.clearCommands.join() === "clear_cache", `${language} commandes apres clic : ${out.clearCommands}`)
    await line({ event: "cache_cleared", freed_bytes: CACHE_BYTES, size_bytes: 0 })
    await settle(700)
    out.toastCleared = await toast()
    out.sizeAfterClear = await p.evaluate(() => document.querySelector("[data-cache-size]")?.textContent.trim() ?? null)
    await shot("3-toast-cleared")
    check(out.toastCleared?.severity === "p-toast-message-success", `${language} toast : severite ${out.toastCleared?.severity}`)
    check(out.toastCleared?.summary === want.cache.summary, `${language} toast : titre ${out.toastCleared?.summary}`)
    check(flat(out.toastCleared?.detailText ?? "") === want.cache.freed, `${language} toast : detail ${JSON.stringify(out.toastCleared?.detailText)}`)
    check(out.toastCleared?.count === 1, `${language} toast : ${out.toastCleared?.count} messages`)
    await toastGone()
    // Partiel : un fichier tenu par un autre programme survit
    await line({ event: "cache_cleared", freed_bytes: 1_700_000, size_bytes: 1_500_000 })
    await settle(700)
    out.toastPartial = await toast()
    out.sizeAfterPartial = await p.evaluate(() => document.querySelector("[data-cache-size]")?.textContent.trim() ?? null)
    await shot("4-toast-partial")
    check(flat(out.toastPartial?.detailText ?? "") === flat(want.cache.partial), `${language} toast partiel : detail ${JSON.stringify(out.toastPartial?.detailText)}`)
    // Deux phrases, chacune sur sa ligne (`pre-line`) ; la seconde peut revenir a la ligne dans les 300px du toast
    check(out.toastPartial?.visualLines >= 2 && out.toastPartial?.whiteSpace === "pre-line", `${language} toast partiel : ${out.toastPartial?.visualLines} ligne(s) a l'ecran, white-space ${out.toastPartial?.whiteSpace}`)
    await toastGone()
    out.audioContexts = await p.evaluate(() => window.__audio)
    check(out.audioContexts === 0, `${language} contextes audio crees par le vidage : ${out.audioContexts}`)
    await line({ event: "cache_size", size_bytes: CACHE_BYTES })

    // ---- 4. Refus du sidecar sous la rangee Cache
    const refusal = (code, params) => ({ event: "error", code, params, message: code, command: "clear_cache" })
    await line(refusal("phase_busy", { phase: "tagging" }))
    await p.waitForSelector("[data-cache-error]")
    out.cacheErrorBusyStable = await stable("[data-cache-error]")
    out.cacheErrorBusy = await gaps("[data-cache-error]")
    await shot("5-cache-error-phase-busy")
    check(
      flat(out.cacheErrorBusy.text) === flat(want.cache.phaseBusy ?? out.cacheErrorBusy.text),
      `${language} refus phase_busy : ${JSON.stringify(out.cacheErrorBusy.text)}`,
    )
    check(out.cacheErrorBusy.icon === "times-circle" && out.cacheErrorBusy.severity === "error", `${language} refus phase_busy : ${out.cacheErrorBusy.icon}/${out.cacheErrorBusy.severity}`)
    check(
      Math.abs(out.cacheErrorBusy.above - 12) < 0.6 && Math.abs(out.cacheErrorBusy.below - 12) < 0.6,
      `${language} refus phase_busy : ecarts ${out.cacheErrorBusy.above} au-dessus, ${out.cacheErrorBusy.below} en dessous (anime=${out.cacheErrorBusyStable})`,
    )
    await p.evaluate(() => window.__svc.setLastError(null))
    await settle(300)
    await line(refusal("run_not_written", {}))
    await p.waitForSelector("[data-cache-error]")
    await stable("[data-cache-error]")
    out.cacheErrorNotWritten = await gaps("[data-cache-error]")
    check(flat(out.cacheErrorNotWritten.text) === flat(want.cache.notWritten), `${language} refus run_not_written : ${JSON.stringify(out.cacheErrorNotWritten.text)}`)
    await p.evaluate(() => window.__svc.setLastError(null))
    await settle(300)
    check((await cacheState()).error === null, `${language} refus : message encore la apres setLastError(null)`)

    // ---- 5. Etats grises du bouton Cache
    const cacheRow = async (name) => {
      const state = await cacheState()
      const b = await button('[data-action="clear-cache"]')
      const tip = await hover('[data-action="clear-cache"]')
      await away()
      out.states = out.states ?? {}
      out.states[name] = { ...state, disabled: b.disabled, tooltip: tip === null ? null : { text: flat(tip.text), below: tip.below, centerOffset: tip.centerOffset } }
      return { state, b, tip }
    }
    {
      const idle = await cacheRow("idle")
      check(!idle.b.disabled && idle.tip === null, `${language} etat idle : ${JSON.stringify(out.states.idle)}`)
    }
    await p.evaluate((folder) => window.__svc.startTagging(folder), FOLDER)
    await settle(300)
    {
      const s = await cacheRow("searching")
      check(s.state.phase === "searching" && s.b.disabled, `${language} phase longue : ${JSON.stringify(out.states.searching)}`)
      check(s.tip !== null && flat(s.tip.text) === flat(want.cache.busy) && s.tip.below >= 0, `${language} phase longue : tooltip ${JSON.stringify(out.states.searching.tooltip)}`)
      await p.mouse.move(2, 2)
      const box = await p.locator('[data-action="clear-cache"]').boundingBox()
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await settle(900)
      await shot("6-cache-blocked-busy")
      await away()
    }
    await line({ event: "run_started", run_id: "run-1", folder: FOLDER, tracks: [T1, T2] })
    await line(resolved(T1))
    await line(resolved(T2))
    await line(finished("run-1", "network", { resolved: 2 }))
    await settle(400)
    {
      const s = await cacheRow("unwritten")
      check(s.state.phase === "idle" && s.state.awaits && s.state.runId === "run-1" && s.b.disabled, `${language} run non ecrit : ${JSON.stringify(out.states.unwritten)}`)
      check(s.tip !== null && flat(s.tip.text) === flat(want.cache.unwritten) && s.tip.below >= 0, `${language} run non ecrit : tooltip ${JSON.stringify(out.states.unwritten.tooltip)}`)
      const box = await p.locator('[data-action="clear-cache"]').boundingBox()
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await settle(900)
      await shot("7-cache-blocked-unwritten")
      await away()
    }
    await p.evaluate(() => window.__svc.commitRun())
    await line({ event: "progress", phase: "write", processed: 2, total: 2 })
    await line(resolved(T1, "write_error"))
    await line(resolved(T2, "written"))
    await line(finished("run-1", "write", { written: 1, write_error: 1 }))
    await settle(400)
    {
      const s = await cacheRow("writeFailures")
      check(s.state.committed && s.state.awaits && s.state.failures === 1 && s.b.disabled, `${language} ecriture avec echec : ${JSON.stringify(out.states.writeFailures)}`)
      check(s.tip !== null && flat(s.tip.text) === flat(want.cache.unwritten), `${language} ecriture avec echec : tooltip ${JSON.stringify(out.states.writeFailures.tooltip)}`)
    }
    await p.evaluate(() => window.__svc.endRun())
    await settle(400)
    {
      const s = await cacheRow("lostWithEngine")
      check(s.state.lost && !s.state.awaits && s.state.failures === 1 && s.state.runId === "run-1" && !s.b.disabled && s.tip === null, `${language} run perdu avec le moteur (echecs a l'ecran) : ${JSON.stringify(out.states.lostWithEngine)}`)
    }
    // Run neuf, ecrit sans echec
    await p.evaluate((folder) => window.__svc.startTagging(folder), FOLDER)
    await line({ event: "run_started", run_id: "run-2", folder: FOLDER, tracks: [T1, T2] })
    await line(resolved(T1))
    await line(resolved(T2))
    await line(finished("run-2", "network", { resolved: 2 }))
    await settle(300)
    await p.evaluate(() => window.__svc.commitRun())
    await line({ event: "progress", phase: "write", processed: 2, total: 2 })
    await line(resolved(T1, "written"))
    await line(resolved(T2, "written"))
    await line(finished("run-2", "write", { written: 2 }))
    await settle(400)
    {
      const s = await cacheRow("writtenClean")
      check(s.state.committed && !s.state.awaits && s.state.failures === 0 && !s.b.disabled && s.tip === null, `${language} run ecrit sans echec : ${JSON.stringify(out.states.writtenClean)}`)
    }

    // ---- 6. Logs : revealItemInDir reussi, puis rejete
    await p.evaluate(() => {
      window.__revealed = []
      window.__revealFails = false
      window.__TAURI_INTERNALS__ = {
        invoke: (cmd, args) => {
          if (cmd === "plugin:opener|reveal_item_in_dir") {
            window.__revealed.push(args)
            return window.__revealFails ? Promise.reject(new Error("os error 2")) : Promise.resolve()
          }
          return Promise.reject(new Error(`no tauri: ${cmd}`))
        },
      }
    })
    out.logFile = await p.evaluate(() => window.__svc.logFile())
    check(out.logFile === LOG_FILE, `${language} logFile : ${out.logFile}`)
    check((await button('[data-action="reveal-logs"]')).disabled === false, `${language} Logs grise avec logFile connu`)
    const logsTip = await hover('[data-action="reveal-logs"]')
    check(logsTip === null, `${language} tooltip Logs actif : ${JSON.stringify(logsTip)}`)
    await away()
    await p.locator('[data-action="reveal-logs"]').click()
    await settle(400)
    out.revealed = await p.evaluate(() => window.__revealed)
    check(JSON.stringify(out.revealed) === JSON.stringify([{ paths: [LOG_FILE] }]) || JSON.stringify(out.revealed) === JSON.stringify([{ paths: LOG_FILE }]), `${language} reveal_item_in_dir : ${JSON.stringify(out.revealed)}`)
    check((await p.locator("[data-logs-error]").count()) === 0, `${language} message Logs apres un revealItemInDir reussi`)
    await p.evaluate(() => {
      window.__revealFails = true
    })
    await p.locator('[data-action="reveal-logs"]').click()
    await p.waitForSelector("[data-logs-error]")
    out.logsErrorStable = await stable("[data-logs-error]")
    out.logsError = await gaps("[data-logs-error]")
    await shot("8-logs-error")
    check(flat(out.logsError.text) === flat(want.logs.unavailable), `${language} message Logs : ${JSON.stringify(out.logsError.text)}`)
    check(out.logsError.lines === 2, `${language} message Logs : ${out.logsError.lines} ligne(s)`)
    check(out.logsError.icon === "times-circle" && out.logsError.severity === "error", `${language} message Logs : ${out.logsError.icon}/${out.logsError.severity}`)
    check(
      Math.abs(out.logsError.above - out.logsError.below) < 0.6 && Math.abs(out.logsError.above - 12) < 0.6,
      `${language} message Logs : ecarts ${out.logsError.above} au-dessus, ${out.logsError.below} en dessous (anime=${out.logsErrorStable})`,
    )
    // Meme mesure sur l'erreur du Cache, pour comparer les deux ecarts
    await line(refusal("phase_busy", { phase: "tagging" }))
    await p.waitForSelector("[data-cache-error]")
    await stable("[data-cache-error]")
    out.cacheErrorAgain = await gaps("[data-cache-error]")
    out.bothErrorsScroll = await scrolls()
    await shot("9-both-errors")
    check(
      Math.abs(out.cacheErrorAgain.above - out.logsError.above) < 0.6 && Math.abs(out.cacheErrorAgain.below - out.logsError.below) < 0.6,
      `${language} ecarts Cache ${out.cacheErrorAgain.above}/${out.cacheErrorAgain.below} contre Logs ${out.logsError.above}/${out.logsError.below}`,
    )
    // Depuis la seconde passe : meme aspect que l'erreur du Cache (icone de 20px, deux lignes, meme hauteur)
    check(out.logsError.iconSize === 20 && out.cacheErrorAgain.iconSize === 20, `${language} icones des erreurs : Logs ${out.logsError.iconSize}px, Cache ${out.cacheErrorAgain.iconSize}px`)
    check(Math.abs(out.logsError.height - out.cacheErrorAgain.height) < 0.6, `${language} hauteur des erreurs : Logs ${out.logsError.height}px, Cache ${out.cacheErrorAgain.height}px`)
    // La reussite qui suit retire le message
    await p.evaluate(() => {
      window.__revealFails = false
    })
    await p.locator('[data-action="reveal-logs"]').click()
    await settle(500)
    out.logsErrorGone = (await p.locator("[data-logs-error]").count()) === 0
    check(out.logsErrorGone, `${language} message Logs reste apres un revealItemInDir reussi`)

    // Un moteur relance annonce un nouveau `logFile` : il efface l'echec du precedent
    await p.evaluate(() => {
      window.__revealFails = true
    })
    await p.locator('[data-action="reveal-logs"]').click()
    await p.waitForSelector("[data-logs-error]")
    await p.evaluate(() => window.__svc._logFile.set("C:/Users/Jane Doe/AppData/Local/fr.example.app/logs/tagger-2.log"))
    await settle(500)
    out.logsErrorAfterNewLogFile = (await p.locator("[data-logs-error]").count()) === 0
    check(out.logsErrorAfterNewLogFile, `${language} message Logs reste apres un nouveau logFile`)
    check((await button('[data-action="reveal-logs"]')).disabled === false, `${language} Logs grise apres un nouveau logFile`)

    // `formatBytes` arrondit avant de choisir l'unite : 999 999 octets se lisent « 1 Mo », pas « 1 000 ko »
    out.bytes = {}
    for (const bytes of [999, 999_499, 999_999, 1_000_000]) {
      await line({ event: "cache_size", size_bytes: bytes })
      await settle(200)
      out.bytes[bytes] = flat(await p.evaluate(() => document.querySelector("[data-cache-size]")?.textContent ?? ""))
    }
    const wantBytes = language === "fr" ? { 999: "999 o", 999_499: "999 ko", 999_999: "1 Mo", 1_000_000: "1 Mo" } : { 999: "999 byte", 999_499: "999 kB", 999_999: "1 MB", 1_000_000: "1 MB" }
    check(JSON.stringify(out.bytes) === JSON.stringify(wantBytes), `${language} formatBytes : ${JSON.stringify(out.bytes)}`)

    out.consoleErrors = consoleErrors
    check(consoleErrors.length === 0, `${language} erreurs de page : ${consoleErrors.join(" ; ")}`)
    await context.close()
  }

  return { failures, measures }
}
