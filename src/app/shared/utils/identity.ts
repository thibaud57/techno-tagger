/** « Artiste - Titre », tiret simple (DESIGN.md § Separateurs) ; une partie vide est omise. */
export const joinIdentity = (artist: string, title: string): string =>
  [artist, title].filter((part) => part !== "").join(" - ")
