# Onglet Tagging : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer l'écran de l'onglet Tagging, du choix du dossier à la fin de la phase réseau.

**Architecture:** Un service partagé `CompletionSignalService` joue deux notes en Web Audio puis affiche un toast, branché sur la fin de la phase réseau et sur la fin de l'extraction. La page de l'onglet compose le sélecteur de dossier, le bouton de lancement, la barre de progression, la liste du run et les messages d'erreur, sans rien calculer : tout vient des signaux du service sidecar.

**Tech Stack:** Angular 22 (signals, `effect`), PrimeNG 22 (`p-toast`, `MessageService`, `pButton`, `pTooltip`), plugin Tauri `dialog` (le `store` passe par `core/preferences.ts`), Web Audio API, ngx-translate 18, Vitest.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/10-onglet-tagging-page-design.md`

## Global Constraints

- **Dépend des sub-projects 05, 08 et 09** : `apiKeyConfigured`, `startTagging(folder, thresholds?)`, `taggingTracks`, `taggingProgress`, `tagging`, `taggingFinished`, `RunListComponent`.
- **Le signal de fin ne se déclenche qu'une fois par run**, sur la transition de fin de phase, jamais sur un rendu (BRAINSTORM : une seule fois, à la fin de la phase réseau, jamais par arbitrage).
- **Son conditionné par la préférence** « signal sonore », lue dans le store Tauri, `true` par défaut, sur le modèle de `readExtractionMode`. Hors Tauri, le défaut s'applique sans lever.
- **Toast toujours affiché**, même son coupé : il n'interrompt rien.
- **Aucun fichier audio dans le dépôt** : deux notes courtes en Web Audio, et un contexte indisponible ne fait jamais échouer l'annonce.
- **Lancement désactivé** sans dossier, sans clé, pendant un run ou tant que le sidecar n'est pas prêt, avec un tooltip qui nomme ce qui manque.
- **La page ne calcule rien** : lignes, états et compteurs viennent du sidecar. Le container et les marges viennent du shell, la page ne défile jamais.
- **i18n** : FR et EN dans le même commit, vouvoiement pour les phrases, infinitif pour les actions, espace insécable (`\u00a0`) avant `:` en français.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scope `ui`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/completion-signal.service.ts` | Bip Web Audio, préférence sonore, toast de fin. |
| `src/app/core/preferences.ts` | Préférence du signal sonore et dernière destination d'extraction. |
| `src/app/app.component.html` | `p-toast` du shell, partagé par les deux onglets. |
| `src/app/app.config.ts` | `MessageService` fourni à la racine, là où un service `providedIn: 'root'` peut le voir. |
| `src/app/features/tagging/tagging-page.component.{ts,html}` | Écran de l'onglet Tagging. |
| `src/app/shared/components/icon.component.ts` | Icône `play` ajoutée à la liste fermée. |
| `src/app/features/playlist/playlist-page.component.ts` | Annonce de fin d'extraction. |
| `public/i18n/{fr,en}.json` | Libellés de l'écran et messages de fin. |
| `docs/BRAINSTORM.md`, `.design-sync/NOTES.md` | Extension de la Feature 1, écarts à la maquette. |

---

## Task 1: Signal de fin partagé

**Files:**
- Create: `src/app/core/completion-signal.service.ts`
- Create: `src/app/core/completion-signal.service.spec.ts`
- Modify: `src/app/core/preferences.ts`
- Modify: `src/app/app.config.ts`, `src/app/app.component.ts`, `src/app/app.component.html`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Produces:
  - `readSoundSignal(): Promise<boolean>`, `writeSoundSignal(enabled: boolean): Promise<void>` (`preferences.ts`)
  - `CompletionSignalService.announce(messageKey: string): void`

- [ ] **Step 1: Écrire les tests du service**

