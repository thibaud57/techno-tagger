/** Les trois onglets du shell, dans l'ordre de la barre. Chacun est le premier segment de sa route. */
export const TABS = ["playlist", "tagging", "settings"] as const
/** `Tab` est deja le composant de PrimeNG : le nom evite l'alias a chaque import. */
export type TabName = (typeof TABS)[number]

export const DEFAULT_TAB: TabName = "playlist"

/** Ce que `p-tabs` emet : un nom d'onglet, un index, ou rien avant la premiere selection. */
export type TabValue = string | number | undefined

export const isTabName = (value: TabValue): value is TabName =>
  typeof value === "string" && (TABS as readonly string[]).includes(value)

/** Onglet porte par une URL : son premier segment. Tout le reste retombe sur le premier onglet. */
export const tabFromUrl = (url: string): TabName => {
  const [path = ""] = url.split(/[?#]/, 1)
  const [segment = ""] = path.split("/").filter((part) => part !== "")

  return isTabName(segment) ? segment : DEFAULT_TAB
}
