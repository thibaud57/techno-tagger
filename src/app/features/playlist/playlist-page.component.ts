import { Component, computed, inject, signal, type WritableSignal } from "@angular/core"
import { FormField, disabled, form } from "@angular/forms/signals"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { open } from "@tauri-apps/plugin-dialog"
import { ButtonDirective } from "primeng/button"
import { Message } from "primeng/message"
import { ProgressBar } from "primeng/progressbar"
import { Select } from "primeng/select"
import { SelectButton } from "primeng/selectbutton"
import { Skeleton } from "primeng/skeleton"
import { TableModule } from "primeng/table"
import { Tag, type TagSeverity } from "primeng/tag"
import { Tooltip } from "primeng/tooltip"

import { FALLBACK_LANGUAGE } from "../../core/language"
import type { ExtractionMode } from "../../core/models/protocol"
import {
  DEFAULT_EXTRACTION_MODE,
  readExtractionMode,
  writeExtractionMode,
} from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { IconComponent, type IconName } from "../../shared/components/icon.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"
import { formatFileSize } from "../../shared/utils/file-size"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { TRUNCATED_VALUE_TOOLTIP } from "../../shared/utils/tooltip"

import { toExtractionRows, type ExtractionCategory } from "./extraction-rows"

interface PlaylistChoice {
  playlist: string | null
  mode: ExtractionMode
}

/**
 * Familles de DESIGN.md § Couleurs Semantiques, la couleur n'etant jamais seule a informer.
 * Un doublon departage est une issue positive, pas une decision attendue : vert, le libelle
 * portant la voie. Les deux rouges ne partagent pas l'icone, leurs corrections etant opposees
 * (retrouver le fichier, relancer le transfert).
 */
const CATEGORY_STYLE: Record<ExtractionCategory, { severity: TagSeverity; icon: IconName }> = {
  extracted: { severity: "success", icon: "check" },
  duplicate: { severity: "success", icon: "check" },
  already_present: { severity: "secondary", icon: "check-circle" },
  missing: { severity: "danger", icon: "times" },
  failure: { severity: "danger", icon: "exclamation-triangle" },
}

