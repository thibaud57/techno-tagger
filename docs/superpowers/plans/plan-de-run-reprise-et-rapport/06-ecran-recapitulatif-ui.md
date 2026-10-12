# Écran récapitulatif d'un run : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher le récapitulatif filtrable d'un run écrit, avec la recherche, l'avant / après de chaque morceau et le lien vers sa fiche source.

**Architecture:** Une règle pure (`recap-filter.ts`) porte les quatre filtres, leurs compteurs et la recherche. `TaggingTrack` reçoit `sourceUrl`, que `TrackDetail` rend en lien ouvert par le plugin `opener`. Le geste « Restaurer le run » est extrait de la page Tagging dans `injectRunRestore()`, que la page et le récapitulatif appellent. `SidecarService.clearRun()` vide le run affiché par `TaggingRunStore.clear()`. `RecapPageComponent`, sur la route `tagging/recap`, réutilise `RunListComponent` (figé, avec un état vide paramétrable) et lie ses filtres par Signal Forms. La page Tagging gagne le bouton « Récapitulatif » à la fin de l'écriture.

**Tech Stack:** Angular 22 (signals, Signal Forms, `loadComponent`), PrimeNG 22 (`p-selectbutton`, `p-iconfield`, `p-table`), `@tauri-apps/plugin-opener`, `@primeicons/angular`, ngx-translate 18, Vitest.

**Spec:** `docs/superpowers/specs/plan-de-run-reprise-et-rapport/06-ecran-recapitulatif-ui-design.md`

## Global Constraints

- **Dépend du sub-project 04** (`TrackResolvedEvent.source_url` dans `protocol.ts`, que `TRACK_RESOLVED` porte déjà) et du **sub-project 05** (`SidecarService.prepareRun`, privé, élargi ici à `string | null` et employé par `clearRun()`).
- **Règle des filtres** :
  - échecs : `state ∈ {unresolved, write_error}` ;
  - validés : `state ∈ {resolved, written}` et `resolution = auto` ;
  - arbitrés : `state ∈ {resolved, written}` et `resolution ∈ {arbitration, url}` ;
  - un `rolled_back` n'est dans aucun filtre.
- **Recherche** : artiste et titre d'origine, nom de fichier, casse et espaces de bord ignorés.
- **Route** : `tagging/recap`, `loadComponent`, `export default`, déclarée avant le `**`.
- **Hôte de l'écran** : `host: { class: PAGE_HOST, "animate.enter": FADE_IN }`, comme les trois pages d'onglet. Aucune classe de fondu posée à la main dans le template.
- **Formulaire** : filtre et recherche en Signal Forms (`form()` et `[formField]`), comme la page Playlist (`.claude/rules/angular/forms.md`). `p-selectbutton` : options avec un `label` traduit et `ariaLabelledBy`. Recherche : `aria-label`.
- **Lien source** : bouton `link`, sans `size`. `openUrl(sourceUrl)` de `@tauri-apps/plugin-opener`. Icône `external-link`.
- **Icônes ajoutées** à `ICON_NAMES` : `search`, `external-link`, `plus`, importées par sous-chemin (`@primeicons/angular/search`…). Chacune a son `@case`.
- **« Envoyer ce rapport » absent** : il relève de la Feature 9.
- **Aucun `changeDetection` déclaré** : `OnPush` est le défaut d'Angular 22. Filtrage par `computed`, jamais par pipe. Fonctions `const f = () =>`.
- **Tokens seulement**, `gap-6` entre sections, `size="small"` sur tout bouton sauf `link`, tooltips par `[tooltipOptions]="tooltip"` (`TOOLTIP`).
- **Textes** : clés FR et EN dans le même commit, espace insécable U+00A0 avant `:`, `;`, `?` et `!` en français.
- **Tests** : noms en anglais, AAA, traductions en clés brutes. La table est en scroll virtuel : tout test qui compte des lignes stubbe la mise en page et les timers par `src/fixtures/virtual-scroll.ts`.
- **Gate vert à chaque commit** : `just format-ui` puis `just lint-ui && just typecheck-ui && just test-ui`. Commits `feat(ui): …`.

## Review Focus

