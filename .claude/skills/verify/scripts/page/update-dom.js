// Invite de mise a jour dans une application installee : le build de release n'expose pas `ng`,
// tout se lit dans le DOM. `click` clique le bouton principal de la modale (« Installer »).
//   node cdp.mjs page/update-dom.js [state|click]
;(() => {
  const dialog = document.querySelector(".p-dialog")
  const install = dialog?.querySelector('[data-action="install"]')
  if (__args[0] === "click") {
    if (!install || install.disabled) return { error: true, message: "bouton Installer absent ou grise" }
    install.click()
  }
  return {
    success: true,
    dialog: dialog?.querySelector(".p-dialog-header h3")?.textContent.trim() ?? null,
    body: dialog?.querySelector(".p-dialog-content")?.textContent.replace(/\s+/g, " ").trim() ?? null,
    note: dialog?.querySelector("app-message")?.textContent.trim() ?? null,
    install: install ? { text: install.textContent.trim(), disabled: install.disabled } : null,
    badge: document.querySelector("[data-update-badge]")?.textContent.trim() ?? null,
    // Ecran bloquant : sidecar absent ou d'une autre version que l'interface apres la mise a jour.
    blocked: document.querySelector("p-card")?.textContent.replace(/\s+/g, " ").trim() ?? null,
    tabs: [...document.querySelectorAll("p-tab")].map((t) => t.textContent.trim()),
  }
})()