Créer `src/app/core/completion-signal.service.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"

import { CompletionSignalService } from "./completion-signal.service"
import * as preferences from "./preferences"

/**
 * Web Audio n'existe pas sous Vitest : le contexte est mocke pour verifier qu'un
 * son est bien demande, sans rien jouer.
 */
class FakeOscillator {
  started = false
  readonly frequency = { value: 0 }

  connect(): void {}
  start(): void {
    this.started = true
  }
  stop(): void {}
}

class FakeAudioContext {
  static readonly oscillators: FakeOscillator[] = []
  readonly currentTime = 0
  readonly destination = {}

  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator()
    FakeAudioContext.oscillators.push(oscillator)

    return oscillator
  }

  createGain() {
    return { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

describe("CompletionSignalService", () => {
  let service: CompletionSignalService
  let messages: MessageService

  beforeEach(() => {
    FakeAudioContext.oscillators.length = 0
    vi.stubGlobal("AudioContext", FakeAudioContext)
    TestBed.configureTestingModule({ providers: [provideTranslateService(), MessageService] })
    service = TestBed.inject(CompletionSignalService)
    messages = TestBed.inject(MessageService)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("plays a sound and shows a toast when a phase ends", async () => {
    vi.spyOn(preferences, "readSoundSignal").mockResolvedValue(true)
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(FakeAudioContext.oscillators.some((oscillator) => oscillator.started)).toBe(true)
    expect(add).toHaveBeenCalled()
  })

  it("stays silent when the sound preference is off but still shows the toast", async () => {
    vi.spyOn(preferences, "readSoundSignal").mockResolvedValue(false)
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(FakeAudioContext.oscillators).toEqual([])
    expect(add).toHaveBeenCalled()
  })

  it("shows the toast even when the audio context is unavailable", async () => {
    vi.spyOn(preferences, "readSoundSignal").mockResolvedValue(true)
    vi.stubGlobal("AudioContext", undefined)
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.finished")

    expect(add).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/core/completion-signal.service.spec.ts`
Expected: FAIL, `Failed to resolve import "./completion-signal.service"`

- [ ] **Step 3: Ajouter la préférence sonore**

Dans `src/app/core/preferences.ts`, après le mode d'extraction :

```typescript
const SOUND_SIGNAL_KEY = "sound_signal"

/** Le signal sonore est actif par defaut : BRAINSTORM le decrit comme desactivable. */
export const DEFAULT_SOUND_SIGNAL = true

export const readSoundSignal = async (): Promise<boolean> => {
  try {
    const store = await load(STORE_FILE)
    const stored = await store.get<boolean>(SOUND_SIGNAL_KEY)

    return stored ?? DEFAULT_SOUND_SIGNAL
  } catch {
    return DEFAULT_SOUND_SIGNAL
  }
}

/** Ecrit par les Reglages (Feature 7) ; une preference non enregistree n'est pas une panne. */
export const writeSoundSignal = async (enabled: boolean): Promise<void> => {
  try {
    const store = await load(STORE_FILE)
    await store.set(SOUND_SIGNAL_KEY, enabled)
    await store.save()
  } catch {
    return
  }
}
```

- [ ] **Step 4: Implémenter le service**

Créer `src/app/core/completion-signal.service.ts` :