- **Run entièrement restauré** (tous `rolled_back`) : « Tout » les montre, les trois autres filtres valent 0 (Task 1, `counts nothing in the three filters for a fully restored run`).
- **Recherche avec espaces autour** (`"  orbit "`) : même résultat que `"orbit"` (Task 1, `ignores the spaces around the search`).
- **Morceau sans URL de source** (rattrapage sans URL, run d'avant le sub-project 04) : la ligne URL reste du texte, sans lien (Task 2, `keeps the url line as text without a source page`).
- **Récapitulatif ouvert sans run** (route saisie, run vidé) : état encadré « Aucun run à récapituler » (Task 5, `shows a framed empty state without a run`).
- **Restauration en cours depuis le récapitulatif** : « Restaurer le run » désactivé avec son tooltip, comme dans la liste (Task 5, `disables the run restore while files are busy`).
- **« Nouveau run » puis un nouveau lancement** : la page n'est pas bloquée « en cours » (Task 4, `lets a new run start after the displayed one is cleared`).
- **Détail ouvert sur un morceau que le filtre retire** : il se referme (Task 5, `closes the detail of a track the filter hides`).
- **Échecs d'écriture** : le message compte les morceaux affichés (Task 5, `announces the write failures of the displayed tracks`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/features/tagging/recap-filter.ts` | Filtres, compteurs, recherche |
| `src/app/core/tagging-run.store.ts` | `sourceUrl` dans `TaggingTrack`, `clear()` |
| `src/app/features/tagging/track-detail.component.*` | Lien vers la fiche source |
| `src/app/shared/components/icon.component.ts` | `search`, `external-link`, `plus` |
| `src/app/features/tagging/run-restore.ts` | `injectRunRestore()`, partagé par la liste et le récap |
| `src/app/core/sidecar.service.ts` | `prepareRun(string \| null)`, `clearRun()` |
| `src/fixtures/virtual-scroll.ts` | `stubOffscreenLayout`, `settleScroller` : mise en page et timers du scroll virtuel |
| `src/app/features/tagging/run-list.component.*` | État vide paramétrable |
| `src/app/features/tagging/recap-page.component.*` | Écran récapitulatif |
| `src/app/app.routes.ts` | Route `tagging/recap` |
| `src/app/features/tagging/tagging-page.component.*` | Restauration par `injectRunRestore()`, bouton « Récapitulatif » |
| `src/fixtures/tagging.ts` | `sourceUrl` |
| `public/i18n/{fr,en}.json` | `recap.*`, `tagging.recap`, `tagging.detail.openSource` |
| `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `.design-sync/NOTES.md` | Récap, lien source, arbitrages, ouverture par bouton |

---

### Task 1: Règle des filtres et de la recherche

**Files:**
- Create: `src/app/features/tagging/recap-filter.ts`, `recap-filter.spec.ts`

**Interfaces:**
- Consumes: `TaggingTrack` (`core/tagging-run.store.ts`).
- Produces :
  - `type RecapFilter = "all" | "validated" | "arbitrated" | "failed"` ;
  - `RECAP_FILTERS: readonly RecapFilter[]` ;
  - `inFilter(track: TaggingTrack, filter: RecapFilter): boolean` ;
  - `recapCounts(tracks: readonly TaggingTrack[]): Record<RecapFilter, number>` ;
  - `matchesSearch(track: TaggingTrack, query: string): boolean`.

- [ ] **Step 1: Écrire les tests**

`src/app/features/tagging/recap-filter.spec.ts` :

```ts
import { resolvedTrack } from "../../../fixtures/tagging"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { inFilter, matchesSearch, recapCounts, type RecapFilter } from "./recap-filter"

const track = (overrides: Partial<TaggingTrack>): TaggingTrack => ({
  ...resolvedTrack("t"),
  ...overrides,
})

const AUTO = track({ trackId: "auto", state: "written", resolution: "auto" })
const ARBITRATED = track({ trackId: "arbitrated", state: "written", resolution: "arbitration" })
const BY_URL = track({ trackId: "url", state: "resolved", resolution: "url" })
const FAILED_WRITE = track({
  trackId: "failed-write",
  state: "write_error",
  resolution: "arbitration",
})
const UNRESOLVED = track({ trackId: "unresolved", state: "unresolved", resolution: "none" })
const RESTORED = track({ trackId: "restored", state: "rolled_back", resolution: "auto" })
const RUN = [AUTO, ARBITRATED, BY_URL, FAILED_WRITE, UNRESOLVED, RESTORED]

const kept = (filter: RecapFilter): string[] =>
  RUN.filter((candidate) => inFilter(candidate, filter)).map((candidate) => candidate.trackId)

describe("recap filters", () => {
  it.each<[RecapFilter, string[]]>([
    ["all", ["auto", "arbitrated", "url", "failed-write", "unresolved", "restored"]],
    ["validated", ["auto"]],
    ["arbitrated", ["arbitrated", "url"]],
    ["failed", ["failed-write", "unresolved"]],
  ])("keeps in %s the tracks the rule names", (filter, expected) => {
    const result = kept(filter)

    expect(result).toEqual(expected)
  })

  it("counts each filter with the same rule", () => {
    const counts = recapCounts(RUN)

    expect(counts).toEqual({ all: 6, validated: 1, arbitrated: 2, failed: 2 })
  })

  it("counts nothing in the three filters for a fully restored run", () => {
    const counts = recapCounts([RESTORED, { ...RESTORED, trackId: "restored-2" }])

    expect(counts).toEqual({ all: 2, validated: 0, arbitrated: 0, failed: 0 })
  })

  it("searches the original artist, title and file name, ignoring case", () => {
    const tagged = track({ artist: "Lior Vance", title: "Dim Orbit", fileName: "a.mp3" })

    const matches = ["lior", "ORBIT", "a.mp3", "kelvor"].map((query) =>
      matchesSearch(tagged, query),
    )

    expect(matches).toEqual([true, true, true, false])
  })

  it("ignores the spaces around the search", () => {
    const tagged = track({ title: "Dim Orbit" })

    const matched = matchesSearch(tagged, "  orbit ")

    expect(matched).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/features/tagging/recap-filter.spec.ts --watch=false`
Expected: FAIL, module `./recap-filter` introuvable.

- [ ] **Step 3: Écrire la règle**

`src/app/features/tagging/recap-filter.ts` :

```ts
import type { TaggingTrack } from "../../core/tagging-run.store"

export type RecapFilter = "all" | "validated" | "arbitrated" | "failed"

export const RECAP_FILTERS: readonly RecapFilter[] = ["all", "validated", "arbitrated", "failed"]

/** Tranche par le run et toujours debout : un echec d'ecriture arbitre n'est qu'un echec. */
const settled = (track: TaggingTrack): boolean =>
  track.state === "resolved" || track.state === "written"

/**
 * Regle de DESIGN.md § Conventions de Code : « Echecs » lit `state`, « Valides » et « Arbitres »
 * lisent `state` puis `resolution`. Un `rolled_back` n'appartient a aucun filtre.
 */
export const inFilter = (track: TaggingTrack, filter: RecapFilter): boolean => {
  switch (filter) {
    case "all":
      return true
    case "validated":
      return settled(track) && track.resolution === "auto"
    case "arbitrated":
      return settled(track) && (track.resolution === "arbitration" || track.resolution === "url")
    case "failed":
      return track.state === "unresolved" || track.state === "write_error"
    default: {
      const exhaustive: never = filter

      return exhaustive
    }
  }
}

/** La somme des trois filtres peut etre inferieure a « Tout » : les restaures n'y sont pas. */
export const recapCounts = (tracks: readonly TaggingTrack[]): Record<RecapFilter, number> => ({
  all: tracks.length,
  validated: tracks.filter((track) => inFilter(track, "validated")).length,
  arbitrated: tracks.filter((track) => inFilter(track, "arbitrated")).length,
  failed: tracks.filter((track) => inFilter(track, "failed")).length,
})

export const matchesSearch = (track: TaggingTrack, query: string): boolean => {
  const needle = query.trim().toLocaleLowerCase()

  return (
    needle === "" ||
    [track.artist, track.title, track.fileName].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    )
  )
}
```

- [ ] **Step 4: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/features/tagging/recap-filter.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 5: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/features/tagging/recap-filter.ts src/app/features/tagging/recap-filter.spec.ts
git commit -m "feat(ui): regle des filtres et de la recherche du recapitulatif"
```

---

### Task 2: Lien vers la fiche source

**Files:**
- Modify: `src/app/core/tagging-run.store.ts`, `tagging-run.store.spec.ts`
- Modify: `src/fixtures/tagging.ts`
- Modify: `src/app/shared/components/icon.component.ts`
- Modify: `src/app/features/tagging/track-detail.component.ts`, `.html`, `.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `TrackResolvedEvent.source_url` (04).
- Produces :
  - `TaggingTrack.sourceUrl: string | null` ;
  - `IconName` étendu de `"search"`, `"external-link"` et `"plus"` ;
  - le bouton `data-action="open-source"` de la ligne URL du détail.

- [ ] **Step 1: Écrire les tests**

Dans `src/app/core/tagging-run.store.spec.ts`, après `updates a track with its state, source, names, scores and artwork` :

```ts
  it("keeps the source page of a resolved track", () => {
    store.reset()
    store.started(RUN_STARTED)

    store.resolved({
      ...TRACK_RESOLVED,
      source_url: "https://www.beatport.com/track/dim-orbit/99000101",
    })

    expect(store.tracks()[0]?.sourceUrl).toBe("https://www.beatport.com/track/dim-orbit/99000101")
  })
```

Dans `src/app/features/tagging/track-detail.component.spec.ts` :

1. Après l'import de `provideTranslateService`, ajouter `import { openUrl } from "@tauri-apps/plugin-opener"` et après les imports du fichier :

```ts
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }))
```

2. Après la constante `RESOLVED`, la fiche d'un morceau écrit depuis Beatport, dont le fichier porte la ligne `url` (clé `WOAS` en ID3) :

```ts
const SOURCE_URL = "https://www.beatport.com/track/dim-orbit/99000101"

const WITH_SOURCE: TaggingTrack = {
  ...RESOLVED,
  sourceUrl: SOURCE_URL,
  tagsBefore: {
    ...TAGS_BEFORE,
    comment: null,
    fields: [...TAGS_BEFORE.fields, { field: "url", key: "WOAS", value: null }],
  },
  tagsAfter: [...TAGS_AFTER, { field: "url", key: "WOAS", value: SOURCE_URL }],
}
```

3. À la fin du `describe` :

```ts
  it("opens the source page from the url line", () => {
    const root = mount(WITH_SOURCE)

    root.querySelector<HTMLButtonElement>('[data-action="open-source"]')?.click()

    expect(openUrl).toHaveBeenCalledWith(SOURCE_URL)
  })

  it("puts the link on the url line only", () => {
    const root = mount(WITH_SOURCE)

    const links = root.querySelectorAll('[data-action="open-source"]')

    expect(links).toHaveLength(1)
  })

  it("keeps the url line as text without a source page", () => {
    const root = mount({ ...WITH_SOURCE, sourceUrl: null })

    const link = root.querySelector('[data-action="open-source"]')

    expect(link).toBeNull()
    expect(rowsOf(root).at(-1)?.[3]).toBe(SOURCE_URL)
  })
```

`mount`, `rowsOf`, `RESOLVED`, `TAGS_BEFORE` et `TAGS_AFTER` sont ceux du fichier. Le `mount` rend l'`HTMLElement` de l'hôte : le bouton se cherche dedans.

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/core/tagging-run.store.spec.ts --include src/app/features/tagging/track-detail.component.spec.ts --watch=false`
Expected: FAIL, `sourceUrl` absent de `TaggingTrack` et aucun `[data-action="open-source"]`.

- [ ] **Step 3: Porter `sourceUrl`**

Dans `src/app/core/tagging-run.store.ts` :
- dans `TaggingTrack`, après `tagsAfter` :

```ts
  /** Fiche de la source retenue, ouverte depuis le detail ; nulle sans candidat. */
  readonly sourceUrl: string | null
```

- dans `pending` : `sourceUrl: null,` après `tagsAfter: null,` ;
- dans `resolved` : `sourceUrl: event.source_url,` après `tagsAfter: event.tags_after,`. La projection d'un `rolled_back` de `restored()` passe par `resolved()` avec `source_url: null` (sub-project 04) : aucune autre ligne à écrire.

Dans `src/fixtures/tagging.ts`, ajouter `sourceUrl: null,` à `PENDING_TRACK`, après `tagsAfter: null,`. Seuls `PENDING_TRACK` et `pending()` écrivent un `TaggingTrack` en entier : les autres littéraux étalent l'un d'eux.

- [ ] **Step 4: Ajouter les icônes**

Dans `src/app/shared/components/icon.component.ts` :
- ajouter les trois imports, au rang alphabétique de leur sous-chemin :

```ts
import { ExternalLink } from "@primeicons/angular/external-link"
import { Plus } from "@primeicons/angular/plus"
import { Search } from "@primeicons/angular/search"
```

- ajouter `"search"`, `"external-link"` et `"plus"` à la fin de `ICON_NAMES`, après `"undo"` ;
- ajouter `ExternalLink`, `Plus` et `Search` au tableau `imports` du composant ;
- ajouter les trois `@case`, après `@case ("undo")` :

```html
      @case ("search") {
        <svg data-p-icon="search" [size]="size()" />
      }
      @case ("external-link") {
        <svg data-p-icon="external-link" [size]="size()" />
      }
      @case ("plus") {
        <svg data-p-icon="plus" [size]="size()" />
      }
```

Le test d'exhaustivité de `icon.component.spec.ts` parcourt `ICON_NAMES` : il couvre les trois ajouts sans modification.

- [ ] **Step 5: Rendre le lien dans le détail**

Dans `src/app/features/tagging/track-detail.component.ts` :
- importer `openUrl` : `import { openUrl } from "@tauri-apps/plugin-opener"`, entre l'import de `@ngx-translate/core` et celui de `primeng/button` ;
- ajouter `field` à `DetailRow`, avant `key` :

```ts
  /** Champ ecrit ; nul pour le commentaire, qui n'en a pas. */
  readonly field: TagField | null
```

- dans `rows`, ajouter `field` à la ligne construite depuis `shown` (le `map` reçoit déjà `{ field, key }`) et `field: null` à la ligne du commentaire :

```ts
    const rows: DetailRow[] = shown.map(({ field, key }) => ({
      labelKey: `tagging.detail.field.${field}`,
      field,
      key,
      before: before.get(field) ?? null,
      after: after.get(field) ?? null,
    }))
```

```ts
      rows.push({
        labelKey: "tagging.detail.field.comment",
        field: null,
        key: null,
        before: comment,
        after: null,
      })
```

- ajouter la méthode, sous `rows` :

```ts
  /** Le navigateur par defaut : la webview n'ouvre aucune page externe. */
  protected openSource(url: string): void {
    openUrl(url).catch((error: unknown) => {
      console.error("[track-detail] fiche source non ouverte", error)
    })
  }
```

Dans `track-detail.component.html`, remplacer le contenu de la cellule Après (le `<span class="min-w-0" data-cell>` de `{{ row.after }}`) :

```html
            <span class="min-w-0" data-cell>
              @if (row.field === "url" && track().sourceUrl; as url) {
                <button
                  pButton
                  type="button"
                  [link]="true"
                  class="max-w-full p-0 text-xs"
                  data-action="open-source"
                  [attr.aria-label]="'tagging.detail.openSource' | translate"
                  (click)="openSource(url)"
                >
                  <app-truncated-text [text]="url" />
                  <app-icon name="external-link" [size]="16" />
                </button>
              } @else if (row.after; as after) {
                <app-truncated-text [text]="after" />
              } @else {
                <app-no-value />
              }
            </span>
```

Le lien est en `text-xs` comme le reste de la grille : `DETAIL_SPANS` a été mesuré en `text-xs` sur le plus haut contenu. Un bouton plus haut ferait défiler le détail. Si le contrôle visuel de `/verify` montre une ligne URL plus haute que les autres, remesurer `DETAIL_SPANS` plutôt que d'élargir le lien.

Textes, `public/i18n/fr.json` sous `tagging.detail` : `"openSource": "Ouvrir la fiche source dans le navigateur"` ; `en.json` : `"openSource": "Open the source page in the browser"`.

- [ ] **Step 6: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/core/tagging-run.store.spec.ts --include src/app/features/tagging/track-detail.component.spec.ts --include src/app/shared/components/icon.component.spec.ts --include src/app/core/translations.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 7: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/core/tagging-run.store.ts src/app/core/tagging-run.store.spec.ts src/app/shared/components/icon.component.ts src/app/features/tagging/track-detail.component.ts src/app/features/tagging/track-detail.component.html src/app/features/tagging/track-detail.component.spec.ts src/fixtures/tagging.ts public/i18n
git commit -m "feat(ui): lien vers la fiche source dans le detail d'un morceau"
```

---

### Task 3: Restauration partagée entre la page Tagging et le récapitulatif

**Files:**
- Create: `src/app/features/tagging/run-restore.ts`
- Modify: `src/app/features/tagging/tagging-page.component.ts`, `.html`, `.spec.ts`

**Interfaces:**
- Consumes : `SidecarService.taggingTracks`, `writing`, `filesBusy`, `rollingBack`, `rollbackFinished`, `taggingRunId`, `rollback` ; `injectDangerConfirm`.
- Produces : `injectRunRestore()` rend `{ restorableIds, canRestoreRun, restoringRun, restoringTrackId, runRollbackFailures, restoreRun, restoreTrack }` :
  - `restorableIds: Signal<ReadonlySet<string>>` ;
  - `canRestoreRun`, `restoringRun: Signal<boolean>` ;
  - `restoringTrackId: Signal<string | null>` ;
  - `runRollbackFailures: Signal<readonly RollbackFailure[]>` ;
  - `restoreRun(): void` et `restoreTrack(trackId: string): void`.

- [ ] **Step 1: Réécrire les tests de restauration de la page**

Dans `src/app/features/tagging/tagging-page.component.spec.ts`, la logique de restauration passe par `component["runRestore"]`. Dix tests lisent encore `restorableIds`, `canRestoreRun`, `restoringRun`, `runRollbackFailures`, `restoreRun` ou `restoreTrack` sur la page. Les réécrire, dans cet ordre :

```ts
  it("offers to restore the tracks the sidecar flags as restorable", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([
        written("a.mp3"),
        written("b.mp3", "write_error"),
        resolvedTrack("c.mp3"),
      ]),
    })

    expect([...component["runRestore"].restorableIds()]).toEqual(["a.mp3", "b.mp3"])
    expect(component["runRestore"].canRestoreRun()).toBe(true)
  })

  it("leaves a failed track whose origin was never saved out of the restore", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "write_error", false), written("b.mp3")]),
    })

    expect([...component["runRestore"].restorableIds()]).toEqual(["b.mp3"])
  })

  it("offers no restore when no track is flagged restorable", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "write_error", false)]),
    })

    expect(component["runRestore"].canRestoreRun()).toBe(false)
  })

  it("keeps the run button while a track is left to restore", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "rolled_back"), written("b.mp3", "write_error")]),
    })

    expect(component["runRestore"].canRestoreRun()).toBe(true)
  })

  it("drops the run button once every track is restored", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "rolled_back")]),
    })

    expect(component["runRestore"].canRestoreRun()).toBe(false)
  })

  it.each([
    ["a run restore of the shown run", { runId: "a3f9c1", trackId: null }, true],
    ["a run restore of another run", { runId: "b7e2d4", trackId: null }, false],
    ["a track restore of the shown run", { runId: "a3f9c1", trackId: "a.mp3" }, false],
  ])("flags the run restore as running only for %s", async (_name, rollingBack, expected) => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
      rollingBack: signal(rollingBack),
    })

    const restoring = component["runRestore"].restoringRun()

    expect(restoring).toBe(expected)
  })

  it("restores the shown run after its confirmation", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3"), written("b.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["runRestore"].restoreRun()
    const options = confirm.mock.calls[0]?.[0]
    const before = service.rollback.mock.calls.length
    options?.accept?.()

    expect(options?.acceptButtonProps).toMatchObject({ severity: "danger" })
    expect(before).toBe(0)
    expect(service.rollback).toHaveBeenCalledWith("a3f9c1")
  })

  it("restores one track after its confirmation", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["runRestore"].restoreTrack("a.mp3")
    confirm.mock.calls[0]?.[0].accept?.()

    expect(service.rollback).toHaveBeenCalledWith("a3f9c1", "a.mp3")
  })

  it("asks nothing while files are busy", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
      writing: signal(true),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["runRestore"].restoreRun()
    component["runRestore"].restoreTrack("a.mp3")

    expect(confirm).not.toHaveBeenCalled()
  })

  it("lists the rollback failures of the shown run only", async () => {
    const failedRollback = {
      ...rollbackFinished(),
      failed: [{ track_id: "b.mp3", file_name: "X - Y.mp3", reason: "file_locked" as const }],
    }
    const shown = await mountWith({
      taggingRunId: signal("a3f9c1"),
      rollbackFinished: signal(failedRollback),
    })
    const ownFailures = shown.component["runRestore"].runRollbackFailures()
    TestBed.resetTestingModule()

    const other = await mountWith({
      taggingRunId: signal("b7e2d4"),
      rollbackFinished: signal(failedRollback),
    })

    expect(ownFailures).toHaveLength(1)
    expect(other.component["runRestore"].runRollbackFailures()).toEqual([])
  })
