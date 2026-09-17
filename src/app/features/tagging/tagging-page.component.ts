import { Component } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"

@Component({
  selector: "app-tagging-page",
  imports: [TranslatePipe],
  templateUrl: "./tagging-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class TaggingPageComponent {
  // TODO: implement, liste du run, modale d'arbitrage, rattrapage par URL,
  // confirmation d'ecriture, recapitulatif filtrable.
}
