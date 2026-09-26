# Modale d'arbitrage : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher la modale qui laisse choisir un candidat en zone grise, refuser pour basculer sur Bandcamp, revenir à Beatport et parcourir la file au clavier.

**Architecture:** Un `ArbitrationDialogComponent` (`features/tagging/`) lit `SidecarService`, rend un `p-dialog` figé et sans animation autour d'une `p-listbox` liée par Signal Forms à une sélection en `linkedSignal`, et n'émet que des gestes et `dismissed`. Le shell (`AppComponent`) tient sa visibilité par un `linkedSignal` « suspendu » qui repart à chaque changement de vacuité de la file, porte le badge « N à arbitrer » de la barre d'onglets et monte la modale hors du `router-outlet`. Les docs de design consignent les écarts à la maquette.

**Tech Stack:** Angular 22 (signals, `linkedSignal`, `afterRenderEffect`, Signal Forms `form()` + `[formField]`), PrimeNG 22 (`Dialog`, `Listbox`, `Badge`, `Message`, `Tag`, `ButtonDirective`), ngx-translate 18, Tailwind 4, Vitest. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/arbitrage-utilisateur/04-modale-arbitrage-design.md`

## Global Constraints

- **Dépend du sub-project 03** : `SidecarService.currentArbitration` (`ArbitrationState | null`), `arbitrationPosition`, `arbitrationCount`, `arbitrationBusy`, `hasPreviousArbitration`, `hasNextArbitration`, `taggingTracks`, `errorFor(...)`, `chooseCandidate(trackId, source, index)`, `refuseCandidates(trackId, source)`, `showArbitrationSource(trackId, source)`, `previousArbitration()`, `nextArbitration()`.
- **Dimensions figées** (DESIGN.md § Layout) : modale 720 × 560px, zone de liste 268px.
- **Aucune animation** sur la modale et son masque (DESIGN.md § Composants Animés) : `motionOptions` et `maskMotionOptions` à `{ disabled: true }` (`MotionOptions.disabled` de `@primeuix/motion`).
- **Séparateurs** : tiret simple entre artiste et titre, `·` entre label et année, score sur une ligne « 94 (A 96 · T 92) » (DESIGN.md § Séparateurs, arbitrage « Séparateur artiste / titre »).
- **Icônes** par `IconComponent`, taille 16 dans les boutons `small` comme ailleurs dans le code ; logo de source par `SourceLogoComponent`, taille 20 dans l'en-tête.
- **Aucun libellé en dur**, aucune couleur en dur, aucun `::ng-deep`. Français au vouvoiement, actions à l'infinitif, espace insécable littérale (U+00A0, comme le reste de `fr.json`) avant `:`.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, `SidecarService` stubé par signals et `errorFor: SidecarService.prototype.errorFor` (pattern de `tagging-page.component.spec.ts`), `provideTranslateService()` sans loader : le texte rendu est la clé de traduction.
- **Gate vert à chaque commit** : `just lint-ui`, `just typecheck-ui`, `just test-ui`. Commits `type(scope): description`, scope `ui`.

## Review Focus

- **Entrée pressée sur un bouton du pied** : le clic du bouton seul part, jamais un choix en plus (Task 1, `ignores Enter pressed on a button`).
- **Erreur d'un geste sur un autre morceau** : non affichée sur l'arbitrage courant (Task 1, `shows only the error of the current track`).
- **Morceau absent des lignes du run** : en-tête réduit au `track_id`, modale utilisable (Task 1, `falls back on the track id without a run row`).
- **Candidat à score artiste nul** : format sans « A » (Task 1, couvert par `shows the candidates of the current arbitration with their score and their label and year`, second candidat).
- **Badge pendant la suspension** : toujours présent et à jour quand la modale est fermée par la croix (Task 2, `keeps it closed after the cross until the queue badge is clicked`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/features/tagging/arbitration-dialog.component.ts` | État d'écran de la modale : sélection, gestes, clavier, focus. |
| `src/app/features/tagging/arbitration-dialog.component.html` | Cadre, en-tête, messages, liste, pied. |
| `src/app/features/tagging/arbitration-dialog.component.spec.ts` | Règles portées par la modale. |
| `src/app/app.component.ts`, `.html` | Visibilité, badge de file, montage. |
| `src/app/app.component.spec.ts` | Règles de visibilité. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Bloc `arbitration.*`. |
| `docs/DESIGN.md`, `.design-sync/NOTES.md` | Mapping, arbitrages, reste ouvert. |

