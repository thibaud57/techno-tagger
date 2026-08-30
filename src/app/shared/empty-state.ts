import { Component, input } from '@angular/core';

/** Bloc d'etat vide : PrimeNG n'a pas d'equivalent. */
@Component({
  selector: 'app-empty-state',
  template: '<!-- TODO: implement, icone 24px, titre, phrase, action -->',
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly description = input<string>();
}
