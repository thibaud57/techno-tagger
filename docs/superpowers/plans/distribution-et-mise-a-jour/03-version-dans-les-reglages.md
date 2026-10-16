# Version dans les Réglages : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher dans les Réglages la version installée de l'application et permettre de lancer à la main la recherche d'une mise à jour.

**Architecture:** Deux tâches :
- `UpdateService.checkNow()` : rouvre une mise à jour déjà connue, sinon interroge l'updater et ouvre la modale sur une version trouvée, puis rend « trouvée », « à jour » ou « échec » ;
- la rangée Version, dernière d'Administration : version installée (`APP_VERSION`) en aide, bouton « Rechercher une mise à jour », retour `app-message` sous la rangée. S'y ajoutent les libellés et la documentation.

**Tech Stack:** Angular 22 (signals), PrimeNG 22 (`Button`), ngx-translate 18, Vitest.

**Spec:** `docs/superpowers/specs/distribution-et-mise-a-jour/03-version-dans-les-reglages-design.md`

## Global Constraints

- **Dépend du sub-project 02, implémenté avant** : `UpdateService` (`state`, `update`, `dialogVisible`, `badgeVisible`, `check()`, `dismiss()`, `reopen()`), `APP_UPDATER`, `availableUpdate()`, `updaterStub()` de `src/fixtures/updater.ts`.
- **Aucun Sentry sur une recherche manuelle en échec** : seul un téléchargement ou une installation en échec en envoie un (sub-project 02).
- **Recherche permise pendant un travail** : elle ne ferme rien, la modale garde « Installer » désactivé.
- **Rangée sur le motif de Cache et Logs** : libellé seul à gauche, aide à gauche de la ligne du bouton, retour dessous (arbitrage « Rangée de Réglages »). Bouton `size="small"` `secondary` outlined.
- **Libellés** : ngx-translate, deux fichiers dans le même commit, une phrase par ligne (`\n`), vouvoiement. Aucun libellé de ce plan ne contient `:`, `?` ou `!`.
- **Commentaires TypeScript sans accents**, le pourquoi seulement.
- **Tests** : noms en anglais, AAA, aucun test de plomberie PrimeNG (no-lib-test). Une réponse asynchrone s'attend par `vi.waitFor`, jamais par `fixture.whenStable()`, qui ne suit pas une promesse du composant (cf. `settings-page.component.spec.ts`).
- **Docs gouvernées par un skill** : `Skill[design-doc]` avant `docs/DESIGN.md`.
- **Gate vert à chaque commit** : `just format-ui && just lint-ui && just typecheck-ui && just test-ui`. Commits `type(scope): description`, scope `settings`.
- **Numéros de ligne** : relevés le 2026-10-15, avant le sub-project 02 et la fin de la Feature 7, qui éditent les mêmes fichiers. Chercher le texte cité, pas la ligne.

## Review Focus