```

Les autres tests du fichier lisent des éléments du DOM (`[data-action="restore-run"]`) ou des membres qui restent sur la page (`filesBusy`, `action`, `error`) : ils ne changent pas.

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/features/tagging/tagging-page.component.spec.ts --watch=false`
Expected: FAIL, `component["runRestore"]` est `undefined`.

- [ ] **Step 3: Extraire le geste**

`src/app/features/tagging/run-restore.ts` :

```ts
import { computed, inject } from "@angular/core"
import { TranslateService } from "@ngx-translate/core"

import type { RollbackFailure } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import { injectDangerConfirm } from "../../shared/components/danger-confirm.component"

/** « Restaurer le run » et « Restaurer ce morceau », partages par la liste du run et son recapitulatif. */
export const injectRunRestore = () => {
  const sidecar = inject(SidecarService)
  const translate = inject(TranslateService)
  const confirmDanger = injectDangerConfirm()

  /** Lignes que le dump peut rendre : le sidecar le dit par ligne, l'interface ne le deduit pas de l'etat. */
  const restorableIds = computed<ReadonlySet<string>>(
    () =>
      new Set(
        sidecar
          .taggingTracks()
          .filter((track) => track.restorable)
          .map((track) => track.trackId),
      ),
  )
  const canRestoreRun = computed(() => !sidecar.writing() && restorableIds().size > 0)
  /** Run affiche seulement : celui des Reglages ne fait pas tourner ce bouton. */
  const restoringRun = computed(() => {
    const inFlight = sidecar.rollingBack()

    return inFlight?.trackId === null && inFlight.runId === sidecar.taggingRunId()
  })
  const restoringTrackId = computed(() => sidecar.rollingBack()?.trackId ?? null)
  /** Le bilan ne vaut que pour le run qu'il nomme. */
  const runRollbackFailures = computed<readonly RollbackFailure[]>(() => {
    const finished = sidecar.rollbackFinished()

    return finished !== null && finished.run_id === sidecar.taggingRunId() ? finished.failed : []
  })

  /** Sans `trackId`, tout le run. */
  const restore = (count: number, ...trackId: [] | [string]): void => {
    const runId = sidecar.taggingRunId()
    if (runId === null || sidecar.filesBusy()) {
      return
    }
    confirmDanger(
      "tagging.rollback",
      translate.instant("tagging.rollback.message", { count }) as string,
      () => {
        void sidecar.rollback(runId, ...trackId)
      },
      true,
    )
  }

  return {
    restorableIds,
    canRestoreRun,
    restoringRun,
    restoringTrackId,
    runRollbackFailures,
    restoreRun: (): void => {
      restore(restorableIds().size)
    },
    restoreTrack: (trackId: string): void => {
      restore(1, trackId)
    },
  }
}
```

