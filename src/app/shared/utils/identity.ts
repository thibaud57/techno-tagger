/** « Artiste - Titre », tiret simple (DESIGN.md § Separateurs) ; une partie vide est omise. */
export const joinIdentity = (artist: string, title: string): string =>
  [artist, title].filter((part) => part !== "").join(" - ")

export const trackMainLine = (artist: string, title: string, fileName: string): string =>
  joinIdentity(artist, title) || fileName.replace(/\.[a-z0-9]+$/i, "")