```typescript
import { Injectable, inject } from "@angular/core"
import { TranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"

import { readSoundSignal } from "./preferences"

/** Deux notes courtes : une fin de phase s'entend sans couvrir ce qui se passe a l'ecran. */
const NOTES = [880, 1174.66] as const
const NOTE_SECONDS = 0.12
const PEAK_GAIN = 0.15

/**
 * Signal de fin d'une phase longue : un son, puis un toast. Partage par la fin de
 * la phase reseau d'un run et par la fin d'une extraction, qui n'en avait aucun.
 *
 * Aucun fichier audio dans le depot : pas de binaire a relire en diff, pas de
 * licence a suivre. Remplacer le bip par un fichier ne toucherait que ce service.
 */
@Injectable({ providedIn: "root" })
export class CompletionSignalService {
  private readonly messages = inject(MessageService)
  private readonly translate = inject(TranslateService)

  async announce(messageKey: string): Promise<void> {
    if (await readSoundSignal()) {
      this.beep()
    }
    this.messages.add({
      severity: "success",
      summary: this.translate.instant(messageKey) as string,
      life: 4000,
    })
  }

  /** Un contexte refuse par la webview ne doit jamais empecher le toast. */
  private beep(): void {
    const Context = globalThis.AudioContext
    if (Context === undefined) {
      return
    }
    try {
      const context = new Context()
      NOTES.forEach((frequency, index) => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = frequency
        oscillator.connect(gain)
        gain.connect(context.destination)
        const start = context.currentTime + index * NOTE_SECONDS
        gain.gain.setValueAtTime(PEAK_GAIN, start)
        gain.gain.linearRampToValueAtTime(0, start + NOTE_SECONDS)
        oscillator.start(start)
        oscillator.stop(start + NOTE_SECONDS)
      })
      void context.close()
    } catch {
      return
    }
  }
}
```

- [ ] **Step 5: Poser le toast dans le shell**

Dans `src/app/app.config.ts`, ajouter `MessageService` (de `primeng/api`) aux `providers` de `appConfig` : `CompletionSignalService` est `providedIn: 'root'`, un provider posé sur `AppComponent` lui serait invisible et lèverait `NullInjectorError`. Dans `src/app/app.component.ts`, ajouter `Toast` de `primeng/toast` aux `imports`. Dans `src/app/app.component.html`, ajouter à la fin, hors du bloc conditionnel de l'écran bloquant :

```html
<p-toast position="bottom-right" />
```

- [ ] **Step 6: Ajouter les messages de fin**

Dans `public/i18n/fr.json` :

```json
  "tagging": {
    "finished": "Phase réseau terminée"
  }
```

(à fusionner avec le bloc `tagging` existant), et sous `playlist` :

```json
    "finished": "Extraction terminée"
```

Dans `public/i18n/en.json`, `"Network phase complete"` et `"Extraction complete"`.

- [ ] **Step 7: Vérifier que les tests passent**

Run: `pnpm test --run src/app/core/completion-signal.service.spec.ts src/app/core/translations.spec.ts`
Expected: PASS, 3 tests plus la cohérence des deux fichiers de langue

- [ ] **Step 8: Commit**

```bash
git add src/app/core/completion-signal.service.ts src/app/core/completion-signal.service.spec.ts src/app/core/preferences.ts src/app/app.config.ts src/app/app.component.ts src/app/app.component.html public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): signal sonore et toast de fin de phase"
```

---

## Task 2: Écran de l'onglet Tagging

