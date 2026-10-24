import { BUSY_PHASES, PHASE_BUSY, type BusyPhase, type SidecarErrorEvent } from "./protocol"

/** `params` est ouvert : une valeur absente ou non textuelle rend `null`. */
const textParam = (event: SidecarErrorEvent, key: string): string | null => {
  const value = event.params[key]

  return typeof value === "string" ? value : null
}

export const errorTrackId = (event: SidecarErrorEvent): string | null =>
  textParam(event, "track_id")

export const errorRunId = (event: SidecarErrorEvent): string | null => textParam(event, "run_id")

/** `null` hors `phase_busy`, ou face a une phase que le contrat ne nomme pas. */
export const busyPhase = (event: SidecarErrorEvent): BusyPhase | null => {
  const phase = event.code === PHASE_BUSY ? textParam(event, "phase") : null

  return BUSY_PHASES.find((known) => known === phase) ?? null
}
