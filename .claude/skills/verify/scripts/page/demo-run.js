// Parcours metier de la demo dans la fenetre Tauri, pour une revue a l'ecran : les
// chemins se posent sur les composants (cliquer « Choisir » ouvrirait le selecteur natif),
// puis les vrais boutons sont cliques.
//   node cdp.mjs page/demo-run.js last-destination [clear]   clear l'efface, si la demo l'a pose
//   node cdp.mjs page/demo-run.js playlist <dossier demo-data>
//   node cdp.mjs page/demo-run.js extract
//   node cdp.mjs page/demo-run.js tagging              apres `extract`, par « Passer au tagging »
//   node cdp.mjs page/demo-run.js run <dossier>        run seul, sans extraction dans la session
//   node cdp.mjs page/demo-run.js state
//   node cdp.mjs page/demo-run.js tag-widths <cle>     ex. playlist.report.category
;(async () => {
  const [action, target] = __args
  const service = __sidecarService()

  const openTab = async (pattern) => {
    const tab = [...document.querySelectorAll("p-tab, [role=tab]")].find((t) =>
      pattern.test(t.textContent || ""),
    )
    tab?.click()
    await wait(700)
  }
  const buttonByText = (pattern) =>
    [...document.querySelectorAll("button")].find((b) => pattern.test(b.textContent || "")) ?? null

  if (action === "last-destination") {
    const rid = await __TAURI_INTERNALS__.invoke("plugin:store|load", { path: "preferences.json" })
    if (target === "clear") {
      await __TAURI_INTERNALS__.invoke("plugin:store|delete", { rid, key: "last_destination" })
      await __TAURI_INTERNALS__.invoke("plugin:store|save", { rid })
    }
    return await __TAURI_INTERNALS__.invoke("plugin:store|get", { rid, key: "last_destination" })
  }

  if (action === "playlist") {
    if (!target) throw new Error("dossier demo-data manquant")
    const root = target.replace(/[\\/]+$/, "")
    await openTab(/playlist/i)
    const page = ng.getComponent(document.querySelector("app-playlist-page"))
    const dump = `${root}\\vlc_media.db`
    page.sourceFolder.set(`${root}\\Bibliotheque`)
    page.destinationFolder.set(`${root}\\Extraction`)
    page.playlistPath.set(dump)
    page.choice.update((current) => ({ ...current, playlist: null }))
    await service.listPlaylists(dump)
    await until(() => service.playlists().length > 0, 15000)
    page.choice.update((current) => ({ ...current, playlist: "test playlist" }))
    await wait(500)
    return {
      playlists: service.playlists().map((p) => p.name),
      canExtract: page.canExtract(),
    }
  }

  if (action === "extract") {
    const button = buttonByText(/Extraire la playlist|Extract the playlist/i)
    if (!button) throw new Error("bouton d'extraction introuvable")
    await until(() => !button.disabled, 10000)
    button.click()
    await until(() => service.extracting(), 5000)
    await until(() => !service.extracting(), 120000)
    const report = service.extraction()
    return (
      report && {
        extracted: report.extracted.length,
        already_present: report.already_present.length,
        missing: report.missing.length,
        duplicates: report.duplicates.length,
        failures: report.failures.length,
      }
    )
  }

  if (action === "tagging" || action === "run") {
    if (action === "tagging") {
      // Le toast de fin d'extraction recouvre le bouton : attendre qu'il parte.
      await until(() => document.querySelector(".p-toast-message") === null, 10000)
      const next = buttonByText(/Passer au tagging|Go to tagging/i)
      if (!next) throw new Error("« Passer au tagging » introuvable : l'extraction est-elle finie ?")
      next.click()
      await wait(1000)
    } else {
      // Sans extraction dans la session : le dossier se pose sur la page.
      if (!target) throw new Error("dossier a re-tagger manquant")
      await openTab(/tagging/i)
      ng.getComponent(document.querySelector("app-tagging-page")).folder.set(target)
      await wait(300)
    }
    const play = document
      .querySelector('app-tagging-page [data-p-icon="play"]')
      ?.closest("button")
    if (!play) throw new Error("bouton de lancement du run introuvable")
    await until(() => !play.disabled, 10000)
    play.click()
    await until(() => service.taggingRunId() !== null, 30000)
    return { runId: service.taggingRunId(), tracks: service.taggingTracks().length }
  }

  if (action === "tag-widths") {
    if (!target) throw new Error("cle de traduction manquante, ex. playlist.report.category")
    const tag = document.querySelector(".p-tag")
    if (!tag) throw new Error("aucun tag affiche dont lire la police")
    const context = document.createElement("canvas").getContext("2d")
    context.font = getComputedStyle(tag).font
    const widths = {}
    for (const lang of ["fr", "en"]) {
      const labels = target
        .split(".")
        .reduce((node, key) => node?.[key], await (await fetch(`/i18n/${lang}.json`)).json())
      for (const label of Object.values(labels ?? {})) {
        widths[`${lang} ${label}`] = Math.round(context.measureText(label).width * 10) / 10
      }
    }
    return Object.fromEntries(Object.entries(widths).sort(([, a], [, b]) => b - a))
  }

  if (action === "state") {
    const tracks = service.taggingTracks()
    const count = (predicate) => tracks.filter(predicate).length
    return {
      tagging: service.tagging(),
      progress: service.taggingProgress(),
      resolved: count((t) => t.state === "resolved"),
      unresolved: count((t) => t.state === "unresolved"),
      awaiting: service.arbitrationCount(),
      total: tracks.length,
    }
  }

  throw new Error(`action inconnue : ${action}`)
})()
