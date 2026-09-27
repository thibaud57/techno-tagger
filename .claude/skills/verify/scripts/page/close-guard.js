// Garde de fermeture dans la fenetre Tauri : pose un travail en cours, lit la confirmation
// de sortie, clique ses boutons. La fermeture elle-meme part de l'exterieur, par
// `taskkill //IM techno-tagger.exe` sans `/F` (le message de fermeture de Windows, celui
// de la croix), jamais par `close()` depuis la page qui ne passerait pas par l'OS.
//   node cdp.mjs page/close-guard.js pending extraction
//   node cdp.mjs page/close-guard.js pending run-arbitrations
//   node cdp.mjs page/close-guard.js state
//   node cdp.mjs page/close-guard.js click <stay|leave|cross>
//   node cdp.mjs page/close-guard.js lang <fr|en>    largeur a remesurer dans les deux langues
;(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const [action, target] = __args
  const service = __sidecarService()

  const dialogOf = (selector) => document.querySelector(selector)?.closest(".p-dialog") ?? null
  const confirmation = () => dialogOf('app-close-confirmation [data-action="stay"], [data-action="stay"]')

  if (action === "pending") {
    if (target === "extraction") {
      // L'extraction de fixture dure une fraction de seconde : le signal se pose sur le
      // service vivant, la garde ne lisant que lui.
      service._extracting.set(true)
    } else if (target === "run-arbitrations") {
      // `send` neutralise : rien ne part vers la vraie API, le run et sa file se rejouent.
      service.send = async () => undefined
      await service.startTagging("verify-close-guard")
      const tracks = ["a.mp3", "b.mp3"]
      service.handleLine(
        JSON.stringify({
          event: "run_started",
          run_id: "verify",
          tracks: tracks.map((id) => ({ track_id: id, file_name: id, artist: "Adam Beyer", title: "Your Mind" })),
        }),
      )
      for (const id of tracks) {
        service.handleLine(
          JSON.stringify({
            event: "arbitration_required",
            track_id: id,
            source: "beatport",
            beatport_unavailable: false,
            candidates: [
              {
                artist: "Adam Beyer",
                title: "Your Mind (Radio Edit)",
                label: "Drumcode",
                year: 2023,
                scores: { artist: 96, title: 84, average: 90 },
              },
            ],
            empty_reason: null,
            other_source: null,
          }),
        )
      }
    } else {
      throw new Error(`travail inconnu : ${target}`)
    }
    await wait(300)
    return {
      extracting: service.extracting(),
      tagging: service.tagging(),
      arbitrationCount: service.arbitrationCount(),
    }
  }

  if (action === "state") {
    const dialog = confirmation()
    if (!dialog) {
      return { visible: false, extracting: service.extracting(), tagging: service.tagging() }
    }
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) }
    }
    const buttons = [...dialog.querySelectorAll(".p-dialog-footer button")].map((b) => ({
      action: b.dataset.action,
      text: b.textContent.trim(),
      classes: [...b.classList].filter((c) => c.startsWith("p-button")),
      ...rect(b),
    }))
    const footer = dialog.querySelector(".p-dialog-footer")
    const header = dialog.querySelector(".p-dialog-header")
    const title = header?.querySelector("h3")
    const close = header?.querySelector("button")
    const masks = [...document.querySelectorAll(".p-dialog-mask")].map((mask) => ({
      closeConfirmation: mask.contains(dialog),
      zIndex: Number(getComputedStyle(mask).zIndex),
      background: getComputedStyle(mask).backgroundColor,
    }))
    const style = getComputedStyle(dialog)
    return {
      visible: true,
      title: title && {
        tag: title.tagName,
        text: title.textContent.trim(),
        fontSize: getComputedStyle(title).fontSize,
        fontWeight: getComputedStyle(title).fontWeight,
      },
      items: [...dialog.querySelectorAll(".p-dialog-content li")].map((li) => li.textContent.trim()),
      itemFontSize: getComputedStyle(dialog.querySelector(".p-dialog-content ul")).fontSize,
      buttons,
      footerJustify: footer && getComputedStyle(footer).justifyContent,
      closeLabel: close?.getAttribute("aria-label") ?? null,
      focused: document.activeElement?.dataset?.action ?? document.activeElement?.tagName ?? null,
      width: Math.round(dialog.getBoundingClientRect().width),
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      borderRadius: style.borderRadius,
      animationName: style.animationName,
      danger: dialog.querySelector(".p-button-danger") !== null,
      masks,
      guardRequest: ng.getComponent(document.querySelector("app-close-confirmation")).request(),
    }
  }

  if (action === "click") {
    const dialog = confirmation()
    if (!dialog) throw new Error("aucune confirmation de sortie affichee")
    const button =
      target === "cross"
        ? dialog.querySelector(".p-dialog-header button")
        : dialog.querySelector(`[data-action="${target}"]`)
    if (!button) throw new Error(`bouton introuvable : ${target}`)
    button.click()
    await wait(500)
    return { clicked: target, stillShown: confirmation() !== null }
  }

  if (action === "lang") {
    ng.getComponent(document.querySelector("app-root")).translate.use(target)
    await wait(500)
    return { lang: document.documentElement.lang }
  }

  throw new Error(`action inconnue : ${action}`)
})()
