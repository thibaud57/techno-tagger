# Confirmation de sortie : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demander confirmation à la fermeture de la fenêtre dès qu'un travail n'est pas terminé, quel que soit l'onglet qui l'a lancé : extraction de playlist, run de tagging ou arbitrages en attente.

**Architecture:** Un jeton `APP_WINDOW` enveloppe la fenêtre Tauri (`onCloseRequested`, `destroy`) comme `SIDECAR_TRANSPORT` enveloppe le sidecar. Un `CloseGuard` dans `core` agrège les travaux en cours, retient la fermeture quand il y en a et prend un instantané que le `CloseConfirmationComponent` affiche. Le shell installe la garde et monte la confirmation hors de ses deux branches ; la capability gagne `core:window:allow-destroy`, sans quoi une fermeture interceptée ne pourrait plus aboutir.

**Tech Stack:** Angular 22 (signals, `afterRenderEffect`), PrimeNG 22 (`Dialog`, `ButtonDirective`), `@tauri-apps/api` 2.11 (`getCurrentWindow`), ngx-translate 18, Vitest. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/arbitrage-utilisateur/05-confirmation-sortie-design.md`

## Global Constraints

- **Dépend des sub-projects 03 et 04** : `SidecarService.extracting`, `SidecarService.tagging`, `SidecarService.arbitrationCount` ; `src/app/app.component.spec.ts` et son `mount()` créés par la Task 2 du 04.
- **Ordre fixe des travaux** : `extraction`, `tagging`, `arbitration` (avec `count`).
- **API Tauri** (`@tauri-apps/api/window`, vérifiée dans `node_modules` le 2026-09-26) : `onCloseRequested` attend le handler puis appelle `destroy()` si `preventDefault()` n'a pas été appelé. Un écouteur posé prend donc la fermeture à son compte, d'où `core:window:allow-destroy`.
- **Aucun `danger`**, aucun `p-confirmdialog` : `p-dialog`, « Quitter quand même » en `outlined` `secondary`, « Rester » en primary et focus à l'ouverture (fiche ConfirmDialog, DESIGN.md § Palette > Règles).
- **Pas d'attribut `autofocus`** : `templateAccessibility` d'angular-eslint l'interdit ; le focus se pose par code.
- **Aucune ligne dans `src-tauri/src/`**.
- **Libellés** : français au vouvoiement, espace insécable littérale (U+00A0, comme le reste de `fr.json`) avant `:` et `?`.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, fenêtre simulée par `APP_WINDOW`, `provideTranslateService()` sans loader.
- **Gate vert à chaque commit** : `just lint-ui`, `just typecheck-ui`, `just test-ui`. Commits `type(scope): description`, scopes `ui` et `tauri`.

## Review Focus

- **Travail qui s'achève pendant la confirmation** : l'instantané ne bouge pas (Task 1, `keeps the snapshot when the work ends during the confirmation`).
- **`destroy()` refusé** (capability manquante) : la confirmation se referme, l'application reste utilisable, rien ne lève (Task 1, `reopens the application when the window refuses to close`).
- **Fermeture redemandée pendant la confirmation** : l'instantané est remplacé par l'état du moment (Task 1, `replaces the snapshot when closing is asked again`).
- **Écran bloquant** (sidecar mort) : rien en cours, la fenêtre se ferme (Task 1, couvert par `lets the window close when no work is pending`, les trois signaux étant retombés).
- **Focus à l'ouverture** : sur « Rester », jamais sur « Quitter quand même » (Task 2, `puts the focus on the stay button`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/app-window.ts` | Jeton `APP_WINDOW`, fenêtre Tauri de production, absorption hors Tauri. |
| `src/app/core/close-guard.service.ts` | Travaux en cours, interception, instantané, rester ou quitter. |
| `src/app/core/close-guard.service.spec.ts` | Règles de la garde sur fenêtre simulée. |
| `src/app/shared/components/close-confirmation.component.ts` | La modale de confirmation. |
| `src/app/shared/components/close-confirmation.component.spec.ts` | Ce qu'elle nomme et ce que font ses boutons. |
| `src/app/app.component.ts`, `.html`, `.spec.ts` | Installation de la garde, montage de la confirmation. |
| `src-tauri/capabilities/default.json` | `core:window:allow-destroy`. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Bloc `app.close.*`. |
| `docs/DESIGN.md`, `docs/BRAINSTORM.md`, `docs/adrs/009-enchainement-sources-et-arbitrage.md`, `.design-sync/NOTES.md` | Confirmation élargie, mapping, reste ouvert. |

