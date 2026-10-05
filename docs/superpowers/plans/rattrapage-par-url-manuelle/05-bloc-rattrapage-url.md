# Bloc de rattrapage par URL : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher sous la liste du run le bloc qui permet de coller une URL par morceau sans correspondance et de suivre la phase de rattrapage.

**Architecture:** Un composant de présentation `UrlRecoveryComponent` (`app-url-recovery`) lit `recoverableTracks`, `urlRecoveryBusy` et `urlRecoveryErrors` de `SidecarService` et en dérive ses lignes dans un `computed()` ; il tient le texte saisi par morceau dans un signal et envoie `resolveByUrl`. La page de tagging le monte sous la liste du run, borné en hauteur, et affiche la barre de la phase dans l'emplacement de celle du run. `ErrorMessageComponent` affiche le paramètre `source` par son nom de marque, `SOURCE_NAMES` passant dans `shared/utils`.

**Tech Stack:** Angular 22 (standalone, signals, contrôle de flux `@if`/`@for`), PrimeNG 22 (`p-inputgroup`, `pInputText`, `pButton`), Tailwind 4, ngx-translate 18, Vitest. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/rattrapage-par-url-manuelle/05-bloc-rattrapage-url-design.md`

## Global Constraints

- **Dépend du sub-project 04, implémenté avant** : sur `SidecarService`, `urlRecoveryOpen: Signal<boolean>`, `urlRecoveryProgress: Signal<RunProgress | null>`, `urlRecoveryBusy: Signal<ReadonlySet<string>>`, `urlRecoveryErrors: Signal<ReadonlyMap<string, SidecarErrorEvent>>`, `recoverableTracks: Signal<readonly TaggingTrack[]>`, `resolveByUrl(trackId, url): Promise<void>` ; fixture `urlRecoveryError(trackId, code?)` dans `src/fixtures/url-recovery.ts`.
- **Références de design** : maquette `ui_kits/techno-tagger/TaggingScreen.jsx` → `UrlRescue` et son montage, `AppShell.jsx` → phase `urlRescue` ; fiches `InputGroup`, `InputText`, `Button`, `PhaseProgress`, `ErrorMessage`, `EmptyState`, `TruncatedText` (`.design-sync/design-system/`) ; `SourceLogo` ne sert qu'à la liste du run, le bloc ne montre aucune source. Lire `UrlRescue` avant d'écrire le template ; `.claude/rules/design/claude-design.md`.
- **Écarts à la maquette, tranchés** : pas de zone hôte ni de bouton grisé tant que l'hôte n'est pas reconnu ; barre de phase dédiée « rattrapés sur à rattraper » dans l'emplacement de la barre du run ; lignes rattrapées conservées dans le bloc ; bloc affiché aussi après une interruption ; pas de bouton « Confirmer l'écriture » (Feature 5), « Lancer le run » reste actif pendant la phase et se bloque seulement pendant un geste en vol (`tagging.blocked.recovering`). Ces écarts se consignent dans DESIGN.md § Arbitrages (Task 4).
- **Aucune logique métier** dans les composants : lignes, source et progression viennent du service.
- **Champ d'URL** : `input pInputText` lié par `[value]` et `(input)` à un signal `ReadonlyMap<trackId, string>`, sans `form()` ; `aria-label` traduit (`tagging.recovery.field`) qui nomme le morceau ; Entrée vaut le clic sur « Résoudre », même garde. La liste des champs est dynamique et il n'y a rien à valider : `form()` ne servirait qu'au binding d'un composant PrimeNG (`.claude/rules/angular/forms.md` § Gotchas), et `pInputText` est une directive posée sur un `<input>` natif.
- **Bouton « Résoudre »** : `button pButton` `[outlined]="true"` `severity="secondary"`, `data-action="resolve-url"`, désactivé si le champ est vide ou la ligne en attente ; spinner enfant `app-icon name="spinner"` pendant l'attente (`[loading]` déprécié en PrimeNG 22).
- **Libellés** : clés `tagging.recovery.*` dans `fr.json` et `en.json` au même commit, vouvoiement, ` ` avant `:` en français. Tokens de couleur et classes Tailwind seulement, aucune largeur en dur sur un bouton ou un libellé.
- **Fonctions** en `const nom = (...) => ...` (ESLint `func-style`).
- **Tests** : `describe`/`it` en anglais, AAA séparé par des lignes vides, service stubbé par un objet de signals (`{ provide: SidecarService, useValue: service }`).
- **Gate vert à chaque commit** : `just lint-ui`, `just typecheck-ui`, `just test-ui`. Commits `type(scope): description`, scope `ui`.

## Review Focus

- **Paramètre `source` inconnu ou absent** dans une erreur : passé tel quel, jamais remplacé par `undefined` (Task 1, `names the source brand in a translated message`, cas `unknown-source`).
- **Texte saisi qui survit à la réponse** : après un succès, le champ garde l'URL collée (Task 2, `keeps the pasted url in its field once the track is recovered`).
- **Erreur d'une autre ligne** : jamais affichée sous la ligne voisine (Task 2, `shows an error under its own line only`).
- **Barre de tagging et barre de phase** : jamais les deux à la fois, la barre du run prime tant qu'il tourne (Task 3, `shows the url recovery progress in place of the run progress`, cas `running`).
- **Phase ouverte sur 0 sur 0** : bloc en état vide, aucune barre (Task 3, `hides the url recovery progress when nothing is left to recover`).
- **Entrée sur un champ vide ou une ligne en attente** : aucun geste ne part (Task 2, `sends the pasted url on enter and ignores enter on an empty field`, cas `empty`).
- **Nouveau run pendant un geste en vol** : lancement bloqué le temps de la réponse (Task 3, `blocks a new run while a url recovery waits`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/shared/utils/sources.ts` | `SOURCE_NAMES`, `brandName`. |
| `src/app/shared/components/error-message.component.ts` (+ `.spec.ts`) | Nom de marque du paramètre `source`. |
| `src/app/features/tagging/run-list.component.ts` | Import de `SOURCE_NAMES`. |
| `src/app/features/tagging/url-recovery.component.ts` / `.html` / `.spec.ts` | Bloc de rattrapage. |
| `src/app/features/tagging/tagging-page.component.ts` / `.html` / `.spec.ts` | Montage borné, barre de phase, lancement bloqué pendant un geste. |
| `public/i18n/fr.json`, `public/i18n/en.json` | `tagging.recovery.*`, `tagging.blocked.recovering`, `errors.track_not_found`. |
| `docs/DESIGN.md` | Mapping « Rattrapage par URL », § Structure de Page, § Arbitrages. |
| `.design-sync/NOTES.md` | § Reste ouvert. |

