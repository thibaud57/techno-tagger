# Ligne dépliée avant / après : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher sous une ligne de la liste du run la comparaison avant / après de ses tags, champ par champ, avec la pochette en grand.

**Architecture:** Un composant partagé `app-no-value` porte le cadratin d'une cellule sans valeur. `TrackDetailComponent` rend la pochette de 160px et la grille Champ / Avant / Après à partir de `tagsBefore` et `tagsAfter`, ordre et clés venant du sidecar. `RunListComponent` gagne une colonne de chevron (`pRowToggler`) et un `#expandedrow` ; il perd son scroll virtuel, incompatible avec des lignes de hauteur variable.

**Tech Stack:** Angular 22 (zoneless, signals, `@for` / `@if`), PrimeNG 22.1.2 (`p-table`, `pRowToggler`, `pButton`, `p-skeleton`, `pTooltip`), Tailwind 4, ngx-translate, Vitest.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/09-ligne-depliee-avant-apres-design.md`

## Global Constraints

- **Dépend du sub-project 07, implémenté avant** : `TaggingTrack.tagsBefore: TagsBefore | null` (`system`, `comment`, `fields: TagValue[]`), `TaggingTrack.tagsAfter: readonly TagValue[] | null`, `TagValue { field, key, value }`, `TagField`, fixtures `TAGS_BEFORE` / `TAGS_AFTER` dans `src/fixtures/tagging.ts`.
- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx` (`TrackDetail`, `Artwork`) et `components/data/DataTable` ; la lire avant d'écrire le template (`.claude/rules/design/claude-design.md`), sans recopier ses styles inline : leurs équivalents sont les classes de `tailwindcss-primeui`.
- **Valeur absente** : `app-no-value`, jamais une cellule vide ni un trait d'union.
- **Toujours les lignes reçues**, plus Commentaire quand le fichier en porte un ; aucune table de champs côté TypeScript.
- **Couleurs par tokens** (`text-muted-color`, `bg-surface-950`, `border-surface`), espacements des échelles (`gap-6`, `p-4`), aucun `!important`.
- **Libellés traduits**, mêmes clés en FR et en EN, espace insécable avant `:` en français.
- **Fonctions en `const nom = () =>`** ; tests en anglais, AAA séparé par des lignes vides.
- **Gate vert à chaque commit** : `just format-ui`, `just lint-ui`, `just typecheck-ui`, `just test-ui`. Commits `type(scope): description`, scope `ui` ou `docs`.

## Review Focus