Dans `src/app/features/tagging/tagging-page.component.ts` :
- supprimer `restorableIds`, `canRestoreRun`, `restoringRun`, `restoringTrackId`, `runRollbackFailures`, `restoreRun`, `restoreTrack` et la méthode privée `restore` ;
- ajouter `import { injectRunRestore } from "./run-restore"` après l'import de `./run-list.component` ;
- ajouter, sous `protected readonly tooltip = TOOLTIP` :

```ts
  protected readonly runRestore = injectRunRestore()
```

`injectDangerConfirm` et `confirmDanger` restent : `commit` et `retry` s'en servent. `filesBusy` reste aussi (le template l'emploie).

Dans `tagging-page.component.html`, préfixer les usages par `runRestore.` :
- `<app-rollback-failures [failures]="runRollbackFailures()" />` devient `<app-rollback-failures [failures]="runRestore.runRollbackFailures()" />` ;
- `canRestoreRun()` devient `runRestore.canRestoreRun()` (deux occurrences : la condition de la rangée et celle du bouton) ;
- `restoringRun()` devient `runRestore.restoringRun()` ;
- `(click)="restoreRun()"` devient `(click)="runRestore.restoreRun()"` ;
- sur `<app-run-list>` : `[restorableIds]="runRestore.restorableIds()"`, `[restoringTrackId]="runRestore.restoringTrackId()"` et `(restore)="runRestore.restoreTrack($event)"`.

- [ ] **Step 4: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/features/tagging --watch=false`
Expected: PASS

- [ ] **Step 5: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/features/tagging/run-restore.ts src/app/features/tagging/tagging-page.component.ts src/app/features/tagging/tagging-page.component.html src/app/features/tagging/tagging-page.component.spec.ts
git commit -m "refactor(ui): extraire le geste de restauration de la page Tagging"
```

---

### Task 4: « Nouveau run » : vider le run affiché

