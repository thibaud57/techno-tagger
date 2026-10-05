import { Component, computed, inject, signal } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { InputGroup } from "primeng/inputgroup"
import { InputText } from "primeng/inputtext"

import type { SidecarErrorEvent } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { trackMainLine } from "../../shared/utils/identity"
import { SOURCE_NAMES } from "../../shared/utils/sources"

interface RecoveryDetail {
  readonly key: string
  readonly params?: Readonly<Record<string, string>>
}

interface RecoveryRow {
  readonly trackId: string
  readonly mainLine: string
  /** Motif d'echec d'un non resolu, ou source d'un morceau deja rattrape. */
  readonly detail: RecoveryDetail | null
  readonly url: string
  readonly busy: boolean
  readonly error: SidecarErrorEvent | null
}

const detail = (track: TaggingTrack): RecoveryDetail | null => {
  if (track.resolution === "url" && track.source !== null) {
    return { key: "tagging.recovery.recovered", params: { source: SOURCE_NAMES[track.source] } }
  }

  return track.failureReason === null ? null : { key: `tagging.reason.${track.failureReason}` }
}

/** Une ligne par morceau a rattraper ; le sidecar juge l'URL, l'ecran ne la verifie pas. */
@Component({
  selector: "app-url-recovery",
  imports: [
    TranslatePipe,
    ButtonDirective,
    InputGroup,
    InputText,
    EmptyStateComponent,
    ErrorMessageComponent,
    IconComponent,
    TruncatedTextComponent,
  ],
  templateUrl: "./url-recovery.component.html",
  host: {
    class: "flex min-h-0 flex-col gap-4 rounded-lg border border-surface bg-surface-900 p-4",
  },
})
export class UrlRecoveryComponent {
  private readonly sidecar = inject(SidecarService)

  /** Texte colle par morceau, garde apres un succes : on voit le lien utilise et on le corrige. */
  private readonly urls = signal<ReadonlyMap<string, string>>(new Map())

  /** Calculees ici et non dans le template, ou chaque cycle les rejouerait pour chaque ligne. */
  protected readonly rows = computed<RecoveryRow[]>(() => {
    const busy = this.sidecar.urlRecoveryBusy()
    const errors = this.sidecar.urlRecoveryErrors()
    const urls = this.urls()

    return this.sidecar.recoverableTracks().map((track) => ({
      trackId: track.trackId,
      mainLine: trackMainLine(track.artist, track.title, track.fileName),
      detail: detail(track),
      url: urls.get(track.trackId) ?? "",
      busy: busy.has(track.trackId),
      error: errors.get(track.trackId) ?? null,
    }))
  })

  protected edit(trackId: string, url: string): void {
    this.urls.update((urls) => new Map(urls).set(trackId, url))
  }

  /**
   * Sans attendre : l'echec revient plus tard dans `urlRecoveryErrors`. La garde double
   * celle du bouton parce que la touche Entree ne passe pas par `[disabled]`.
   */
  protected resolve(row: RecoveryRow): void {
    if (row.busy || row.url === "") {
      return
    }
    void this.sidecar.resolveByUrl(row.trackId, row.url)
  }
}
