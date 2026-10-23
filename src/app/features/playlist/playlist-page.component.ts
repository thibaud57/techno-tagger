import { AsyncPipe } from "@angular/common"
import {
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
  type WritableSignal,
} from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"

import { ButtonDirective } from "primeng/button"
import { Label } from "primeng/label"
import { Select } from "primeng/select"
import { SelectButton } from "primeng/selectbutton"
import { Skeleton } from "primeng/skeleton"
import { TableModule } from "primeng/table"
import { Tag, type TagSeverity } from "primeng/tag"
import { Tooltip } from "primeng/tooltip"

import { languageFromTag } from "../../core/i18n/language"
import type { ExtractionMode } from "../../core/sidecar/protocol"
import { NativeService } from "../../core/platform/native.service"
import {
  DEFAULT_EXTRACTION_MODE,
  PreferencesService,
} from "../../core/platform/preferences.service"
import { SidecarService } from "../../core/sidecar/sidecar.service"
import { EmptyStateComponent } from "../../shared/components/display/empty-state.component"
import { IconComponent, type IconName } from "../../shared/components/display/icon.component"
import { PhaseProgressComponent } from "../../shared/components/display/phase-progress.component"
import { SkeletonRowsComponent } from "../../shared/components/display/skeleton-rows.component"
import { SourceLogoComponent } from "../../shared/components/display/source-logo.component"
import { TruncatedTextComponent } from "../../shared/components/display/truncated-text.component"
import { ErrorMessageComponent } from "../../shared/components/feedback/error-message.component"
import { PathPickerComponent } from "../../shared/components/inputs/path-picker.component"
import { formatFileSize } from "../../shared/utils/file-size"
import { FADE_IN } from "../../shared/utils/motion"
import { progressPercentage } from "../../shared/utils/progress"
import { ReasonTextPipe } from "../../shared/utils/reason"
import { fullHeightTable } from "../../shared/utils/table"
import { TOOLTIP, WIDE_TOOLTIP } from "../../shared/utils/tooltip"

import { toExtractionRows, type ExtractionCategory } from "./extraction-rows"

interface PlaylistChoice {
  playlist: string | null
  mode: ExtractionMode
}

/**
 * Familles de DESIGN.md § Couleurs Semantiques. Un doublon departage est une issue positive, pas une decision attendue : vert, le libelle
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

/** Hauteur d'une ligne du rapport : la classe la pose, le defilement virtuel la calcule sans la mesurer. */
export const REPORT_ROW_CLASS = "h-10.25"
export const REPORT_ROW_HEIGHT = 41

@Component({
  selector: "app-playlist-page",
  imports: [
    AsyncPipe,
    ReasonTextPipe,
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
    SkeletonRowsComponent,
    ErrorMessageComponent,
    IconComponent,
    SourceLogoComponent,
    TruncatedTextComponent,
    Tooltip,
  ],
  templateUrl: "./playlist-page.component.html",
  host: { class: "page-host", "animate.enter": FADE_IN },
})
export default class PlaylistPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly translate = inject(TranslateService)
  private readonly router = inject(Router)
  private readonly native = inject(NativeService)
  private readonly preferences = inject(PreferencesService)

  /** Un onglet rouvert reprend les choix du dernier run, que le service garde avec son rapport. */
  private readonly restoredRun = this.sidecar.extractionRequest()

  protected readonly sourceFolder = signal(this.restoredRun?.source_folder ?? null)
  protected readonly destinationFolder = signal(this.restoredRun?.destination_folder ?? null)
  /** Le fichier du dernier listage, pas celui du run : c'est lui que decrivent les playlists recues. */
  protected readonly playlistPath = signal(this.sidecar.listedPlaylistPath())

  /** Un seul signal : `form()` en derive les champs que `[formField]` lie aux composants PrimeNG. */
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
  protected readonly progressPercent = computed(() => progressPercentage(this.sidecar.progress()))
  protected readonly extraction = this.sidecar.extraction

  protected readonly lastError = this.sidecar.errorFor("list_playlists", "extract_playlist")

  /** Un M3U8 ne contient qu'une playlist : rien a choisir. */
  protected readonly showsPlaylistSelector = computed(
    () => this.sidecar.playlistFormat() === "vlc_dump",
  )

  /**
   * L'attente est un etat du service, pas une deduction : toute commande efface `lastError`,
   * donc « format nul et pas d'erreur » resterait vrai a jamais apres un listage refuse puis
   * un passage par les Reglages.
   */
  protected readonly awaitsPlaylists = computed(
    () => this.playlistPath() !== null && this.sidecar.listingPending(),
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
   * `ready` couvre aussi l'extraction en cours. Le format doit etre annonce : tant qu'il est
   * nul, le dump peut encore se reveler exiger une playlist ; une erreur de listage le
   * laisse nul aussi. Le sidecar refuse une extraction pendant la recherche d'un run : le
   * bouton ne l'offre pas.
   */
  protected readonly canExtract = computed(
    () =>
      this.sidecar.ready() &&
      !this.sidecar.tagging() &&
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

  protected readonly extractHint = computed(() =>
    this.sidecar.tagging()
      ? (this.translate.instant("playlist.blocked.tagging") as string)
      : this.missingHint(),
  )

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

  protected readonly rowHeight = REPORT_ROW_HEIGHT
  protected readonly rowClass = REPORT_ROW_CLASS

  protected readonly tablePt = computed(() => fullHeightTable(this.rows().length === 0))

  protected readonly tooltip = TOOLTIP
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
    void this.preferences.readExtractionMode().then((stored) => {
      this.choice.update((current) => ({ ...current, mode: stored }))
    })
  }

  protected expandForm(): void {
    this.manuallyExpanded.set(true)
  }

  protected async chooseFolder(target: WritableSignal<string | null>): Promise<void> {
    const chosen = await this.native.pickPath({ directory: true })
    if (chosen !== null) {
      target.set(chosen)
    }
  }

  /** Le choix du fichier declenche le listage : seul le sidecar annonce le format. */
  protected async choosePlaylistFile(): Promise<void> {
    const chosen = await this.native.pickPath({ directory: false })
    if (chosen === null) {
      return
    }

    this.playlistPath.set(chosen)
    this.choice.update((current) => ({ ...current, playlist: null }))
    await this.sidecar.listPlaylists(chosen)
  }

  /** Appele sur l'evenement du toggle : le champ a deja ecrit dans `choice`. */
  protected async persistMode(): Promise<void> {
    await this.preferences.writeExtractionMode(this.choice().mode)
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

    void this.preferences.writeLastDestination(destination)
    await this.sidecar.extractPlaylist({
      source_folder: source,
      destination_folder: destination,
      playlist_path: playlist,
      playlist_name: this.choice().playlist,
      mode: this.choice().mode,
    })
  }

  /** Le dossier suit par la destination memorisee a l'extraction : rien a transporter. */
  protected goTagging(): void {
    void this.router.navigate(["tagging"])
  }
}
