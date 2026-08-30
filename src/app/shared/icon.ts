import { Component, input } from '@angular/core';

export type IconSize = 16 | 20 | 24;

/** SVG inline : la taille se pose en width/height, jamais en font-size. */
@Component({
  selector: 'app-icon',
  template: '<!-- TODO: implement, -->',
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input<IconSize>(20);
}
