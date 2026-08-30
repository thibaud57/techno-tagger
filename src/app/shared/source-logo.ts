import { Component, input } from '@angular/core';

import type { IconSize } from './icon';

export type SourceName = 'beatport' | 'bandcamp' | 'soundcloud' | 'vlc';

/** Les quatre logos absents de PrimeIcons, en currentColor. */
@Component({
  selector: 'app-source-logo',
  template: '<!-- TODO: implement, SVG depuis src/assets/icons/ -->',
})
export class SourceLogo {
  readonly source = input.required<SourceName>();
  readonly size = input<IconSize>(16);
}
