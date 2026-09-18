import { Component, input } from "@angular/core"

import { IconComponent, type IconName } from "./icon.component"

/** Bloc d'etat vide de DESIGN.md § Etats des Composants : PrimeNG n'a pas d'equivalent. */
@Component({
  selector: "app-empty-state",
  imports: [IconComponent],
  template: `
    <div class="flex flex-col items-center gap-2 p-6 text-center">
      <app-icon class="text-muted-color" [name]="icon()" [size]="24" />
      <p class="text-base">{{ heading() }}</p>
      @if (description(); as text) {
        <p class="text-sm text-muted-color">{{ text }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyStateComponent {
  readonly icon = input.required<IconName>()
  // `title` collisionnerait avec l'attribut HTML natif : infobulle parasite.
  readonly heading = input.required<string>()
  readonly description = input<string>()
}
