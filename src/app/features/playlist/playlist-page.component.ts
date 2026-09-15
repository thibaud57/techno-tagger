import { Component } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

@Component({
  selector: "app-playlist-page",
  imports: [TranslatePipe],
  templateUrl: "./playlist-page.component.html",
})
export default class PlaylistPageComponent {
  // TODO: implement, selection des dossiers source et destination, choix de la
  // playlist, mode copie ou deplacement, rapport d'extraction.
}
