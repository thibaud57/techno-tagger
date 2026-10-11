// Interruption d'un run a la demande, de bout en bout dans la fenetre Tauri.
//   node cdp.mjs page/cancel-run.js <dossier-a-re-tagger>
// Un seul bouton d'action (`data-action` : start, cancel, commit, retry) : « Lancer le run », puis
// « Interrompre » pendant le run, puis « Confirmer l'ecriture » tant que le run interrompu garde un
// morceau resolu. Dans ce dernier cas le bouton n'offre pas le lancement du meme dossier : la
// relance immediate passe par `service.startTagging`, le geste que le bouton fait en `start`.
// Le dossier doit faire durer le run : des titres inedits (build_fixture.py --unique) qui
// paient chacun leur aller-retour vers l'API, sans quoi il finit avant le clic.
;(async () => {
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

  const action = () => page.querySelector(".grid > button[data-action]")
  const describe = (el) =>
    el && {
      action: el.getAttribute("data-action"),
      icon: el.querySelector("[data-p-icon]")?.getAttribute("data-p-icon") ?? null,
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

  const idle = { action: describe(action()) }

  const errorsSeen = []
  const watchErrors = setInterval(() => {
    const code = service.lastError?.()?.code
    if (code && !errorsSeen.includes(code)) errorsSeen.push(code)
  }, 50)

  if (action()?.getAttribute("data-action") !== "start") throw new Error("le bouton d'action n'est pas en « Lancer le run »")
  action().click()
  await until(() => service.taggingRunId() !== null)
  await until(() => service.taggingTracks().filter((t) => t.state !== null).length >= 3, 20000)
  await wait(200)

  const before = snapshot(service.taggingTracks())
  const during = {
    action: describe(action()),
    running: service.tagging(),
    progressShown: !!page.querySelector("app-phase-progress"),
    decided: Object.keys(before).length,
    total: service.taggingTracks().length,
  }

  if (action()?.getAttribute("data-action") !== "cancel") throw new Error("le bouton d'action n'est pas en « Interrompre »")
  action().click()
  await wait(600)

  const now = snapshot(service.taggingTracks())
  const after = {
    running: service.tagging(),
    interrupted: service.taggingInterrupted(),
    progressShown: !!page.querySelector("app-phase-progress"),
    action: describe(action()),
    decidedKeptIntact: Object.entries(before).every(([id, kept]) => now[id] === kept),
    stillUndecided: service.taggingTracks().filter((t) => t.state === null).length,
    notProcessedTagsVisible: page.querySelectorAll('[data-p-icon="minus-circle"]').length,
  }

  // La relance immediate : le cas qui laissait l'ecran bloque en chargement.
  const restartedAt = Date.now()
  const viaButton = action()?.getAttribute("data-action") === "start"
  if (viaButton) action().click()
  else service.startTagging(folder)
  const restart = {
    via: viaButton ? "start button" : "service.startTagging",
    restarted: await until(() => service.taggingRunId() !== null, 20000),
    msToRunStarted: Date.now() - restartedAt,
    interruptedReset: service.taggingInterrupted() === false,
  }

  // Couper la relance : elle consommerait le quota de la vraie API pour rien.
  await wait(500)
  if (action()?.getAttribute("data-action") === "cancel") action().click()
  await wait(400)
  clearInterval(watchErrors)

  return { idle, during, after, restart, errorsSeen }
})()
