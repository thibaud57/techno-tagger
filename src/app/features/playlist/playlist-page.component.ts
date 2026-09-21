import {
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
  type WritableSignal,
} from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { open } from "@tauri-apps/plugin-dialog"
import { ButtonDirective } from "primeng/button"
import { Label } from "primeng/label"
import { Select } from "primeng/select"
import { SelectButton } from "primeng/selectbutton"
import { Skeleton } from "primeng/skeleton"
import { TableModule } from "primeng/table"
import { Tag, type TagSeverity } from "primeng/tag"
import { Tooltip } from "primeng/tooltip"

import { languageFromTag } from "../../core/language"
import type { ExtractionMode } from "../../core/models/protocol"
import {
  DEFAULT_EXTRACTION_MODE,
  readExtractionMode,
  writeExtractionMode,
} from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent, type IconName } from "../../shared/components/icon.component"
import { PathPickerComponent } from "../../shared/components/path-picker.component"
import { PhaseProgressComponent } from "../../shared/components/phase-progress.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { formatFileSize } from "../../shared/utils/file-size"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { fullHeightTable } from "../../shared/utils/table"
import { TOOLTIP_DELAY, WIDE_TOOLTIP } from "../../shared/utils/tooltip"

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
    Label,
    Select,
    SelectButton,
    PathPickerComponent,
    PhaseProgressComponent,
    TableModule,
    Tag,
    Skeleton,
    FormField,
    EmptyStateComponent,
    ErrorMessageComponent,
    IconComponent,
    SourceLogoComponent,
    TruncatedTextComponent,
    Tooltip,
  ],
  templateUrl: "./playlist-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class PlaylistPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly translate = inject(TranslateService)

  /** Un onglet rouvert reprend les choix du dernier run, que le service garde avec son rapport. */
  private readonly restoredRun = this.sidecar.extractionRequest()

  protected readonly sourceFolder = signal(this.restoredRun?.source_folder ?? null)
  protected readonly destinationFolder = signal(this.restoredRun?.destination_folder ?? null)
  /** Le fichier du dernier listage, pas celui du run : c'est lui que decrivent les playlists recues. */
  protected readonly playlistPath = signal(this.sidecar.listedPlaylistPath())

  /**
   * Les deux choix de l'ecran, dans un seul signal. `form()` en derive un arbre
   * de champs que `[formField]` lie aux composants PrimeNG : ceux-ci n'exposent
   * leur valeur que par `ControlValueAccessor`, avec lequel la directive
   * interopere. Aucun validateur n'est declare, il n'y a rien a valider ici.
   */
  protected readonly choice = signal<PlaylistChoice>({
    playlist:
      this.restoredRun?.playlist_path === this.playlistPath()
        ? this.restoredRun.playlist_name
        : null,
    mode: DEFAULT_EXTRACTION_MODE,
  })

  protected readonly fields = form(this.choice)

  protected readonly extracting = this.sidecar.extracting
  /** Copie mutable : `p-select` attend un tableau modifiable, le contrat NDJSON en lit lecture seule. */
  protected readonly playlists = computed(() => [...this.sidecar.playlists()])
  protected readonly progress = this.sidecar.progress
  protected readonly progressPercent = computed(() => {
    const running = this.sidecar.progress()

    return running === null ? undefined : (running.processed / running.total) * 100
  })
  protected readonly extraction = this.sidecar.extraction

  /** Les deux commandes de cet ecran : l'echec d'un enregistrement de cle ne s'affiche pas ici. */
  protected readonly lastError = computed(() => {
    const command = this.sidecar.lastErrorCommand()

    return command === "list_playlists" || command === "extract_playlist"
      ? this.sidecar.lastError()
      : null
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
      this.lastError() === null,
  )

  /**
   * Le style rejoint chaque ligne ici et non dans le template : le contexte `#body` de
   * `p-table` n'est pas type, une indexation y echapperait au compilateur.
   */
  protected readonly rows = computed(() => {
    const result = this.sidecar.extraction()
    const language = languageFromTag(this.translate.currentLang())

    return result === null
      ? []
      : toExtractionRows(result, (bytes) => formatFileSize(bytes, language)).map((row) => ({
          ...row,
          ...CATEGORY_STYLE[row.category],
        }))
  })

  /**
   * Source unique de l'action et de son aide. Un fichier dont le listage a echoue est a
   * rechoisir ; un listage en cours n'y figure pas, le squelette le signale deja.
   */
  protected readonly missingChoices = computed(() =>
    [
      this.sourceFolder() === null && "playlist.missing.source",
      this.destinationFolder() === null && "playlist.missing.destination",
      (this.playlistPath() === null ||
        (this.sidecar.playlistFormat() === null && !this.awaitsPlaylists())) &&
        "playlist.missing.file",
      this.showsPlaylistSelector() &&
        this.choice().playlist === null &&
        "playlist.missing.playlist",
    ].filter((key): key is string => key !== false),
  )

  /**
   * `ready` couvre le sidecar lance, la version controlee et aucune extraction en cours.
   * Le format doit etre annonce : tant qu'il est nul, le dump peut encore se reveler
   * exiger une playlist, et une erreur de listage le laisse nul aussi.
   */
  protected readonly canExtract = computed(
    () =>
      this.sidecar.ready() &&
      this.sidecar.playlistFormat() !== null &&
      this.missingChoices().length === 0,
  )

  /** `Intl.ListFormat` pose le « et » ou le « and » de la langue courante. */
  protected readonly missingHint = computed(() => {
    const missing = this.missingChoices()
    if (missing.length === 0) {
      return null
    }

    const language = languageFromTag(this.translate.currentLang())
    const items = new Intl.ListFormat(language, { type: "conjunction" }).format(
      missing.map((key) => this.translate.instant(key) as string),
    )

    return this.translate.instant("playlist.missing.hint", { items }) as string
  })

  /** Oublie a chaque debut et fin de run : le formulaire se replie de nouveau. */
  protected readonly manuallyExpanded = linkedSignal(() => {
    this.extracting()

    return false
  })

  protected readonly formCollapsed = computed(
    () => (this.extracting() || this.extraction() !== null) && !this.manuallyExpanded(),
  )

  protected readonly lastRun = this.sidecar.extractionRequest

  /** Un M3U8 n'a pas de nom interne : son fichier le nomme, extension comprise faute de logo. */
  protected readonly lastRunPlaylist = computed(() => {
    const run = this.lastRun()

    return run === null ? null : (run.playlist_name ?? run.playlist_path.replace(/^.*[\\/]/, ""))
  })

  /** Hauteur de la classe `h-10.25` posee sur les lignes : le defilement virtuel la calcule, il ne la mesure pas. */
  protected readonly rowHeight = 41

  protected readonly tablePt = computed(() => fullHeightTable(this.rows().length === 0))

  protected readonly tooltipDelay = TOOLTIP_DELAY
  protected readonly wideTooltip = WIDE_TOOLTIP
  protected readonly fadeIn = FADE_IN

  /** Hauteur du `p-select` qu'il precede, derivee des memes tokens : aucun saut a son arrivee. */
  protected readonly selectSkeletonHeight =
    "calc(2 * var(--p-form-field-sm-padding-y) + 1.5 * var(--p-form-field-sm-font-size) + 2px)"

  protected readonly modeOptions = [
    { labelKey: "playlist.mode.copy", value: "copy" satisfies ExtractionMode },
    { labelKey: "playlist.mode.move", value: "move" satisfies ExtractionMode },
  ]

  constructor() {
    void readExtractionMode().then((stored) => {
      this.choice.update((current) => ({ ...current, mode: stored }))
    })
  }

  protected expandForm(): void {
    this.manuallyExpanded.set(true)
  }

  protected async chooseFolder(target: WritableSignal<string | null>): Promise<void> {
    const chosen = await this.openPath({ directory: true })
    if (chosen !== null) {
      target.set(chosen)
    }
  }

  /**
   * Le choix du fichier declenche le listage : c'est la reponse du sidecar qui
   * annonce le format, l'interface n'ayant pas le droit de le deduire.
   */
  protected async choosePlaylistFile(): Promise<void> {
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
