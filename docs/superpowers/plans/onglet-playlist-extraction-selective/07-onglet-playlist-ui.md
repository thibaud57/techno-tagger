# Onglet Playlist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer l'écran qui permet de lancer une extraction de playlist et d'en lire le résultat sans jamais quitter l'application.

**Architecture:** Une fonction pure aplatit les cinq catégories du résultat en lignes de table, un module isole la préférence de mode dans le `store` de Tauri, et le composant se limite à lire les signaux du service, dériver des booléens d'affichage et émettre des commandes. Aucune règle métier n'est écrite en TypeScript : le format de playlist, le départage des doublons et les motifs d'échec viennent tous du sidecar.

**Tech Stack:** Angular 22 zoneless, PrimeNG 22, Tailwind 4, ngx-translate 18, plugins Tauri `dialog` et `store`, Vitest.

**Spec:** `docs/superpowers/specs/onglet-playlist-extraction-selective/07-onglet-playlist-ui-design.md`

## Global Constraints

- **Aucune règle métier dans le composant** : il lit, dérive et émet. Le format vient du sidecar, jamais d'une extension de fichier.
- **Aucun libellé en dur**, aucune largeur fixe sur du texte traduit, aucune couleur en dur, jamais `::ng-deep` ni `!important`.
- **La couleur n'est jamais seule porteuse d'information** : icône plus libellé traduit à chaque fois.
- **Sévérités PrimeNG** : `success`, `info`, `secondary`, `danger`. `warn` n'est porté par aucune ligne d'item. `p-message` n'accepte pas `danger`, sa sévérité d'erreur est `error`.
- **Layout** : container `mx-auto max-w-3xl p-4`, `gap-2` dans un groupe, `gap-4` entre groupes, `gap-6` entre sections. Chemins en `text-muted-color`, tronqués par la gauche.
- **Hors Tauri, les plugins `dialog` et `store` rejettent** avec une `TypeError` : le repli se fait par `try/catch`, comme la résolution de langue.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`.
- **Membres lus par le template en `protected readonly`**, implémentation interne en `private` (cf. `.claude/rules/angular/components.md`). Les tests y accèdent par crochets, syntaxe que TypeScript autorise sans cast.
- **Choix liés en Signal Forms**, jamais en `[ngModel]` (cf. `.claude/rules/angular/forms.md`, qui range les template-driven forms dans les choses à éviter). La directive `[formField]` d'`@angular/forms/signals` se lie à tout `ControlValueAccessor`, donc aux composants PrimeNG, qui n'exposent leur valeur que par ce biais. Un seul signal porte les deux choix de l'écran, aucune validation n'est déclarée : il n'y a rien à valider ici, seulement à lier.
- **Convention de commit** : `type(scope): description`, scope `ui`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/features/playlist/extraction-rows.ts` | Aplatit les cinq catégories du résultat en lignes de table. Fonction pure, aucune dépendance Angular. |
| `src/app/features/playlist/extraction-rows.spec.ts` | La seule vraie transformation de cet écran. |
| `src/app/core/preferences.ts` | Lecture et écriture du mode dans le `store`, avec repli hors Tauri. |
| `src/app/shared/components/source-logo.component.ts` | Rendu des logos de source en SVG inline. |
| `src/app/shared/components/icon.component.ts` | Ajout de l'icône de dossier, selon le motif documenté. |
| `src/app/features/playlist/playlist-page.component.ts` | État de l'écran, dérivations, commandes. |
| `src/app/features/playlist/playlist-page.component.html` | Rendu. |
| `src/app/features/playlist/playlist-page.component.spec.ts` | Conditions de disponibilité et commande émise. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Libellés de l'écran, et l'espace `errors` qui traduit les `code` d'erreur. |
| `sidecar/tests/unit/test_error_translations.py` | Chaque `code` d'erreur du sidecar a sa phrase dans les deux langues. |
| `src/app/core/translations.spec.ts` | Idem pour `SIDECAR_UNAVAILABLE`, seul code émis par l'interface. |

---

## Task 1: Aplatissement du résultat en lignes de table

**Files:**
- Create: `src/app/features/playlist/extraction-rows.ts`
- Test: `src/app/features/playlist/extraction-rows.spec.ts`

**Interfaces:**
- Consumes: `ExtractionFinishedEvent`, `DuplicateResolution`, `ExtractionFailure` de `src/app/core/models/protocol.ts`
- Produces:
  - `ExtractionCategory = "extracted" | "already_present" | "missing" | "duplicate" | "failure"`
  - `ExtractionRow { fileName: string; category: ExtractionCategory; detailKey: string | null; detailParams: Record<string, string | number> | null; reasonKey: string | null }`
  - `toExtractionRows(result: ExtractionFinishedEvent): readonly ExtractionRow[]`

- [ ] **Step 1: Écrire les tests**

Le détail d'une ligne est une clé de traduction et ses paramètres, jamais une phrase : le composant traduit, la fonction reste pure et testable sans framework.

Créer `src/app/features/playlist/extraction-rows.spec.ts` :

