import { Component, input } from '@angular/core';

export type IconSize = 16 | 20 | 24;

/** SVG inline : la taille se pose en width/height, jamais en font-size. */
@Component({
  selector: 'app-icon',
  // TODO: implement, rendre l'icone @primeicons/angular correspondant a `name`.
  // Trancher d'abord `name` : un `string` ouvert impose un registre, qui annule
  // le tree-shaking que la rule primeng/composants exige. Une union litterale ou
  // la consommation directe des composants PrimeNG sont les deux voies.
  template: '<!-- TODO: implement -->',
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<IconSize>(20);
}