---

## Task 1: Modale d'arbitrage

**Files:**
- Create: `src/app/features/tagging/arbitration-dialog.component.ts`
- Create: `src/app/features/tagging/arbitration-dialog.component.html`
- Test: `src/app/features/tagging/arbitration-dialog.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: le contrat du sub-project 03 (Global Constraints) ; `ArbitrationState`, `CandidatePayload` (`core/models/protocol.ts`) ; `TaggingTrack` (`core/tagging-run.store.ts`) ; `ErrorMessageComponent`, `IconComponent`, `SourceLogoComponent`, `TruncatedTextComponent` (`shared/components/`).
- Produces: `ArbitrationDialogComponent`, sélecteur `app-arbitration-dialog`, `visible = input.required<boolean>()`, `dismissed = output()`.

- [ ] **Step 1: Ajouter les libellés**

Dans `public/i18n/fr.json`, ajouter à la racine, après le bloc `tagging`, le bloc suivant (l'espace avant chaque `:` est une espace insécable littérale) :

```json
  "arbitration": {
    "close": "Fermer sans décider",
    "inGreyZone": "Candidats en zone grise : {{count}}",
    "switched": "Les candidats Beatport ont été refusés. La liste Bandcamp les remplace ici même.",
    "backToBeatport": "Revenir à Beatport",
    "beatportUnavailable": "Beatport ne répond pas : ces candidats viennent de Bandcamp et aucun n'a été validé seul.",
    "empty": {
      "no_result": "Bandcamp ne trouve rien pour ce morceau.",
      "below_threshold": "Bandcamp ne propose que des candidats trop éloignés.",
      "source_unavailable": "Bandcamp ne répond pas."
    },
    "candidates": "Candidats",
    "score": "{{average}} (A {{artist}} · T {{title}})",
    "scoreTitleOnly": "{{average}} (T {{title}})",
    "previous": "Arbitrage précédent",
    "next": "Arbitrage suivant",
    "refuse": "Aucune correspondance",
    "pass": "Passer",
    "validate": "Valider",
    "help": "Flèches gauche et droite pour changer d'arbitrage, Entrée pour valider. La croix ne décide rien : l'arbitrage reste en file.",
    "badge": "{{count}} à arbitrer",
    "reopen": "Rouvrir les arbitrages"
  },
```

Dans `public/i18n/en.json`, au même endroit :

```json
  "arbitration": {
    "close": "Close without deciding",
    "inGreyZone": "Grey zone candidates: {{count}}",
    "switched": "The Beatport candidates were refused. The Bandcamp list replaces them here.",
    "backToBeatport": "Back to Beatport",
    "beatportUnavailable": "Beatport did not answer: these candidates come from Bandcamp and none was validated on its own.",
    "empty": {
      "no_result": "Bandcamp finds nothing for this track.",
      "below_threshold": "Bandcamp only offers candidates that are too far off.",
      "source_unavailable": "Bandcamp did not answer."
    },
    "candidates": "Candidates",
    "score": "{{average}} (A {{artist}} · T {{title}})",
    "scoreTitleOnly": "{{average}} (T {{title}})",
    "previous": "Previous arbitration",
    "next": "Next arbitration",
    "refuse": "No match",
    "pass": "Skip",
    "validate": "Validate",
    "help": "Left and right arrows to switch arbitration, Enter to validate. The cross decides nothing: the arbitration stays in the queue.",
    "badge": "{{count}} to arbitrate",
    "reopen": "Reopen the arbitrations"
  },
```

Le score passe par une phrase à paramètres plutôt que par les lettres `tagging.list.scoreArtist` / `scoreTitle` : sur une ligne, l'assemblage dans le template laisserait une espace parasite après la parenthèse.

- [ ] **Step 2: Écrire les tests de la modale**

Créer `src/app/features/tagging/arbitration-dialog.component.spec.ts` :

```typescript
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import type {
  ArbitrationState,
  SidecarCommand,
  SidecarErrorEvent,
} from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { ArbitrationDialogComponent } from "./arbitration-dialog.component"

const ROW: TaggingTrack = {
  trackId: "a.mp3",
  fileName: "a.mp3",
  artist: "Adam Beyer",
  title: "Your Mind",
  state: null,
  resolution: null,
  failureReason: null,
  source: null,
  after: null,
  scores: null,
  artworkPath: null,
  arbitration: null,
}