```typescript
import type { ExtractionFinishedEvent } from "../../core/models/protocol"

import { toExtractionRows } from "./extraction-rows"

/**
 * Seule vraie transformation de l'ecran : cinq categories de natures differentes
 * aplaties en une liste unique, l'utilisateur cherchant un morceau et non une
 * categorie.
 */
const EMPTY: ExtractionFinishedEvent = {
  event: "extraction_finished",
  extracted: [],
  already_present: [],
  missing: [],
  duplicates: [],
  failures: [],
  report_path: "C:/work/report.json",
}

describe("toExtractionRows", () => {
  it("renders no row for an empty result", () => {
    expect(toExtractionRows(EMPTY)).toEqual([])
  })

  it("renders one row per track across all categories", () => {
    const rows = toExtractionRows({
      ...EMPTY,
      extracted: ["a.mp3", "b.mp3"],
      already_present: ["c.mp3"],
      missing: ["d.mp3"],
    })

    expect(rows).toHaveLength(4)
  })

  it("carries the category of each track", () => {
    const rows = toExtractionRows({ ...EMPTY, extracted: ["a.mp3"], missing: ["d.mp3"] })

    expect(rows.map((row) => row.category)).toEqual(["extracted", "missing"])
  })

  it("describes a duplicate by its discarded candidate and criterion", () => {
    const rows = toExtractionRows({
      ...EMPTY,
      duplicates: [
        {
          file_name: "beta.mp3",
          kept_path: "C:/lib/singles/beta.mp3",
          kept_size: 12_000,
          criterion: "largest_file",
          discarded: [{ path: "C:/lib/albums/beta.mp3", size: 5_000 }],
        },
      ],
    })

    expect(rows[0].category).toBe("duplicate")
    expect(rows[0].detailKey).toBe("playlist.report.detail.duplicate")
    expect(rows[0].detailParams).toEqual({
      kept: "C:/lib/singles/beta.mp3",
      discarded: "C:/lib/albums/beta.mp3",
    })
    expect(rows[0].reasonKey).toBe("playlist.report.criterion.largest_file")
  })

  it("names a failure reason by a key, never by its raw value", () => {
    const rows = toExtractionRows({
      ...EMPTY,
      failures: [{ file_name: "locked.mp3", reason: "file_locked" }],
    })

    expect(rows[0].category).toBe("failure")
    expect(rows[0].reasonKey).toBe("playlist.report.reason.file_locked")
  })

  it("renders a stable order from one run to the next", () => {
    const result = {
      ...EMPTY,
      extracted: ["a.mp3"],
      already_present: ["c.mp3"],
      missing: ["d.mp3"],
    }

    expect(toExtractionRows(result)).toEqual(toExtractionRows(result))
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm test --run src/app/features/playlist/extraction-rows.spec.ts`
Expected: FAIL, le module `./extraction-rows` n'existe pas

- [ ] **Step 3: Écrire la fonction**

Créer `src/app/features/playlist/extraction-rows.ts` :

```typescript
import type { ExtractionFinishedEvent } from "../../core/models/protocol"

export type ExtractionCategory =
  | "extracted"
  | "already_present"
  | "missing"
  | "duplicate"
  | "failure"

/**
 * Une ligne de la table du rapport.
 *
 * `detailKey` et `detailParams` plutot qu'une phrase : le sidecar n'emet jamais
 * de texte destine a l'utilisateur, et cette fonction ne doit pas en fabriquer.
 * Le composant traduit.
 */
export interface ExtractionRow {
  readonly fileName: string
  readonly category: ExtractionCategory
  readonly detailKey: string | null
  readonly detailParams: Record<string, string | number> | null
  /**
   * Cle traduisant le motif d'echec ou le critere de departage. Separee de
   * `detailKey` parce qu'une valeur d'enum du sidecar ne peut pas etre traduite
   * en tant que parametre d'interpolation : elle s'afficherait telle quelle.
   */
  readonly reasonKey: string | null
}

const DETAIL_PREFIX = "playlist.report.detail"

function plain(fileName: string, category: ExtractionCategory): ExtractionRow {
  return { fileName, category, detailKey: null, detailParams: null, reasonKey: null }
}

/**
 * Aplatit les cinq categories en une liste unique, dans un ordre fixe.
 *
 * L'ordre est celui du resultat, sans tri : deux appels sur le meme resultat
 * rendent la meme liste, ce dont depend la stabilite d'affichage entre deux
 * rendus.
 */
export function toExtractionRows(result: ExtractionFinishedEvent): readonly ExtractionRow[] {
  return [
    ...result.extracted.map((name) => plain(name, "extracted")),
    ...result.already_present.map((name) => plain(name, "already_present")),
    ...result.missing.map((name) => plain(name, "missing")),
    ...result.duplicates.map((duplicate) => ({
      fileName: duplicate.file_name,
      category: "duplicate" as const,
      detailKey: `${DETAIL_PREFIX}.duplicate`,
      detailParams: {
        kept: duplicate.kept_path,
        discarded: duplicate.discarded.map((candidate) => candidate.path).join(", "),
      },
      reasonKey: `playlist.report.criterion.${duplicate.criterion}`,
    })),
    ...result.failures.map((failure) => ({
      fileName: failure.file_name,
      category: "failure" as const,
      detailKey: null,
      detailParams: null,
      reasonKey: `playlist.report.reason.${failure.reason}`,
    })),
  ]
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `pnpm test --run src/app/features/playlist/extraction-rows.spec.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/features/playlist/extraction-rows.ts src/app/features/playlist/extraction-rows.spec.ts
git commit -m "feat(ui): aplatir le resultat d extraction en lignes de table"
```

---

## Task 2: Préférence de mode, logo VLC et icône de dossier

**Files:**
- Create: `src/app/core/preferences.ts`
- Modify: `src/app/shared/components/source-logo.component.ts`
- Modify: `src/app/shared/components/icon.component.ts`

**Interfaces:**
- Consumes: `ExtractionMode` de `src/app/core/models/protocol.ts`, `IconSize` de `icon.component.ts`
- Produces:
  - `readExtractionMode(): Promise<ExtractionMode>`, `writeExtractionMode(mode: ExtractionMode): Promise<void>`
  - `SourceLogoComponent` rendu, `ICON_NAMES` étendu de `"folder"`

- [ ] **Step 1: Écrire le module de préférences**

Créer `src/app/core/preferences.ts` :

```typescript
import { load } from "@tauri-apps/plugin-store"

