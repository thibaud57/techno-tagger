// Section Administration des Reglages (rangees Cache et Logs) dans la fenetre Tauri : gestes reels par
// `cdp.mjs --click` / `--move` aux coordonnees rendues ici, vrai sidecar (vidage reel du cache sous un
// `LOCALAPPDATA` du scratchpad), vrai `revealItemInDir` (ouvre l'Explorateur de l'utilisateur).
//   node cdp.mjs page/settings-admin.js open                    onglet Reglages
//   node cdp.mjs page/settings-admin.js away                    premier onglet (puis `open` remonte la page et relit la taille du cache)
//   node cdp.mjs page/settings-admin.js lang <fr|en>            langue de l'interface, sans ecrire le `preferences.json`
//   node cdp.mjs page/settings-admin.js menu                    centre de l'entree Administration
//   node cdp.mjs page/settings-admin.js state                   rangees, boutons, taille, `logFile`, erreurs, defilement, mise en page
//   node cdp.mjs page/settings-admin.js column                  section affichee : colonne des libelles (10rem, plus long libelle, marge) et rythme vertical des rangees
//   node cdp.mjs page/settings-admin.js buttons                centres de « Vider le cache » et « Ouvrir le dossier des logs », et leur etat
//   node cdp.mjs page/settings-admin.js watch                   compte les contextes audio crees et les toasts vus (survit jusqu'au rechargement)
//   node cdp.mjs page/settings-admin.js watched                 ce que `watch` a releve
//   node cdp.mjs page/settings-admin.js toast                   dernier toast : titre, detail, `white-space`, lignes a l'ecran
//   node cdp.mjs page/settings-admin.js tooltip <cache|logs>    tooltip ouvert (texte, position sous le bouton), apres `--move`
//   node cdp.mjs page/settings-admin.js gaps <cache|logs>       message d'erreur de la rangee : ecart au-dessus et en dessous, lignes
//   node cdp.mjs page/settings-admin.js replay <preset>         rejoue un evenement sur le service vivant (`partial`, `refuse-busy`, `refuse-unwritten`, `clear-error`)
//   node cdp.mjs page/settings-admin.js phase <preset>          pose l'etat du service qui grise Cache (`searching`, `unwritten`, `write-failures`, `lost`, `written`, `idle`)
//   node cdp.mjs page/settings-admin.js shell                   fond de la page (`bg-surface-950`) et menu des Reglages (entree active `bg-highlight`, survol apres `--move`)
//   node cdp.mjs page/settings-admin.js slow-send <ms>          retarde l'envoi reel de `clear_cache` et le compte ; `clear-state` relit compteur, `cacheClearing`, bouton
//   node cdp.mjs page/settings-admin.js available <null|true>   `_available` du service vivant (moteur pas pret : tooltip de Cache et de Logs)
//   node cdp.mjs page/settings-admin.js log-file <chemin|null>  remplace `logFile` du service (chemin inexistant : echec reel de `revealItemInDir`)
;(async () => {
  const [action, ...rest] = __args
  const n = (value) => Math.round(value * 10) / 10
  const center = (element) => {
    const r = element.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }
  const page = () => document.querySelector("app-settings-page")
  const button = (which) => page().querySelector(which === "cache" ? '[data-action="clear-cache"]' : '[data-action="reveal-logs"]')
  const flat = (text) => String(text).replace(/[ \t\r\n]+/g, " ").trim()
  const lineCount = (element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size
  }

  if (action === "open") {
    const tabs = [...document.querySelectorAll("p-tab")]
    tabs[tabs.length - 1].click()
    await until(() => page() !== null, 5000)
    await wait(400)
    return { url: location.pathname, h1: document.querySelector("main h1")?.textContent?.trim() }
  }

  // Quitte Reglages par le premier onglet : `open` remonte ensuite la page, qui redemande `get_cache_size` au moteur
  if (action === "away") {
    document.querySelectorAll("p-tab")[0].click()
    await wait(600)
    return { url: location.pathname }
  }

  // Bascule la langue sans toucher au `preferences.json` (le select de langue, lui, l'ecrit)
  if (action === "lang") {
    const [language] = rest
    ng.getComponent(document.querySelector("app-root")).translate.use(language)
    await wait(600)
    return { lang: document.documentElement.lang }
  }

  if (action === "menu") {
    const items = [...page().querySelectorAll("p-menu .p-menu-item")]
    return { labels: items.map((item) => item.textContent.trim()), admin: center(items[3].querySelector(".p-menu-item-content")), items: items.map((item) => center(item.querySelector(".p-menu-item-content"))) }
  }

  // Section affichee, quelle qu'elle soit : colonne des libelles (10rem) et rythme vertical des rangees jointives
  if (action === "column") {
    const host = page()
    const rows = [...host.querySelectorAll("app-settings-row")]
    const border = (row) => parseFloat(getComputedStyle(row).borderBottomWidth)
    const extent = (row) => {
      const parts = [row.querySelector("[rowLabel]"), row.querySelector("[rowControl]")]
      const extra = row.querySelector(":scope > div:not([rowControl])")
      const shown = extra && extra.getBoundingClientRect().height > 0 ? extra : null
      return {
        top: Math.min(...parts.map((p) => p.getBoundingClientRect().top)),
        bottom: Math.max(...[parts[1], shown].filter(Boolean).map((p) => p.getBoundingClientRect().bottom)),
      }
    }
    const h2 = host.querySelector("section h2").getBoundingClientRect()
    const reset = host.querySelector('[data-action="reset-thresholds"]')
    const labels = rows.map((row) => {
      const label = row.querySelector("[rowLabel]")
      const range = document.createRange()
      range.selectNodeContents(label)
      return {
        text: label.textContent.trim(),
        columns: getComputedStyle(row).gridTemplateColumns,
        textWidth: n(range.getBoundingClientRect().width),
        lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
        cut: label.scrollWidth > label.clientWidth,
        labelLeft: n(label.getBoundingClientRect().left),
        controlLeft: n(row.querySelector("[rowControl]").getBoundingClientRect().left),
      }
    })
    const widest = labels.reduce((a, l) => (l.textWidth > a.textWidth ? l : a), labels[0])
    return {
      lang: document.documentElement.lang,
      h2: host.querySelector("section h2").textContent.trim(),
      labels,
      widest: { text: widest.text, width: widest.textWidth, room: n(160 - widest.textWidth) },
      rhythm: {
        h2ToFirstRow: n(rows[0].getBoundingClientRect().top - h2.bottom),
        rowGaps: rows.slice(1).map((r, i) => n(r.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom)),
        belowContent: rows.map((r) => n(r.getBoundingClientRect().bottom - border(r) - extent(r).bottom)),
        aboveContent: rows.map((r) => n(extent(r).top - r.getBoundingClientRect().top)),
        lastRowToReset: reset ? n(reset.getBoundingClientRect().top - rows[rows.length - 1].getBoundingClientRect().bottom) : null,
      },
      scroll: {
        page: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
        main: document.querySelector("main").scrollHeight > document.querySelector("main").clientHeight,
      },
    }
  }

  if (action === "buttons") {
    const describe = (which) => {
      const b = button(which)
      return { ...center(b), disabled: b.disabled, text: flat(b.textContent) }
    }
    return { cache: describe("cache"), logs: describe("logs") }
  }

  if (action === "state") {
    const service = __sidecarService()
    const host = page()
    const section = host.querySelector("section")
    const main = document.querySelector("main")
    const rows = [...host.querySelectorAll("app-settings-row")]
    const muted = (() => {
      const probe = document.createElement("span")
      probe.className = "text-muted-color"
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })()
    const describe = (row) => {
      const label = row.querySelector("[rowLabel]")
      const control = row.querySelector("[rowControl]")
      const hint = control.querySelector(".text-xs")
      const action = row.querySelector("button[data-action]")
      const size = row.querySelector("[data-cache-size]")
      const c = control.getBoundingClientRect()
      const h = hint.getBoundingClientRect()
      const a = action.getBoundingClientRect()
      const svg = action.querySelector("svg")
      const result = {
        columns: getComputedStyle(row).gridTemplateColumns,
        label: label.textContent.trim(),
        labelFont: getComputedStyle(label).fontSize,
        hint: hint.textContent,
        hintFont: getComputedStyle(hint).fontSize,
        hintMuted: getComputedStyle(hint).color === muted,
        hintWhiteSpace: getComputedStyle(hint).whiteSpace,
        hintLeftOnControl: n(h.left - c.left),
        hintWidth: n(h.width),
        hintLines: lineCount(hint),
        hintCenterToButtonCenter: n(h.top + h.height / 2 - (a.top + a.height / 2)),
        button: {
          text: flat(action.textContent),
          disabled: action.disabled,
          classes: [...action.classList].filter((x) => /^p-button/.test(x)).join(" "),
          icon: svg?.getAttribute("data-p-icon") ?? null,
          iconSize: svg ? Math.round(svg.getBoundingClientRect().width) : null,
          iconRightOfLabelLeft: svg ? n(svg.getBoundingClientRect().right - a.left) : null,
          height: n(a.height),
        },
        controlRightMinusButtonRight: n(c.right - a.right),
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
          buttonToSize: n(s.left - a.right),
          rightEdgeToControl: n(c.right - s.right),
        }
      }
      return result
    }
    return {
      lang: document.documentElement.lang,
      size: [innerWidth, innerHeight],
      menu: [...host.querySelectorAll(".p-menu-item-label")].map((e) => e.textContent.trim()),
      h2: section.querySelector("h2")?.textContent.trim(),
      labels: rows.map((r) => r.querySelector("[rowLabel]").textContent.trim()),
      rowTops: rows.map((r) => n(r.getBoundingClientRect().top)),
      cache: describe(rows[0]),
      logs: describe(rows[1]),
      service: {
        phase: service.phase(),
        available: service.available(),
        cacheSize: service.cacheSize(),
        logFile: service.logFile() ?? "absent",
        runId: service.taggingRunId(),
        committed: service.committed(),
        failures: service.writeFailureCount(),
        runAwaitsWrite: service.runAwaitsWrite(),
        runLost: service.taggingRun.lost(),
      },
      cacheError: document.querySelector("[data-cache-error]") ? flat(document.querySelector("[data-cache-error]").textContent) : null,
      logsError: document.querySelector("[data-logs-error]") ? flat(document.querySelector("[data-logs-error]").textContent) : null,
      scroll: {
        page: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
        main: main.scrollHeight > main.clientHeight,
        section: section.scrollHeight > section.clientHeight,
        bottomRoom: Math.round(main.getBoundingClientRect().bottom - rows[rows.length - 1].getBoundingClientRect().bottom),
      },
    }
  }

  if (action === "watch") {
    if (!window.__adminWatched) {
      const Original = globalThis.AudioContext
      window.__adminWatched = { contexts: 0, toasts: [] }
      globalThis.AudioContext = class extends Original {
        constructor(...args) {
          super(...args)
          window.__adminWatched.contexts += 1
        }
      }
      // Un toast vit 4s : le compter a son apparition, descendants compris (PrimeNG insere un conteneur)
      new MutationObserver((records) => {
        for (const record of records) {
          for (const added of record.addedNodes) {
            if (added.nodeType !== 1) continue
            const found = added.matches?.(".p-toast-message") ? [added] : [...added.querySelectorAll(".p-toast-message")]
            for (const toast of found) {
              window.__adminWatched.toasts.push({
                severity: [...toast.classList].find((c) => /^p-toast-message-/.test(c)) ?? null,
                summary: toast.querySelector(".p-toast-summary")?.textContent.trim() ?? null,
                detail: toast.querySelector(".p-toast-detail")?.textContent ?? null,
              })
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true })
    }
    return { watching: true, ...window.__adminWatched }
  }

  if (action === "watched") return window.__adminWatched ?? null

  if (action === "toast") {
    const m = [...document.querySelectorAll(".p-toast-message")].pop()
    if (!m) return null
    const d = m.querySelector(".p-toast-detail")
    const s = m.querySelector(".p-toast-summary")
    return {
      severity: [...m.classList].find((c) => /^p-toast-message-/.test(c)) ?? null,
      summary: s.textContent.trim(),
      detailText: d.textContent,
      whiteSpace: getComputedStyle(d).whiteSpace,
      detailWeight: getComputedStyle(d).fontWeight,
      width: Math.round(m.getBoundingClientRect().width),
      height: n(d.getBoundingClientRect().height),
      lineHeight: getComputedStyle(d).lineHeight,
      visualLines: lineCount(d),
      count: document.querySelectorAll(".p-toast-message").length,
    }
  }

  if (action === "tooltip") {
    const [which] = rest
    await until(() => document.querySelector(".p-tooltip") !== null, 3000)
    const tip = document.querySelector(".p-tooltip")
    if (!tip) return null
    const host = button(which).getBoundingClientRect()
    const r = tip.getBoundingClientRect()
    return {
      text: tip.textContent,
      below: Math.round(r.top - host.bottom),
      centerOffset: Math.round(r.left + r.width / 2 - (host.left + host.width / 2)),
    }
  }

  if (action === "gaps") {
    const [which] = rest
    const host = document.querySelector(which === "cache" ? "[data-cache-error]" : "[data-logs-error]")
    if (!host) return null
    // Animation d'entree terminee : une mesure a hauteur nulle ou en cours d'echelle est fausse
    await until(() => document.getAnimations().filter((a) => a.effect?.target && host.contains(a.effect.target)).length === 0, 4000)
    const box = host.querySelector(".p-message") ?? host
    const row = host.closest("app-settings-row")
    const control = row.querySelector("[rowControl]").getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    const border = parseFloat(getComputedStyle(row).borderBottomWidth)
    const text = box.querySelector(".whitespace-pre-line") ?? box
    const icon = box.querySelector("svg")
    return {
      above: n(b.top - control.bottom),
      below: n(r.bottom - border - b.bottom),
      height: n(b.height),
      lines: lineCount(text),
      whiteSpace: getComputedStyle(text).whiteSpace,
      severityError: box.classList.contains("p-message-error"),
      icon: icon?.getAttribute("data-p-icon") ?? null,
      iconSize: icon ? Math.round(icon.getBoundingClientRect().width) : null,
      text: box.textContent,
    }
  }

  const service = __sidecarService()

  if (action === "replay") {
    const [preset] = rest
    const refusal = (code, params) => ({ event: "error", code, params, message: code, command: "clear_cache" })
    const presets = {
      partial: { event: "cache_cleared", freed_bytes: 1_700_000, size_bytes: 1_500_000 },
      "refuse-busy": refusal("phase_busy", { phase: "tagging" }),
      "refuse-unwritten": refusal("run_not_written", {}),
    }
    if (preset === "clear-error") {
      service.setLastError(null)
    } else if (presets[preset]) {
      service.handleLine(JSON.stringify(presets[preset]))
    } else {
      throw new Error(`preset inconnu : ${preset}`)
    }
    await wait(500)
    return { replayed: preset }
  }

  if (action === "phase") {
    const [preset] = rest
    const FOLDER = "C:\\Musique\\Extraction"
    const track = (id) => ({ track_id: `${id}.mp3`, file_name: `${id}.mp3`, artist: "Jane Doe", title: `Track ${id}`, tags_before: { system: "id3", comment: null, fields: [] } })
    const tracks = [track("01"), track("02")]
    const resolved = (t, state = "resolved") => ({
      event: "track_resolved", track_id: t.track_id, state, resolution: "auto", failure_reason: state === "write_error" ? "file_locked" : null,
      source: "beatport", after: { artist: t.artist, title: `${t.title} (Original Mix)` }, scores: { artist: 98, title: 95, average: 96 },
      artwork_path: null, tags_after: [], restorable: state === "written" || state === "write_error",
    })
    const finished = (runId, phase, counts) => ({ event: "run_finished", phase, run_id: runId, resolved: 0, unresolved: 0, written: 0, write_error: 0, awaiting_arbitration: 0, ...counts })
    const line = (event) => service.handleLine(JSON.stringify(event))
    // Le sidecar vivant ne recoit rien : `send` est neutralise le temps de la mise en scene
    if (!service.__realSend) service.__realSend = service.send.bind(service)
    service.send = async () => {}
    const run = async (id) => {
      await service.startTagging(FOLDER)
      line({ event: "run_started", run_id: id, folder: FOLDER, tracks })
    }
    if (preset === "searching") {
      await run("run-1")
    } else if (preset === "unwritten") {
      await run("run-1")
      tracks.forEach((t) => line(resolved(t)))
      line(finished("run-1", "network", { resolved: 2 }))
    } else if (preset === "write-failures") {
      await run("run-1")
      tracks.forEach((t) => line(resolved(t)))
      line(finished("run-1", "network", { resolved: 2 }))
      await service.commitRun()
      line({ event: "progress", phase: "write", processed: 2, total: 2 })
      line(resolved(tracks[0], "write_error"))
      line(resolved(tracks[1], "written"))
      line(finished("run-1", "write", { written: 1, write_error: 1 }))
    } else if (preset === "lost") {
      service.endRun()
    } else if (preset === "written") {
      await run("run-2")
      tracks.forEach((t) => line(resolved(t)))
      line(finished("run-2", "network", { resolved: 2 }))
      await service.commitRun()
      line({ event: "progress", phase: "write", processed: 2, total: 2 })
      tracks.forEach((t) => line(resolved(t, "written")))
      line(finished("run-2", "write", { written: 2 }))
    } else if (preset === "idle") {
      service.send = service.__realSend
      return { restoredSend: true }
    } else {
      throw new Error(`etat inconnu : ${preset}`)
    }
    await wait(500)
    return { phase: service.phase(), runId: service.taggingRunId(), committed: service.committed(), failures: service.writeFailureCount(), lost: service.taggingRun.lost(), awaitsWrite: service.runAwaitsWrite() }
  }

  // `null` : moteur pas pret (Cache et Logs grises, tooltip `settings.admin.starting`) ; `true` le rend
  // Fond de la page et menu des Reglages : hote de l'application (`bg-surface-950`), ce que voit la souris sous la
  // barre d'onglets, entree active (`bg-highlight`) et fond d'une entree survolee apres `--move`
  if (action === "shell") {
    const toRgb = (s) => {
      const m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(s)
      return m ? `rgb(${m.slice(1, 4).map((v) => Math.round(Number(v) * 255)).join(", ")})${m[4] ? ` / ${m[4]}` : ""}` : s
    }
    const root = document.querySelector("app-root")
    const rect = root.getBoundingClientRect()
    let under = document.elementFromPoint(innerWidth - 40, innerHeight - 40)
    while (under && ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(under).backgroundColor)) under = under.parentElement
    return {
      viewport: [innerWidth, innerHeight],
      root: { w: Math.round(rect.width), h: Math.round(rect.height), bg: toRgb(getComputedStyle(root).backgroundColor), covers: Math.round(rect.width) === innerWidth && Math.round(rect.height) === innerHeight },
      html: toRgb(getComputedStyle(document.documentElement).backgroundColor),
      body: toRgb(getComputedStyle(document.body).backgroundColor),
      underBottomRight: under ? { tag: under.tagName.toLowerCase(), bg: toRgb(getComputedStyle(under).backgroundColor) } : null,
      menu: [...document.querySelectorAll("app-settings-page p-menu .p-menu-item")].map((item) => {
        const content = item.querySelector(".p-menu-item-content")
        return {
          label: item.textContent.trim(),
          highlight: content.classList.contains("bg-highlight"),
          emphasis: content.classList.contains("bg-emphasis"),
          bg: toRgb(getComputedStyle(content).backgroundColor),
          current: item.querySelector("a")?.getAttribute("aria-current") ?? null,
        }
      }),
    }
  }

  // Retarde l'envoi reel de `clear_cache` et releve ce qui part : un double clic reel (deux `--click` a la suite)
  // doit n'en laisser partir qu'un, le bouton passant en spinner entre-temps
  if (action === "slow-send") {
    const [ms] = rest
    if (!service.__slowSend) {
      const original = service.send.bind(service)
      window.__clearSent = 0
      service.send = async (command, ...more) => {
        if (command.command === "clear_cache") {
          window.__clearSent += 1
          await wait(Number(ms))
        }
        return original(command, ...more)
      }
      service.__slowSend = true
    }
    return { slowSend: Number(ms) }
  }

  if (action === "clear-state") {
    const b = page().querySelector('[data-action="clear-cache"]')
    return { clearSent: window.__clearSent ?? null, clearing: service.cacheClearing(), disabled: b.disabled, icon: b.querySelector("svg")?.getAttribute("data-p-icon"), size: service.cacheSize() }
  }

  if (action === "available") {
    const [value] = rest
    service._available.set(value === "null" ? null : value === "true")
    await wait(400)
    return { available: service.available() }
  }

  if (action === "log-file") {
    const [path] = rest
    service._logFile.set(path === "null" ? null : path)
    await wait(400)
    return { logFile: service.logFile() }
  }

  throw new Error(`action inconnue : ${action}`)
})()