---

## Task 1: Nom de marque dans les erreurs

**Files:**
- Create: `src/app/shared/utils/sources.ts`
- Modify: `src/app/shared/components/error-message.component.ts`
- Modify: `src/app/features/tagging/run-list.component.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors.track_not_found`)
- Test: `src/app/shared/components/error-message.component.spec.ts`

**Interfaces:**
- Consumes: `TrackSource` (`core/models/protocol.ts`).
- Produces:
  - `SOURCE_NAMES: Record<TrackSource, string>`
  - `brandName(value: unknown): unknown` : nom de marque d'une valeur `TrackSource`, toute autre valeur rendue telle quelle

- [ ] **Step 1: Écrire le test**

Dans `src/app/shared/components/error-message.component.spec.ts`, ajouter dans le `describe` :

```typescript
  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ["known-source", { source: "bandcamp", track_id: "a.mp3" }, { source: "Bandcamp", track_id: "a.mp3" }],
    ["unknown-source", { source: "deezer" }, { source: "deezer" }],
  ])("names the source brand in a translated message (%s)", (_case, params, expected) => {
    TestBed.configureTestingModule({
      imports: [ErrorMessageComponent],
      providers: [provideTranslateService()],
    })
    const fixture = TestBed.createComponent(ErrorMessageComponent)

    fixture.componentRef.setInput("error", {
      event: "error",
      code: "source_unavailable",
      params,
      message: "",
      command: "resolve_by_url",
    })

    expect(fixture.componentInstance["params"]()).toEqual(expected)
  })
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm exec ng test --watch=false --include=src/app/shared/components/error-message.component.spec.ts`
Expected: FAIL sur `known-source`, `source` reçu `"bandcamp"`.

- [ ] **Step 3: Noms de marque partagés**

