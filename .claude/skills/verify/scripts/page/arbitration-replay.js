// Rejoue dans la page le flux NDJSON reel d'un run d'arbitrage (sortie de drive.py) et
// intercale les gestes du service avant chacune de leurs reponses. Usage :
//   node cdp.mjs page/arbitration-replay.js "<flux ndjson>" "<gestes JSON>"
// Les gestes sont des groupes `[[methode, ...arguments], ...]` : le groupe i part juste
// avant la i-eme reponse qui suit `run_finished` (arbitration_updated, track_resolved ou
// error). `send` est remplace le temps du rejeu : les commandes sont relevees pour etre
// comparees a celles que drive.py a envoyees, et ne partent pas vers le sidecar de la
// fenetre, qui parle a la vraie API. Les `version` du flux sont sautes : ceux du sidecar
// Python des sources ne disent rien de la fenetre et pourraient poser un faux ecart.
;(async () => {
  const [stream, gesturesArg] = __args
  if (!stream) throw new Error("flux NDJSON manquant")
  const groups = JSON.parse(gesturesArg ?? "[]")
  const service = __sidecarService()
  const boot = {
    available: service.available(),
    version: service.version(),
    versionMismatch: service.versionMismatch(),
  }
  const answers = ["arbitration_updated", "track_resolved", "error"]

  const sent = []
  const originalSend = service.send
  service.send = async (command) => {
    sent.push(command)
  }
  const logged = []
  const originalError = console.error
  console.error = (...parts) => {
    logged.push(parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "))
    originalError(...parts)
  }

  const state = (step) => {
    const current = service.currentArbitration()
    return {
      step,
      queue: service
        .arbitrations()
        .map((entry) => [entry.track_id, entry.source, entry.other_source, entry.candidates.length]),
      current: current && [current.track_id, current.source],
      position: `${service.arbitrationPosition()}/${service.arbitrationCount()}`,
      busy: service.arbitrationBusy(),
      rows: service.taggingTracks().map((track) => [track.trackId, track.state, track.resolution]),
      errorForResolve: service.errorFor("resolve_arbitration")()?.code ?? null,
    }
  }

  try {
    await service.startTagging("verify-arbitration-replay")
    const timeline = [state("startTagging")]
    let finished = false
    let answer = 0
    for (const line of stream.split(/\r?\n/).filter(Boolean)) {
      const event = JSON.parse(line).event
      if (event === "version") continue
      if (finished && answers.includes(event)) {
        for (const [method, ...args] of groups[answer] ?? []) {
          const before = sent.length
          await service[method](...args)
          timeline.push({ ...state(`${method}(${args.join(", ")})`), sentNow: sent.length - before })
        }
        answer += 1
      }
      service.handleLine(line)
      timeline.push(state(event))
      if (event === "run_finished") finished = true
    }
    return {
      success: true,
      boot,
      sent,
      timeline,
      sidecarErrors: logged.filter((entry) => entry.includes("[sidecar]")),
    }
  } finally {
    service.send = originalSend
    console.error = originalError
  }
})()
