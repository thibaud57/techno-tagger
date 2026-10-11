// En-tete de la modale ouverte dans la fenetre Tauri : place de la croix face au titre et au
// bord du contenu. Ne geste rien, la modale s'ouvre par une autre sonde.
//   node cdp.mjs page/dialog-header.js
;(async () => {
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      right: Math.round(r.right),
      cy: Math.round(r.top + r.height / 2),
    }
  }
  const dialog = [...document.querySelectorAll(".p-dialog")].find((d) => d.offsetParent !== null)
  if (!dialog) throw new Error("aucune modale ouverte")
  const header = dialog.querySelector(".p-dialog-header")
  const title = header.querySelector("h3, .p-dialog-title")
  const close = header.querySelector(".p-dialog-close-button")
  const box = rect(dialog)
  const text = rect(title?.querySelector("app-truncated-text, span") ?? title)
  const icon = rect(close?.querySelector("svg"))
  const logo = rect(header.querySelector("app-source-logo svg, app-source-logo img"))
  return {
    logo,
    logoToIconCenter: logo && icon && icon.cy - logo.cy,
    // Le logo de la source tient la ligne du titre (`h-7` de `app-dialog-header`) : attendu nul.
    logoToTitleCenter: logo && text && logo.cy - text.cy,
    sharedHeader: header.querySelector("app-dialog-header h3[data-title]") !== null,
    dialog: box,
    headerPadding: getComputedStyle(header).padding,
    headerAlign: getComputedStyle(header).alignItems,
    title: text,
    titleLineHeight: title && getComputedStyle(title).lineHeight,
    closeButton: rect(close),
    closeIcon: icon,
    leftInset: text && text.x - box.x,
    rightInset: icon && box.right - icon.right,
    iconToTitleCenter: icon && text && icon.cy - text.cy,
  }
})()
