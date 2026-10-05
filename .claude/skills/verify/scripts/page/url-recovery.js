// Bloc de rattrapage par URL dans la fenetre : `paste <ligne> <url>` envoie l'URL par le
// vrai service, comme le bouton « Resoudre » ; `state` releve les lignes, leurs erreurs et
// l'ecart de chaque erreur a ce qui la precede et la suit.
;(async () => {
  const [action, ...rest] = __args
  const svc = __sidecarService()
  const rows = () => [...document.querySelectorAll("app-url-recovery li")]

  if (action === "paste") {
    const [index, url] = rest
    const track = svc.recoverableTracks()[Number(index)]
    if (!track) throw new Error(`aucune ligne ${index} dans le bloc`)
    await svc.resolveByUrl(track.trackId, url)
    await until(() => !svc.urlRecoveryBusy().has(track.trackId), 30000)
    await wait(300)
  } else if (action !== "state") {
    throw new Error(`action inconnue : ${action}`)
  }

  return {
    rows: rows().length,
    bar: document.querySelector("app-phase-progress")?.textContent.replace(/\s+/g, " ").trim() ?? null,
    errors: [...document.querySelectorAll("app-error-message")].map((error) => {
      const box = error.getBoundingClientRect()
      const line = error.closest("li")
      const before = (line ? line.firstElementChild : error.previousElementSibling)?.getBoundingClientRect()
      const after = (line ? line.nextElementSibling : error.nextElementSibling)?.getBoundingClientRect()
      return {
        text: error.textContent.replace(/\s+/g, " ").trim(),
        above: before ? Math.round(box.top - before.bottom) : null,
        below: after ? Math.round(after.top - box.bottom) : null,
      }
    }),
  }
})()
