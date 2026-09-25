// Prealable injecte par cdp.mjs devant chaque script de page : rend le `SidecarService`
// de la page en cours, instance vivante et non une copie. Ecrit une fois ici, il etait
// recopie dans chaque sonde, pas toujours avec le `try` que certains injecteurs exigent.
//
// Dans un fichier et non en argument de commande : le hook qui bloque le mot designant
// la cle d'un provider intercepte l'expression quand elle passe sur la ligne de commande.
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