Créer `src/app/shared/utils/sources.ts` :

```typescript
import type { TrackSource } from "../../core/models/protocol"

/** Noms de marque : identiques dans les deux langues, aucune cle i18n a tenir. */
export const SOURCE_NAMES: Record<TrackSource, string> = {
  beatport: "Beatport",
  bandcamp: "Bandcamp",
  soundcloud: "SoundCloud",
}

const isTrackSource = (value: unknown): value is TrackSource =>
  typeof value === "string" && Object.hasOwn(SOURCE_NAMES, value)

/** Le sidecar envoie la valeur du contrat (`bandcamp`) ; toute autre valeur passe telle quelle. */
export const brandName = (value: unknown): unknown =>
  isTrackSource(value) ? SOURCE_NAMES[value] : value
```

Dans `src/app/features/tagging/run-list.component.ts`, supprimer la constante locale `SOURCE_NAMES` et son commentaire, puis importer `import { SOURCE_NAMES } from "../../shared/utils/sources"`.

- [ ] **Step 4: Appliquer le nom de marque**

Dans `src/app/shared/components/error-message.component.ts`, importer `import { brandName } from "../utils/sources"`, puis remplacer `params` :

```typescript
  /**
   * Une liste est jointe avant l'interpolation, que ngx-translate ecrirait `a,b` ; une
   * source arrive en valeur du contrat et s'affiche par son nom de marque.
   */
  protected readonly params = computed(() =>
    Object.fromEntries(
      Object.entries(this.error().params).map(([key, value]) => [key, displayed(key, value)]),
    ),
  )
```

et, après la classe :

```typescript
const displayed = (key: string, value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.join(", ")
  }

  return key === "source" ? brandName(value) : value
}
```

- [ ] **Step 5: Texte de `track_not_found`**

`errors.track_not_found` ne s'affiche que pour un lien collé. Dans `public/i18n/fr.json` :

```json
    "track_not_found": "Ce lien ne mène à aucun morceau sur {{source}}. Vérifiez l'adresse.",
```

Dans `public/i18n/en.json` :

```json
    "track_not_found": "This link leads to no track on {{source}}. Check the address.",
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/shared/components/error-message.component.spec.ts --include=src/app/features/tagging/run-list.component.spec.ts`
Expected: PASS.

- [ ] **Step 7: Lancer le gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add src/app/shared/utils/sources.ts src/app/shared/components/error-message.component.ts src/app/shared/components/error-message.component.spec.ts src/app/features/tagging/run-list.component.ts public/i18n/fr.json public/i18n/en.json
git commit -m "fix(ui): nommer la source par sa marque dans les messages d'erreur"
```

---

## Task 2: `UrlRecoveryComponent`

**Files:**
- Create: `src/app/features/tagging/url-recovery.component.ts`, `src/app/features/tagging/url-recovery.component.html`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.recovery.*`)
- Test: `src/app/features/tagging/url-recovery.component.spec.ts` (création)

**Interfaces:**
- Consumes: `SidecarService` (sub-project 04) ; `TaggingTrack` ; `SOURCE_NAMES` (Task 1) ; `trackMainLine` (`shared/utils/identity.ts`) ; `EmptyStateComponent`, `ErrorMessageComponent`, `IconComponent`, `TruncatedTextComponent` ; `InputGroup` (`primeng/inputgroup`), `InputText` (`primeng/inputtext`), `ButtonDirective` (`primeng/button`) ; fixtures `PENDING_TRACK` (`src/fixtures/tagging.ts`), `urlRecoveryError` (`src/fixtures/url-recovery.ts`).
- Produces: `UrlRecoveryComponent` (`app-url-recovery`), sans input ni output.

- [ ] **Step 1: Écrire les tests**

Créer `src/app/features/tagging/url-recovery.component.spec.ts` :

