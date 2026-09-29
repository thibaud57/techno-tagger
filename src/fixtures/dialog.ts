// Requetes DOM partagees par les specs de modale : un `p-dialog` peut etre rendu hors de
// l'hote du composant, la page entiere est interrogee.

export const page = (): HTMLElement => document.body

export const action = (name: string): HTMLButtonElement | null =>
  page().querySelector<HTMLButtonElement>(`[data-action="${name}"]`)
