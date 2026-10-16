# Invite de mise à jour : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vérifier au lancement de l'application si une version plus récente est publiée, la proposer dans une modale, puis la télécharger et l'installer sur accord de l'utilisateur.

**Architecture:** Quatre tâches :
- le plugin updater enveloppé derrière `APP_UPDATER`, qui réduit l'objet `Update` à notre contrat et dérive la page de la Release du manifeste ;
- `UpdateService`, état en signaux : vérification unique au démarrage, report au badge, priorité à l'invite de reprise, installation refusée pendant un travail, Sentry sur un téléchargement en échec, nouvelle tentative ;
- la modale `UpdateDialogComponent`, l'icône `download` et les libellés ;
- le badge et la modale différée dans le shell, plus la documentation.

**Tech Stack:** Angular 22 (signals, `linkedSignal`, `@defer`), PrimeNG 22 (`Dialog`, `Button`, `Tag`, `Tooltip`), ngx-translate 18, `@tauri-apps/plugin-updater` 2.13.2, `@tauri-apps/plugin-opener`, `@sentry/angular`, Vitest.

**Spec:** `docs/superpowers/specs/distribution-et-mise-a-jour/02-invite-de-mise-a-jour-design.md`

## Global Constraints

- **Dépend du sub-project 01** (plugin enregistré, `plugins.updater`, `updater:default`) pour l'exécution réelle. Les specs n'en dépendent pas : le plugin est remplacé par le faux de `src/fixtures/updater.ts`.
- **Dépend de `formatBytes`** (`src/app/shared/utils/bytes.ts`, Feature 7, sub-project `administration-cache-et-logs`). Absent au démarrage de la Task 3 : s'arrêter et le signaler, ne pas le réécrire.
- **Vérification au démarrage seulement**, jamais en cours de session (`.claude/rules/tauri/config-bundle.md`).
- **Aucune adresse du dépôt en TypeScript** : la page de la Release se dérive de l'`url` du manifeste.
- **Specs** : le plugin updater n'est jamais mocké par `vi.mock`, toujours remplacé par `APP_UPDATER` (`.claude/rules/angular/tests.md`). `@tauri-apps/plugin-opener` l'est, comme dans `track-detail.component.spec.ts` ; `@sentry/angular` l'est ici pour la première fois, aucun code de la webview n'appelant `captureException` avant ce sub-project.
- **Données de test fictives** : versions `2.0.0` / `1.0.0`, URLs en `example.com` sauf celles qui exercent la forme GitHub d'une Release.
- **Libellés** : ngx-translate, deux fichiers dans le même commit, une phrase par ligne (`\n`), vouvoiement, « l'application ». Espace insécable U+00A0 littérale avant `:`, `?`, `!` en français : aucun libellé de ce plan n'en contient.
- **Commentaires TypeScript sans accents**, le pourquoi seulement.
- **Tests** : noms en anglais, AAA, aucun test de plomberie PrimeNG ni du plugin (no-lib-test).
- **Services** : `@Service()` du projet, jamais `@Injectable({ providedIn: "root" })` (`.claude/rules/angular/services.md`).
- **Docs gouvernées par un skill** : `Skill[design-doc]` avant `docs/DESIGN.md`, `Skill[architecture-doc]` avant `docs/ARCHITECTURE.md`.
- **Gate vert à chaque commit** : `just format-ui && just lint-ui && just typecheck-ui && just test-ui`. Commits `type(scope): description`, scope `ui`.
- **Numéros de ligne des docs** : relevés le 2026-10-15. Chercher le texte cité, pas la ligne.

## Review Focus

- **Serveur sans `Content-Length`** : barre indéterminée, sans compteur ni pourcentage faux (Task 1, `keeps an unknown total as null` ; Task 3, la barre ne reçoit pas de valeur quand le total est nul).
- **Clic répété sur « Réessayer »** : une seule vérification, l'état passant en téléchargement dès le clic (Task 2, `checks again and restarts the download on retry` vérifie l'état intermédiaire).
- **Release retirée entre l'échec et « Réessayer »** : l'offre disparaît au lieu de rester en échec (Task 2, `withdraws the offer when the retry finds nothing`).
- **Invite de reprise fermée après coup** : la modale ne revient pas d'elle-même, le badge reste (Task 2, `keeps the badge once the resume prompt shows up before any gesture`).
- **`url` du manifeste hors forme GitHub** : pas de lien plutôt qu'un lien faux (Task 1, `derives no release page from %s`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/platform/updater.ts` | `APP_UPDATER`, contrat `AppUpdater` / `AvailableUpdate` / `DownloadProgress`, `releasePageOf`, `progressAfter` |
| `src/fixtures/updater.ts` | `availableUpdate`, `updaterStub` |
| `src/app/core/platform/update.service.ts` | État de la mise à jour, report, installation, nouvelle tentative |
| `src/app/app.config.ts` | Vérification au démarrage |
| `src/app/shared/components/dialogs/update-dialog.component.ts` | Modale |
| `src/app/shared/components/display/icon.component.ts` | Icône `download` |
| `src/app/app.component.{ts,html}` | Badge, modale différée |
| `public/i18n/{fr,en}.json` | Bloc `update` |
| `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `.design-sync/NOTES.md` | Mapping, arbitrage, structure, reste ouvert |

---

### Task 1: Plugin updater derrière `APP_UPDATER`

**Files:**
- Create: `src/app/core/platform/updater.ts`
- Create: `src/app/core/platform/updater.spec.ts`
- Create: `src/fixtures/updater.ts`

**Interfaces:**
- Produces :
  - `interface DownloadProgress { readonly received: number; readonly total: number | null }`
  - `interface AvailableUpdate { readonly version: string; readonly currentVersion: string; readonly releasePage: string | null; downloadAndInstall(onProgress: (progress: DownloadProgress) => void): Promise<void> }`
  - `interface AppUpdater { check(): Promise<AvailableUpdate | null> }`
  - `const APP_UPDATER: InjectionToken<AppUpdater>`
  - `const releasePageOf: (manifest: Record<string, unknown>) => string | null`
  - `const progressAfter: (progress: DownloadProgress, event: DownloadEvent) => DownloadProgress`
  - fixtures `availableUpdate(overrides?: Partial<AvailableUpdate>): AvailableUpdate`, `updaterStub(result?: AvailableUpdate | null | Error)` → `{ check: Mock }`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/app/core/platform/updater.spec.ts` :

