# Rollback depuis l'interface : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Annuler depuis l'interface l'écriture d'un morceau ou du run affiché dans l'onglet Tagging, et celle du dernier run écrit depuis les Réglages.

**Architecture:** Des pièces partagées d'abord : l'état « Restauré » de `StateTagComponent`, l'icône `undo`, et `RollbackFailuresComponent` qui liste les fichiers non restaurés. Dans Tagging, le détail émet `restore`, la liste le relaie, la page confirme puis appelle `rollback` ; le run entier se restaure par un bouton au bout de la barre d'écriture. Les Réglages gagnent une section Administration dont la rangée Rollback nomme le dernier run annulable.

**Tech Stack:** Angular 22 (signals, `input` / `output`), PrimeNG 22.1.2 (`ConfirmationService`, `p-confirmdialog`, `p-message`, `pButton`, `pTooltip`), ngx-translate (`currentLang()`), `Intl.DateTimeFormat`, Vitest.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/11-rollback-ui-design.md`

## Global Constraints

- **Dépend des sub-projects 06, 08, 09 et 10, implémentés avant** : `SidecarService.rollback(runId, trackId?)`, `loadRollbackTarget()`, `rollingBack: Signal<RollbackInFlight | null>`, `rollbackFinished: Signal<RollbackFinishedEvent | null>`, `rollbackTarget: Signal<RollbackRun | null | undefined>`, `writing`, `committed` ; `RollbackFailure { track_id, file_name, reason }` ; fixtures `ROLLBACK_RUN`, `rollbackFinished()` (`src/fixtures/write.ts`) ; `TrackDetailComponent` et `RunListComponent` du 09 ; la page Tagging du 10 (`ConfirmationService`, `p-confirmdialog`, barre `committed()`, `writeFailures`, `error`, `blockedReason`, `filesBusy`, clé `tagging.blocked.restoring`, icône `refresh`) ; `tagging.reason.name_taken` (06).
- **Maquette** : `SettingsScreen.jsx`, rangée `Rollback`, lue avant d'écrire les templates (`.claude/rules/design/claude-design.md`).
- **`danger`** sur les trois boutons de restauration et leur acceptation ; icône `refresh` sur les boutons, `undo` sur l'état.
- **Une opération sur les fichiers à la fois** : tout bouton de restauration se grise pendant `writing` ou `rollingBack`, celui qui l'a lancée montre `spinner` animé.
- **Composants d'affichage** : le détail et la liste n'appellent pas le service.
- **Textes** : vouvoiement, infinitif, forme « Libellé : {{count}} », espace insécable (U+00A0) avant `:` en français, mêmes clés en FR et en EN.
- **Fonctions en `const nom = () =>`** ; aucun appel de méthode dans un template ; tests en anglais, AAA séparé par des lignes vides.
- **Gate vert à chaque commit** : `just format-ui`, `just lint-ui`, `just typecheck-ui`, `just test-ui`. Commits `type(scope): description`, scope `ui` ou `docs`.

## Review Focus

- **Restauration en partie** (un fichier verrouillé) : la ligne en échec garde son état, le bouton du run reste et la liste nomme le fichier (Task 2, `keeps the run button while a track is left to restore`).
- **Bilan d'un autre run** (restauré depuis les Réglages pendant qu'un run est affiché) : la liste de Tagging n'affiche pas ses échecs (Task 2, `lists the rollback failures of the shown run only`).
- **Morceau en échec d'écriture** : restaurable, ses tags ont pu partir avant l'échec du renommage (Task 2, `offers to restore written and failed tracks of a committed run`).
- **Réglages ouverts avant la réponse du moteur** : bouton grisé, rien à côté, jamais « Aucun run à annuler » à tort (Task 3, `waits for the target before offering anything`).
- **Lancement d'un run pendant une restauration** : « Lancer le run » grisé avec sa raison (Task 2, `blocks a launch while a rollback runs`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/shared/components/icon.component.ts` | Icône `undo`. |
| `src/app/shared/components/state-tag.component.ts` | État `rolled_back`. |
| `src/app/shared/components/rollback-failures.component.ts` | Liste des fichiers non restaurés. |
| `src/app/features/tagging/track-detail.component.*` | Bouton « Restaurer ce morceau ». |
| `src/app/features/tagging/run-list.component.*` | Relais vers le détail. |
| `src/app/features/tagging/tagging-page.component.*` | Bouton du run, confirmations, échecs, erreurs. |
| `src/app/features/settings/settings-page.component.*` | Section Administration, rangée Rollback. |
| `public/i18n/{fr,en}.json` | Libellés. |
| `docs/DESIGN.md`, `.design-sync/NOTES.md` | État, emplacements, rangée, reste ouvert. |

---

### Task 1: État « Restauré » et liste des fichiers non restaurés