**Files:**
- Modify: `src/app/core/tagging-run.store.ts`, `tagging-run.store.spec.ts`
- Modify: `src/app/core/sidecar.service.ts`, `sidecar.service.spec.ts`

**Interfaces:**
- Consumes: `prepareRun(folder: string)` (05).
- Produces :
  - `TaggingRunStore.clear(): void` : remet le store à vide sans poser `running` (contrairement à `reset()`) ;
  - `SidecarService.prepareRun(folder: string | null): void`, privée ;
  - `SidecarService.clearRun(): void`.

- [ ] **Step 1: Écrire les tests**

Dans `src/app/core/tagging-run.store.spec.ts`, après `keeps the folder of the run from its start and forgets it on reset` :

```ts
  it("empties the run without announcing one in progress", () => {
    store.reset()
    store.started(RUN_STARTED)
    store.resolved(TRACK_RESOLVED)

    store.clear()

    expect(store.tracks()).toEqual([])
    expect(store.runId()).toBeNull()
    expect(store.running()).toBe(false)
  })
```

Dans `src/app/core/sidecar.service.spec.ts`, dans le `describe("write phase")` (qui porte `searchingRun`, `resolvedRun` et `countOf`), après `ignores a launch while files are being written` :

```ts
    it("lets a new run start after the displayed one is cleared", async () => {
      await resolvedRun()
      transport.emit(WRITE_FINISHED)

      service.clearRun()
      const cleared = {
        tagging: service.tagging(),
        tracks: service.taggingTracks().length,
        requested: service.requestedFolder(),
      }
      await service.startTagging("C:/Sets")

      expect(cleared).toEqual({ tagging: false, tracks: 0, requested: null })
      expect(countOf("start_tagging")).toBe(2)
      expect(service.tagging()).toBe(true)
    })

    it("clears nothing while a search runs", async () => {
      await searchingRun()

      service.clearRun()

      expect(service.taggingTracks()).toHaveLength(2)
      expect(service.tagging()).toBe(true)
    })
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/core/tagging-run.store.spec.ts --include src/app/core/sidecar.service.spec.ts --watch=false`
Expected: FAIL, `store.clear` et `service.clearRun` ne sont pas des fonctions.

- [ ] **Step 3: Écrire `clear()` et `clearRun()`**

Dans `src/app/core/tagging-run.store.ts`, remplacer `reset()` :

```ts
  /** Vide le run affiche sans en annoncer un autre : rien n'est « en cours », contrairement a `reset()`. */
  clear(): void {
    this._runId.set(null)
    this._folder.set(null)
    this._rows.set(new Map())
    this._progress.set(null)
    this._finished.set(null)
    this._interrupted.set(false)
    this._lost.set(false)
    this._running.set(false)
  }

  /** Efface le run precedent des l'envoi de la commande : l'ecran ne melange rien. */
  reset(): void {
    this.clear()
    this._running.set(true)
  }
```

Dans `src/app/core/sidecar.service.ts` :
- élargir `prepareRun` : `private prepareRun(folder: string | null): void` (le champ `_requestedFolder` est déjà un `signal<string | null>`) ;
- ajouter, sous `cancelTagging` :

```ts
  /**
   * « Nouveau run » du recapitulatif : l'onglet Tagging repart vide, aucune commande ne part.
   * `prepareRun` marque un run en cours, ce qui est juste pour un lancement et faux ici : `clear()`
   * le leve, sans quoi `startTagging` refuserait de repartir.
   */
  clearRun(): void {
    if (this.taggingRun.running() || this.filesBusy()) {
      return
    }
    this.prepareRun(null)
    this.taggingRun.clear()
  }
```

- [ ] **Step 4: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/core/tagging-run.store.spec.ts --include src/app/core/sidecar.service.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 5: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/core/tagging-run.store.ts src/app/core/tagging-run.store.spec.ts src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts
git commit -m "feat(ui): vider le run affiche sans bloquer le lancement suivant"
```

---

### Task 5: Écran récapitulatif

**Files:**
- Create: `src/fixtures/virtual-scroll.ts`
- Create: `src/app/features/tagging/recap-page.component.ts`, `.html`, `.spec.ts`
- Modify: `src/app/features/tagging/run-list.component.ts`, `.html`, `run-list.component.spec.ts`
- Modify: `src/app/app.routes.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes : `inFilter`, `recapCounts`, `matchesSearch`, `RECAP_FILTERS` (Task 1) ; icônes `search` et `plus` (Task 2) ; `injectRunRestore()` (Task 3) ; `SidecarService.clearRun` (Task 4).
- Produces :
  - `stubOffscreenLayout(): void` et `settleScroller(fixture: { detectChanges: () => void }): Promise<void>` dans `src/fixtures/virtual-scroll.ts` ;
  - `RunListComponent.emptyState: InputSignal<"folder" | "search">` ;
  - la route `tagging/recap` et `RecapPageComponent` (export default), que 07 étend.

- [ ] **Step 1: Lire la maquette**

Lire `Recap` dans `.design-sync/design-system/ui_kits/techno-tagger/TaggingScreen.jsx`, ainsi que les fiches `components/forms/SelectButton.prompt.md`, `components/forms/IconField.prompt.md`, `components/feedback/EmptyState.prompt.md` et `components/data/DataTable.prompt.md`. La maquette fait foi sur l'apparence. Ce plan et les arbitrages de `docs/DESIGN.md` font foi sur le comportement : pas de relance ni d'« Envoyer ce rapport » ici et pas la ligne d'annotation de conception.

- [ ] **Step 2: Partager les helpers du scroll virtuel**

`src/fixtures/virtual-scroll.ts` (une deuxième spec en a besoin : ils rejoignent `src/fixtures/`, `.claude/rules/angular/tests.md`) :

```ts
import { vi } from "vitest"

/**
 * Sans ces mesures, JSDOM n'en calculant aucune, `[virtualScroll]` ne monte pas une seule ligne.
 * Par `vi.spyOn` et non `Object.defineProperty` : le builder tourne en `isolate: false`, un stub
 * non restaure fuirait vers les specs suivantes (`showOnEllipsis` de `pTooltip`, entre autres).
 */
export const stubOffscreenLayout = (): void => {
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body)
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800)
}

/**
 * Laisse le scroller digerer un montage, un changement d'entree ou un clic, sous
 * `vi.useFakeTimers()`. `fixture.whenStable()` n'y est plus appele : sous faux timers il ne se
 * resout pas (timeout de 5 s mesure le 2026-10-11).
 */
export const settleScroller = async (fixture: { detectChanges: () => void }): Promise<void> => {
  await vi.advanceTimersByTimeAsync(1)
  fixture.detectChanges()
}
```

Dans `src/app/features/tagging/run-list.component.spec.ts`, supprimer les définitions locales de `stubOffscreenLayout` et de `settle` (et leurs commentaires), puis importer :

```ts
import { settleScroller as settle, stubOffscreenLayout } from "../../../fixtures/virtual-scroll"
```

Les deux sont appelés par leur ancien nom dans tout le fichier : rien d'autre à changer. Le `mountWith` du fichier garde sa séquence `await Promise.resolve(); vi.advanceTimersByTime(1); fixture.detectChanges()`.