- **Double clic sur le bouton** : une seule vérification, le bouton étant désactivé dès le clic (Task 2, `disables the button while checking`).
- **Retour d'une recherche précédente** : effacé au clic suivant, avant la réponse (Task 2, `clears the previous feedback as soon as a new check starts`).
- **Mise à jour en échec de téléchargement** : la recherche rouvre la modale sur son échec, sans nouvelle vérification (Task 1, `reopens a known update without checking again`, état `failed`).
- **Hors Tauri** : la vérification lève, la rangée affiche l'échec (Task 2, `shows the failure after a failed check`).
- **Section quittée puis rouverte** : le retour est perdu avec le composant, sans conséquence (aucun test : comportement de rendu d'Angular).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/platform/update.service.ts` | `ManualCheck`, `checkNow()` |
| `src/app/features/settings/settings-page.component.{ts,html}` | Rangée Version |
| `public/i18n/{fr,en}.json` | `settings.admin.version` |
| `docs/DESIGN.md`, `.design-sync/NOTES.md` | Rangées des Réglages, arbitrage, reste ouvert |

---

### Task 1: Recherche manuelle dans `UpdateService`

**Files:**
- Modify: `src/app/core/platform/update.service.ts`
- Test: `src/app/core/platform/update.service.spec.ts`

**Interfaces:**
- Consumes : `UpdateService` et ses fixtures (sub-project 02).
- Produces : `type ManualCheck = "found" | "upToDate" | "failed"`, `UpdateService.checkNow(): Promise<ManualCheck>`.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans le `describe("UpdateService")` de `update.service.spec.ts` (le `mount` et `failing()` existent déjà) :

```ts
  it("reports the latest version when the manual check finds nothing", async () => {
    const { service } = mount(updaterStub(null))

    const outcome = await service.checkNow()

    expect(outcome).toBe("upToDate")
    expect(service.dialogVisible()).toBe(false)
  })

  it("opens the dialog on an update found by the manual check", async () => {
    const updater = updaterStub(null)
    const { service } = mount(updater)
    await service.check()
    updater.check.mockResolvedValueOnce(availableUpdate())

    const outcome = await service.checkNow()

    expect(outcome).toBe("found")
    expect(service.dialogVisible()).toBe(true)
  })

  it("reports a failed manual check without Sentry", async () => {
    const { service } = mount(updaterStub(new Error("offline")))

    const outcome = await service.checkNow()

    expect(outcome).toBe("failed")
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it("reopens a known update without checking again", async () => {
    const updater = updaterStub(failing())
    const { service } = mount(updater)
    await service.check()
    await service.install()
    service.dismiss()

    const outcome = await service.checkNow()

    expect(outcome).toBe("found")
    expect(service.dialogVisible()).toBe(true)
    expect(service.state().kind).toBe("failed")
    expect(updater.check).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/platform/update.service.spec.ts`
Expected: FAIL, `service.checkNow is not a function`.

- [ ] **Step 3: Écrire `checkNow()`**

Dans `update.service.ts`, après le type `UpdateState` :

```ts
/** Issue d'une recherche lancee depuis les Reglages, pour le retour de la rangee. */
export type ManualCheck = "found" | "upToDate" | "failed"
```

et dans la classe, après `check()` :

```ts
  /**
   * Recherche des Reglages : une mise a jour deja connue rouvre simplement la modale. Un echec
   * ne part pas a Sentry, pas plus qu'au demarrage.
   */
  async checkNow(): Promise<ManualCheck> {
    if (this.update() === null) {
      let update: AvailableUpdate | null
      try {
        update = await this.updater.check()
      } catch {
        return "failed"
      }
      if (update === null) {
        return "upToDate"
      }
      this._state.set({ kind: "available", update })
    }
    this.reopen()

    return "found"
  }
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/core/platform/update.service.spec.ts`
Expected: vert, les tests du sub-project 02 compris.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/platform/update.service.ts src/app/core/platform/update.service.spec.ts
git commit -m "feat(settings): recherche manuelle d'une mise a jour"
```

---

### Task 2: Rangée Version d'Administration

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts`
- Modify: `src/app/features/settings/settings-page.component.html` (`@case ("admin")`, après la rangée Runs passés)
- Test: `src/app/features/settings/settings-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`settings.admin.version`, après `rollback`)
- Modify: `docs/DESIGN.md`, `.design-sync/NOTES.md`

**Interfaces:**
- Consumes : `UpdateService.checkNow(): Promise<ManualCheck>` (Task 1) ; `APP_UPDATER`, `availableUpdate()`, `updaterStub()` ; `APP_VERSION` (constante de build injectée par `--define`, `'0.0.0-dev'` sous `ng test` et `ng build` nus, cf. `angular.json`).

- [ ] **Step 1: Ajouter les libellés**

`public/i18n/fr.json`, dans `settings.admin`, après le bloc `rollback` (virgule après sa `}`) :

```json
      "version": {
        "label": "Version",
        "installed": "Version {{version}} installée.",
        "action": "Rechercher une mise à jour",
        "upToDate": "Vous utilisez la dernière version.",
        "failed": "Vérification impossible.\nVérifiez votre connexion, puis réessayez."
      }
```

`public/i18n/en.json`, même place :

```json
      "version": {
        "label": "Version",
        "installed": "Version {{version}} installed.",
        "action": "Check for updates",
        "upToDate": "You are using the latest version.",
        "failed": "Check failed.\nCheck your connection, then try again."
      }
