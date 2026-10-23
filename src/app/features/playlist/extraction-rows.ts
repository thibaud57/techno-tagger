import type { ExtractionFinishedEvent } from "../../core/sidecar/protocol"
import { extractionReasonKeys, type ReasonKeys } from "../../shared/utils/reason"

export type ExtractionCategory =
  "extracted" | "already_present" | "missing" | "duplicate" | "failure"

/** Cle et parametres plutot qu'une phrase : le sidecar n'emet aucun texte utilisateur. */
export interface ExtractionRow {
  readonly fileName: string
  readonly category: ExtractionCategory
  readonly detailKey: string | null
  readonly detailParams: Record<string, string | number> | null
  /** Motif ou critere a part : une valeur d'enum du sidecar ne se traduit pas en parametre d'interpolation. */
  readonly reason: ReasonKeys | null
}

const DETAIL_PREFIX = "playlist.report.detail"

const plain = (fileName: string, category: ExtractionCategory): ExtractionRow => ({
  fileName,
  category,
  detailKey: null,
  detailParams: null,
  reason: null,
})

export type FormatSize = (bytes: number) => string

/**
 * Ce qui demande un geste ouvre la liste (echecs, introuvables, doublons) : un rapport de
 * 300 morceaux se lit par le haut. `formatSize` vient de l'appelant, seul a connaitre la langue.
 */
export const toExtractionRows = (
  result: ExtractionFinishedEvent,
  formatSize: FormatSize,
): readonly ExtractionRow[] => [
  ...result.failures.map((failure) => ({
    fileName: failure.file_name,
    category: "failure" as const,
    detailKey: null,
    detailParams: null,
    reason: extractionReasonKeys(failure.reason),
  })),
  ...result.missing.map((name) => plain(name, "missing")),
  ...result.duplicates.map((duplicate) => ({
    fileName: duplicate.file_name,
    category: "duplicate" as const,
    detailKey: `${DETAIL_PREFIX}.duplicate`,
    detailParams: {
      kept: duplicate.kept_path,
      keptSize: formatSize(duplicate.kept_size),
      discarded: duplicate.discarded.map((candidate) => candidate.path).join(", "),
      discardedSizes: duplicate.discarded.map((candidate) => formatSize(candidate.size)).join(", "),
    },
    reason: { cause: `playlist.report.criterion.${duplicate.criterion}`, remedy: null },
  })),
  ...result.already_present.map((name) => plain(name, "already_present")),
  ...result.extracted.map((name) => plain(name, "extracted")),
]