---

## Task 1: Garde de fermeture

**Files:**
- Create: `src/app/core/app-window.ts`
- Create: `src/app/core/close-guard.service.ts`
- Test: `src/app/core/close-guard.service.spec.ts`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `SidecarService.extracting`, `SidecarService.tagging`, `SidecarService.arbitrationCount`.
- Produces:
  - `interface CloseRequest { preventDefault(): void }`, `interface AppWindow { onCloseRequested(handler: (request: CloseRequest) => void): Promise<boolean>; destroy(): Promise<void> }`, `APP_WINDOW: InjectionToken<AppWindow>`
  - `type PendingWork = { kind: "extraction" } | { kind: "tagging" } | { kind: "arbitration"; count: number }`
  - `CloseGuard` : `pendingWork: Signal<readonly PendingWork[]>`, `request: Signal<readonly PendingWork[] | null>`, `install(): Promise<void>`, `stay(): void`, `leave(): Promise<void>`

- [ ] **Step 1: Écrire les tests de la garde**

Créer `src/app/core/close-guard.service.spec.ts` :

```typescript
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"

import { APP_WINDOW, type AppWindow, type CloseRequest } from "./app-window"
import { CloseGuard } from "./close-guard.service"
import { SidecarService } from "./sidecar.service"

/** Fenetre simulee a sa frontiere, comme le transport du sidecar. */
class FakeWindow implements AppWindow {
  handler: ((request: CloseRequest) => void) | null = null
  registrations = 0
  destroyed = 0
  inTauri = true
  refuseDestroy = false

  onCloseRequested(handler: (request: CloseRequest) => void): Promise<boolean> {
    this.registrations += 1
    if (!this.inTauri) {
      return Promise.resolve(false)
    }
    this.handler = handler

    return Promise.resolve(true)
  }

  destroy(): Promise<void> {
    if (this.refuseDestroy) {
      return Promise.reject(new Error("window.destroy not allowed"))
    }
    this.destroyed += 1

    return Promise.resolve()
  }

  /** Simule un clic sur la croix de la fenetre ; rend vrai si la garde l'a retenue. */
  close(): boolean {
    let held = false
    this.handler?.({
      preventDefault: () => {
        held = true
      },
    })

    return held
  }
}

const setup = async () => {
  const appWindow = new FakeWindow()
  const sidecar = {
    extracting: signal(false),
    tagging: signal(false),
    arbitrationCount: signal(0),
  }
  TestBed.configureTestingModule({
    providers: [
      { provide: APP_WINDOW, useValue: appWindow },
      { provide: SidecarService, useValue: sidecar },
    ],
  })
  const guard = TestBed.inject(CloseGuard)
  await guard.install()

  return { appWindow, sidecar, guard }
}

type Sidecar = Awaited<ReturnType<typeof setup>>["sidecar"]

describe("CloseGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("lets the window close when no work is pending", async () => {
    const { appWindow, guard } = await setup()

    const held = appWindow.close()

    expect(held).toBe(false)
    expect(guard.request()).toBeNull()
  })

  it.each<[string, (sidecar: Sidecar) => void]>([
    [
      "an extraction",
      (sidecar) => {
        sidecar.extracting.set(true)
      },
    ],
    [
      "a tagging run",
      (sidecar) => {
        sidecar.tagging.set(true)
      },
    ],
    [
      "pending arbitrations",
      (sidecar) => {
        sidecar.arbitrationCount.set(2)
      },
    ],
  ])("holds the window and asks for confirmation during %s", async (_work, start) => {
    const { appWindow, sidecar, guard } = await setup()
    start(sidecar)

    const held = appWindow.close()

    expect(held).toBe(true)
    expect(guard.request()).toHaveLength(1)
  })

  it("lists the pending work in a fixed order", async () => {
    const { sidecar, guard } = await setup()

    sidecar.arbitrationCount.set(2)
    sidecar.tagging.set(true)
    sidecar.extracting.set(true)

    expect(guard.pendingWork()).toEqual([
      { kind: "extraction" },
      { kind: "tagging" },
      { kind: "arbitration", count: 2 },
    ])
  })

  it("closes the window for good when the user leaves", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    appWindow.close()

    await guard.leave()

    expect(appWindow.destroyed).toBe(1)
  })

  it("keeps the window open when the user stays", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    appWindow.close()

    guard.stay()

    expect(guard.request()).toBeNull()
    expect(appWindow.destroyed).toBe(0)
  })

  it("installs its listener only once", async () => {
    const { appWindow, guard } = await setup()

    await guard.install()

    expect(appWindow.registrations).toBe(1)
  })

  it("stays silent outside Tauri", async () => {
    const appWindow = new FakeWindow()
    appWindow.inTauri = false
    TestBed.configureTestingModule({
      providers: [
        { provide: APP_WINDOW, useValue: appWindow },
        {
          provide: SidecarService,
          useValue: { extracting: signal(true), tagging: signal(false), arbitrationCount: signal(0) },
        },
      ],
    })
    const guard = TestBed.inject(CloseGuard)

    await guard.install()

    expect(appWindow.close()).toBe(false)
    expect(guard.request()).toBeNull()
  })

  it("keeps the snapshot when the work ends during the confirmation", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    appWindow.close()

    sidecar.tagging.set(false)

    expect(guard.request()).toEqual([{ kind: "tagging" }])
  })

  it("replaces the snapshot when closing is asked again", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    appWindow.close()
    sidecar.arbitrationCount.set(1)

    appWindow.close()

    expect(guard.request()).toEqual([{ kind: "tagging" }, { kind: "arbitration", count: 1 }])
  })

  it("reopens the application when the window refuses to close", async () => {
    const { appWindow, sidecar, guard } = await setup()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    appWindow.refuseDestroy = true
    sidecar.tagging.set(true)
    appWindow.close()

    await guard.leave()

    expect(guard.request()).toBeNull()
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/close-guard.service.spec.ts`
Expected: FAIL, les modules `./app-window` et `./close-guard.service` sont introuvables