import type { ExtractionMode } from "./models/protocol"

const STORE_FILE = "preferences.json"
const EXTRACTION_MODE_KEY = "extraction_mode"

/**
 * La copie est le defaut : la bibliotheque source reste intacte pendant que le
 * re-tagging reecrit les fichiers de destination.
 */
export const DEFAULT_EXTRACTION_MODE: ExtractionMode = "copy"

/**
 * Lit le mode retenu au dernier run.
 *
 * Hors Tauri, `load` rejette comme tout appel au plugin : le defaut s'applique
 * sans lever, l'interface devant rester utilisable sous le `ng serve` seul.
 */
export async function readExtractionMode(): Promise<ExtractionMode> {
  try {
    const store = await load(STORE_FILE)
    const stored = await store.get<ExtractionMode>(EXTRACTION_MODE_KEY)

    return stored === "move" ? "move" : DEFAULT_EXTRACTION_MODE
  } catch {
    return DEFAULT_EXTRACTION_MODE
  }
}

/** Une preference non enregistree n'est pas une panne : l'echec est silencieux. */
export async function writeExtractionMode(mode: ExtractionMode): Promise<void> {
  try {
    const store = await load(STORE_FILE)
    await store.set(EXTRACTION_MODE_KEY, mode)
    await store.save()
  } catch {
    return
  }
}
```

- [ ] **Step 2: Ajouter l'icône de dossier**

Dans `src/app/shared/components/icon.component.ts`, suivre le motif documenté : un nom dans le tableau, un import, un `@case`.

```typescript
import { Component, input } from "@angular/core"
import { ChevronLeft } from "@primeicons/angular/chevron-left"
import { ChevronRight } from "@primeicons/angular/chevron-right"
import { Check } from "@primeicons/angular/check"
import { Clock } from "@primeicons/angular/clock"
import { File as FileIcon } from "@primeicons/angular/file"
import { Folder } from "@primeicons/angular/folder"
import { InfoCircle } from "@primeicons/angular/info-circle"
import { Times } from "@primeicons/angular/times"

export const ICON_NAMES = [
  "chevron-left",
  "chevron-right",
  "file",
  "folder",
  "check",
  "clock",
  "times",
  "info-circle",
] as const
```

Les cinq noms ajoutés sont bien exportés par `@primeicons/angular`. Ajouter les cinq classes aux `imports` du décorateur et leurs `@case` au template :

```html
      @case ("folder") {
        <svg data-p-icon="folder" [size]="size()" />
      }
      @case ("check") {
        <svg data-p-icon="check" [size]="size()" />
      }
      @case ("clock") {
        <svg data-p-icon="clock" [size]="size()" />
      }
      @case ("times") {
        <svg data-p-icon="times" [size]="size()" />
      }
      @case ("info-circle") {
        <svg data-p-icon="info-circle" [size]="size()" />
      }
```

Le test existant parcourt `ICON_NAMES` précisément pour qu'un nom ajouté sans son `@case` échoue : Angular ne vérifie pas l'exhaustivité d'un `@switch`.

- [ ] **Step 3: Implémenter le logo de source**

Le SVG est inliné plutôt que référencé : `currentColor` ne fonctionne pas sur une balise `img`, et câbler `src/assets/icons/` dans la configuration d'assets embarquerait quatre fichiers morts dans l'installeur. Reprendre le tracé de `src/assets/icons/vlc.svg` dans le `@case` correspondant.

Remplacer `src/app/shared/components/source-logo.component.ts` :

```typescript
import { Component, input } from "@angular/core"

import type { IconSize } from "./icon.component"

export type SourceName = "beatport" | "bandcamp" | "soundcloud" | "vlc"

/**
 * Les quatre logos absents de PrimeIcons, en currentColor.
 *
 * SVG inline et non `<img src>` : `currentColor` ne s'applique pas a une image
 * externe, et les fichiers de `src/assets/icons/` ne sont pas emis par le build,
 * qui ne declare que `public/`.
 */
@Component({
  selector: "app-source-logo",
  template: `
    @switch (source()) {
      @case ("vlc") {
        <svg
          role="img"
          viewBox="0 0 24 24"
          fill="currentColor"
          [attr.width]="size()"
          [attr.height]="size()"
        >
          <!-- Trace repris de src/assets/icons/vlc.svg -->
          <path [attr.d]="VLC_PATH" />
        </svg>
      }
    }
  `,
})
export class SourceLogoComponent {
  readonly source = input.required<SourceName>()
  readonly size = input<IconSize>(16)

