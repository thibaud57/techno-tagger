# Confirmation et suivi de l'écriture : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirmer l'écriture d'un run depuis l'onglet Tagging, puis en suivre l'avancement, les échecs et leur relance, le run étant figé dès la confirmation.

**Architecture:** `StateTagComponent` lit `written` et `write_error`. Le signal `committed` du service fige le run dans la liste, le rattrapage, la garde de fermeture et le shell. La page Tagging porte un bouton d'action unique dérivé de la phase, les deux confirmations par `ConfirmationService`, la barre d'écriture et le message d'échec. La modale de fermeture lit `CloseGuard.blocked`.

**Tech Stack:** Angular 22 (zoneless, signals), PrimeNG 22.1.2 (`p-confirmdialog` et `ConfirmationService`, `pButton`, `p-message`, `pTooltip`), ngx-translate, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/10-confirmation-et-ecriture-ui-design.md`

## Global Constraints

- **Dépend du sub-project 08, implémenté avant** : sur `SidecarService`, `committed`, `writing`, `writeProgress`, `writeFinished`, `rollingBack`, `commitRun()`, `retryWrite()` ; `CloseGuard.blocked` ; libellés `app.close.write` et `app.close.rollback`. Et du 09 : `RunListComponent` à sept colonnes, `app-no-value`. Et du 07 : `SidecarService.taggingFolder`, le dossier de `run_started`.
- **Maquette** : `TaggingScreen.jsx` (rangée d'actions, barre `writing`, `Message` et relance du `Recap`) et `AppShell.jsx` (`ConfirmDialog` d'écriture, `CloseConfirmation`), lues avant d'écrire les templates (`.claude/rules/design/claude-design.md`).
- **Un seul bouton d'action**, à la largeur de son libellé, aligné à droite ; grisé, il garde son libellé et dit sa raison en tooltip.
- **`danger`** sur la seule confirmation, la relance et leurs boutons d'acceptation ; jamais sur la modale de fermeture.
- **Textes** : vouvoiement, infinitif pour les actions, espace insécable (U+00A0) avant `:` en français, aucun pluriel accordé par un nombre (forme « Libellé : {{count}} »), mêmes clés en FR et en EN.
- **Fonctions en `const nom = () =>`** ; tests en anglais, AAA séparé par des lignes vides.
- **Gate vert à chaque commit** : `just format-ui`, `just lint-ui`, `just typecheck-ui`, `just test-ui`. Commits `type(scope): description`, scope `ui` ou `docs`.

## Review Focus

- **Run interrompu pendant la recherche** : le bouton passe à « Confirmer l'écriture », le run interrompu gardant son écriture (Task 3, `offers to confirm an interrupted run`).
- **Confirmation refusée par un dump impossible** : l'erreur s'affiche, le bouton redevient « Confirmer l'écriture » et les lignes redeviennent actionnables (Task 2, `opens again when a refused commit falls back` ; Task 3, `shows an error raised by commit_run`).
- **Un seul morceau à écrire** : la confirmation ne dit pas « 1 fichiers », la forme « Libellé : 1 » évite l'accord (Task 3, `tells the counts in the confirmation`).
- **Relance qui laisse encore des échecs** : le message reste avec le nouveau nombre (Task 3, `keeps the failure message while failures remain`).
- **Clic sur le badge d'arbitrage resté affiché d'un run confirmé** : le badge a disparu, la modale ne s'ouvre pas (Task 2, `hides the queue badge and dialog once the run is committed`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/shared/components/state-tag.component.ts` | `written` comme `resolved`, `write_error`. |
| `src/app/features/tagging/run-list.component.ts`, `.html` | Colonne État remesurée, input `frozen`, attente d'arbitrage rendue « Non traité » sur un run figé. |
| `src/app/features/tagging/recovery-ui.store.ts` | Rattrapage fermé sur un run confirmé. |
| `src/app/core/close-guard.service.ts` | Arbitrages non comptés sur un run confirmé, run non confirmé compté (`unwritten`). |
| `src/app/app.component.ts` | Badge et modale d'arbitrage masqués sur un run confirmé. |
| `src/app/core/arbitration.store.ts`, `src/app/core/sidecar.service.ts` | Gestes d'arbitrage en vol agrégés (`anyBusy`, `arbitrationInFlight`). |
| `src/app/shared/components/icon.component.ts` | Icône `refresh`. |
| `src/app/app.config.ts` | `ConfirmationService`. |
| `src/app/features/tagging/tagging-page.component.ts`, `.html` | Bouton d'action, confirmations, barre, message d'échec, erreurs. |
| `src/app/shared/components/close-confirmation.component.ts` | Fermeture bloquée. |
| `public/i18n/{fr,en}.json` | Libellés. |
| `docs/DESIGN.md`, `.design-sync/NOTES.md` | Arbitrages, bouton d'action, fermeture, tooltip, relance, colonne État, reste ouvert. |

---

### Task 1: État « Échec d'écriture » et colonne État