**Files:**
- Modify: `src/app/features/tagging/tagging-page.component.ts`, `.html` (remplacent le stub)
- Create: `src/app/features/tagging/tagging-page.component.spec.ts`
- Modify: `src/app/core/preferences.ts` (dernière destination d'extraction)
- Modify: `src/app/features/playlist/playlist-page.component.ts` (mémorisation de la destination)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `src/app/shared/components/icon.component.ts` (icône `play`)

**Interfaces:**
- Consumes: `SidecarService` (`apiKeyConfigured`, `startTagging`, `taggingTracks`, `taggingProgress`, `tagging`, `taggingFinished`, `ready`, `lastError`), `RunListComponent`, `PathPickerComponent`, `PhaseProgressComponent`, `EmptyStateComponent`, `ErrorMessageComponent`, `CompletionSignalService`
- Produces: `readLastDestination()`, `writeLastDestination(folder)` (`preferences.ts`), `TaggingPageComponent`

- [ ] **Step 0: Lire la maquette**

Lire `.design-sync/design-system/ui_kits/techno-tagger/TaggingScreen.jsx`, composant `TaggingScreen` dans ses phases `idle` et `running`, et `AppShell.jsx` pour l'onglet. Reprendre la structure de l'en-tête (titre, chemin à droite tronqué par la gauche, bouton de lancement), jamais les paddings de page, portés par le shell.

- [ ] **Step 1: Écrire les tests de l'écran**

Créer `src/app/features/tagging/tagging-page.component.spec.ts` :

```typescript
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { open } from "@tauri-apps/plugin-dialog"

import { CompletionSignalService } from "../../core/completion-signal.service"
import { SidecarService } from "../../core/sidecar.service"

import TaggingPageComponent from "./tagging-page.component"

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("D:/Sets/Aout")),
}))

vi.mock("../../core/preferences", () => ({
  readLastDestination: vi.fn(() => Promise.resolve("D:/Sets/Aout")),
  writeLastDestination: vi.fn(() => Promise.resolve()),
}))

/**
 * Ce qui se teste ici est la disponibilite du lancement, la commande emise et le
 * declenchement unique du signal : le reste de l'ecran affiche ce qu'il recoit.
 */
function mountWith(overrides: Partial<Record<string, unknown>> = {}) {
  const service = {
    ready: signal(true),
    available: signal(true),
    apiKeyConfigured: signal(true),
    tagging: signal(false),
    taggingTracks: signal([]),
    taggingProgress: signal(null),
    taggingFinished: signal(null),
    lastError: signal(null),
    startTagging: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
  const announce = { announce: vi.fn(() => Promise.resolve()) }

  TestBed.configureTestingModule({
    imports: [TaggingPageComponent],
    providers: [
      provideTranslateService(),
      { provide: SidecarService, useValue: service },
      { provide: CompletionSignalService, useValue: announce },
    ],
  })

  const fixture = TestBed.createComponent(TaggingPageComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service, announce }
}

describe("TaggingPageComponent", () => {
  it("prefills the folder with the destination of the last extraction", async () => {
    const { component, fixture } = mountWith()

    await fixture.whenStable()

    expect(component["folder"]()).toBe("D:/Sets/Aout")
  })

  it.each([
    ["without a folder", { folder: "" }],
    ["without an api key", { apiKeyConfigured: signal(false) }],
    ["during a run", { tagging: signal(true) }],
  ])("disables the launch %s", (_name, overrides) => {
    const folder = "folder" in overrides ? (overrides.folder as string) : "D:/Sets/Aout"
    const { component } = mountWith(
      "folder" in overrides ? {} : (overrides as Record<string, unknown>),
    )
    component["folder"].set(folder)

    const enabled = component["canStart"]()

    expect(enabled).toBe(false)
  })

  it("sends the start tagging command with the chosen folder", async () => {
    const { component, service } = mountWith()
    component["folder"].set("D:/Sets/Aout")

    await component["start"]()

    expect(service.startTagging).toHaveBeenCalledWith("D:/Sets/Aout")
  })

  it("announces the end of the network phase only once", () => {
    const finished = signal<{ resolved: number } | null>(null)
    const { fixture, announce } = mountWith({ taggingFinished: finished })

    finished.set({ resolved: 1 })
    fixture.detectChanges()
    fixture.detectChanges()

    expect(announce.announce).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/features/tagging/tagging-page.component.spec.ts`
Expected: FAIL, `component.canStart is not a function`

- [ ] **Step 2b: Ajouter l'icône `play`**

Le bouton de lancement de la maquette porte `play`, absent de la liste fermée. Dans `src/app/shared/components/icon.component.ts` : importer `Play` depuis `@primeicons/angular/play`, l'ajouter aux `imports` du composant, ajouter `"play"` à `ICON_NAMES` et le `@case` correspondant, sur le modèle de `clock` ajouté au sub-project 09 :

```html
      @case ("play") {
        <svg data-p-icon="play" [size]="size()" />
      }
```

- [ ] **Step 3: Mémoriser la destination d'extraction**

Dans `src/app/core/preferences.ts` :

```typescript
const LAST_DESTINATION_KEY = "last_destination"

/** Le dossier re-taggue est presque toujours la destination de la derniere extraction. */
export const readLastDestination = async (): Promise<string | null> => {
  try {
    const store = await load(STORE_FILE)

    return (await store.get<string>(LAST_DESTINATION_KEY)) ?? null
  } catch {
    return null
  }
}

export const writeLastDestination = async (folder: string): Promise<void> => {
  try {
    const store = await load(STORE_FILE)
    await store.set(LAST_DESTINATION_KEY, folder)
    await store.save()
  } catch {
    return
  }
}
```

Dans `src/app/features/playlist/playlist-page.component.ts`, appeler `void writeLastDestination(destination)` dans `extract()`, juste avant l'envoi de la commande d'extraction. Pas dans `persistMode()` : celle-ci répond au `(onChange)` du sélecteur de mode, bien avant tout lancement.

- [ ] **Step 4: Implémenter l'écran**

Remplacer `src/app/features/tagging/tagging-page.component.ts` :

```typescript
import { Component, computed, effect, inject, signal } from "@angular/core"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { open } from "@tauri-apps/plugin-dialog"
import { ButtonDirective } from "primeng/button"
import { Tooltip } from "primeng/tooltip"

import { CompletionSignalService } from "../../core/completion-signal.service"
import { readLastDestination } from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { PathPickerComponent } from "../../shared/components/path-picker.component"
import { PhaseProgressComponent } from "../../shared/components/phase-progress.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { TOOLTIP_DELAY } from "../../shared/utils/tooltip"

import { RunListComponent } from "./run-list.component"

/** Erreurs que ce seul ecran peut produire ou doit expliquer. */
const RUN_ERRORS: ReadonlySet<string> = new Set([
  "api_key_missing",
  "api_key_rejected",
  "tagging_folder_unreadable",
  "tagging_in_progress",
  "sidecar_unavailable",
])

@Component({
  selector: "app-tagging-page",
  imports: [
    TranslatePipe,
    ButtonDirective,
    Tooltip,
    IconComponent,
    PathPickerComponent,
    PhaseProgressComponent,
    RunListComponent,
    EmptyStateComponent,
    ErrorMessageComponent,
    TruncatedTextComponent,
  ],
  templateUrl: "./tagging-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class TaggingPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly completion = inject(CompletionSignalService)
  private readonly translate = inject(TranslateService)

  protected readonly folder = signal("")
  protected readonly tracks = this.sidecar.taggingTracks
  protected readonly progress = this.sidecar.taggingProgress
  protected readonly running = this.sidecar.tagging
  protected readonly tooltipDelay = TOOLTIP_DELAY

  protected readonly canStart = computed(
    () =>
      this.folder() !== "" &&
      this.sidecar.apiKeyConfigured() === true &&
      !this.sidecar.tagging() &&
      this.sidecar.ready() === true,
  )
  /** Le tooltip d'un bouton desactive nomme ce qui manque : seule exception admise. */
  protected readonly blockedReason = computed(() => {
    if (this.sidecar.apiKeyConfigured() !== true) {
      return "tagging.blocked.api_key"
    }

    return this.folder() === "" ? "tagging.blocked.folder" : null
  })
  protected readonly error = computed(() => {
    const error = this.sidecar.lastError()

    return error !== null && RUN_ERRORS.has(error.code) ? error : null
  })
  protected readonly counter = computed(() => {
    const progress = this.progress()

    return progress === null ? undefined : `${progress.processed} / ${progress.total}`
  })
  protected readonly percentage = computed(() => {
    const progress = this.progress()

    return progress === null || progress.total === 0
      ? undefined
      : Math.round((progress.processed / progress.total) * 100)
  })

  constructor() {
    void this.prefill()
    let announced: unknown = null
    // La transition declenche l'annonce, jamais le rendu : un run, un signal.
    effect(() => {
      const finished = this.sidecar.taggingFinished()
      if (finished !== null && finished !== announced) {
        announced = finished
        void this.completion.announce("tagging.finished")
      }
    })
  }

  protected async choose(): Promise<void> {
    const chosen = await open({ directory: true })
    if (typeof chosen === "string") {
      this.folder.set(chosen)
    }
  }

  protected async start(): Promise<void> {
    if (!this.canStart()) {
      return
    }
    await this.sidecar.startTagging(this.folder())
  }

  protected phaseLabel(): string {
    return this.translate.instant("tagging.phase") as string
  }

  private async prefill(): Promise<void> {
    const destination = await readLastDestination()
    if (destination !== null && this.folder() === "") {
      this.folder.set(destination)
    }
  }
}
```

Créer `src/app/features/tagging/tagging-page.component.html` :

```html
<div class="flex h-full min-h-0 flex-col gap-4">
  <div class="flex items-center gap-4">
    <h1 class="text-2xl font-semibold">{{ "tagging.title" | translate }}</h1>
    <app-truncated-text
      class="min-w-0 flex-1 text-sm text-muted-color"
      direction="rtl"
      [text]="folder()"
    />
    <button
      pButton
      type="button"
      [disabled]="!canStart()"
      [pTooltip]="blockedReason() ? (blockedReason()! | translate) : undefined"
      [showDelay]="tooltipDelay"
      (click)="start()"
    >
      <app-icon name="play" [size]="16" />{{ "tagging.start" | translate }}
    </button>
  </div>

  <div class="grid grid-cols-[max-content_max-content_1fr] items-center gap-4">
    <app-path-picker
      [label]="'tagging.folder.label' | translate"
      [buttonLabel]="'tagging.folder.action' | translate"
      [path]="folder()"
      (pick)="choose()"
    >
      <app-icon icon name="folder" [size]="16" />
    </app-path-picker>
  </div>

  @if (error(); as shown) {
    <app-error-message [error]="shown" />
  }

  @if (running()) {
    <app-phase-progress [label]="phaseLabel()" [counter]="counter()" [value]="percentage()" />
  }

  @if (tracks().length > 0) {
    <div class="min-h-0 flex-1">
      <app-run-list [tracks]="tracks()" />
    </div>
  } @else {
    <div class="flex flex-1 items-center justify-center">
      <app-empty-state
        icon="folder"
        [heading]="'tagging.empty.heading' | translate"
        [description]="'tagging.empty.description' | translate"
      />
    </div>
  }
</div>
```

Le tooltip se pose sur le bouton désactivé lui-même, comme sur le bouton d'extraction de l'onglet Playlist. Les codes de `RUN_ERRORS` ont tous leur phrase dans `errors.*` : `tagging_folder_unreadable` (sub-project 01), `api_key_rejected` (02), `api_key_missing` et `tagging_in_progress` (07), `sidecar_unavailable` (existant). Vérifier les entrées réelles de `PathPickerComponent` (`label`, `buttonLabel`, `path`, sortie `pick`) et de `PhaseProgressComponent` (`label`, `counter`, `value`) dans leurs fichiers avant de brancher : elles sont déjà utilisées par l'onglet Playlist, reprendre son usage tel quel.

- [ ] **Step 5: Ajouter les libellés de l'écran**

Dans `public/i18n/fr.json`, sous `"tagging"` :

```json
    "start": "Lancer le run",
    "phase": "Recherche en cours",
    "folder": {
      "label": "Dossier à re-tagger",
      "action": "Choisir un dossier"
    },
    "blocked": {
      "folder": "Choisissez d'abord le dossier à re-tagger.",
      "api_key": "Enregistrez d'abord votre clé API dans les Réglages."
    },
    "empty": {
      "heading": "Aucun run lancé",
      "description": "Choisissez le dossier à re-tagger, puis lancez le run."
    }
```

et dans `public/i18n/en.json` :

```json
    "start": "Start the run",
    "phase": "Searching",
    "folder": {
      "label": "Folder to re-tag",
      "action": "Choose a folder"
    },
    "blocked": {
      "folder": "Choose the folder to re-tag first.",
      "api_key": "Save your API key in the settings first."
    },
    "empty": {
      "heading": "No run yet",
      "description": "Choose the folder to re-tag, then start the run."
    }
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `pnpm test --run src/app/features/tagging/tagging-page.component.spec.ts src/app/core/translations.spec.ts`
Expected: PASS

- [ ] **Step 7: Gate qualité et contrôle visuel**

Run: `just test && just lint && just typecheck`
Expected: tout vert

Puis `just dev` : choisir un dossier de test, lancer un run, comparer l'écran à `TaggingScreen.jsx` en FR et en EN, vérifier que le signal et le toast arrivent une seule fois, et revalider `ROW_HEIGHT` de la liste à 1280 × 800 puis au plancher de 1024 × 700.

- [ ] **Step 8: Commit**

```bash
git add src/app/features/tagging/ src/app/shared/components/icon.component.ts src/app/features/playlist/playlist-page.component.ts src/app/core/preferences.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): ecran de l'onglet Tagging, du dossier a la fin du run"
```

---

## Task 3: Annonce de fin d'extraction et traces

**Files:**
- Modify: `src/app/features/playlist/playlist-page.component.ts`
- Modify: `src/app/features/playlist/playlist-page.component.spec.ts`
- Modify: `docs/BRAINSTORM.md`
- Modify: `.design-sync/NOTES.md`

- [ ] **Step 1: Écrire le test**

Dans `src/app/features/playlist/playlist-page.component.spec.ts`, fournir le service d'annonce dans le `TestBed` (`{ provide: CompletionSignalService, useValue: { announce: vi.fn(() => Promise.resolve()) } }`) et ajouter :

```typescript
  it("announces the end of the extraction", () => {
    const extraction = signal<{ extracted: string[] } | null>(null)
    const { fixture, announce } = mountWith({ extraction })

    extraction.set({ extracted: ["a.mp3"] })
    fixture.detectChanges()
    fixture.detectChanges()

    expect(announce.announce).toHaveBeenCalledTimes(1)
  })
