import type { IconName } from "../app/shared/components/display/icon.component"

/** `nativeElement` d'un fixture est un `any` : le typer une fois ici evite un cast dans chaque spec. */
export interface Hosted {
  readonly nativeElement: unknown
}

export const hostOf = (fixture: Hosted): HTMLElement => fixture.nativeElement as HTMLElement

/** Le bouton `[data-action]` du composant, ou de la page entiere pour une modale rendue hors de son hote. */
export const action = (name: string, root: ParentNode = document.body): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)

export const errorMessageOf = (root: ParentNode): Element | null =>
  root.querySelector("app-error-message")

export const iconOf = (root: ParentNode, name: IconName): Element | null =>
  root.querySelector(`[data-icon="${name}"]`)
