/** Onglets du shell, dans l'ordre de la barre. Chacun est le premier segment de sa route. */
export const TABS = ["playlist", "tagging", "settings"] as const
/** `Tab` est deja le composant de PrimeNG : le nom evite l'alias a chaque import. */
export type TabName = (typeof TABS)[number]

export const DEFAULT_TAB: TabName = "playlist"

/** Ce que `p-tabs` emet : un nom d'onglet, un index, ou rien avant la premiere selection. */
export type TabValue = string | number | undefined

export const isTabName = (value: TabValue): value is TabName =>
  typeof value === "string" && (TABS as readonly string[]).includes(value)

const segmentsOf = (url: string): string[] => {
  const [path = ""] = url.split(/[?#]/, 1)

  return path.split("/").filter((part) => part !== "")
}

/** Onglet porte par une URL : son premier segment. Tout le reste retombe sur le premier onglet. */
export const tabFromUrl = (url: string): TabName => {
  const [segment = ""] = segmentsOf(url)

  return isTabName(segment) ? segment : DEFAULT_TAB
}

/** Vrai sur la route de base d'un onglet, faux sur l'une de ses sous-pages (`/tagging/recap`). */
export const isTabRoot = (url: string): boolean => segmentsOf(url).length <= 1
