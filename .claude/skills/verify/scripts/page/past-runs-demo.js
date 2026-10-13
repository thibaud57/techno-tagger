// Demo vivante des runs passes dans la fenetre Tauri, pour une revue a l'ecran : le transport est
// remplace sur l'instance, `list_runs` et `load_run` recoivent des reponses plausibles, rien ne
// part vers le vrai sidecar. La personne clique elle-meme dans les Reglages ; chaque run de la
// liste mene a un etat du recapitulatif (charge, dossier long, rapport disparu, ecriture en cours).
// Actions : `list` (liste de demo, onglet Reglages), `empty` (registre vide), `slow <ms>` (delai
// de `run_loaded`, squelettes visibles), `real` (rend le vrai transport et relance `list_runs`).
// Perdue au moindre rechargement de la page.
;(async () => {
  const svc = __sidecarService()
  const [action = "list", arg] = __args
  const line = (event) => svc.handleLine(JSON.stringify(event))

  const KEYS = [["artist", "TPE1"], ["title", "TIT2"], ["genre", "TCON"], ["bpm", "TBPM"], ["label", "TPUB"], ["date", "TDRC"], ["source", "TXXX:SOURCE"], ["url", "WXXX"]]
  const tagsBefore = (t) => ({
    system: "id3",
    comment: "Ripped by X",
    fields: KEYS.map(([field, key]) => ({ field, key, value: { artist: t.artist.toLowerCase(), title: t.title.toLowerCase(), bpm: "130" }[field] ?? null })),
  })
  const tagsAfter = (t, source, link) =>
    KEYS.map(([field, key]) => ({ field, key, value: { artist: t.artist, title: `${t.title} (Original Mix)`, genre: "Techno", bpm: "130", label: "Kestrel", date: "2023", source, url: link }[field] ?? null }))
  const LINK = {
    beatport: (t) => `https://www.beatport.com/track/${t.title.toLowerCase().replace(/\W+/g, "-")}/990001${t.n}`,
    bandcamp: (t) => `https://${t.artist.toLowerCase().replace(/\W+/g, "")}.bandcamp.com/track/${t.title.toLowerCase().replace(/\W+/g, "-")}`,
    soundcloud: (t) => `https://soundcloud.com/${t.artist.toLowerCase().replace(/\W+/g, "-")}/${t.title.toLowerCase().replace(/\W+/g, "-")}`,
  }
  // [artiste, titre, etat, voie, source, motif]
  const ROWS = [
    ["Lior Vance", "Dim Orbit", "written", "auto", "beatport", null],
    ["Orla Quenby", "Kelvor", "written", "auto", "beatport", null],
    ["Seraphine de Vossa", "Gossamer", "written", "auto", "beatport", null],
    ["Valka", "Ark", "written", "auto", "beatport", null],
    ["Ria Javel", "Over the Moor", "written", "arbitration", "bandcamp", null],
    ["Ilan Thorne", "Tidewater", "written", "arbitration", "beatport", null],
    ["Nadia Fenner", "Dunst", "written", "url", "soundcloud", null],
    ["Tavrosk", "212 Cadence", "write_error", "arbitration", "beatport", "file_locked"],
    ["QRLM", "Hollow Frequency", "unresolved", "none", null, "no_result"],
    ["Dorn", "Where Every Little Light Went Out", "unresolved", "none", null, "user_refused"],
    ["Odd Neon Owls", "Emberfly", "rolled_back", "auto", "beatport", null],
  ]
  const tracks = ROWS.map(([artist, title, state, resolution, source, reason], i) => {
    const t = { artist, title, n: String(i + 1).padStart(2, "0") }
    const resolved = source !== null
    const link = resolved ? LINK[source](t) : null
    const fileName = `${t.n} ${artist.toLowerCase()} - ${title.toLowerCase()}.mp3`
    return {
      track_id: fileName, file_name: fileName,
      file_after: state === "written" ? `${artist} - ${title} (Original Mix).mp3` : null,
      artist, title, state, resolution, failure_reason: reason, source,
      after: resolved ? { artist, title: `${title} (Original Mix)` } : null,
      scores: resolution === "url" || !resolved ? null : { artist: 96, title: resolution === "auto" ? 93 : 74, average: resolution === "auto" ? 94 : 85 },
      tags_before: tagsBefore(t), tags_after: resolved ? tagsAfter(t, source, link) : null,
      source_url: link, artwork_path: null,
    }
  })
  const run = (run_id, written_at, folder) => ({ run_id, written_at, folder, report_path: `${folder}/tagging-report.json` })
  const RUNS = [
    run("demo-aout", "2026-08-06T21:30:00Z", "D:/Sets/Aout"),
    run("demo-long", "2026-08-03T19:05:00Z", "D:/Sets/Techno/Archives 2026/Resident nights/Warehouse series/Saturday closing set with the long extended edits"),
    run("demo-missing", "2026-07-28T22:10:00Z", "D:/Sets/Rapport supprime"),
    run("demo-busy", "2026-07-20T18:45:00Z", "D:/Sets/Ecriture en cours"),
  ]

  const demo = (window.__pastRunsDemo ??= { realSend: svc.transport.send.bind(svc.transport), runs: RUNS, delay: 1200 })
  svc.transport.send = async (text) => {
    const command = JSON.parse(text)
    if (command.command === "list_runs") {
      await wait(200)
      line({ event: "runs_listed", runs: demo.runs })
    } else if (command.command === "load_run") {
      const target = demo.runs.find((r) => r.run_id === command.run_id)
      await wait(demo.delay)
      if (!target || target.run_id === "demo-missing") {
        line({ event: "error", code: "run_not_found", params: { run_id: command.run_id }, message: "run_not_found", command: "load_run" })
      } else if (target.run_id === "demo-busy") {
        line({ event: "error", code: "phase_busy", params: { phase: "write" }, message: "phase_busy", command: "load_run" })
      } else {
        line({ event: "run_loaded", run_id: target.run_id, folder: target.folder, generated_at: target.written_at, tracks })
      }
    } else {
      return demo.realSend(text)
    }
  }

  const toSettings = async () => {
    ;[...document.querySelectorAll("p-tab")].find((tab) => /r[ée]glages|settings/i.test(tab.textContent))?.click()
    await wait(300)
  }

  if (action === "list" || action === "empty") {
    demo.runs = action === "empty" ? [] : RUNS
    await svc.listRuns()
    await toSettings()
    return { success: true, action, runs: demo.runs.map((r) => `${r.run_id} ${r.folder}`), delay: demo.delay }
  }
  if (action === "slow") {
    demo.delay = Number(arg ?? 6000)
    return { success: true, action, delay: demo.delay }
  }
  if (action === "real") {
    svc.transport.send = demo.realSend
    delete window.__pastRunsDemo
    await svc.listRuns()
    return { success: true, action }
  }
  return { error: true, message: `action inconnue : ${action} (list | empty | slow <ms> | real)` }
})()