Run: `pnpm exec ng test --include src/app/features/tagging/run-list.component.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 3: Écrire les tests de l'écran**

`src/app/features/tagging/recap-page.component.spec.ts` :

```ts
import { computed, signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { Router, provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { ConfirmationService } from "primeng/api"

import { resolvedTrack, unresolvedTrack } from "../../../fixtures/tagging"
import { settleScroller, stubOffscreenLayout } from "../../../fixtures/virtual-scroll"
import type { RollbackFinishedEvent } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"
import type { RollbackInFlight } from "../../core/write.store"

import RecapPageComponent from "./recap-page.component"

const written = (trackId: string, title: string): TaggingTrack => ({
  ...resolvedTrack(trackId),
  title,
  state: "written",
  resolution: "auto",
})

/**
 * Ce qui se teste ici : les morceaux affiches, les filtres et les gestes du pied. Le service est
 * un stub ; `filesBusy` suit `writing` et `rollingBack`, surcharges comprises.
 */
const mountWith = async (
  tracks: readonly TaggingTrack[],
  overrides: Partial<Record<string, unknown>> = {},
) => {
  const base = {
    taggingTracks: signal(tracks),
    taggingRunId: signal<string | null>(tracks.length > 0 ? "a3f9c1" : null),
    writing: signal(false),
    rollingBack: signal<RollbackInFlight | null>(null),
    rollbackFinished: signal<RollbackFinishedEvent | null>(null),
    rollback: vi.fn(() => Promise.resolve()),
    clearRun: vi.fn(),
    ...overrides,
  }
  const service = {
    ...base,
    filesBusy: computed(() => base.writing() || base.rollingBack() !== null),
  }
  TestBed.configureTestingModule({
    imports: [RecapPageComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      ConfirmationService,
      { provide: SidecarService, useValue: service },
    ],
  })
  const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
  const fixture = TestBed.createComponent(RecapPageComponent)
  fixture.detectChanges()
  await settleScroller(fixture)

  return { fixture, component: fixture.componentInstance, service, navigate }
}

const hostOf = (fixture: { nativeElement: unknown }): HTMLElement =>
  fixture.nativeElement as HTMLElement

/** Une ligne par bouton d'ouverture du detail : le scroll virtuel ne monte que les lignes visibles. */
const rowsIn = (fixture: { nativeElement: unknown }): number =>
  hostOf(fixture).querySelectorAll("[data-row-toggle]").length

const search = async (fixture: { nativeElement: unknown; detectChanges: () => void }, text: string) => {
  const field = hostOf(fixture).querySelector<HTMLInputElement>('input[data-field="search"]')
  if (field) {
    field.value = text
    field.dispatchEvent(new Event("input"))
  }
  await settleScroller(fixture)
}

describe("RecapPageComponent", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubOffscreenLayout()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("narrows the table to the chosen filter", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit"), unresolvedTrack("b")])
    const before = rowsIn(fixture)

    hostOf(fixture).querySelector<HTMLElement>('[data-filter="failed"]')?.click()
    await settleScroller(fixture)

    expect(before).toBe(2)
    expect(rowsIn(fixture)).toBe(1)
  })

  it("gives each filter option its count", async () => {
    const { component } = await mountWith([
      written("a", "Dim Orbit"),
      written("b", "Kelvor"),
      unresolvedTrack("c"),
    ])

    const counts = component["options"]().map((option) => option.count)

    expect(counts).toEqual([3, 2, 0, 1])
  })

  it("shows the empty state when the search matches nothing", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit")])

    await search(fixture, "kelvor")

    expect(rowsIn(fixture)).toBe(0)
    expect(hostOf(fixture).textContent).toContain("recap.empty.heading")
  })

  it("closes the detail of a track the filter hides", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit"), unresolvedTrack("b")])
    hostOf(fixture).querySelector<HTMLElement>("[data-row-toggle]")?.click()
    await settleScroller(fixture)
    const opened = hostOf(fixture).querySelectorAll("app-track-detail").length

    hostOf(fixture).querySelector<HTMLElement>('[data-filter="failed"]')?.click()
    await settleScroller(fixture)

    expect(opened).toBe(1)
    expect(hostOf(fixture).querySelectorAll("app-track-detail")).toHaveLength(0)
  })

  it("announces the write failures of the displayed tracks", async () => {
    const { fixture, component } = await mountWith([
      written("a", "Dim Orbit"),
      { ...written("b", "Kelvor"), state: "write_error" },
    ])

    expect(component["writeFailures"]()).toBe(1)
    expect(hostOf(fixture).querySelector("[data-write-failures]")).not.toBeNull()
  })

  it("stays silent about write failures when every track was written", async () => {
    const { fixture } = await mountWith([written("a", "Dim Orbit")])

    expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
  })

  it("starts a new run from the tagging tab", async () => {
    const { fixture, service, navigate } = await mountWith([written("a", "Dim Orbit")])

    hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="new-run"]')?.click()

    expect(service.clearRun).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith("/tagging")
  })

  it("shows a framed empty state without a run", async () => {
    const { fixture } = await mountWith([])

    const text = hostOf(fixture).textContent

    expect(text).toContain("recap.none.heading")
    expect(hostOf(fixture).querySelector("app-run-list")).toBeNull()
  })

  it("disables the run restore while files are busy", async () => {
    const { fixture } = await mountWith([{ ...written("a", "Dim Orbit"), restorable: true }], {
      rollingBack: signal({ runId: "a3f9c1", trackId: "a" }),
    })

    const restore = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="restore-run"]')

    expect(restore?.disabled).toBe(true)
  })
})
```

- [ ] **Step 4: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/features/tagging/recap-page.component.spec.ts --watch=false`
Expected: FAIL, module `./recap-page.component` introuvable.

- [ ] **Step 5: Paramétrer l'état vide de la liste**

Dans `src/app/features/tagging/run-list.component.ts`, après l'entrée `loading` :

```ts
  /** « folder » : dossier sans fichier audio ; « search » : filtre ou recherche du recapitulatif. */
  readonly emptyState = input<"folder" | "search">("folder")
```

Dans `run-list.component.html`, dans le `#emptymessage`, remplacer la branche `@else` du `@if (loading())` :

```html
      } @else {
        <td colspan="7" class="border-b-0">
          @if (emptyState() === "search") {
            <app-empty-state
              icon="search"
              [heading]="'recap.empty.heading' | translate"
              [description]="'recap.empty.description' | translate"
            />
          } @else {
            <app-empty-state
              icon="folder"
              [heading]="'tagging.list.empty.heading' | translate"
              [description]="'tagging.list.empty.description' | translate"
            />
          }
        </td>
      }
```

- [ ] **Step 6: Écrire l'écran**

`src/app/features/tagging/recap-page.component.ts` :

