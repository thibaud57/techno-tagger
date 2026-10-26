import type { ComponentFixture } from "@angular/core/testing"
import { By } from "@angular/platform-browser"
import { Tooltip } from "primeng/tooltip"

import type { IconName } from "../app/shared/components/display/icon.component"

/** `nativeElement` d'un fixture est un `any` : le typer une fois ici evite un cast dans chaque spec. */
export interface Hosted {
  readonly nativeElement: unknown
}

export const hostOf = (fixture: Hosted): HTMLElement => fixture.nativeElement as HTMLElement

/** Le bouton `[data-action]` du composant, ou de la page entiere pour une modale rendue hors de son hote. */
export const action = (name: string, root: ParentNode = document.body): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)

/** Contenu du `pTooltip` du bouton `[data-action]` : la raison d'un geste grise. */
export const tooltipOf = (fixture: ComponentFixture<unknown>, name: string) =>
  fixture.debugElement
    .query(By.css(`[data-action="${name}"]`))
    .injector.get(Tooltip)
    .content()

export const errorMessageOf = (root: ParentNode): Element | null =>
  root.querySelector("app-error-message")

export const iconOf = (root: ParentNode | null | undefined, name: IconName): Element | null =>
  root?.querySelector(`[data-icon="${name}"]`) ?? null

/** Pixels d'une classe de hauteur Tailwind (`h-10.25`) : un cran vaut 4px (`--spacing` : 0.25rem). */
export const heightClassPx = (className: string): number => Number(className.replace("h-", "")) * 4
