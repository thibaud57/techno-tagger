// Etat de la mise a jour dans la fenetre Tauri, sans geste : la verification du demarrage
// a-t-elle abouti ou echoue en silence, la modale ou le badge sont-ils affiches. Aucun appel au
// plugin ici : seule la verification que l'application lance d'elle-meme part sur le reseau.
//   node cdp.mjs page/update-state.js
;(() => {
  const updates = __service("UpdateService")
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
