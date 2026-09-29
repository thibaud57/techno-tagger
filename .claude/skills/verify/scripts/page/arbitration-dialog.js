// Modale d'arbitrage et liste du run dans la fenetre Tauri : mesures a l'ecran, sans geste
// qui parte vers le sidecar (ni choix valide, ni refus).
//   node cdp.mjs page/arbitration-dialog.js open      rouvre la modale par le badge de file
//   node cdp.mjs page/arbitration-dialog.js state     taille, selection, options et leurs rectangles
//   node cdp.mjs page/arbitration-dialog.js footer    boutons du pied, badge compris
//   node cdp.mjs page/arbitration-dialog.js covers    vignettes de la liste du run et leur cellule
//   node cdp.mjs page/arbitration-dialog.js state-icons  centres du tag d'etat et de l'icone
//                                                     d'info, fond et transition du tag
//   node cdp.mjs page/arbitration-dialog.js tag-demo  couleur du premier tag alternee, avec
//                                                     puis sans transition
//   node cdp.mjs page/arbitration-dialog.js cursors   curseur calcule des elements cliquables
//   node cdp.mjs page/arbitration-dialog.js trace     arme un journal des evenements souris et
//                                                     des valeurs de `choice`, lu par `trace-read`
;(async () => {
  const [action] = __args
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2),
    }
  }
  const dialog = () => document.querySelector("app-arbitration-dialog .p-dialog")
  const component = () => ng.getComponent(document.querySelector("app-arbitration-dialog"))

  if (action === "open") {
    document.querySelector("[data-arbitration-badge]")?.click()
    await wait(500)
    return { visible: dialog() !== null }
  }

  if (action === "state") {
    const root = dialog()
    if (!root) return { visible: false }
    const list = root.querySelector(".p-listbox-list-container, .p-listbox")
    const empty = root.querySelector(".p-listbox-empty-message")
    return {
      visible: true,
      dialog: rect(root),
      candidate: component().choice().candidate,
      position: root.querySelector("p-badge")?.textContent.trim(),
      options: [...root.querySelectorAll(".p-listbox-option")].map((option) => ({
        text: option.textContent.trim().slice(0, 60),
        selected: option.classList.contains("p-listbox-option-selected"),
        ...rect(option),
      })),
      list: rect(list),
      empty: empty && { text: empty.textContent.trim(), ...rect(empty) },
      validateDisabled: root.querySelector('[data-action="validate"]')?.disabled,
    }
  }

  if (action === "footer") {
    const root = dialog()
    if (!root) return { visible: false }
    const footer = root.querySelector(".p-dialog-footer")
    return [...footer.querySelectorAll("button, p-badge")].map((el) => {
      const style = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent.trim() || el.getAttribute("aria-label") || "").slice(0, 30),
        classes: [...el.classList].filter((c) => c.startsWith("p-button")),
        padding: style.padding,
        fontSize: style.fontSize,
        ...rect(el),
      }
    })
  }

  if (action === "covers") {
    const rows = [...document.querySelectorAll("app-run-list tbody tr")].slice(0, 6)
    return rows.map((row) => {
      const cell = row.querySelector("td")
      const cover = cell?.querySelector("img, p-skeleton, div")
      const style = cell && getComputedStyle(cell)
      return {
        kind: cover?.tagName.toLowerCase(),
        cell: rect(cell),
        cellPadding: style?.padding,
        cover: rect(cover),
      }
    })
  }

  if (action === "state-icons") {
    const row = [...document.querySelectorAll("app-run-list tbody tr")].find((tr) =>
      tr.querySelector('app-state-tag + app-icon, app-icon[name="info-circle"]'),
    )
    const cell = row?.querySelectorAll("td")[5]
    const tag = cell?.querySelector("p-tag")
    const host = cell?.querySelector(":scope app-state-tag ~ app-icon")
    const svg = host?.querySelector("svg")
    const middle = (el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, height: r.height, center: r.top + r.height / 2 }
    }
    const tagHost = cell?.querySelector("app-state-tag")
    return {
      tagHost: tagHost && { ...middle(tagHost), display: getComputedStyle(tagHost).display },
      tag: tag && {
        ...middle(tag),
        background: getComputedStyle(tag).backgroundColor,
        transition: `${getComputedStyle(tag).transitionProperty} ${getComputedStyle(tag).transitionDuration}`,
      },
      iconHost: host && { ...middle(host), display: getComputedStyle(host).display },
      svg: svg && { ...middle(svg), verticalAlign: getComputedStyle(svg).verticalAlign },
    }
  }

  if (action === "tag-demo") {
    // Classes posees a la main puis restaurees : le run n'est pas touche.
    const tag = document.querySelector("app-run-list tbody tr app-state-tag p-tag")
    if (!tag) throw new Error("aucun tag d'etat dans la liste du run")
    const original = tag.className
    const severity = [...tag.classList].find((c) => /^p-tag-(success|danger|info|secondary|warn)$/.test(c))
    const other = severity === "p-tag-success" ? "p-tag-danger" : "p-tag-success"
    tag.style.outline = "2px solid var(--p-primary-color)"
    tag.style.outlineOffset = "4px"
    await wait(5000)
    const flip = async (times) => {
      for (let i = 0; i < times; i += 1) {
        tag.classList.toggle(severity)
        tag.classList.toggle(other)
        await wait(1200)
      }
    }
    await flip(6)
    tag.style.transition = "none"
    await wait(2000)
    await flip(6)
    tag.className = original
    tag.style.transition = ""
    tag.style.outline = ""
    tag.style.outlineOffset = ""
    return { severity, other }
  }

  if (action === "cursors") {
    const cursorOf = (el) => el && getComputedStyle(el).cursor
    const firstRow = document.querySelector("app-run-list tbody tr")
    return {
      badge: cursorOf(document.querySelector("[data-arbitration-badge]")),
      badgeTag: cursorOf(document.querySelector("[data-arbitration-badge] p-tag")),
      runButton: cursorOf(document.querySelector('app-tagging-page [data-p-icon="play"]')?.closest("button")),
      tab: cursorOf(document.querySelector("p-tab")),
      awaitingRow: cursorOf(firstRow),
      validate: cursorOf(dialog()?.querySelector('[data-action="validate"]')),
      option: cursorOf(dialog()?.querySelector(".p-listbox-option")),
    }
  }

  if (action === "trace") {
    const log = []
    window.__arbitrationTrace = log
    const root = dialog()
    const list = root?.querySelector('[role="listbox"]')
    for (const type of ["mousedown", "focus", "focusin", "click", "mouseup"]) {
      root?.addEventListener(
        type,
        (event) =>
          log.push(
            `${type} on ${event.target.tagName.toLowerCase()}.${[...(event.target.classList ?? [])].join(".")} -> ${JSON.stringify(component().choice())}`,
          ),
        true,
      )
    }
    const choice = component().choice
    const set = choice.set.bind(choice)
    choice.set = (value) => {
      log.push(`choice.set ${JSON.stringify(value)}`)
      set(value)
    }
    return { armed: list !== null && list !== undefined, now: component().choice() }
  }

  if (action === "trace-read") {
    await wait(300)
    return { log: window.__arbitrationTrace ?? null, now: component().choice() }
  }

  throw new Error(`action inconnue : ${action}`)
})()