**Files:**
- Modify: `src/app/shared/components/icon.component.ts`
- Modify: `src/app/shared/components/state-tag.component.ts`, `.spec.ts`
- Create: `src/app/shared/components/rollback-failures.component.ts`, `.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Produces: icône `undo` (`refresh` vient du 10) ; `app-state-tag` affiche `rolled_back` ; `RollbackFailuresComponent`, sélecteur `app-rollback-failures`, `failures = input.required<readonly RollbackFailure[]>()`, rien de rendu sur une liste vide, racine `[data-rollback-failures]`.

- [ ] **Step 1: Écrire les specs**

Dans `state-tag.component.spec.ts`, `CASES` gagne :

```ts
  {
    state: "rolled_back",
    resolution: "auto",
    awaiting: false,
    severity: "secondary",
    icon: "undo",
    label: "tagging.state.rolledBack",
  },
```

Créer `src/app/shared/components/rollback-failures.component.spec.ts` :

```ts
import { TestBed } from "@angular/core/testing"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"

import type { RollbackFailure } from "../../core/models/protocol"

import { RollbackFailuresComponent } from "./rollback-failures.component"

const TAKEN: RollbackFailure = {
  track_id: "a.mp3",
  file_name: "Adam Beyer - Your Mind.mp3",
  reason: "name_taken",
}

const mount = (failures: readonly RollbackFailure[]) => {
  TestBed.configureTestingModule({
    imports: [RollbackFailuresComponent],
    providers: [provideTranslateService()],
  })
  const translate = TestBed.inject(TranslateService)
  translate.setTranslation("en", {
    rollback: { failures: "not restored {{count}}", failure: "{{file}} = {{reason}}" },
    tagging: { reason: { name_taken: "taken" } },
  })
  translate.use("en")
  const fixture = TestBed.createComponent(RollbackFailuresComponent)
  fixture.componentRef.setInput("failures", failures)
  fixture.detectChanges()

  return fixture.nativeElement as HTMLElement
}

describe("RollbackFailuresComponent", () => {
  it("names each file left as it was with the reason to act on", () => {
    const root = mount([TAKEN])

    const text = root.querySelector("[data-rollback-failures]")?.textContent ?? ""

    expect(text).toContain("not restored 1")
    expect(text).toContain("Adam Beyer - Your Mind.mp3 = taken")
  })

  it("renders nothing without failure", () => {
    const root = mount([])

    expect(root.querySelector("[data-rollback-failures]")).toBeNull()
  })
})
```

- [ ] **Step 2: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL, `Cannot find module './rollback-failures.component'` et le cas `rolled_back` rendu en attente

- [ ] **Step 3: Icônes**

Dans `icon.component.ts`, importer `Undo` (`@primeicons/angular/undo`), ajouter `"undo"` à `ICON_NAMES`, le composant aux `imports`, et un `@case` sur le modèle des autres (`<svg data-p-icon="undo" [size]="size()" />`). `refresh` est déjà là, posée par le sub-project 10.

- [ ] **Step 4: État « Restauré »**

Dans `state-tag.component.ts`, après `WRITE_ERROR` :

```ts
/** Rendu a son origine : ni ecrit ni en echec, aucune voie a montrer en vert. */
const ROLLED_BACK: StateStyle = {
  severity: "secondary",
  icon: "undo",
  label: "tagging.state.rolledBack",
}
```

et dans le `switch`, avant `default` : `case "rolled_back": return ROLLED_BACK`.

- [ ] **Step 5: Liste des fichiers non restaurés**

Créer `src/app/shared/components/rollback-failures.component.ts` :

```ts
import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { Message } from "primeng/message"

import type { RollbackFailure } from "../../core/models/protocol"
import { failureReasonKey } from "../utils/identity"

/** Fichiers qu'un rollback a laisses en l'etat, avec la phrase de leur motif. */
@Component({
  selector: "app-rollback-failures",
  imports: [Message, TranslatePipe],
  template: `
    @if (rows().length > 0) {
      <p-message severity="error" data-rollback-failures>
        <div class="flex flex-col gap-2">
          <span>{{ "rollback.failures" | translate: { count: rows().length } }}</span>
          <ul class="flex flex-col gap-1">
            @for (row of rows(); track row.trackId) {
              <li>
                {{ "rollback.failure" | translate: { file: row.file, reason: (row.reasonKey | translate) } }}
              </li>
            }
          </ul>
        </div>
      </p-message>
    }
  `,
})
export class RollbackFailuresComponent {
  readonly failures = input.required<readonly RollbackFailure[]>()

  protected readonly rows = computed(() =>
    this.failures().map((failure) => ({
      trackId: failure.track_id,
      file: failure.file_name,
      reasonKey: failureReasonKey(failure.reason),
    })),
  )
}
```

- [ ] **Step 6: Traduire**

`fr.json` : `tagging.state.rolledBack` `"Restauré"` ; à la racine, après `tagging` :

```json
  "rollback": {
    "failures": "Fichiers non restaurés : {{count}}",
    "failure": "{{file}} : {{reason}}"
  },