```typescript
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"

import { PENDING_TRACK } from "../../../fixtures/tagging"
import { urlRecoveryError } from "../../../fixtures/url-recovery"
import type { SidecarErrorEvent, TrackFailureReason } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { UrlRecoveryComponent } from "./url-recovery.component"

const URL = "https://amelielens.bandcamp.com/track/basiel"

const unresolved = (trackId: string, failureReason: TrackFailureReason): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  fileName: trackId,
  state: "unresolved",
  resolution: "none",
  failureReason,
})

const FIRST = unresolved("a.mp3", "no_result")
const SECOND: TaggingTrack = {
  ...unresolved("b.mp3", "below_threshold"),
  artist: "Amelie Lens",
  title: "Basiel",
}
const TWO_LINES: readonly TaggingTrack[] = [FIRST, SECOND]

const mount = (overrides: Partial<Record<string, unknown>> = {}) => {
  const service = {
    recoverableTracks: signal<readonly TaggingTrack[]>(TWO_LINES),
    urlRecoveryBusy: signal<ReadonlySet<string>>(new Set()),
    urlRecoveryErrors: signal<ReadonlyMap<string, SidecarErrorEvent>>(new Map()),
    resolveByUrl: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
  TestBed.configureTestingModule({
    imports: [UrlRecoveryComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })
  const fixture = TestBed.createComponent(UrlRecoveryComponent)
  fixture.detectChanges()

  return { fixture, service }
}

const lines = (fixture: { nativeElement: unknown }): HTMLElement[] => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>("li"),
]

const resolveButton = (line: HTMLElement | undefined): HTMLButtonElement | null =>
  line?.querySelector<HTMLButtonElement>('[data-action="resolve-url"]') ?? null

const paste = (line: HTMLElement | undefined, url: string): void => {
  const field = line?.querySelector("input")
  if (field) {
    field.value = url
    field.dispatchEvent(new Event("input"))
  }
}

describe("UrlRecoveryComponent", () => {
  it("lists a line per recoverable track with its identity and its reason", () => {
    const { fixture } = mount()

    const shown = lines(fixture)

    expect(shown).toHaveLength(2)
    expect(shown[0]?.textContent).toContain("Adam Beyer - Your Mind")
    expect(shown[0]?.textContent).toContain("tagging.reason.no_result")
    expect(shown[1]?.textContent).toContain("tagging.reason.below_threshold")
  })

  it("names the source of a track already resolved by url", () => {
    const recovered: TaggingTrack = {
      ...PENDING_TRACK,
      state: "resolved",
      resolution: "url",
      source: "soundcloud",
    }
    const { fixture } = mount({ recoverableTracks: signal([recovered]) })
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", { tagging: { recovery: { recovered: "Recovered on {{source}}" } } })
    translate.use("en")

    fixture.detectChanges()

    expect(lines(fixture)[0]?.textContent).toContain("Recovered on SoundCloud")
  })

  it("disables the resolve button on an empty field", () => {
    const { fixture } = mount()

    const button = resolveButton(lines(fixture)[0])

    expect(button?.disabled).toBe(true)
  })

  it("sends the pasted url for its track", () => {
    const { fixture, service } = mount()
    paste(lines(fixture)[0], URL)
    fixture.detectChanges()

    resolveButton(lines(fixture)[0])?.click()

    expect(service.resolveByUrl).toHaveBeenCalledWith("a.mp3", URL)
  })

  it.each<[string, string, number]>([
    ["pasted", URL, 1],
    ["empty", "", 0],
  ])("sends the pasted url on enter and ignores enter on an %s field", (_field, url, calls) => {
    const { fixture, service } = mount()
    paste(lines(fixture)[0], url)
    fixture.detectChanges()

    lines(fixture)[0]?.querySelector("input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))

    expect(service.resolveByUrl).toHaveBeenCalledTimes(calls)
  })

  it("names the track in the field label", () => {
    const { fixture } = mount()
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", { tagging: { recovery: { field: "Link for {{track}}" } } })
    translate.use("en")

    fixture.detectChanges()

    expect(lines(fixture)[0]?.querySelector("input")?.getAttribute("aria-label")).toBe(
      "Link for Adam Beyer - Your Mind",
    )
  })

  it("keeps the pasted url in its field once the track is recovered", () => {
    const { fixture, service } = mount()
    paste(lines(fixture)[0], URL)
    fixture.detectChanges()
    resolveButton(lines(fixture)[0])?.click()

    service.recoverableTracks.set([
      { ...FIRST, state: "resolved", resolution: "url", failureReason: null, source: "bandcamp" },
      SECOND,
    ])
    fixture.detectChanges()

    expect(lines(fixture)[0]?.querySelector("input")?.value).toBe(URL)
  })

  it("shows a spinner and disables the button while the track waits", () => {
    const { fixture } = mount({ urlRecoveryBusy: signal(new Set(["a.mp3"])) })
    paste(lines(fixture)[0], URL)
    fixture.detectChanges()

    const button = resolveButton(lines(fixture)[0])

    expect(button?.disabled).toBe(true)
    expect(button?.querySelector('[data-p-icon="spinner"]')).not.toBeNull()
  })

  it("shows an error under its own line only", () => {
    const { fixture } = mount({
      urlRecoveryErrors: signal(new Map([["b.mp3", urlRecoveryError("b.mp3", "unsupported_url")]])),
    })

    const shown = lines(fixture)

    expect(shown[0]?.querySelector("app-error-message")).toBeNull()
    expect(shown[1]?.querySelector("app-error-message")).not.toBeNull()
  })

  it("shows the empty state when nothing is left to recover", () => {
    const { fixture } = mount({ recoverableTracks: signal([]) })

    const host = fixture.nativeElement as HTMLElement

    expect(host.querySelector("app-empty-state")).not.toBeNull()
    expect(lines(fixture)).toHaveLength(0)
  })
})
```

