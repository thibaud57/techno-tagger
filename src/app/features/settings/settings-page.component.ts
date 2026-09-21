import { Component, computed, inject, signal } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { InputPassword } from "primeng/inputpassword"
import { Label } from "primeng/label"
import { Tag } from "primeng/tag"

import { SidecarService } from "../../core/sidecar.service"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"

interface ApiKeyEntry {
  apiKey: string
}

/**
 * Codes qu'un `set_api_key` en echec peut renvoyer, plus `sidecar_unavailable` : seul code que
 * l'interface emet elle-meme, pour tout `send()` en echec (cf. sidecar.service.ts).
 */
const API_KEY_ERRORS: ReadonlySet<string> = new Set([
  "api_key_not_stored",
  "keyring_unavailable",
  "malformed_command",
  "sidecar_unavailable",
])

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
    InputPassword,
    Label,
    Tag,
    ErrorMessageComponent,
  ],
  templateUrl: "./settings-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class SettingsPageComponent {
  private readonly sidecar = inject(SidecarService)

  /** Jamais prerempli : la cle n'est pas relue depuis le trousseau (ADR-012). */
  protected readonly entry = signal<ApiKeyEntry>({ apiKey: "" })
  protected readonly fields = form(this.entry)
  protected readonly apiKeyConfigured = this.sidecar.apiKeyConfigured
  protected readonly canSave = computed(
    () => this.entry().apiKey !== "" && this.sidecar.available() === true,
  )
  protected readonly error = computed(() => {
    const error = this.sidecar.lastError()

    return error !== null && API_KEY_ERRORS.has(error.code) ? error : null
  })

  /** Le champ est vide avant l'envoi : un double clic ne renvoie rien. */
  protected async save(): Promise<void> {
    const apiKey = this.entry().apiKey
    if (apiKey === "") {
      return
    }
    this.entry.set({ apiKey: "" })
    await this.sidecar.setApiKey(apiKey)
  }
}