- **Entrée ou Espace sur le chevron d'une ligne à arbitrer** : le `<tr>` écoute ces touches pour ouvrir l'arbitrage, le chevron ne doit pas les laisser remonter jusqu'au `<tr>` (Task 3, `keeps the chevron keys away from the row action`).
- **Ligne dépliée qui reçoit son `track_resolved`** : elle reste ouverte et son détail suit, l'état de dépliage étant tenu par `trackId` (Task 3, `keeps a row unfolded when its track is resolved`).
- **Fichier aux tags illisibles mais résolu** : les lignes viennent de l'Après, Avant en cadratins (Task 2, `builds the rows from the tags after when the tags before are unreadable`).
- **Commentaire sur un fichier** : la ligne existe et son Après est un cadratin, l'écriture le supprimant (Task 2, `adds a comment row only when the file carries one`).
- **Morceau en attente déplié** : pochette en squelette, pas en cadre neutre (Task 2, `shows a skeleton artwork while the track awaits its turn`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/shared/components/no-value.component.ts` | Cadratin d'une cellule sans valeur. |
| `src/app/shared/components/icon.component.ts` | Icône `chevron-down`. |
| `src/app/features/tagging/track-detail.component.ts`, `.html`, `.spec.ts` | Détail d'un morceau. |
| `src/app/features/tagging/run-list.component.ts`, `.html`, `.spec.ts` | Chevron, ligne dépliée, liste sans scroll virtuel. |
| `public/i18n/{fr,en}.json` | `tagging.detail.*`, `tagging.list.expand` / `collapse`. |
| `docs/DESIGN.md`, `docs/knowledges/primeng.md`, `.design-sync/NOTES.md` | Liste non virtualisée sur sept colonnes, arbitrage du détail, `#expandedrow` et scroll virtuel, reste ouvert de la maquette. |

---

### Task 1: Cellule sans valeur partagée

**Files:**
- Create: `src/app/shared/components/no-value.component.ts`
- Modify: `src/app/features/tagging/run-list.component.ts` (imports)
- Modify: `src/app/features/tagging/run-list.component.html` (trois cadratins des colonnes Après, Source et Score)

**Interfaces:**
- Produces: `NoValueComponent`, sélecteur `app-no-value`, sans input.

- [ ] **Step 1: Vérifier le test qui garde le rendu**

Le test existant `marks every valueless cell of an unresolved track with an em dash` de `run-list.component.spec.ts` lit `—` dans les cellules Après, Source et Score : il garde le comportement pendant le remplacement.

Run: `just test-ui`
Expected: PASS avant toute modification

- [ ] **Step 2: Écrire le composant**

Créer `src/app/shared/components/no-value.component.ts` :

```ts
import { Component } from "@angular/core"

/** Cellule sans valeur : cadratin grise, ni trait d'union ni vide (DESIGN.md § Sans valeur). */
@Component({
  selector: "app-no-value",
  template: `<span class="text-muted-color">—</span>`,
})
export class NoValueComponent {}
```

- [ ] **Step 3: Remplacer les trois cadratins de la liste**

Dans `src/app/features/tagging/run-list.component.ts`, ajouter `NoValueComponent` (`../../shared/components/no-value.component`) aux `imports`. Dans `run-list.component.html`, les trois `<span class="text-muted-color">—</span>` (colonnes Après, Source, Score) deviennent `<app-no-value />`.

- [ ] **Step 4: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS, le test des cellules sans valeur compris

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/components/no-value.component.ts src/app/features/tagging/run-list.component.ts src/app/features/tagging/run-list.component.html
git commit -m "refactor(ui): cellule sans valeur partagée"
```

---

### Task 2: Composant du détail avant / après

**Files:**
- Create: `src/app/features/tagging/track-detail.component.ts`
- Create: `src/app/features/tagging/track-detail.component.html`
- Create: `src/app/features/tagging/track-detail.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.detail`)

**Interfaces:**
- Consumes: Task 1 (`NoValueComponent`) ; `TaggingTrack`, `TagValue`, `TagField` ; `IconComponent` (`image`), `TruncatedTextComponent`, `FADE_IN`.
- Produces: `TrackDetailComponent`, sélecteur `app-track-detail`, inputs `track = input.required<TaggingTrack>()` et `interrupted = input(false)`.

- [ ] **Step 1: Écrire les specs**

Créer `src/app/features/tagging/track-detail.component.spec.ts` :

```ts
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { PENDING_TRACK, TAGS_AFTER, TAGS_BEFORE } from "../../../fixtures/tagging"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { TrackDetailComponent } from "./track-detail.component"

/** `convertFileSrc` n'existe pas hors Tauri. */
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}))

const RESOLVED: TaggingTrack = {
  ...PENDING_TRACK,
  state: "resolved",
  resolution: "auto",
  source: "beatport",
  artworkPath: "C:/AppData/cache/artworks/abc.jpg",
  tagsBefore: { ...TAGS_BEFORE, comment: null },
  tagsAfter: TAGS_AFTER,
}

const mount = (track: TaggingTrack) => {
  TestBed.configureTestingModule({
    imports: [TrackDetailComponent],
    providers: [provideTranslateService()],
  })
  const fixture = TestBed.createComponent(TrackDetailComponent)
  fixture.componentRef.setInput("track", track)
  fixture.detectChanges()

  return fixture.nativeElement as HTMLElement
}

/** Textes de chaque ligne : libelle (cle brute sans fichier de langue), cle, avant, apres. */
const rowsOf = (root: HTMLElement): string[][] =>
  [...root.querySelectorAll("[data-detail-row]")].map((row) =>
    [...row.querySelectorAll("[data-cell]")].map((cell) => cell.textContent.trim()),
  )