```

`en.json` : `"rolledBack": "Restored"` ; `"rollback": { "failures": "Files not restored: {{count}}", "failure": "{{file}}: {{reason}}" },`.

- [ ] **Step 7: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS (`icon.component.spec.ts` couvre l'icône)

- [ ] **Step 8: Commit**

```bash
git add src/app/shared/components/icon.component.ts src/app/shared/components/state-tag.component.ts src/app/shared/components/state-tag.component.spec.ts src/app/shared/components/rollback-failures.component.ts src/app/shared/components/rollback-failures.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): état restauré et liste des fichiers non restaurés"
```

---

### Task 2: Restaurer un morceau ou le run affiché

**Files:**
- Modify: `src/app/features/tagging/track-detail.component.ts`, `.html`, `.spec.ts`
- Modify: `src/app/features/tagging/run-list.component.ts`, `.html`
- Modify: `src/app/features/tagging/tagging-page.component.ts`, `.html`, `.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.rollback`)

**Interfaces:**
- Consumes: Task 1 ; `SidecarService.rollback`, `rollingBack`, `rollbackFinished`, `taggingRunId`, `writing`, `committed` ; `filesBusy` de la page (10).
- Produces: `TrackDetailComponent` inputs `restorable`, `restoring`, `blocked` (booléens), output `restore: OutputEmitterRef<string>` ; `RunListComponent` inputs `restorableIds: ReadonlySet<string>`, `restoringTrackId: string | null`, `restoreBlocked: boolean`, output `restore` ; sur la page, `restorableIds`, `canRestoreRun`, `restoreRun()`, `restoreTrack(trackId)`, `runRollbackFailures`.

- [ ] **Step 1: Écrire les specs**

`track-detail.component.spec.ts`, `mount` accepte `inputs: Record<string, unknown> = {}` posés par `setInput` avant `detectChanges`, puis :

```ts
  it("offers to restore only a restorable track", () => {
    const plain = mount(RESOLVED)
    const absent = plain.querySelector('[data-action="restore-track"]')
    TestBed.resetTestingModule()

    const root = mount(RESOLVED, { restorable: true })

    expect(absent).toBeNull()
    expect(root.querySelector('[data-action="restore-track"]')).not.toBeNull()
  })

  it("asks to restore its track on click", () => {
    TestBed.configureTestingModule({
      imports: [TrackDetailComponent],
      providers: [provideTranslateService()],
    })
    const fixture = TestBed.createComponent(TrackDetailComponent)
    fixture.componentRef.setInput("track", RESOLVED)
    fixture.componentRef.setInput("restorable", true)
    fixture.detectChanges()
    const asked = vi.fn()
    fixture.componentInstance.restore.subscribe(asked)

    ;(fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-action="restore-track"]')
      ?.click()

    expect(asked).toHaveBeenCalledWith(RESOLVED.trackId)
  })

  it("disables the restore while files are busy", () => {
    const root = mount(RESOLVED, { restorable: true, blocked: true })

    const button = root.querySelector<HTMLButtonElement>('[data-action="restore-track"]')

    expect(button?.disabled).toBe(true)
  })