  /** Trace releve dans `src/assets/icons/vlc.svg`, inchange. */
  protected readonly VLC_PATH =
    "M12.0319 0c-.8823 0-1.0545.136-1.0545.136-.1738.056-.3556.255-.4105.43L9.683 3.3808c.4729.1729 1.3222.4266 2.2337.4266 1.0987 0 2.017-.3494 2.3763-.5075L13.4352.566c-.055-.1755-.237-.3707-.4067-.4374 0 0-.1142-.1286-.9966-.1286zm3.5645 7.455c-.3601.34-1.3276.9373-3.6797.9373-2.2929 0-3.189-.5678-3.5213-.9113l-1.3887 4.4227c.2272.3614 1.2539 1.5594 4.8847 1.5594 3.7569 0 4.8539-1.3467 5.0649-1.6737zm-8.5897 4.4487l-1.0025 3.1922H4.3428c-.2486 0-.5097.1932-.5826.4315l-2.334 7.6317a.3962.3962 0 0 0-.0169.1537c-.0008.0053-.002.0099-.002.016 0 .0839.0233.226.0233.226.0322.2456.2612.4452.5098.4452h20.1192c.2487 0 .4768-.1994.5098-.4453 0 0 .0234-.142.0234-.226a.0245.0245 0 0 0-.0025-.01.3201.3201 0 0 0 .0024-.0313.4096.4096 0 0 0-.019-.1282l-2.3339-7.6318c-.0729-.2383-.334-.4314-.5826-.4314h-1.6636l.2005.6391c-.2407.4854-1.4886 2.38-6.3027 2.38-4.6003 0-5.8288-1.73-6.1107-2.3072z"
}
```

Les trois autres logos ne sont pas ajoutés ici : ils servent au récapitulatif de la Feature 2 et n'ont aucun usage sur cet écran. Le `<title>` du fichier d'origine n'est pas repris : le libellé accessible vient du texte traduit qui accompagne le logo.

- [ ] **Step 4: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert, y compris le test existant qui parcourt `ICON_NAMES`

- [ ] **Step 5: Commit**

```bash
git add src/app/core/preferences.ts src/app/shared/components/icon.component.ts src/app/shared/components/source-logo.component.ts
git commit -m "feat(ui): preference de mode, logo VLC et icone de dossier"
```

---

## Task 3: État et logique d'affichage du composant

**Files:**
- Modify: `src/app/features/playlist/playlist-page.component.ts`
- Test: `src/app/features/playlist/playlist-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Test: `sidecar/tests/unit/test_error_translations.py`, `src/app/core/translations.spec.ts`

**Interfaces:**
- Consumes: `SidecarService` (signaux `ready`, `extracting`, `available`, `versionMismatch`, `playlistFormat`, `playlists`, `progress`, `extraction`, `lastError`, commandes `listPlaylists` et `extractPlaylist`, constante `SIDECAR_UNAVAILABLE`), `toExtractionRows`, `readExtractionMode`, `writeExtractionMode`
- Produces: `PlaylistPageComponent` avec les signaux `sourceFolder`, `destinationFolder`, `playlistPath`, le signal de choix `choice` (`{ playlist, mode }`) et son `FieldTree` `fields`, et les dérivations `showsPlaylistSelector`, `awaitsPlaylists`, `canExtract`, `rows`

- [ ] **Step 1: Écrire les tests**

Créer `src/app/features/playlist/playlist-page.component.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"
import { TranslateModule } from "@ngx-translate/core"
import { signal } from "@angular/core"

import { SidecarService } from "../../core/sidecar.service"

import PlaylistPageComponent from "./playlist-page.component"

/**
 * Le selecteur de fichier de Tauri n'existe pas sous Vitest : `open` y rejette.
 * Le mocker est la seule facon d'atteindre le code qui suit le choix du fichier.
 */
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("C:/x/vlc_media.db")),
}))

/**
 * Ce qui se teste ici est la disponibilite de l'action et la commande emise :
 * le reste de l'ecran affiche ce qu'il recoit, et tester qu'un `@if` masque un
 * bloc reviendrait a tester Angular.
 */
function mountWith(overrides: Partial<Record<string, unknown>> = {}) {
  const service = {
    ready: signal(true),
    extracting: signal(false),
    available: signal(true),
    version: signal("1.0.0"),
    versionMismatch: signal(null),
    playlistFormat: signal<"vlc_dump" | "m3u8" | null>("vlc_dump"),
    playlists: signal([{ playlist_id: 1, name: "set", track_count: 8 }]),
    progress: signal(null),
    extraction: signal(null),
    lastError: signal(null),
    listPlaylists: vi.fn(),
    extractPlaylist: vi.fn(),
    ...overrides,
  }

  TestBed.configureTestingModule({
    imports: [PlaylistPageComponent, TranslateModule.forRoot()],
    providers: [{ provide: SidecarService, useValue: service }],
  })

  const fixture = TestBed.createComponent(PlaylistPageComponent)

  return { fixture, component: fixture.componentInstance, service }
}

/**
 * Acces par crochets : ces membres sont `protected`, l'ecran etant leur seul
 * consommateur legitime. TypeScript autorise cette syntaxe sans cast, c'est la
 * seule facon de piloter le composant depuis son test sans les rendre publics.
 */
function withAllPathsChosen(component: PlaylistPageComponent): void {
  component["sourceFolder"].set("C:/lib")
  component["destinationFolder"].set("C:/work")
  component["playlistPath"].set("C:/x/vlc_media.db")
  choosePlaylist(component, "set")
}

function choosePlaylist(component: PlaylistPageComponent, name: string | null): void {
  component["choice"].update((current) => ({ ...current, playlist: name }))
}

describe("PlaylistPageComponent", () => {
  it("blocks extraction while a path is missing", () => {
    const { component } = mountWith()

    component["sourceFolder"].set("C:/lib")

    expect(component["canExtract"]()).toBe(false)
  })

  it("blocks extraction on a dump with no playlist selected", () => {
    const { component } = mountWith()
    withAllPathsChosen(component)

    choosePlaylist(component, null)

    expect(component["canExtract"]()).toBe(false)
  })

  it("allows extraction on an M3U8 without a selected playlist", () => {
    const { component } = mountWith({ playlistFormat: signal("m3u8"), playlists: signal([]) })
    withAllPathsChosen(component)

    choosePlaylist(component, null)

    expect(component["canExtract"]()).toBe(true)
  })

  it("blocks extraction while the sidecar is not ready", () => {
    const { component } = mountWith({ ready: signal(false) })

    withAllPathsChosen(component)

    expect(component["canExtract"]()).toBe(false)
  })

  it("awaits the listing of a chosen file until the sidecar answers", () => {
    const { component } = mountWith({ playlistFormat: signal(null), playlists: signal([]) })

    component["playlistPath"].set("C:/x/vlc_media.db")

    expect(component["awaitsPlaylists"]()).toBe(true)
  })

  it("offers the playlist selector only for a VLC dump", () => {
    const { component } = mountWith()

    expect(component["showsPlaylistSelector"]()).toBe(true)
  })

  it("offers no playlist selector for an M3U8", () => {
    const { component } = mountWith({ playlistFormat: signal("m3u8") })

    expect(component["showsPlaylistSelector"]()).toBe(false)
  })

  it("defaults to copy", () => {
    const { component } = mountWith()

    expect(component["choice"]().mode).toBe("copy")
  })

  it("requests the playlist listing as soon as a file is chosen", async () => {
    const { component, service } = mountWith()

    await component["choosePlaylistFile"]()

    expect(service.listPlaylists).toHaveBeenCalledWith("C:/x/vlc_media.db")
  })

  it("sends a command carrying the paths, the playlist and the mode", async () => {
    const { component, service } = mountWith()
    withAllPathsChosen(component)

    await component["extract"]()

    expect(service.extractPlaylist).toHaveBeenCalledWith({
      source_folder: "C:/lib",
      destination_folder: "C:/work",
      playlist_path: "C:/x/vlc_media.db",
      playlist_name: "set",
      mode: "copy",
    })
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm test --run src/app/features/playlist/playlist-page.component.spec.ts`
Expected: FAIL, le composant n'expose ni `canExtract` ni `extract`