**Files:**
- Modify: `src/app/shared/components/state-tag.component.ts`
- Modify: `src/app/shared/components/state-tag.component.spec.ts`
- Modify: `src/app/features/tagging/run-list.component.html` (en-tête de la colonne État)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.state.writeError`)

**Interfaces:**
- Produces: `app-state-tag` affiche `written` comme `resolved` et `write_error` en `danger`, `exclamation-triangle`, `tagging.state.writeError`.

- [ ] **Step 1: Écrire les cas**

Dans `src/app/shared/components/state-tag.component.spec.ts`, le commentaire de `CASES` devient `/** Les lignes de DESIGN.md § Couleurs Semantiques que le flux fait circuler. */` et le tableau gagne :

```ts
  {
    state: "written",
    resolution: "arbitration",
    awaiting: false,
    severity: "success",
    icon: "check",
    label: "tagging.state.arbitrated",
  },
  {
    state: "write_error",
    resolution: "auto",
    awaiting: false,
    severity: "danger",
    icon: "exclamation-triangle",
    label: "tagging.state.writeError",
  },
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `just test-ui`
Expected: FAIL sur les deux nouveaux cas (`secondary` et `tagging.state.pending` rendus au lieu de l'état attendu)

- [ ] **Step 3: Lire les deux états**

Dans `state-tag.component.ts`, après `UNRESOLVED` :

```ts
/** Meme rouge que « non resolu », icone distincte : on le rattrape par la relance. */
const WRITE_ERROR: StateStyle = {
  severity: "danger",
  icon: "exclamation-triangle",
  label: "tagging.state.writeError",
}
```

Le `switch` de `style` devient :

```ts
    switch (this.state()) {
      // `written` garde le libelle de sa voie (DESIGN.md § Couleurs Semantiques).
      case "resolved":
      case "written":
        return RESOLVED[this.resolution() ?? "none"]
      case "unresolved":
        return UNRESOLVED
      case "write_error":
        return WRITE_ERROR
      default:
        return this.interrupted() ? NOT_PROCESSED : PENDING
    }
```

- [ ] **Step 4: Traduire**

Dans `tagging.state`, après `notProcessed` : `fr.json` `"writeError": "Échec d'écriture"`, `en.json` `"writeError": "Write failed"`.

- [ ] **Step 5: Vérifier que tout passe**

Run: `just typecheck-ui && just test-ui`
Expected: PASS

- [ ] **Step 6: Remesurer la colonne État**

Lancer `just dev-ui`, afficher une ligne en `write_error` (fixtures de développement, ou un état forcé dans la console sur `TaggingRunStore`) en français. Dans les DevTools, relever la largeur du `<span class="inline-flex …">` qui porte le tag et l'icône info, y ajouter le padding horizontal de la cellule, puis arrondir au cran Tailwind supérieur (attendu vers `w-52`, 208px). Vérifier en anglais que « Write failed » tient. Dans `run-list.component.html`, remplacer `class="w-40"` de l'en-tête État par la classe mesurée et son commentaire par :

```html
      <!-- Mesuree sur « Echec d'ecriture » et son icone info, le plus long des etats livres
           (FR plus long que l'EN). L'etat restaure du rollback est a remesurer en l'ajoutant. -->
```

Arrêter par `just stop`.

- [ ] **Step 7: Lancer le gate**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/app/shared/components/state-tag.component.ts src/app/shared/components/state-tag.component.spec.ts src/app/features/tagging/run-list.component.html public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): état d'échec d'écriture et colonne État remesurée"
```

---

### Task 2: Run figé dès la confirmation

**Files:**
- Modify: `src/app/features/tagging/run-list.component.ts`, `.html`, `.spec.ts`
- Modify: `src/app/features/tagging/recovery-ui.store.ts`, `.spec.ts`
- Modify: `src/app/core/close-guard.service.ts`, `.spec.ts`
- Modify: `src/app/app.component.ts`, `.spec.ts`
- Modify: `src/app/features/tagging/tagging-page.component.ts`, `.html` (binding `frozen`)
- Modify: `src/app/features/tagging/tagging-page.component.spec.ts`, `src/app/features/tagging/url-recovery-dialog.component.spec.ts`, `src/app/features/tagging/arbitration-dialog.component.spec.ts` (stubs)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`app.close.unwritten`)

**Interfaces:**
- Consumes: `SidecarService.committed` (08), `taggingRunId` et `tagging`.
- Produces: `RunListComponent.frozen = input(false)` ; `RecoveryUiStore.available` faux sur un run confirmé ; `CloseGuard` sans travail `arbitration` sur un run confirmé, avec un travail `unwritten` (non bloquant) sur un run cherché mais non confirmé ; badge et modale d'arbitrage masqués.

- [ ] **Step 1: Compléter les stubs**

Ajouter `committed: signal(false)` au stub de `SidecarService` de `tagging-page.component.spec.ts` (`mountWith`), `recovery-ui.store.spec.ts` (`mount`), `url-recovery-dialog.component.spec.ts`, `arbitration-dialog.component.spec.ts`, `app.component.spec.ts` et au `sidecar` de `setup` dans `close-guard.service.spec.ts` : chacun instancie `RecoveryUiStore` ou `CloseGuard`, qui le lisent. Le `sidecar` de `setup` gagne aussi `taggingRunId: signal<string | null>(null)`, que `CloseGuard` lit pour compter un run non confirmé.

- [ ] **Step 2: Écrire les specs**

`run-list.component.spec.ts`, `mountWith` gagne un troisième paramètre `frozen = false` posé par `fixture.componentRef.setInput("frozen", frozen)` avant le premier `detectChanges`, puis :

```ts
  it("leaves the rows of a committed run without action", async () => {
    const fixture = await mountWith(
      [{ ...PENDING_TRACK, arbitration: arbitrationRequired(PENDING_TRACK.trackId) }, UNRESOLVED],
      new Set([UNRESOLVED.trackId]),
      true,
    )
    const asked = vi.fn()
    fixture.componentInstance.arbitrate.subscribe(asked)
    fixture.componentInstance.recover.subscribe(asked)
    const root = fixture.nativeElement as HTMLElement
    const rows = root.querySelectorAll<HTMLElement>("tbody tr")

    rows.forEach((row) => {
      row.click()
    })

    expect(asked).not.toHaveBeenCalled()
    expect([...rows].some((row) => row.hasAttribute("tabindex"))).toBe(false)
    expect(root.querySelector("p-skeleton")).toBeNull()
    expect(root.textContent).toContain("tagging.state.notProcessed")
  })