- [ ] **Step 3: Créer le jeton de fenêtre**

Créer `src/app/core/app-window.ts` :

```typescript
import { InjectionToken } from "@angular/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

/** Ce que la garde fait d'une demande de fermeture : la retenir. */
export interface CloseRequest {
  preventDefault(): void
}

/** La fenetre vue par la garde de fermeture : testable sans Tauri, comme le transport du sidecar. */
export interface AppWindow {
  /** Rend `false` hors Tauri, ou l'inscription echoue : l'ecran reste utilisable. */
  onCloseRequested(handler: (request: CloseRequest) => void): Promise<boolean>
  destroy(): Promise<void>
}

class TauriAppWindow implements AppWindow {
  async onCloseRequested(handler: (request: CloseRequest) => void): Promise<boolean> {
    try {
      // Un ecouteur pose prend la fermeture a son compte : sans `preventDefault`, l'API
      // appelle `destroy()` apres lui, d'ou `core:window:allow-destroy` dans la capability.
      await getCurrentWindow().onCloseRequested(handler)

      return true
    } catch {
      // Hors Tauri, `getCurrentWindow` echoue faute de `window.__TAURI_INTERNALS__`.
      return false
    }
  }

  async destroy(): Promise<void> {
    await getCurrentWindow().destroy()
  }
}

export const APP_WINDOW = new InjectionToken<AppWindow>("AppWindow", {
  providedIn: "root",
  factory: () => new TauriAppWindow(),
})
```

- [ ] **Step 4: Créer la garde**

Créer `src/app/core/close-guard.service.ts` :

