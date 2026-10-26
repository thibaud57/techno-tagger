// Rejeu du scenario de la demo web sous `just dev-demo` (navigateur nu, aucun Tauri ni sidecar), gestes
// reels de Playwright : parcours complet FR, ordre libre, « les choix changent la fin », « Recommencer la
// demo », bandeau au plancher 1024 x 700, fidelite au design system. Un contexte de navigateur par
// scenario (stockage neuf), les commandes et les lignes du transport relevees par un `JSON.parse` espion
// pose avant l'app (`window.__commands`, `window.__events`) et le compteur de la barre de phase echantillonne
// par un `MutationObserver` (`window.__samples`). `ONLY=s1,s2,s3,s4,gap` ne rejoue que ces scenarios (le
// bandeau et la fidelite tournent toujours). Rend `checks`, `failures`, `measures`.
async (page) => {
  // `DEMO_URL` vise l'image servie par nginx (`http://localhost:8080`) au lieu de `just dev-demo`.
  const base = process.env.DEMO_URL ?? "http://localhost:4200"
  const shots = process.env.SHOTS_DIR
  // `ONLY=s1,s5` ne rejoue que ces scenarios (mise au point) ; vide, tous.
  const only = (process.env.ONLY ?? "").split(",").filter(Boolean)
  const on = (id) => only.length === 0 || only.includes(id)
  const browser = page.context().browser()
  const failures = []
  const checks = {}
  const consoleAll = []
  const pageErrors = []
  const foreignRequests = []
  const measures = {}
  const check = (name, ok, detail) => {
    checks[name] = { ok, ...(detail === undefined ? {} : { detail }) }
    if (!ok) failures.push(name)
  }

  // Espion pose avant l'app : chaque ligne du sidecar (`event`) et chaque commande de l'UI (`command`)
  // passent par un `JSON.parse` (service et transport), les compteurs de phase par le DOM.
  const hooks = () => {
    window.__events = []
    window.__commands = []
    window.__samples = []
    const parse = JSON.parse
    JSON.parse = function (text, reviver) {
      const value = parse.call(this, text, reviver)
      if (typeof text === "string" && value && typeof value === "object") {
        if (typeof value.event === "string") window.__events.push({ t: performance.now(), event: value.event })
        else if (typeof value.command === "string")
          window.__commands.push({ t: performance.now(), command: value.command, track_id: value.track_id ?? null })
      }
      return value
    }
    let last = null
    const read = () => {
      const v = [...document.querySelectorAll("app-phase-progress span.tabular-nums")]
        .map((e) => e.textContent.trim())
        .join("|")
      if (v !== last) {
        last = v
        window.__samples.push({ t: performance.now(), v })
      }
    }
    document.addEventListener("DOMContentLoaded", () =>
      new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true }),
    )
  }

  const fresh = async (label, options = {}) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "fr-FR",
      ...options,
    })
    await context.addInitScript(hooks)
    const p = await context.newPage()
    p.setDefaultTimeout(15000)
    p.on("console", (m) => consoleAll.push({ label, type: m.type(), text: m.text() }))
    p.on("pageerror", (e) => pageErrors.push({ label, text: String(e) }))
    // `data:` et `blob:` restent dans la page : seule une requete reseau vers un autre hote sort.
    p.on("request", (r) => {
      const url = r.url()
      if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin) foreignRequests.push({ label, url })
    })
    return { context, p }
  }
  // Un scenario qui leve ne masque pas les suivants : l'echec est inscrit avec son message et une capture.
  const guard = async (label, p, fn) => {
    try {
      await fn()
    } catch (error) {
      const where = String(error?.stack ?? "").split(/\r?\n/).filter((l) => /<anonymous>:[0-9]+/.test(l)).slice(0, 2).map((l) => l.replace(/^.*<anonymous>/, "@"))
      check(`${label}.aborted`, false, { message: String(error?.message ?? error).slice(0, 600), where })
      if (shots && p) await p.screenshot({ path: `${shots}/replay-${label}-aborted.png` }).catch(() => {})
    }
  }

  const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim()
  const dialogText = (p) =>
    p.evaluate(() => {
      const d = [...document.querySelectorAll(".p-dialog")].pop()
      return d ? d.innerText.replace(/\s+/g, " ").trim() : null
    })
  const waitDialog = (p, re, timeout = 8000) =>
    p.waitForFunction(
      (src) => {
        const d = [...document.querySelectorAll(".p-dialog")].pop()
        return !!d && new RegExp(src).test(d.innerText.replace(/\s+/g, " "))
      },
      re.source,
      { timeout },
    )
  const waitNoDialog = (p) => p.waitForFunction(() => !document.querySelector(".p-dialog"), null, { timeout: 8000 })
  // La croix et non Echap : le focus reste sur la liste des candidats, qui garde la touche (relevé le 2026-10-26).
  const closeDialog = async (p) => {
    await p.locator(".p-dialog .p-dialog-close-button").click()
    await waitNoDialog(p)
  }
  const counter = (p) =>
    p.evaluate(() =>
      [...document.querySelectorAll("app-phase-progress span.tabular-nums")].map((e) => e.textContent.trim()).join("|"),
    )
  const waitCounter = (p, re) =>
    p.waitForFunction(
      (src) =>
        new RegExp(src).test(
          [...document.querySelectorAll("app-phase-progress span.tabular-nums")].map((e) => e.textContent.trim()).join("|"),
        ),
      re.source,
      { timeout: 10000 },
    )
  const commandCount = (p, name) =>
    p.evaluate((n) => window.__commands.filter((c) => !n || c.command === n).length, name ?? null)
  const waitEvents = (p, name, count, timeout = 20000) =>
    p.waitForFunction(([n, c]) => window.__events.filter((e) => e.event === n).length >= c, [name, count], { timeout })
  const badges = (p) =>
    p.evaluate(() => ({
      arbitration: document.querySelector("[data-arbitration-badge]")?.textContent.trim() ?? null,
      recovery: document.querySelector("[data-recovery-badge]")?.textContent.trim() ?? null,
    }))

  // Survol maintenu sur un controle grise : tooltip, sa place par rapport au bouton, son style.
  const hoverTip = async (p, selector, { settle = 500, hold = 900 } = {}) => {
    await p.mouse.move(2, 2)
    await p.waitForTimeout(settle)
    const box = await p.locator(selector).first().boundingBox()
    if (!box) return { missing: true }
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await p.waitForTimeout(250)
    const early = await p.evaluate(() => document.querySelector(".p-tooltip") !== null)
    await p.waitForTimeout(hold)
    const state = await p.evaluate((css) => {
      const el = document.querySelector(css)
      const tip = document.querySelector(".p-tooltip")
      const b = el.getBoundingClientRect()
      const t = tip?.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const inner = tip?.querySelector(".p-tooltip-text")
      return {
        disabled: el.disabled === true,
        label: el.textContent.replace(/\s+/g, " ").trim(),
        tip: tip ? tip.textContent.trim() : null,
        tipTop: t ? Math.round(t.top) : null,
        btnTop: Math.round(b.top),
        btnBottom: Math.round(b.bottom),
        tipWidth: t ? Math.round(t.width) : null,
        centreOffset: t ? Math.round(t.left + t.width / 2 - (b.left + b.width / 2)) : null,
        pointerEvents: tip ? getComputedStyle(tip).pointerEvents : null,
        whiteSpace: inner ? getComputedStyle(inner).whiteSpace : null,
        tipBackground: inner ? getComputedStyle(inner).backgroundColor : null,
        arrow: !!tip?.querySelector(".p-tooltip-arrow"),
        cursor: cs.cursor,
        opacity: cs.opacity,
      }
    }, selector)
    return { ...state, early, box, tipBackgroundN: state.tipBackground ? await norm(p, state.tipBackground) : null }
  }
  // Une couleur sous toutes ses ecritures (`rgb()`, `color(srgb ...)`) ramenee a `r,g,b,a` par un canvas.
  const norm = (p, color) =>
    p.evaluate((c) => {
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
      return ctx.getImageData(0, 0, 1, 1).data.join(",")
    }, color)
  const tokenColor = (p, expr) =>
    p.evaluate((e) => {
      const d = document.createElement("div")
      d.style.background = e
      document.body.appendChild(d)
      const c = getComputedStyle(d).backgroundColor
      d.remove()
      return c
    }, expr).then((c) => norm(p, c))
  const buttonInfo = (p, selector) =>
    p.evaluate((css) => {
      const el = document.querySelector(css)
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        classes: [...el.classList].filter((c) => /^p-button/.test(c)).sort(),
        label: el.textContent.replace(/\s+/g, " ").trim(),
        disabled: el.disabled === true,
        icons: [...el.querySelectorAll("svg")].map((s) => Math.round(s.getBoundingClientRect().width)),
        height: Math.round(el.getBoundingClientRect().height),
        color: cs.color,
        background: cs.backgroundColor,
        borderTopWidth: cs.borderTopWidth,
        cursor: cs.cursor,
        opacity: cs.opacity,
        fontSize: cs.fontSize,
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        decoration: cs.textDecorationLine,
      }
    }, selector)

  // Lignes de la reponse de `command` (celles de `names`, les requetes entrelacees en ont d'autres) :
  // espacement, duree, et valeurs du compteur de la barre pendant ce temps.
  const phaseStats = (p, command, names, total) =>
    p.evaluate(
      ([cmd, list, count]) => {
        const c = window.__commands.filter((x) => x.command === cmd).pop()
        if (!c) return null
        const lines = window.__events.filter((e) => e.t >= c.t && list.includes(e.event)).slice(0, count)
        const gaps = lines.slice(1).map((e, i) => Math.round(e.t - lines[i].t))
        const sorted = [...gaps].sort((a, b) => a - b)
        const end = lines[lines.length - 1]?.t ?? c.t
        const values = []
        const changes = []
        for (const s of window.__samples.filter((x) => x.t >= c.t && x.t <= end + 50)) {
          if (s.v && !values.includes(s.v)) values.push(s.v)
          if (s.v) changes.push(s.t)
        }
        const steps = changes.slice(1).map((t, i) => Math.round(t - changes[i]))
        const stepsSorted = [...steps].sort((a, b) => a - b)
        return {
          lines: lines.length,
          first: Math.round((lines[0]?.t ?? c.t) - c.t),
          span: Math.round(end - (lines[0]?.t ?? c.t)),
          gapMedian: sorted[Math.floor(sorted.length / 2)] ?? null,
          gapMin: sorted[0] ?? null,
          gapMax: sorted[sorted.length - 1] ?? null,
          counterValues: values,
          counterStepMedian: stepsSorted[Math.floor(stepsSorted.length / 2)] ?? null,
        }
      },
      [command, names, total],
    )
  const RUN_LINES = ["run_started", "track_resolved", "progress", "arbitration_required", "run_finished"]

  // --- parcours ---
  const pickAndExtract = async (p, lang) => {
    await p.goto(`${base}/?lang=${lang}`)
    await p.waitForSelector("p-tablist")
    await p.waitForSelector("app-playlist-page app-path-picker button")
    const pickers = p.locator("app-playlist-page app-path-picker button")
    for (let i = 0; i < 3; i++) await pickers.nth(i).click()
    await p.waitForSelector("app-playlist-page p-select")
    await p.locator("app-playlist-page p-select").click()
    const option = await p.locator(".p-select-option").first().innerText()
    await p.locator(".p-select-option").first().click()
    const extract = p.locator("app-playlist-page button", { hasText: /^\s*(Extraire|Extract)/ })
    await p.waitForFunction(() => {
      const b = [...document.querySelectorAll("app-playlist-page button")].find((x) => /^(Extraire|Extract)/.test(x.textContent.trim()))
      return !!b && !b.disabled
    })
    await extract.click()
    await waitEvents(p, "extraction_finished", 1)
    await p.locator("app-playlist-page button", { hasText: /tagging/i }).waitFor()
    return option
  }
  const goTagging = async (p) => {
    await p.locator("app-playlist-page button", { hasText: /tagging/i }).click()
    await p.waitForSelector("app-tagging-page")
    await p.waitForFunction(() => document.querySelector('[data-action="start"]')?.disabled === false)
  }
  const startRun = (p) => p.locator('[data-action="start"]').click()
  const runFinished = async (p) => {
    await waitEvents(p, "run_finished", 1)
    await p.waitForSelector(".p-dialog")
  }
  const settingsVisit = async (p) => {
    if ((await p.locator(".p-dialog").count()) > 0) {
      await closeDialog(p)
    }
    await p.evaluate(() => (window.__mark = performance.now()))
    const t0 = Date.now()
    await p.locator("p-tab").nth(2).click()
    await p.locator("app-settings-page p-menu .p-menu-item-content").nth(3).click()
    await p.waitForFunction(() => !!document.querySelector("[data-cache-size]")?.getAttribute("data-cache-size"), null, { timeout: 4000 })
    const ms = Date.now() - t0
    const state = await p.evaluate(() => {
      const mark = window.__mark
      return {
        sent: window.__commands.filter((c) => c.t >= mark).map((c) => c.command),
        cacheSize: document.querySelector("[data-cache-size]")?.getAttribute("data-cache-size"),
        pastRuns: document.querySelector('[data-field="past-run"]')?.textContent.replace(/\s+/g, " ").trim(),
        rollbackTarget: document.querySelector("[data-rollback-target]")?.textContent.replace(/\s+/g, " ").trim() ?? null,
        restoreDisabled: document.querySelector('[data-action="restore-last"]')?.disabled ?? null,
        pastDisabled: document.querySelector('[data-action="open-past-run"]')?.disabled ?? null,
        versionRow: document.querySelector("[data-version-row]")?.textContent.replace(/\s+/g, " ").trim() ?? null,
      }
    })
    await p.locator("p-tab").nth(1).click()
    await p.waitForSelector("app-tagging-page")
    return { ms, ...state }
  }
  const optionCount = (p) => p.locator(".p-dialog .p-listbox-option").count()
  const refuseGesture = (p) => p.locator('.p-dialog [data-action="refuse"]').click()
  const validateFirst = async (p) => {
    await p.locator(".p-dialog .p-listbox-option").first().click()
    await p.locator('.p-dialog [data-action="validate"]').click()
  }
  const confirmAccept = async (p, re) => {
    const dialog = p.locator(".p-confirmdialog")
    await dialog.waitFor({ state: "visible" })
    const message = flat(await dialog.innerText())
    await dialog.getByRole("button", { name: re }).click()
    return message
  }
  const lowlandsRecovery = async (p) => {
    await p.locator("[data-recovery-badge]").click()
    await waitDialog(p, /Lowlands/)
    const before = await p.evaluate(() => {
      const i = document.querySelector('[data-field="url"]')
      const b = document.querySelector('[data-action="resolve-url"]')
      return { url: i.value, readOnly: i.readOnly, disabled: i.disabled, resolveDisabled: b.disabled }
    })
    await p.locator('[data-action="resolve-url"]').click()
    return before
  }
  const recapCounters = (p) =>
    p.evaluate(() =>
      [...document.querySelectorAll("p-selectbutton [data-filter]")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
    )

  // =====================================================================================
  // 1 + 6 : parcours complet FR, 1280 x 800
  // =====================================================================================
  const s1 = {}
  if (on("s1")) {
    const { context, p } = await fresh("s1")
    await guard("s1", p, async () => {
      const option = await pickAndExtract(p, "fr")
      const report = flat(await p.locator("app-playlist-page").innerText())
      check("s1.playlistOption", /Set du samedi/.test(option), option)
      check(
        "s1.extractionReport",
        /Extraction terminée \(13 sur 13\)/.test(report) && /Sub Rosa/.test(report) && /Lowlands/.test(report),
        report.slice(0, 160),
      )
      if (shots) await p.screenshot({ path: `${shots}/replay-s1-extraction.png` })
      await goTagging(p)
      const folder = flat(await p.locator("app-tagging-page app-path-picker").innerText())
      check("s1.taggingFolderIsDestination", /Set du samedi/.test(folder), folder)

      await startRun(p)
      await p.waitForTimeout(150)
      // « Interrompre » grise pendant le run, tooltip sous le bouton. Mesure courte : la premiere modale
      // d'arbitrage s'ouvre 2,2 s apres le lancement et emporte le survol.
      const cancel = await hoverTip(p, '[data-action="cancel"]', { settle: 100, hold: 450 })
      s1.cancel = cancel
      check(
        "s6.cancelGreyed",
        cancel.disabled && cancel.tip === "Indisponible dans la démo." && /Interrompre/.test(cancel.label),
        cancel,
      )
      s1.cancelInfo = await buttonInfo(p, '[data-action="cancel"]')

      // Requetes des Reglages pendant la phase longue : repondues tout de suite, sans attendre les 5 s.
      const visit = await settingsVisit(p)
      s1.visitDuringRun = visit
      check("s4.settingsDuringRunAtOnce", visit.ms < 1500 && !!visit.cacheSize && visit.restoreDisabled !== null, visit)
      // `EXPECTED_VERSION` (celle de package.json) prouve que le build de l'image a grave la bonne version.
      if (process.env.EXPECTED_VERSION)
        check("s4.versionIsThePackageVersion", visit.versionRow?.includes(process.env.EXPECTED_VERSION) ?? false, visit.versionRow)
      await p.waitForFunction(() => document.querySelectorAll("app-run-list tr").length > 1, null, { timeout: 4000 })
      check("s4.runKeepsGoingAfterSettings", true)

      await waitEvents(p, "run_finished", 1)
      if ((await p.locator(".p-dialog").count()) === 0) {
        await p.waitForSelector("[data-arbitration-badge]")
        await p.locator("[data-arbitration-badge]").click()
      }
      await waitDialog(p, /Sub Rosa/)
      const stats = await phaseStats(p, "start_tagging", RUN_LINES, 24)
      s1.runStats = stats
      check(
        "s4.runLinesSpaced200ms",
        stats.lines === 24 && stats.gapMedian >= 170 && stats.gapMedian <= 300 && stats.span >= 4300 && stats.span <= 5600,
        stats,
      )
      if (shots) await p.screenshot({ path: `${shots}/replay-s1-arbitration.png` })

      // Sub Rosa : refus Beatport, liste Bandcamp vide, retour a Beatport, premier candidat.
      let text = await dialogText(p)
      check("s1.subRosaFirst", /Sub Rosa/.test(text) && /Correspondances incertaines : 2/.test(text) && /1\/2/.test(text), text)
      await refuseGesture(p)
      await waitDialog(p, /Aucun candidat trouvé/)
      text = await dialogText(p)
      s1.backStyle = await buttonInfo(p, '.p-dialog [data-action="back"]')
      {
        const box = await p.locator('.p-dialog [data-action="back"]').boundingBox()
        await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await p.waitForTimeout(300)
        s1.backNorm = { color: await norm(p, s1.backStyle.color) }
        s1.backStyle.hoverDecoration = await p.evaluate(() => getComputedStyle(document.querySelector('.p-dialog [data-action="back"]')).textDecorationLine)
      }
      check(
        "s1.bandcampEmptyAfterRefuse",
        /Revenir à Beatport/.test(text) && /Passer/.test(text) && (await optionCount(p)) === 0,
        text,
      )
      await p.locator('.p-dialog [data-action="back"]').click()
      await waitDialog(p, /Correspondances incertaines : 2/)
      check("s1.backToBeatportRestoresList", (await optionCount(p)) === 2)
      await validateFirst(p)
      await waitDialog(p, /Тишина/)
      const afterSubRosa = await badges(p)
      check("s1.queueShrinksAfterSubRosa", /1 à arbitrer/.test(afterSubRosa.arbitration ?? ""), afterSubRosa)

      // Reglages au milieu des arbitrages : la modale se ferme par Echap, le badge la rouvre.
      await closeDialog(p)
      const mid = await settingsVisit(p)
      s1.visitMidArbitration = mid
      check("s4.settingsMidArbitration", mid.ms < 1500 && !!mid.cacheSize, mid)
      await p.locator("[data-arbitration-badge]").click()
      await waitDialog(p, /Тишина/)

      // Тишина : refus Beatport puis refus Bandcamp, vers l'etape lien.
      await refuseGesture(p)
      await waitDialog(p, /Les candidats Beatport ont été refusés/)
      check("s1.tishinaBandcampList", (await optionCount(p)) === 1)
      await refuseGesture(p)
      await waitDialog(p, /Vous avez refusé tous les candidats/)
      text = await dialogText(p)
      check("s1.tishinaLinkStep", /Étape facultative/.test(text) && /Passer/.test(text) && /Résoudre/.test(text), text)
      if (shots) await p.screenshot({ path: `${shots}/replay-s1-link-step-refused.png` })

      // Etape lien d'un morceau refuse : champ libre, « Résoudre » grise avec sa raison, meme saisie faite.
      s1.linkRefused = await p.evaluate(() => {
        const i = document.querySelector('[data-field="url"]')
        const d = document.querySelector(".p-dialog")
        const form = document.querySelector("app-url-link-form")
        return {
          value: i.value,
          readOnly: i.readOnly,
          inputSmall: i.classList.contains("p-inputtext-sm"),
          inputWidth: Math.round(i.getBoundingClientRect().width),
          formWidth: Math.round(form.getBoundingClientRect().width),
          dialog: { w: Math.round(d.getBoundingClientRect().width), h: Math.round(d.getBoundingClientRect().height) },
          counterInFooter: !!d.querySelector(".p-dialog-footer p-badge"),
          footerButtons: [...d.querySelectorAll(".p-dialog-footer button")].map((b) => b.dataset.action ?? b.textContent.trim()),
          formChildHeights: [...form.children].map((c) => Math.round(c.getBoundingClientRect().height)),
        }
      })
      const refusedTip = await hoverTip(p, '[data-action="resolve-url"]')
      s1.refusedTip = refusedTip
      check(
        "s5.refusedTrackResolveGreyed",
        !s1.linkRefused.readOnly &&
          s1.linkRefused.value === "" &&
          refusedTip.disabled &&
          refusedTip.tip === "Indisponible dans la démo." &&
          /Résoudre/.test(refusedTip.label),
        { linkRefused: s1.linkRefused, refusedTip },
      )
      await p.locator('[data-field="url"]').fill("https://example.test/track/typed")
      const typedState = await p.evaluate(() => document.querySelector('[data-action="resolve-url"]').disabled)
      check("s5.refusedTrackStaysGreyedWhenTyped", typedState === true, typedState)
      await p.locator('[data-field="url"]').fill("")
      s1.resolveInfo = await buttonInfo(p, '[data-action="resolve-url"]')
      s1.skipInfo = await buttonInfo(p, '[data-action="skip"]')
      await p.locator('.p-dialog [data-action="skip"]').click()
      await waitNoDialog(p)
      const afterTishina = await badges(p)
      const recoveryCounter = await counter(p)
      check(
        "s3.recoveryTotalFollowsOutcomes",
        /2 à rattraper/.test(afterTishina.recovery ?? "") && afterTishina.arbitration === null && /0 sur 2 rattrapés/.test(recoveryCounter),
        { afterTishina, recoveryCounter },
      )

      // Lowlands : URL enregistree, lecture seule, « Résoudre » actif.
      const before = await lowlandsRecovery(p)
      s1.lowlandsBefore = before
      check(
        "s5.lowlandsPrefilledReadOnly",
        /^https:\/\/[a-z0-9.-]+\.example\//.test(before.url) && before.readOnly && !before.disabled && !before.resolveDisabled,
        before,
      )
      const resolveCmds = await commandCount(p, "resolve_by_url")
      check("s5.lowlandsResolveSendsOneCommand", resolveCmds === 1, resolveCmds)
      await waitCounter(p, /1 sur 2 rattrapés/)
      await waitDialog(p, /Rattrapé sur/)
      const resolveStats = await phaseStats(p, "resolve_by_url", ["track_resolved", "progress"], 2)
      s1.resolveStats = resolveStats
      check(
        "s1.lowlandsResolved",
        resolveStats.lines === 2 && resolveStats.gapMedian >= 170 && resolveStats.gapMedian <= 300,
        resolveStats,
      )
      if (shots) await p.screenshot({ path: `${shots}/replay-s1-lowlands-resolved.png` })
      await closeDialog(p)

      // Lowlands deja rattrape, rouvert par sa ligne : « Résoudre » grise avec la raison, aucune commande ne part.
      await p.locator("app-run-list tr", { hasText: "Lowlands" }).first().click({ position: { x: 300, y: 20 } })
      await waitDialog(p, /Lowlands/)
      const commandsBefore = await commandCount(p)
      const lowlandsAgain = await hoverTip(p, '[data-action="resolve-url"]')
      s1.lowlandsAgain = lowlandsAgain
      await p.mouse.click(lowlandsAgain.box.x + lowlandsAgain.box.width / 2, lowlandsAgain.box.y + lowlandsAgain.box.height / 2)
      await p.waitForTimeout(400)
      const commandsAfter = await commandCount(p)
      check(
        "s5.lowlandsRecoveredGreyed",
        lowlandsAgain.disabled && lowlandsAgain.tip === "Indisponible dans la démo." && commandsBefore === commandsAfter,
        { lowlandsAgain, commandsBefore, commandsAfter },
      )
      await closeDialog(p)

      // Тишина refuse, rouvert par le badge : meme raison.
      await p.locator("[data-recovery-badge]").click()
      await waitDialog(p, /Résoudre/)
      if (!/Тишина/.test(await dialogText(p))) {
        await p.getByRole("button", { name: /Morceau suivant/ }).click()
        await waitDialog(p, /Тишина/)
      }
      const tishinaRecovery = await hoverTip(p, '[data-action="resolve-url"]')
      check(
        "s5.refusedTrackViaBadgeGreyed",
        tishinaRecovery.disabled && tishinaRecovery.tip === "Indisponible dans la démo.",
        tishinaRecovery,
      )
      await closeDialog(p)

      // Confirmation puis ecriture avec un echec.
      await p.locator('[data-action="commit"]').click()
      const commitMessage = await confirmAccept(p, /Écrire les tags/)
      s1.commitMessage = commitMessage
      check("s1.commitConfirmation", /Dossier/.test(commitMessage) && /Fichiers à réécrire/.test(commitMessage), commitMessage)
      await waitEvents(p, "run_finished", 2)
      const writeStats = await phaseStats(p, "commit_run", ["track_resolved", "progress", "run_finished"], 60)
      s1.writeStats = writeStats
      check(
        "s1.writeLinesSpaced200ms",
        writeStats.lines >= 15 &&
          writeStats.gapMedian >= 170 &&
          writeStats.gapMedian <= 300 &&
          Math.abs(writeStats.span - (writeStats.lines - 1) * 200) <= 250,
        writeStats,
      )
      await p.waitForSelector("[data-write-failures]")
      const failure = flat(await p.locator("[data-write-failures]").innerText())
      s1.writeFailure = failure
      check("s1.oneWriteFailure", /échec d'écriture : ?1\b/.test(failure), failure)
      if (shots) await p.screenshot({ path: `${shots}/replay-s1-write-failed.png` })
      await p.waitForFunction(() => document.querySelector('[data-action="retry"]')?.disabled === false)
      await p.locator('[data-action="retry"]').click()
      await confirmAccept(p, /Relancer l'écriture/)
      await waitEvents(p, "run_finished", 3)
      await p.waitForSelector('[data-action="recap"]')
      await p.waitForFunction(() => !document.querySelector("[data-write-failures]"))
      check("s1.retryWritesTheLockedFile", true)
      // Le run est ecrit : « Lancer le run » reprend la place du bouton, grise des l'ecriture et non de la restauration.
      const startWritten = await hoverTip(p, '[data-action="start"]')
      s1.startWritten = startWritten
      check(
        "s6.secondRunGreyedAfterWrite",
        startWritten.disabled && startWritten.tip === "Indisponible dans la démo." && /Lancer le run/.test(startWritten.label),
        startWritten,
      )

      // Recapitulatif.
      await p.locator('[data-action="recap"]').click()
      await p.waitForURL(/\/tagging\/recap/)
      await p.waitForSelector("app-run-list tr")
      s1.recap = await recapCounters(p)
      check("s1.recapCounters", s1.recap.length === 4 && s1.recap.every((t) => /\d+$/.test(t)), s1.recap)
      if (shots) await p.screenshot({ path: `${shots}/replay-s1-recap.png` })
      await p.locator('[data-action="back"]').click()
      await p.waitForSelector("app-tagging-page")

      // Restauration du run.
      await p.locator('[data-action="restore-run"]').click()
      const restoreMessage = await confirmAccept(p, /^Restaurer$/)
      await waitEvents(p, "rollback_finished", 1)
      await p.waitForTimeout(600)
      const restored = await p.evaluate(() =>
        [...document.querySelectorAll("app-run-list app-state-tag")].filter((e) => /Restauré/.test(e.textContent)).length,
      )
      const expected = Number((restoreMessage.match(/Fichiers à restaurer : (\d+)/) ?? [])[1])
      s1.restore = { restoreMessage, restored, expected }
      check("s1.restoredRows", restored > 0 && restored === expected, s1.restore)
      if (shots) await p.screenshot({ path: `${shots}/replay-s1-restored.png` })

      // « Lancer le run » apres l'ecriture : grise, meme raison.
      const start = await hoverTip(p, '[data-action="start"]')
      s1.startAfter = start
      s1.startInfo = await buttonInfo(p, '[data-action="start"]')
      check(
        "s6.secondRunGreyed",
        start.disabled && start.tip === "Indisponible dans la démo." && /Lancer le run/.test(start.label),
        start,
      )

      // « Recommencer la démo » en FR : retour sur Playlist, francais, run oublie.
      await Promise.all([p.waitForURL(`${base}/playlist`), p.locator('[data-action="restart"]').click()])
      await p.waitForSelector("app-playlist-page")
      await p.waitForTimeout(600)
      const reset = await p.evaluate(() => ({
        lang: document.documentElement.lang,
        h1: document.querySelector("h1")?.textContent.trim(),
        commands: window.__commands.map((c) => c.command),
      }))
      await p.locator("p-tab").nth(1).click()
      await p.waitForSelector("app-tagging-page app-empty-state")
      const empty = flat(await p.locator("app-tagging-page app-empty-state").innerText())
      check(
        "s6.restartFrAfterWrite",
        reset.lang === "fr" &&
          reset.h1 === "Playlist" &&
          /Aucun run lancé/.test(empty) &&
          reset.commands.every((c) => c === "get_version" || c === "get_interrupted_run"),
        { reset, empty },
      )
    })
    await context.close()
  }

  // =====================================================================================
  // 2 : ordre libre : Lowlands d'abord, puis Тишина avant Sub Rosa ; cadence du run sans detour par les Reglages
  // =====================================================================================
  if (on("s2")) {
    const { context, p } = await fresh("s2")
    await guard("s2", p, async () => {
      await pickAndExtract(p, "fr")
      await goTagging(p)
      await startRun(p)
      await runFinished(p)
      const stats = await phaseStats(p, "start_tagging", RUN_LINES, 24)
      measures.s2RunStats = stats
      const steps = stats.counterValues.filter((v) => /^\d+ sur 11$/.test(v))
      check(
        "s4.progressAdvancesLineByLine",
        steps.length === 11 &&
          stats.lines === 24 &&
          stats.gapMedian >= 170 &&
          stats.gapMedian <= 300 &&
          stats.span >= 4300 &&
          stats.span <= 5600 &&
          stats.counterStepMedian >= 300 &&
          stats.counterStepMedian <= 520,
        stats,
      )
      // Lowlands en premier : seul morceau a rattraper, les deux autres en attente.
      await closeDialog(p)
      await waitCounter(p, /0 sur 1 rattrapés/)
      const first = await lowlandsRecovery(p)
      await waitCounter(p, /1 sur 1 rattrapés/)
      check("s3.lowlandsFirstFollowsCounter", first.readOnly && /1 sur 1 rattrapés/.test(await counter(p)), {
        first,
        counter: await counter(p),
      })
      await closeDialog(p)
      // Тишина avant Sub Rosa : fleche suivante dans la modale d'arbitrage.
      await p.locator("[data-arbitration-badge]").click()
      await waitDialog(p, /Sub Rosa/)
      await p.getByRole("button", { name: /Arbitrage suivant/ }).click()
      await waitDialog(p, /Тишина/)
      await validateFirst(p)
      await waitDialog(p, /Sub Rosa/)
      const afterTishina = await dialogText(p)
      check("s3.tishinaBeforeSubRosa", /1\/1/.test(afterTishina) && /Correspondances incertaines : 2/.test(afterTishina), afterTishina)
      await validateFirst(p)
      await waitNoDialog(p)
      await p.waitForFunction(() => !document.querySelector("[data-arbitration-badge]"))
      const rows = await p.evaluate(() =>
        [...document.querySelectorAll("app-run-list tr")]
          .map((r) => r.textContent.replace(/\s+/g, " ").trim())
          .filter((t) => /Lowlands|Sub Rosa|Тишина/.test(t)),
      )
      check(
        "s3.finalStates",
        rows.length === 3 && rows.filter((t) => /Arbitré$/.test(t)).length === 2 && rows.filter((t) => /URL$/.test(t)).length === 1,
        rows.map((t) => t.slice(-24)),
      )
      await p.locator('[data-action="commit"]').click()
      measures.s2Commit = await confirmAccept(p, /Écrire les tags/)
      await waitEvents(p, "run_finished", 2)
      await p.waitForSelector("[data-write-failures]")
    })
    await context.close()
  }

  // =====================================================================================
  // 3 : « les choix changent la fin » : Sub Rosa accepte ou refuse, le reste identique
  // =====================================================================================
  const finish = async (p, subRosa) => {
    await pickAndExtract(p, "fr")
    await goTagging(p)
    await startRun(p)
    await runFinished(p)
    await waitDialog(p, /Sub Rosa/)
    if (subRosa === "first") {
      await validateFirst(p)
    } else {
      await refuseGesture(p)
      await waitDialog(p, /Aucun candidat trouvé/)
      await refuseGesture(p)
      await waitDialog(p, /Étape facultative/)
      await p.locator('.p-dialog [data-action="skip"]').click()
      await p.waitForTimeout(700)
      if ((await p.locator(".p-dialog").count()) === 0) await p.locator("[data-arbitration-badge]").click()
    }
    await waitDialog(p, /Тишина/)
    await validateFirst(p)
    await waitNoDialog(p)
    await lowlandsRecovery(p)
    await waitDialog(p, /Rattrapé sur/)
    await closeDialog(p)
    await p.locator('[data-action="commit"]').click()
    const message = await confirmAccept(p, /Écrire les tags/)
    await waitEvents(p, "run_finished", 2)
    await p.waitForFunction(() => document.querySelector('[data-action="retry"]')?.disabled === false)
    await p.locator('[data-action="retry"]').click()
    await confirmAccept(p, /Relancer l'écriture/)
    await waitEvents(p, "run_finished", 3)
    await p.waitForSelector('[data-action="recap"]')
    await p.locator('[data-action="recap"]').click()
    await p.waitForURL(/\/tagging\/recap/)
    await p.waitForSelector("app-run-list tr")
    return { count: Number((message.match(/Titre » : (\d+)/) ?? [])[1]), message, recap: await recapCounters(p) }
  }
  const outcomes = {}
  for (const choice of on("s3") ? ["first", "refuse"] : []) {
    const { context, p } = await fresh(`s3-${choice}`)
    await guard(`s3.${choice}`, p, async () => {
      outcomes[choice] = await finish(p, choice)
      if (shots) await p.screenshot({ path: `${shots}/replay-s3-${choice}-recap.png` })
    })
    await context.close()
  }
  measures.s3 = outcomes
  if (on("s3"))
    check(
    "s3.choicesChangeTheEnd",
    !!outcomes.first &&
      !!outcomes.refuse &&
      outcomes.first.count !== outcomes.refuse.count &&
      JSON.stringify(outcomes.first.recap) !== JSON.stringify(outcomes.refuse.recap),
    outcomes,
  )

  // =====================================================================================
  // 4 : « Restart the demo » en anglais, en plein run
  // =====================================================================================
  if (on("s4")) {
    const { context, p } = await fresh("s4")
    await guard("s4", p, async () => {
      await pickAndExtract(p, "en")
      await goTagging(p)
      await startRun(p)
      await p.waitForTimeout(1500)
      const midRun = await counter(p)
      await Promise.all([p.waitForURL(`${base}/playlist`), p.locator('[data-action="restart"]').click()])
      await p.waitForSelector("app-playlist-page")
      await p.waitForTimeout(800)
      const reset = await p.evaluate(() => ({
        lang: document.documentElement.lang,
        h1: document.querySelector("h1")?.textContent.trim(),
        restart: document.querySelector('[data-action="restart"]')?.textContent.trim(),
        commands: window.__commands.map((c) => c.command),
        report: !!document.querySelector("app-playlist-page [role=region]"),
      }))
      await p.locator("p-tab").nth(1).click()
      await p.waitForSelector("app-tagging-page app-empty-state")
      const empty = flat(await p.locator("app-tagging-page app-empty-state").innerText())
      check(
        "s6.restartEnMidRun",
        /\d/.test(midRun) &&
          reset.lang === "en" &&
          reset.h1 === "Playlist" &&
          reset.restart === "Restart the demo" &&
          !reset.report &&
          /No run yet/.test(empty) &&
          reset.commands.every((c) => c === "get_version" || c === "get_interrupted_run"),
        { midRun, reset, empty },
      )
    })
    await context.close()
  }

  // =====================================================================================
  // Ecart connu (decision du 2026-10-26) : arbitrer dans la fenetre de ~2,4 s avant `run_finished` rejoue le
  // dernier `progress` enregistre du tagging, qui peut remettre le total du rattrapage a 1. Releve, sans verdict
  // sur le total : seules les lignes et les etats doivent rester justes.
  // =====================================================================================
  if (on("gap")) {
    const { context, p } = await fresh("gap")
    await guard("gap", p, async () => {
      await pickAndExtract(p, "fr")
      await goTagging(p)
      await startRun(p)
      await waitDialog(p, /Sub Rosa/, 6000)
      await refuseGesture(p)
      await waitDialog(p, /Aucun candidat trouvé/)
      await refuseGesture(p)
      await waitDialog(p, /Étape facultative/)
      const duringRun = { run_finished: await p.evaluate(() => window.__events.filter((e) => e.event === "run_finished").length), counter: await counter(p) }
      await p.locator('.p-dialog [data-action="skip"]').click()
      await waitEvents(p, "run_finished", 1)
      await p.waitForTimeout(800)
      const after = { counter: await counter(p), badges: await badges(p) }
      const subRosa = await p.locator("app-run-list tr", { hasText: "Sub Rosa" }).first().innerText()
      measures.gap = { duringRun, after, subRosaRow: flat(subRosa).slice(-40) }
      check("gap.rowStaysRight", /Non résolu/.test(subRosa), measures.gap)
    })
    await context.close()
  }

  // =====================================================================================
  // 5 : bandeau au plancher 1024 x 700, FR et EN
  // =====================================================================================
  const banner = {}
  for (const lang of ["fr", "en"]) {
    const { context, p } = await fresh(`s5-${lang}`, { viewport: { width: 1024, height: 700 } })
    await guard(`s5.${lang}`, p, async () => {
      await p.goto(`${base}/?lang=${lang}`)
      await p.waitForSelector("app-demo-banner a")
      await p.waitForTimeout(600)
      const m = await p.evaluate(() => {
        const banner = document.querySelector("app-demo-banner")
        const cs = getComputedStyle(banner)
        const r = banner.getBoundingClientRect()
        const rect = (e) => {
          const b = e.getBoundingClientRect()
          return { l: b.left, r: b.right, cy: (b.top + b.bottom) / 2 }
        }
        const icon = banner.querySelector("app-icon")
        const text = banner.querySelector("span")
        const contact = banner.querySelector('[data-action="contact"]')
        const restart = banner.querySelector('[data-action="restart"]')
        const style = (e) => {
          const s = getComputedStyle(e)
          return {
            tag: e.tagName.toLowerCase(),
            classes: [...e.classList].filter((c) => /^p-button/.test(c)).sort(),
            text: e.textContent.replace(/\s+/g, " ").trim(),
            color: s.color,
            background: s.backgroundColor,
            border: s.borderTopWidth,
            padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
            fontSize: s.fontSize,
            decoration: s.textDecorationLine,
            svgs: [...e.querySelectorAll("svg")].map((v) => Math.round(v.getBoundingClientRect().width)),
          }
        }
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight)
        return {
          height: Math.round(r.height),
          width: Math.round(r.width),
          borderBottom: cs.borderBottomWidth,
          borderColor: cs.borderBottomColor,
          background: cs.backgroundColor,
          color: cs.color,
          fontSize: cs.fontSize,
          justify: cs.justifyContent,
          scrollOverflow: banner.scrollWidth > banner.clientWidth,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          textLines: Math.round(text.getBoundingClientRect().height / lineHeight),
          iconSize: icon ? Math.round(icon.getBoundingClientRect().width) : null,
          iconTextGap: Math.round(rect(text).l - rect(icon).r),
          textContactGap: Math.round(rect(contact).l - rect(text).r),
          linksGap: Math.round(rect(restart).l - rect(contact).r),
          labelToIconGap: (() => {
            const range = document.createRange()
            range.selectNodeContents([...contact.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()))
            return Math.round(contact.querySelector("svg").getBoundingClientRect().left - range.getBoundingClientRect().right)
          })(),
          leftSpace: Math.round(rect(icon).l - r.left),
          rightSpace: Math.round(r.right - rect(restart).r),
          centres: [icon, text, contact, restart].map((e) => Math.round(rect(e).cy * 10) / 10),
          sameLine: [icon, text, contact, restart].every((e) => Math.abs(rect(e).cy - rect(icon).cy) <= 1),
          order: [...banner.children].map((e) => e.getAttribute("data-action") ?? e.tagName.toLowerCase()),
          contact: style(contact),
          restart: style(restart),
          contactHref: contact.getAttribute("href"),
        }
      })
      m.hover = {}
      for (const name of ["contact", "restart"]) {
        const box = await p.locator(`app-demo-banner [data-action="${name}"]`).boundingBox()
        await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await p.waitForTimeout(300)
        m.hover[name] = await p.evaluate(
          (n) => getComputedStyle(document.querySelector(`app-demo-banner [data-action="${n}"]`)).textDecorationLine,
          name,
        )
      }
      m.tokens = {
        surface900: await tokenColor(p, "var(--p-surface-900)"),
        surface800: await tokenColor(p, "var(--p-surface-800)"),
        muted: await tokenColor(p, "var(--p-text-muted-color)"),
        primary: await tokenColor(p, "var(--p-primary-color)"),
      }
      m.n = {
        border: await norm(p, m.borderColor),
        background: await norm(p, m.background),
        color: await norm(p, m.color),
        contact: await norm(p, m.contact.color),
        restart: await norm(p, m.restart.color),
        contactBg: await norm(p, m.contact.background),
        restartBg: await norm(p, m.restart.background),
      }
      banner[lang] = m
      if (shots) await p.screenshot({ path: `${shots}/replay-banner-${lang}-1024.png`, clip: { x: 0, y: 0, width: 1024, height: 120 } })
      check(
        `s5.${lang}.oneLineNoOverflow`,
        m.height === 32 && m.textLines === 1 && m.sameLine && !m.scrollOverflow && !m.pageOverflow,
        { height: m.height, lines: m.textLines, sameLine: m.sameLine, centres: m.centres, scrollOverflow: m.scrollOverflow, pageOverflow: m.pageOverflow },
      )
      check(`s5.${lang}.twoLinksInOrder`, JSON.stringify(m.order) === JSON.stringify(["app-icon", "span", "contact", "restart"]), m.order)
      check(
        `s5.${lang}.linkVariant`,
        m.contact.classes.includes("p-button-link") && m.restart.classes.includes("p-button-link") && m.contact.tag === "a" && m.restart.tag === "button",
        { contact: m.contact.classes, restart: m.restart.classes },
      )
      check(
        `s5.${lang}.iconsOnly`,
        m.contact.svgs.length === 1 && m.contact.svgs[0] === 16 && m.restart.svgs.length === 0 && m.iconSize === 16,
        { contact: m.contact.svgs, restart: m.restart.svgs, icon: m.iconSize },
      )
      m.hoverRef = null
    })
    await context.close()
  }
  measures.banner = banner

  // =====================================================================================
  // 6 : fidelite au design system (mesures prises aux etapes ci-dessus et au bandeau)
  // =====================================================================================
  {
    const { context, p } = await fresh("s6-tokens", { viewport: { width: 1024, height: 700 } })
    await guard("s6", p, async () => {
      await p.goto(`${base}/?lang=fr`)
      await p.waitForSelector("app-demo-banner")
      measures.surface700 = await tokenColor(p, "var(--p-surface-700)")
    })
    await context.close()
  }
  for (const lang of ["fr", "en"]) {
    const m = banner[lang]
    if (!m) continue
    check(
      `f.${lang}.bannerTokens`,
      m.height === 32 &&
        m.borderBottom === "1px" &&
        m.n.border === m.tokens.surface800 &&
        m.n.background === m.tokens.surface900 &&
        m.fontSize === "12px" &&
        m.n.color === m.tokens.muted &&
        m.justify === "center",
      {
        height: m.height,
        border: [m.borderBottom, m.n.border, m.tokens.surface800],
        bg: [m.n.background, m.tokens.surface900],
        font: m.fontSize,
        color: [m.n.color, m.tokens.muted],
        justify: m.justify,
      },
    )
    check(`f.${lang}.bannerCentred`, Math.abs(m.leftSpace - m.rightSpace) <= 1, { left: m.leftSpace, right: m.rightSpace })
    check(
      `f.${lang}.linkStyleIsLinkVariant`,
      m.n.contact === m.tokens.primary &&
        m.n.restart === m.tokens.primary &&
        m.n.contactBg.endsWith(",0") &&
        m.n.restartBg.endsWith(",0") &&
        [m.contact, m.restart].every((s) => s.border === "0px" && s.fontSize === "12px" && s.decoration === "none"),
      { contact: m.contact, restart: m.restart, n: m.n, primary: m.tokens.primary },
    )
    // « Revenir a Beatport » (arbitrage) est la reference d'un bouton `link` : memes couleur, fond et padding.
    const ref = s1.backStyle
    if (ref && lang === "fr") {
      check(
        "f.linkMatchesRevenirABeatport",
        [m.contact, m.restart].every((s) => s.padding === ref.padding && s.fontSize === ref.fontSize) &&
          m.n.contact === (s1.backNorm?.color ?? m.n.contact),
        { contact: m.contact, restart: m.restart, ref },
      )
      // Le survol d'un lien `link` : memes soulignement que « Revenir a Beatport », le lien de reference.
      check(
        `f.${lang}.hoverLikeReferenceLink`,
        m.hover.contact === ref.hoverDecoration && m.hover.restart === ref.hoverDecoration,
        { banner: m.hover, reference: ref.hoverDecoration },
      )
    }
  }
  if (s1.cancel) {
    const tips = [s1.cancel, s1.refusedTip, s1.lowlandsAgain, s1.startAfter]
    check(
      "f.tooltipUnderButtonDelayed",
      tips.every((t) => t && t.tip && t.tipTop >= t.btnBottom && t.early === false && t.arrow && t.pointerEvents === "none" && Math.abs(t.centreOffset) <= 2),
      tips.map((t) => t && { tip: t.tip, tipTop: t.tipTop, btnBottom: t.btnBottom, early: t.early, arrow: t.arrow, pe: t.pointerEvents, off: t.centreOffset }),
    )
    check(
      "f.tooltipSurface700Narrow",
      [s1.cancel, s1.refusedTip].every((t) => t?.tipBackgroundN === measures.surface700 && t.tipWidth <= 220),
      { bg: s1.cancel?.tipBackground, expected: measures.surface700, widths: [s1.cancel?.tipWidth, s1.refusedTip?.tipWidth] },
    )
    check(
      "f.disabledKeepsLabelAndArrow",
      [s1.cancelInfo, s1.resolveInfo, s1.startInfo].every((b) => b && b.disabled && b.label.length > 0 && b.cursor === "default"),
      [s1.cancelInfo, s1.resolveInfo, s1.startInfo],
    )
    check(
      "f.runActionButtons",
      !!s1.cancelInfo && !!s1.startInfo && s1.cancelInfo.classes.includes("p-button-outlined") &&
        s1.cancelInfo.classes.includes("p-button-secondary") &&
        s1.cancelInfo.classes.includes("p-button-sm") &&
        s1.cancelInfo.icons.length === 1 &&
        s1.cancelInfo.icons[0] === 16 &&
        !s1.startInfo.classes.includes("p-button-outlined") &&
        !s1.startInfo.classes.includes("p-button-secondary") &&
        s1.startInfo.classes.includes("p-button-sm") &&
        s1.startInfo.icons[0] === 16,
      { cancel: s1.cancelInfo?.classes, start: s1.startInfo?.classes },
    )
  }
  if (s1.linkRefused) {
    const l = s1.linkRefused
    check(
      "f.linkStepFrame",
      l.dialog.w === 720 &&
        l.dialog.h === 560 &&
        !l.counterInFooter &&
        l.footerButtons.join() === "skip,resolve-url" &&
        l.inputSmall &&
        l.inputWidth === l.formWidth &&
        l.formChildHeights[0] >= 32 &&
        l.formChildHeights[l.formChildHeights.length - 1] >= 54,
      l,
    )
    check(
      "f.linkStepButtons",
      !!s1.skipInfo && !!s1.resolveInfo && s1.skipInfo.classes.includes("p-button-outlined") &&
        s1.skipInfo.classes.includes("p-button-secondary") &&
        s1.skipInfo.classes.includes("p-button-sm") &&
        !s1.resolveInfo.classes.includes("p-button-outlined") &&
        s1.resolveInfo.classes.includes("p-button-sm"),
      { skip: s1.skipInfo?.classes, resolve: s1.resolveInfo?.classes },
    )
  }

  // --- console ---
  const unrecorded = consoleAll.filter((c) => c.text.includes("[demo] commande hors scenario"))
  const errors = consoleAll.filter((c) => c.type === "error" && !c.text.includes("Failed to load resource"))
  check("console.noUnrecordedCommand", unrecorded.length === 0, unrecorded)
  check("console.noErrors", errors.length === 0 && pageErrors.length === 0, { errors, pageErrors })
  const cspViolations = consoleAll.filter((c) => /Content Security Policy/i.test(c.text))
  check("console.noCspViolation", cspViolations.length === 0, cspViolations)
  check("network.sameOriginOnly", foreignRequests.length === 0, foreignRequests.slice(0, 10))

  return {
    success: failures.length === 0,
    failures,
    checks,
    measures: { ...measures, s1 },
    unrecordedCount: unrecorded.length,
    consoleErrorCount: errors.length,
  }
}
