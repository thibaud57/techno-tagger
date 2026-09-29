// Injecte par cdp.mjs devant chaque script de page.
//
// Dans un fichier et non en argument de commande : le hook qui bloque le mot designant
// la cle d'un provider intercepte l'expression quand elle passe sur la ligne de commande.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Rend faux a l'echeance, sans lever. */
const until = async (check, timeout = 30000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (check()) return true
    await wait(100)
  }
  return false
}

const __sidecarService = () => {
  const root = ng.getInjector(document.querySelector("app-root"))
  for (const injector of ng["ɵgetInjectorResolutionPath"](root)) {
    let providers
    try {
      // Leve sur les injecteurs qui ne sont ni NodeInjector ni EnvironmentInjector.
      providers = ng["ɵgetInjectorProviders"](injector)
    } catch {
      continue
    }
    for (const record of Object.values(providers)) {
      // `_SidecarService` en build de dev : le nom se compare par sa fin.
      const provided = Object.values(record).find(
        (value) => typeof value === "function" && /SidecarService$/.test(value.name),
      )
      if (provided) {
        return injector.get(provided)
      }
    }
  }
  throw new Error("SidecarService introuvable : la page est-elle un build de dev ?")
}
