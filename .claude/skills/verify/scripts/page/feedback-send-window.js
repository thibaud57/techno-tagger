// Bouton « Envoyer ce rapport » dans la fenetre Tauri, sur un VRAI run ecrit (fixture de `drive.py`,
// meme `LOCALAPPDATA`) rouvert par le routeur depuis le registre du vrai sidecar. Rendu et tooltip
// seulement : JAMAIS de clic sur le bouton ici, il ouvrirait le vrai navigateur et le vrai Explorateur
// de l'utilisateur (`__TAURI_INTERNALS__.invoke` n'est pas reinscriptible, cf. SKILL.md § Gotchas).
//   node cdp.mjs page/feedback-send-window.js open <runId>    ouvre /tagging/recap/<runId> et attend le run charge
//   node cdp.mjs page/feedback-send-window.js lang <fr|en>    langue de l'interface, sans ecrire le `preferences.json`
//   node cdp.mjs page/feedback-send-window.js state           bouton (etat, icone, classes, curseur), pied, defilement, attente du service
//   node cdp.mjs page/feedback-send-window.js buttons         centre du bouton, pour `--move` (survol reel) puis `tooltip`
//   node cdp.mjs page/feedback-send-window.js tooltip         `.p-tooltip` ouvert : texte, lignes, cote, ecart, largeur, place sous le bouton
//   node cdp.mjs page/feedback-send-window.js leave           retour a /tagging (par le routeur)
;(async () => {
  const [action, ...rest] = __args
  const root = () => document.querySelector("app-root")
  const send = () => document.querySelector('app-recap-page [data-action="send-report"]')
  const r = (element) => element.getBoundingClientRect()
  const flat = (text) => String(text).replace(/[ \t\r\n]+/g, " ").trim()

  if (action === "open") {
    const [runId] = rest
    await ng.getComponent(root()).router.navigateByUrl(`/tagging/recap/${runId}`)
    const loaded = await until(() => document.querySelector("app-recap-page app-run-list tr [data-row-toggle]") !== null && send() !== null, 15000)
    await wait(500)
    return {
      url: location.pathname,
      loaded,
      rows: document.querySelectorAll("app-recap-page [data-row-toggle]").length,
      context: flat(document.querySelector("app-recap-page [data-run-context]")?.textContent ?? ""),
    }
  }

  if (action === "lang") {
    const [language] = rest
    ng.getComponent(root()).translate.use(language)
    await wait(600)
    return { lang: document.documentElement.lang, label: flat(send()?.textContent ?? "") }
  }

  if (action === "leave") {
    await ng.getComponent(root()).router.navigateByUrl("/tagging")
    await wait(500)
    return { url: location.pathname }
  }

  if (action === "buttons") {
    const b = send()
    const box = r(b)
    return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2), disabled: b.disabled }
  }

  // Pose un compteur d'evenements souris sur le bouton : dit si le survol reel arrive jusqu'a la page.
  if (action === "watch") {
    const b = send()
    window.__sendHover = { enter: 0, over: 0, move: 0, leave: 0 }
    b.addEventListener("mouseenter", () => (window.__sendHover.enter += 1))
    b.addEventListener("mouseover", () => (window.__sendHover.over += 1))
    b.addEventListener("mousemove", () => (window.__sendHover.move += 1))
    b.addEventListener("mouseleave", () => (window.__sendHover.leave += 1))
    return { focus: document.hasFocus(), visibility: document.visibilityState }
  }

  if (action === "watched") {
    return { ...window.__sendHover, focus: document.hasFocus(), visibility: document.visibilityState, tooltips: document.querySelectorAll(".p-tooltip").length }
  }

  if (action === "state") {
    const b = send()
    const back = document.querySelector('app-recap-page [data-action="back"]')
    const foot = back.parentElement
    const ctx = foot.querySelector("[data-run-context]")
    const svc = __sidecarService()
    const icon = b.querySelector("[data-p-icon]")
    const labelNode = [...b.childNodes].find((n) => n.nodeType === 3 && n.data.trim() !== "")
    const range = document.createRange()
    range.selectNodeContents(labelNode)
    const label = range.getBoundingClientRect()
    const main = document.querySelector("main")
    const centers = [back, b, ctx].filter(Boolean).map((e) => Math.round(r(e).top + r(e).height / 2))
    return {
      url: location.pathname,
      lang: document.documentElement.lang,
      viewport: { w: innerWidth, h: innerHeight },
      available: svc.available(),
      feedbackPending: svc.feedbackPending(),
      button: {
        count: document.querySelectorAll('app-recap-page [data-action="send-report"]').length,
        disabled: b.disabled,
        label: flat(b.textContent),
        icon: icon?.getAttribute("data-p-icon") ?? null,
        iconSize: icon ? Math.round(r(icon).width) : null,
        iconBeforeLabel: icon ? r(icon).right <= label.left + 0.5 : null,
        labelClipped: b.scrollWidth > b.clientWidth + 1,
        cls: b.className,
        styleAttr: b.getAttribute("style"),
        cursor: getComputedStyle(b).cursor,
        width: Math.round(r(b).width),
        height: Math.round(r(b).height),
        backHeight: Math.round(r(back).height),
      },
      footer: {
        cls: foot.className,
        afterBack: Math.round((r(b).left - r(back).right) * 10) / 10,
        oneRow: Math.max(...centers) - Math.min(...centers) <= 1,
        overflow: foot.scrollWidth > foot.clientWidth + 1,
        ctxText: ctx ? flat(ctx.textContent) : null,
        ctxRight: ctx ? Math.round(r(foot.parentElement.firstElementChild).right - r(ctx).right) : null,
      },
      pageScroll:
        document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight ||
        main.scrollHeight > main.clientHeight + 1,
      pageWide: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth,
      error: document.querySelector("app-recap-page [data-feedback-error]") !== null,
    }
  }

  if (action === "tooltip") {
    const tip = document.querySelector(".p-tooltip")
    if (tip === null) return { open: false }
    const host = r(send())
    const box = r(tip)
    const textEl = tip.querySelector(".p-tooltip-text") ?? tip
    const range = document.createRange()
    range.selectNodeContents(textEl)
    const node = [...textEl.childNodes].find((n) => n.nodeType === 3)
    return {
      open: true,
      text: tip.textContent,
      paragraphs: node ? node.data.split("\n").length : 1,
      lines: new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size,
      whiteSpace: getComputedStyle(textEl).whiteSpace,
      wide: tip.classList.contains("tt-tooltip-wide"),
      pointerEvents: getComputedStyle(tip).pointerEvents,
      width: Math.round(box.width),
      height: Math.round(box.height),
      side: box.top >= host.bottom - 0.5 ? "below" : box.bottom <= host.top + 0.5 ? "above" : "overlap",
      gapToButton: Math.round(box.top >= host.bottom - 0.5 ? box.top - host.bottom : host.top - box.bottom),
      roomBelowButton: Math.round(innerHeight - host.bottom),
      // Sous le bouton si la place suffit a la hauteur du tooltip, sinon au-dessus (PrimeNG le retourne) : jamais masque, cote, place et hauteur restent releves.
      expectedSide: innerHeight - host.bottom >= box.height ? "below" : "above",
      sideOk: (box.top >= host.bottom - 0.5 ? "below" : box.bottom <= host.top + 0.5 ? "above" : "overlap") === (innerHeight - host.bottom >= box.height ? "below" : "above"),
      centerOffset: Math.round(box.left + box.width / 2 - (host.left + host.width / 2)),
      inWindow: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
    }
  }

  throw new Error(`action inconnue : ${action}`)
})()
