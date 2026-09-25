# Liste du run : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher les morceaux d'un run dans une table à six colonnes qui se met à jour événement par événement.

**Architecture:** Trois briques. Les composants partagés d'abord : l'icône `clock` et les trois logos de sources, aujourd'hui absents. Puis `StateTagComponent`, qui porte seul le mapping des états vers les quatre familles de DESIGN.md. Enfin `RunListComponent`, une table PrimeNG à scroll virtuel qui reçoit les lignes du run et n'injecte aucun service.

**Tech Stack:** Angular 22 (signals, `@switch`, `input.required`), PrimeNG 22 (`p-table`, `p-tag`, `p-skeleton`), Tailwind 4, ngx-translate 18, `convertFileSrc` de Tauri, Vitest.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/09-liste-du-run-design.md`

## Global Constraints

- **Dépend du sub-project 08** : `TaggingTrack` (`trackId`, `fileName`, `artist`, `title`, `state`, `resolution`, `failureReason`, `source`, `after`, `scores`, `artworkPath`, `arbitration`) et les types du contrat (`TrackState`, `TrackResolution`, `TrackSource`, `TrackScores`).
- **Mapping des états** : attente d'arbitrage d'abord, puis état absent, puis la table de DESIGN.md § Couleurs Sémantiques. Sévérité `warn` s'écrit sans `ing`, et `p-message` n'accepte pas `danger` (aucun des deux n'est employé ici).
- **Six colonnes** : Pochette 32px, Avant et Après fluides, Source, Score et État figées, mesurées sur leur contenu le plus long en FR et en EN. Rien n'est masqué à aucune largeur.
- **Table à sa taille par défaut** (DESIGN.md § Layout), `[scrollable]`, `scrollHeight="flex"`, `[virtualScroll]`, `virtualScrollItemSize` égal à la hauteur réelle d'une ligne, posée par une classe.
- **Pochettes** par `convertFileSrc`, jamais en base64. `assetProtocol` et la CSP sont déjà configurés, rien à changer côté Tauri.
- **Aucune logique métier** : scores, états et « après » viennent du sidecar ; seule la famille visuelle est dérivée ici.
- **i18n** : aucun libellé en dur, FR et EN dans le même commit.
- **Tests** : noms en anglais, AAA, `provideTranslateService()` dans le `TestBed`, pas de test sur le rendu d'un `@for`.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scope `ui`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/shared/components/icon.component.ts` | Icône `clock` ajoutée à la liste fermée. |
| `src/app/shared/components/source-logo.component.ts` | Tracés Beatport, Bandcamp et SoundCloud. |
| `src/app/shared/components/state-tag.component.ts` | Mapping des états vers famille, icône et libellé. |
| `src/app/features/tagging/run-list.component.{ts,html}` | Table à six colonnes du run. |
| `public/i18n/{fr,en}.json` | En-têtes, libellés d'état, bloc vide. |
| `.design-sync/NOTES.md` | Écart de taille de table consigné. |

---

## Task 1: Icône et logos manquants

**Files:**
- Modify: `src/app/shared/components/icon.component.ts`
- Modify: `src/app/shared/components/source-logo.component.ts`
- Test: `src/app/shared/components/source-logo.component.spec.ts`

**Interfaces:**
- Produces: `IconName` élargi de `"clock"`, `SourceLogoComponent` rendant un tracé pour `beatport`, `bandcamp`, `soundcloud` et `vlc`

- [ ] **Step 1: Écrire le test des logos**

Créer `src/app/shared/components/source-logo.component.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"

import { SourceLogoComponent, type SourceName } from "./source-logo.component"

/**
 * Les quatre logos sont des traces releves dans `src/assets/icons/`. Le test garde
 * qu'aucune source n'est rendue sans trace : un `@switch` sans cas produirait une
 * cellule vide, sans erreur.
 */
describe("SourceLogoComponent", () => {
  it.each<SourceName>(["beatport", "bandcamp", "soundcloud", "vlc"])(
    "renders a path for %s",
    (source) => {
      const fixture = TestBed.createComponent(SourceLogoComponent)
      fixture.componentRef.setInput("source", source)

      fixture.detectChanges()

      const path = (fixture.nativeElement as HTMLElement).querySelector("path")
      expect(path?.getAttribute("d")).toBeTruthy()
    },
  )
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `pnpm test --run src/app/shared/components/source-logo.component.spec.ts`
Expected: FAIL sur `beatport`, `bandcamp` et `soundcloud`, seul `vlc` ayant un tracé

- [ ] **Step 3: Ajouter les trois tracés**

Dans `src/app/shared/components/source-logo.component.ts`, relever le `d` de `src/assets/icons/beatport.svg`, `bandcamp.svg` et `soundcloud.svg`, **inchangé**, dans trois constantes `protected readonly` sur le modèle de `VLC_PATH`, puis ajouter un `@case` par source, identique à celui de `vlc` :

```html
      @case ("beatport") {
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="currentColor"
          [attr.width]="size()"
          [attr.height]="size()"
        >
          <path [attr.d]="BEATPORT_PATH" />
        </svg>
      }