```

`tagging-page.component.spec.ts` : le stub de `mountWith` gagne `rollbackFinished: signal<RollbackFinishedEvent | null>(null)` et `rollback: vi.fn(() => Promise.resolve())` (`rollingBack` y est depuis le 10) ; importer `type RollbackFinishedEvent` et `rollbackFinished` (`../../../fixtures/write`). Puis :

```ts
  const written = (trackId: string, state: TaggingTrack["state"] = "written"): TaggingTrack => ({
    ...PENDING_TRACK,
    trackId,
    state,
    resolution: "auto",
  })

  it("offers to restore written and failed tracks of a committed run", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3"), written("b.mp3", "write_error"), resolved("c.mp3")]),
    })

    expect([...component["restorableIds"]()]).toEqual(["a.mp3", "b.mp3"])
    expect(component["canRestoreRun"]()).toBe(true)
  })

  it("keeps the run button while a track is left to restore", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "rolled_back"), written("b.mp3", "write_error")]),
    })

    expect(component["canRestoreRun"]()).toBe(true)
  })

  it("restores the shown run after its confirmation", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3"), written("b.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["restoreRun"]()
    const options = confirm.mock.calls[0]?.[0]
    options?.accept?.()

    expect(options?.acceptButtonProps).toEqual({ severity: "danger" })
    expect(service.rollback).toHaveBeenCalledWith("a3f9c1")
  })

  it("restores one track after its confirmation", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([written("a.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["restoreTrack"]("a.mp3")
    confirm.mock.calls[0]?.[0].accept?.()

    expect(service.rollback).toHaveBeenCalledWith("a3f9c1", "a.mp3")
  })

  it("counts the write failures on the rows", async () => {
    const { component } = await mountWith({
      committed: signal(true),
      taggingTracks: signal([written("a.mp3", "write_error"), written("b.mp3", "rolled_back")]),
    })

    expect(component["writeFailures"]()).toBe(1)
  })

  it("lists the rollback failures of the shown run only", async () => {
    const failed = {
      ...rollbackFinished(),
      failed: [{ track_id: "b.mp3", file_name: "X - Y.mp3", reason: "file_locked" as const }],
    }
    const shown = await mountWith({ taggingRunId: signal("a3f9c1"), rollbackFinished: signal(failed) })
    const ownFailures = shown.component["runRollbackFailures"]()
    TestBed.resetTestingModule()

    const other = await mountWith({ taggingRunId: signal("b7e2d4"), rollbackFinished: signal(failed) })

    expect(ownFailures).toHaveLength(1)
    expect(other.component["runRollbackFailures"]()).toEqual([])
  })

  it("blocks a launch while a rollback runs", async () => {
    const { component } = await mountWith({
      rollingBack: signal({ runId: "a3f9c1", trackId: null }),
    })

    expect(component["blockedReason"]()).toBe("tagging.blocked.restoring")
  })
```

(`resolved` est le helper du sub-project 10 dans ce même fichier).

- [ ] **Step 2: Compter le message d'échec sur les lignes**

`writeFailures` se lit ici sur les lignes `write_error` et non plus sur `writeFinished` : le test `keeps the failure message while failures remain, with a confirmed retry` du 10 passe encore tel quel, puisque le 10 y fournit aussi les lignes, mais il ne doit plus piloter `writeFinished`. Dans `tagging-page.component.spec.ts`, il se réécrit sur les lignes seules :

```ts
  it("keeps the failure message while failures remain, with a confirmed retry", async () => {
    const taggingTracks = signal([written("a.mp3", "write_error"), written("b.mp3", "write_error")])
    const { component, service, fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks,
    })
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", { tagging: { write: { failed: "failed {{count}}" } } })
    translate.use("en")
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")
    const shown = (): string | undefined =>
      host(fixture).querySelector("[data-write-failures]")?.textContent
    fixture.detectChanges()
    const before = shown()

    component["retry"]()
    confirm.mock.calls[0]?.[0].accept?.()
    taggingTracks.set([written("b.mp3", "write_error")])
    fixture.detectChanges()
    const remaining = shown()
    taggingTracks.set([written("b.mp3")])
    fixture.detectChanges()

    expect(before).toContain("failed 2")
    expect(service.retryWrite).toHaveBeenCalledTimes(1)
    expect(remaining).toContain("failed 1")
    expect(shown()).toBeUndefined()
  })
```

`disables the retry while a rollback runs` du 10 n'a plus besoin de `writeFinished` : sa ligne `failed("a.mp3")` suffit.

- [ ] **Step 3: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL, `restorableIds` et `restoreRun` absents, bouton du détail introuvable

- [ ] **Step 4: Bouton du détail**

Dans `track-detail.component.ts` : ajouter `output` à l'import d'`@angular/core`, `ButtonDirective` (`primeng/button`) et `Tooltip` (`primeng/tooltip`) aux `imports`, `TOOLTIP_DELAY` (`../../shared/utils/tooltip`) à l'import, `protected readonly tooltipDelay = TOOLTIP_DELAY` à côté de `FADE_IN`, et :

```ts
  /** Morceau ecrit ou en echec d'un run confirme : le dump peut le rendre. */
  readonly restorable = input(false)
  readonly restoring = input(false)
  /** Une ecriture ou une restauration tourne : le moteur n'en accepte qu'une a la fois. */
  readonly blocked = input(false)
  readonly restore = output<string>()
```

Dans `track-detail.component.html`, à la fin de la colonne de droite (`<div class="min-w-0 flex-auto text-xs">`), après le bloc `@if (rows(); as rows) … @else …` :

```html
    @if (restorable()) {
      @let busy = blocked() ? ("tagging.rollback.blocked" | translate) : undefined;
      <div class="mt-4 flex justify-end">
        <button
          pButton
          type="button"
          size="small"
          severity="danger"
          [outlined]="true"
          data-action="restore-track"
          [disabled]="blocked()"
          [pTooltip]="busy"
          [showDelay]="tooltipDelay"
          (click)="restore.emit(track().trackId)"
        >
          @if (restoring()) {
            <app-icon name="spinner" [size]="16" />
          } @else {
            <app-icon name="refresh" [size]="16" />
          }
          {{ "tagging.rollback.track" | translate }}
        </button>
      </div>
    }
```

- [ ] **Step 5: Relais par la liste**

Dans `run-list.component.ts` (`output` y est déjà importé), ajouter :

```ts
  /** Morceaux que le dump peut rendre, calcules par la page. */
  readonly restorableIds = input<ReadonlySet<string>>(new Set())
  readonly restoringTrackId = input<string | null>(null)
  readonly restoreBlocked = input(false)
  readonly restore = output<string>()
```

`RunRow` gagne `readonly restorable: boolean` et `readonly restoring: boolean`, remplis dans `rows` par `restorable: this.restorableIds().has(track.trackId)` et `restoring: this.restoringTrackId() === track.trackId`. Dans `run-list.component.html`, `<app-track-detail>` devient :

```html
        <app-track-detail
          [track]="track"
          [interrupted]="interrupted()"
          [restorable]="track.restorable"
          [restoring]="track.restoring"
          [blocked]="restoreBlocked()"
          (restore)="restore.emit($event)"
        />
```

- [ ] **Step 6: Page Tagging**

Dans `tagging-page.component.ts`, importer `RollbackFailuresComponent` (`../../shared/components/rollback-failures.component`) dans les `imports`, puis :

```ts
  /** Lignes que le dump peut rendre : ecrites, ou en echec dont les tags ont pu partir. */
  protected readonly restorableIds = computed<ReadonlySet<string>>(() =>
    this.committed()
      ? new Set(
          this.tracks()
            .filter((track) => track.state === "written" || track.state === "write_error")
            .map((track) => track.trackId),
        )
      : new Set(),
  )
  protected readonly canRestoreRun = computed(
    () => !this.writing() && this.restorableIds().size > 0,
  )
  /** Run affiche seulement : celui des Reglages ne fait pas tourner ce bouton. */
  protected readonly restoringRun = computed(() => {
    const inFlight = this.sidecar.rollingBack()

    return (
      inFlight !== null &&
      inFlight.trackId === null &&
      inFlight.runId === this.sidecar.taggingRunId()
    )
  })
  protected readonly restoringTrackId = computed(() => this.sidecar.rollingBack()?.trackId ?? null)
  /** Le bilan ne vaut que pour le run qu'il nomme. */
  protected readonly runRollbackFailures = computed(() => {
    const finished = this.sidecar.rollbackFinished()

    return finished !== null && finished.run_id === this.sidecar.taggingRunId()
      ? finished.failed
      : []
  })
```

`writeFailures` devient `computed(() => this.tracks().filter((track) => track.state === "write_error").length)` avec le commentaire `/** Compte sur les lignes : un morceau restaure sort du message et de la relance. */`. `error` lit aussi `"rollback"` : `this.sidecar.errorFor("start_tagging", "commit_run", "retry_write", "rollback")`. Dans `blockedReason`, après la branche `tagging.blocked.running` :

```ts
    if (this.sidecar.rollingBack() !== null) {
      return "tagging.blocked.restoring"
    }
```

Méthodes :

```ts
  protected restoreRun(): void {
    const runId = this.sidecar.taggingRunId()
    if (runId === null || this.filesBusy()) {
      return
    }
    this.confirmRestore(this.restorableIds().size, () => this.sidecar.rollback(runId))
  }

  protected restoreTrack(trackId: string): void {
    const runId = this.sidecar.taggingRunId()
    if (runId === null || this.filesBusy()) {
      return
    }
    this.confirmRestore(1, () => this.sidecar.rollback(runId, trackId))
  }

  /** Destructif comme l'ecriture : meme modale, bouton `danger`. */
  private confirmRestore(count: number, restore: () => Promise<void>): void {
    this.confirmation.confirm({
      header: this.translate.instant("tagging.rollback.header") as string,
      message: this.translate.instant("tagging.rollback.message", { count }) as string,
      acceptLabel: this.translate.instant("tagging.rollback.accept") as string,
      rejectLabel: this.translate.instant("tagging.commit.reject") as string,
      acceptButtonProps: { severity: "danger" },
      rejectButtonProps: { severity: "secondary", outlined: true },
      accept: () => {
        void restore()
      },
    })
  }
```

Dans `tagging-page.component.html`, la branche `@else if (committed())` de la barre devient :

```html
  } @else if (committed()) {
    @let written = writeProgress();
    <div class="flex items-end gap-4">
      <app-phase-progress
        class="min-w-0 flex-1"
        [label]="'tagging.write.phase' | translate"
        [counter]="written ? ('tagging.progress' | translate: written) : undefined"
        [value]="writePercentage()"
      />
      @if (canRestoreRun()) {
        <!-- Jamais a cote du bouton d'action du run. -->
        <button
          pButton
          type="button"
          size="small"
          severity="danger"
          [outlined]="true"
          class="shrink-0"
          data-action="restore-run"
          [disabled]="filesBusy()"
          (click)="restoreRun()"
        >
          @if (restoringRun()) {
            <app-icon name="spinner" [size]="16" />
          } @else {
            <app-icon name="refresh" [size]="16" />
          }
          {{ "tagging.rollback.run" | translate }}
        </button>
      }
    </div>
```

Après le message d'échec d'écriture : `<app-rollback-failures [failures]="runRollbackFailures()" />`. Sur `<app-run-list>` : `[restorableIds]="restorableIds()" [restoringTrackId]="restoringTrackId()" [restoreBlocked]="filesBusy()" (restore)="restoreTrack($event)"`.

- [ ] **Step 7: Traduire**

`fr.json`, dans `tagging` :

```json
    "rollback": {
      "run": "Annuler l'écriture",
      "track": "Restaurer ce morceau",
      "header": "Restaurer les fichiers",
      "message": "Fichiers à restaurer : {{count}}. Ils retrouvent leur nom et leurs tags d'origine. Les pochettes et les commentaires retirés par l'écriture ne reviennent pas.",
      "accept": "Restaurer",
      "blocked": "Une écriture ou une restauration est en cours."
    },
```

`tagging.blocked.restoring`, que `blockedReason` lit, est déjà défini par le sub-project 10.

`en.json` :

```json
    "rollback": {
      "run": "Undo writing",
      "track": "Restore this track",
      "header": "Restore files",
      "message": "Files to restore: {{count}}. They get back their original name and tags. Artwork and comments removed by the write do not come back.",
      "accept": "Restore",
      "blocked": "A write or a restore is in progress."
    },
```

- [ ] **Step 8: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/app/features/tagging/track-detail.component.ts src/app/features/tagging/track-detail.component.html src/app/features/tagging/track-detail.component.spec.ts src/app/features/tagging/run-list.component.ts src/app/features/tagging/run-list.component.html src/app/features/tagging/tagging-page.component.ts src/app/features/tagging/tagging-page.component.html src/app/features/tagging/tagging-page.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): restaurer un morceau ou le run affiché dans l'onglet Tagging"
```

---

### Task 3: Annuler le dernier run depuis les Réglages

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts`, `.html`, `.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`settings.admin`)