describe("TrackDetailComponent", () => {
  it("renders the rows it receives in order, with their key, before and after", () => {
    const root = mount(RESOLVED)

    const rows = rowsOf(root)

    expect(rows).toEqual([
      ["tagging.detail.field.artist", "TPE1", "lior vance", "Lior Vance"],
      ["tagging.detail.field.bpm", "TBPM", "130", "130"],
    ])
  })

  it("marks a missing value with an em dash", () => {
    const root = mount({
      ...RESOLVED,
      tagsBefore: {
        ...TAGS_BEFORE,
        comment: null,
        fields: [{ field: "label", key: "TPUB", value: null }],
      },
      tagsAfter: [{ field: "label", key: "TPUB", value: "Kestrel" }],
    })

    const rows = rowsOf(root)

    expect(rows).toEqual([["tagging.detail.field.label", "TPUB", "—", "Kestrel"]])
  })

  it("adds a comment row only when the file carries one", () => {
    const withComment = mount({ ...RESOLVED, tagsBefore: TAGS_BEFORE })
    const commented = rowsOf(withComment).at(-1)
    TestBed.resetTestingModule()

    const without = rowsOf(mount(RESOLVED))

    expect(commented).toEqual(["tagging.detail.field.comment", "", "Ripped by X", "—"])
    expect(without).toHaveLength(2)
  })

  it("shows em dashes after an unresolved track", () => {
    const root = mount({ ...RESOLVED, state: "unresolved", resolution: "none", tagsAfter: null })

    const afters = rowsOf(root).map((row) => row[3])

    expect(afters).toEqual(["—", "—"])
  })

  it("builds the rows from the tags after when the tags before are unreadable", () => {
    const root = mount({ ...RESOLVED, tagsBefore: null })

    const rows = rowsOf(root)

    expect(rows.map((row) => [row[0], row[2], row[3]])).toEqual([
      ["tagging.detail.field.artist", "—", "Lior Vance"],
      ["tagging.detail.field.bpm", "—", "130"],
    ])
  })

  it("says the tags could not be read when there is neither before nor after", () => {
    const root = mount({ ...RESOLVED, state: "unresolved", tagsBefore: null, tagsAfter: null })

    const message = root.querySelector("[data-unreadable]")?.textContent.trim()

    expect(message).toBe("tagging.detail.unreadable")
    expect(root.querySelector("[data-detail-row]")).toBeNull()
  })

  it("shows the artwork in large", () => {
    const root = mount(RESOLVED)

    const image = root.querySelector("img")

    expect(image?.getAttribute("src")).toBe(`asset://localhost/${RESOLVED.artworkPath}`)
    expect(image?.getAttribute("width")).toBe("160")
  })

  it("shows a skeleton artwork while the track awaits its turn", () => {
    const root = mount({ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE })

    const skeleton = root.querySelector("p-skeleton")

    expect(skeleton).not.toBeNull()
  })
})
```

- [ ] **Step 2: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL, `Cannot find module './track-detail.component'`

- [ ] **Step 3: Écrire le composant**

Créer `src/app/features/tagging/track-detail.component.ts` :

```ts
import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"
import { Skeleton } from "primeng/skeleton"

import type { TagValue } from "../../core/models/protocol"
import type { TaggingTrack } from "../../core/tagging-run.store"
import { IconComponent } from "../../shared/components/icon.component"
import { NoValueComponent } from "../../shared/components/no-value.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { FADE_IN } from "../../shared/utils/motion"

/** Une ligne de la grille ; `key` nulle pour le commentaire, qui n'a pas de champ ecrit. */
interface DetailRow {
  readonly id: string
  readonly labelKey: string
  readonly key: string | null
  readonly before: string | null
  readonly after: string | null
}

const valuesOf = (fields: readonly TagValue[] | null | undefined): Map<string, string | null> =>
  new Map(fields?.map((field) => [field.field, field.value]))

/** Detail d'un morceau deplie (maquette `TrackDetail`) ; ordre et cles viennent du sidecar. */
@Component({
  selector: "app-track-detail",
  imports: [TranslatePipe, Skeleton, IconComponent, NoValueComponent, TruncatedTextComponent],
  templateUrl: "./track-detail.component.html",
  host: { class: "block" },
})
export class TrackDetailComponent {
  protected readonly FADE_IN = FADE_IN

  readonly track = input.required<TaggingTrack>()
  /** Run arrete avant ce morceau : sa pochette ne viendra plus, pas de squelette. */
  readonly interrupted = input(false)