Si l'icône `spinner` rend un autre attribut que `data-p-icon="spinner"`, aligner le sélecteur sur celui que la modale d'arbitrage teste déjà dans `arbitration-dialog.component.spec.ts`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/features/tagging/url-recovery.component.spec.ts`
Expected: FAIL, module `./url-recovery.component` introuvable.

- [ ] **Step 3: Créer le composant**

Créer `src/app/features/tagging/url-recovery.component.ts` :

```typescript
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

interface RecoveryRow {
  readonly trackId: string
  readonly mainLine: string
  /** Motif d'echec d'un non resolu, ou source d'un morceau deja rattrape. */
  readonly detailKey: string | null
  readonly detailParams: Readonly<Record<string, string>>
  readonly url: string
  readonly busy: boolean
  readonly error: SidecarErrorEvent | null
}

const detail = (track: TaggingTrack): Pick<RecoveryRow, "detailKey" | "detailParams"> => {
  if (track.resolution === "url" && track.source !== null) {
    return { detailKey: "tagging.recovery.recovered", detailParams: { source: SOURCE_NAMES[track.source] } }
  }

  return {
    detailKey: track.failureReason === null ? null : `tagging.reason.${track.failureReason}`,
    detailParams: {},
  }
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
  host: { class: "flex min-h-0 flex-col gap-4 rounded-border border border-surface p-4" },
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
      ...detail(track),
      url: urls.get(track.trackId) ?? "",
      busy: busy.has(track.trackId),
      error: errors.get(track.trackId) ?? null,
    }))
  })
  protected readonly empty = computed(() => this.rows().length === 0)

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
```

Créer `src/app/features/tagging/url-recovery.component.html` :

```html
<header class="flex flex-col gap-1">
  <h2 class="text-xl font-semibold">{{ "tagging.recovery.title" | translate }}</h2>
  <p class="text-sm text-muted-color">{{ "tagging.recovery.help" | translate }}</p>
</header>

