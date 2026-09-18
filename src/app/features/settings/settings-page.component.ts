import { Component } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"

@Component({
  selector: "app-settings-page",
  imports: [TranslatePipe],
  templateUrl: "./settings-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class SettingsPageComponent {
  // TODO: implement, cle API, URL de l'API, langue, seuils, mode copie,
  // signal sonore, vidage du cache, ouverture du dossier de logs.
}