- [ ] **Step 3: Écrire le composant**

Remplacer `src/app/features/playlist/playlist-page.component.ts` :

```typescript
import { Component, computed, inject, signal } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { TranslatePipe } from "@ngx-translate/core"
import { open } from "@tauri-apps/plugin-dialog"
import { Button } from "primeng/button"
import { Message } from "primeng/message"
import { ProgressBar } from "primeng/progressbar"
import { Select } from "primeng/select"
import { SelectButton } from "primeng/selectbutton"
import { Skeleton } from "primeng/skeleton"
import { TableModule } from "primeng/table"
import { Tag } from "primeng/tag"

import type { ExtractionMode } from "../../core/models/protocol"
import { DEFAULT_EXTRACTION_MODE, readExtractionMode, writeExtractionMode } from "../../core/preferences"
import { SidecarService } from "../../core/sidecar.service"
import { IconComponent, type IconName } from "../../shared/components/icon.component"
import { SourceLogoComponent } from "../../shared/components/source-logo.component"

import { toExtractionRows, type ExtractionCategory } from "./extraction-rows"

/** Ce que l'utilisateur choisit sur cet ecran, hors chemins de fichiers. */
interface PlaylistChoice {
  playlist: string | null
  mode: ExtractionMode
}

/** Icone et severite par categorie : la couleur n'est jamais seule a informer. */
const CATEGORY_STYLE: Record<ExtractionCategory, { severity: string; icon: IconName }> = {
  extracted: { severity: "success", icon: "check" },
  already_present: { severity: "secondary", icon: "clock" },
  missing: { severity: "danger", icon: "times" },
  duplicate: { severity: "info", icon: "info-circle" },
  failure: { severity: "danger", icon: "times" },
}

@Component({
  selector: "app-playlist-page",
  imports: [
    TranslatePipe,
    Button,
    Select,
    SelectButton,
    ProgressBar,
    TableModule,
    Tag,
    Message,
    Skeleton,
    FormField,
    IconComponent,
    SourceLogoComponent,
  ],
  templateUrl: "./playlist-page.component.html",
})
export default class PlaylistPageComponent {
  private readonly sidecar = inject(SidecarService)

  /** Table de style bindee telle quelle : un appel de methode se rejouerait a
   * chaque relecture du template, deux fois par ligne de rapport. */
  protected readonly categoryStyle = CATEGORY_STYLE

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

  protected readonly fields = form(this.choice)

  protected readonly available = this.sidecar.available
  protected readonly extracting = this.sidecar.extracting
  protected readonly versionMismatch = this.sidecar.versionMismatch
  protected readonly playlists = this.sidecar.playlists
  protected readonly progress = this.sidecar.progress
  protected readonly lastError = this.sidecar.lastError

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

  protected readonly rows = computed(() => {
    const result = this.sidecar.extraction()

    return result === null ? [] : toExtractionRows(result)
  })

  /** `ready` couvre le sidecar lance, la version controlee et aucune extraction en cours. */
  protected readonly canExtract = computed(
    () =>
      this.sidecar.ready() &&
      this.sourceFolder() !== null &&
      this.destinationFolder() !== null &&
      this.playlistPath() !== null &&
      (!this.showsPlaylistSelector() || this.choice().playlist !== null),
  )

  protected readonly modeOptions = [
    { labelKey: "playlist.mode.copy", value: "copy" satisfies ExtractionMode },
    { labelKey: "playlist.mode.move", value: "move" satisfies ExtractionMode },
  ]

  constructor() {
    void readExtractionMode().then((stored) =>
      this.choice.update((current) => ({ ...current, mode: stored })),
    )
  }

  protected async chooseSourceFolder(): Promise<void> {
    this.sourceFolder.set(await this.openPath({ directory: true }))
  }

  protected async chooseDestinationFolder(): Promise<void> {
    this.destinationFolder.set(await this.openPath({ directory: true }))
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
```

