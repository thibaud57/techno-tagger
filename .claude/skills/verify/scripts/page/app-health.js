// Sante de l'application dans la fenetre Tauri, sans geste metier : le service du sidecar
// est-il resolu par l'injecteur, le sidecar a-t-il repondu, chaque onglet s'ouvre-t-il.
// Premier controle apres une montee de dependances ou un changement de decorateur DI.
//   node cdp.mjs page/app-health.js state    service, sidecar, langue, onglet courant
//   node cdp.mjs page/app-health.js tabs     clique chaque p-tab, releve l'URL et le h1
//   node cdp.mjs page/app-health.js list <dump>    listPlaylists sur un dump de fixture
//   node cdp.mjs page/app-health.js cache    get_cache_size puis clear_cache, signaux relus
;(async () => {
  const [action, target] = __args
  const service = __sidecarService()

  const here = () => ({
    url: location.pathname,
    h1: document.querySelector("main h1")?.textContent?.trim() ?? null,
    // Reglages seulement : une cle enregistree se lit a son placeholder de 24 points, sans tag
    // d'etat, l'oeil n'apparaissant que pendant une saisie.
    ...(document.querySelector("app-settings-page")
      ? {
          keyPlaceholder: document.querySelector("#api-key")?.placeholder ?? null,
          keyStateTag: document.querySelector("app-settings-page p-tag") !== null,
          keyEye: document.querySelector("app-settings-page p-inputicon") !== null,
          // Zone sous la ligne de chaque rangee : masquee quand elle ne porte aucun element.
          rowZones: [...document.querySelectorAll("app-settings-row > div.col-start-2")].map((zone) => ({
            display: getComputedStyle(zone).display,
            nodes: [...zone.childNodes].map((n) => (n.nodeType === 1 ? n.tagName.toLowerCase() : `#${n.nodeType}`)),
          })),
        }
      : {}),
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
      tabs: [...document.querySelectorAll("p-tab")].map((tab) => tab.textContent.trim()),
      ...here(),
    }
  }

  if (action === "tabs") {
    const visited = []
    const tabs = [...document.querySelectorAll("p-tab")]
    for (const tab of [...tabs, tabs[0]]) {
      tab.click()
      await wait(400)
      visited.push({ tab: tab.textContent.trim(), ...here() })
    }
    return { visited }
  }

  if (action === "cache") {
    // Mesure puis vidage par le vrai sidecar : `cacheSize` suit les deux, `cacheCleared` le second
    await service.loadCacheSize()
    await until(() => service.cacheSize() !== null, 10000)
    const measured = service.cacheSize()
    await service.clearCache()
    await until(() => service.cacheCleared() !== null || service.lastError() !== null, 10000)
    return {
      measured,
      cleared: service.cacheCleared(),
      cacheSize: service.cacheSize(),
      lastError: service.lastError()?.code ?? null,
    }
  }

  if (action === "list") {
    await service.listPlaylists(target)
    // `listedPlaylistPath` est pose avant l'envoi : seule la reponse dit que le listage est fait
    await until(() => service.playlistFormat() !== null || service.lastError() !== null, 10000)
    return {
      playlistFormat: service.playlistFormat(),
      playlists: service.playlists().map((p) => `${p.name} (${p.track_count})`),
      lastError: service.lastError()?.code ?? null,
    }
  }

  throw new Error(`action inconnue : ${action}`)
})()
