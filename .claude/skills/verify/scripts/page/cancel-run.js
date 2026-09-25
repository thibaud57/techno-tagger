// Interruption d'un run a la demande, de bout en bout dans la fenetre Tauri.
//   node cdp.mjs page/cancel-run.js <dossier-a-re-tagger>
// Le dossier doit faire durer le run : des titres inedits (build_fixture.py --unique) qui
// paient chacun leur aller-retour vers l'API, sans quoi il finit avant le clic.
;(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async (check, timeout = 30000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (check()) return true
      await wait(100)
    }
    return false
  }

  const [folder] = __args
  if (!folder) throw new Error("dossier a re-tagger manquant")
  const service = __sidecarService()

  const tab = [...document.querySelectorAll("p-tab, [role=tab]")].find((t) =>
    /tagging/i.test(t.textContent || ""),
  )
  tab?.click()
  await wait(700)

  // Le dossier se pose sur le composant : cliquer « Choisir » ouvrirait le selecteur natif
  // sur l'ecran de l'utilisateur, `__TAURI_INTERNALS__.invoke` n'etant pas remplacable.
  const page = document.querySelector("app-tagging-page")
  ng.getComponent(page).folder.set(folder)
  await wait(300)

  const button = (icon) => page.querySelector(`[data-p-icon="${icon}"]`)?.closest("button") ?? null
  const describe = (el) =>
    el && {
      left: Math.round(el.getBoundingClientRect().left),
      disabled: el.disabled,
      classes: [...el.classList].filter((c) => c.startsWith("p-button")),
      text: el.textContent.trim(),
    }
  const snapshot = (tracks) =>
    Object.fromEntries(
      tracks
        .filter((t) => t.state !== null)
        .map((t) => [t.trackId, JSON.stringify([t.state, t.source, t.scores])]),
    )

  const idle = { stop: describe(button("stop")), play: describe(button("play")) }

  const errorsSeen = []
  const watchErrors = setInterval(() => {
    const code = service.lastError?.()?.code
    if (code && !errorsSeen.includes(code)) errorsSeen.push(code)
  }, 50)

  button("play").click()
  await until(() => service.taggingRunId() !== null)
  await until(() => service.taggingTracks().filter((t) => t.state !== null).length >= 3, 20000)
  await wait(200)

  const before = snapshot(service.taggingTracks())
  const during = {
    stop: describe(button("stop")),
    play: describe(button("play")),
    running: service.tagging(),
    progressShown: !!page.querySelector("app-phase-progress"),
    decided: Object.keys(before).length,
    total: service.taggingTracks().length,
  }

  button("stop").click()
  await wait(600)

  const now = snapshot(service.taggingTracks())
  const after = {
    running: service.tagging(),
    interrupted: service.taggingInterrupted(),
    progressShown: !!page.querySelector("app-phase-progress"),
    stop: describe(button("stop")),
    play: describe(button("play")),
    decidedKeptIntact: Object.entries(before).every(([id, kept]) => now[id] === kept),
    stillUndecided: service.taggingTracks().filter((t) => t.state === null).length,
    notProcessedTagsVisible: page.querySelectorAll('[data-p-icon="minus-circle"]').length,
  }

  // La relance immediate : le cas qui laissait l'ecran bloque en chargement.
  const restartedAt = Date.now()
  button("play").click()
  const restart = {
    restarted: await until(() => service.taggingRunId() !== null, 20000),
    msToRunStarted: Date.now() - restartedAt,
    interruptedReset: service.taggingInterrupted() === false,
  }

  // Couper la relance : elle consommerait le quota de la vraie API pour rien.
  await wait(500)
  button("stop")?.click()
  await wait(400)
  clearInterval(watchErrors)

  return { idle, during, after, restart, errorsSeen }
})()
