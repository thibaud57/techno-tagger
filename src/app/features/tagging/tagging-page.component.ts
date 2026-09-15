import { Component } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

@Component({
  selector: "app-tagging-page",
  imports: [TranslatePipe],
  templateUrl: "./tagging-page.component.html",
})
export default class TaggingPageComponent {
  // TODO: implement, liste du run, modale d'arbitrage, rattrapage par URL,
  // confirmation d'ecriture, recapitulatif filtrable.
}