```

`recovery-ui.store.spec.ts`, dans un nouveau `describe("available")` :

```ts
  describe("available", () => {
    it("closes once the run is committed", () => {
      const { store, service } = mount()

      service.committed.set(true)

      expect(store.available()).toBe(false)
    })

    it("opens again when a refused commit falls back", () => {
      const { store, service } = mount()
      service.committed.set(true)

      service.committed.set(false)

      expect(store.available()).toBe(true)
    })
  })
```

`close-guard.service.spec.ts` :

```ts
  it("stops counting the arbitrations of a committed run", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.arbitrationCount.set(2)
    sidecar.committed.set(true)

    const held = appWindow.close()

    expect(held).toBe(false)
    expect(guard.request()).toBeNull()
  })

  it("counts an unwritten run as pending work", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.taggingRunId.set("a3f9c1")

    const held = appWindow.close()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([{ kind: "unwritten" }])
    expect(guard.blocked()).toBe(false)
  })
```

`app.component.spec.ts` :

```ts
  it("hides the queue badge and dialog once the run is committed", () => {
    const { fixture, component, service } = mount()
    service.arbitrationCount.set(2)
    fixture.detectChanges()

    service.committed.set(true)
    fixture.detectChanges()

    expect(badge(fixture.nativeElement as HTMLElement)).toBeNull()
    expect(component["arbitrationVisible"]()).toBe(false)
  })
```

(`mount`, `badge` et le signal `arbitrationCount` du stub existent déjà dans `app.component.spec.ts`).

- [ ] **Step 3: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL sur les cinq nouveaux cas

- [ ] **Step 4: Figer la liste**

Dans `run-list.component.ts`, après `recoverable` :

```ts
  /** Run confirme : plus aucune decision n'y entre, le sidecar les refuserait (`run_committed`). */
  readonly frozen = input(false)
```

et dans `rows`, `arbitrable: !this.frozen() && track.arbitration !== null,` et `recoverable: !this.frozen() && this.recoverable().has(track.trackId),`.

Dans `run-list.component.html`, un run figé n'attend plus rien : `app-state-tag` reçoit `[awaiting]="track.arbitrable"` (déjà faux sur un run figé) et `[interrupted]="interrupted() || frozen()"` ; la condition du squelette de la vignette devient `track.state === null && !interrupted() && !frozen()` ; `app-track-detail` reçoit `[interrupted]="interrupted() || frozen()"`. Les morceaux encore à arbitrer passent ainsi en « Non traité », avec le cadre neutre de pochette, au lieu de rester « À arbitrer » sur un squelette qui ne se résoudra plus.

Dans `tagging-page.component.ts`, `protected readonly committed = this.sidecar.committed` ; dans `tagging-page.component.html`, `<app-run-list>` gagne `[frozen]="committed()"`.

- [ ] **Step 5: Fermer le rattrapage, la garde et le shell**

`recovery-ui.store.ts` :

```ts
  /** Le sidecar refuse le geste pendant la recherche et sur un run confirme. */
  readonly available = computed(() => !this.sidecar.tagging() && !this.sidecar.committed())
```

`close-guard.service.ts` : `PendingWork` gagne `| { readonly kind: "unwritten" }` après `rollback`, hors `BLOCKING` (un run non écrit se quitte après confirmation). Dans `pendingWork` :

```ts
    // Un run confirme n'arbitrera plus : ses attentes ne sont pas un travail perdu.
    const count = this.sidecar.committed() ? 0 : this.sidecar.arbitrationCount()
```

Puis, avant `return work`, après les travaux `write` et `rollback` du 08 :

```ts
    // Un run cherche mais jamais confirme : rien n'est ecrit, ses resultats seraient perdus.
    if (
      this.sidecar.taggingRunId() !== null &&
      !this.sidecar.committed() &&
      !this.sidecar.tagging()
    ) {
      work.push({ kind: "unwritten" })
    }
```

`app.component.ts` : `arbitrationCount` devient

```ts
  /** Un run confirme n'accepte plus d'arbitrage : sa file reste, sans badge ni modale. */
  protected readonly arbitrationCount = computed(() =>
    this.sidecar.committed() ? 0 : this.sidecar.arbitrationCount(),
  )
```

et `queueEmpty` lit `this.arbitrationCount() === 0` au lieu de `this.sidecar.arbitrationCount() === 0`. Ajouter `computed` aux imports d'`@angular/core` s'il n'y est pas.

Dans `app.close`, après `rollback`, `public/i18n/fr.json` :

```json
      "unwritten": "Un run attend sa confirmation d'écriture : rien n'a été écrit, les résultats de la recherche seront perdus.",
```

`public/i18n/en.json` :

```json
      "unwritten": "A run awaits its write confirmation: nothing was written, the search results will be lost.",
```

- [ ] **Step 6: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/features/tagging/run-list.component.ts src/app/features/tagging/run-list.component.html src/app/features/tagging/run-list.component.spec.ts src/app/features/tagging/recovery-ui.store.ts src/app/features/tagging/recovery-ui.store.spec.ts src/app/core/close-guard.service.ts src/app/core/close-guard.service.spec.ts src/app/app.component.ts src/app/app.component.spec.ts src/app/features/tagging/tagging-page.component.ts src/app/features/tagging/tagging-page.component.html src/app/features/tagging/tagging-page.component.spec.ts src/app/features/tagging/url-recovery-dialog.component.spec.ts src/app/features/tagging/arbitration-dialog.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): figer le run dès la confirmation de l'écriture"
```