```

Les `viewBox` des quatre fichiers sont identiques (`0 0 24 24`) : la vérifier en les ouvrant, et reprendre celle du fichier si l'une diffère.

- [ ] **Step 4: Ajouter l'icône `clock`**

Dans `src/app/shared/components/icon.component.ts` : importer `Clock` depuis `@primeicons/angular/clock`, l'ajouter aux `imports` du composant, ajouter `"clock"` à `ICON_NAMES` et le `@case` correspondant :

```html
      @case ("clock") {
        <svg data-p-icon="clock" [size]="size()" />
      }
```

Le test existant `icon.component.spec.ts` parcourt `ICON_NAMES` : il couvre la nouvelle icône sans modification.

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm test --run src/app/shared/components/source-logo.component.spec.ts src/app/shared/components/icon.component.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/shared/components/icon.component.ts src/app/shared/components/source-logo.component.ts src/app/shared/components/source-logo.component.spec.ts
git commit -m "feat(ui): logos des sources et icone d'attente"
```

---

## Task 2: Tag d'état

**Files:**
- Modify: `src/app/shared/components/state-tag.component.ts` (remplace le placeholder)
- Create: `src/app/shared/components/state-tag.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `IconComponent` et son icône `clock` (Task 1), types du contrat (sub-project 08)
- Produces: `StateTagComponent` avec les entrées `state`, `resolution`, `awaiting`

- [ ] **Step 1: Écrire les tests du mapping**

Créer `src/app/shared/components/state-tag.component.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import type { TrackResolution, TrackState } from "../../core/models/protocol"

import { StateTagComponent } from "./state-tag.component"

interface Case {
  readonly state: TrackState | null
  readonly resolution: TrackResolution | null
  readonly awaiting: boolean
  readonly severity: string
  readonly label: string
}

/** Les six lignes de DESIGN.md § Couleurs Semantiques que la Feature 2 fait circuler. */
const CASES: readonly Case[] = [
  { state: null, resolution: null, awaiting: true, severity: "info", label: "tagging.state.awaiting" },
  { state: null, resolution: null, awaiting: false, severity: "secondary", label: "tagging.state.pending" },
  { state: "resolved", resolution: "auto", awaiting: false, severity: "success", label: "tagging.state.auto" },
  { state: "resolved", resolution: "arbitration", awaiting: false, severity: "success", label: "tagging.state.arbitrated" },
  { state: "resolved", resolution: "url", awaiting: false, severity: "success", label: "tagging.state.url" },
  { state: "unresolved", resolution: "none", awaiting: false, severity: "danger", label: "tagging.state.unresolved" },
]

function mount(shown: Partial<Case>) {
  const fixture = TestBed.createComponent(StateTagComponent)
  fixture.componentRef.setInput("state", shown.state ?? null)
  fixture.componentRef.setInput("resolution", shown.resolution ?? null)
  fixture.componentRef.setInput("awaiting", shown.awaiting ?? false)
  fixture.detectChanges()

  return fixture
}

