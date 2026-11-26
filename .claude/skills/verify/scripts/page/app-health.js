// Sante de l'application dans la fenetre Tauri, lecture seule : le service du sidecar
// est-il resolu par l'injecteur, le sidecar a-t-il repondu, chaque onglet s'ouvre-t-il.
//   node cdp.mjs page/app-health.js state    service, sidecar, langue, onglet courant
//   node cdp.mjs page/app-health.js tabs     clique chaque p-tab, releve l'URL et le h1
;(async () => {
  const [action] = __args
  const service = __sidecarService()

  // Reglages est un onglet a icone seule : son nom est son aria-label, son texte est vide.
  const tabName = (tab) => tab.getAttribute("aria-label") ?? tab.textContent.trim()

  const here = () => ({
    url: location.pathname,
    h1: document.querySelector("main h1")?.textContent?.trim() ?? null,
  })

  if (action === "state") {
    await until(() => service.version() !== null, 20000)
    return {
      available: service.available(),
      version: service.version(),
      versionMismatch: service.versionMismatch(),
      apiKeyConfigured: service.apiKeyConfigured(),
      // Portes par `version` : seul le sidecar les connait, `absent` tant qu'il ne les a pas envoyes
      defaultThresholds: service.defaultThresholds?.() ?? "absent",
      logFile: service.logFile?.() ?? "absent",
      lang: document.documentElement.lang,
      tabs: [...document.querySelectorAll("p-tab")].map(tabName),
      ...here(),
    }
  }

  if (action === "tabs") {
    const visited = []
    const tabs = [...document.querySelectorAll("p-tab")]
    for (const tab of [...tabs, tabs[0]]) {
      tab.click()
      await wait(400)
      visited.push({ tab: tabName(tab), ...here() })
    }
    return { visited }
  }

  throw new Error(`action inconnue : ${action}`)
})()