```

- [ ] **Step 2: Écrire les tests qui échouent**

Dans `settings-page.component.spec.ts` :
- importer `availableUpdate`, `updaterStub` depuis `../../../fixtures/updater`, `APP_UPDATER` depuis `../../core/platform/updater`, `UpdateService` depuis `../../core/platform/update.service` (`TestBed`, `hostOf` et `translateWith` y sont déjà) ;
- `mountWith` prend un troisième paramètre `updater = updaterStub()` et ajoute `{ provide: APP_UPDATER, useValue: updater }` aux providers, puis le rend dans son objet de retour ;
- ajouter le bloc :

```ts
describe("version row", () => {
  const row = (fixture: { nativeElement: unknown }): HTMLElement | null =>
    hostOf(fixture).querySelector<HTMLElement>("[data-version-row]")
  const checkButton = (fixture: { nativeElement: unknown }): HTMLButtonElement | null =>
    hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="check-update"]')

  it("shows the installed version", () => {
    const { fixture } = mountWith({}, "admin")
    translateWith({ settings: { admin: { version: { installed: "Installed {{version}}" } } } })
    fixture.detectChanges()

    const text = row(fixture)?.textContent

    expect(text).toContain(`Installed ${APP_VERSION}`)
  })

  /** La recherche est une promesse que `whenStable` ne suit pas : on attend son retour. */
  const settled = async (fixture: { detectChanges(): void }, component: SettingsPageComponent) => {
    await vi.waitFor(() => {
      expect(component["checkingUpdate"]()).toBe(false)
    })
    fixture.detectChanges()
  }

  it("shows the latest-version message after a check finding nothing", async () => {
    const { fixture, component } = mountWith({}, "admin", updaterStub(null))

    checkButton(fixture)?.click()
    await settled(fixture, component)

    expect(row(fixture)?.querySelector("[data-version-up-to-date]")).not.toBeNull()
  })

  it("shows the failure after a failed check", async () => {
    const { fixture, component } = mountWith({}, "admin", updaterStub(new Error("offline")))

    checkButton(fixture)?.click()
    await settled(fixture, component)

    expect(row(fixture)?.querySelector("[data-version-error]")).not.toBeNull()
  })

  it("shows no feedback when an update is found", async () => {
    const { fixture, component } = mountWith({}, "admin", updaterStub(availableUpdate()))
    const updates = TestBed.inject(UpdateService)

    checkButton(fixture)?.click()
    await settled(fixture, component)

    expect(updates.dialogVisible()).toBe(true)
    expect(row(fixture)?.querySelector("app-message")).toBeNull()
  })

  it("disables the button and shows the spinner while checking", () => {
    const pending = updaterStub()
    pending.check.mockReturnValueOnce(new Promise(() => undefined))
    const { fixture } = mountWith({}, "admin", pending)

    checkButton(fixture)?.click()
    checkButton(fixture)?.click()
    fixture.detectChanges()

    expect(checkButton(fixture)?.disabled).toBe(true)
    expect(checkButton(fixture)?.querySelector('svg[data-p-icon="spinner"]')).not.toBeNull()
    expect(pending.check).toHaveBeenCalledOnce()
  })

  it("clears the previous feedback as soon as a new check starts", async () => {
    const updater = updaterStub(null)
    const { fixture, component } = mountWith({}, "admin", updater)
    checkButton(fixture)?.click()
    await settled(fixture, component)
    const shownBefore = row(fixture)?.querySelector("app-message")
    updater.check.mockReturnValueOnce(new Promise(() => undefined))

    checkButton(fixture)?.click()
    fixture.detectChanges()

    expect(shownBefore).not.toBeNull()
    expect(row(fixture)?.querySelector("app-message")).toBeNull()
  })
})
```

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/features/settings/settings-page.component.spec.ts`
Expected: FAIL, aucun `[data-version-row]`.

- [ ] **Step 4: Écrire la rangée**

`settings-page.component.ts` :
- importer `UpdateService` et `type ManualCheck` depuis `../../core/platform/update.service` ;
- après `private readonly translate = inject(TranslateService)` :

```ts
  private readonly updates = inject(UpdateService)
```

- avec les autres membres de la section Administration :

