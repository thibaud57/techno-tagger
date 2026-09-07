import { Component, input } from "@angular/core"
import { ChevronLeft } from "@primeicons/angular/chevron-left"
import { ChevronRight } from "@primeicons/angular/chevron-right"
import { File as FileIcon } from "@primeicons/angular/file"

/**
 * Les icones reellement utilisees, et non `string` : un nom ouvert imposerait un
 * registre des 359 icones du paquet, qui annulerait le tree-shaking. Une nouvelle
 * icone = un nom ici, un import, un `@case`. Le tableau existe pour que le test
 * parcoure la liste : Angular ne verifie pas l'exhaustivite d'un `@switch`.
 */
export const ICON_NAMES = ["chevron-left", "chevron-right", "file"] as const
export type IconName = (typeof ICON_NAMES)[number]

/** Les trois tokens de DESIGN.md : `CoreIcon` accepterait n'importe quel nombre. */
export type IconSize = 16 | 20 | 24

/** SVG inline : la taille se pose en width/height, jamais en font-size. */
@Component({
  selector: "app-icon",
  imports: [ChevronLeft, ChevronRight, FileIcon],
  template: `
    @switch (name()) {
      @case ("chevron-left") {
        <svg data-p-icon="chevron-left" [size]="size()" />
      }
      @case ("chevron-right") {
        <svg data-p-icon="chevron-right" [size]="size()" />
      }
      @case ("file") {
        <svg data-p-icon="file" [size]="size()" />
      }
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>()
  readonly size = input<IconSize>(20)
}