```ts
import { progressAfter, releasePageOf } from "./updater"

const manifest = (url: unknown): Record<string, unknown> => ({
  version: "2.0.0",
  platforms: { "windows-x86_64": { signature: "sig", url } },
})

describe("releasePageOf", () => {
  it("derives the release page from the installer url", () => {
    const url = "https://github.com/acme/app/releases/download/v2.0.0/app_2.0.0_x64-setup.exe"

    const page = releasePageOf(manifest(url))

    expect(page).toBe("https://github.com/acme/app/releases/tag/v2.0.0")
  })

  it.each([
    ["another host", manifest("https://example.com/app_2.0.0_x64-setup.exe")],
    ["a url that is not a string", manifest(42)],
    ["a manifest without a Windows entry", { version: "2.0.0", platforms: {} }],
  ])("derives no release page from %s", (_, raw) => {
    const page = releasePageOf(raw)

    expect(page).toBeNull()
  })
})

describe("progressAfter", () => {
  it("adds each chunk to the bytes received", () => {
    const started = progressAfter(
      { received: 0, total: null },
      { event: "Started", data: { contentLength: 10 } },
    )

    const progressed = progressAfter(started, { event: "Progress", data: { chunkLength: 4 } })

    const progress = progressAfter(progressed, { event: "Progress", data: { chunkLength: 3 } })

    expect(progress).toEqual({ received: 7, total: 10 })
  })

  it("keeps an unknown total as null", () => {
    const progress = progressAfter({ received: 0, total: null }, { event: "Started", data: {} })

    expect(progress).toEqual({ received: 0, total: null })
  })
})
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/platform/updater.spec.ts`
Expected: FAIL, module `./updater` introuvable.

- [ ] **Step 3: Écrire `updater.ts`**

```ts
import { InjectionToken } from "@angular/core"
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater"

/** Octets recus depuis le debut ; `total` est nul quand le serveur ne l'annonce pas. */
export interface DownloadProgress {
  readonly received: number
  readonly total: number | null
}

/** L'objet `Update` du plugin, reduit a ce que l'application emploie. */
export interface AvailableUpdate {
  readonly version: string
  readonly currentVersion: string
  /** `null` quand l'url du manifeste ne designe pas une Release GitHub. */
  readonly releasePage: string | null
  downloadAndInstall(onProgress: (progress: DownloadProgress) => void): Promise<void>
}

export interface AppUpdater {
  check(): Promise<AvailableUpdate | null>
}

const RELEASE_DOWNLOAD = /^(https:\/\/github\.com\/[^/]+\/[^/]+\/releases)\/download\/([^/]+)\/[^/]+$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/**
 * `.../releases/download/<tag>/<installeur>` donne `.../releases/tag/<tag>` : l'adresse du
 * depot n'est recopiee nulle part en TypeScript.
 */
export const releasePageOf = (manifest: Record<string, unknown>): string | null => {
  const platforms = manifest["platforms"]
  const windows = isRecord(platforms) ? platforms["windows-x86_64"] : undefined
  const url = isRecord(windows) ? windows["url"] : undefined
  const [, releases, tag] = (typeof url === "string" ? RELEASE_DOWNLOAD.exec(url) : null) ?? []

  return releases && tag ? `${releases}/tag/${tag}` : null
}

/** `chunkLength` est un delta : le cumul est a notre charge. */
export const progressAfter = (progress: DownloadProgress, event: DownloadEvent): DownloadProgress => {
  switch (event.event) {
    case "Started":
      return { received: 0, total: event.data.contentLength ?? null }
    case "Progress":
      return { ...progress, received: progress.received + event.data.chunkLength }
    case "Finished":
      return progress
  }
}

class TauriAppUpdater implements AppUpdater {
  // Hors Tauri, `check` leve faute de `window.__TAURI_INTERNALS__` : l'appelant le traite
  // comme une verification en echec.
  async check(): Promise<AvailableUpdate | null> {
    const update = await check()
    if (update === null) {
      return null
    }

    return {
      version: update.version,
      currentVersion: update.currentVersion,
      releasePage: releasePageOf(update.rawJson),
      downloadAndInstall: async (onProgress) => {
        let progress: DownloadProgress = { received: 0, total: null }
        // Sous Windows, l'application sort a l'installation : rien n'est attendu apres.
        await update.downloadAndInstall((event) => {
          progress = progressAfter(progress, event)
          onProgress(progress)
        })
      },
    }
  }
}

export const APP_UPDATER = new InjectionToken<AppUpdater>("AppUpdater", {
  providedIn: "root",
  factory: () => new TauriAppUpdater(),
})
```