**Interfaces:**
- Consumes: Task 1 (`RollbackFailuresComponent`) ; `SidecarService.loadRollbackTarget`, `rollbackTarget`, `rollback`, `rollingBack`, `rollbackFinished`, `writing`, `tagging`, `errorFor` ; `ConfirmationService` racine (10) ; `TranslateService.currentLang()`.
- Produces: `SettingsPageComponent.restoreBlockedReason`, `targetLine`, `restoreLast()`.

- [ ] **Step 1: Écrire les specs**

Dans `settings-page.component.spec.ts`, `SidecarServiceStub` ajoute à son `Pick` `"rollbackTarget" | "rollingBack" | "rollbackFinished" | "writing" | "tagging" | "loadRollbackTarget" | "rollback"`, le stub par défaut gagne

```ts
    rollbackTarget: signal<RollbackRun | null | undefined>(undefined),
    rollingBack: signal(null),
    rollbackFinished: signal<RollbackFinishedEvent | null>(null),
    writing: signal(false),
    tagging: signal(false),
    loadRollbackTarget: vi.fn(() => Promise.resolve()),
    rollback: vi.fn(() => Promise.resolve()),
```

et les `providers` gagnent `ConfirmationService` (`primeng/api`). L'import de `@ngx-translate/core` devient `import { TranslateService, type TranslationObject, provideTranslateService } from "@ngx-translate/core"` ; importer aussi les types `RollbackRun`, `RollbackFinishedEvent`, et `ROLLBACK_RUN`, `rollbackFinished` (`../../../fixtures/write`). Puis :