const ON_BEATPORT: ArbitrationState = {
  track_id: "a.mp3",
  source: "beatport",
  beatport_unavailable: false,
  candidates: [
    {
      artist: "Adam Beyer",
      title: "Your Mind (Extended Mix)",
      label: "Drumcode",
      year: 2023,
      scores: { artist: 96, title: 84, average: 90 },
    },
    {
      artist: "Adam Beyer",
      title: "Your Mind (Radio Edit)",
      label: null,
      year: null,
      scores: { artist: null, title: 80, average: 80 },
    },
  ],
  empty_reason: null,
  other_source: null,
}

const AFTER_REFUSAL: ArbitrationState = {
  ...ON_BEATPORT,
  source: "bandcamp",
  candidates: [
    {
      artist: "Adam Beyer",
      title: "Your Mind",
      label: null,
      year: null,
      scores: { artist: 100, title: 100, average: 100 },
    },
  ],
  other_source: "beatport",
}

const stub = () => ({
  currentArbitration: signal<ArbitrationState | null>(ON_BEATPORT),
  arbitrationPosition: signal(1),
  arbitrationCount: signal(2),
  arbitrationBusy: signal(false),
  hasPreviousArbitration: signal(false),
  hasNextArbitration: signal(true),
  taggingTracks: signal<readonly TaggingTrack[]>([ROW]),
  lastError: signal<SidecarErrorEvent | null>(null),
  lastErrorCommand: signal<SidecarCommand["command"] | null>(null),
  errorFor: SidecarService.prototype.errorFor,
  chooseCandidate: vi.fn(() => Promise.resolve()),
  refuseCandidates: vi.fn(() => Promise.resolve()),
  showArbitrationSource: vi.fn(() => Promise.resolve()),
  previousArbitration: vi.fn(),
  nextArbitration: vi.fn(),
})