  protected readonly artworkUrl = computed(() => {
    const path = this.track().artworkPath

    return path === null ? null : convertFileSrc(path)
  })
  protected readonly pending = computed(() => this.track().state === null && !this.interrupted())
  /** `null` : ni avant ni apres, le fichier n'a pas pu etre lu et n'a pas ete resolu. */
  protected readonly rows = computed<readonly DetailRow[] | null>(() => {
    const { tagsBefore, tagsAfter } = this.track()
    const base = tagsBefore?.fields ?? tagsAfter
    if (base === null) {
      return null
    }
    const before = valuesOf(tagsBefore?.fields)
    const after = valuesOf(tagsAfter)
    const rows: DetailRow[] = base.map(({ field, key }) => ({
      id: field,
      labelKey: `tagging.detail.field.${field}`,
      key,
      before: before.get(field) ?? null,
      after: after.get(field) ?? null,
    }))
    const comment = tagsBefore?.comment ?? null
    // L'ecriture supprime tout commentaire : son Apres est toujours vide.
    return comment === null
      ? rows
      : [
          ...rows,
          {
            id: "comment",
            labelKey: "tagging.detail.field.comment",
            key: null,
            before: comment,
            after: null,
          },
        ]
  })
}
```

Créer `src/app/features/tagging/track-detail.component.html` :

```html
<div class="flex items-start gap-6 p-4">
  @if (artworkUrl(); as url) {
    <img
      class="shrink-0 rounded-sm"
      width="160"
      height="160"
      alt=""
      [src]="url"
      [animate.enter]="FADE_IN"
    />
  } @else if (pending()) {
    <p-skeleton width="160px" height="160px" borderRadius="var(--p-border-radius-sm)" />
  } @else {
    <div
      class="flex size-40 shrink-0 items-center justify-center rounded-sm border border-surface bg-surface-800 text-muted-color"
    >
      <app-icon name="image" [size]="24" />
    </div>
  }

  <div class="min-w-0 flex-auto text-xs">
    @if (rows(); as rows) {
      <div class="grid grid-cols-3 gap-x-4 border-b border-surface pb-2 text-muted-color">
        <span>{{ "tagging.detail.heading.field" | translate }}</span>
        <span>{{ "tagging.detail.heading.before" | translate }}</span>
        <span>{{ "tagging.detail.heading.after" | translate }}</span>
      </div>
      @for (row of rows; track row.id) {
        <div class="grid grid-cols-3 gap-x-4 py-1" data-detail-row>
          <span class="flex min-w-0 gap-1">
            <span class="truncate" data-cell>{{ row.labelKey | translate }}</span>
            <span class="truncate text-muted-color" data-cell>{{ row.key ?? "" }}</span>
          </span>
          <span class="min-w-0 text-muted-color" data-cell>
            @if (row.before; as before) {
              <app-truncated-text [text]="before" />
            } @else {
              <app-no-value />
            }
          </span>
          <span class="min-w-0" data-cell>
            @if (row.after; as after) {
              <app-truncated-text [text]="after" />
            } @else {
              <app-no-value />
            }
          </span>
        </div>
      }
    } @else {
      <p class="text-muted-color" data-unreadable>{{ "tagging.detail.unreadable" | translate }}</p>
    }
  </div>
</div>
```

- [ ] **Step 4: Traduire le détail**

Dans `tagging` de `public/i18n/fr.json`, après `list` :

```json
    "detail": {
      "heading": { "field": "Champ", "before": "Avant", "after": "Après" },
      "field": {
        "artist": "Artiste",
        "remixer": "Remixeur",
        "title": "Titre",
        "album": "Album",
        "date": "Année",
        "original_date": "Année d'origine",
        "genre": "Genre",
        "label": "Label",
        "catalog_number": "Numéro de catalogue",
        "bpm": "BPM",
        "key": "Key",
        "isrc": "ISRC",
        "track_number": "Numéro de piste",
        "url": "URL",
        "source_id": "Identifiant à la source",
        "source": "Source",
        "comment": "Commentaire"
      },
      "unreadable": "Les tags de ce fichier n'ont pas pu être lus."
    },
```

Dans `public/i18n/en.json`, au même endroit :

```json
    "detail": {
      "heading": { "field": "Field", "before": "Before", "after": "After" },
      "field": {
        "artist": "Artist",
        "remixer": "Remixer",
        "title": "Title",
        "album": "Album",
        "date": "Year",
        "original_date": "Original year",
        "genre": "Genre",
        "label": "Label",
        "catalog_number": "Catalog number",
        "bpm": "BPM",
        "key": "Key",
        "isrc": "ISRC",
        "track_number": "Track number",
        "url": "URL",
        "source_id": "Source ID",
        "source": "Source",
        "comment": "Comment"
      },
      "unreadable": "This file's tags could not be read."
    },
