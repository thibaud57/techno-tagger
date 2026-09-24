import { Component, computed, inject, signal } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { IconField } from "primeng/iconfield"
import { InputIcon } from "primeng/inputicon"
import { InputPassword } from "primeng/inputpassword"
import { Label } from "primeng/label"
import { Tag } from "primeng/tag"

import { SidecarService } from "../../core/sidecar.service"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"

interface ApiKeyEntry {
  apiKey: string
}

/**
 * Section API, seule livree par la Feature 2 : les autres reglages (seuils, langue,
 * signal sonore, cache, logs) arrivent avec la Feature 7.
 */
@Component({
  selector: "app-settings-page",
  imports: [
    TranslatePipe,
    FormField,
    ButtonDirective,
    IconField,
    InputIcon,
    InputPassword,
    Label,
    Tag,
    ErrorMessageComponent,
    IconComponent,
  ],
  templateUrl: "./settings-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class SettingsPageComponent {
  private readonly sidecar = inject(SidecarService)

  /** Jamais prerempli : la cle n'est pas relue depuis le trousseau (ADR-012). */
  protected readonly entry = signal<ApiKeyEntry>({ apiKey: "" })
  protected readonly fields = form(this.entry)
  /** `pInputPassword` n'expose que ce model : la bascule est portee par le template. */
  protected readonly masked = signal(true)
  protected readonly apiKeyConfigured = this.sidecar.apiKeyConfigured
  protected readonly canSave = computed(
    () => this.entry().apiKey !== "" && this.sidecar.available() === true,
  )
  protected readonly error = this.sidecar.errorFor("set_api_key")

  protected toggleMask(): void {
    this.masked.update((masked) => !masked)
  }

  /** Le champ est vide avant l'envoi : un double clic ne renvoie rien. */
  protected async save(): Promise<void> {
    const apiKey = this.entry().apiKey
    if (apiKey === "") {
      return
    }
    this.entry.set({ apiKey: "" })
    // La cle suivante repart masquee, quel que soit l'etat laisse par la precedente.
    this.masked.set(true)
    await this.sidecar.setApiKey(apiKey)
  }
}
