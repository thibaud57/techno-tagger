import type { ExtractionFinishedEvent } from "../../core/models/protocol"

export type ExtractionCategory =
  "extracted" | "already_present" | "missing" | "duplicate" | "failure"

/**
 * Une ligne de la table du rapport.
 *
 * `detailKey` et `detailParams` plutot qu'une phrase : le sidecar n'emet jamais
 * de texte destine a l'utilisateur, et cette fonction ne doit pas en fabriquer.
 * Le composant traduit.
 */
export interface ExtractionRow {
  readonly fileName: string
  readonly category: ExtractionCategory
  readonly detailKey: string | null
  /** Pour un doublon : `kept`, `keptSize`, `discarded`, `discardedSizes`, tailles deja mises en forme. */
  readonly detailParams: Record<string, string | number> | null
  /** Motif ou critere a part : une valeur d'enum du sidecar ne se traduit pas en parametre d'interpolation. */
  readonly reasonKey: string | null
}

const DETAIL_PREFIX = "playlist.report.detail"

const plain = (fileName: string, category: ExtractionCategory): ExtractionRow => ({
  fileName,
  category,
  detailKey: null,
  detailParams: null,
  reasonKey: null,
})

export type FormatSize = (bytes: number) => string

/**
 * Aplatit les categories du resultat en une liste unique.
 *
 * Ce qui demande un geste ouvre la liste, echecs puis introuvables puis doublons :
 * un rapport de 300 morceaux se lit par le haut, et ce qui est passe tout seul
 * n'attend rien de l'utilisateur. Aucun tri a l'interieur d'une categorie, deux
 * appels sur le meme resultat rendent donc la meme liste. La mise en forme des
 * tailles arrive en parametre, parce qu'elle depend d'une langue que cette
 * fonction ignore.
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
    reasonKey: `playlist.report.reason.${failure.reason}`,
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
    reasonKey: `playlist.report.criterion.${duplicate.criterion}`,
  })),
  ...result.already_present.map((name) => plain(name, "already_present")),
  ...result.extracted.map((name) => plain(name, "extracted")),
]