```ts
import { Component, computed, inject, signal } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { IconField } from "primeng/iconfield"
import { InputIcon } from "primeng/inputicon"
import { InputText } from "primeng/inputtext"
import { SelectButton } from "primeng/selectbutton"
import { Tooltip } from "primeng/tooltip"

import { SidecarService } from "../../core/sidecar.service"
import { DangerConfirmComponent } from "../../shared/components/danger-confirm.component"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { IconComponent } from "../../shared/components/icon.component"
import { MessageComponent } from "../../shared/components/message.component"
import { RollbackFailuresComponent } from "../../shared/components/rollback-failures.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { TOOLTIP } from "../../shared/utils/tooltip"

import {
  inFilter,
  matchesSearch,
  RECAP_FILTERS,
  recapCounts,
  type RecapFilter,
} from "./recap-filter"
import { RunListComponent } from "./run-list.component"
import { injectRunRestore } from "./run-restore"

interface RecapCriteria {
  filter: RecapFilter
  query: string
}

/** Recapitulatif du run affiche (maquette `Recap`) ; la relance reste au bouton d'action de la liste. */
@Component({
  selector: "app-recap-page",
  imports: [
    TranslatePipe,
    FormField,
    ButtonDirective,
    IconField,
    InputIcon,
    InputText,
    SelectButton,
    Tooltip,
    DangerConfirmComponent,
    EmptyStateComponent,
    IconComponent,
    MessageComponent,
    RollbackFailuresComponent,
    RunListComponent,
  ],
  templateUrl: "./recap-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class RecapPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly router = inject(Router)
  private readonly translate = inject(TranslateService)

  protected readonly runRestore = injectRunRestore()
  protected readonly tooltip = TOOLTIP

  /** Filtre et recherche en un seul signal : `form()` en derive les champs que `[formField]` lie. */
  protected readonly criteria = signal<RecapCriteria>({ filter: "all", query: "" })
  protected readonly fields = form(this.criteria)

  protected readonly tracks = this.sidecar.taggingTracks
  protected readonly filesBusy = this.sidecar.filesBusy
  protected readonly writing = this.sidecar.writing
  /** Compte sur les morceaux affiches : un morceau restaure sort du message. */
  protected readonly writeFailures = computed(
    () => this.tracks().filter((track) => track.state === "write_error").length,
  )
  protected readonly counts = computed(() => recapCounts(this.tracks()))
  /** `label` : PrimeNG le pose en `aria-label` de chaque bouton, faute de quoi il y met l'objet. */
  protected readonly options = computed(() => {
    // `currentLang()` est lu pour que les libelles suivent la langue : `instant` ne notifie rien.
    void this.translate.currentLang()
    const counts = this.counts()

    return RECAP_FILTERS.map((value) => {
      const name = this.translate.instant(`recap.filter.${value}`) as string

      return { value, name, count: counts[value], label: `${name} ${counts[value]}` }
    })
  })
  protected readonly visible = computed(() => {
    const { filter, query } = this.criteria()

    return this.tracks().filter((track) => inFilter(track, filter) && matchesSearch(track, query))
  })

  protected newRun(): void {
    this.sidecar.clearRun()
    void this.router.navigateByUrl("/tagging")
  }
}
```

`src/app/features/tagging/recap-page.component.html` :

```html
@if (tracks().length === 0) {
  <app-empty-state
    framed
    icon="search"
    [heading]="'recap.none.heading' | translate"
    [description]="'recap.none.description' | translate"
  />
} @else {
  <div class="flex items-center gap-4">
    <h1 class="text-2xl font-semibold">{{ "recap.title" | translate }}</h1>

    <div class="ml-auto flex items-center gap-4">
      <span id="recap-filter-label" class="sr-only">{{ "recap.filter.label" | translate }}</span>
      <p-selectbutton
        size="small"
        [formField]="fields.filter"
        [options]="options()"
        optionValue="value"
        [allowEmpty]="false"
        ariaLabelledBy="recap-filter-label"
      >
        <ng-template #item let-option>
          <span class="flex items-center gap-2" [attr.data-filter]="option.value">
            {{ option.name }}
            <span class="text-muted-color tabular-nums">{{ option.count }}</span>
          </span>
        </ng-template>
      </p-selectbutton>
      <p-iconfield>
        <p-inputicon><app-icon name="search" [size]="16" /></p-inputicon>
        <input
          pInputText
          pSize="small"
          data-field="search"
          [formField]="fields.query"
          [placeholder]="'recap.search' | translate"
          [attr.aria-label]="'recap.search' | translate"
        />
      </p-iconfield>
    </div>
  </div>

  @if (!writing() && writeFailures() > 0) {
    <!-- Le texte seul : la relance est le bouton d'action du run, dans l'onglet Tagging. -->
    <app-message severity="error" data-write-failures>
      {{ "tagging.write.failed" | translate: { count: writeFailures() } }}
    </app-message>
  }

  <app-rollback-failures [failures]="runRestore.runRollbackFailures()" />

  <div class="min-h-0 flex-1">
    <app-run-list
      [tracks]="visible()"
      [frozen]="true"
      emptyState="search"
      [restorableIds]="runRestore.restorableIds()"
      [restoringTrackId]="runRestore.restoringTrackId()"
      [restoreBlocked]="filesBusy()"
      (restore)="runRestore.restoreTrack($event)"
    />
  </div>

  <div class="flex items-center gap-2">
    @if (runRestore.canRestoreRun()) {
      @let restoreBusy = filesBusy() ? ("tagging.rollback.blocked" | translate) : undefined;
      <button
        pButton
        type="button"
        size="small"
        [outlined]="true"
        data-action="restore-run"
        [disabled]="filesBusy()"
        [pTooltip]="restoreBusy"
        [tooltipOptions]="tooltip"
        (click)="runRestore.restoreRun()"
      >
        <app-icon [name]="runRestore.restoringRun() ? 'spinner' : 'refresh'" [size]="16" />
        {{ "tagging.rollback.run" | translate }}
      </button>
    }
    <button
      pButton
      type="button"
      size="small"
      [text]="true"
      severity="secondary"
      class="ml-auto"
      data-action="new-run"
      (click)="newRun()"
    >
      <app-icon name="plus" [size]="16" />
      {{ "recap.newRun" | translate }}
    </button>
  </div>
}

<app-danger-confirm />
```

- [ ] **Step 7: Déclarer la route et les textes**

Dans `src/app/app.routes.ts`, après la route `tagging`, avant le `**` :

```ts
  { path: "tagging/recap", loadComponent: () => import("./features/tagging/recap-page.component") },
```

Textes à ajouter dans `public/i18n/fr.json` (espace de noms `recap`) :

```json
  "recap": {
    "title": "Récapitulatif du run",
    "filter": {
      "label": "Filtrer les morceaux",
      "all": "Tout",
      "validated": "Validés",
      "arbitrated": "Arbitrés",
      "failed": "Échecs"
    },
    "search": "Rechercher",
    "empty": {
      "heading": "Aucun morceau ne correspond",
      "description": "Changez de filtre ou videz la recherche."
    },
    "none": {
      "heading": "Aucun run à récapituler",
      "description": "Lancez un run depuis l'onglet Tagging."
    },
    "newRun": "Nouveau run"
  },
```

`public/i18n/en.json` :

```json
  "recap": {
    "title": "Run summary",
    "filter": {
      "label": "Filter the tracks",
      "all": "All",
      "validated": "Validated",
      "arbitrated": "Arbitrated",
      "failed": "Failures"
    },
    "search": "Search",
    "empty": {
      "heading": "No track matches",
      "description": "Change the filter or clear the search."
    },
    "none": {
      "heading": "No run to summarize",
      "description": "Start a run from the Tagging tab."
    },
    "newRun": "New run"
  },
```

- [ ] **Step 8: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/features/tagging --include src/app/core/translations.spec.ts --watch=false`
Expected: PASS, tests de la page Tagging et de la liste compris.

- [ ] **Step 9: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/fixtures/virtual-scroll.ts src/app/features/tagging/recap-page.component.ts src/app/features/tagging/recap-page.component.html src/app/features/tagging/recap-page.component.spec.ts src/app/features/tagging/run-list.component.ts src/app/features/tagging/run-list.component.html src/app/features/tagging/run-list.component.spec.ts src/app/app.routes.ts public/i18n
git commit -m "feat(ui): ecran recapitulatif filtrable d'un run ecrit"
```

---

### Task 6: Ouverture du récapitulatif et documentation

