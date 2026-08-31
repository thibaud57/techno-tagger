import { Component, input } from '@angular/core';

import type { IconSize } from './icon.component';

export type SourceName = 'beatport' | 'bandcamp' | 'soundcloud' | 'vlc';

/** Les quatre logos absents de PrimeIcons, en currentColor. */
@Component({
  selector: 'app-source-logo',
  // TODO: implement, SVG inline depuis src/assets/icons/. Ces fichiers ne sont
  // pas emis par le build (assets ne declare que public/) : c'est voulu tant
  // qu'ils sont inlines, `currentColor` ne marchant pas sur un <img>. Les cabler
  // dans angular.json embarquerait quatre fichiers morts dans l'installeur.
  template: '<!-- TODO: implement -->',
})
export class SourceLogoComponent {
  readonly source = input.required<SourceName>();
  readonly size = input<IconSize>(16);
}