- [ ] **Step 4: Écrire le faux partagé**

`src/fixtures/updater.ts` :

```ts
import { vi } from "vitest"

import type { AppUpdater, AvailableUpdate } from "../app/core/platform/updater"

/** Mise a jour proposee ; le telechargement aboutit sauf surcharge. */
export const availableUpdate = (overrides: Partial<AvailableUpdate> = {}): AvailableUpdate => ({
  version: "2.0.0",
  currentVersion: "1.0.0",
  releasePage: "https://example.com/releases/tag/v2.0.0",
  downloadAndInstall: vi.fn<AvailableUpdate["downloadAndInstall"]>(() => Promise.resolve()),
  ...overrides,
})

/** Faux `APP_UPDATER` : une `Error` fait echouer la verification. */
export const updaterStub = (result: AvailableUpdate | null | Error = null) => ({
  check: vi.fn<AppUpdater["check"]>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  ),
})
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/core/platform/updater.spec.ts`
Expected: `6 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/platform/updater.ts src/app/core/platform/updater.spec.ts src/fixtures/updater.ts
git commit -m "feat(ui): plugin updater derriere APP_UPDATER"
```

---

### Task 2: `UpdateService` et vérification au démarrage

**Files:**
- Create: `src/app/core/platform/update.service.ts`
- Create: `src/app/core/platform/update.service.spec.ts`
- Modify: `src/app/app.config.ts` (initialiseur après celui de `CompletionSignalService`)

**Interfaces:**
- Consumes : `APP_UPDATER`, `AvailableUpdate`, `DownloadProgress` (Task 1) ; `SidecarService.phase(): SidecarPhase`, `SidecarService.interruptedRun(): DetectedRun | null` (`core/stores/resume.store.ts`).
- Produces :
  - `type UpdateState = { kind: "none" } | { kind: "available"; update } | { kind: "downloading"; update; progress: DownloadProgress } | { kind: "failed"; update }`
  - `UpdateService` : `state: Signal<UpdateState>`, `update: Signal<AvailableUpdate | null>`, `installable: Signal<boolean>`, `dialogVisible: Signal<boolean>`, `badgeVisible: Signal<boolean>`, `check(): Promise<void>`, `dismiss(): void`, `reopen(): void`, `install(): Promise<void>`, `retry(): Promise<void>`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/app/core/platform/update.service.spec.ts` :

```ts
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import * as Sentry from "@sentry/angular"

import { INTERRUPTED } from "../../../fixtures/resume"
import { sidecarStub, type SidecarStubOverrides } from "../../../fixtures/sidecar-stub"
import { availableUpdate, updaterStub } from "../../../fixtures/updater"
import { SidecarService } from "../sidecar/sidecar.service"
import type { DetectedRun } from "../stores/resume.store"

import { UpdateService } from "./update.service"
import { APP_UPDATER, type AvailableUpdate } from "./updater"

vi.mock("@sentry/angular", () => ({ captureException: vi.fn() }))

const mount = (
  updater: ReturnType<typeof updaterStub>,
  overrides: SidecarStubOverrides = {},
) => {
  const sidecar = sidecarStub(overrides)
  TestBed.configureTestingModule({
    providers: [
      { provide: APP_UPDATER, useValue: updater },
      { provide: SidecarService, useValue: sidecar },
    ],
  })

  return { service: TestBed.inject(UpdateService), sidecar, updater }
}

const failing = (): AvailableUpdate =>
  availableUpdate({ downloadAndInstall: vi.fn(() => Promise.reject(new Error("signature"))) })

