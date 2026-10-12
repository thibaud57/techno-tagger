// Invite de reprise d'un run interrompu dans la fenetre Tauri. Le plan vient du disque, laisse
// par une session de `drive.py` sous le meme `LOCALAPPDATA` que la fenetre : seule la relance
// du moteur se commande d'ici, pour reproposer un plan pose entre deux passes sans rouvrir
// l'application.
//   node cdp.mjs page/resume-prompt.js state                 invite, textes, focus, boutons, mesures
//   node cdp.mjs page/resume-prompt.js click <resume|discard|later>
//   node cdp.mjs page/resume-prompt.js restart               arrete le moteur et le relance
//   node cdp.mjs page/resume-prompt.js tagging               onglet Tagging apres une reprise
// Entree se frappe par `node cdp.mjs --key Enter`, invite ouverte : rien ne doit partir.
;(async () => {
  const [action, target] = __args
  const service = __sidecarService()

  const prompt = () => document.querySelector("app-resume-dialog .p-dialog")
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) }
  }

  if (action === "state") {
    const dialog = prompt()
    if (!dialog) {
      return { visible: false, interruptedRun: service.interruptedRun(), url: location.pathname }
    }
    // Une mesure prise pendant le fondu d'entree rend une largeur intermediaire.
    await until(() => getComputedStyle(dialog).animationName === "none", 3000)
    const title = dialog.querySelector(".p-dialog-header h3")
    const content = dialog.querySelector(".p-dialog-content > div")
    const folder = dialog.querySelector("app-truncated-text")
    const folderText = folder?.querySelector("span") ?? folder
    const active = document.activeElement
    return {
      visible: true,
      interruptedRun: service.interruptedRun(),
      title: title && {
        text: title.textContent.trim(),
        fontSize: getComputedStyle(title).fontSize,
        fontWeight: getComputedStyle(title).fontWeight,
      },
      closeButton: dialog.querySelector(".p-dialog-header button") !== null,
      // `textContent` garde les `\n` des traductions, une phrase par ligne.
      paragraphs: [...dialog.querySelectorAll(".p-dialog-content p")].map((p) => p.textContent.trim()),
      content: content && {
        fontSize: getComputedStyle(content).fontSize,
        color: getComputedStyle(content).color,
        whiteSpace: getComputedStyle(content).whiteSpace,
        gap: getComputedStyle(content).rowGap,
      },
      folder: folder && {
        text: folder.textContent.trim(),
        direction: getComputedStyle(folderText).direction,
        truncated: folderText.scrollWidth > folderText.clientWidth,
        color: getComputedStyle(folder).color,
        ...rect(folder),
      },
      buttons: [...dialog.querySelectorAll(".p-dialog-footer button")].map((b) => ({
        action: b.dataset.action,
        text: b.textContent.trim(),
        classes: [...b.classList].filter((c) => c.startsWith("p-button")),
        ...rect(b),
      })),
      focused: dialog.contains(active) ? (active.dataset?.action ?? active.tagName) : null,
      width: Math.round(dialog.getBoundingClientRect().width),
      borderRadius: getComputedStyle(dialog).borderRadius,
      mask: getComputedStyle(dialog.closest(".p-dialog-mask") ?? dialog).backgroundColor,
      danger: dialog.querySelector(".p-button-danger") !== null,
      url: location.pathname,
    }
  }

  if (action === "click") {
    const button = prompt()?.querySelector(`[data-action="${target}"]`)
    if (!button) throw new Error(`bouton introuvable : ${target}`)
    button.click()
    await wait(1500)
    return {
      clicked: target,
      shown: prompt() !== null,
      interruptedRun: service.interruptedRun(),
      url: location.pathname,
      tagging: service.tagging(),
      lastError: service.lastError(),
    }
  }

  if (action === "restart") {
    // `restart()` seul laisserait l'ancien process en vie a cote du nouveau.
    await service.send({ command: "shutdown" })
    await wait(500)
    await service.restart()
    const announced = await until(() => service.interruptedRun() !== null, 15000)
    return { version: service.version(), announced, interruptedRun: service.interruptedRun() }
  }

  if (action === "tagging") {
    await until(() => service.taggingTracks().length > 0, 10000)
    const page = document.querySelector("app-tagging-page")
    const button = page?.querySelector("button[data-action]")
    return {
      url: location.pathname,
      folder: page ? ng.getComponent(page).folder() : null,
      requestedFolder: service.requestedFolder(),
      taggingFolder: service.taggingFolder(),
      action: button?.dataset.action ?? null,
      actionText: button?.textContent.trim() ?? null,
      tracks: service.taggingTracks().map((track) => track.state),
      arbitrationCount: service.arbitrationCount(),
      tagging: service.tagging(),
      arbitrationDialog: document.querySelector("app-arbitration-dialog .p-dialog") !== null,
    }
  }

  throw new Error(`action inconnue : ${action}`)
})()