```

Adapter `mountWith` pour rendre le service d'annonce, sur le modèle du spec de l'onglet Tagging.

- [ ] **Step 2: Vérifier que le test échoue**

Run: `pnpm test --run src/app/features/playlist/playlist-page.component.spec.ts`
Expected: FAIL, aucune annonce n'est émise

- [ ] **Step 3: Brancher l'annonce**

Dans `src/app/features/playlist/playlist-page.component.ts`, injecter `CompletionSignalService` et ajouter, dans le constructeur, le même effet de transition que l'onglet Tagging :

```typescript
    let announced: unknown = null
    // Meme mecanique que le run : la transition declenche, jamais le rendu.
    effect(() => {
      const extraction = this.sidecar.extraction()
      if (extraction !== null && extraction !== announced) {
        announced = extraction
        void this.completion.announce("playlist.finished")
      }
    })
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `pnpm test --run src/app/features/playlist/playlist-page.component.spec.ts`
Expected: PASS

- [ ] **Step 5: Consigner l'extension et les écarts**

Dans `docs/BRAINSTORM.md`, sous la Feature 1 :

```markdown
> **Ajouté depuis la Feature 2** (2026-09-20) : la fin d'une extraction annonce elle aussi le signal sonore et un toast, par le service partagé livré avec l'onglet Scraping. La bascule du son reste un réglage de la Feature 7.
```

Dans `.design-sync/NOTES.md` § Reste ouvert :

```markdown
- **Onglet Tagging, choix du dossier** : la maquette n'a pas de sélecteur et renvoie vers l'onglet Playlist ; l'écran livré porte un `PathPicker` prérempli avec la destination de la dernière extraction (2026-09-20), BRAINSTORM demandant une sélection de dossier. À reprendre dans `TaggingScreen.jsx`.
- **Toast de fin** : le toast de `AppShell.jsx` est livré pour les deux onglets, sonore compris, et non pour le seul run.
```

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add src/app/features/playlist/ docs/BRAINSTORM.md .design-sync/NOTES.md
git commit -m "feat(ui): annoncer aussi la fin d'une extraction"
```