```typescript
import { Injectable, computed, inject, signal } from "@angular/core"

import { APP_WINDOW } from "./app-window"
import { SidecarService } from "./sidecar.service"

/** Un travail que la fermeture interromprait. */
export type PendingWork =
  | { readonly kind: "extraction" }
  | { readonly kind: "tagging" }
  | { readonly kind: "arbitration"; readonly count: number }

/**
 * Garde unique de la fermeture de la fenetre, pour tous les onglets. Rien n'est persiste
 * avant la Feature 6 (ADR-010) : fermer en plein travail le perd.
 */
@Injectable({ providedIn: "root" })
export class CloseGuard {
  private readonly appWindow = inject(APP_WINDOW)
  private readonly sidecar = inject(SidecarService)

  private readonly _request = signal<readonly PendingWork[] | null>(null)
  private installed = false

  /**
   * Les travaux en cours, dans un ordre fixe. Une Feature qui ajoute un travail
   * interruptible (rattrapage par URL, ecriture) y ajoute sa ligne.
   */
  readonly pendingWork = computed<readonly PendingWork[]>(() => {
    const work: PendingWork[] = []
    if (this.sidecar.extracting()) {
      work.push({ kind: "extraction" })
    }
    if (this.sidecar.tagging()) {
      work.push({ kind: "tagging" })
    }
    const count = this.sidecar.arbitrationCount()
    if (count > 0) {
      work.push({ kind: "arbitration", count })
    }

    return work
  })
  /**
   * Instantane pris a la demande de fermeture, `null` hors confirmation : un travail qui
   * s'acheve pendant la lecture ne fait ni disparaitre une ligne ni fermer a la place de
   * l'utilisateur.
   */
  readonly request = this._request.asReadonly()

  async install(): Promise<void> {
    if (this.installed) {
      return
    }
    this.installed = true
    await this.appWindow.onCloseRequested((close) => {
      const pending = this.pendingWork()
      if (pending.length > 0) {
        close.preventDefault()
        this._request.set(pending)
      }
    })
  }

  stay(): void {
    this._request.set(null)
  }

  /** `destroy` ferme sans repasser par l'ecouteur. Refuse, l'application reste utilisable. */
  async leave(): Promise<void> {
    try {
      await this.appWindow.destroy()
    } catch (error) {
      console.error("[close-guard] fermeture refusee", error)
      this._request.set(null)
    }
  }
}
```

- [ ] **Step 5: Autoriser la fermeture interceptée**

Vérifier l'identifiant : `pnpm exec tauri permission ls | grep "allow-destroy"` (règle `.claude/rules/tauri/capabilities.md` : ne jamais inventer un identifiant). Puis, dans `src-tauri/capabilities/default.json`, ajouter après `"core:default",` :

```json
    "core:window:allow-destroy",
```

et compléter la `description` du fichier par « fermeture de la fenêtre après confirmation ».

- [ ] **Step 6: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/close-guard.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Gate**

Run: `just lint-ui && just typecheck-ui && just test-ui && just lint-tauri`
Expected: tout vert. `just lint-tauri` exige le binaire du sidecar dans `src-tauri/binaries/` (Tauri valide `externalBin` dès la compilation) : `just build-sidecar` d'abord s'il manque.

- [ ] **Step 8: Commit**

```bash
git add src/app/core/app-window.ts src/app/core/close-guard.service.ts src/app/core/close-guard.service.spec.ts src-tauri/capabilities/default.json
git commit -m "feat(ui): retenir la fermeture de la fenetre tant qu'un travail est en cours"
```

---

## Task 2: Modale de confirmation et montage dans le shell

**Files:**
- Create: `src/app/shared/components/close-confirmation.component.ts`
- Test: `src/app/shared/components/close-confirmation.component.spec.ts`
- Modify: `src/app/app.component.ts`, `src/app/app.component.html`, `src/app/app.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `CloseGuard`, `PendingWork` (Task 1).
- Produces: `CloseConfirmationComponent`, sélecteur `app-close-confirmation`, sans input.

- [ ] **Step 1: Ajouter les libellés**

Dans `public/i18n/fr.json`, bloc `app`, ajouter à côté de `blocked` (espaces insécables littérales avant `?` et `:`) :

```json
    "close": {
      "title": "Quitter l'application ?",
      "extraction": "Une extraction est en cours : la copie sera coupée, et un fichier peut rester à moitié écrit dans la destination.",
      "tagging": "Un run de tagging est en cours : la recherche s'arrête là et ses résultats seront perdus.",
      "arbitration": "Arbitrages en attente : {{count}}. Ils seront perdus.",
      "stay": "Rester",
      "leave": "Quitter quand même"
    },