describe("StateTagComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] })
  })

  it.each(CASES)("renders the family and the label of $label", (shown) => {
    const fixture = mount(shown)

    const element = fixture.nativeElement as HTMLElement

    expect(element.textContent).toContain(shown.label)
    expect(element.querySelector(`[data-severity="${shown.severity}"]`)).not.toBeNull()
  })

  it("prefers the pending arbitration over the received state", () => {
    const fixture = mount({ state: "unresolved", resolution: "none", awaiting: true })

    const element = fixture.nativeElement as HTMLElement

    expect(element.textContent).toContain("tagging.state.awaiting")
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/shared/components/state-tag.component.spec.ts`
Expected: FAIL, le composant ne déclare ni `awaiting` ni de rendu

- [ ] **Step 3: Implémenter le tag**

Remplacer `src/app/shared/components/state-tag.component.ts` :

```typescript
import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { Tag, type TagSeverity } from "primeng/tag"

import type { TrackResolution, TrackState } from "../../core/models/protocol"

import { IconComponent, type IconName } from "./icon.component"

interface StateStyle {
  readonly severity: TagSeverity
  readonly icon: IconName
  readonly label: string
}

/**
 * Mapping state / resolution / attente vers famille, icone et libelle (DESIGN.md
 * § Couleurs Semantiques). Encode une fois ici pour ne pas etre re-derive de
 * travers ecran par ecran : la liste du run, puis le recapitulatif.
 *
 * Deux familles ne correspondent a aucun `state` : rien ne circule sur le flux
 * tant qu'un morceau n'est pas tranche, l'interface affiche donc « en attente »
 * ce qu'elle n'a pas recu et « a arbitrer » ce pour quoi elle a recu une demande
 * sans reponse.
 */
const PENDING: StateStyle = { severity: "secondary", icon: "clock", label: "tagging.state.pending" }
const AWAITING: StateStyle = {
  severity: "info",
  icon: "info-circle",
  label: "tagging.state.awaiting",
}
const UNRESOLVED: StateStyle = {
  severity: "danger",
  icon: "times",
  label: "tagging.state.unresolved",
}
/** Trois issues positives, toutes vertes : c'est le libelle qui porte la voie. */
const RESOLVED: Record<TrackResolution, StateStyle> = {
  auto: { severity: "success", icon: "check", label: "tagging.state.auto" },
  arbitration: { severity: "success", icon: "check", label: "tagging.state.arbitrated" },
  url: { severity: "success", icon: "check", label: "tagging.state.url" },
  none: UNRESOLVED,
}

@Component({
  selector: "app-state-tag",
  imports: [Tag, TranslatePipe, IconComponent],
  template: `
    <p-tag [severity]="style().severity" [attr.data-severity]="style().severity">
      <app-icon [name]="style().icon" [size]="16" />
      {{ style().label | translate }}
    </p-tag>
  `,
})
export class StateTagComponent {
  /** `null` : aucun evenement recu pour ce morceau. */
  readonly state = input<TrackState | null>(null)
  readonly resolution = input<TrackResolution | null>(null)
  /** Une demande d'arbitrage sans reponse prime sur tout etat deja recu. */
  readonly awaiting = input(false)

  protected readonly style = computed<StateStyle>(() => {
    if (this.awaiting()) {
      return AWAITING
    }
    switch (this.state()) {
      case "resolved":
        return RESOLVED[this.resolution() ?? "none"]
      case "unresolved":
        return UNRESOLVED
      default:
        return PENDING
    }
  })
}
```

`written` et `write_error` ne sont pas des valeurs de `TrackState` : la Feature 5 les ajoutera au contrat, à ce `switch` et aux libellés en même temps. Rien n'est posé d'avance, une constante sans usage tomberait sous `--max-warnings 0`.

- [ ] **Step 4: Ajouter les libellés d'état**

Dans `public/i18n/fr.json`, sous `"tagging"` :

```json
    "state": {
      "pending": "En attente",
      "awaiting": "À arbitrer",
      "auto": "Auto",
      "arbitrated": "Arbitré",
      "url": "URL",
      "unresolved": "Non résolu"
    }
```

et dans `public/i18n/en.json` :

```json
    "state": {
      "pending": "Waiting",
      "awaiting": "To arbitrate",
      "auto": "Auto",
      "arbitrated": "Arbitrated",
      "url": "URL",
      "unresolved": "Unresolved"
    }
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm test --run src/app/shared/components/state-tag.component.spec.ts src/app/core/translations.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/shared/components/state-tag.component.ts src/app/shared/components/state-tag.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): tag d'etat d'un morceau du run"
```

---

## Task 3: Table du run

**Files:**
- Create: `src/app/features/tagging/run-list.component.ts`, `run-list.component.html`
- Create: `src/app/features/tagging/run-list.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `.design-sync/NOTES.md`

**Interfaces:**
- Consumes: `TaggingTrack` (sub-project 08), `StateTagComponent` (Task 2), `SourceLogoComponent` (Task 1), `TruncatedTextComponent`, `EmptyStateComponent`, `fullHeightTable`
- Produces: `RunListComponent`, entrée `tracks: readonly TaggingTrack[]`

- [ ] **Step 0: Lire la maquette**

Lire `.design-sync/design-system/ui_kits/techno-tagger/TaggingScreen.jsx`, fonction `runColumns` et composant `Artwork`, ainsi que la fiche `.design-sync/design-system/components/data/DataTable.prompt.md`. Reprendre la structure des six colonnes et le sous-texte du nom de fichier, jamais les valeurs ni le `size="small"` de la fiche, écarté au profit de la taille par défaut de DESIGN.md.

- [ ] **Step 1: Écrire les tests**

Créer `src/app/features/tagging/run-list.component.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"

import type { TaggingTrack } from "../../core/tagging-run.store"

import { RunListComponent } from "./run-list.component"

/** `convertFileSrc` n'existe pas hors Tauri : la mocker est le seul moyen de tester la vignette. */
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}))

const TRACK: TaggingTrack = {
  trackId: "a.mp3",
  fileName: "a.mp3",
  artist: "Adam Beyer",
  title: "Your Mind",
  state: "resolved",
  resolution: "auto",
  failureReason: null,
  source: "beatport",
  after: { artist: "Adam Beyer", title: "Your Mind (Original Mix)" },
  scores: { artist: 96, title: 92, average: 94 },
  artworkPath: "C:/AppData/cache/artworks/abc.jpg",
  arbitration: null,
}

function mountWith(tracks: readonly TaggingTrack[]) {
  TestBed.configureTestingModule({
    imports: [RunListComponent],
    providers: [provideTranslateService()],
  })
  const fixture = TestBed.createComponent(RunListComponent)
  fixture.componentRef.setInput("tracks", tracks)
  fixture.detectChanges()

  return fixture
}

describe("RunListComponent", () => {
  it("converts an artwork path into an asset url", () => {
    const fixture = mountWith([TRACK])

    const image = (fixture.nativeElement as HTMLElement).querySelector("img")

    expect(convertFileSrc).toHaveBeenCalledWith(TRACK.artworkPath)
    expect(image?.getAttribute("src")).toBe(`asset://localhost/${TRACK.artworkPath}`)
  })

  it("shows the file name as the main line when the tags are empty", () => {
    const fixture = mountWith([{ ...TRACK, artist: "", title: "" }])

    const text = (fixture.nativeElement as HTMLElement).textContent ?? ""

    expect(text).toContain("a.mp3")
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/features/tagging/run-list.component.spec.ts`
Expected: FAIL, `Failed to resolve import "./run-list.component"`

- [ ] **Step 3: Implémenter le composant**

Créer `src/app/features/tagging/run-list.component.ts` :

```typescript
import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"
import { Skeleton } from "primeng/skeleton"
import { TableModule } from "primeng/table"

import type { TaggingTrack } from "../../core/tagging-run.store"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"
import { StateTagComponent } from "../../shared/components/state-tag.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { fullHeightTable } from "../../shared/utils/table"

/**
 * Hauteur reelle d'une ligne, posee par la classe `h-14` du `<tr>`. PrimeNG ne
 * mesure pas les lignes : une valeur fausse fait sauter le defilement ou coupe
 * les lignes. A remesurer si le style d'une ligne change.
 */
const ROW_HEIGHT = 56

@Component({
  selector: "app-run-list",
  imports: [
    TableModule,
    Skeleton,
    TranslatePipe,
    StateTagComponent,
    SourceLogoComponent,
    TruncatedTextComponent,
    EmptyStateComponent,
  ],
  templateUrl: "./run-list.component.html",
  host: { class: "block h-full min-h-0" },
})
export class RunListComponent {
  readonly tracks = input.required<readonly TaggingTrack[]>()

  protected readonly ROW_HEIGHT = ROW_HEIGHT
  protected readonly fullHeightTable = fullHeightTable
  protected readonly empty = computed(() => this.tracks().length === 0)

  /** Le cache est dans le scope de l'asset protocol : la webview y lit l'image. */
  protected artworkUrl(path: string): string {
    return convertFileSrc(path)
  }

  /** Sans tags, le nom de fichier sert deja de requete : il passe en ligne principale. */
  protected mainLine(track: TaggingTrack): string {
    const identity = [track.artist, track.title].filter((part) => part !== "").join(" — ")

    return identity === "" ? track.fileName : identity
  }

  protected subLine(track: TaggingTrack): string | null {
    return this.mainLine(track) === track.fileName ? null : track.fileName
  }
}
```

Créer `src/app/features/tagging/run-list.component.html` :

```html
<p-table
  [value]="tracks()"
  [scrollable]="true"
  scrollHeight="flex"
  [virtualScroll]="true"
  [virtualScrollItemSize]="ROW_HEIGHT"
  [pt]="fullHeightTable(empty())"
>
  <ng-template #header>
    <tr>
      <th class="w-8"></th>
      <th>{{ "tagging.list.before" | translate }}</th>
      <th>{{ "tagging.list.after" | translate }}</th>
      <th class="w-36">{{ "tagging.list.source" | translate }}</th>
      <th class="w-24 text-right">{{ "tagging.list.score" | translate }}</th>
      <th class="w-40">{{ "tagging.list.state" | translate }}</th>
    </tr>
  </ng-template>

  <ng-template #body let-track>
    <tr class="h-14">
      <td>
        @if (track.artworkPath) {
          <img
            class="rounded-sm"
            width="32"
            height="32"
            alt=""
            [src]="artworkUrl(track.artworkPath)"
          />
        } @else if (track.state === null) {
          <p-skeleton width="32px" height="32px" borderRadius="var(--p-border-radius-sm)" />
        }
      </td>
      <td>
        <app-truncated-text [text]="mainLine(track)" />
        @if (subLine(track); as fileName) {
          <span class="block truncate text-xs text-muted-color">{{ fileName }}</span>
        }
      </td>
      <td>
        @if (track.after; as after) {
          <app-truncated-text [text]="after.artist + ' — ' + after.title" />
        } @else {
          <span class="text-muted-color">—</span>
        }
      </td>
      <td>
        @if (track.source; as source) {
          <span class="flex items-center gap-2">
            <app-source-logo [source]="source" [size]="16" />
            {{ "tagging.source." + source | translate }}
          </span>
        } @else {
          <span class="text-muted-color">—</span>
        }
      </td>
      <td class="text-right tabular-nums">
        @if (track.scores; as scores) {
          <span class="block">{{ scores.average }}</span>
          <span class="block text-xs text-muted-color">
            @if (scores.artist !== null) {
              A {{ scores.artist }} ·
            }
            T {{ scores.title }}
          </span>
        } @else {
          <span class="text-muted-color">—</span>
        }
      </td>
      <td>
        <app-state-tag
          [state]="track.state"
          [resolution]="track.resolution"
          [awaiting]="track.arbitration !== null"
        />
      </td>
    </tr>
  </ng-template>

  <ng-template #emptymessage>
    <tr>
      <td colspan="6" class="border-b-0">
        <app-empty-state icon="folder" [heading]="'tagging.list.empty' | translate" />
      </td>
    </tr>
  </ng-template>
</p-table>
```

`EmptyStateComponent` expose `icon`, `heading` et `description` : c'est son usage dans le rapport d'extraction, repris tel quel. L'icône `folder` figure déjà dans `ICON_NAMES`.

- [ ] **Step 4: Ajouter les libellés de la liste**

Dans `public/i18n/fr.json`, sous `"tagging"` :

```json
    "list": {
      "before": "Avant",
      "after": "Après",
      "source": "Source",
      "score": "Score",
      "state": "État",
      "empty": "Aucun fichier audio dans ce dossier"
    },
    "source": {
      "beatport": "Beatport",
      "bandcamp": "Bandcamp",
      "soundcloud": "SoundCloud"
    }
```

et dans `public/i18n/en.json` :

```json
    "list": {
      "before": "Before",
      "after": "After",
      "source": "Source",
      "score": "Score",
      "state": "State",
      "empty": "No audio file in this folder"
    },
    "source": {
      "beatport": "Beatport",
      "bandcamp": "Bandcamp",
      "soundcloud": "SoundCloud"
    }
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm test --run src/app/features/tagging/run-list.component.spec.ts src/app/core/translations.spec.ts`
Expected: PASS

- [ ] **Step 6: Consigner l'écart de taille**

Dans `.design-sync/NOTES.md` § Reste ouvert, ajouter :

```markdown
- **Taille de la table de la liste du run** : la fiche `DataTable` la pose en `size="small"`, DESIGN.md § Layout la veut à sa taille par défaut, et c'est DESIGN.md qui a été suivi (2026-09-20). La fiche et `TaggingScreen.jsx` sont à aligner au prochain push.
```

- [ ] **Step 7: Gate qualité et contrôle visuel**

Run: `just test && just lint && just typecheck`
Expected: tout vert

La table ne s'affiche que depuis la page du sub-project 10 : le contrôle visuel contre `TaggingScreen.jsx`, en FR et en EN, et la revalidation de `ROW_HEIGHT` à 1280 × 800 puis au plancher de 1024 × 700, se font une fois cette page livrée.

- [ ] **Step 8: Commit**

```bash
git add src/app/features/tagging/run-list.component.ts src/app/features/tagging/run-list.component.html src/app/features/tagging/run-list.component.spec.ts public/i18n/fr.json public/i18n/en.json .design-sync/NOTES.md
git commit -m "feat(ui): table a six colonnes de la liste du run"
```