/** Surcharges typees : un `Record<string, unknown>` ferait perdre aux signals leur `set`. */
const mountWith = (overrides: Partial<ReturnType<typeof stub>> = {}) => {
  const service = { ...stub(), ...overrides }
  TestBed.configureTestingModule({
    imports: [ArbitrationDialogComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })
  const fixture = TestBed.createComponent(ArbitrationDialogComponent)
  fixture.componentRef.setInput("visible", true)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

/** Le dialog peut etre rendu hors de l'hote : la page entiere est interrogee. */
const page = (): HTMLElement => document.body

const action = (name: string): HTMLButtonElement | null =>
  page().querySelector<HTMLButtonElement>(`[data-action="${name}"]`)

describe("ArbitrationDialogComponent", () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it("shows the candidates of the current arbitration with their score and their label and year", () => {
    mountWith()

    const text = page().textContent ?? ""

    expect(text).toContain("Adam Beyer - Your Mind (Extended Mix)")
    expect(text).toContain("Drumcode · 2023")
    expect(text).toContain("arbitration.score")
    expect(text).toContain("arbitration.scoreTitleOnly")
  })

  it("omits the label line of a candidate that has none", () => {
    mountWith()

    const releases = page().querySelectorAll("[data-release]")

    expect(releases.length).toBe(1)
  })

  it("falls back on the track id without a run row", () => {
    mountWith({ taggingTracks: signal<readonly TaggingTrack[]>([]) })

    const title = page().querySelector("[data-title]")?.textContent?.trim()

    expect(title).toBe("a.mp3")
  })

  it("replaces the Beatport list by the Bandcamp list and offers to go back", () => {
    const { fixture, service } = mountWith()
    service.currentArbitration.set(AFTER_REFUSAL)
    fixture.detectChanges()

    action("back")?.click()

    expect(page().textContent).toContain("arbitration.switched")
    expect(page().textContent).not.toContain("Your Mind (Extended Mix)")
    expect(service.showArbitrationSource).toHaveBeenCalledWith("a.mp3", "beatport")
  })

  it("warns when the candidates come from Bandcamp because Beatport did not answer", () => {
    mountWith({
      currentArbitration: signal<ArbitrationState | null>({
        ...AFTER_REFUSAL,
        beatport_unavailable: true,
        other_source: null,
      }),
    })

    const text = page().textContent ?? ""

    expect(text).toContain("arbitration.beatportUnavailable")
    expect(action("back")).toBeNull()
  })

  it("offers a single pass action on an empty Bandcamp list with its reason", () => {
    const { service } = mountWith({
      currentArbitration: signal<ArbitrationState | null>({
        ...AFTER_REFUSAL,
        candidates: [],
        empty_reason: "no_result",
      }),
    })

    action("refuse")?.click()

    expect(page().textContent).toContain("arbitration.empty.no_result")
    expect(action("refuse")?.textContent).toContain("arbitration.pass")
    expect(action("validate")?.disabled).toBe(true)
    expect(service.refuseCandidates).toHaveBeenCalledWith("a.mp3", "bandcamp")
  })

  it("validates only a selected candidate, with its source and its index", () => {
    const { fixture, component, service } = mountWith()
    action("validate")?.click()
    const before = vi.mocked(service.chooseCandidate).mock.calls.length
    component["choice"].set({ candidate: 1 })
    fixture.detectChanges()

    action("validate")?.click()

    expect(before).toBe(0)
    expect(service.chooseCandidate).toHaveBeenCalledWith("a.mp3", "beatport", 1)
  })

  it("refuses the shown list with its source", () => {
    const { service } = mountWith()

    action("refuse")?.click()

    expect(service.refuseCandidates).toHaveBeenCalledWith("a.mp3", "beatport")
  })

  it("disables every action while a gesture awaits its answer", () => {
    mountWith({
      currentArbitration: signal<ArbitrationState | null>(AFTER_REFUSAL),
      arbitrationBusy: signal(true),
    })

    const actions = ["refuse", "validate", "back"].map((name) => action(name)?.disabled)

    expect(actions).toEqual([true, true, true])
  })

  it("changes arbitration with the left and right arrows and validates with Enter", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 0 })
    fixture.detectChanges()
    const list = page().querySelector<HTMLElement>("[data-keys]")

    for (const key of ["ArrowRight", "ArrowLeft", "Enter"]) {
      list?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
    }

    expect(service.nextArbitration).toHaveBeenCalledOnce()
    expect(service.previousArbitration).toHaveBeenCalledOnce()
    expect(service.chooseCandidate).toHaveBeenCalledWith("a.mp3", "beatport", 0)
  })

  it("ignores Enter pressed on a button", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 0 })
    fixture.detectChanges()

    action("refuse")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    expect(service.chooseCandidate).not.toHaveBeenCalled()
  })

  it("resets the selection when the current arbitration changes", () => {
    const { fixture, component, service } = mountWith()
    component["choice"].set({ candidate: 1 })
    fixture.detectChanges()

    service.currentArbitration.set(AFTER_REFUSAL)
    fixture.detectChanges()

    expect(component["choice"]().candidate).toBeNull()
  })

  it("shows only the error of the current track", () => {
    const refusal = (trackId: string): SidecarErrorEvent => ({
      event: "error",
      code: "arbitration_busy",
      params: { track_id: trackId },
      message: "a gesture is already in flight for this track",
      command: "resolve_arbitration",
    })
    const { fixture, service } = mountWith({
      lastError: signal<SidecarErrorEvent | null>(refusal("b.mp3")),
      lastErrorCommand: signal<SidecarCommand["command"] | null>("resolve_arbitration"),
    })
    const elsewhere = page().querySelector("app-error-message")

    service.lastError.set(refusal("a.mp3"))
    fixture.detectChanges()

    expect(elsewhere).toBeNull()
    expect(page().querySelector("app-error-message")).not.toBeNull()
  })

  it("dismisses by the cross without any gesture", () => {
    const { fixture, service } = mountWith()
    const dismissed = vi.fn()
    fixture.componentInstance.dismissed.subscribe(dismissed)

    page().querySelector<HTMLButtonElement>('[aria-label="arbitration.close"]')?.click()

    expect(dismissed).toHaveBeenCalledOnce()
    expect(service.chooseCandidate).not.toHaveBeenCalled()
    expect(service.refuseCandidates).not.toHaveBeenCalled()
  })
})
```

`data-action`, `data-title`, `data-release` et `data-keys` sont des points d'accroche de test posés à la Step 4 : ils ne dépendent pas du DOM interne de PrimeNG.

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/features/tagging/arbitration-dialog.component.spec.ts`
Expected: FAIL, le module `./arbitration-dialog.component` est introuvable

- [ ] **Step 4: Créer le composant**

Créer `src/app/features/tagging/arbitration-dialog.component.ts` :

