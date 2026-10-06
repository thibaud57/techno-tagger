// Requetes DOM partagees par les specs de modale : un `p-dialog` peut etre rendu hors de
// l'hote du composant, la page entiere est interrogee.

export const page = (): HTMLElement => document.body

export const action = (name: string): HTMLButtonElement | null =>
  page().querySelector<HTMLButtonElement>(`[data-action="${name}"]`)

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
