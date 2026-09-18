import { Component, input } from "@angular/core"

import type { IconSize } from "./icon.component"

export type SourceName = "beatport" | "bandcamp" | "soundcloud" | "vlc"

/**
 * Les logos de source absents de PrimeIcons, en currentColor.
 *
 * SVG inline et non `<img src>` : `currentColor` ne s'applique pas a une image
 * externe, et les fichiers de `src/assets/icons/` ne sont pas emis par le build,
 * qui ne declare que `public/`. Decoratif : le libelle traduit voisin nomme deja l'action.
 */
@Component({
  selector: "app-source-logo",
  template: `
    @switch (source()) {
      @case ("vlc") {
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="currentColor"
          [attr.width]="size()"
          [attr.height]="size()"
        >
          <path [attr.d]="VLC_PATH" />
        </svg>
      }
    }
  `,
})
export class SourceLogoComponent {
  /** Trace releve dans `src/assets/icons/vlc.svg`, inchange. */
  protected readonly VLC_PATH =
    "M12.0319 0c-.8823 0-1.0545.136-1.0545.136-.1738.056-.3556.255-.4105.43L9.683 3.3808c.4729.1729 1.3222.4266 2.2337.4266 1.0987 0 2.017-.3494 2.3763-.5075L13.4352.566c-.055-.1755-.237-.3707-.4067-.4374 0 0-.1142-.1286-.9966-.1286zm3.5645 7.455c-.3601.34-1.3276.9373-3.6797.9373-2.2929 0-3.189-.5678-3.5213-.9113l-1.3887 4.4227c.2272.3614 1.2539 1.5594 4.8847 1.5594 3.7569 0 4.8539-1.3467 5.0649-1.6737zm-8.5897 4.4487l-1.0025 3.1922H4.3428c-.2486 0-.5097.1932-.5826.4315l-2.334 7.6317a.3962.3962 0 0 0-.0169.1537c-.0008.0053-.002.0099-.002.016 0 .0839.0233.226.0233.226.0322.2456.2612.4452.5098.4452h20.1192c.2487 0 .4768-.1994.5098-.4453 0 0 .0234-.142.0234-.226a.0245.0245 0 0 0-.0025-.01.3201.3201 0 0 0 .0024-.0313.4096.4096 0 0 0-.019-.1282l-2.3339-7.6318c-.0729-.2383-.334-.4314-.5826-.4314h-1.6636l.2005.6391c-.2407.4854-1.4886 2.38-6.3027 2.38-4.6003 0-5.8288-1.73-6.1107-2.3072z"

  readonly source = input.required<SourceName>()
  readonly size = input<IconSize>(16)
}