```typescript
import {
  Component,
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
import { Listbox } from "primeng/listbox"
import { Message } from "primeng/message"

import type { CandidatePayload, TrackScores } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"

/** Aucune animation : la decision est sur le chemin critique du run (DESIGN.md § Composants Animes). */
const NO_MOTION = { disabled: true } as const

/** DESIGN.md § Layout : figee, pour que la bascule sur Bandcamp ne deplace aucun bouton. */
const DIALOG_SIZE = { width: "720px", height: "560px" } as const

/** Option de la liste. `index` est la position dans la liste recue : c'est ce que le geste envoie. */
interface CandidateOption {
  readonly index: number
  readonly names: string
  readonly release: string | null
  readonly scores: TrackScores
}

type Gesture = "choose" | "refuse" | "switch"

const namesOf = (artist: string, title: string): string => (artist ? `${artist} - ${title}` : title)

const toOption = (candidate: CandidatePayload, index: number): CandidateOption => {
  const release = [candidate.label, candidate.year].filter((part) => part !== null).join(" · ")

  return {
    index,
    names: namesOf(candidate.artist, candidate.title),
    release: release === "" ? null : release,
    scores: candidate.scores,
  }
}

/**
 * Modale d'arbitrage : affiche ce que le sidecar envoie et ne rend que des gestes.
 * Sa visibilite appartient au shell, qui la suspend a la croix.
 */
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

  protected readonly noMotion = NO_MOTION
  protected readonly dialogSize = DIALOG_SIZE

  readonly visible = input.required<boolean>()
  readonly dismissed = output()

  private readonly listHost = viewChild("list", { read: ElementRef })

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
    if (row === null) {
      return this.current()?.track_id ?? ""
    }

    return row.artist && row.title ? namesOf(row.artist, row.title) : row.fileName
  })
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

  /** Porte le `[loading]` du bouton qui attend sa reponse. */
  protected readonly lastGesture = signal<Gesture | null>(null)

  constructor() {
    // Un bouton grise pendant l'attente perd le focus : sans ce rappel, les fleches ne
    // repondraient plus au changement d'arbitrage suivant qu'apres un clic.
    afterRenderEffect(() => {
      this.shownList()
      const host = this.listHost()?.nativeElement as HTMLElement | undefined
      host?.querySelector<HTMLElement>('[role="listbox"]')?.focus()
    })
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.dismissed.emit()
    }
  }

  protected validate(): void {
    const shown = this.current()
    const index = this.choice().candidate
    if (shown === null || index === null || this.busy()) {
      return
    }
    this.lastGesture.set("choose")
    void this.sidecar.chooseCandidate(shown.track_id, shown.source, index)
  }

  protected refuse(): void {
    const shown = this.current()
    if (shown === null || this.busy()) {
      return
    }
    this.lastGesture.set("refuse")
    void this.sidecar.refuseCandidates(shown.track_id, shown.source)
  }

  protected goBack(): void {
    const shown = this.current()
    if (shown === null || shown.other_source === null || this.busy()) {
      return
    }
    this.lastGesture.set("switch")
    void this.sidecar.showArbitrationSource(shown.track_id, shown.other_source)
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
}
```

- [ ] **Step 5: Écrire le template**

Créer `src/app/features/tagging/arbitration-dialog.component.html` :

