import { Component } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

@Component({
  selector: "app-settings-page",
  imports: [TranslatePipe],
  templateUrl: "./settings-page.component.html",
})
export default class SettingsPageComponent {
  // TODO: implement, cle API, URL de l'API, langue, seuils, mode copie,
  // signal sonore, vidage du cache, ouverture du dossier de logs.
}
