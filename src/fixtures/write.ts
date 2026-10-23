import type {
  BusyPhase,
  ExtractionProgressEvent,
  Phase,
  RollbackFailure,
  RollbackFinishedEvent,
  RollbackRun,
  RunFinishedEvent,
  SidecarCommand,
  SidecarErrorEvent,
} from "../app/core/sidecar/protocol"
import type { RollbackInFlight } from "../app/core/stores/write.store"

import { RUN_ID } from "./tagging"

// Evenements partages par les specs : chaque test pose ses ecarts par spread.

export const WRITE_FINISHED: RunFinishedEvent = {
  event: "run_finished",
  phase: "write",
  run_id: RUN_ID,
  resolved: 0,
  unresolved: 0,
  written: 1,
  write_error: 0,
  awaiting_arbitration: 0,
  report_path: "D:/Music/Promo Octobre/tagging-report-20261005T211403Z.json",
}

/** Ecriture qui laisse `failures` morceaux en erreur : rien n'est ecrit, le motif est sur chaque ligne. */
export const writeFinishedWithFailures = (failures = 1): RunFinishedEvent => ({
  ...WRITE_FINISHED,
  written: 0,
  write_error: failures,
})

/** Fin de la phase reseau d'un run resolu : ce qui precede la confirmation. */
export const NETWORK_FINISHED: RunFinishedEvent = {
  ...WRITE_FINISHED,
  phase: "network",
  resolved: 1,
  written: 0,
  report_path: null,
}

export const progressEvent = (
  phase: Phase,
  processed: number,
  total: number,
): ExtractionProgressEvent => ({ event: "progress", phase, processed, total })

export const ROLLBACK_RUN: RollbackRun = {
  run_id: RUN_ID,
  written_at: "2026-10-05T21:14:03Z",
  folder: "D:/Music/Promo Octobre",
  tracks: 1,
}

/** Restauration envoyee et pas encore finie : celle du run entier, ou d'un seul morceau. */
export const rollbackInFlight = (trackId: string | null = null): RollbackInFlight => ({
  runId: RUN_ID,
  trackId,
})

export const rollbackFinished = (
  trackId: string | null = null,
  failed: RollbackFinishedEvent["failed"] = [],
): RollbackFinishedEvent => ({
  event: "rollback_finished",
  run_id: RUN_ID,
  track_id: trackId,
  restored: ["a.mp3"],
  failed,
})

/** Restauration qui a laisse un fichier tel quel : `reason` dit pourquoi. */
export const failedRollback = (
  reason: RollbackFailure["reason"] = "file_locked",
): RollbackFinishedEvent =>
  rollbackFinished(null, [{ track_id: "b.mp3", file_name: "X - Y.mp3", reason }])

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
