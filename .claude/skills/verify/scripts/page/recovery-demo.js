// Demo interactive du rattrapage dans la fenetre Tauri : un run simule defile (recherche,
// arbitrages, non resolus), puis chaque geste recoit une reponse plausible du faux sidecar.
// Lien YouTube ou hote inconnu : refus ; Beatport, Bandcamp, SoundCloud : rattrape. Refus de
// la liste Beatport : liste Bandcamp ; refus de la liste Bandcamp : non resolu, etape lien.
// Rien ne part vers le vrai sidecar ni vers l'API : `send` est remplace sur l'instance.
;(async () => {
  const svc = __sidecarService()
  const line = (event) => svc.handleLine(JSON.stringify(event))
  const RUN = `demo-${Date.now()}`
  let finished = false

  const names = [
    ["Amelie Lens", "Basiel"], ["Charlotte de Witte", "Selected"], ["Adam Beyer", "Your Mind"],
    ["Enrico Sangiuliano", "Symbiosis"], ["I Hate Models", "Daydream"], ["Kobosil", "105 Tension"],
    ["Klangkuenstler", "Untergang"], ["Nur Jaber", "Into the Void"], ["Hector Oaks", "Sentiment"],
    ["VTSS", "Identity Process"], ["Paula Temple", "Gegen"], ["Perc", "Look What Your Love Has Done to Me"],
    ["Ignez", "Ion"], ["Planetary Assault Systems", "Function Creep"],
  ]
  const tracks = names.map(([artist, title], i) => ({
    track_id: `${String(i + 1).padStart(2, "0")} ${artist.toLowerCase()} - ${title.toLowerCase()}.mp3`,
    file_name: `${String(i + 1).padStart(2, "0")} ${artist} - ${title}.mp3`,
    artist,
    title,
  }))
  const byId = new Map(tracks.map((t) => [t.track_id, t]))
  const reasons = ["no_result", "below_threshold", "source_unavailable", "empty_query", "no_result", "below_threshold"]
  const candidates = (t, source) => [
    { artist: t.artist, title: `${t.title} (Original Mix)`, label: source === "beatport" ? "Drumcode" : null, year: source === "beatport" ? 2021 : null, scores: { artist: 96, title: 74, average: 85 } },
    { artist: t.artist, title: `${t.title} (Remix)`, label: source === "beatport" ? "Tresor" : null, year: source === "beatport" ? 2019 : null, scores: { artist: 96, title: 70, average: 83 } },
  ]
  const arbitration = (t, source) => ({
    track_id: t.track_id, source, beatport_unavailable: false, empty_reason: null,
    other_source: source === "bandcamp" ? "beatport" : null, candidates: candidates(t, source),
  })
  const recoveryProgress = () => {
    if (!finished) return
    const rows = svc.taggingTracks()
    const recovered = rows.filter((r) => r.state === "resolved" && r.resolution === "url").length
    const waiting = rows.filter((r) => r.state === "unresolved").length
    line({ event: "progress", phase: "url_recovery", processed: recovered, total: recovered + waiting })
  }
  const sourceOf = (url) =>
    /(^|\.)beatport\.com\/track\//i.test(url) ? "beatport"
      : /\.bandcamp\.com\/track\//i.test(url) ? "bandcamp"
        : /soundcloud\.com\/[^/]+\/[^/]+/i.test(url) && !/youtube/i.test(url) ? "soundcloud"
          : null

  svc.send = async (command) => {
    const t = byId.get(command.track_id)
    if (command.command === "resolve_by_url" && t) {
      await wait(1200)
      const source = sourceOf(command.url)
      if (source === null) {
        line({ event: "error", code: "unsupported_url", params: { track_id: t.track_id }, message: "unsupported url", command: "resolve_by_url" })
        return
      }
      line({ event: "track_resolved", track_id: t.track_id, state: "resolved", resolution: "url", failure_reason: null, source, after: { artist: t.artist, title: t.title }, scores: null, artwork_path: null })
      recoveryProgress()
    } else if (command.command === "resolve_arbitration" && t) {
      await wait(800)
      if (command.candidate !== null) {
        const chosen = candidates(t, command.source)[command.candidate]
        line({ event: "track_resolved", track_id: t.track_id, state: "resolved", resolution: "arbitration", failure_reason: null, source: command.source, after: { artist: chosen.artist, title: chosen.title }, scores: chosen.scores, artwork_path: null })
      } else if (command.source === "beatport") {
        line({ event: "arbitration_updated", ...arbitration(t, "bandcamp") })
      } else {
        line({ event: "track_resolved", track_id: t.track_id, state: "unresolved", resolution: "none", failure_reason: "user_refused", source: null, after: null, scores: null, artwork_path: null })
      }
      recoveryProgress()
    } else if (command.command === "switch_arbitration_source" && t) {
      await wait(400)
      line({ event: "arbitration_updated", ...arbitration(t, command.source) })
    }
  }

  ;[...document.querySelectorAll("p-tab")].find((tab) => /tagging/i.test(tab.textContent))?.click()
  await wait(400)
  await svc.startTagging("C:/Musique/Demo")
  line({ event: "run_started", run_id: RUN, tracks })
  for (const [i, t] of tracks.entries()) {
    await wait(350)
    if (i < 6) {
      line({ event: "track_resolved", track_id: t.track_id, state: "resolved", resolution: "auto", failure_reason: null, source: i % 3 === 2 ? "bandcamp" : "beatport", after: { artist: t.artist, title: t.title }, scores: { artist: 98, title: 95, average: 96 }, artwork_path: null })
    } else if (i < 12) {
      line({ event: "track_resolved", track_id: t.track_id, state: "unresolved", resolution: "none", failure_reason: reasons[i - 6], source: null, after: null, scores: null, artwork_path: null })
    } else {
      line({ event: "arbitration_required", ...arbitration(t, "beatport") })
    }
    line({ event: "progress", phase: "tagging", processed: i + 1, total: tracks.length })
  }
  await wait(600)
  finished = true
  const rows = svc.taggingTracks()
  line({ event: "run_finished", phase: "network", run_id: RUN, resolved: rows.filter((r) => r.state === "resolved").length, unresolved: rows.filter((r) => r.state === "unresolved").length, awaiting_arbitration: svc.arbitrations().length })
  recoveryProgress()

  return { run: RUN, tracks: tracks.length, unresolved: svc.recoverableTracks().length, arbitrations: svc.arbitrations().length }
})()