---

### Task 3: Bouton d'action, confirmations et suivi de l'écriture

**Files:**
- Modify: `src/app/app.config.ts`
- Modify: `src/app/core/arbitration.store.ts`, `.spec.ts`
- Modify: `src/app/core/sidecar.service.ts`
- Modify: `src/app/shared/components/icon.component.ts`
- Modify: `src/app/features/tagging/tagging-page.component.ts`
- Modify: `src/app/features/tagging/tagging-page.component.html`
- Modify: `src/app/features/tagging/tagging-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.commit`, `tagging.retry`, `tagging.write`, `tagging.blocked`)

**Interfaces:**
- Consumes: Task 2 (`committed` sur la page) ; `SidecarService.writing`, `writeProgress`, `writeFinished`, `rollingBack`, `commitRun()`, `retryWrite()`, `urlRecoveryBusy`, `errorFor` (08), `taggingFolder` (07) ; `ConfirmationService.confirm` (`header`, `message`, `acceptLabel`, `rejectLabel`, `acceptButtonProps`, `rejectButtonProps`, `accept`, vérifiés dans PrimeNG 22.1.2).
- Produces: `TaggingPageComponent.action: Signal<"start" | "cancel" | "commit">`, `commitBlockedReason`, `filesBusy`, `commit()`, `retry()`, `writeFailures` ; `ArbitrationStore.anyBusy` et `SidecarService.arbitrationInFlight` (un geste d'arbitrage en vol sur n'importe quel morceau) ; icône `refresh`.

- [ ] **Step 1: Écrire les specs**

Dans `tagging-page.component.spec.ts` : importer `ConfirmationService` (`primeng/api`), `TranslateService` (`@ngx-translate/core`, à côté de `provideTranslateService`), `WRITE_FINISHED` (`../../../fixtures/write`), `arbitrationRequired` (à côté de `PENDING_TRACK`), `open` (`@tauri-apps/plugin-dialog`, déjà mocké en tête de spec) et le type `TaggingTrack` ; les traductions se posent comme dans `url-recovery-dialog.component.spec.ts` (`setTranslation` puis `use`) ; ajouter `ConfirmationService` aux `providers` de `mountWith` ; compléter le stub par

```ts
    writing: signal(false),
    writeProgress: signal<{ processed: number; total: number } | null>(null),
    writeFinished: signal<typeof WRITE_FINISHED | null>(null),
    arbitrationInFlight: signal(false),
    rollingBack: signal<{ runId: string; trackId: string | null } | null>(null),
    taggingFolder: signal<string | null>(null),
    commitRun: vi.fn(() => Promise.resolve()),
    retryWrite: vi.fn(() => Promise.resolve()),
```

puis :

