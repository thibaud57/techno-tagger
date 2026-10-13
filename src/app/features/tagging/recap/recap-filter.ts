import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

export type RecapFilter = "all" | "validated" | "arbitrated" | "failed"

export const RECAP_FILTERS: readonly RecapFilter[] = ["all", "validated", "arbitrated", "failed"]

/** Tranche par le run et toujours debout : un echec d'ecriture arbitre n'est qu'un echec. */
const settled = (track: TaggingTrack): boolean =>
  track.state === "resolved" || track.state === "written"

/**
 * Regle de DESIGN.md § Conventions de Code : « Echecs » lit `state`, « Valides » et « Arbitres »
 * lisent `state` puis `resolution`. Un `rolled_back` n'appartient a aucun filtre.
 */
export const inFilter = (track: TaggingTrack, filter: RecapFilter): boolean => {
  switch (filter) {
    case "all":
      return true
    case "validated":
      return settled(track) && track.resolution === "auto"
    case "arbitrated":
      return settled(track) && (track.resolution === "arbitration" || track.resolution === "url")
    case "failed":
      return track.state === "unresolved" || track.state === "write_error"
    default: {
      const exhaustive: never = filter

      return exhaustive
    }
  }
}

/** La somme des trois filtres peut etre inferieure a « Tout » : les restaures n'y sont pas. */
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