```html
<p-dialog
  [visible]="visible() && current() !== null"
  (visibleChange)="onVisibleChange($event)"
  [modal]="true"
  [draggable]="false"
  [resizable]="false"
  [closable]="true"
  [closeOnEscape]="true"
  [motionOptions]="noMotion"
  [maskMotionOptions]="noMotion"
  [style]="dialogSize"
  [closeAriaLabel]="'arbitration.close' | translate"
>
  <ng-template #header>
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-lg font-semibold" data-title>{{ title() }}</span>
        @if (track(); as row) {
          <span class="truncate text-xs text-muted-color">{{ row.fileName }}</span>
        }
      </div>
      @if (current(); as shown) {
        <app-source-logo [source]="shown.source" [size]="20" />
      }
    </div>
  </ng-template>

  @if (current(); as shown) {
    <div class="flex h-full flex-col gap-3" data-keys (keydown)="onKeydown($event)">
      @if (shown.beatport_unavailable) {
        <p-message severity="warn" size="small">
          {{ "arbitration.beatportUnavailable" | translate }}
        </p-message>
      } @else if (shown.other_source === "beatport") {
        <p-message severity="info" size="small">
          {{ "arbitration.switched" | translate }}
          <button
            pButton
            type="button"
            [link]="true"
            class="p-0"
            data-action="back"
            [disabled]="busy()"
            (click)="goBack()"
          >
            {{ "arbitration.backToBeatport" | translate }}
          </button>
        </p-message>
      } @else {
        <p class="text-xs text-muted-color">
          {{ "arbitration.inGreyZone" | translate: { count: options().length } }}
        </p>
      }

      <div #list>
        <p-listbox
          [formField]="fields.candidate"
          [options]="options()"
          optionValue="index"
          [selectOnFocus]="true"
          [readonly]="busy()"
          scrollHeight="268px"
          [emptyMessage]="emptyMessage() | translate"
          [ariaLabel]="'arbitration.candidates' | translate"
        >
          <ng-template #item let-option>
            <div class="flex w-full min-w-0 items-center gap-3">
              <div class="flex min-w-0 flex-1 flex-col">
                <app-truncated-text class="text-sm" [text]="option.names" />
                @if (option.release; as release) {
                  <app-truncated-text
                    class="text-xs text-muted-color"
                    data-release
                    [text]="release"
                  />
                }
              </div>
              <span class="shrink-0 text-xs text-muted-color tabular-nums">
                {{
                  (option.scores.artist === null ? "arbitration.scoreTitleOnly" : "arbitration.score")
                    | translate: option.scores
                }}
              </span>
            </div>
          </ng-template>
        </p-listbox>
      </div>

      @if (error(); as refused) {
        <app-error-message [error]="refused" />
      }

      <p class="text-xs text-muted-color">{{ "arbitration.help" | translate }}</p>
    </div>
  }

  <ng-template #footer>
    <div class="flex w-full items-center gap-2" (keydown)="onKeydown($event)">
      <button
        pButton
        type="button"
        size="small"
        [outlined]="true"
        severity="secondary"
        [disabled]="!hasPrevious()"
        [attr.aria-label]="'arbitration.previous' | translate"
        (click)="previous()"
      >
        <app-icon name="chevron-left" [size]="16" />
      </button>
      <p-badge class="tabular-nums" severity="secondary" [value]="position() + '/' + count()" />
      <button
        pButton
        type="button"
        size="small"
        [outlined]="true"
        severity="secondary"
        [disabled]="!hasNext()"
        [attr.aria-label]="'arbitration.next' | translate"
        (click)="next()"
      >
        <app-icon name="chevron-right" [size]="16" />
      </button>
      <span class="flex-1"></span>
      <button
        pButton
        type="button"
        size="small"
        [outlined]="true"
        severity="secondary"
        data-action="refuse"
        [disabled]="busy()"
        [loading]="busy() && lastGesture() === 'refuse'"
        (click)="refuse()"
      >
        {{ (empty() ? "arbitration.pass" : "arbitration.refuse") | translate }}
      </button>
      <button
        pButton
        type="button"
        size="small"
        data-action="validate"
        [disabled]="busy() || empty() || choice().candidate === null"
        [loading]="busy() && lastGesture() === 'choose'"
        (click)="validate()"
      >
        {{ "arbitration.validate" | translate }}
      </button>
    </div>
  </ng-template>
</p-dialog>
```

`[style]` ici est l'input `style` du `p-dialog`, pas un binding DOM : c'est l'API PrimeNG pour dimensionner la fenêtre, et les valeurs sont celles du tableau de DESIGN.md § Layout. Contrôler l'écran contre la maquette `ArbitrationDialog` (règle `.claude/rules/design/claude-design.md`) : en-tête, bandeau, liste figée, pied ancré.

