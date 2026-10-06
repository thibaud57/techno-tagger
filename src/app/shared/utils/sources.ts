import type { TrackSource } from "../../core/models/protocol"

/** Noms de marque : identiques dans les deux langues, aucune cle i18n a tenir. */
export const SOURCE_NAMES: Record<TrackSource, string> = {
  beatport: "Beatport",
  bandcamp: "Bandcamp",
  soundcloud: "SoundCloud",
}

const isTrackSource = (value: unknown): value is TrackSource =>
  typeof value === "string" && Object.hasOwn(SOURCE_NAMES, value)

/** Le sidecar envoie la valeur du contrat (`bandcamp`) ; toute autre valeur passe telle quelle. */
export const brandName = (value: unknown): unknown =>
  isTrackSource(value) ? SOURCE_NAMES[value] : value