```ts
  const resolved = (trackId: string): TaggingTrack => ({
    ...PENDING_TRACK,
    trackId,
    state: "resolved",
    resolution: "auto",
  })
  const failed = (trackId: string): TaggingTrack => ({ ...resolved(trackId), state: "write_error" })

  it("cycles its single action with the phase", async () => {
    const tagging = signal(false)
    const runId = signal<string | null>(null)
    const committed = signal(false)
    const writing = signal(false)
    const { component } = await mountWith({
      tagging,
      taggingRunId: runId,
      taggingFolder: signal("D:/Sets/Aout"),
      committed,
      writing,
      taggingTracks: signal([resolved("a.mp3")]),
    })
    const seen = [component["action"]()]

    tagging.set(true)
    runId.set("a3f9c1")
    seen.push(component["action"]())
    tagging.set(false)
    seen.push(component["action"]())
    committed.set(true)
    writing.set(true)
    seen.push(component["action"]())
    writing.set(false)
    seen.push(component["action"]())

    expect(seen).toEqual(["start", "cancel", "commit", "commit", "start"])
  })

  it("offers to confirm an interrupted run", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Aout"),
      taggingInterrupted: signal(true),
      taggingTracks: signal([resolved("a.mp3")]),
    })

    expect(component["action"]()).toBe("commit")
  })

  it("starts over when another folder is chosen", async () => {
    vi.mocked(open).mockResolvedValueOnce("D:/Other")
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Aout"),
      taggingTracks: signal([resolved("a.mp3")]),
    })
    const before = component["action"]()

    await component["choose"]()

    expect(before).toBe("commit")
    expect(component["action"]()).toBe("start")
  })

  it("keeps the folder of the shown run when the page is recreated", async () => {
    const { component, fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Run"),
    })

    await fixture.whenStable()

    expect(component["folder"]()).toBe("D:/Sets/Run")
  })

  it.each([
    ["while a rollback runs", { rollingBack: signal({ runId: "a3f9c1", trackId: null }) }, "tagging.blocked.restoring"],
    ["while a link is being resolved", { urlRecoveryBusy: signal(new Set(["b.mp3"])) }, "tagging.blocked.recovering"],
    ["while an arbitration is in flight", { arbitrationInFlight: signal(true) }, "tagging.blocked.arbitrating"],
    ["without a resolved track", { taggingTracks: signal([]) }, "tagging.blocked.nothingToWrite"],
  ] as const)("blocks the confirmation %s", async (_name, overrides, reason) => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingTracks: signal([resolved("a.mp3")]),
      ...overrides,
    })

    expect(component["commitBlockedReason"]()).toBe(reason)
  })

  it("tells the counts in the confirmation and commits only on accept", async () => {
    const { component, service } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingFolder: signal("D:/Sets/Aout"),
      taggingTracks: signal([
        resolved("a.mp3"),
        { ...PENDING_TRACK, trackId: "b.mp3", state: "unresolved", resolution: "none" },
        { ...PENDING_TRACK, trackId: "c.mp3", arbitration: arbitrationRequired("c.mp3") },
      ]),
    })
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", {
      tagging: {
        commit: {
          message: "{{folder}} files {{count}}.",
          unresolved: "unresolved {{count}}.",
          awaiting: "awaiting {{count}}.",
        },
      },
    })
    translate.use("en")
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["commit"]()
    const options = confirm.mock.calls[0]?.[0]
    const before = service.commitRun.mock.calls.length
    options?.accept?.()

    expect(options?.message).toBe("D:/Sets/Aout files 1. unresolved 1. awaiting 1.")
    expect(options?.acceptButtonProps).toEqual({ severity: "danger" })
    expect(before).toBe(0)
    expect(service.commitRun).toHaveBeenCalledTimes(1)
  })

  it("leaves out the counts that are zero", async () => {
    const { component } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      taggingTracks: signal([resolved("a.mp3")]),
    })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["commit"]()

    expect(confirm.mock.calls[0]?.[0].message).toBe("tagging.commit.message")
  })

  it("keeps the failure message while failures remain, with a confirmed retry", async () => {
    const writeFinished = signal<typeof WRITE_FINISHED | null>({ ...WRITE_FINISHED, write_error: 2 })
    const taggingTracks = signal([failed("a.mp3"), failed("b.mp3")])
    const { component, service, fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks,
      writeFinished,
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
    taggingTracks.set([failed("b.mp3")])
    writeFinished.set({ ...WRITE_FINISHED, write_error: 1 })
    fixture.detectChanges()
    const remaining = shown()
    taggingTracks.set([resolved("b.mp3")])
    writeFinished.set({ ...WRITE_FINISHED, write_error: 0 })
    fixture.detectChanges()

    expect(before).toContain("failed 2")
    expect(service.retryWrite).toHaveBeenCalledTimes(1)
    expect(remaining).toContain("failed 1")
    expect(shown()).toBeUndefined()
  })

  it("disables the retry while a rollback runs", async () => {
    const { fixture } = await mountWith({
      taggingRunId: signal("a3f9c1"),
      committed: signal(true),
      taggingTracks: signal([failed("a.mp3")]),
      writeFinished: signal({ ...WRITE_FINISHED, write_error: 1 }),
      rollingBack: signal({ runId: "a3f9c1", trackId: null }),
    })
    fixture.detectChanges()

    const retry = host(fixture).querySelector<HTMLButtonElement>('[data-action="retry"]')

    expect(retry?.disabled).toBe(true)
  })

  it("shows an error raised by commit_run", async () => {
    const failure: SidecarErrorEvent = {
      event: "error",
      code: "tag_dump_write_failed",
      params: {},
      message: "",
      command: "commit_run",
    }
    const { component } = await mountWith({
      lastError: signal(failure),
      lastErrorCommand: signal("commit_run"),
    })

    expect(component["error"]()?.code).toBe("tag_dump_write_failed")
  })
```

`TaggingTrack` s'importe de `../../core/tagging-run.store`. Les deux tests existants `offers no way to interrupt before a run starts` et `interrupts the run in progress` restent valables (`[data-p-icon="stop"]` n'existe qu'en action `cancel`).

Dans `src/app/core/arbitration.store.spec.ts`, après « marks a track busy until its %s » :

```ts
  it("reports a gesture in flight on any track, not only the displayed one", () => {
    queue("a.mp3", "b.mp3")
    store.sent("b.mp3")
    const aggregated = store.anyBusy()
    const displayed = store.currentBusy()

    store.resolved("b.mp3")

    expect(aggregated).toBe(true)
    expect(displayed).toBe(false)
    expect(store.anyBusy()).toBe(false)
  })
```

- [ ] **Step 2: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL, `component["action"] is not a function` et `store.anyBusy is not a function`

- [ ] **Step 3: Fournir le service de confirmation**

Dans `src/app/app.config.ts`, importer `ConfirmationService` avec `MessageService` (`primeng/api`) et l'ajouter aux providers, après `MessageService` :

```ts
    // Partage par les `p-confirmdialog` de Tagging et des Reglages.
    ConfirmationService,
```

- [ ] **Step 4: Agréger les gestes en vol et ajouter l'icône `refresh`**

`arbitrationBusy` ne couvre que l'arbitrage affiché : un geste parti sur un autre morceau laisserait « Confirmer l'écriture » ouvert. Dans `src/app/core/arbitration.store.ts`, après `currentBusy` :

```ts
  /** Un geste en vol sur n'importe quel morceau : `currentBusy` ne voit que celui affiche. */
  readonly anyBusy = computed(() => this._busy().size > 0)
```

Dans `src/app/core/sidecar.service.ts`, après `arbitrationBusy` : `readonly arbitrationInFlight = this.arbitration.anyBusy`.

Dans `src/app/shared/components/icon.component.ts`, importer `Refresh` (`@primeicons/angular/refresh`), ajouter `"refresh"` à `ICON_NAMES` et `Refresh` aux `imports` du composant et dans le `@switch` :

```html
      @case ("refresh") {
        <svg data-p-icon="refresh" [size]="size()" />
      }
```

`icon.component.spec.ts` parcourt `ICON_NAMES` et couvre la nouvelle icône.

- [ ] **Step 5: Dériver le bouton et les confirmations**

Dans `tagging-page.component.ts` : importer `ConfirmationService` (`primeng/api`), `ConfirmDialog` (`primeng/confirmdialog`), `Message` (`primeng/message`), `TranslateService` (`@ngx-translate/core`) ; ajouter `ConfirmDialog` et `Message` aux `imports`. Champs :

