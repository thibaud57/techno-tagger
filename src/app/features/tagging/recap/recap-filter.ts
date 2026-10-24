import type { TrackResolution } from "../../../core/sidecar/protocol"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

export const RECAP_FILTERS = ["all", "validated", "arbitrated", "failed"] as const
export type RecapFilter = (typeof RECAP_FILTERS)[number]

type Category = Exclude<RecapFilter, "all">

const ROUTE: Record<TrackResolution, Category | null> = {
  auto: "validated",
  arbitration: "arbitrated",
  url: "arbitrated",
  none: null,
}

/**
 * Regle d'ARCHITECTURE.md § API : « Echecs » lit `state`, « Valides » et « Arbitres » lisent
 * `state` puis `resolution`. Un etat ou une resolution ajoutes cassent la compilation ici.
 */
const categoryOf = (track: TaggingTrack): Category | null => {
  switch (track.state) {
    case "resolved":
    case "written":
      return ROUTE[track.resolution ?? "none"]
    // Un echec d'ecriture arbitre n'est qu'un echec.
    case "unresolved":
    case "write_error":
      return "failed"
    // Rendu a son origine, ou jamais tranche : dans aucun filtre.
    case "rolled_back":
    case null:
      return null
    default: {
      const exhaustive: never = track.state

      return exhaustive
    }
  }
}

export const inFilter = (track: TaggingTrack, filter: RecapFilter): boolean =>
  filter === "all" || categoryOf(track) === filter

/** La somme des filtres peut etre inferieure a « Tout » : les restaures n'y sont pas. */
export const recapCounts = (tracks: readonly TaggingTrack[]): Record<RecapFilter, number> => ({
  all: tracks.length,
  validated: tracks.filter((track) => inFilter(track, "validated")).length,
  arbitrated: tracks.filter((track) => inFilter(track, "arbitrated")).length,
  failed: tracks.filter((track) => inFilter(track, "failed")).length,
})

export const matchesSearch = (track: TaggingTrack, query: string): boolean => {
  const needle = query.trim().toLocaleLowerCase()

  return (
    needle === "" ||
    [track.artist, track.title, track.fileName].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    )
  )
}