```ts
  const translateWith = (admin: TranslationObject): void => {
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", { settings: { admin } })
    translate.use("en")
  }

  it("asks for the last undoable run and names it", () => {
    const { fixture, service } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })
    translateWith({ rollback: { target: "{{date}}|{{folder}}|{{count}}" } })
    fixture.detectChanges()

    const line = (fixture.nativeElement as HTMLElement).querySelector("[data-rollback-target]")

    expect(service.loadRollbackTarget).toHaveBeenCalled()
    expect(line?.textContent).toContain("|D:/Music/Promo Octobre|1")
    expect(line?.textContent).toContain("2026")
  })

  it("waits for the target before offering anything", () => {
    const { fixture, component } = mountWith()

    const line = (fixture.nativeElement as HTMLElement).querySelector("[data-rollback-target]")

    expect(line).toBeNull()
    expect(component["restoreBlockedReason"]()).toBe("settings.admin.rollback.loading")
  })

  it("says there is nothing to undo without a target", () => {
    const { fixture, component } = mountWith({ rollbackTarget: signal(null) })

    const line = (fixture.nativeElement as HTMLElement).querySelector("[data-rollback-target]")

    expect(line?.textContent).toContain("settings.admin.rollback.empty")
    expect(component["restoreBlockedReason"]()).toBe("settings.admin.rollback.none")
  })

  it("waits for the end of a run in progress before offering the undo", () => {
    const { component } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN), tagging: signal(true) })

    expect(component["restoreBlockedReason"]()).toBe("tagging.blocked.running")
  })

  it("undoes the last run after a confirmation that names it", () => {
    const { component, service } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })
    translateWith({ rollback: { message: "{{folder}} {{count}}" } })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["restoreLast"]()
    const options = confirm.mock.calls[0]?.[0]
    options?.accept?.()

    expect(options?.message).toBe("D:/Music/Promo Octobre 1")
    expect(options?.acceptButtonProps).toEqual({ severity: "danger" })
    expect(service.rollback).toHaveBeenCalledWith("a3f9c1")
  })

  it("shows the files left as they were and the rollback error", () => {
    const { fixture } = mountWith({
      rollbackTarget: signal(null),
      rollbackFinished: signal({
        ...rollbackFinished(),
        failed: [{ track_id: "a.mp3", file_name: "X - Y.mp3", reason: "name_taken" }],
      }),
      lastError: signal<SidecarErrorEvent>({
        event: "error",
        code: "tag_dump_unreadable",
        params: {},
        message: "",
        command: "rollback",
      }),
      lastErrorCommand: signal("rollback"),
    })

    const root = fixture.nativeElement as HTMLElement

    expect(root.querySelector("[data-rollback-failures]")).not.toBeNull()
    expect(root.querySelector("app-error-message")).not.toBeNull()
  })
```

