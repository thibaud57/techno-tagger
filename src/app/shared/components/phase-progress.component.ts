import { Component, input } from "@angular/core"
import { ProgressBar } from "primeng/progressbar"

/** Barre d'une phase, avec son libelle et son compteur : `p-progressbar` n'ecrit que dans la barre. */
@Component({
  selector: "app-phase-progress",
  imports: [ProgressBar],
  template: `
    <div class="flex items-baseline justify-between gap-4">
      <span class="text-sm">{{ label() }}</span>
      @if (counter(); as text) {
        <span class="text-xs text-muted-color tabular-nums">{{ text }}</span>
      }
    </div>
    <!-- Comparaison explicite : 0 % est une valeur, pas une absence. -->
    @if (value() !== undefined) {
      <p-progressbar [value]="value()" />
    } @else {
      <p-progressbar mode="indeterminate" />
    }
  `,
  host: { class: "flex flex-col gap-2" },
})
export class PhaseProgressComponent {
  readonly label = input.required<string>()
  readonly counter = input<string>()
  /** Pourcentage ; absent tant que le total n'est pas connu, la barre tourne alors en continu. */
  readonly value = input<number>()
}
