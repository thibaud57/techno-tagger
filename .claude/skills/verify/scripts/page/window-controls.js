// Barre de titre maison dans la fenetre Tauri (`decorations: false`) : `state` relit les trois
// boutons de fenetre, leur libelle et les zones de deplacement ; `click <minimize|maximize|close>`
// clique le bouton (la fermeture passe par la garde de sortie).
//   node cdp.mjs page/window-controls.js [state|click] [nom]
;(async () => {
  const button = (name) => document.querySelector(`app-window-controls [data-action="${name}"]`)
  if (__args[0] === "click") {
    const target = button(__args[1])
    if (!target) return { error: true, message: `bouton ${__args[1]} absent` }
    target.click()
    await wait(600)
  }
  const bar = document.querySelector("p-tablist") ?? document.querySelector("[data-tauri-drag-region]")
  return {
    success: true,
    bar: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    controls: ["minimize", "maximize", "close"].map((name) => {
      const b = button(name)
      return b ? { name, label: b.getAttribute("aria-label"), width: Math.round(b.getBoundingClientRect().width) } : null
    }),
    dragRegions: document.querySelectorAll("[data-tauri-drag-region]").length,
    size: { width: window.innerWidth, height: window.innerHeight },
  }
})()