```

Dans `public/i18n/en.json`, au même endroit :

```json
    "close": {
      "title": "Quit the application?",
      "extraction": "An extraction is in progress: the copy will be cut short, and a file may be left half-written in the destination.",
      "tagging": "A tagging run is in progress: the search stops here and its results will be lost.",
      "arbitration": "Arbitrations awaiting a decision: {{count}}. They will be lost.",
      "stay": "Stay",
      "leave": "Quit anyway"
    },
```

- [ ] **Step 2: Écrire les tests de la modale**

Créer `src/app/shared/components/close-confirmation.component.spec.ts` :

```typescript
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { CloseGuard, type PendingWork } from "../../core/close-guard.service"

import { CloseConfirmationComponent } from "./close-confirmation.component"

const mount = () => {
  const guard = {
    request: signal<readonly PendingWork[] | null>([
      { kind: "extraction" },
      { kind: "tagging" },
      { kind: "arbitration", count: 2 },
    ]),
    stay: vi.fn(),
    leave: vi.fn(() => Promise.resolve()),
  }
  TestBed.configureTestingModule({
    imports: [CloseConfirmationComponent],
    providers: [provideTranslateService(), { provide: CloseGuard, useValue: guard }],
  })
  const fixture = TestBed.createComponent(CloseConfirmationComponent)
  fixture.detectChanges()

  return { fixture, guard }
}

/** Le dialog peut etre rendu hors de l'hote : la page entiere est interrogee. */
const page = (): HTMLElement => document.body

const action = (name: string): HTMLButtonElement | null =>
  page().querySelector<HTMLButtonElement>(`[data-action="${name}"]`)