```

- [ ] **Step 5: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS (`translations.spec.ts` compris)

- [ ] **Step 6: Commit**

```bash
git add src/app/features/tagging/track-detail.component.ts src/app/features/tagging/track-detail.component.html src/app/features/tagging/track-detail.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): détail avant / après d'un morceau"
```

---

### Task 3: Déplier une ligne de la liste du run

**Files:**
- Modify: `src/app/shared/components/icon.component.ts` (`chevron-down`)
- Modify: `src/app/features/tagging/run-list.component.ts`
- Modify: `src/app/features/tagging/run-list.component.html`
- Modify: `src/app/features/tagging/run-list.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.list.expand`, `tagging.list.collapse`)

**Interfaces:**
- Consumes: Task 2 (`TrackDetailComponent`, inputs `track`, `interrupted`) ; `pRowToggler` et le contexte `expanded` du `#body` de `p-table` (essayés le 2026-10-06 sur la spec existante : dépliage et repli sous `whenStable`, sans émettre `arbitrate`).
- Produces: icône `chevron-down` ; liste du run à sept colonnes, la première portant le chevron (`data-row-toggle`).

- [ ] **Step 1: Écrire les specs**

Dans `src/app/features/tagging/run-list.component.spec.ts` :

Supprimer `stubOffscreenLayout`, son appel dans le `beforeEach` (et le `beforeEach` devenu vide) et son appel dans `hints at pasting a link on an unresolved recoverable row only`. Dans `mountWith`, supprimer le commentaire « Le scroller s'initialise… » et les trois lignes qui le suivent (`await Promise.resolve()`, `await new Promise(…)`, `fixture.detectChanges()`) : la table n'est plus virtualisée, les 15 cas existants passent sans eux (essayé le 2026-10-06). `mountWith` se termine alors par une attente de stabilité : sans `await`, la fonction `async` serait refusée par ESLint (`require-await`).

```ts
  fixture.detectChanges()
  await fixture.whenStable()

  return fixture
```

Les constantes de colonnes deviennent :

```ts
/** Les sept colonnes, dans l'ordre du template. */
const ART = 1
const BEFORE = 2
const AFTER = 3
const SOURCE = 4
const SCORE = 5
```

Importer `TAGS_AFTER` et `TAGS_BEFORE` des fixtures, puis ajouter :

```ts
  const toggleOf = (fixture: { nativeElement: unknown }): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("[data-row-toggle]")

  it("unfolds and folds a row from its chevron without asking for arbitration", async () => {
    const fixture = await mountWith([
      {
        ...PENDING_TRACK,
        tagsBefore: TAGS_BEFORE,
        arbitration: arbitrationRequired(PENDING_TRACK.trackId),
      },
    ])
    const asked = vi.fn()
    fixture.componentInstance.arbitrate.subscribe(asked)
    const root = fixture.nativeElement as HTMLElement

    toggleOf(fixture)?.click()
    await fixture.whenStable()
    const unfolded = root.querySelector("app-track-detail") !== null
    const expanded = toggleOf(fixture)?.getAttribute("aria-expanded")
    toggleOf(fixture)?.click()
    await fixture.whenStable()

    expect(unfolded).toBe(true)
    expect(expanded).toBe("true")
    expect(root.querySelector("app-track-detail")).toBeNull()
    expect(asked).not.toHaveBeenCalled()
  })

  it.each(["Enter", " "])(
    "keeps the chevron keys away from the row action (%j)",
    async (key) => {
      const fixture = await mountWith([
        { ...PENDING_TRACK, arbitration: arbitrationRequired(PENDING_TRACK.trackId) },
      ])
      const asked = vi.fn()
      fixture.componentInstance.arbitrate.subscribe(asked)

      toggleOf(fixture)?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

      expect(toggleOf(fixture)).not.toBeNull()
      expect(asked).not.toHaveBeenCalled()
    },
  )

  it("unfolds a recoverable row without asking to recover it", async () => {
    const fixture = await mountWith([UNRESOLVED], new Set([UNRESOLVED.trackId]))
    const asked = vi.fn()
    fixture.componentInstance.recover.subscribe(asked)

    toggleOf(fixture)?.click()
    await fixture.whenStable()

    expect(asked).not.toHaveBeenCalled()
    expect((fixture.nativeElement as HTMLElement).querySelector("app-track-detail")).not.toBeNull()
  })

  it("keeps a row unfolded when its track is resolved", async () => {
    const fixture = await mountWith([{ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }])
    toggleOf(fixture)?.click()
    await fixture.whenStable()

    fixture.componentRef.setInput("tracks", [
      { ...TRACK, tagsBefore: TAGS_BEFORE, tagsAfter: TAGS_AFTER },
    ])
    await fixture.whenStable()

    const detail = (fixture.nativeElement as HTMLElement).querySelector("app-track-detail")
    expect(detail).not.toBeNull()
    expect(detail?.textContent).toContain("Lior Vance")
  })
```

