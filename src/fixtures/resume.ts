import type {
  InterruptedRun,
  InterruptedRunEvent,
  UnreadablePlan,
} from "../app/core/sidecar/protocol"

export const INTERRUPTED: InterruptedRun = {
  kind: "interrupted",
  run_id: "a3f9c1",
  started_at: "2026-08-02T18:40:00Z",
  folder: "D:/Sets/Aout",
  processed: 62,
  total: 100,
  folder_missing: false,
}

/** Dossier absent ou vide de ses fichiers audio : le sidecar ne les distingue pas (`folder_missing`). */
export const FOLDER_MISSING: InterruptedRun = { ...INTERRUPTED, folder_missing: true }

export const UNREADABLE: UnreadablePlan = {
  kind: "unreadable",
  run_id: "9e8f7a",
  started_at: "2026-08-02T18:40:00Z",
  found: 2,
  expected: 1,
}

/** Fichier du plan que le sidecar n'a pas su lire : aucune version a citer. */
export const CORRUPTED: UnreadablePlan = { ...UNREADABLE, run_id: "5d4c3b", found: null }

export const interruptedRun = (run: InterruptedRunEvent["run"]): InterruptedRunEvent => ({
  event: "interrupted_run",
  run,
})
