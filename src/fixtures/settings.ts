import type { ThresholdsPayload } from "../app/core/sidecar/protocol"

// Reglages que les specs se partagent. Les defauts du moteur sont fictifs : aucun test ne doit
// recopier les vrais.

export const DEFAULT_THRESHOLDS: ThresholdsPayload = { floor: 65, ceiling: 85 }

/** Un reglage de l'utilisateur, distinct des defauts du moteur. */
export const CUSTOM_THRESHOLDS: ThresholdsPayload = { floor: 72, ceiling: 95 }

export const LOG_FILE = "C:/data/trace.log"