- [ ] **Step 2: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL, `restoreBlockedReason` absent et `[data-rollback-target]` introuvable

- [ ] **Step 3: Logique de la rangée**

Dans `settings-page.component.ts` : le commentaire de classe devient `Section API et rangee Rollback : les autres reglages arrivent avec la Feature 7.` ; importer `ConfirmationService` (`primeng/api`), `ConfirmDialog` (`primeng/confirmdialog`), `Tooltip` (`primeng/tooltip`), `TranslateService`, `RollbackFailuresComponent`, `TruncatedTextComponent`, `TOOLTIP_DELAY` (`../../shared/utils/tooltip`) et les ajouter aux `imports` qui sont des composants ou directives. Puis :

```ts
/** `Intl` et non `DatePipe` : aucune locale FR n'est enregistree. */
const runDate = (iso: string, language: string | null): string =>
  new Intl.DateTimeFormat(language ?? undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  )
```

et dans la classe :

```ts
  private readonly confirmation = inject(ConfirmationService)
  private readonly translate = inject(TranslateService)

  protected readonly tooltipDelay = TOOLTIP_DELAY
  /** `undefined` tant que le moteur n'a pas repondu, `null` sans run annulable. */
  protected readonly target = this.sidecar.rollbackTarget
  protected readonly rollingBack = computed(() => this.sidecar.rollingBack() !== null)
  protected readonly targetLine = computed(() => {
    const target = this.target()

    return target === null || target === undefined
      ? null
      : {
          date: runDate(target.written_at, this.translate.currentLang()),
          folder: target.folder,
          count: target.tracks,
        }
  })
  protected readonly restoreBlockedReason = computed(() => {
    if (this.sidecar.tagging()) {
      return "tagging.blocked.running"
    }
    if (this.sidecar.writing() || this.sidecar.rollingBack() !== null) {
      return "settings.admin.rollback.busy"
    }
    const target = this.target()
    if (target === undefined) {
      return "settings.admin.rollback.loading"
    }

    return target === null ? "settings.admin.rollback.none" : null
  })
  protected readonly rollbackFailures = computed(() => this.sidecar.rollbackFinished()?.failed ?? [])
  protected readonly rollbackError = this.sidecar.errorFor("rollback", "get_rollback_target")

  constructor() {
    // Le dernier run annulable a pu etre ecrit dans une autre session : seul le moteur le sait.
    void this.sidecar.loadRollbackTarget()
  }

  protected restoreLast(): void {
    const target = this.target()
    const line = this.targetLine()
    if (target === null || target === undefined || line === null || this.restoreBlockedReason() !== null) {
      return
    }
    this.confirmation.confirm({
      header: this.translate.instant("settings.admin.rollback.header") as string,
      message: this.translate.instant("settings.admin.rollback.message", line) as string,
      acceptLabel: this.translate.instant("settings.admin.rollback.accept") as string,
      rejectLabel: this.translate.instant("settings.admin.rollback.reject") as string,
      acceptButtonProps: { severity: "danger" },
      rejectButtonProps: { severity: "secondary", outlined: true },
      accept: () => {
        void this.sidecar.rollback(target.run_id)
      },
    })
  }
```

- [ ] **Step 4: Template de la rangée**

À la fin de `settings-page.component.html` :

```html
<section class="flex flex-col gap-4">
  <h2 class="text-xl font-semibold">{{ "settings.admin.title" | translate }}</h2>

  <div class="flex items-start gap-4 border-b border-surface py-3">
    <div class="flex w-64 shrink-0 flex-col gap-2">
      <span class="text-sm">{{ "settings.admin.rollback.label" | translate }}</span>
      <span class="text-xs text-pretty text-muted-color">{{
        "settings.admin.rollback.hint" | translate
      }}</span>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-3">
      <div class="flex min-w-0 items-center gap-4">
        @let blocked = restoreBlockedReason() ? (restoreBlockedReason() | translate) : undefined;
        <button
          pButton
          type="button"
          size="small"
          severity="danger"
          [outlined]="true"
          class="shrink-0"
          data-action="restore-last"
          [disabled]="blocked !== undefined"
          [pTooltip]="blocked"
          [showDelay]="tooltipDelay"
          (click)="restoreLast()"
        >
          @if (rollingBack()) {
            <app-icon name="spinner" [size]="16" />
          } @else {
            <app-icon name="refresh" [size]="16" />
          }
          {{ "settings.admin.rollback.action" | translate }}
        </button>
        @if (targetLine(); as line) {
          <app-truncated-text
            class="text-sm text-muted-color"
            data-rollback-target
            [text]="'settings.admin.rollback.target' | translate: line"
          />
        } @else if (target() === null) {
          <span class="text-sm text-muted-color" data-rollback-target>{{
            "settings.admin.rollback.empty" | translate
          }}</span>
        }
      </div>

      @if (rollbackError(); as shown) {
        <app-error-message [error]="shown" />
      }
      <app-rollback-failures [failures]="rollbackFailures()" />
    </div>
  </div>
</section>

<!-- `contents` : pas de gap pour l'hote vide ; focus sur « Annuler » : Entree ne valide rien. -->
<p-confirmdialog class="contents" defaultFocus="reject" />
```