@if (empty()) {
  <app-empty-state
    icon="check-circle"
    [heading]="'tagging.recovery.empty.heading' | translate"
    [description]="'tagging.recovery.empty.description' | translate"
  />
} @else {
  <ul class="flex min-h-0 flex-col gap-4 overflow-y-auto">
    @for (row of rows(); track row.trackId) {
      <li class="flex flex-col gap-2">
        <div class="flex items-center gap-4">
          <!-- Largeur d'alignement des lignes : identite et motif se coupent en ellipse,
               le champ prend le reste. Remesurer si le motif passe en tooltip. -->
          <div class="w-72 min-w-0 shrink-0 text-sm">
            <app-truncated-text [text]="row.mainLine" />
            @if (row.detailKey; as key) {
              <app-truncated-text
                class="text-xs text-muted-color"
                [text]="key | translate: row.detailParams"
              />
            }
          </div>
          <p-inputgroup class="min-w-0 flex-1">
            <input
              #field
              pInputText
              type="url"
              [value]="row.url"
              [placeholder]="'tagging.recovery.placeholder' | translate"
              [attr.aria-label]="'tagging.recovery.field' | translate: { track: row.mainLine }"
              (input)="edit(row.trackId, field.value)"
              (keydown.enter)="resolve(row)"
            />
            <button
              pButton
              type="button"
              [outlined]="true"
              severity="secondary"
              data-action="resolve-url"
              [disabled]="row.busy || row.url === ''"
              (click)="resolve(row)"
            >
              <!-- Spinner enfant : `[loading]` de pButton est deprecie depuis PrimeNG 22. -->
              @if (row.busy) {
                <app-icon name="spinner" [size]="16" />
              }
              {{ "tagging.recovery.resolve" | translate }}
            </button>
          </p-inputgroup>
        </div>
        @if (row.error; as refused) {
          <app-error-message [error]="refused" />
        }
      </li>
    }
  </ul>
}
```

Avant de figer la largeur `w-72`, ouvrir `UrlRescue` dans la maquette pour l'alignement et mesurer sur « Ni les tags ni le nom du fichier… » et « Recovered on SoundCloud » : la classe et son commentaire suivent la mesure (arbitrage « Largeurs »).

- [ ] **Step 4: Libellés**

Dans `public/i18n/fr.json`, objet `tagging`, après `list` (virgule ajoutée à la fin de `list`) :

```json
    "recovery": {
      "title": "Rattrapage par URL",
      "help": "Étape facultative : collez l'adresse d'un morceau Beatport, Bandcamp ou SoundCloud.",
      "phase": "Rattrapage par URL",
      "progress": "{{processed}} sur {{total}} rattrapés",
      "placeholder": "https://www.beatport.com/track/…",
      "field": "Lien du morceau {{track}}",
      "resolve": "Résoudre",
      "recovered": "Rattrapé sur {{source}}",
      "empty": {
        "heading": "Aucun morceau à rattraper",
        "description": "Aucun morceau n'est resté sans correspondance."
      }
    }
```

Dans `public/i18n/en.json`, même emplacement :

```json
    "recovery": {
      "title": "Recovery by URL",
      "help": "Optional step: paste the address of a Beatport, Bandcamp or SoundCloud track.",
      "phase": "Recovery by URL",
      "progress": "{{processed}} of {{total}} recovered",
      "placeholder": "https://www.beatport.com/track/…",
      "field": "Link for {{track}}",
      "resolve": "Resolve",
      "recovered": "Recovered on {{source}}",
      "empty": {
        "heading": "No track to recover",
        "description": "Every track found a match."
      }
    }
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/features/tagging/url-recovery.component.spec.ts`
Expected: PASS, tous les tests du fichier. La spec de cohérence des traductions, si elle compare les deux fichiers, passe aussi.

- [ ] **Step 6: Lancer le gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/tagging/url-recovery.component.ts src/app/features/tagging/url-recovery.component.html src/app/features/tagging/url-recovery.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): bloc de rattrapage par URL, une ligne par morceau sans correspondance"
```

---

## Task 3: Montage dans la page et barre de phase

**Files:**
- Modify: `src/app/features/tagging/tagging-page.component.ts`, `src/app/features/tagging/tagging-page.component.html`, `public/i18n/fr.json`, `public/i18n/en.json`
- Test: `src/app/features/tagging/tagging-page.component.spec.ts`

**Interfaces:**
- Consumes: `UrlRecoveryComponent` (Task 2) ; `urlRecoveryOpen`, `urlRecoveryProgress`, `urlRecoveryBusy` (sub-project 04) ; `progressPercentage` (`shared/utils/progress.ts`).
- Produces: aucune interface publique.

- [ ] **Step 1: Écrire les tests**

Dans `src/app/features/tagging/tagging-page.component.spec.ts`, ajouter au stub de `mountWith`, avant `...overrides` :

```typescript
    urlRecoveryOpen: signal(false),
    urlRecoveryProgress: signal<{ processed: number; total: number } | null>(null),
    recoverableTracks: signal([]),
    urlRecoveryBusy: signal(new Set<string>()),
    urlRecoveryErrors: signal(new Map()),
    resolveByUrl: vi.fn(() => Promise.resolve()),
```

puis, dans le `describe` :

