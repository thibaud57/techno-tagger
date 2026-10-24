// Confirmation et suivi de l'ecriture sous `ng serve`, sidecar simule sur l'instance du service :
// un controle par regle de SKILL.md § Pilotage de la confirmation d'ecriture.
// Lance par le MCP Playwright : `browser_run_code_unsafe` avec `filename` sur ce fichier,
// `just dev-ui` servant http://localhost:4200. Captures dans .playwright-mcp/verify-write/.
async (page) => {
  const DIR = ".playwright-mcp/verify-write/"
  const FOLDER = "C:\\Musique\\Extraction"
  const out = { checks: {}, failures: [], measures: {} }
  const check = (name, ok, detail) => {
    out.checks[name] = ok ? "ok" : detail
    if (!ok) out.failures.push(`${name}: ${JSON.stringify(detail)}`)
  }
  const shot = (name) => page.screenshot({ path: `${DIR}${name}.png` })
  const line = (event) => page.evaluate((e) => window.__svc.handleLine(JSON.stringify(e)), event)
  const settle = (ms = 500) => page.waitForTimeout(ms)
  const sent = () => page.evaluate(() => window.__sent.map((c) => c.command))
  const clearSent = () => page.evaluate(() => (window.__sent = []))
  const setFolder = (folder) =>
    page.evaluate((f) => ng.getComponent(document.querySelector("app-tagging-page")).folder.set(f), folder)
  /** Le bouton d'action unique de la rangee du dossier. */
  const action = () =>
    page.evaluate(() => {
      const buttons = [...document.querySelectorAll("app-tagging-page .grid > button[data-action]")]
      const b = buttons[0]
      if (!b) return null
      return {
        count: buttons.length,
        text: b.textContent.trim(),
        action: b.getAttribute("data-action"),
        disabled: b.disabled,
        danger: b.classList.contains("p-button-danger"),
        outlined: b.classList.contains("p-button-outlined"),
        secondary: b.classList.contains("p-button-secondary"),
        small: b.classList.contains("p-button-sm"),
        icon: b.querySelector("[data-p-icon]")?.getAttribute("data-p-icon") ?? null,
        width: Math.round(b.getBoundingClientRect().width),
        right: Math.round(b.closest(".grid").getBoundingClientRect().right - b.getBoundingClientRect().right),
      }
    })
  const confirmDialog = () =>
    page.evaluate(() => {
      const d = [...document.querySelectorAll(".p-confirmdialog")].find((x) => x.offsetParent !== null)
      if (!d) return null
      const buttons = [...d.querySelectorAll(".p-dialog-footer button")]
      const cls = (b) => [...b.classList].filter((c) => c.startsWith("p-button-"))
      return {
        header: d.querySelector(".p-dialog-title")?.textContent.trim(),
        message: d.querySelector(".p-dialog-content p")?.textContent.trim(),
        messageStyle: (() => {
          const m = d.querySelector(".p-dialog-content p")
          return m && { size: getComputedStyle(m).fontSize, muted: m.classList.contains("text-muted-color"), whiteSpace: getComputedStyle(m).whiteSpace }
        })(),
        icon: !!d.querySelector(".p-confirmdialog-icon"),
        buttons: buttons.map((b) => ({ text: b.textContent.trim(), cls: cls(b) })),
        focused: document.activeElement?.textContent.trim() ?? null,
        width: Math.round(d.getBoundingClientRect().width),
      }
    })
  const confirmButton = (text) =>
    page.locator(".p-confirmdialog .p-dialog-footer button", { hasText: text }).first()
  const bar = () =>
    page.evaluate(() => {
      const p = document.querySelector("app-tagging-page app-phase-progress")
      if (!p) return null
      return {
        text: p.textContent.replace(/\s+/g, " ").trim(),
        indeterminate: !!p.querySelector(".p-progressbar-indeterminate"),
      }
    })
  const failures = () =>
    page.evaluate(() => {
      const m = document.querySelector("[data-write-failures]")
      if (!m) return null
      const text = m.querySelector(".whitespace-pre-line")
      return {
        text: m.textContent.replace(/[ \t\r\n]+/g, " ").trim(),
        raw: text?.textContent.trim() ?? null,
        whiteSpace: text ? getComputedStyle(text).whiteSpace : null,
        severity: [...m.querySelectorAll("*")].some((x) => x.classList.contains("p-message-error")) || m.classList.contains("p-message-error"),
        buttons: m.querySelectorAll("button").length,
        icon: m.querySelector(".p-message-icon [data-p-icon], [data-p-icon=\"times-circle\"]")?.getAttribute("data-p-icon") ?? null,
        aboveList: m.getBoundingClientRect().bottom <= document.querySelector("app-run-list").getBoundingClientRect().top,
      }
    })
  const rowState = (text) =>
    page.evaluate((t) => {
      const r = [...document.querySelectorAll("app-run-list tbody tr")].find((x) => x.textContent.includes(t))
      if (!r) return null
      const cell = r.querySelector("app-state-tag")
      const tag = cell?.querySelector(".p-tag")
      return {
        label: tag?.textContent.trim(),
        severity: [...(tag?.classList ?? [])].find((c) => /^p-tag-(success|danger|info|warn|secondary)$/.test(c)) ?? null,
        icon: tag?.querySelector("[data-p-icon]")?.getAttribute("data-p-icon") ?? null,
        info: !!r.querySelector('app-icon[name="info-circle"], [data-p-icon="info-circle"]'),
        tabindex: r.getAttribute("tabindex"),
        skeleton: !!r.querySelector("p-skeleton"),
        tagHeight: tag ? Math.round(tag.getBoundingClientRect().height) : null,
        tagWrapped: tag ? tag.getBoundingClientRect().height > 30 : null,
        spanFits: (() => {
          const span = cell?.closest("span.inline-flex")
          const td = cell?.closest("td")
          if (!span || !td) return null
          const style = getComputedStyle(td)
          return span.getBoundingClientRect().width <= td.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 0.5
        })(),
      }
    }, text)
  const dialogsShown = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("app-arbitration-dialog .p-dialog, app-url-recovery-dialog .p-dialog")].filter((d) => d.offsetParent !== null).length,
    )
  const badges = () =>
    page.evaluate(() => ({
      arbitration: !!document.querySelector("[data-arbitration-badge]"),
      recovery: !!document.querySelector("[data-recovery-badge]"),
    }))
  const closeDialogs = async () => {
    for (const sel of ["app-arbitration-dialog", "app-url-recovery-dialog"]) {
      const shown = await page.evaluate((s) => [...document.querySelectorAll(`${s} .p-dialog`)].some((d) => d.offsetParent !== null), sel)
      if (shown) {
        await page.locator(`${sel} .p-dialog-header button`).first().click()
        await settle(600)
      }
    }
  }
  const closeConfirmation = () =>
    page.evaluate(() => {
      const d = [...document.querySelectorAll("app-close-confirmation .p-dialog")].find((x) => x.offsetParent !== null)
      if (!d) return null
      return {
        title: d.querySelector(".p-dialog-header")?.textContent.trim(),
        items: [...d.querySelectorAll("li")].map((li) => li.textContent.trim()),
        buttons: [...d.querySelectorAll(".p-dialog-footer button")].map((b) => ({ text: b.textContent.trim(), danger: b.classList.contains("p-button-danger") })),
      }
    })
  const requestClose = () =>
    page.evaluate(() => window.__guard._request.set(window.__guard.pendingWork()))
  const stay = async () => {
    await page.locator("app-close-confirmation .p-dialog-footer button", { hasText: "Rester" }).click()
    await settle(600)
  }

  const t = (i, artist, title) => ({
    track_id: `${i} ${artist.toLowerCase()} - ${title.toLowerCase()}.mp3`,
    file_name: `${i} ${artist} - ${title}.mp3`,
    artist,
    title,
    tags_before: null,
  })
  const resolved = (x, state = "resolved") => ({ event: "track_resolved", track_id: x.track_id, state, resolution: "auto", failure_reason: null, source: "beatport", after: { artist: x.artist, title: `${x.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 }, artwork_path: null, tags_after: null })
  const writeError = (x) => ({ ...resolved(x, "write_error"), failure_reason: "file_locked" })
  const unresolved = (x) => ({ event: "track_resolved", track_id: x.track_id, state: "unresolved", resolution: "none", failure_reason: "no_result", source: null, after: null, scores: null, artwork_path: null, tags_after: null, recoverable: true })
  const arbitration = (x) => ({ event: "arbitration_required", track_id: x.track_id, source: "beatport", beatport_unavailable: false, empty_reason: null, other_source: "bandcamp", candidates: [{ artist: x.artist, title: `${x.title} (Original Mix)`, label: "Drumcode", year: 2021, scores: { artist: 96, title: 74, average: 85 } }] })
  const finished = (runId, phase, counts) => ({ event: "run_finished", phase, run_id: runId, resolved: 0, unresolved: 0, written: 0, write_error: 0, awaiting_arbitration: 0, ...counts })

  const R1 = t("01", "Adam Beyer", "Your Mind")
  const R2 = t("02", "Amelie Lens", "Basiel")
  const L = t("03", "Hector Oaks", "Sentiment")
  const U = t("04", "Nur Jaber", "Into the Void")
  const A = t("05", "Ignez", "Ark")

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("http://localhost:4200/tagging")
  // Sidecar absent sous `ng serve` : l'ecran bloquant tient la place de la page jusqu'a la simulation.
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
        const provided = Object.values(record).find((v) => typeof v === "function")
        if (provided && /SidecarService$/.test(provided.name)) window.__svc = injector.get(provided)
        if (provided && /CloseGuard$/.test(provided.name)) window.__guard = injector.get(provided)
      }
    }
    window.__sent = []
    window.__svc._available.set(true)
    await new Promise((r) => setTimeout(r, 800))
    window.__svc.send = async (command) => window.__sent.push(command)
  })
  // Version de l'interface lue sur la page (celle que compare `versionMismatch`) : figee ici,
  // elle perimait a chaque release (0.5.0 restait apres la 0.6.0, ecran bloquant, 2026-10-12).
  const VERSION = await page.evaluate(() => {
    window.__svc.handleLine(JSON.stringify({ event: "version", version: "0.0.0-probe", api_key_configured: true }))
    return window.__svc.versionMismatch().ui
  })
  await line({ event: "version", version: VERSION, api_key_configured: true })
  await page.waitForSelector("app-tagging-page")
  await setFolder(FOLDER)
  await settle()

  // 1. Cycle du bouton : lancer, interrompre, confirmer.
  const idle = await action()
  check("idle: single primary small start button, right-aligned", idle?.count === 1 && idle.action === "start" && idle.text === "Lancer le run" && !idle.disabled && !idle.danger && !idle.outlined && idle.small && idle.right === 0, idle)
  await page.locator('[data-action="start"]').click()
  await settle(300)
  const running = await action()
  check("running: start becomes secondary outlined Interrompre with stop icon", running?.count === 1 && running.text === "Interrompre" && running.secondary && running.outlined && running.small && running.icon === "stop", running)
  check("start_tagging sent", (await sent()).includes("start_tagging"), await sent())
  await shot("1-running")
  await line({ event: "run_started", run_id: "run-1", folder: FOLDER, tracks: [R1, R2, L, U, A] })
  for (const e of [resolved(R1), resolved(R2), resolved(L), unresolved(U), arbitration(A)]) await line(e)
  await line({ event: "progress", phase: "tagging", processed: 5, total: 5 })
  await line(finished("run-1", "network", { resolved: 3, unresolved: 1, awaiting_arbitration: 1 }))
  await settle(800)
  await closeDialogs()
  const ready = await action()
  check("search done: Confirmer l'écriture, primary, check icon, enabled", ready?.count === 1 && ready.action === "commit" && ready.text === "Confirmer l'écriture" && !ready.danger && !ready.outlined && ready.small && ready.icon === "check" && !ready.disabled, ready)
  out.measures.buttonWidths = { idle: idle?.width, running: running?.width, commit: ready?.width }
  await shot("2-ready-to-commit")

  // 2. Dossier rechoisi : le meme garde la confirmation, un autre l'abandonne.
  await setFolder(FOLDER)
  await settle(200)
  check("same folder keeps commit", (await action())?.action === "commit", await action())
  await setFolder("C:\\Musique\\Autre")
  await settle(200)
  check("another folder abandons the unwritten run", (await action())?.action === "start", await action())
  await setFolder(FOLDER)
  await settle(200)
  check("choosing the run folder again offers commit", (await action())?.action === "commit", await action())

  // 3. Run cherche non confirme : la fermeture ne le retient plus, le plan de run le rend a la
  // reprise (2026-10-12). La garde ne compte que l'extraction, l'ecriture et le rollback.
  const heldBy = () => page.evaluate(() => window.__guard.pendingWork())
  check("unwritten run: closing holds nothing", (await heldBy()).length === 0, await heldBy())

  // 4. Modale de confirmation : nombres, boutons, focus ; Annuler n'envoie rien.
  await clearSent()
  await page.locator('[data-action="commit"]').click()
  await settle(700)
  const dialog = await confirmDialog()
  out.measures.confirm = dialog
  check("confirm: header", dialog?.header === "Confirmer l'écriture", dialog?.header)
  check("confirm: folder and counts, one per line", dialog?.message.includes(FOLDER) && /Titre\s*»\s*:\s*3(\n|$)/.test(dialog.message) && /intacts\s*:\s*1(\n|$)/.test(dialog.message) && /arbitrer\s*:\s*1\n/.test(dialog.message) && dialog.message.includes("ne pourront plus être arbitrés"), dialog?.message)
  check("confirm: folder, counts and backup guarantee in three blocks", dialog?.message.split("\n\n").length === 3 && /^Dossier\s*:/.test(dialog.message) && /sauvegardés avant l'écriture/.test(dialog.message.split("\n\n")[2]), dialog?.message)
  check("confirm: accept primary, reject secondary outlined, both small, no icon", JSON.stringify(dialog?.buttons.map((b) => b.text)) === JSON.stringify(["Annuler", "Écrire les tags"]) && !/p-button-(danger|secondary|outlined)/.test(dialog.buttons[1].cls) && dialog.buttons[0].cls.includes("p-button-secondary") && dialog.buttons[0].cls.includes("p-button-outlined") && dialog.buttons.every((b) => b.cls.includes("p-button-sm")) && !dialog.icon, dialog)
  check("confirm: focus on Annuler", dialog?.focused === "Annuler", dialog?.focused)
  check("confirm: 30rem wide, message text-sm muted, one sentence per line (fiche ConfirmDialog)", dialog?.width === 480 && dialog.messageStyle?.size === "14px" && dialog.messageStyle.muted && dialog.messageStyle.whiteSpace === "pre-line", { width: dialog?.width, style: dialog?.messageStyle })
  await shot("3-confirm")
  await confirmButton("Annuler").click()
  await settle(500)
  check("Annuler sends nothing", (await sent()).length === 0 && (await confirmDialog()) === null, await sent())

  // 5. Accepter : commit_run, bouton en chargement, run fige.
  await page.locator('[data-action="commit"]').click()
  await settle(600)
  await confirmButton("Écrire les tags").click()
  await settle(500)
  check("accept sends commit_run once", JSON.stringify(await sent()) === JSON.stringify(["commit_run"]), await sent())
  const writing = await action()
  check("writing: commit button loading (spinner) and disabled", writing?.action === "commit" && writing.icon === "spinner" && writing.disabled, writing)
  const barStart = await bar()
  check("write bar shown with its label", barStart?.text.startsWith("Écriture des tags et des pochettes, puis renommage"), barStart)
  await line({ event: "progress", phase: "write", processed: 1, total: 3 })
  await settle(300)
  const barMid = await bar()
  check("write bar counts", barMid?.text.includes("1 sur 3") && !barMid.indeterminate, barMid)
  await shot("4-writing")
  await clearSent()
  await page.locator("app-run-list tbody tr", { hasText: "Nur Jaber" }).first().click()
  await page.locator("app-run-list tbody tr", { hasText: "Ignez" }).first().click()
  await settle(500)
  check("frozen: rows open no dialog and send nothing", (await dialogsShown()) === 0 && (await sent()).length === 0, { dialogs: await dialogsShown(), sent: await sent() })
  const frozenU = await rowState("Nur Jaber")
  const frozenA = await rowState("Ignez")
  check("frozen: no tabindex", frozenU?.tabindex === null && frozenA?.tabindex === null, [frozenU?.tabindex, frozenA?.tabindex])
  check("frozen: awaiting row reads Non traité without skeleton", frozenA?.label === "Non traité" && !frozenA.skeleton, frozenA)
  check("frozen: queue and recovery badges hidden", JSON.stringify(await badges()) === JSON.stringify({ arbitration: false, recovery: false }), await badges())

  // 6. Fermeture pendant l'ecriture : bloquee.
  await requestClose()
  await settle(700)
  const blocked = await closeConfirmation()
  check("blocked close: dedicated title, Rester only, no danger", blocked?.title === "Impossible de quitter maintenant" && JSON.stringify(blocked.buttons.map((b) => b.text)) === JSON.stringify(["Rester"]) && !blocked.buttons.some((b) => b.danger), blocked)
  await shot("5-close-blocked")
  await stay()

  // 7. Fin de l'ecriture : ecrits, un echec, message et relance.
  await line(resolved(R1, "written"))
  await line({ event: "progress", phase: "write", processed: 2, total: 3 })
  await line(resolved(R2, "written"))
  await line(writeError(L))
  await line({ event: "progress", phase: "write", processed: 3, total: 3 })
  await line(finished("run-1", "write", { written: 2, write_error: 1, unresolved: 1, awaiting_arbitration: 1 }))
  await settle(800)
  const w1 = await rowState("Adam Beyer")
  const fail = await rowState("Hector Oaks")
  check("written row keeps its lane label in green", w1?.label === "Auto" && w1.severity === "p-tag-success", w1)
  check("write_error row: danger, exclamation-triangle, Échec d'écriture, info icon", fail?.label === "Échec d'écriture" && fail.severity === "p-tag-danger" && fail.icon === "exclamation-triangle" && fail.info, fail)
  check("state column fits Échec d'écriture (fr)", fail?.tagWrapped === false && fail.spanFits === true, fail)
  await page.locator("app-run-list tbody tr", { hasText: "Hector Oaks" }).locator("td:last-child span.inline-flex").hover()
  await settle(900)
  const reason = await page.evaluate(() => document.querySelector(".p-tooltip")?.textContent.trim() ?? null)
  check("write_error reason on hover", reason !== null && reason.includes("ouvert dans un autre programme"), reason)
  const reasonPlace = await page.evaluate(() => {
    const tip = document.querySelector(".p-tooltip")?.getBoundingClientRect()
    const row = [...document.querySelectorAll("app-run-list tbody tr")].find((x) => x.textContent.includes("Hector Oaks"))
    const span = row?.querySelector("td:last-child span.inline-flex")?.getBoundingClientRect()
    return tip && span ? { tipTop: Math.round(tip.top), spanBottom: Math.round(span.bottom) } : null
  })
  check("write_error reason tooltip opens under its state", reasonPlace !== null && reasonPlace.tipTop >= reasonPlace.spanBottom, reasonPlace)
  await page.mouse.move(5, 5)
  const done = await action()
  check("write finished with a failure: the action button offers Relancer l'écriture, primary solid, refresh icon, enabled", done?.count === 1 && done.action === "retry" && done.text === "Relancer l'écriture" && !done.danger && !done.outlined && !done.secondary && done.small && done.icon === "refresh" && !done.disabled && done.right === 0, done)
  const barDone = await bar()
  check("write bar kept on its last step", barDone?.text.includes("3 sur 3") && !barDone.indeterminate, barDone)
  const msg = await failures()
  check("failure message above the list, error, with count", msg?.severity && msg.aboveList && /écriture\s*:\s*1/.test(msg.text), msg)
  check("failure message: times-circle icon, text only (the retry is the action button), one sentence per line", msg?.icon === "times-circle" && msg.buttons === 0 && msg.whiteSpace === "pre-line" && /\s*:\s*1\nLe motif de chaque échec s'affiche au survol/.test(msg.raw ?? ""), msg)
  await shot("6-write-failed")

  // 8. Relance : confirmee, en vol, puis en echec, puis reussie.
  await clearSent()
  await page.locator('[data-action="retry"]').click()
  await settle(700)
  const retryDialog = await confirmDialog()
  check("retry confirm: header, count, primary accept, outlined reject, both small", retryDialog?.header === "Relancer l'écriture" && /réécrire\s*:\s*1\n/.test(retryDialog.message) && !/p-button-(danger|secondary|outlined)/.test(retryDialog.buttons[1].cls) && retryDialog.buttons[0].cls.includes("p-button-outlined") && retryDialog.buttons.every((b) => b.cls.includes("p-button-sm")), retryDialog)
  check("retry confirm: nothing sent before accept", (await sent()).length === 0, await sent())
  await shot("7-retry-confirm")
  await confirmButton("Relancer l'écriture").click()
  await settle(500)
  check("retry accept sends retry_write", JSON.stringify(await sent()) === JSON.stringify(["retry_write"]), await sent())
  const retrying = await action()
  check("retrying: message hidden, the action is still retry (not commit), loading and disabled", (await failures()) === null && retrying?.action === "retry" && retrying.icon === "spinner" && retrying.disabled, { msg: await failures(), retrying })
  out.measures.barRetrying = await bar()
  await line({ event: "error", code: "tag_dump_write_failed", params: {}, message: "", command: "retry_write" })
  await settle(600)
  out.measures.barAfterRetryFailure = await bar()
  out.measures.afterRetryFailure = { action: await action(), failures: await failures(), error: await page.evaluate(() => document.querySelector("app-tagging-page app-error-message")?.textContent.trim() ?? null) }
  check("retry failure: no indeterminate write bar left", out.measures.barAfterRetryFailure === null, out.measures.barAfterRetryFailure)
  check("retry failure: error shown, message back, the action button offers retry again", out.measures.afterRetryFailure.error?.includes("sauvegardés") && out.measures.afterRetryFailure.failures?.buttons === 0 && out.measures.afterRetryFailure.action?.action === "retry" && !out.measures.afterRetryFailure.action.disabled && out.measures.afterRetryFailure.action.icon === "refresh", out.measures.afterRetryFailure)
  await shot("8-retry-failed")
  await page.locator('[data-action="retry"]').click()
  await settle(600)
  await confirmButton("Relancer l'écriture").click()
  await settle(400)
  await line({ event: "progress", phase: "write", processed: 1, total: 1 })
  await line(resolved(L, "written"))
  await line(finished("run-1", "write", { written: 3, write_error: 0, unresolved: 1, awaiting_arbitration: 1 }))
  await settle(600)
  check("retry success: failure message gone", (await failures()) === null, await failures())
  check("retry success: row written", (await rowState("Hector Oaks"))?.label === "Auto", await rowState("Hector Oaks"))
  const afterRetry = await action()
  check("retry success: no failure left, the action button is back to Lancer le run", afterRetry?.action === "start" && afterRetry.text === "Lancer le run" && !afterRetry.disabled, afterRetry)

  // 9. EN : colonne Etat et libelles.
  await line(writeError(L))
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("en"))
  await settle(700)
  const failEn = await rowState("Hector Oaks")
  const actionEn = await action()
  check("state column fits Write failed (en)", failEn?.label === "Write failed" && failEn.tagWrapped === false && failEn.spanFits === true, failEn)
  check("action button reads Retry writing (en)", actionEn?.action === "retry" && actionEn.text === "Retry writing", actionEn)
  await page.evaluate(() => ng.getComponent(document.querySelector("app-root")).translate.use("fr"))
  await settle(500)
  // La ligne revient a `written` : tant qu'un echec reste, le meme dossier offre la relance, pas le lancement.
  await line(resolved(L, "written"))
  await settle(300)

  // 10. Erreur de commit_run : run de nouveau confirmable, lignes et badges reviennent.
  await page.locator('[data-action="start"]').click()
  await settle(300)
  await line({ event: "run_started", run_id: "run-2", folder: FOLDER, tracks: [R1, U, A] })
  for (const e of [resolved(R1), unresolved(U), arbitration(A)]) await line(e)
  await line(finished("run-2", "network", { resolved: 1, unresolved: 1, awaiting_arbitration: 1 }))
  await settle(800)
  await closeDialogs()
  await page.locator('[data-action="commit"]').click()
  await settle(600)
  await confirmButton("Écrire les tags").click()
  await settle(400)
  await line({ event: "error", code: "tag_dump_write_failed", params: {}, message: "", command: "commit_run" })
  await settle(600)
  const refused = await action()
  const refusedError = await page.evaluate(() => document.querySelector("app-tagging-page app-error-message")?.textContent.trim() ?? null)
  check("commit refused: error shown, commit offered again", refusedError?.includes("aucun fichier n'a été modifié") && refused?.action === "commit" && !refused.disabled && refused.icon === "check", { refused, refusedError })
  check("commit refused: rows actionable and badges back", (await rowState("Ignez"))?.tabindex === "0" && (await badges()).arbitration === true, { a: await rowState("Ignez"), badges: await badges() })
  await shot("9-commit-refused")

  // 11. Run interrompu : il garde son ecriture.
  await page.locator('[data-action="start"]').count().then(async (n) => {
    if (n === 0) await setFolder("C:\\Musique\\Autre")
  })
  await settle(200)
  await setFolder(FOLDER)
  await page.evaluate(() => window.__svc.startTagging(ng.getComponent(document.querySelector("app-tagging-page")).folder()))
  await line({ event: "run_started", run_id: "run-3", folder: FOLDER, tracks: [R1, R2] })
  await line(resolved(R1))
  await settle(300)
  await page.locator('app-tagging-page .grid > button[data-action="cancel"]', { hasText: "Interrompre" }).click()
  await settle(500)
  const interrupted = await action()
  check("interrupted run offers to confirm", interrupted?.action === "commit" && !interrupted.disabled, interrupted)

  // 11 bis. Run sans morceau resolu : le meme dossier se relance.
  await page.evaluate(() => window.__svc.startTagging(ng.getComponent(document.querySelector("app-tagging-page")).folder()))
  await line({ event: "run_started", run_id: "run-4", folder: FOLDER, tracks: [U, A] })
  await line(unresolved(U))
  await line(unresolved(A))
  await line(finished("run-4", "network", { unresolved: 2 }))
  await settle(600)
  const empty = await action()
  check("run without a resolved track: its folder starts again", empty?.action === "start" && !empty.disabled, empty)
  check("run without a resolved track: closing holds nothing", (await heldBy()).length === 0, await heldBy())

  // 11 ter. Moteur mort puis relance : le run affiche se fige, son dossier se relance.
  await page.evaluate(() => window.__svc.startTagging(ng.getComponent(document.querySelector("app-tagging-page")).folder()))
  await line({ event: "run_started", run_id: "run-5", folder: FOLDER, tracks: [R1, U] })
  await line(resolved(R1))
  await line(unresolved(U))
  await line(finished("run-5", "network", { resolved: 1, unresolved: 1 }))
  await settle(600)
  const beforeDeath = { action: await action(), held: (await heldBy()).length > 0, recoverable: (await rowState("Nur Jaber"))?.tabindex }
  await page.evaluate(() => {
    window.__svc.endRun()
    window.__svc._available.set(true)
  })
  await settle(600)
  const afterDeath = { action: await action(), held: (await heldBy()).length > 0, recoverable: (await rowState("Nur Jaber"))?.tabindex, rows: await page.evaluate(() => document.querySelectorAll("app-run-list tbody tr").length) }
  out.measures.engineLost = { beforeDeath, afterDeath }
  check("engine lost: run was confirmable before, closing holding nothing", beforeDeath.action?.action === "commit" && !beforeDeath.held && beforeDeath.recoverable === "0", beforeDeath)
  check("engine lost: same folder starts again, rows kept but frozen, closing holds nothing", afterDeath.action?.action === "start" && !afterDeath.action.disabled && !afterDeath.held && afterDeath.recoverable === null && afterDeath.rows === 2, afterDeath)

  // 12. Plancher 1024 x 700 : rangee d'actions sans debordement.
  await page.setViewportSize({ width: 1024, height: 700 })
  await settle(500)
  const scroll = await page.evaluate(() => ({ page: document.scrollingElement.scrollHeight > innerHeight, main: (() => { const m = document.querySelector("main"); return m ? m.scrollHeight > m.clientHeight : null })() }))
  check("no page scroll at 1024 x 700", !scroll.page && !scroll.main, scroll)
  await shot("10-floor")

  out.measures.console = (await page.evaluate(() => window.__consoleErrors ?? null))
  return out
}