- [ ] **Step 4: Ajouter les clés de traduction**

Dans `public/i18n/en.json`, ajouter l'objet `errors` et remplacer l'objet `playlist`. Les clés d'`errors` sont les `code` que le sidecar émet, un par un, plus `sidecar_unavailable` que le service émet lui-même : c'est ici que le protocole devient une phrase, jamais dans le sidecar (cf. ARCHITECTURE.md § API). Les paramètres interpolés sont ceux que chaque erreur porte dans `params`.

```json
  "errors": {
    "malformed_command": "The interface sent a command the sidecar refused. Restart the application.",
    "unknown_error": "The sidecar failed for an unexpected reason. See the logs.",
    "playlist_error": "This playlist file could not be read.",
    "unsupported_playlist_format": "{{filename}} is neither a VLC dump nor a readable M3U8 playlist.",
    "vlc_schema_mismatch": "This VLC database does not carry the expected tables: {{missing}}.",
    "playlist_not_found": "No playlist named {{playlist_name}} in this database.",
    "playlist_file_unreadable": "{{filename}} cannot be opened.",
    "unreadable_dump": "{{filename}} is not a readable VLC database.",
    "playlist_name_required": "Choose a playlist from this VLC database.",
    "extraction_error": "The extraction failed before it started.",
    "report_error": "The extraction report could not be produced.",
    "report_write_failed": "The tracks were extracted but the report could not be written: {{filename}}.",
    "source_folder_unreadable": "The source folder cannot be read: {{folder}}.",
    "destination_folder_unwritable": "The destination folder cannot be created: {{folder}}.",
    "sidecar_unavailable": "The sidecar is not running. Restart the application."
  },
  "playlist": {
    "title": "Playlist",
    "source": { "label": "Source folder", "choose": "Choose a folder" },
    "destination": { "label": "Destination folder", "choose": "Choose a folder" },
    "file": { "label": "Playlist file", "choose": "Choose a file" },
    "selector": { "label": "Playlist", "option": "{{name}} ({{count}} tracks)" },
    "mode": { "label": "Mode", "copy": "Copy", "move": "Move" },
    "extract": "Extract",
    "progress": "{{processed}} of {{total}}",
    "versionMismatch": "Sidecar version {{sidecar}} does not match the interface version {{ui}}. Restart the application.",
    "unavailable": "The sidecar is not running. Extraction is unavailable.",
    "report": {
      "title": "Extraction report",
      "file": "File",
      "status": "Status",
      "detail": { "duplicate": "Kept {{kept}}, discarded {{discarded}}" },
      "criterion": {
        "largest_file": "Kept the largest file",
        "path_order": "Same size, kept the first path in alphabetical order"
      },
      "reason": {
        "permission_denied": "Permission denied",
        "disk_full": "No space left on the destination drive",
        "path_too_long": "Destination path too long",
        "file_locked": "File held by another program",
        "file_missing": "File gone since the folder was indexed",
        "write_failed": "Write failed"
      },
      "category": {
        "extracted": "Extracted",
        "already_present": "Already present",
        "missing": "Not found",
        "duplicate": "Duplicate resolved",
        "failure": "Transfer failed"
      }
    }
  },
```

Dans `public/i18n/fr.json`, les mêmes objets traduits :

```json
  "errors": {
    "malformed_command": "L'interface a envoyé une commande que le sidecar a refusée. Relance l'application.",
    "unknown_error": "Le sidecar a échoué pour une raison inattendue. Consulte les logs.",
    "playlist_error": "Ce fichier de playlist n'a pas pu être lu.",
    "unsupported_playlist_format": "{{filename}} n'est ni un dump VLC ni une playlist M3U8 lisible.",
    "vlc_schema_mismatch": "Cette base VLC ne porte pas les tables attendues : {{missing}}.",
    "playlist_not_found": "Aucune playlist nommée {{playlist_name}} dans cette base.",
    "playlist_file_unreadable": "{{filename}} ne peut pas être ouvert.",
    "unreadable_dump": "{{filename}} n'est pas une base VLC lisible.",
    "playlist_name_required": "Choisis une playlist de cette base VLC.",
    "extraction_error": "L'extraction a échoué avant de commencer.",
    "report_error": "Le rapport d'extraction n'a pas pu être produit.",
    "report_write_failed": "Les morceaux sont extraits mais le rapport n'a pas pu être écrit : {{filename}}.",
    "source_folder_unreadable": "Le dossier source est illisible : {{folder}}.",
    "destination_folder_unwritable": "Le dossier destination ne peut pas être créé : {{folder}}.",
    "sidecar_unavailable": "Le sidecar ne tourne pas. Relance l'application."
  },
  "playlist": {
    "title": "Playlist",
    "source": { "label": "Dossier source", "choose": "Choisir un dossier" },
    "destination": { "label": "Dossier destination", "choose": "Choisir un dossier" },
    "file": { "label": "Fichier de playlist", "choose": "Choisir un fichier" },
    "selector": { "label": "Playlist", "option": "{{name}} ({{count}} morceaux)" },
    "mode": { "label": "Mode", "copy": "Copier", "move": "Déplacer" },
    "extract": "Extraire",
    "progress": "{{processed}} sur {{total}}",
    "versionMismatch": "La version {{sidecar}} du sidecar ne correspond pas à la version {{ui}} de l'interface. Relance l'application.",
    "unavailable": "Le sidecar n'est pas démarré. L'extraction est indisponible.",
    "report": {
      "title": "Rapport d'extraction",
      "file": "Fichier",
      "status": "État",
      "detail": { "duplicate": "{{kept}} retenu, {{discarded}} écarté" },
      "criterion": {
        "largest_file": "Fichier le plus volumineux retenu",
        "path_order": "Taille égale, premier chemin dans l'ordre alphabétique retenu"
      },
      "reason": {
        "permission_denied": "Accès refusé",
        "disk_full": "Plus d'espace sur le disque de destination",
        "path_too_long": "Chemin de destination trop long",
        "file_locked": "Fichier tenu par un autre programme",
        "file_missing": "Fichier disparu depuis l'indexation du dossier",
        "write_failed": "Écriture en échec"
      },
      "category": {
        "extracted": "Extrait",
        "already_present": "Déjà présent",
        "missing": "Introuvable",
        "duplicate": "Doublon départagé",
        "failure": "Transfert en échec"
      }
    }
  },
```