```ts
  private readonly confirmation = inject(ConfirmationService)
  private readonly translate = inject(TranslateService)

  protected readonly writing = this.sidecar.writing
  protected readonly writeProgress = this.sidecar.writeProgress
  protected readonly writePercentage = computed(() => progressPercentage(this.writeProgress()))
  protected readonly writeFailures = computed(() => this.sidecar.writeFinished()?.write_error ?? 0)
  /** Une ecriture ou une restauration tourne : le moteur n'en accepte qu'une a la fois. */
  protected readonly filesBusy = computed(
    () => this.writing() || this.sidecar.rollingBack() !== null,
  )
  protected readonly action = computed<"start" | "cancel" | "commit">(() => {
    if (this.running()) {
      return "cancel"
    }
    if (this.writing()) {
      return "commit"
    }
    // Un autre dossier abandonne le run non ecrit ; le meme dossier le laisse confirmable.
    const unwritten =
      this.sidecar.taggingRunId() !== null &&
      !this.committed() &&
      this.folder() === this.sidecar.taggingFolder()

    return unwritten ? "commit" : "start"
  })
  /** Comptes lus sur les etats recus : l'interface ne decide rien de ce qui sera ecrit. */
  private readonly counts = computed(() => {
    const tracks = this.tracks()

    return {
      writable: tracks.filter((track) => track.state === "resolved").length,
      unresolved: tracks.filter((track) => track.state === "unresolved").length,
      awaiting: tracks.filter((track) => track.arbitration !== null).length,
    }
  })
  protected readonly commitBlockedReason = computed(() => {
    if (this.sidecar.rollingBack() !== null) {
      return "tagging.blocked.restoring"
    }
    if (this.writing()) {
      return "tagging.blocked.writing"
    }
    if (this.sidecar.urlRecoveryBusy().size > 0) {
      return "tagging.blocked.recovering"
    }
    if (this.sidecar.arbitrationInFlight()) {
      return "tagging.blocked.arbitrating"
    }
    if (this.counts().writable === 0) {
      return "tagging.blocked.nothingToWrite"
    }

    return null
  })
```

`error` devient `this.sidecar.errorFor("start_tagging", "commit_run", "retry_write")`. `choose()` et `start()` ne changent pas : choisir un autre dossier suffit à rendre `action` à `start`. `prefill()` reprend d'abord le dossier du run affiché, pour qu'une page recréée au retour sur l'onglet reste confirmable :

```ts
  private async prefill(): Promise<void> {
    // Page recreee : le run affiche prime sur la derniere destination.
    const runFolder = this.sidecar.taggingFolder()
    if (runFolder !== null) {
      this.folder.set(runFolder)

      return
    }
    const destination = await readLastDestination()
    if (destination !== null && this.folder() === "") {
      this.folder.set(destination)
    }
  }
```

Méthodes :

```ts
  protected commit(): void {
    if (this.commitBlockedReason() !== null) {
      return
    }
    const { writable, unresolved, awaiting } = this.counts()
    const sentences = [
      this.translate.instant("tagging.commit.message", {
        folder: this.sidecar.taggingFolder() ?? "",
        count: writable,
      }) as string,
      ...(unresolved > 0
        ? [this.translate.instant("tagging.commit.unresolved", { count: unresolved }) as string]
        : []),
      ...(awaiting > 0
        ? [this.translate.instant("tagging.commit.awaiting", { count: awaiting }) as string]
        : []),
    ]
    this.confirmation.confirm({
      header: this.translate.instant("tagging.commit.header") as string,
      message: sentences.join(" "),
      acceptLabel: this.translate.instant("tagging.commit.accept") as string,
      rejectLabel: this.translate.instant("tagging.commit.reject") as string,
      acceptButtonProps: { severity: "danger" },
      rejectButtonProps: { severity: "secondary", outlined: true },
      accept: () => {
        void this.sidecar.commitRun()
      },
    })
  }

  /** Destructive comme la confirmation : meme modale, meme bouton `danger`. */
  protected retry(): void {
    this.confirmation.confirm({
      header: this.translate.instant("tagging.retry.header") as string,
      message: this.translate.instant("tagging.retry.message", {
        count: this.writeFailures(),
      }) as string,
      acceptLabel: this.translate.instant("tagging.retry.accept") as string,
      rejectLabel: this.translate.instant("tagging.commit.reject") as string,
      acceptButtonProps: { severity: "danger" },
      rejectButtonProps: { severity: "secondary", outlined: true },
      accept: () => {
        void this.sidecar.retryWrite()
      },
    })
  }
```

`blockedReason` garde sa première branche `tagging.blocked.running` : elle ne s'affiche plus (l'action vaut `cancel` pendant la recherche) mais garde `start()` d'un appel direct.

- [ ] **Step 6: Template**

Dans `tagging-page.component.html`, le contenu de `<div class="flex items-center gap-4">` devient :

