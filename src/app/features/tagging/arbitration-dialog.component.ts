import {
  Component,
  DOCUMENT,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { TranslatePipe } from "@ngx-translate/core"
import { Badge } from "primeng/badge"
import { ButtonDirective } from "primeng/button"
import { Dialog } from "primeng/dialog"
import { Listbox, type ListBoxPassThrough } from "primeng/listbox"
import { Message } from "primeng/message"

import type { ArbitrationState, CandidatePayload, TrackScores } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { joinIdentity, trackMainLine } from "../../shared/utils/identity"

/** Aucune animation : la decision est sur le chemin critique du run (DESIGN.md § Composants Animes). */
const NO_MOTION = { disabled: true } as const

/**
 * `scrollHeight` ne pose qu'un max-height : la hauteur fixe tient la ligne d'aide en place.
 * Sans option ciblee, Aura ne marque pas le focus de la liste : la bordure le fait, comme un champ.
 */
const LISTBOX_PT: ListBoxPassThrough = {
  root: { class: "focus-within:border-primary" },
  listContainer: { class: "h-67" },
  emptyMessage: { class: "flex h-full items-center justify-center text-sm text-muted-color" },
}

/** Option de la liste. `index` est la position dans la liste recue : c'est ce que le geste envoie. */
interface CandidateOption {
  readonly index: number
  readonly names: string
  readonly release: string | null
  readonly scores: TrackScores
}

type Gesture = "choose" | "refuse" | "switch"

const toOption = (candidate: CandidatePayload, index: number): CandidateOption => {
  const release = [candidate.label, candidate.year].filter((part) => part !== null).join(" · ")

  return {
    index,
    names: joinIdentity(candidate.artist, candidate.title),
    release: release === "" ? null : release,
    scores: candidate.scores,
  }
}

/** Modale d'arbitrage : sa visibilite appartient au shell, qui la suspend a la croix. */
@Component({
  selector: "app-arbitration-dialog",
  imports: [
    Dialog,
    Listbox,
    FormField,
    Badge,
    Message,
    ButtonDirective,
    TranslatePipe,
    ErrorMessageComponent,
    IconComponent,
    SourceLogoComponent,
    TruncatedTextComponent,
  ],
  templateUrl: "./arbitration-dialog.component.html",
})
export class ArbitrationDialogComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly document = inject(DOCUMENT)

  protected readonly lastGesture = signal<Gesture | null>(null)

  protected readonly noMotion = NO_MOTION
  protected readonly listboxPt = LISTBOX_PT

  readonly visible = input.required<boolean>()
  readonly dismissed = output()

  private readonly listHost = viewChild<ElementRef<HTMLDivElement>>("list")
  private readonly refuseButton = viewChild<ElementRef<HTMLButtonElement>>("refuseButton")

  protected readonly current = this.sidecar.currentArbitration
  protected readonly position = this.sidecar.arbitrationPosition
  protected readonly count = this.sidecar.arbitrationCount
  protected readonly busy = this.sidecar.arbitrationBusy
  protected readonly hasPrevious = this.sidecar.hasPreviousArbitration
  protected readonly hasNext = this.sidecar.hasNextArbitration
  private readonly gestureError = this.sidecar.errorFor(
    "resolve_arbitration",
    "switch_arbitration_source",
  )

  /** Ligne du run : l'identite lue sur le fichier, que l'etat d'arbitrage ne porte pas. */
  protected readonly track = computed(() => {
    const trackId = this.current()?.track_id

    return this.sidecar.taggingTracks().find((row) => row.trackId === trackId) ?? null
  })
  protected readonly title = computed(() => {
    const row = this.track()

    return row === null
      ? (this.current()?.track_id ?? "")
      : trackMainLine(row.artist, row.title, row.fileName)
  })
  protected readonly fileName = computed(() => this.track()?.fileName ?? null)
  /** Copie mutable : `p-listbox` attend un tableau modifiable, le contrat est en lecture seule. */
  protected readonly options = computed(() => (this.current()?.candidates ?? []).map(toOption))
  protected readonly empty = computed(() => this.options().length === 0)
  protected readonly emptyMessage = computed(
    () => `arbitration.empty.${this.current()?.empty_reason ?? "no_result"}`,
  )
  /** Une erreur ne vaut que pour le morceau qu'elle designe. */
  protected readonly error = computed(() => {
    const error = this.gestureError()

    return error !== null && error.params["track_id"] === this.current()?.track_id ? error : null
  })

  /** La selection repart de zero a chaque morceau et a chaque liste affichee. */
  private readonly shownList = computed(
    () => `${this.current()?.track_id ?? ""}|${this.current()?.source ?? ""}`,
  )
  protected readonly choice = linkedSignal<string, { candidate: number | null }>({
    source: this.shownList,
    computation: () => ({ candidate: null }),
  })
  protected readonly fields = form(this.choice)
  protected readonly pendingGesture = computed(() => (this.busy() ? this.lastGesture() : null))

  constructor() {
    // Meme noeud liste entre la croix et la reouverture : sans lire `visible()` ici, rien ne redonne le focus.
    afterRenderEffect({
      write: () => {
        this.shownList()
        if (this.visible()) {
          this.focusList()
        }
      },
    })

    // Le bouton qui portait le focus se desactive avec `busy()` : le navigateur le rend a <body>, orphelin si le geste echoue.
    afterRenderEffect({
      write: () => {
        this.busy()
        const active = this.document.activeElement
        if (this.visible() && (active === null || active === this.document.body)) {
          this.focusList()
        }
      },
    })
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.dismissed.emit()
    }
  }

  protected validate(): void {
    const shown = this.idleArbitration()
    const index = this.choice().candidate
    if (shown === null || index === null) {
      return
    }
    this.lastGesture.set("choose")
    void this.sidecar.chooseCandidate(shown.track_id, shown.source, index)
  }

  protected refuse(): void {
    const shown = this.idleArbitration()
    if (shown === null) {
      return
    }
    this.lastGesture.set("refuse")
    void this.sidecar.refuseCandidates(shown.track_id, shown.source)
  }

  protected goBack(): void {
    const shown = this.idleArbitration()
    const other = shown?.other_source ?? null
    if (shown === null || other === null) {
      return
    }
    this.lastGesture.set("switch")
    void this.sidecar.showArbitrationSource(shown.track_id, other)
  }

  protected previous(): void {
    this.sidecar.previousArbitration()
  }

  protected next(): void {
    this.sidecar.nextArbitration()
  }

  /** Entree sur un bouton appartient au bouton : elle ne valide jamais en plus de son clic. */
  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault()
        this.previous()
        break
      case "ArrowRight":
        event.preventDefault()
        this.next()
        break
      case "Enter":
        if (!(event.target instanceof HTMLButtonElement)) {
          event.preventDefault()
          this.validate()
        }
        break
      default:
        break
    }
  }

  /** Un seul geste en vol par morceau : pendant l'attente, aucun autre ne part. */
  private idleArbitration(): ArbitrationState | null {
    return this.busy() ? null : this.current()
  }

  /** Sans candidat, PrimeNG ne rend aucune liste : le focus va a « Passer », seule action restante. */
  private focusList(): void {
    const list = this.listHost()?.nativeElement.querySelector<HTMLElement>('[role="listbox"]')
    const target = list ?? this.refuseButton()?.nativeElement
    target?.focus()
  }
}
