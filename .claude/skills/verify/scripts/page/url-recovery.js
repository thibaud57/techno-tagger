// Rattrapage par la modale du lien dans la fenetre Tauri :
//   `open <n>`    ouvre la modale par la n-ieme ligne rattrapable du run (clic DOM sur la ligne)
//   `paste <url>` colle l'URL dans le champ de la modale ouverte, clique « Resoudre » et attend
//                 la reponse du service
//   `state`       releve la barre, le badge, la modale et, pour l'erreur affichee, son ecart au
//                 champ qui la precede et au pied qui la suit (attendu egal, DESIGN.md § Feedback)
;(async () => {
  const [action, arg] = __args
  const svc = __sidecarService()
  const dialog = () => [...document.querySelectorAll(".p-dialog")].find((d) => d.offsetParent !== null)

  if (action === "open") {
    ;[...document.querySelectorAll("p-tab")].find((tab) => /tagging/i.test(tab.textContent))?.click()
    await until(() => document.querySelector("app-run-list tbody tr") !== null, 5000)
    const rows = [...document.querySelectorAll("app-run-list tr[data-recoverable]")]
    const row = rows[Number(arg)]
    if (!row) throw new Error(`aucune ligne rattrapable ${arg} (${rows.length} affichees)`)
    row.click()
    await until(() => dialog() !== undefined, 5000)
  } else if (action === "paste") {
    const field = dialog()?.querySelector('[data-field="url"]')
    if (!field) throw new Error("aucune modale de lien ouverte")
    field.value = arg
    field.dispatchEvent(new Event("input"))
    await wait(100)
    dialog().querySelector('[data-action="resolve-url"]')?.click()
    await wait(200)
    await until(() => svc.urlRecoveryBusy().size === 0, 30000)
    // L'entree de p-message s'anime : mesurer une fois l'animation finie.
    await wait(1500)
  } else if (action !== "state") {
    throw new Error(`action inconnue : ${action}`)
  }

  const shown = dialog()
  const error = shown?.querySelector("app-error-message")
  const gap = () => {
    const box = error.getBoundingClientRect()
    const field = shown.querySelector('[data-field="url"]').getBoundingClientRect()
    const footer = shown.querySelector(".p-dialog-footer").getBoundingClientRect()
    return { above: Math.round(box.top - field.bottom), below: Math.round(footer.top - box.bottom) }
  }
  return {
    bar: document.querySelector("app-phase-progress")?.textContent.replace(/\s+/g, " ").trim() ?? null,
    badge: document.querySelector("[data-recovery-badge]")?.textContent.trim() ?? null,
    dialog: shown
      ? {
          title: shown.querySelector("h3")?.textContent.trim(),
          height: Math.round(shown.getBoundingClientRect().height),
          error: error ? { text: error.textContent.replace(/\s+/g, " ").trim(), ...gap() } : null,
        }
      : null,
  }
})()