- [ ] **Step 2: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL, `toggleOf(fixture)` nul et indices de colonnes décalés (`converts an artwork path into an asset url` trouve sa cellule à l'indice 0)

- [ ] **Step 3: Ajouter l'icône**

Dans `src/app/shared/components/icon.component.ts`, importer `import { ChevronDown } from "@primeicons/angular/chevron-down"`, ajouter `"chevron-down"` à `ICON_NAMES` avant `"chevron-left"`, `ChevronDown` aux `imports` du composant et dans le `@switch` :

```html
      @case ("chevron-down") {
        <svg data-p-icon="chevron-down" [size]="size()" />
      }
```

`icon.component.spec.ts` parcourt `ICON_NAMES` et couvre la nouvelle icône.

- [ ] **Step 4: Brancher le chevron et le détail**

Dans `src/app/features/tagging/run-list.component.ts` : ajouter `ButtonDirective` (`primeng/button`) et `TrackDetailComponent` (`./track-detail.component`) aux `imports` ; le commentaire de `ROW_HEIGHT` devient `/** Hauteur de \`h-14\` sur le \`<tr>\`, que reprennent les lignes en squelette. */` ; ajouter dans la classe :

```ts
  /** Le dépliage suit le morceau d'un evenement a l'autre, pas l'objet ligne recree. */
  protected readonly byTrackId = (_index: number, row: RunRow): string => row.trackId
```

Dans `run-list.component.html` :

1. Sur `<p-table>`, retirer `[virtualScroll]="true"` et `[virtualScrollItemSize]="ROW_HEIGHT"`, ajouter `[rowTrackBy]="byTrackId"` ; au-dessus de la balise :

```html
<!-- Pas de scroll virtuel : une ligne depliee decalerait toutes les suivantes. -->
```

2. En tête de l'en-tête :

```html
      <!-- Bouton small de 32px plus les marges de la cellule ; a remesurer a l'ecran. -->
      <th class="w-16"></th>
```

3. `<ng-template #body let-track>` devient `<ng-template #body let-track let-expanded="expanded">` ; la première cellule de la ligne, avant celle de la vignette :

```html
      <td>
        <!-- Le chevron garde ses clics et ses touches : la ligne ouvre l'arbitrage ou le lien. -->
        <button
          pButton
          type="button"
          size="small"
          [text]="true"
          severity="secondary"
          data-row-toggle
          [pRowToggler]="track"
          [attr.aria-expanded]="expanded"
          [attr.aria-label]="(expanded ? 'tagging.list.collapse' : 'tagging.list.expand') | translate"
          (click)="$event.stopPropagation()"
          (keydown.enter)="$event.stopPropagation()"
          (keydown.space)="$event.stopPropagation()"
        >
          <app-icon [name]="expanded ? 'chevron-down' : 'chevron-right'" [size]="16" />
        </button>
      </td>
```

4. Avant `<ng-template #emptymessage>` :

```html
  <ng-template #expandedrow let-track>
    <tr>
      <td colspan="7" class="bg-surface-950 p-0">
        <app-track-detail [track]="track" [interrupted]="interrupted()" />
      </td>
    </tr>
  </ng-template>
```

5. Les deux `colspan="6"` du `#emptymessage` passent à `colspan="7"`.

- [ ] **Step 5: Traduire le chevron**

Dans `tagging.list`, après `addLink` : `fr.json` `"expand": "Déplier", "collapse": "Replier",` ; `en.json` `"expand": "Expand", "collapse": "Collapse",`.

- [ ] **Step 6: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS

- [ ] **Step 7: Vérifier à l'écran**

Run: `just dev-ui`, ouvrir l'onglet Tagging sur les fixtures de développement, déplier un morceau résolu, un non résolu et un à arbitrer. Attendu : pochette en 160px, grille fidèle à `TrackDetail` aux écarts près (16 lignes, clé `TYER`, pas de `TPE2`), le clic sur une ligne à arbitrer ouvre toujours la modale, la liste défile sans saut avec plusieurs lignes ouvertes. Relever la largeur de la colonne du chevron (`w-16`) en français et en anglais, puis l'ajuster au besoin. Arrêter par `just stop`.

- [ ] **Step 8: Commit**

```bash
git add src/app/shared/components/icon.component.ts src/app/features/tagging/run-list.component.ts src/app/features/tagging/run-list.component.html src/app/features/tagging/run-list.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): déplier un morceau de la liste du run"
```

---

### Task 4: DESIGN.md et notes de sync de la maquette

**Files:**
- Modify: `docs/DESIGN.md` (§ Layout & Espacement, ligne Tables et tableau des colonnes de la liste du run ; § Structure de Page et § Responsive, jeu de colonnes ; mapping « Liste des morceaux d'un run » et « Détail avant / après » ; § Arbitrages)
- Modify: `docs/knowledges/primeng.md` (§ Table défilante)
- Modify: `.design-sync/NOTES.md` (§ Reste ouvert)

- [ ] **Step 1: Mettre DESIGN.md à jour**

Charger `Skill[design-doc]` et lire son template avant d'éditer. Dans `docs/DESIGN.md` :
- ligne « Tables » du § Layout : ajouter « sauf la liste du run, dont les lignes se déplient : le scroll virtuel de PrimeNG ne connaît qu'une hauteur de ligne et ferait sauter la liste. Elle compte quelques centaines de morceaux, le rapport d'extraction garde le sien » ;
- ligne « Liste des morceaux d'un run » du mapping (`docs/DESIGN.md:271`) : `p-table` `[scrollable]` sans `[virtualScroll]`, « Sept colonnes » au lieu de « Six » ;
- jeu de colonnes : `docs/DESIGN.md:456` et `:514`, « six colonnes » devient « sept colonnes » avec le chevron ; tableau « Colonnes de la liste d'un run » (`:470-479`), qui gagne en première ligne « Chevron | 64px fixe | Bouton `small` de 32px plus les marges de la cellule, à remesurer à l'écran » ;
- ligne « Détail avant / après » du mapping : « Chevron en tête de ligne (`pRowToggler`), qui ne déclenche ni l'arbitrage ni le lien ; pochette en 160px, grille Champ / Avant / Après, toujours les 16 champs écrits plus le commentaire du fichier » ; dans la colonne Composant, `pRowToggler` + `<ng-template #expandedrow>` à la place de `[expandedRowKeys]` ;
- § Arbitrages, à la suite : « **Lignes du détail avant / après** : les 16 champs écrits avec la clé du fichier écrit, plus le commentaire, là où `TrackDetail` montrait `TPE2`, la date complète et une traçabilité combinée. Le détail montre ce que l'écriture fait. Décidé le 2026-10-06 ».

Charger `Skill[knowledge-doc]` et lire son template avant d'éditer. Dans `docs/knowledges/primeng.md` § Table défilante, Points Importants, ajouter une puce : « **`#expandedrow` ne va pas avec le scroll virtuel** : le scroller place chaque ligne à `rang × virtualScrollItemSize` et dimensionne son espaceur sur le même produit, sans mesure ; une ligne dépliée de hauteur variable décale donc toutes les suivantes (lu dans `primeng-scroller.mjs`, PrimeNG 22.1.2, 2026-10-06). Une table à lignes dépliables se rend sans `[virtualScroll]` ».

- [ ] **Step 2: Consigner le reste ouvert de la maquette**

Dans `.design-sync/NOTES.md` § Reste ouvert, ajouter : « `TrackDetail` (`TaggingScreen.jsx`, `data.js` `detail`) : 12 lignes avec `TPE2`, date complète et « Traçabilité » ; le code livre les 16 champs écrits (remixeur, année d'origine, numéro de piste, URL, identifiant à la source, source), `TYER` / `TORY` et une ligne Commentaire (2026-10-06) ».

- [ ] **Step 3: Vérifier le rendu**

Run: `just format-ui && just lint-ui`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/DESIGN.md docs/knowledges/primeng.md .design-sync/NOTES.md
git commit -m "docs(design): liste du run non virtualisée et lignes du détail"
```
