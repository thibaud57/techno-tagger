import { Component } from "@angular/core"

/** Cellule sans valeur : cadratin gris, ni trait d'union ni vide (DESIGN.md § Sans valeur). */
@Component({
  selector: "app-no-value",
  template: `<span class="text-muted-color">—</span>`,
})
export class NoValueComponent {}
