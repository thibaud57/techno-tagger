// Requetes DOM partagees par les specs de modale : un `p-dialog` peut etre rendu hors de
// l'hote du composant, la page entiere est interrogee.

export const page = (): HTMLElement => document.body

/**
 * L'element qui nomme la modale ouverte par son `aria-labelledby`, nul quand l'id ne designe rien :
 * avec un template `#header`, `p-dialog` pose l'attribut sans reporter l'id sur aucun titre.
 */
export const dialogLabel = (): HTMLElement | null => {
  const id = page().querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")

  return id ? document.getElementById(id) : null
}

/** Champ de lien du rattrapage, dans la modale du lien comme dans l'etape lien de l'arbitrage. */
export const linkField = (): HTMLInputElement | null =>
  page().querySelector<HTMLInputElement>('input[data-field="url"]')

export const pasteLink = (url: string): void => {
  const input = linkField()
  if (input) {
    input.value = url
    input.dispatchEvent(new Event("input"))
  }
}