- [ ] **Step 5: Traduire**

`fr.json`, dans `settings` :

```json
    "admin": {
      "title": "Administration",
      "rollback": {
        "label": "Rollback",
        "hint": "Restaure les tags d'origine, par run ou par morceau.",
        "action": "Annuler le dernier run",
        "target": "Run du {{date}} sur {{folder}}. Morceaux à restaurer : {{count}}",
        "empty": "Aucun run à annuler",
        "none": "Aucun run à annuler : aucune sauvegarde de tags récente.",
        "loading": "Recherche du dernier run écrit…",
        "busy": "Une écriture ou une restauration est en cours.",
        "header": "Annuler le dernier run",
        "message": "Run du {{date}} sur {{folder}}. Fichiers à restaurer : {{count}}. Ils retrouvent leur nom et leurs tags d'origine. Les pochettes et les commentaires retirés par l'écriture ne reviennent pas.",
        "accept": "Restaurer",
        "reject": "Annuler"
      }
    }
```

`en.json` :

```json
    "admin": {
      "title": "Administration",
      "rollback": {
        "label": "Rollback",
        "hint": "Restores the original tags, per run or per track.",
        "action": "Undo the last run",
        "target": "Run of {{date}} on {{folder}}. Tracks to restore: {{count}}",
        "empty": "No run to undo",
        "none": "No run to undo: no recent tag backup.",
        "loading": "Looking for the last written run…",
        "busy": "A write or a restore is in progress.",
        "header": "Undo the last run",
        "message": "Run of {{date}} on {{folder}}. Files to restore: {{count}}. They get back their original name and tags. Artwork and comments removed by the write do not come back.",
        "accept": "Restore",
        "reject": "Cancel"
      }
    }
```

- [ ] **Step 6: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS

- [ ] **Step 7: Vérifier à l'écran**

Run: `just dev`. Écrire un petit run, restaurer un morceau depuis sa ligne dépliée, puis le reste par « Annuler l'écriture » ; vérifier « Restauré » et les noms d'origine dans l'explorateur. Écrire un deuxième run, fermer, relancer l'application, ouvrir les Réglages : la rangée nomme le run (date, dossier, nombre) ; l'annuler, la rangée passe au premier run s'il reste à restaurer, sinon « Aucun run à annuler ». Arrêter par `just stop`.

- [ ] **Step 8: Commit**

```bash
git add src/app/features/settings/settings-page.component.ts src/app/features/settings/settings-page.component.html src/app/features/settings/settings-page.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): annuler le dernier run depuis les Réglages"
```

---

### Task 4: DESIGN.md et notes de sync

**Files:**
- Modify: `docs/DESIGN.md`
- Modify: `.design-sync/NOTES.md`

- [ ] **Step 1: Mettre DESIGN.md à jour**

Charger `Skill[design-doc]` et lire son template avant d'éditer. Dans `docs/DESIGN.md` :
- § Couleurs Sémantiques (`docs/DESIGN.md:118-125`) : la famille Neutre couvre aussi `rolled_back`, icône `undo`, « Restauré » ; ajouter la ligne au tableau `state` / `resolution`, passer la source de la ligne Neutre à « dérivée, et `state` pour `rolled_back` » et reformuler la phrase « Deux familles sur quatre sont dérivées par l'interface et ne correspondent à aucune valeur de `state` », devenue fausse : seuls « en attente » et « à arbitrer » sont dérivés ;
- § Écriture et récapitulatif, ligne Rollback : « Par morceau sous la ligne dépliée (« Restaurer ce morceau »), par run au bout de la barre d'écriture (« Annuler l'écriture »), dernier run dans les Réglages ; icône `refresh` ; liste des fichiers non restaurés sous l'action, avec la phrase de leur motif » ;
- § Settings : ligne « Rollback » : « `button pButton` `severity="danger"` outlined + `p-confirmdialog`, section Administration ; la cible (date, dossier, nombre) à côté, « Aucun run à annuler » sans cible ».

- [ ] **Step 2: Consigner le reste ouvert de la maquette**

Dans `.design-sync/NOTES.md` § Reste ouvert : « État « Restauré » (`StateTag`), bouton « Restaurer ce morceau » de `TrackDetail`, « Annuler l'écriture » au bout de la barre d'écriture, cible du dernier run à côté du bouton de la rangée `Rollback` des Réglages, liste des fichiers non restaurés (2026-10-06) ».

- [ ] **Step 3: Vérifier le rendu**

Run: `just format-ui && just lint-ui`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/DESIGN.md .design-sync/NOTES.md
git commit -m "docs(design): rollback par morceau, par run et depuis les Réglages"
```