Garder ces clés par un test de cohérence : les codes vivent en Python, les phrases en JSON, et une clé manquante ne se verrait qu'à l'écran, en `errors.<code>` brut (règle « Une valeur, une source »). Créer `sidecar/tests/unit/test_error_translations.py` :

```python
"""Chaque code d'erreur du sidecar a sa phrase dans les deux fichiers de langue."""

import importlib
import json
import pkgutil
from pathlib import Path

import pytest

import tagger
from tagger.errors import TaggerError
from tagger.protocol import MALFORMED_COMMAND

REPO = Path(__file__).parents[3]


def _codes(base: type[TaggerError]) -> set[str]:
    return {base.code}.union(*(_codes(sub) for sub in base.__subclasses__()))


@pytest.mark.parametrize("language", ["en", "fr"])
def test_every_error_code_has_a_translation(language: str) -> None:
    """Importe tous les modules : une erreur ajoutee ailleurs est couverte d'office."""
    for module in pkgutil.walk_packages(tagger.__path__, "tagger."):
        importlib.import_module(module.name)
    content = (REPO / "public" / "i18n" / f"{language}.json").read_text(encoding="utf-8")
    errors: dict[str, str] = json.loads(content)["errors"]

    missing = (_codes(TaggerError) | {MALFORMED_COMMAND}) - errors.keys()

    assert not missing
```

Dans `src/app/core/translations.spec.ts`, importer `SIDECAR_UNAVAILABLE` depuis `./sidecar.service` et ajouter le test du seul code émis par l'interface :