```typescript
  const host = (fixture: { nativeElement: unknown }): HTMLElement => fixture.nativeElement as HTMLElement

  it.each<[string, boolean]>([
    ["open", true],
    ["closed", false],
  ])("mounts the url recovery block once the phase is %s", async (_phase, open) => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      urlRecoveryOpen: signal(open),
      urlRecoveryProgress: signal(open ? { processed: 0, total: 2 } : null),
    })

    fixture.detectChanges()

    expect(host(fixture).querySelector("app-url-recovery") !== null).toBe(open)
  })

  it.each<[string, boolean, string]>([
    ["finished", false, "tagging.recovery.phase"],
    ["running", true, "tagging.phase"],
  ])("shows the url recovery progress in place of the run progress (%s)", async (_run, running, label) => {
    const { fixture } = await mountWith({
      tagging: signal(running),
      taggingRunId: signal("a3f9c1"),
      urlRecoveryOpen: signal(true),
      urlRecoveryProgress: signal({ processed: 1, total: 2 }),
    })

    fixture.detectChanges()

    const bars = host(fixture).querySelectorAll("app-phase-progress")
    expect(bars).toHaveLength(1)
    expect(bars[0]?.textContent).toContain(label)
  })

  it("hides the url recovery progress when nothing is left to recover", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      urlRecoveryOpen: signal(true),
      urlRecoveryProgress: signal({ processed: 0, total: 0 }),
    })

    fixture.detectChanges()

    expect(host(fixture).querySelector("app-phase-progress")).toBeNull()
  })

  it("blocks a new run while a url recovery waits", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      urlRecoveryOpen: signal(true),
      urlRecoveryBusy: signal(new Set(["a.mp3"])),
    })

    expect(component["blockedReason"]()).toBe("tagging.blocked.recovering")
  })
```

Le cas `running` arme une phase ouverte pendant un run, ce que le sidecar n'émet jamais : il prouve seulement qu'une seule barre s'affiche et que celle du run prime.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/features/tagging/tagging-page.component.spec.ts`
Expected: FAIL, aucun `app-url-recovery` ni barre `tagging.recovery.phase`, et `blockedReason` rend `null` pendant un geste.

- [ ] **Step 3: Brancher la page**

Dans `src/app/features/tagging/tagging-page.component.ts` : importer `UrlRecoveryComponent` depuis `./url-recovery.component` et l'ajouter aux `imports` du composant, puis après `percentage` :

```typescript
  protected readonly recoveryOpen = this.sidecar.urlRecoveryOpen
  protected readonly recovery = this.sidecar.urlRecoveryProgress
  protected readonly recoveryPercentage = computed(() => progressPercentage(this.recovery()))
```

Dans `blockedReason`, juste après le cas `tagging.blocked.running` : un nouveau run fermerait la phase et couperait l'appel en vol, c'est la seule chose que le lancement protège pendant la phase (spec, décision « Bouton « Lancer le run » pendant la phase »).

```typescript
    if (this.sidecar.urlRecoveryBusy().size > 0) {
      return "tagging.blocked.recovering"
    }
```

Dans `public/i18n/fr.json`, objet `tagging.blocked`, après `running` :

```json
      "recovering": "Attendez la réponse du rattrapage en cours.",
```

Dans `public/i18n/en.json`, même emplacement :

```json
      "recovering": "Wait for the current recovery to answer.",
```

Dans `src/app/features/tagging/tagging-page.component.html`, remplacer le bloc `@if (running()) { ... app-phase-progress ... }` par :

```html
  @if (running()) {
    @let current = progress();
    <app-phase-progress
      [label]="'tagging.phase' | translate"
      [counter]="current ? ('tagging.progress' | translate: current) : undefined"
      [value]="percentage()"
    />
  } @else if (recovery(); as phase) {
    <!-- Une seule phase a la fois : la barre du rattrapage prend la place de celle du run.
         Masquee sur 0 sur 0, l'etat vide du bloc disant deja tout. -->
    @if (phase.total > 0) {
      <app-phase-progress
        [label]="'tagging.recovery.phase' | translate"
        [counter]="'tagging.recovery.progress' | translate: phase"
        [value]="recoveryPercentage()"
      />
    }
  }
```

et, dans `@if (showsRun())`, juste après la `div` `min-h-0 flex-1` qui contient `app-run-list` :