describe("UpdateService", () => {
  beforeEach(() => vi.mocked(Sentry.captureException).mockClear())

  it("offers nothing when no update is published", async () => {
    const { service } = mount(updaterStub(null))

    await service.check()

    expect(service.update()).toBeNull()
    expect(service.dialogVisible()).toBe(false)
    expect(service.badgeVisible()).toBe(false)
  })

  it("stays silent and reports nothing when the check fails", async () => {
    const { service } = mount(updaterStub(new Error("offline")))

    await service.check()

    expect(service.update()).toBeNull()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it("opens the dialog on the update found at startup", async () => {
    const { service } = mount(updaterStub(availableUpdate()))

    await service.check()

    expect(service.update()?.version).toBe("2.0.0")
    expect(service.dialogVisible()).toBe(true)
  })

  it("sends the update straight to the badge while the resume prompt shows", async () => {
    const { service } = mount(updaterStub(availableUpdate()), {
      interruptedRun: signal<DetectedRun | null>(INTERRUPTED),
    })

    await service.check()

    expect(service.dialogVisible()).toBe(false)
    expect(service.badgeVisible()).toBe(true)
  })

  it("sends an update found during a run straight to the badge", async () => {
    const { service } = mount(updaterStub(availableUpdate()), { tagging: signal(true) })

    await service.check()

    expect(service.badgeVisible()).toBe(true)
  })

  it("keeps the badge once the resume prompt shows up before any gesture", async () => {
    const { service, sidecar } = mount(updaterStub(availableUpdate()))
    await service.check()
    // Lu a chaque changement, comme le gabarit du shell a chaque detection : c'est ce qui
    // donne a `previous` chaque etat traverse.
    const beforeResume = service.dialogVisible()
    sidecar.interruptedRun.set(INTERRUPTED)
    const whileResumeShows = service.dialogVisible()

    sidecar.interruptedRun.set(null)

    expect(beforeResume).toBe(true)
    expect(whileResumeShows).toBe(false)
    expect(service.dialogVisible()).toBe(false)
    expect(service.badgeVisible()).toBe(true)
  })

  it("reopens the dialog from the badge", async () => {
    const { service } = mount(updaterStub(availableUpdate()))
    await service.check()
    service.dismiss()

    service.reopen()

    expect(service.dialogVisible()).toBe(true)
    expect(service.badgeVisible()).toBe(false)
  })

  it("refuses to install while the engine is busy", async () => {
    const update = availableUpdate()
    const { service } = mount(updaterStub(update), { tagging: signal(true) })
    await service.check()

    await service.install()

    expect(service.installable()).toBe(false)
    expect(update.downloadAndInstall).not.toHaveBeenCalled()
  })

  it("follows the download progress", async () => {
    const update = availableUpdate({
      downloadAndInstall: vi.fn<AvailableUpdate["downloadAndInstall"]>((onProgress) => {
        onProgress({ received: 4, total: 10 })
        return new Promise<void>(() => undefined)
      }),
    })
    const { service } = mount(updaterStub(update))
    await service.check()

    void service.install()

    expect(service.state()).toEqual({ kind: "downloading", update, progress: { received: 4, total: 10 } })
  })

  it("reports a failed download to Sentry and offers a retry", async () => {
    const { service } = mount(updaterStub(failing()))
    await service.check()

    await service.install()

    expect(service.state().kind).toBe("failed")
    expect(Sentry.captureException).toHaveBeenCalledOnce()
  })

  it("checks again and restarts the download on retry", async () => {
    const retried = availableUpdate()
    const updater = updaterStub(failing())
    const { service } = mount(updater)
    await service.check()
    await service.install()
    updater.check.mockResolvedValueOnce(retried)

    const pending = service.retry()
    const during = service.state().kind
    await pending

    expect(during).toBe("downloading")
    expect(updater.check).toHaveBeenCalledTimes(2)
    expect(retried.downloadAndInstall).toHaveBeenCalledOnce()
  })

  it("withdraws the offer when the retry finds nothing", async () => {
    const updater = updaterStub(failing())
    const { service } = mount(updater)
    await service.check()
    await service.install()
    updater.check.mockResolvedValueOnce(null)

    await service.retry()

    expect(service.update()).toBeNull()
  })
})
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/platform/update.service.spec.ts`
Expected: FAIL, module `./update.service` introuvable.

- [ ] **Step 3: Écrire `update.service.ts`**

```ts
import { Service, computed, inject, linkedSignal, signal } from "@angular/core"
import * as Sentry from "@sentry/angular"

import { SidecarService } from "../sidecar/sidecar.service"

import { APP_UPDATER, type AvailableUpdate, type DownloadProgress } from "./updater"

export type UpdateState =
  | { readonly kind: "none" }
  | { readonly kind: "available"; readonly update: AvailableUpdate }
  | {
      readonly kind: "downloading"
      readonly update: AvailableUpdate
      readonly progress: DownloadProgress
    }
  | { readonly kind: "failed"; readonly update: AvailableUpdate }

const NOTHING_RECEIVED: DownloadProgress = { received: 0, total: null }

/**
 * Mise a jour proposee au demarrage seulement : l'installation ferme l'application, elle ne
 * se propose jamais en cours de session (ADR-001, rule tauri/config-bundle).
 */
@Service()
export class UpdateService {
  private readonly updater = inject(APP_UPDATER)
  private readonly sidecar = inject(SidecarService)

  private readonly _state = signal<UpdateState>({ kind: "none" })
  readonly state = this._state.asReadonly()

  readonly update = computed(() => {
    const state = this._state()

    return state.kind === "none" ? null : state.update
  })

  /** L'installation ferme l'application : jamais pendant un travail du moteur. */
  readonly installable = computed(() => this.sidecar.phase() === "idle")

  /**
   * La modale ne s'ouvre d'elle-meme que sur un ecran libre : une invite de reprise affichee
   * ou un travail en cours renvoient la mise a jour au badge et l'y laissent ensuite. Seul
   * le badge rouvre la modale. Le shell lit ce signal a chaque detection, ce qui donne a
   * `previous` chaque etat traverse.
   */
  private readonly dismissed = linkedSignal<boolean, boolean>({
    source: () => this.sidecar.interruptedRun() !== null || this.sidecar.phase() !== "idle",
    computation: (occupied, previous) => occupied || (previous?.value ?? false),
  })

  readonly dialogVisible = computed(() => this.update() !== null && !this.dismissed())
  readonly badgeVisible = computed(() => this.update() !== null && this.dismissed())

  async check(): Promise<void> {
    try {
      const update = await this.updater.check()
      if (update !== null) {
        this._state.set({ kind: "available", update })
      }
    } catch {
      // Hors ligne, manifeste en 404 pendant un build, ou hors Tauri : rien a proposer,
      // et rien a signaler, ces cas sont frequents.
    }
  }

  dismiss(): void {
    this.dismissed.set(true)
  }

  reopen(): void {
    this.dismissed.set(false)
  }

  async install(): Promise<void> {
    const state = this._state()
    if (state.kind === "available" && this.installable()) {
      await this.download(state.update)
    }
  }

  /** Une mise a jour en echec n'est pas reutilisee : la verification repart de zero. */
  async retry(): Promise<void> {
    const state = this._state()
    if (state.kind !== "failed" || !this.installable()) {
      return
    }

    // Passe en telechargement des le clic : un second clic ne relance rien.
    this._state.set({ kind: "downloading", update: state.update, progress: NOTHING_RECEIVED })
    let update: AvailableUpdate | null
    try {
      update = await this.updater.check()
    } catch {
      this._state.set(state)
      return
    }

    if (update === null) {
      this._state.set({ kind: "none" })
      return
    }
    await this.download(update)
  }

  private async download(update: AvailableUpdate): Promise<void> {
    this._state.set({ kind: "downloading", update, progress: NOTHING_RECEIVED })
    try {
      await update.downloadAndInstall((progress) => {
        this._state.set({ kind: "downloading", update, progress })
      })
    } catch (error) {
      // Seul signal d'une chaine de signature cassee chez un utilisateur (PRODUCTION.md
      // § Incident Response) ; le SDK durci retire les chemins (ADR-014).
      Sentry.captureException(error)
      this._state.set({ kind: "failed", update })
    }
  }
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/core/platform/update.service.spec.ts`
Expected: `12 passed` (les tests existants de `updater.spec.ts` ne sont pas inclus par cette commande).

- [ ] **Step 5: Lancer la vérification au démarrage**

Dans `src/app/app.config.ts`, importer `UpdateService` depuis `./core/platform/update.service`, puis ajouter après l'initialiseur de `CompletionSignalService` :

```ts
    // Une seule verification, sans attendre : `check()` ne leve jamais et l'installation
    // fermant l'application, elle ne se propose jamais en cours de session.
    provideAppInitializer(() => {
      void inject(UpdateService).check()
    }),
```

- [ ] **Step 6: Gate**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: vert.

- [ ] **Step 7: Commit**

```bash
git add src/app/core/platform/update.service.ts src/app/core/platform/update.service.spec.ts src/app/app.config.ts
git commit -m "feat(ui): mise a jour verifiee au demarrage, reportee pendant un travail"
```

---

### Task 3: Modale de mise à jour, icône et libellés

**Files:**
- Create: `src/app/shared/components/dialogs/update-dialog.component.ts`
- Create: `src/app/shared/components/dialogs/update-dialog.component.spec.ts`
- Modify: `src/app/shared/components/display/icon.component.ts` (icône `download`)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (bloc `update` après `resume`)

**Interfaces:**
- Consumes : `UpdateService` (Task 2) ; `availableUpdate`, `updaterStub` (Task 1) ; `formatBytes(bytes: number, language: string): string` ; `PhaseProgressComponent` (`label`, `counter`, `value`) ; `MessageComponent` (`severity`) ; `TOOLTIP` (`shared/utils/tooltip.ts`).
- Produces : composant `app-update-dialog`, sans input ; nom d'icône `download` ; clés `update.*` dont `update.badge` (`{{version}}`) et `update.reopen`, lues par la Task 4.

- [ ] **Step 1: Ajouter l'icône `download`**

Dans `src/app/shared/components/display/icon.component.ts`, les quatre gestes du commentaire d'en-tête :
- `import { Download } from "@primeicons/angular/download"` parmi les imports d'icônes, dans l'ordre alphabétique ;
- `"download",` dans `ICON_NAMES` ;
- `Download,` dans `imports` du `@Component` ;
- dans le `@switch` :

```html
      @case ("download") {
        <svg data-p-icon="download" [size]="size()" />
      }
```

Run: `pnpm exec ng test --watch=false --include=src/app/shared/components/display/icon.component.spec.ts`
Expected: vert, le cas `download` compris.

- [ ] **Step 2: Ajouter les libellés**

`public/i18n/fr.json`, après le bloc `resume` (virgule après sa `}` fermante) :

```json
  "update": {
    "title": "Mise à jour disponible",
    "available": "La version {{version}} est disponible, vous utilisez la {{current}}.\nL'application se ferme le temps de l'installation.",
    "notes": "Voir les nouveautés",
    "later": "Plus tard",
    "install": "Installer",
    "retry": "Réessayer",
    "busy": "Disponible à la fin du travail en cours",
    "downloading": "Téléchargement",
    "counter": "{{received}} sur {{total}}",
    "closing": "L'application se fermera à la fin du téléchargement.",
    "failed": "La mise à jour a échoué.\nVérifiez votre connexion, puis réessayez.",
    "badge": "Mise à jour {{version}}",
    "reopen": "Voir la mise à jour"
  }
```

`public/i18n/en.json`, même place :

```json
  "update": {
    "title": "Update available",
    "available": "Version {{version}} is available, you are using {{current}}.\nThe application closes during the installation.",
    "notes": "See what's new",
    "later": "Later",
    "install": "Install",
    "retry": "Retry",
    "busy": "Available once the current work is done",
    "downloading": "Downloading",
    "counter": "{{received}} of {{total}}",
    "closing": "The application will close once the download is done.",
    "failed": "The update failed.\nCheck your connection, then try again.",
    "badge": "Update {{version}}",
    "reopen": "See the update"
  }
```

- [ ] **Step 3: Écrire les tests qui échouent**

`src/app/shared/components/dialogs/update-dialog.component.spec.ts` :

```ts
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { openUrl } from "@tauri-apps/plugin-opener"

import { action, page } from "../../../../fixtures/dialog"
import { sidecarStub, type SidecarStubOverrides } from "../../../../fixtures/sidecar-stub"
import { translateWith } from "../../../../fixtures/translate"
import { availableUpdate, updaterStub } from "../../../../fixtures/updater"
import { UpdateService } from "../../../core/platform/update.service"
import { APP_UPDATER, type AvailableUpdate } from "../../../core/platform/updater"
import { SidecarService } from "../../../core/sidecar/sidecar.service"

import { UpdateDialogComponent } from "./update-dialog.component"

vi.mock("@sentry/angular", () => ({ captureException: vi.fn() }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }))

const mount = async (update: AvailableUpdate = availableUpdate(), overrides: SidecarStubOverrides = {}) => {
  TestBed.configureTestingModule({
    imports: [UpdateDialogComponent],
    providers: [
      provideTranslateService(),
      { provide: APP_UPDATER, useValue: updaterStub(update) },
      { provide: SidecarService, useValue: sidecarStub(overrides) },
    ],
  })
  const service = TestBed.inject(UpdateService)
  await service.check()
  const fixture = TestBed.createComponent(UpdateDialogComponent)
  fixture.detectChanges()

  return { fixture, service }
}

const cross = (): HTMLButtonElement | null =>
  page().querySelector<HTMLButtonElement>('[aria-label="update.later"]')

const neverEnding = (): AvailableUpdate =>
  availableUpdate({
    downloadAndInstall: vi.fn<AvailableUpdate["downloadAndInstall"]>((onProgress) => {
      onProgress({ received: 4_000_000, total: 10_000_000 })
      return new Promise<void>(() => undefined)
    }),
  })

describe("UpdateDialogComponent", () => {
  it("shows both versions with later and install", async () => {
    const { fixture } = await mount()
    translateWith({ update: { available: "{{version}} over {{current}}" } })
    fixture.detectChanges()

    const text = page().textContent

    expect(text).toContain("2.0.0 over 1.0.0")
    expect(action("later")).not.toBeNull()
    expect(action("install")).not.toBeNull()
  })

  it("sends the update to the badge on later", async () => {
    const { service } = await mount()

    action("later")?.click()

    expect(service.badgeVisible()).toBe(true)
  })

  it("sends the update to the badge on the cross", async () => {
    const { service } = await mount()

    cross()?.click()

    expect(service.badgeVisible()).toBe(true)
  })

  it("disables install while the engine is busy", async () => {
    // Trouvee pendant un travail, la mise a jour part au badge : la modale est rouverte par lui.
    const { fixture, service } = await mount(availableUpdate(), { writing: signal(true) })
    service.reopen()
    fixture.detectChanges()

    const install = action("install")

    expect(install?.disabled).toBe(true)
  })

  it("replaces the body with the progress while downloading", async () => {
    const { fixture } = await mount(neverEnding())
    action("install")?.click()
    fixture.detectChanges()

    const progress = page().querySelector("app-phase-progress")

    expect(progress).not.toBeNull()
    expect(action("install")).toBeNull()
    expect(action("later")).toBeNull()
    expect(cross()).toBeNull()
  })

  it("shows the failure with a retry", async () => {
    const { fixture, service } = await mount(
      availableUpdate({ downloadAndInstall: vi.fn(() => Promise.reject(new Error("signature"))) }),
    )
    action("install")?.click()
    await vi.waitFor(() => {
      expect(service.state().kind).toBe("failed")
    })
    fixture.detectChanges()

    const text = page().textContent

    expect(text).toContain("update.failed")
    expect(action("install")?.textContent).toContain("update.retry")
  })

  it("opens the release page from the notes link", async () => {
    await mount()

    action("notes")?.click()

    expect(openUrl).toHaveBeenCalledWith("https://example.com/releases/tag/v2.0.0")
  })

  it("hides the notes link without a release page", async () => {
    await mount(availableUpdate({ releasePage: null }))

    const notes = action("notes")

    expect(notes).toBeNull()
  })
})
```

- [ ] **Step 4: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/shared/components/dialogs/update-dialog.component.spec.ts`
Expected: FAIL, module `./update-dialog.component` introuvable.

- [ ] **Step 5: Écrire le composant**

Vérifier d'abord que `src/app/shared/utils/bytes.ts` exporte `formatBytes` (cf. Global Constraints).

`src/app/shared/components/dialogs/update-dialog.component.ts` :

```ts
import { Component, computed, inject } from "@angular/core"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ButtonDirective } from "primeng/button"
import { Dialog } from "primeng/dialog"
import { Tooltip } from "primeng/tooltip"

import { languageFromTag } from "../../../core/i18n/language"
import { UpdateService } from "../../../core/platform/update.service"
import { formatBytes } from "../../utils/bytes"
import { TOOLTIP } from "../../utils/tooltip"
import { IconComponent } from "../display/icon.component"
import { PhaseProgressComponent } from "../display/phase-progress.component"
import { MessageComponent } from "../feedback/message.component"

/**
 * Gabarit de l'invite de reprise, mais fermable : la croix et « Plus tard » renvoient au badge
 * (DESIGN.md § Arbitrages). Non fermable pendant le telechargement, l'installation suivant
 * sans autre geste.
 */
@Component({
  selector: "app-update-dialog",
  imports: [
    Dialog,
    ButtonDirective,
    Tooltip,
    TranslatePipe,
    IconComponent,
    PhaseProgressComponent,
    MessageComponent,
  ],
  template: `
    @if (update(); as offered) {
      <!-- Largeur de l'invite de reprise (DESIGN.md § Structure de Page). -->
      <p-dialog
        [visible]="visible()"
        (visibleChange)="onVisibleChange($event)"
        [modal]="true"
        [closable]="!downloading()"
        [closeOnEscape]="!downloading()"
        [draggable]="false"
        [resizable]="false"
        [focusOnShow]="false"
        styleClass="w-120"
        [closeAriaLabel]="'update.later' | translate"
      >
        <ng-template #header>
          <h3 class="m-0 text-lg font-semibold">{{ "update.title" | translate }}</h3>
        </ng-template>

        @switch (state().kind) {
          @case ("downloading") {
            <div class="flex flex-col gap-4 pb-2">
              <app-phase-progress
                [label]="'update.downloading' | translate"
                [counter]="counter()"
                [value]="percent()"
              />
              <p class="m-0 text-sm text-muted-color">{{ "update.closing" | translate }}</p>
            </div>
          }
          @case ("failed") {
            <app-message severity="error">{{ "update.failed" | translate }}</app-message>
          }
          @default {
            <div class="flex flex-col gap-2 text-sm whitespace-pre-line text-muted-color">
              <p class="m-0">
                {{
                  "update.available"
                    | translate: { version: offered.version, current: offered.currentVersion }
                }}
              </p>
              @if (offered.releasePage; as releasePage) {
                <button
                  pButton
                  type="button"
                  [link]="true"
                  class="self-start border-0 p-0 text-xs"
                  data-action="notes"
                  (click)="openNotes(releasePage)"
                >
                  {{ "update.notes" | translate }}
                  <app-icon name="external-link" [size]="16" />
                </button>
              }
            </div>
          }
        }

        <ng-template #footer>
          @if (!downloading()) {
            <button
              pButton
              type="button"
              size="small"
              [text]="true"
              severity="secondary"
              data-action="later"
              (click)="later()"
            >
              {{ "update.later" | translate }}
            </button>
            <button
              pButton
              type="button"
              size="small"
              data-action="install"
              [disabled]="!installable()"
              [pTooltip]="installable() ? undefined : ('update.busy' | translate)"
              [tooltipOptions]="tooltip"
              (click)="failed() ? retry() : install()"
            >
              {{ (failed() ? "update.retry" : "update.install") | translate }}
            </button>
          }
        </ng-template>
      </p-dialog>
    }
  `,
})
export class UpdateDialogComponent {
  private readonly service = inject(UpdateService)
  private readonly translate = inject(TranslateService)

  protected readonly state = this.service.state
  protected readonly update = this.service.update
  protected readonly visible = this.service.dialogVisible
  protected readonly installable = this.service.installable
  protected readonly tooltip = TOOLTIP

  protected readonly downloading = computed(() => this.state().kind === "downloading")
  protected readonly failed = computed(() => this.state().kind === "failed")

  private readonly progress = computed(() => {
    const state = this.state()

    return state.kind === "downloading" ? state.progress : null
  })

  /** Absent tant que le total n'est pas connu : la barre tourne alors en continu. */
  protected readonly percent = computed(() => {
    const progress = this.progress()

    return progress?.total ? Math.round((progress.received / progress.total) * 100) : undefined
  })

  protected readonly counter = computed(() => {
    const progress = this.progress()
    if (!progress?.total) {
      return undefined
    }
    const language = languageFromTag(this.translate.currentLang())

    return this.translate.instant("update.counter", {
      received: formatBytes(progress.received, language),
      total: formatBytes(progress.total, language),
    }) as string
  })

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.service.dismiss()
    }
  }

  protected later(): void {
    this.service.dismiss()
  }

  protected install(): void {
    void this.service.install()
  }

  protected retry(): void {
    void this.service.retry()
  }

  protected openNotes(releasePage: string): void {
    openUrl(releasePage).catch((error: unknown) => {
      console.error("[update-dialog] page de la Release non ouverte", error)
    })
  }
}
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/shared/components/dialogs/update-dialog.component.spec.ts --include=src/app/core/i18n/translations.spec.ts`
Expected: `8 passed` pour la modale, cohérence i18n verte.

- [ ] **Step 7: Gate**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: vert.

- [ ] **Step 8: Commit**

```bash
git add src/app/shared/components/dialogs/update-dialog.component.ts src/app/shared/components/dialogs/update-dialog.component.spec.ts src/app/shared/components/display/icon.component.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): modale de mise a jour, telechargement et nouvelle tentative"
```

---

### Task 4: Badge et modale dans le shell, documentation

**Files:**
- Modify: `src/app/app.component.ts`, `src/app/app.component.html`, `src/app/app.component.spec.ts`
- Modify: `docs/DESIGN.md` (ligne « Badges de file et de rattrapage » du mapping l.198, nouvelle ligne après « Reprise d'un run interrompu » l.292, fin des Arbitrages l.566)
- Modify: `docs/ARCHITECTURE.md` (rôle de `core/platform/` l.409)
- Modify: `.design-sync/NOTES.md` (§ Reste ouvert)

**Interfaces:**
- Consumes : `UpdateService.update`, `.badgeVisible`, `.dialogVisible`, `.reopen()` (Task 2) ; `UpdateDialogComponent` (Task 3) ; `availableUpdate`, `updaterStub` (Task 1) ; clés `update.badge`, `update.reopen`.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/app/app.component.spec.ts` :
- importer `availableUpdate`, `updaterStub` depuis `../fixtures/updater`, `APP_UPDATER` et `type AvailableUpdate` depuis `./core/platform/updater`, `UpdateService` depuis `./core/platform/update.service` ;
- `mount` prend `update: AvailableUpdate | null = null` et ajoute `{ provide: APP_UPDATER, useValue: updaterStub(update) }` aux providers ;
- ajouter :

```ts
const updateBadge = (fixture: { nativeElement: unknown }): HTMLButtonElement | null =>
  hostOf(fixture).querySelector<HTMLButtonElement>("[data-update-badge]")
```

et dans le `describe` :

```ts
  it("shows the update badge after later and reopens the dialog on click", async () => {
    const { fixture, component } = mount(availableUpdate())
    const updates = TestBed.inject(UpdateService)
    await updates.check()
    updates.dismiss()
    fixture.detectChanges()

    updateBadge(fixture)?.click()

    expect(component["updateDialogVisible"]()).toBe(true)
  })

  it("shows no update badge without an update", () => {
    const { fixture } = mount()

    const badge = updateBadge(fixture)

    expect(badge).toBeNull()
  })
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/app.component.spec.ts`
Expected: FAIL sur le premier test (aucun `[data-update-badge]`, `updateDialogVisible` absent).

- [ ] **Step 3: Brancher le service dans le shell**

`src/app/app.component.ts` :
- importer `UpdateService` depuis `./core/platform/update.service` et `UpdateDialogComponent` depuis `./shared/components/dialogs/update-dialog.component`, ajouter `UpdateDialogComponent` aux `imports` du `@Component` ;
- dans la classe, après `recovery` :

```ts
  private readonly updates = inject(UpdateService)
```

- après `closeRequested` :

```ts
  protected readonly update = this.updates.update
  protected readonly updateBadgeVisible = this.updates.badgeVisible
  protected readonly updateDialogVisible = this.updates.dialogVisible
```

- en fin de classe :

```ts
  protected reopenUpdate(): void {
    this.updates.reopen()
  }
```

`src/app/app.component.html` :
- dans le groupe `ml-auto flex items-center gap-2`, après le badge du rattrapage :

```html
        @if (updateBadgeVisible()) {
          <button
            type="button"
            class="cursor-pointer"
            data-update-badge
            [attr.aria-label]="'update.reopen' | translate"
            (click)="reopenUpdate()"
          >
            <p-tag severity="info">
              <app-icon name="download" [size]="16" />
              {{ "update.badge" | translate: { version: update()?.version } }}
            </p-tag>
          </button>
        }
```

- après le `@defer` de `app-resume-dialog`, dans la branche non bloquée :

```html
  <!-- Differee : la plupart des lancements n'ont aucune mise a jour. Dans la branche non
       bloquee : un moteur absent ou en conflit de version n'a rien a proposer. -->
  @defer (when updateDialogVisible(); prefetch on idle(5s)) {
    <app-update-dialog />
  }
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/app.component.spec.ts`
Expected: vert, tests existants compris.

- [ ] **Step 5: Documenter**

`docs/DESIGN.md` :
- ligne « Badges de file et de rattrapage » du mapping, remplacer par :
  ```
  | Badges de file, de rattrapage et de mise à jour | bouton portant un `p-tag` `info`, icône `info-circle` (`download` pour la mise à jour) | PrimeNG | À droite de la barre d'onglets, groupés en `gap-2`, masqués sur 0. « N à arbitrer » rouvre la modale d'arbitrage après la croix. « N à rattraper », masqué aussi pendant la recherche, ouvre Tagging et la modale du lien. « Mise à jour X.Y.Z », après la croix ou « Plus tard » de sa modale, la rouvre jusqu'au lancement suivant |
  ```
- après la ligne « Reprise d'un run interrompu » :
  ```
  | Invite de mise à jour | `UpdateDialogComponent` : `p-dialog` modal `w-120`, fermable sauf pendant le téléchargement | composant maison (PrimeNG) | Au démarrage seulement, différée comme les autres modales. L'invite de reprise passe d'abord : affichée, elle renvoie la mise à jour au badge. Versions proposée et installée, « Voir les nouveautés » en bouton `link` vers la Release. « Plus tard » en texte `secondary`, « Installer » `primary`, désactivé pendant un travail du moteur (tooltip). Téléchargement par `PhaseProgressComponent`, indéterminé sans total ; échec par `MessageComponent` error et « Réessayer » |
  ```
- en fin de § Arbitrages :
  ```markdown
  - **Invite de mise à jour** : modale au démarrage sur le gabarit de l'invite de reprise, mais fermable, avec « Voir les nouveautés » en bouton `link` vers la Release ; après la croix ou « Plus tard », badge « Mise à jour X.Y.Z » (`download`) dans le groupe des badges. Absentes de la maquette. Décidé le 2026-10-15
  ```

`docs/ARCHITECTURE.md`, ligne `core/platform/` : `| `core/platform/` | Fenêtre et garde de fermeture, signal sonore de fin, thème PrimeNG, préférences persistées, onglets, mise à jour de l'application |`

`.design-sync/NOTES.md`, § Reste ouvert :
```markdown
- **`AppShell`** : invite de mise à jour (modale, téléchargement, échec) et badge « Mise à jour X.Y.Z » (`download`) livrés par le code, absents de la maquette (cf. DESIGN.md § Arbitrages, constaté le 2026-10-15).
```

- [ ] **Step 6: Gate**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: vert.

- [ ] **Step 7: Vérification visuelle**

Sous `ng serve` (skill `dev-server`, `just dev-ui`), le plugin lève hors Tauri : aucune modale ni badge (scénario 2). L'état livré avec une version disponible se constate par les specs. La chaîne réelle se joue au sub-project 04.

- [ ] **Step 8: Commit**

```bash
git add src/app/app.component.ts src/app/app.component.html src/app/app.component.spec.ts docs/DESIGN.md docs/ARCHITECTURE.md .design-sync/NOTES.md
git commit -m "feat(ui): badge et invite de mise a jour dans le shell"
```