```typescript
  it("translate the error the interface raises itself", () => {
    expect([en.errors[SIDECAR_UNAVAILABLE], fr.errors[SIDECAR_UNAVAILABLE]]).not.toContain(undefined)
  })
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `pnpm test --run src/app/features/playlist src/app/core/translations.spec.ts` puis `cd sidecar && uv run pytest tests/unit/test_error_translations.py`
Expected: PASS, 10 tests du composant, 6 de l'aplatissement, et les tests de cohérence des deux côtés

- [ ] **Step 6: Commit**

```bash
git add src/app/features/playlist/playlist-page.component.ts src/app/features/playlist/playlist-page.component.spec.ts public/i18n sidecar/tests/unit/test_error_translations.py src/app/core/translations.spec.ts
git commit -m "feat(ui): etat et conditions de l onglet playlist"
```

---

## Task 4: Rendu de l'écran

**Files:**
- Modify: `src/app/features/playlist/playlist-page.component.html`

**Interfaces:**
- Consumes: tout ce que la Task 3 expose
- Produces: l'écran rendu

- [ ] **Step 1: Écrire le template**

Remplacer `src/app/features/playlist/playlist-page.component.html` :

```html
<section class="mx-auto flex max-w-3xl flex-col gap-6 p-4">
  <h1 class="text-2xl font-semibold">{{ "playlist.title" | translate }}</h1>

  @if (versionMismatch(); as mismatch) {
    <p-message severity="error" [text]="'playlist.versionMismatch' | translate: mismatch" />
  } @else if (!available()) {
    <p-message severity="error" [text]="'playlist.unavailable' | translate" />
  }

  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <span class="text-xs text-muted-color">{{ "playlist.source.label" | translate }}</span>
      <div class="flex items-center gap-2">
        <p-button
          [outlined]="true"
          [label]="'playlist.source.choose' | translate"
          (onClick)="chooseSourceFolder()"
        >
          <app-icon name="folder" [size]="20" />
        </p-button>
        <span class="truncate text-muted-color text-sm" dir="rtl">{{ sourceFolder() }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <span class="text-xs text-muted-color">{{ "playlist.destination.label" | translate }}</span>
      <div class="flex items-center gap-2">
        <p-button
          [outlined]="true"
          [label]="'playlist.destination.choose' | translate"
          (onClick)="chooseDestinationFolder()"
        >
          <app-icon name="folder" [size]="20" />
        </p-button>
        <span class="truncate text-muted-color text-sm" dir="rtl">{{ destinationFolder() }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <span class="text-xs text-muted-color">{{ "playlist.file.label" | translate }}</span>
      <div class="flex items-center gap-2">
        <p-button
          [outlined]="true"
          [label]="'playlist.file.choose' | translate"
          (onClick)="choosePlaylistFile()"
        >
          @if (showsPlaylistSelector()) {
            <app-source-logo source="vlc" [size]="20" />
          } @else {
            <app-icon name="file" [size]="20" />
          }
        </p-button>
        <span class="truncate text-muted-color text-sm" dir="rtl">{{ playlistPath() }}</span>
      </div>
    </div>

    @if (awaitsPlaylists()) {
      <p-skeleton height="2.5rem" />
    } @else if (showsPlaylistSelector()) {
      <p-select
        [formField]="fields.playlist"
        [options]="playlists()"
        optionLabel="name"
        optionValue="name"
        [placeholder]="'playlist.selector.label' | translate"
      >
        <ng-template #item let-playlist>
          {{
            "playlist.selector.option"
              | translate: { name: playlist.name, count: playlist.track_count }
          }}
        </ng-template>
      </p-select>
    }

    <div class="flex flex-col gap-2">
      <span id="playlist-mode-label" class="text-xs text-muted-color">
        {{ "playlist.mode.label" | translate }}
      </span>
      <p-selectbutton
        [formField]="fields.mode"
        [options]="modeOptions"
        optionValue="value"
        (onChange)="persistMode()"
        [allowEmpty]="false"
        ariaLabelledBy="playlist-mode-label"
      >
        <ng-template #item let-option>{{ option.labelKey | translate }}</ng-template>
      </p-selectbutton>
    </div>

    <p-button
      [label]="'playlist.extract' | translate"
      [disabled]="!canExtract()"
      (onClick)="extract()"
    />
  </div>

  @if (progress(); as running) {
    <div class="flex flex-col gap-2">
      <p-progressbar [value]="(running.processed / running.total) * 100" />
      <span class="text-xs text-muted-color">
        {{ "playlist.progress" | translate: running }}
      </span>
    </div>
  } @else if (extracting()) {
    <p-progressbar mode="indeterminate" />
  }

  @if (rows().length > 0) {
    <div class="flex flex-col gap-2 animate-fadein animate-duration-200">
      <h2 class="text-xl font-semibold">{{ "playlist.report.title" | translate }}</h2>
      <p-table
        [value]="rows()"
        [size]="'small'"
        [scrollable]="true"
        [virtualScroll]="true"
        [virtualScrollItemSize]="40"
        scrollHeight="24rem"
        styleClass="text-sm"
      >
        <ng-template #header>
          <tr>
            <th>{{ "playlist.report.file" | translate }}</th>
            <th>{{ "playlist.report.status" | translate }}</th>
          </tr>
        </ng-template>
        <ng-template #body let-row>
          <tr>
            <td class="truncate">{{ row.fileName }}</td>
            <td class="flex flex-col gap-1">
              <p-tag
                [severity]="categoryStyle[row.category].severity"
                [value]="'playlist.report.category.' + row.category | translate"
              >
                <app-icon [name]="categoryStyle[row.category].icon" [size]="16" />
              </p-tag>
              @if (row.detailKey) {
                <span class="text-xs text-muted-color">
                  {{ row.detailKey | translate: row.detailParams }}
                </span>
              }
              @if (row.reasonKey) {
                <span class="text-xs text-muted-color">{{ row.reasonKey | translate }}</span>
              }
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  }

  @if (lastError(); as failure) {
    <p-message severity="error" [text]="'errors.' + failure.code | translate: failure.params" />
  }
</section>
```

Le `dir="rtl"` sur les chemins est ce qui les tronque par la gauche : c'est la fin du chemin, portant le nom du dossier, que DESIGN.md demande de garder lisible.

`[formField]` exige la directive `FormField` dans les `imports` du composant : elle vient d'`@angular/forms/signals`, jamais de `@angular/forms`. Vérifié en compilation AOT avec `strictTemplates` : la directive se lie au `ControlValueAccessor` que `p-select` et `p-selectbutton` fournissent déjà.

- [ ] **Step 2: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 3: Vérifier l'écran de bout en bout**

Run: `just build-sidecar && just dev`

Expected : choisir un dossier source contenant les morceaux, un dossier destination vide et un dump VLC. Le logo VLC apparaît, le sélecteur se remplit avec les noms et leurs comptes. Lancer l'extraction en mode copie : la barre progresse, le rapport s'affiche, les fichiers sont dans la destination et la source est intacte.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/playlist/playlist-page.component.html src/app/features/playlist/playlist-page.component.ts
git commit -m "feat(ui): rendu de l onglet playlist"
```

---

## Vérification de l'état livré

L'incrément est complet quand `just test && just lint && just typecheck` rend les trois gates verts et que le parcours complet fonctionne dans `just dev` : trois chemins choisis, format reconnu, playlist sélectionnée, extraction lancée, progression visible, rapport affiché, fichiers déposés et source intacte.

Les scénarios du spec sont couverts : sélection des chemins et troncature (Task 4), reconnaissance du dump et du M3U8 (Tasks 3 et 4), mode par défaut et mémorisé (Tasks 2 et 3), blocages de l'action (Task 3), commande émise (Task 3), progression et rapport (Tasks 1 et 4), sidecar indisponible (Tasks 3 et 4).

Cet incrément clôt la Feature 1 : le use-case d'extraction sélective est complet, du parsing de la playlist jusqu'à son rapport à l'écran.