**Files:**
- Modify: `src/app/features/tagging/tagging-page.component.ts`, `.html`, `.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `.design-sync/NOTES.md`

**Interfaces:**
- Consumes: route `tagging/recap` (Task 5) ; `SidecarService.writeFinished`.
- Produces: le bouton `data-action="recap"`.

- [ ] **Step 1: Écrire les tests**

Dans `src/app/features/tagging/tagging-page.component.spec.ts` :

1. Importer `Router` depuis `@angular/router`, ajouter `RunFinishedEvent` à l'import de `../../core/models/protocol` et `WRITE_FINISHED` à celui de `../../../fixtures/write`.
2. Ajouter à `base` du `mountWith`, après `writing: signal(false)` : `writeFinished: signal<RunFinishedEvent | null>(null),`.
3. Après `restores the shown run after its confirmation`, ajouter :

```ts
  it("offers the run summary once the write phase is over", async () => {
    const writeFinished = signal<RunFinishedEvent | null>(null)
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writeFinished,
    })
    fixture.detectChanges()
    const before = host(fixture).querySelector('[data-action="recap"]')

    writeFinished.set(WRITE_FINISHED)
    fixture.detectChanges()

    expect(before).toBeNull()
    expect(host(fixture).querySelector('[data-action="recap"]')).not.toBeNull()
  })

  it("keeps the run summary within reach when the write bar and the restore are hidden", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writeFinished: signal(WRITE_FINISHED),
      taggingTracks: signal([written("a.mp3", "rolled_back")]),
    })

    fixture.detectChanges()

    expect(host(fixture).querySelector("app-phase-progress")).toBeNull()
    expect(host(fixture).querySelector('[data-action="restore-run"]')).toBeNull()
    expect(host(fixture).querySelector('[data-action="recap"]')).not.toBeNull()
  })

  it("opens the run summary", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      writeFinished: signal(WRITE_FINISHED),
    })
    const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
    fixture.detectChanges()

    host(fixture).querySelector<HTMLButtonElement>('[data-action="recap"]')?.click()

    expect(navigate).toHaveBeenCalledWith("/tagging/recap")
  })
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/features/tagging/tagging-page.component.spec.ts --watch=false`
Expected: FAIL, aucun `[data-action="recap"]`.

- [ ] **Step 3: Ajouter le bouton**

Dans `tagging-page.component.ts` :
- importer `Router` : `import { Router } from "@angular/router"` après l'import d'Angular core ;
- ajouter, sous `private readonly translate` : `private readonly router = inject(Router)` ;
- ajouter, sous `protected readonly writeProgress` :

```ts
  /** Le bilan de l'ecriture est arrive : le recapitulatif a quelque chose a montrer. */
  protected readonly recapAvailable = computed(() => this.sidecar.writeFinished() !== null)
```

- ajouter la méthode, sous `retry()` :

```ts
  protected openRecap(): void {
    void this.router.navigateByUrl("/tagging/recap")
  }
```

Dans `tagging-page.component.html`, remplacer le bloc `@else if (committed())` entier par :

```html
  } @else if (committed()) {
    @let written = writeProgress();
    <!-- Sans ecriture en cours ni palier recu (relance refusee), une barre indeterminee
         laisserait croire que l'ecriture tourne encore. -->
    @if (showsWriteBar() || recapAvailable() || runRestore.canRestoreRun()) {
      <div class="flex items-end gap-4">
        @if (showsWriteBar()) {
          <app-phase-progress
            class="min-w-0 flex-1"
            [label]="'tagging.write.phase' | translate"
            [counter]="written ? ('tagging.progress' | translate: written) : undefined"
            [value]="writePercentage()"
          />
        }
        <!-- Hors de la barre : elle reste masquee quand l'ecriture n'a laisse aucun palier.
             Jamais a cote du bouton d'action du run. -->
        <div class="ml-auto flex shrink-0 gap-2">
          @if (recapAvailable()) {
            <button
              pButton
              type="button"
              size="small"
              [outlined]="true"
              severity="secondary"
              data-action="recap"
              (click)="openRecap()"
            >
              {{ "tagging.recap" | translate }}
            </button>
          }
          @if (runRestore.canRestoreRun()) {
            @let restoreBusy = filesBusy() ? ("tagging.rollback.blocked" | translate) : undefined;
            <button
              pButton
              type="button"
              size="small"
              [outlined]="true"
              data-action="restore-run"
              [disabled]="filesBusy()"
              [pTooltip]="restoreBusy"
              [tooltipOptions]="tooltip"
              (click)="runRestore.restoreRun()"
            >
              <app-icon [name]="runRestore.restoringRun() ? 'spinner' : 'refresh'" [size]="16" />
              {{ "tagging.rollback.run" | translate }}
            </button>
          }
        </div>
      </div>
    }
  } @else if (recovery(); as phase) {
```

(la ligne finale `} @else if (recovery(); as phase) {` est la suite inchangée du template.)

Textes : `tagging.recap` : FR « Récapitulatif », EN « Summary ».

- [ ] **Step 4: Documenter**

Relire les lignes citées avant d'éditer : leurs numéros sont ceux du 2026-10-12 et les plans 03 et 04 ont pu les déplacer.

Dans `docs/DESIGN.md` :
- **§ Tables et listes, ligne « Récapitulatif filtrable »** (L246) : ajouter aux notes « Écran `RecapPageComponent` sur `/tagging/recap`, ouvert par « Récapitulatif » une fois l'écriture terminée, la liste restant la vue par défaut. Pied : « Restaurer le run », « Nouveau run ». Sans relance, sans « Envoyer ce rapport » (Feature 9) ».
- **Même section**, après « Détail avant / après » : ajouter la ligne « Lien vers la fiche source | bouton `link` dans la ligne URL du détail, icône `external-link` | PrimeNG | Ouvre la page de la source retenue par `openUrl` du plugin `opener`. Sans `sourceUrl`, la ligne reste du texte tronqué ».
- **§ Arbitrages**, datés du jour de l'implémentation :
  - « Ouverture du récapitulatif : un bouton « Récapitulatif » à la fin de l'écriture, là où la maquette simulait un lien dans la barre d'onglets » ;
  - « Lien vers la fiche source : dans la ligne URL du détail déplié, là où la maquette n'en montrait aucun » ;
  - « « Envoyer ce rapport » : absent du récapitulatif jusqu'à la Feature 9 ».

Dans `docs/ARCHITECTURE.md` :
- **§ Écriture** (L257), phrase « Le run se termine par l'écriture du rapport… et l'affichage du récapitulatif filtrable. » : remplacer seulement la fin « et l'affichage du récapitulatif filtrable » par « . Le récapitulatif filtrable s'ouvre ensuite par le bouton « Récapitulatif » de l'onglet Tagging, la liste du run restant la vue par défaut ». L'emplacement du rapport dans la même phrase est corrigé par le plan 03 : ne pas y toucher.
- **§ Diagramme de séquence** (L722) : remplacer `UI->>U: écran récapitulatif filtrable` par `UI->>U: bouton « Récapitulatif », puis écran filtrable`.
- **§ Navigation** (L376) : remplacer « trois routes lazy-loaded (`/playlist`, `/tagging`, `/settings`) rendues dans un `p-tabs` » par « trois onglets lazy-loaded (`/playlist`, `/tagging`, `/settings`) rendus dans un `p-tabs`, l'onglet Tagging portant aussi `/tagging/recap`, le récapitulatif du run affiché ».

Dans `.design-sync/NOTES.md` § Reste ouvert, à la suite des lignes déjà ajoutées : « `AppShell`, `Recap` : bouton « Récapitulatif » à la place du lien de simulation, « Envoyer ce rapport » absent, lien source dans `TrackDetail` ».

- [ ] **Step 5: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/features/tagging/tagging-page.component.spec.ts --include src/app/core/translations.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 6: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/features/tagging/tagging-page.component.ts src/app/features/tagging/tagging-page.component.html src/app/features/tagging/tagging-page.component.spec.ts public/i18n docs/DESIGN.md docs/ARCHITECTURE.md .design-sync/NOTES.md
git commit -m "feat(ui): ouvrir le recapitulatif a la fin de l'ecriture"
```
