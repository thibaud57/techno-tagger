import type {
  BusyPhase,
  ExtractionProgressEvent,
  RollbackFinishedEvent,
  RollbackRun,
  RunFinishedEvent,
  SidecarCommand,
  SidecarErrorEvent,
} from "../app/core/sidecar/protocol"

// Evenements partages par les specs : chaque test pose ses ecarts par spread.

export const WRITE_FINISHED: RunFinishedEvent = {
  event: "run_finished",
  phase: "write",
  run_id: "a3f9c1",
  resolved: 0,
  unresolved: 0,
  written: 1,
  write_error: 0,
  awaiting_arbitration: 0,
  report_path: "D:/Music/Promo Octobre/tagging-report-20261005T211403Z.json",
}

/** Fin de la phase reseau d'un run resolu : ce qui precede la confirmation. */
export const NETWORK_FINISHED: RunFinishedEvent = {
  ...WRITE_FINISHED,
  phase: "network",
  resolved: 1,
  written: 0,
  report_path: null,
}

export const writeProgress = (processed: number, total: number): ExtractionProgressEvent => ({
  event: "progress",
  phase: "write",
  processed,
  total,
})

export const ROLLBACK_RUN: RollbackRun = {
  run_id: "a3f9c1",
  written_at: "2026-10-05T21:14:03Z",
  folder: "D:/Music/Promo Octobre",
  tracks: 1,
}

export const rollbackFinished = (
  trackId: string | null = null,
  failed: RollbackFinishedEvent["failed"] = [],
): RollbackFinishedEvent => ({
  event: "rollback_finished",
  run_id: "a3f9c1",
  track_id: trackId,
  restored: ["a.mp3"],
  failed,
})

export const commandError = (
  command: SidecarCommand["command"],
  code: string,
  params: Record<string, unknown> = {},
): SidecarErrorEvent => ({ event: "error", code, params, message: code, command })

/** Refus d'une commande parce que `phase` tourne deja : `command` est celle qui est refusee. */
export const phaseBusy = (
  command: SidecarCommand["command"],
  phase: BusyPhase,
): SidecarErrorEvent => commandError(command, "phase_busy", { phase })
