// Etat de la mise a jour dans la fenetre Tauri, sans geste : la verification du demarrage
// a-t-elle abouti ou echoue en silence, la modale ou le badge sont-ils affiches. Aucun appel au
// plugin ici : seule la verification que l'application lance d'elle-meme part sur le reseau.
//   node cdp.mjs page/update-state.js
;(() => {
  const root = ng.getInjector(document.querySelector("app-root"))
  let updates = null
  for (const injector of ng["ɵgetInjectorResolutionPath"](root)) {
    let providers
    try {
      providers = ng["ɵgetInjectorProviders"](injector)
    } catch {
      continue
    }
    for (const record of Object.values(providers)) {
      const provided = Object.values(record).find((v) => typeof v === "function" && v.name.endsWith("UpdateService"))
      if (provided) updates = injector.get(provided)
    }
    if (updates) break
  }
  if (!updates) throw new Error("UpdateService introuvable : la page est-elle un build de dev ?")
  const state = updates.state()
  return {
    success: true,
    kind: state.kind,
    offered: state.kind === "none" ? null : state.update.version,
    dialogVisible: updates.dialogVisible(),
    badgeVisible: updates.badgeVisible(),
    dialog: document.querySelector(".p-dialog h3")?.textContent.trim() ?? null,
    badge: document.querySelector("[data-update-badge]")?.textContent.trim() ?? null,
    sidecar: { available: __sidecarService().available(), version: __sidecarService().version() },
  }
})()