@Component({
  selector: "app-playlist-page",
  imports: [
    TranslatePipe,
    ButtonDirective,
    Select,
    SelectButton,
    ProgressBar,
    TableModule,
    Tag,
    Message,
    Skeleton,
    FormField,
    EmptyStateComponent,
    IconComponent,
    SourceLogoComponent,
    Tooltip,
  ],
  templateUrl: "./playlist-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class PlaylistPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly translate = inject(TranslateService)

  protected readonly sourceFolder = signal<string | null>(null)
  protected readonly destinationFolder = signal<string | null>(null)
  protected readonly playlistPath = signal<string | null>(null)

  /**
   * Les deux choix de l'ecran, dans un seul signal. `form()` en derive un arbre
   * de champs que `[formField]` lie aux composants PrimeNG : ceux-ci n'exposent
   * leur valeur que par `ControlValueAccessor`, avec lequel la directive
   * interopere. Aucun validateur n'est declare, il n'y a rien a valider ici.
   */
  protected readonly choice = signal<PlaylistChoice>({
    playlist: null,
    mode: DEFAULT_EXTRACTION_MODE,
  })

  /** Choix figes pendant un run : ils ne decriraient plus l'extraction en cours. */
  protected readonly fields = form(this.choice, (path) => {
    disabled(path, { when: () => this.sidecar.extracting() })
  })

  /** Hauteur de la classe `h-8` posee sur les lignes du rapport, lue par le scroll virtuel. */
  protected readonly rowHeight = 32

  protected readonly truncatedValueTooltip = TRUNCATED_VALUE_TOOLTIP
  protected readonly fadeIn = FADE_IN

  /** Hauteur du `p-select` qu'il precede, derivee des memes tokens : aucun saut a son arrivee. */
  protected readonly selectSkeletonHeight =
    "calc(2 * var(--p-form-field-padding-y) + 1.5 * var(--p-form-field-font-size) + 2px)"

  protected readonly modeOptions = [
    { labelKey: "playlist.mode.copy", value: "copy" satisfies ExtractionMode },
    { labelKey: "playlist.mode.move", value: "move" satisfies ExtractionMode },
  ]

  protected readonly extracting = this.sidecar.extracting
  /** Copie mutable : `p-select` attend un tableau modifiable, le contrat NDJSON en lit lecture seule. */
  protected readonly playlists = computed(() => [...this.sidecar.playlists()])
  protected readonly progress = this.sidecar.progress
  protected readonly extraction = this.sidecar.extraction

  /** Une liste de `params` est jointe avant l'interpolation, que ngx-translate ecrirait `a,b`. */
  protected readonly lastError = computed(() => {
    const failure = this.sidecar.lastError()

    return failure === null
      ? null
      : {
          code: failure.code,
          params: Object.fromEntries(
            Object.entries(failure.params).map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join(", ") : value,
            ]),
          ),
        }
  })

  /** Un M3U8 ne contient qu'une playlist : rien a choisir. */
  protected readonly showsPlaylistSelector = computed(
    () => this.sidecar.playlistFormat() === "vlc_dump",
  )

  /**
   * Un fichier est choisi et le sidecar n'a pas encore repondu. Le service efface la
   * reponse precedente a chaque listage : un format nul signifie donc « en attente »,
   * sauf si une erreur est venue a sa place.
   */
  protected readonly awaitsPlaylists = computed(
    () =>
      this.playlistPath() !== null &&
      this.sidecar.playlistFormat() === null &&
      this.sidecar.lastError() === null,
  )

  /**
   * Le style rejoint chaque ligne ici et non dans le template : le contexte `#body` de
   * `p-table` n'est pas type, une indexation y echapperait au compilateur.
   */
  protected readonly rows = computed(() => {
    const result = this.sidecar.extraction()
    const language = this.translate.currentLang() ?? FALLBACK_LANGUAGE

    return result === null
      ? []
      : toExtractionRows(result, (bytes) => formatFileSize(bytes, language)).map((row) => ({
          ...row,
          ...CATEGORY_STYLE[row.category],
        }))
  })

  /**
   * `ready` couvre le sidecar lance, la version controlee et aucune extraction en cours.
   * Le format doit etre annonce : tant qu'il est nul, le dump peut encore se reveler
   * exiger une playlist, et une erreur de listage le laisse nul aussi.
   */
  protected readonly canExtract = computed(
    () =>
      this.sidecar.ready() &&
      this.sourceFolder() !== null &&
      this.destinationFolder() !== null &&
      this.playlistPath() !== null &&
      this.sidecar.playlistFormat() !== null &&
      (!this.showsPlaylistSelector() || this.choice().playlist !== null),
  )

  constructor() {
    void readExtractionMode().then((stored) => {
      this.choice.update((current) => ({ ...current, mode: stored }))
    })
  }

  protected async chooseFolder(target: WritableSignal<string | null>): Promise<void> {
    if (this.sidecar.extracting()) {
      return
    }

    const chosen = await this.openPath({ directory: true })
    if (chosen !== null) {
      target.set(chosen)
    }
  }

  /**
   * Le choix du fichier declenche le listage : c'est la reponse du sidecar qui
   * annonce le format, l'interface n'ayant pas le droit de le deduire. Jamais
   * pendant un run, le listage attendrait la fin de l'extraction en cours.
   */
  protected async choosePlaylistFile(): Promise<void> {
    if (this.sidecar.extracting()) {
      return
    }

    const chosen = await this.openPath({ directory: false })
    if (chosen === null) {
      return
    }

    this.playlistPath.set(chosen)
    this.choice.update((current) => ({ ...current, playlist: null }))
    await this.sidecar.listPlaylists(chosen)
  }

  /** Appele sur l'evenement du toggle : le champ a deja ecrit dans `choice`. */
  protected async persistMode(): Promise<void> {
    await writeExtractionMode(this.choice().mode)
  }

  protected async extract(): Promise<void> {
    if (!this.canExtract()) {
      return
    }

    const source = this.sourceFolder()
    const destination = this.destinationFolder()
    const playlist = this.playlistPath()
    if (source === null || destination === null || playlist === null) {
      return
    }

    await this.sidecar.extractPlaylist({
      source_folder: source,
      destination_folder: destination,
      playlist_path: playlist,
      playlist_name: this.choice().playlist,
      mode: this.choice().mode,
    })
  }

  /** Hors Tauri, le plugin `dialog` rejette : l'ecran reste utilisable. */
  private async openPath(options: { directory: boolean }): Promise<string | null> {
    try {
      const chosen = await open({ directory: options.directory, multiple: false })

      return typeof chosen === "string" ? chosen : null
    } catch {
      return null
    }
  }
}