- [ ] **Step 6: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/features/tagging/arbitration-dialog.component.spec.ts`
Expected: PASS

- [ ] **Step 7: Gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

- [ ] **Step 8: Commit**

```bash
git add src/app/features/tagging/arbitration-dialog.component.ts src/app/features/tagging/arbitration-dialog.component.html src/app/features/tagging/arbitration-dialog.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): modale d'arbitrage"
```

---

## Task 2: Montage dans le shell, visibilité et badge de file

**Files:**
- Modify: `src/app/app.component.ts`
- Modify: `src/app/app.component.html`
- Test: `src/app/app.component.spec.ts`

**Interfaces:**
- Consumes: `ArbitrationDialogComponent` (Task 1), `SidecarService.arbitrationCount` (sub-project 03).
- Produces: `AppComponent.arbitrationVisible` (signal protégé), `dismissArbitration()`, `reopenArbitration()`.

- [ ] **Step 1: Écrire les tests de visibilité**

Créer `src/app/app.component.spec.ts` :

```typescript
import { Component, input, output, signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"

import { AppComponent } from "./app.component"
import { SidecarService } from "./core/sidecar.service"
import { ArbitrationDialogComponent } from "./features/tagging/arbitration-dialog.component"

/** La modale elle-meme a ses tests : ici, seule sa visibilite compte. */
@Component({ selector: "app-arbitration-dialog", template: "" })
class DialogStub {
  readonly visible = input.required<boolean>()
  readonly dismissed = output()
}

const mount = () => {
  const service = {
    available: signal<boolean | null>(true),
    versionMismatch: signal(null),
    arbitrationCount: signal(0),
  }
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      provideRouter([]),
      provideTranslateService(),
      // `p-toast` du shell l'injecte ; l'application le fournit a la racine (app.config.ts).
      MessageService,
      { provide: SidecarService, useValue: service },
    ],
  })
  TestBed.overrideComponent(AppComponent, {
    remove: { imports: [ArbitrationDialogComponent] },
    add: { imports: [DialogStub] },
  })
  const fixture = TestBed.createComponent(AppComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

const badge = (root: HTMLElement): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>("[data-arbitration-badge]")

describe("AppComponent", () => {
  it("opens the arbitration dialog as soon as the queue fills", () => {
    const { component, service } = mount()
    const before = component["arbitrationVisible"]()

    service.arbitrationCount.set(1)

    expect(before).toBe(false)
    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("keeps it closed after the cross until the queue badge is clicked", () => {
    const { fixture, component, service } = mount()
    service.arbitrationCount.set(1)
    component["dismissArbitration"]()
    service.arbitrationCount.set(2)
    fixture.detectChanges()
    const suspended = component["arbitrationVisible"]()
    const label = badge(fixture.nativeElement as HTMLElement)?.textContent

    badge(fixture.nativeElement as HTMLElement)?.click()

    expect(suspended).toBe(false)
    expect(label).toContain("arbitration.badge")
    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("opens it again once the queue has emptied and filled again", () => {
    const { component, service } = mount()
    service.arbitrationCount.set(1)
    component["dismissArbitration"]()
    service.arbitrationCount.set(0)

    service.arbitrationCount.set(1)

    expect(component["arbitrationVisible"]()).toBe(true)
  })

  it("hides the queue badge on an empty queue", () => {
    const { fixture } = mount()

    const found = badge(fixture.nativeElement as HTMLElement)

    expect(found).toBeNull()
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/app.component.spec.ts`
Expected: FAIL, `arbitrationVisible` n'existe pas encore sur `AppComponent`

- [ ] **Step 3: Tenir la visibilité dans le shell**

Dans `src/app/app.component.ts` :

1. Ajouter `linkedSignal` à l'import de `@angular/core`, `Tag` depuis `primeng/tag`, `ArbitrationDialogComponent` depuis `./features/tagging/arbitration-dialog.component` et `IconComponent` depuis `./shared/components/icon.component`, puis les trois dans `imports` du décorateur.

2. Après `blockedParams`, ajouter :

```typescript
  protected readonly arbitrationCount = this.sidecar.arbitrationCount
  private readonly queueEmpty = computed(() => this.sidecar.arbitrationCount() === 0)
  /**
   * La croix suspend l'ouverture automatique jusqu'au clic sur le badge (decision du
   * 2026-09-26). La suspension repart de zero des que la file se vide ou se remplit :
   * le run suivant rouvre la modale de lui-meme.
   */
  private readonly arbitrationDismissed = linkedSignal({
    source: this.queueEmpty,
    computation: () => false,
  })
  protected readonly arbitrationVisible = computed(
    () => !this.queueEmpty() && !this.arbitrationDismissed(),
  )
```

3. Après `navigate`, ajouter :

```typescript
  protected dismissArbitration(): void {
    this.arbitrationDismissed.set(true)
  }

  protected reopenArbitration(): void {
    this.arbitrationDismissed.set(false)
  }
```

- [ ] **Step 4: Monter la modale et le badge**

Dans `src/app/app.component.html`, remplacer le bloc `<p-tabs>` et ajouter la modale après `</main>`, dans la branche `@else` :

```html
  <p-tabs [value]="activeTab()" (valueChange)="navigate($event)">
    <p-tablist>
      @for (tab of tabs; track tab) {
        <p-tab [value]="tab">{{ "nav." + tab | translate }}</p-tab>
      }
      <!-- Seul chemin de retour vers la modale apres la croix (decision du 2026-09-26). -->
      @if (arbitrationCount() > 0) {
        <button
          type="button"
          class="ml-auto self-center"
          data-arbitration-badge
          [attr.aria-label]="'arbitration.reopen' | translate"
          (click)="reopenArbitration()"
        >
          <p-tag severity="info">
            <app-icon name="info-circle" [size]="16" />
            {{ "arbitration.badge" | translate: { count: arbitrationCount() } }}
          </p-tag>
        </button>
      }
    </p-tablist>
  </p-tabs>

  <!-- Le layout est ici, une fois pour les trois onglets : une page ne pose que son contenu. -->
  <main class="flex min-h-0 flex-1 flex-col px-16 py-8">
    <router-outlet />
  </main>

  <!-- Hors du router-outlet : la modale suit l'utilisateur sur tous les onglets. -->
  <app-arbitration-dialog [visible]="arbitrationVisible()" (dismissed)="dismissArbitration()" />
```

Contrôler la barre d'onglets contre la maquette `AppShell` : badge aligné à droite, à la hauteur des onglets, sans décaler la barre active.

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/app.component.spec.ts --include=src/app/features/tagging/arbitration-dialog.component.spec.ts`
Expected: PASS

- [ ] **Step 6: Gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add src/app/app.component.ts src/app/app.component.html src/app/app.component.spec.ts
git commit -m "feat(ui): ouvrir la modale d'arbitrage depuis le shell"
```

---

## Task 3: Docs de design

**Files:**
- Modify: `docs/DESIGN.md`
- Modify: `.design-sync/NOTES.md`

Charger `Skill[design-doc]` avant toute édition de DESIGN.md : le gabarit porte la structure et le style attendus (`~/.claude/CLAUDE.md` § Agents, Commandes & Skills).

- [ ] **Step 1: Mapping**

Dans `docs/DESIGN.md` § Mapping Composants > Arbitrage, remplacer la ligne « Modale d'arbitrage » par :

```markdown
| Modale d'arbitrage | `p-dialog` modal, largeur et hauteur figées | PrimeNG | S'ouvre dès qu'un morceau entre en zone grise, depuis n'importe quel onglet. La croix ne décide rien : l'arbitrage reste en file et l'ouverture automatique est suspendue jusqu'au badge de file. Dimensions fixes, cf. § Layout |
```

et ajouter, après la ligne « Refus explicite » :

```markdown
| Badge de file | bouton portant un `p-tag` `info`, icône `info-circle` | PrimeNG | « N à arbitrer », aligné à droite de la barre d'onglets tant que la file n'est pas vide. Rouvre la modale après la croix |
| Beatport injoignable | `p-message` `warn` | PrimeNG | Au-dessus de la liste Bandcamp quand Beatport n'a pas répondu : aucun candidat n'a été validé seul |
| Liste Bandcamp vide | message de liste + bouton « Passer » | PrimeNG | Le message dit le motif de Bandcamp ; « Passer » remplace « Aucune correspondance » et c'est la seule action |
| Refus d'un geste | `app-error-message` sous la liste | Custom | Seulement pour le morceau affiché |
```

- [ ] **Step 2: Arbitrages**

Dans `docs/DESIGN.md` § Maquette et design system externes > Arbitrages, ajouter :

```markdown
- **Candidat d'arbitrage** : « Artiste - Titre » du candidat et score sur une ligne « 94 (A 96 · T 92) », là où la maquette ne montre que le titre et « A · T ». C'est souvent l'artiste qui fait tomber un candidat en zone grise. Décidé le 2026-09-26
- **Croix de la modale d'arbitrage** : l'arbitrage reste en file et la modale ne revient que par le badge de file, là où la maquette le retirait de la file. Décidé le 2026-09-26
```

- [ ] **Step 3: Reste ouvert**

Dans `.design-sync/NOTES.md` § Reste ouvert, ajouter :

```markdown
- **Modale d'arbitrage (Feature 3, 2026-09-26)**, à pousser dans `ArbitrationDialog` et `AppShell` : la croix garde l'arbitrage en file ; le tag « N à arbitrer » de la barre d'onglets est cliquable et rouvre la modale ; boutons en attente (`loading`) pendant un geste ; message warn quand Beatport n'a pas répondu ; liste Bandcamp vide avec son motif et l'action « Passer » ; « Artiste - Titre » et score « 94 (A 96 · T 92) » par candidat ; ligne d'aide sans les seuils, que l'interface ne connaît pas avant les Réglages.
```

- [ ] **Step 4: Commit**

```bash
git add docs/DESIGN.md .design-sync/NOTES.md
git commit -m "docs: modale d'arbitrage, badge de file et ecarts a la maquette"
```
