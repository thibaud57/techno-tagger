// Sante de l'application dans la fenetre Tauri, sans geste metier : le service du sidecar
// est-il resolu par l'injecteur, le sidecar a-t-il repondu, chaque onglet s'ouvre-t-il.
// Premier controle apres une montee de dependances ou un changement de decorateur DI.
//   node cdp.mjs page/app-health.js state    service, sidecar, langue, onglet courant
//   node cdp.mjs page/app-health.js tabs     clique chaque p-tab, releve l'URL et le h1
//   node cdp.mjs page/app-health.js list <dump>    listPlaylists sur un dump de fixture
;(async () => {
  const [action, target] = __args
  const service = __sidecarService()

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