```html
      <!-- Un seul bouton d'action, dont le role suit la phase : jamais deux actions du run
           cote a cote (arbitrage du 2026-10-06, DESIGN.md § Arbitrages). -->
      @switch (action()) {
        @case ("cancel") {
          <button pButton type="button" severity="secondary" [outlined]="true" (click)="cancel()">
            <app-icon name="stop" [size]="16" />{{ "tagging.cancel" | translate }}
          </button>
        }
        @case ("commit") {
          @let commitBlocked = commitBlockedReason() ? (commitBlockedReason() | translate) : undefined;
          <button
            pButton
            type="button"
            severity="danger"
            data-action="commit"
            [disabled]="commitBlocked !== undefined"
            [pTooltip]="commitBlocked"
            [showDelay]="tooltipDelay"
            (click)="commit()"
          >
            @if (writing()) {
              <app-icon name="spinner" [size]="16" />
            } @else {
              <app-icon name="check" [size]="16" />
            }
            {{ "tagging.commit.action" | translate }}
          </button>
        }
        @default {
          @let blockedText = blockedReason() ? (blockedReason() | translate) : undefined;
          <button
            pButton
            type="button"
            data-action="start"
            [disabled]="!canStart()"
            [pTooltip]="blockedText"
            [showDelay]="tooltipDelay"
            (click)="start()"
          >
            <app-icon name="play" [size]="16" />{{ "tagging.start" | translate }}
          </button>
        }
      }
```

Après le bloc `@if (error(); as shown)` :

```html
  @if (writeFailures() > 0 && !writing()) {
    <p-message severity="error" data-write-failures>
      <div class="flex w-full items-center justify-between gap-4">
        <span>{{ "tagging.write.failed" | translate: { count: writeFailures() } }}</span>
        <button
          pButton
          type="button"
          size="small"
          severity="danger"
          [outlined]="true"
          class="shrink-0"
          data-action="retry"
          [disabled]="filesBusy()"
          (click)="retry()"
        >
          <app-icon name="refresh" [size]="16" />{{ "tagging.retry.action" | translate }}
        </button>
      </div>
    </p-message>
  }
```

La barre de phase : entre la branche `@if (running())` et `@else if (recovery(); as phase)`, insérer

```html
  } @else if (committed()) {
    @let written = writeProgress();
    <app-phase-progress
      [label]="'tagging.write.phase' | translate"
      [counter]="written ? ('tagging.progress' | translate: written) : undefined"
      [value]="writePercentage()"
    />
```

Et avant le commentaire `contents` de la modale du lien :

```html
  <!-- `contents` : pas de gap pour l'hote vide ; focus sur « Annuler » : Entree ne valide rien. -->
  <p-confirmdialog class="contents" defaultFocus="reject" />
```

- [ ] **Step 7: Traduire**

Dans `tagging` de `fr.json` :

```json
    "commit": {
      "action": "Confirmer l'écriture",
      "header": "Confirmer l'écriture",
      "message": "Dossier {{folder}}. Fichiers à réécrire et renommer en « Artiste - Titre » : {{count}}. Les tags d'origine sont sauvegardés avant : un rollback reste possible, par run ou par morceau.",
      "unresolved": "Non résolus, qui ne seront pas touchés : {{count}}.",
      "awaiting": "Encore à arbitrer, qui ne seront ni écrits ni arbitrables : {{count}}.",
      "accept": "Écrire les tags",
      "reject": "Annuler"
    },
    "retry": {
      "action": "Relancer l'écriture",
      "header": "Relancer l'écriture",
      "message": "Fichiers en échec à réécrire : {{count}}. Seuls ces fichiers sont repris, sans nouvelle recherche ni arbitrage.",
      "accept": "Relancer l'écriture"
    },
    "write": {
      "phase": "Écriture des tags, pochettes et renommage",
      "failed": "Fichiers en échec d'écriture : {{count}}. Un fichier verrouillé n'arrête pas le run : fermez le programme qui le tient, puis relancez l'écriture."
    },
```

et dans `tagging.blocked` : `"writing": "L'écriture est en cours."`, `"arbitrating": "Attendez la réponse de l'arbitrage en cours."`, `"nothingToWrite": "Aucun morceau résolu à écrire. Rattrapez-en par lien, ou choisissez un dossier pour lancer un autre run."`, `"restoring": "Attendez la fin de la restauration en cours."`.

Dans `en.json`, aux mêmes endroits :

```json
    "commit": {
      "action": "Confirm writing",
      "header": "Confirm writing",
      "message": "Folder {{folder}}. Files to rewrite and rename to “Artist - Title”: {{count}}. The original tags are backed up first: a rollback remains possible, per run or per track.",
      "unresolved": "Unresolved, left untouched: {{count}}.",
      "awaiting": "Still awaiting arbitration, neither written nor arbitrable afterwards: {{count}}.",
      "accept": "Write the tags",
      "reject": "Cancel"
    },
    "retry": {
      "action": "Retry writing",
      "header": "Retry writing",
      "message": "Failed files to rewrite: {{count}}. Only these files are retried, with no new search or arbitration.",
      "accept": "Retry writing"
    },
    "write": {
      "phase": "Writing tags, artwork and file names",
      "failed": "Files that failed to write: {{count}}. A locked file does not stop the run: close the program holding it, then retry writing."
    },
```

et `"writing": "Writing is in progress."`, `"arbitrating": "Wait for the arbitration being sent."`, `"nothingToWrite": "No resolved track to write. Recover some by link, or choose a folder to start another run."`, `"restoring": "Wait for the restore in progress to finish."`.

- [ ] **Step 8: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS

- [ ] **Step 9: Vérifier à l'écran**

Run: `just dev`. Lancer un run sur un petit dossier, l'interrompre une fois, relancer, laisser finir ; confirmer (lire les nombres de la modale), verrouiller un fichier dans un lecteur pendant l'écriture ; constater la barre d'écriture, les lignes écrites et l'échec avec son motif, le message et la relance confirmée après avoir libéré le fichier ; constater que lignes et badges ne s'ouvrent plus après confirmation. Avec un dossier choisi par le dialogue, « Confirmer l'écriture » doit bien apparaître en fin de recherche (la comparaison au dossier du run est textuelle), puis « Lancer le run » dès qu'un autre dossier est choisi. Arrêter par `just stop`.