```ts
  protected readonly appVersion = APP_VERSION
  protected readonly checkingUpdate = signal(false)
  /** Retour de la derniere recherche ; « trouvee » n'en a pas, la modale s'ouvre. */
  protected readonly updateCheck = signal<Exclude<ManualCheck, "found"> | null>(null)
```

- avec les autres gestes :

```ts
  protected async checkUpdate(): Promise<void> {
    // Le bouton n'est grise qu'au rendu suivant : la garde tient le double clic.
    if (this.checkingUpdate()) {
      return
    }
    this.updateCheck.set(null)
    this.checkingUpdate.set(true)
    const outcome = await this.updates.checkNow()
    this.checkingUpdate.set(false)
    this.updateCheck.set(outcome === "found" ? null : outcome)
  }
```

`settings-page.component.html`, dans le `@case ("admin")`, après la `</app-settings-row>` de Runs passés :

```html
        <app-settings-row data-version-row>
          <span rowLabel class="text-sm">{{ "settings.admin.version.label" | translate }}</span>

          <!-- Sans champ, l'aide prend la place du controle, sur la ligne du bouton. -->
          <div rowControl class="flex min-w-0 items-center justify-between gap-4">
            <span class="text-xs text-pretty whitespace-pre-line text-muted-color">{{
              "settings.admin.version.installed" | translate: { version: appVersion }
            }}</span>
            <button
              pButton
              type="button"
              size="small"
              severity="secondary"
              [outlined]="true"
              class="shrink-0"
              data-action="check-update"
              [disabled]="checkingUpdate()"
              (click)="checkUpdate()"
            >
              <app-icon [name]="checkingUpdate() ? 'spinner' : 'refresh'" [size]="16" />
              {{ "settings.admin.version.action" | translate }}
            </button>
          </div>

          @switch (updateCheck()) {
            @case ("upToDate") {
              <app-message data-version-up-to-date severity="success" size="small">{{
                "settings.admin.version.upToDate" | translate
              }}</app-message>
            }
            @case ("failed") {
              <app-message data-version-error severity="error" size="small">{{
                "settings.admin.version.failed" | translate
              }}</app-message>
            }
          }
        </app-settings-row>
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/features/settings/settings-page.component.spec.ts --include=src/app/core/i18n/translations.spec.ts`
Expected: vert, tests existants des Réglages compris.

- [ ] **Step 6: Contrôler la hauteur de la section**

Sous `ng serve` (skill `dev-server`, `just dev-ui`), fenêtre de 1024 × 700 (plancher), ouvrir Réglages > Administration, cliquer « Rechercher une mise à jour » (hors Tauri, l'échec s'affiche).
Expected : les cinq rangées et le message d'échec tiennent sans défilement de la page.

- [ ] **Step 7: Documenter**

`docs/DESIGN.md` :
- dans la description des Réglages (§ Structure de Page, le compte des rangées), ajouter une rangée au compte relu à ce moment (la Feature 7 l'aura peut-être déjà changé) et Version aux rangées d'Administration ;
- en fin de § Arbitrages :
  ```markdown
  - **Rangée Version** : dernière d'Administration, version installée en aide sur la ligne du bouton « Rechercher une mise à jour » (`secondary` outlined, `refresh`, `spinner` pendant la recherche), retour `Message` small dessous, success si à jour, error si la vérification échoue ; une mise à jour trouvée ouvre la modale de mise à jour. Absente de la maquette. Décidé le 2026-10-15
  ```

`.design-sync/NOTES.md`, § Reste ouvert :
```markdown
- **`SettingsScreen`** : rangée Version d'Administration (version installée, « Rechercher une mise à jour », retours à jour et échec) livrée par le code, absente de la maquette (cf. DESIGN.md § Arbitrages, constaté le 2026-10-15).
```

- [ ] **Step 8: Gate**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: vert.

- [ ] **Step 9: Commit**

```bash
git add src/app/features/settings/settings-page.component.ts src/app/features/settings/settings-page.component.html src/app/features/settings/settings-page.component.spec.ts public/i18n/fr.json public/i18n/en.json docs/DESIGN.md .design-sync/NOTES.md
git commit -m "feat(settings): version installee et recherche de mise a jour dans l'administration"
```
