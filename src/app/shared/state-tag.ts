import { Component, input } from '@angular/core';

/**
 * Mapping state / resolution / failure_reason vers famille, icone et libelle.
 * Encode une fois ici pour ne pas etre re-derive de travers ecran par ecran.
 */
@Component({
  selector: 'app-state-tag',
  template: '<!-- TODO: implement, p-tag -->',
})
export class StateTag {
  // TODO: implement, types importes de core/models/protocol.ts une fois le
  // contrat NDJSON fige, puis mapping vers les quatre familles de DESIGN.md.
  readonly state = input.required<string>();
  readonly resolution = input<string>();
}