- [ ] **Step 10: Commit**

```bash
git add src/app/app.config.ts src/app/core/arbitration.store.ts src/app/core/arbitration.store.spec.ts src/app/core/sidecar.service.ts src/app/shared/components/icon.component.ts src/app/features/tagging/tagging-page.component.ts src/app/features/tagging/tagging-page.component.html src/app/features/tagging/tagging-page.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): confirmer l'écriture et suivre sa progression dans l'onglet Tagging"
```

---

### Task 4: Fermeture bloquée

**Files:**
- Modify: `src/app/shared/components/close-confirmation.component.ts`
- Modify: `src/app/shared/components/close-confirmation.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`app.close.blockedTitle`)

**Interfaces:**
- Consumes: `CloseGuard.blocked` (08).

- [ ] **Step 1: Écrire la spec**

Dans `close-confirmation.component.spec.ts`, `mount` prend `blocked = false` et le `guard` gagne `blocked: signal(blocked)` ; puis :

```ts
  it("offers only to stay while files are being written", () => {
    mount(true)

    const text = page().textContent

    expect(text).toContain("app.close.blockedTitle")
    expect(action("leave")).toBeNull()
    expect(action("stay")).not.toBeNull()
  })
```

(`action` et `page` viennent de `../../../fixtures/dialog`, déjà importés ; `action` rend `null` pour un bouton absent).

- [ ] **Step 2: Vérifier qu'elle échoue**

Run: `just test-ui`
Expected: FAIL, le bouton « Quitter quand même » est présent

- [ ] **Step 3: Mode bloqué**

Dans `close-confirmation.component.ts`, `protected readonly blocked = this.guard.blocked`. Le titre devient `{{ (blocked() ? "app.close.blockedTitle" : "app.close.title") | translate }}` et le bouton `leave` s'entoure de `@if (!blocked()) { … }`. Le commentaire du composant gagne : « Bloquee pendant une ecriture ou un rollback : Tauri arreterait le sidecar en plein fichier. »

- [ ] **Step 4: Traduire**

Dans `app.close`, après `title` : `fr.json` `"blockedTitle": "Impossible de quitter maintenant"`, `en.json` `"blockedTitle": "You cannot quit right now"`.

- [ ] **Step 5: Vérifier que tout passe**

Run: `just format-ui && just typecheck-ui && just test-ui && just lint-ui`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/shared/components/close-confirmation.component.ts src/app/shared/components/close-confirmation.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): modale de fermeture bloquée pendant l'écriture"
```

---

### Task 5: DESIGN.md et notes de sync

**Files:**
- Modify: `docs/DESIGN.md`
- Modify: `.design-sync/NOTES.md`

- [ ] **Step 1: Mettre DESIGN.md à jour**

Charger `Skill[design-doc]` et lire son template avant d'éditer. Dans `docs/DESIGN.md` :
- § Arbitrages, remplacer l'entrée « Bouton « Lancer le run » pendant la phase » par : « **Bouton d'action du run** : un seul bouton qui suit la phase, « Lancer le run », « Interrompre » pendant la recherche, « Confirmer l'écriture » (`danger`) sur un run cherché non écrit, à la largeur de son libellé ; choisir un autre dossier abandonne un run non écrit. Là où la maquette posait « Interrompre » à côté de « Lancer le run » et où l'arbitrage du 2026-10-03 gardait « Lancer le run » pendant le rattrapage. Décidé le 2026-10-06 » ;
- § Écriture et récapitulatif, ligne « Relance de l'écriture en échec » : « Dans l'onglet Tagging, sous un `p-message` d'échec au-dessus de la liste, en attendant le récapitulatif (Feature 6) » ;
- § Layout, ligne de la colonne État : la mesure sur « Échec d'écriture » et son icône info, avec la largeur retenue à la Task 1 ;
- § Mapping Composants, lignes « Lancement du run » et « Interruption du run » (`docs/DESIGN.md:269-270`) : un seul bouton d'action qui suit la phase ; « Interrompre » prend la place du lancement pendant la recherche au lieu de se poser à sa gauche ; le lancement n'y reste plus grisé à côté ;
- § Mapping Composants, ligne « Confirmation de sortie » (`docs/DESIGN.md:250`) : bloquée pendant l'écriture ou un rollback, la modale se titre « Impossible de quitter maintenant » et n'offre que « Rester » ; un run cherché mais non confirmé compte parmi les travaux perdus ;
- § Tokens de Tooltip (`docs/DESIGN.md:106`) : le motif d'un morceau en échec d'écriture rejoint celui d'un non résolu parmi les exceptions au tooltip jamais seul porteur d'une information ;
- § Arbitrages, à la suite : « **Relance de l'écriture** : libellé « Relancer l'écriture » et bouton dans l'onglet Tagging, sous le message d'échec, là où la maquette l'intitule « Relancer l'écriture sur les échecs » dans le `Recap`. Décidé le 2026-10-06 ».

- [ ] **Step 2: Consigner le reste ouvert de la maquette**

Dans `.design-sync/NOTES.md` § Reste ouvert, ajouter : « `TaggingScreen` : bouton d'action unique (lancer, interrompre, confirmer), message d'échec d'écriture et relance dans l'onglet ; `AppShell` : lien de simulation `écriture ?` devenu inutile, `CloseConfirmation` à « Rester » seul pendant l'écriture (2026-10-06) ».

- [ ] **Step 3: Vérifier le rendu**

Run: `just format-ui && just lint-ui`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add docs/DESIGN.md .design-sync/NOTES.md
git commit -m "docs(design): bouton d'action du run, relance de l'écriture et colonne État"
```