```html
    @if (recoveryOpen()) {
      <!-- Borne : la liste du run garde au moins trois cinquiemes de la page, le bloc
           defile au-dela (DESIGN.md § Structure de Page : la page ne defile jamais). -->
      <app-url-recovery class="max-h-2/5" />
    }
```

Garder les attributs existants de la barre du run à l'identique (seul le `@else if` s'ajoute).

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/features/tagging/tagging-page.component.spec.ts`
Expected: PASS, les tests existants de la page compris.

- [ ] **Step 5: Lancer le gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert. Si Tailwind 4 ne produit pas `max-h-2/5`, utiliser `max-h-[40%]` avec le même commentaire.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/tagging/tagging-page.component.ts src/app/features/tagging/tagging-page.component.html src/app/features/tagging/tagging-page.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): monter le bloc de rattrapage sous la liste du run avec sa barre de phase"
```

---

## Task 4: DESIGN.md et journal de la maquette

**Files:**
- Modify: `docs/DESIGN.md` (§ Mapping Composants > Arbitrage, § Structure de Page, § Maquette et design system externes > Arbitrages)
- Modify: `.design-sync/NOTES.md` (§ Reste ouvert)

**Interfaces:**
- Consumes: le bloc livré par les Tasks 1 à 3.
- Produces: aucune interface de code.

- [ ] **Step 1: DESIGN.md**

Charger `Skill[design-doc]` et lire son template et ses règles, puis dans `docs/DESIGN.md` :

- **§ Mapping Composants > Arbitrage**, ligne « Rattrapage par URL » : la note devient « Une ligne par morceau non résolu ou déjà rattrapé (correction), bouton actif dès que le champ est rempli ; l'URL est jugée par le sidecar, un refus revient sous la ligne ». Retirer « validation de l'hôte avant envoi ».
- **§ Structure de Page**, onglet Tagging : le bloc de rattrapage se place sous la liste du run une fois la phase ouverte (fin de recherche ou interruption), borné en hauteur, ses lignes défilant dans le bloc ; la barre de la phase prend l'emplacement de celle du run.
- **§ Maquette et design system externes > Arbitrages**, une puce par écart tranché, sur le modèle des puces existantes (« X, là où la maquette Y. Décidé le JJ-MM ») :
  - **Zone hôte du rattrapage** : aucun logo ni message d'hôte à la frappe, le sidecar juge l'URL et un refus revient sous la ligne, là où `UrlRescue` reconnaissait l'hôte dans l'écran et grisait le bouton. Décidé le 2026-09-29
  - **Barre de la phase de rattrapage** : « rattrapés sur à rattraper » dans l'emplacement de la barre du run, masquée sur 0 sur 0, là où la maquette gardait la barre réseau figée à 100 %. Décidé le 2026-10-03
  - **Lignes rattrapées** : conservées dans le bloc avec « Rattrapé sur <Source> » et leur lien, pour corriger, là où la maquette les retirait. Décidé le 2026-10-02
  - **Bloc après interruption** : affiché aussi quand le run a été interrompu, là où la maquette ne montrait rien en phase `interrupted`. Décidé le 2026-10-02
  - **Bouton « Lancer le run » pendant la phase** : conservé, bloqué seulement pendant un geste en vol, là où la maquette le remplaçait par « Confirmer l'écriture », qui arrive avec la Feature 5. Décidé le 2026-10-03

- [ ] **Step 2: Journal de la maquette**

Dans `.design-sync/NOTES.md` § Reste ouvert, ajouter une entrée « Rattrapage par URL (`UrlRescue`) » qui liste ce que le code livre et que la maquette n'a pas encore : barre de phase « rattrapés sur à rattraper » à la place de la barre réseau figée ; erreur et spinner par ligne ; lignes rattrapées conservées avec « Rattrapé sur <Source> » ; zone hôte et bouton grisé retirés (reconnaissance dans le sidecar) ; bloc affiché aussi après une interruption ; bloc borné sous la liste.

- [ ] **Step 3: Commit**

```bash
git add docs/DESIGN.md .design-sync/NOTES.md
git commit -m "docs(ui): bloc de rattrapage par URL dans DESIGN.md et le journal de la maquette"
```