describe("CloseConfirmationComponent", () => {
  it("names every pending work", () => {
    mount()

    const text = page().textContent ?? ""

    const positions = ["extraction", "tagging", "arbitration"].map((kind) =>
      text.indexOf(`app.close.${kind}`),
    )
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it("leaves the application only on the leave button", () => {
    const { guard } = mount()
    action("stay")?.click()
    const afterStay = guard.leave.mock.calls.length

    action("leave")?.click()

    expect(afterStay).toBe(0)
    expect(guard.stay).toHaveBeenCalledOnce()
    expect(guard.leave).toHaveBeenCalledOnce()
  })

  it("stays when the cross is used", () => {
    const { guard } = mount()

    page().querySelector<HTMLButtonElement>('[aria-label="app.close.stay"]')?.click()

    expect(guard.stay).toHaveBeenCalledOnce()
    expect(guard.leave).not.toHaveBeenCalled()
  })

  it("puts the focus on the stay button", async () => {
    const { fixture } = mount()

    await fixture.whenStable()

    expect(document.activeElement).toBe(action("stay"))
  })
})
```

`"stays when the cross is used"` : la croix du `p-dialog` porte `closeAriaLabel`, posé sur `app.close.stay`, et `(visibleChange)` rappelle `stay()`.

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/shared/components/close-confirmation.component.spec.ts`
Expected: FAIL, le module `./close-confirmation.component` est introuvable

- [ ] **Step 4: Créer la modale**

Créer `src/app/shared/components/close-confirmation.component.ts` :

```typescript
import { Component, ElementRef, afterRenderEffect, inject, viewChild } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Dialog } from "primeng/dialog"

import { CloseGuard } from "../../core/close-guard.service"

/**
 * Bornee : les phrases passent a la ligne au lieu d'etirer la modale. 32rem tient le titre
 * et les deux boutons cote a cote en francais, la plus longue des deux langues.
 */
const DIALOG_SIZE = { width: "32rem" } as const

/**
 * Confirmation de sortie : un `p-dialog` et non un `p-confirmdialog`, reserve aux trois
 * actions qui touchent aux fichiers musicaux (fiche ConfirmDialog). Aucun `danger`.
 */
@Component({
  selector: "app-close-confirmation",
  imports: [Dialog, ButtonDirective, TranslatePipe],
  template: `
    <p-dialog
      [visible]="request() !== null"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [closeOnEscape]="true"
      [focusOnShow]="false"
      [style]="dialogSize"
      [closeAriaLabel]="'app.close.stay' | translate"
    >
      <ng-template #header>
        <span class="text-lg font-semibold">{{ "app.close.title" | translate }}</span>
      </ng-template>

      <ul class="flex flex-col gap-2 text-sm">
        @for (work of request() ?? []; track work.kind) {
          <li>{{ "app.close." + work.kind | translate: work }}</li>
        }
      </ul>

      <ng-template #footer>
        <button
          pButton
          type="button"
          size="small"
          [outlined]="true"
          severity="secondary"
          data-action="leave"
          (click)="leave()"
        >
          {{ "app.close.leave" | translate }}
        </button>
        <button #stay pButton type="button" size="small" data-action="stay" (click)="stayOpen()">
          {{ "app.close.stay" | translate }}
        </button>
      </ng-template>
    </p-dialog>
  `,
})
export class CloseConfirmationComponent {
  private readonly guard = inject(CloseGuard)

  protected readonly dialogSize = DIALOG_SIZE
  protected readonly request = this.guard.request

  private readonly stayButton = viewChild("stay", { read: ElementRef })

  constructor() {
    // Focus pose par code : `autofocus` est interdit par `templateAccessibility`, et le
    // `focusOnShow` du dialog le donnerait au premier bouton, « Quitter quand meme ».
    afterRenderEffect(() => {
      const button = this.stayButton()?.nativeElement as HTMLElement | undefined
      if (this.request() !== null) {
        button?.focus()
      }
    })
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.guard.stay()
    }
  }

  protected stayOpen(): void {
    this.guard.stay()
  }

  protected leave(): void {
    void this.guard.leave()
  }
}
```

- [ ] **Step 5: Installer la garde et monter la modale**

Dans `src/app/app.component.ts` :

1. Importer `CloseGuard` depuis `./core/close-guard.service` et `CloseConfirmationComponent` depuis `./shared/components/close-confirmation.component`, et ajouter ce dernier aux `imports` du décorateur.
2. Ajouter `private readonly closeGuard = inject(CloseGuard)` après les autres injections.
3. Au début du constructeur, ajouter :

```typescript
    // Une fois, au demarrage : la fermeture est retenue tant qu'un travail est en cours.
    void this.closeGuard.install()
```

Dans `src/app/app.component.html`, ajouter avant `<p-toast position="bottom-right" />`, hors du bloc `@if (blocked()) … @else …` :

```html
<!-- Hors des deux branches : l'ecran bloquant peut coexister avec une demande de sortie. -->
<app-close-confirmation />
```

- [ ] **Step 6: Tester l'installation au démarrage**

Dans `src/app/app.component.spec.ts` (créé par le sub-project 04), ajouter les imports :

```typescript
import { CloseGuard } from "./core/close-guard.service"
```

remplacer la fonction `mount` par :

```typescript
const mount = () => {
  const service = {
    available: signal<boolean | null>(true),
    versionMismatch: signal(null),
    arbitrationCount: signal(0),
  }
  const closeGuard = {
    install: vi.fn(() => Promise.resolve()),
    request: signal(null),
    stay: vi.fn(),
    leave: vi.fn(() => Promise.resolve()),
  }
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      provideRouter([]),
      provideTranslateService(),
      // `p-toast` du shell l'injecte ; l'application le fournit a la racine (app.config.ts).
      MessageService,
      { provide: SidecarService, useValue: service },
      { provide: CloseGuard, useValue: closeGuard },
    ],
  })
  TestBed.overrideComponent(AppComponent, {
    remove: { imports: [ArbitrationDialogComponent] },
    add: { imports: [DialogStub] },
  })
  const fixture = TestBed.createComponent(AppComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service, closeGuard }
}
```

et ajouter à la fin du `describe("AppComponent")` :

```typescript
  it("installs the close guard at startup", () => {
    const { closeGuard } = mount()

    const calls = closeGuard.install.mock.calls.length

    expect(calls).toBe(1)
  })
```

- [ ] **Step 7: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/shared/components/close-confirmation.component.spec.ts --include=src/app/app.component.spec.ts`
Expected: PASS

- [ ] **Step 8: Gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

- [ ] **Step 9: Vérifier la vraie fermeture**

Sous `just dev` : lancer un run sur un dossier de test et fermer la fenêtre pendant la phase réseau : la confirmation nomme le run ; « Rester » garde l'application, « Quitter quand même » la ferme. Relancer, attendre la fin d'un run sans zone grise, fermer : la fenêtre se ferme directement. Une fenêtre qui ne se ferme plus du tout trahit une permission `core:window:allow-destroy` absente.

- [ ] **Step 10: Commit**

```bash
git add src/app/shared/components/close-confirmation.component.ts src/app/shared/components/close-confirmation.component.spec.ts src/app/app.component.ts src/app/app.component.html src/app/app.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): confirmer la sortie quand un travail est en cours"
```

---

## Task 3: Docs

**Files:**
- Modify: `docs/DESIGN.md`
- Modify: `docs/BRAINSTORM.md`
- Modify: `docs/adrs/009-enchainement-sources-et-arbitrage.md`
- Modify: `.design-sync/NOTES.md`

Charger `Skill[design-doc]` avant DESIGN.md, `Skill[brainstorm-doc]` avant BRAINSTORM.md et `Skill[architecture-doc]` avant l'ADR : chaque gabarit porte la structure et le style attendus (`~/.claude/CLAUDE.md` § Agents, Commandes & Skills).

- [ ] **Step 1: Mapping**

Dans `docs/DESIGN.md` § Mapping Composants > Navigation, ajouter sous la ligne « Navigation principale » :

```markdown
| Confirmation de sortie | `p-dialog` modal, « Rester » primary et focus à l'ouverture, « Quitter quand même » outlined secondary | PrimeNG | À la fermeture de la fenêtre tant qu'une extraction, un run ou des arbitrages sont en cours. Pas de `p-confirmdialog` ni de `danger` : la sortie ne touche aucun fichier musical. Nomme chaque travail perdu, et le fichier qu'une copie coupée peut laisser à moitié écrit |
```

- [ ] **Step 2: Brainstorm**

Dans `docs/BRAINSTORM.md`, Feature 3, remplacer la puce :

```markdown
- Tentative de quitter avec des morceaux encore en cours : modale de confirmation
```

par :

```markdown
- Tentative de quitter avec un travail en cours, quel que soit l'onglet : extraction, run ou arbitrages en attente. Une modale de confirmation nomme ce qui sera perdu. Élargie le 2026-09-26 à l'extraction et au run, une seule garde pour toute l'application
```

- [ ] **Step 3: ADR-009**

Dans `docs/adrs/009-enchainement-sources-et-arbitrage.md` § Notes complémentaires, remplacer la puce « Tentative de quitter l'application avec des morceaux encore en cours : modale de confirmation » par :

```markdown
- Tentative de quitter l'application avec un travail en cours : modale de confirmation. Élargie le 2026-09-26 à l'extraction et au run de tagging, par une garde unique de la webview
```

- [ ] **Step 4: Reste ouvert**

Dans `.design-sync/NOTES.md` § Reste ouvert, ajouter :

```markdown
- **Confirmation de sortie (Feature 3, 2026-09-26)**, absente de la maquette, à ajouter à `AppShell` : `p-dialog` « Quitter l'application ? », une phrase par travail en cours (extraction, run, arbitrages), « Quitter quand même » outlined secondary et « Rester » primary.
```

- [ ] **Step 5: Commit**

```bash
git add docs/DESIGN.md docs/BRAINSTORM.md docs/adrs/009-enchainement-sources-et-arbitrage.md .design-sync/NOTES.md
git commit -m "docs: confirmation de sortie pour tout travail en cours"
```
