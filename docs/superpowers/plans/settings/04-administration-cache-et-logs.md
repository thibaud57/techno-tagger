# Cache et logs : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vider le cache disque et ouvrir le dossier des logs depuis les Réglages.

**Architecture:** Trois tâches :
- deux briques partagées : `formatBytes` (taille lisible, base décimale) et l'icône `trash` d'`IconComponent` ;
- la rangée Cache de la section Administration : taille demandée au montage, vidage grisé sur l'état connu de l'interface (le sidecar restant l'arbitre), toast sur un nouveau `cacheCleared`, erreur sous la rangée ;
- la rangée Logs : `revealItemInDir` sur `logFile`, sans permission Tauri de plus, et les docs.

Aucun changement côté sidecar ni dans la capability.

**Tech Stack:** Angular 22 (signals), PrimeNG 22 (`Button`, `Tooltip`, `MessageService`), ngx-translate 18, `@tauri-apps/plugin-opener`, `Intl.NumberFormat`, Vitest.

**Spec:** `docs/superpowers/specs/settings/04-administration-cache-et-logs-design.md`

## Global Constraints

- **Dépend des sub-projects 01 et 02, implémentés avant** :
  - 01 : `SidecarService.cacheSize: Signal<number | null>`, `cacheCleared: Signal<CacheClearedEvent | null>`, `logFile: Signal<string | null>`, `loadCacheSize()`, `clearCache()`, `CacheClearedEvent` (`freed_bytes`, `size_bytes`), commande `clear_cache` dans `SidecarCommand`, `errors.run_not_written` ;
  - 02 : section `admin` du menu latéral, `mountWith(overrides, section)`, `vi.mock("@tauri-apps/plugin-store")` dans `settings-page.component.spec.ts`, `languageFromTag` importé dans le composant.
- **Vidage grisé** sur l'état connu de l'interface : phase longue, puis run affiché non confirmé ou confirmé avec des échecs d'écriture, un run perdu avec le moteur (`runLost`) excepté. Le sidecar reste l'arbitre.
- **Ordre de la section Administration** : Cache, Logs, Restauration, Runs passés.
- **Aucune constante du sidecar recopiée** : ni TTL, ni plafond, ni rotation, ni nom du fichier de logs. Le chemin vient de `logFile`.
- **Capability inchangée** : `opener:allow-reveal-item-in-dir` est déjà accordé et sans scope.
- **Libellés** : ngx-translate, deux fichiers dans le même commit, une phrase par ligne, espace insécable avant `:` en français, « dossier des logs » comme dans `errors.unknown_error`.
- **Commentaires TypeScript sans accents**, le pourquoi seulement.
- **Tests** : noms en anglais, AAA, aucun test de plomberie PrimeNG ni d'`Intl` (no-lib-test : on teste le choix d'unité, pas le formatage d'ICU).
- **Gate vert à chaque commit** : `just format-ui && just lint-ui && just typecheck-ui && just test-ui`. Commits `type(scope): description`, scope `settings`.
- **Numéros de ligne des docs** : relevés le 2026-10-14, avant les sub-projects 01 à 03 qui éditent les mêmes fichiers. Chercher le texte cité, pas la ligne.

## Review Focus

- **Retour sur l'onglet après un vidage** : le toast ne repart pas (Task 2, `announces nothing for a clearing already known when the page opens`).
- **Vidage partiel, fichier tenu par un autre programme** : le toast dit aussi ce qui reste (Task 2, `announces what is left after a partial clearing`).
- **Moteur relancé avec un run perdu à l'écran, échecs d'écriture compris** : le vidage n'est pas grisé (Task 2, cas `a run lost with the engine` de `blocks the clearing according to %s`).
- **Fichier de logs effacé à la main** : un message dit de relancer l'application (Task 3, `tells to restart when the log file cannot be revealed`).
- **Version pas encore reçue** : le bouton des logs est grisé (Task 3, `disables the logs button until the engine names its log file`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/shared/utils/bytes.ts` | `formatBytes` |
| `src/app/shared/components/display/icon.component.ts` | Icône `trash` |
| `src/app/core/platform/completion-signal.service.ts` | `TOAST_LIFE`, durée partagée des toasts |
| `src/app/core/sidecar/sidecar.service.ts`, `src/fixtures/sidecar-stub.ts` | `runLost`, run perdu avec le moteur |
| `src/app/features/settings/settings-page.component.{ts,html}` | Rangées Cache et Logs |
| `src/app/features/settings/settings-page.component.spec.ts` | Cache et logs |
| `public/i18n/{fr,en}.json` | `settings.admin.cache.*`, `settings.admin.logs.*` |
| `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCTION.md` | Mapping, `opener`, logs |

---

### Task 1: Taille lisible et icône `trash`

**Files:**
- Create: `src/app/shared/utils/bytes.ts`
- Create: `src/app/shared/utils/bytes.spec.ts`
- Modify: `src/app/shared/components/display/icon.component.ts`

**Interfaces:**
- Produces :
  - `formatBytes(bytes: number, language: string): string` ;
  - `IconName` étendu de `"trash"` (`ICON_NAMES`).

- [ ] **Step 1: Écrire les tests**

Créer `src/app/shared/utils/bytes.spec.ts` :

```typescript
import { formatBytes } from "./bytes"

describe("formatBytes", () => {
  it.each([
    [999, "999 byte"],
    [1_000, "1 kB"],
    [418_000_000, "418 MB"],
    [2_000_000_000, "2 GB"],
  ])("switches unit at each power of 1000 (%d)", (bytes, expected) => {
    expect(formatBytes(bytes, "en")).toBe(expected)
  })

  it("keeps one decimal below ten of a unit", () => {
    const formatted = formatBytes(1_500_000, "en")

    expect(formatted).toBe("1.5 MB")
  })
})
```

Dans `src/app/shared/components/display/icon.component.ts`, ajouter `"trash"` à la fin de `ICON_NAMES` (après `"external-link"`) : l'`it.each(ICON_NAMES)` existant d'`icon.component.spec.ts` couvre alors l'icône et échoue tant que le `@case` manque.

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec ng test --watch=false --include=src/app/shared/utils/bytes.spec.ts --include=src/app/shared/components/display/icon.component.spec.ts`
Expected: FAIL, `Failed to resolve import "./bytes"` et `renders an SVG for trash` sans `svg[data-p-icon="trash"]`.

- [ ] **Step 3: Implémenter**

Créer `src/app/shared/utils/bytes.ts` :

```typescript
/** Base decimale, comme `CACHE_MAX_BYTES` du sidecar : son plafond s'y lit en Mo ronds. */
const SCALES = [
  { unit: "gigabyte", size: 1_000_000_000 },
  { unit: "megabyte", size: 1_000_000 },
  { unit: "kilobyte", size: 1_000 },
] as const

/** Taille lisible dans la langue de l'interface : « 418 Mo », « 418 MB ». */
export const formatBytes = (bytes: number, language: string): string => {
  const scale = SCALES.find(({ size }) => bytes >= size)
  const value = scale ? bytes / scale.size : bytes

  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: scale?.unit ?? "byte",
    unitDisplay: "short",
    // Une decimale sous 10 : « 1,5 Mo » dit plus que « 2 Mo ».
    maximumFractionDigits: scale && value < 10 ? 1 : 0,
  }).format(value)
}
```

Dans `src/app/shared/components/display/icon.component.ts` :
- ajouter `import { Trash } from "@primeicons/angular/trash"` après l'import de `Search` (ordre du fichier) ;
- ajouter `Trash` aux `imports` du `@Component`, après `Search` ;
- ajouter le cas après celui d'`external-link` :

```html
      @case ("trash") {
        <svg data-p-icon="trash" [size]="size()" />
      }
```

- [ ] **Step 4: Vérifier le passage**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/shared/utils/bytes.spec.ts --include=src/app/shared/components/display/icon.component.spec.ts`
Expected: PASS. Si `formatBytes(999, "en")` rend `"999 B"` avec la version d'ICU de Node, aligner l'attente de ce seul cas : le test porte sur le choix d'unité.

- [ ] **Step 5: Gate et commit**

```bash
just format-ui && just lint-ui && just typecheck-ui && just test-ui
git add src/app/shared/utils/bytes.ts src/app/shared/utils/bytes.spec.ts src/app/shared/components/display/icon.component.ts
git commit -m "feat(settings): taille lisible et icône de vidage"
```

---

### Task 2: Rangée Cache

**Files:**
- Modify: `src/app/core/platform/completion-signal.service.ts` (`TOAST_LIFE`)
- Modify: `src/app/core/sidecar/sidecar.service.ts` (`runLost`)
- Modify: `src/fixtures/sidecar-stub.ts` (`runLost`)
- Modify: `src/app/features/settings/settings-page.component.ts`
- Modify: `src/app/features/settings/settings-page.component.html`
- Test: `src/app/features/settings/settings-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `formatBytes`, `"trash"` (Task 1) ; `SidecarService.cacheSize`, `cacheCleared`, `loadCacheSize()`, `clearCache()`, `phase`, `taggingRunId`, `committed`, `writeFailureCount`, `errorFor`, `available` ; `TaggingRunStore.lost` ; `languageFromTag` ; fixture `writtenTrack` (`src/fixtures/tagging.ts`).
- Produces :
  - `TOAST_LIFE` exporté par `completion-signal.service.ts` ;
  - `SidecarService.runLost: Signal<boolean>`, et son entrée `runLost` dans `defaults()` du stub ;
  - membres protégés de `SettingsPageComponent` : `cacheSize: Signal<string | null>`, `cacheBlockedReason: Signal<string | null>`, `cacheError`, `available`, `clearCache(): void`.

- [ ] **Step 1: Écrire les tests**

Dans `src/app/features/settings/settings-page.component.spec.ts` :
- ajouter `MessageService` à l'import de `primeng/api` et aux `providers` de `mountWith` (à côté de `ConfirmationService`) ;
- ajouter `import type { CacheClearedEvent } from "../../core/sidecar/protocol"` (fusionner avec l'import de type existant de `PastRun`) et `import { writtenTrack } from "../../../fixtures/tagging"` ;
- étendre l'`it.each` existant `calls %s once the engine answers, not at construction` : `["loadRollbackTarget", "listRuns", "loadCacheSize"] as const` ;
- ajouter à la fin du `describe("SettingsPageComponent")` :

```typescript
  describe("cache", () => {
    const CLEARED: CacheClearedEvent = {
      event: "cache_cleared",
      freed_bytes: 418_000_000,
      size_bytes: 0,
    }

    const withClearedTranslations = (): void => {
      translateWith({
        settings: {
          admin: {
            cache: {
              cleared: { summary: "Cleared", freed: "{{size}} freed", left: "{{size}} left" },
            },
          },
        },
      })
    }

    it("shows the cache size in the interface language", () => {
      const { fixture } = mountWith({ cacheSize: signal<number | null>(418_000_000) }, "admin")

      const size = hostOf(fixture).querySelector("[data-cache-size]")

      expect(size?.textContent?.trim()).toBe("418 MB")
    })

    it("sends the clearing", () => {
      const { fixture, service } = mountWith({}, "admin")

      hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="clear-cache"]')?.click()

      expect(service.clearCache).toHaveBeenCalled()
    })

    it("announces the freed bytes of a new clearing", () => {
      const cacheCleared = signal<CacheClearedEvent | null>(null)
      const add = vi.spyOn(MessageService.prototype, "add")
      const { fixture } = mountWith({ cacheCleared }, "admin")
      withClearedTranslations()

      cacheCleared.set(CLEARED)
      fixture.detectChanges()

      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "success", summary: "Cleared", detail: "418 MB freed" }),
      )
    })

    it("announces what is left after a partial clearing", () => {
      const cacheCleared = signal<CacheClearedEvent | null>(null)
      const add = vi.spyOn(MessageService.prototype, "add")
      const { fixture } = mountWith({ cacheCleared }, "admin")
      withClearedTranslations()

      cacheCleared.set({ ...CLEARED, size_bytes: 12_000_000 })
      fixture.detectChanges()

      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ detail: "418 MB freed\n12 MB left" }),
      )
    })

    it("announces nothing for a clearing already known when the page opens", () => {
      const add = vi.spyOn(MessageService.prototype, "add")

      const { fixture } = mountWith(
        { cacheCleared: signal<CacheClearedEvent | null>(CLEARED) },
        "admin",
      )
      fixture.detectChanges()

      expect(add).not.toHaveBeenCalled()
    })

    it.each([
      ["a long phase", { tagging: signal(true) }, "settings.admin.cache.blocked.busy"],
      [
        "a run not written",
        { taggingRunId: signal<string | null>("a3f9c1") },
        "settings.admin.cache.blocked.unwritten",
      ],
      [
        "a written run with failed writes",
        {
          taggingRunId: signal<string | null>("a3f9c1"),
          committed: signal(true),
          taggingTracks: signal([writtenTrack("a.mp3", "write_error")]),
        },
        "settings.admin.cache.blocked.unwritten",
      ],
      [
        "a written run",
        { taggingRunId: signal<string | null>("a3f9c1"), committed: signal(true) },
        null,
      ],
      [
        "a run lost with the engine",
        {
          taggingRunId: signal<string | null>("a3f9c1"),
          runLost: signal(true),
          taggingTracks: signal([writtenTrack("a.mp3", "write_error")]),
        },
        null,
      ],
    ])("blocks the clearing according to %s", (_case, overrides, reason) => {
      const { fixture, component } = mountWith(overrides, "admin")

      const button = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="clear-cache"]')

      expect(component["cacheBlockedReason"]()).toBe(reason)
      expect(button?.disabled).toBe(reason !== null)
    })

    it("shows a refused clearing under the cache row", () => {
      const { fixture } = mountWith(commandFailed("clear_cache", "run_not_written"), "admin")

      const error = hostOf(fixture).querySelector("[data-cache-error]")

      expect(error).not.toBeNull()
    })
  })
```

Le dernier cas garde des échecs d'écriture à l'écran : un run perdu avec le moteur ne les rejouera jamais, le moteur relancé n'ayant plus de run, donc rien n'attend le cache. `runFrozen` (`committed() || lost()`) ne le distingue pas d'un run écrit, d'où `runLost`.

Ajouter en tête du `describe("cache")`, les espions posés sur le prototype de `MessageService` survivant sinon au test :

```typescript
    afterEach(() => {
      vi.restoreAllMocks()
    })
```

- [ ] **Step 2: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Property 'cacheBlockedReason' does not exist on type 'SettingsPageComponent'` et `'runLost' does not exist in type 'Partial<StubbedState>'`.

- [ ] **Step 3: Partager la durée des toasts et exposer le run perdu**

Dans `src/app/core/platform/completion-signal.service.ts`, avant la classe :

```typescript
/** Duree commune des toasts de l'application (DESIGN.md § Feedback et chargement). */
export const TOAST_LIFE = 4000
```

et remplacer `life: 4000` par `life: TOAST_LIFE` dans `announce`.

Dans `src/app/core/sidecar/sidecar.service.ts`, après `readonly runFrozen = ...` :

```typescript
  /** Perdu avec le moteur : plus rien n'attend son ecriture, echecs restes a l'ecran compris. */
  readonly runLost = this.taggingRun.lost
```

Dans `src/fixtures/sidecar-stub.ts`, `defaults()`, après `runFrozen: signal(false),` : `runLost: signal(false),`.

- [ ] **Step 4: Implémenter le composant**

Dans `src/app/features/settings/settings-page.component.ts` :
- imports : `MessageService` (de `primeng/api`, à côté du type `MenuItem`) ; `TOAST_LIFE` de `../../core/platform/completion-signal.service` ; `type CacheClearedEvent` à l'import de `../../core/sidecar/protocol` ; `formatBytes` de `../../shared/utils/bytes` ;
- injection, après `router` : `private readonly messages = inject(MessageService)` ;
- champs, après les seuils (sub-project 03) ou la section Interface :

```typescript
  protected readonly available = this.sidecar.available
  protected readonly cacheSize = computed(() => {
    const bytes = this.sidecar.cacheSize()

    return bytes === null
      ? null
      : formatBytes(bytes, languageFromTag(this.translate.currentLang()))
  })
  /**
   * Sur ce que l'interface sait deja, comme `restoreBlockedReason` : le sidecar reste l'arbitre,
   * un refus `phase_busy` ou `run_not_written` s'affiche sous la rangee.
   */
  protected readonly cacheBlockedReason = computed(() => {
    if (this.sidecar.phase() !== "idle") {
      return "settings.admin.cache.blocked.busy"
    }
    // Un run perdu par la mort du moteur n'attend plus rien : le moteur relance n'en tient aucun.
    const awaitsWrite =
      this.sidecar.taggingRunId() !== null &&
      !this.sidecar.runLost() &&
      (!this.sidecar.committed() || this.sidecar.writeFailureCount() > 0)

    return awaitsWrite ? "settings.admin.cache.blocked.unwritten" : null
  })
  protected readonly cacheError = this.sidecar.errorFor("clear_cache", "get_cache_size")
  /** Dernier vidage deja connu au montage : un retour sur l'onglet ne rejoue pas son toast. */
  private announcedClear = untracked(this.sidecar.cacheCleared)
```

- dans le constructeur, ajouter `void this.sidecar.loadCacheSize()` au bloc `untracked` de l'`effect` existant (après `listRuns()`), puis un second `effect` :

```typescript
    effect(() => {
      const cleared = this.sidecar.cacheCleared()
      if (cleared === null || cleared === this.announcedClear) {
        return
      }
      this.announcedClear = cleared
      untracked(() => {
        this.announceClear(cleared)
      })
    })
```

- méthodes :

```typescript
  /** Sans confirmation : le cache est jetable (ADR-013), rien a restaurer. */
  protected clearCache(): void {
    if (this.cacheBlockedReason() !== null) {
      return
    }
    void this.sidecar.clearCache()
  }

  /** Sans signal sonore : ce n'est pas la fin d'une phase longue. */
  private announceClear(cleared: CacheClearedEvent): void {
    const language = languageFromTag(this.translate.currentLang())
    const lines = [
      this.translate.instant("settings.admin.cache.cleared.freed", {
        size: formatBytes(cleared.freed_bytes, language),
      }) as string,
    ]
    if (cleared.size_bytes > 0) {
      lines.push(
        this.translate.instant("settings.admin.cache.cleared.left", {
          size: formatBytes(cleared.size_bytes, language),
        }) as string,
      )
    }
    this.messages.add({
      severity: "success",
      summary: this.translate.instant("settings.admin.cache.cleared.summary") as string,
      detail: lines.join("\n"),
      life: TOAST_LIFE,
    })
  }
```

- [ ] **Step 5: Implémenter le gabarit**

Dans `settings-page.component.html`, `@case ("admin")`, insérer en tête de la section, juste après son `h2` :

```html
        <app-settings-row>
          <span rowLabel class="text-sm">{{ "settings.admin.cache.label" | translate }}</span>

          <!-- Sans champ, l'aide prend la place du controle, sur la ligne du bouton. -->
          <div rowControl class="flex min-w-0 items-center justify-between gap-4">
            <span class="text-xs text-pretty whitespace-pre-line text-muted-color">{{
              "settings.admin.cache.hint" | translate
            }}</span>
            <div class="flex shrink-0 items-center gap-2">
              @let cacheBlocked =
                cacheBlockedReason() ? (cacheBlockedReason() | translate) : undefined;
              <button
                pButton
                type="button"
                size="small"
                severity="secondary"
                [outlined]="true"
                data-action="clear-cache"
                [disabled]="cacheBlocked !== undefined || available() !== true"
                [pTooltip]="cacheBlocked"
                [tooltipOptions]="tooltip"
                (click)="clearCache()"
              >
                <app-icon name="trash" [size]="16" />
                {{ "settings.admin.cache.action" | translate }}
              </button>
              @if (cacheSize(); as size) {
                <span data-cache-size class="text-sm text-muted-color tabular-nums">{{ size }}</span>
              }
            </div>
          </div>

          @if (cacheError(); as shown) {
            <app-error-message data-cache-error [error]="shown" />
          }
        </app-settings-row>
```

Dans `public/i18n/fr.json`, bloc `settings.admin`, avant `"pastRuns"` (`\u00a0` : espace insécable avant les deux-points) :

```json
      "cache": {
        "label": "Cache",
        "hint": "Réponses de l'API et pochettes déjà téléchargées.\nLe vider ne touche à aucun fichier de musique\u00a0: les prochains runs les retéléchargent.",
        "action": "Vider le cache",
        "blocked": {
          "busy": "Une opération est en cours.\nAttendez sa fin.",
          "unwritten": "Le run affiché attend l'écriture de ses tags.\nTerminez-la avant de vider le cache."
        },
        "cleared": {
          "summary": "Cache vidé",
          "freed": "{{size}} libérés.",
          "left": "{{size}} restent, utilisés par un autre programme."
        }
      },
```

Dans `public/i18n/en.json`, au même endroit :

```json
      "cache": {
        "label": "Cache",
        "hint": "API responses and artwork already downloaded.\nClearing it touches no music file: the next runs download them again.",
        "action": "Clear the cache",
        "blocked": {
          "busy": "An operation is in progress.\nWait for it to finish.",
          "unwritten": "The run on screen is waiting for its tags to be written.\nFinish writing before clearing the cache."
        },
        "cleared": {
          "summary": "Cache cleared",
          "freed": "{{size}} freed.",
          "left": "{{size}} left, used by another program."
        }
      },
```

- [ ] **Step 6: Vérifier le passage**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/features/settings/settings-page.component.spec.ts --include=src/app/core/platform/completion-signal.service.spec.ts --include=src/app/core/i18n/translations.spec.ts`
Expected: PASS.

- [ ] **Step 7: Gate et commit**

```bash
just format-ui && just lint-ui && just typecheck-ui && just test-ui
git add src/app/core/platform/completion-signal.service.ts src/app/core/sidecar/sidecar.service.ts src/fixtures/sidecar-stub.ts src/app/features/settings/settings-page.component.ts src/app/features/settings/settings-page.component.html src/app/features/settings/settings-page.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(settings): vider le cache depuis les réglages"
```

---

### Task 3: Rangée Logs et docs

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts`
- Modify: `src/app/features/settings/settings-page.component.html`
- Test: `src/app/features/settings/settings-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCTION.md`

**Interfaces:**
- Consumes: `SidecarService.logFile` (sub-project 01), `"external-link"` (existant), `MessageComponent` (`app-message`, `severity`, `size`).
- Produces : membres protégés `logFile`, `logsUnavailable: WritableSignal<boolean>`, `revealLogs(): Promise<void>`.

- [ ] **Step 1: Écrire les tests**

Dans `src/app/features/settings/settings-page.component.spec.ts`, ajouter en tête :

```typescript
import { revealItemInDir } from "@tauri-apps/plugin-opener"
```

et après les autres `vi.mock` :

```typescript
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(() => Promise.resolve()),
}))
```

Puis à la fin du `describe("SettingsPageComponent")` :

```typescript
  describe("logs", () => {
    const LOG_FILE = "C:/data/trace.log"

    it("reveals the log file named by the engine", async () => {
      const { component } = mountWith({ logFile: signal<string | null>(LOG_FILE) }, "admin")

      await component["revealLogs"]()

      expect(revealItemInDir).toHaveBeenCalledWith(LOG_FILE)
    })

    it("disables the logs button until the engine names its log file", () => {
      const { fixture } = mountWith({ logFile: signal<string | null>(null) }, "admin")

      const button = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="reveal-logs"]')

      expect(button?.disabled).toBe(true)
    })

    it("tells to restart when the log file cannot be revealed", async () => {
      vi.mocked(revealItemInDir).mockRejectedValueOnce(new Error("path not found"))
      const { fixture, component } = mountWith(
        { logFile: signal<string | null>(LOG_FILE) },
        "admin",
      )

      await component["revealLogs"]()
      fixture.detectChanges()

      expect(hostOf(fixture).querySelector("[data-logs-error]")).not.toBeNull()
    })
  })
```

- [ ] **Step 2: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Property 'revealLogs' does not exist on type 'SettingsPageComponent'`.

- [ ] **Step 3: Implémenter**

Dans `src/app/features/settings/settings-page.component.ts` :
- imports : `import { revealItemInDir } from "@tauri-apps/plugin-opener"` ; `MessageComponent` de `../../shared/components/feedback/message.component`, ajouté aux `imports` du `@Component` ;
- champs, après `announcedClear` :

```typescript
  protected readonly logFile = this.sidecar.logFile
  protected readonly logsUnavailable = signal(false)
```

- méthode, après `clearCache` :

```typescript
  /**
   * Revele le fichier courant plutot que le dossier : l'Explorateur s'ouvre dans `logs`, le
   * fichier a joindre selectionne. `opener:allow-reveal-item-in-dir` n'a pas de scope.
   */
  protected async revealLogs(): Promise<void> {
    const file = this.logFile()
    if (file === null) {
      return
    }
    try {
      await revealItemInDir(file)
      this.logsUnavailable.set(false)
    } catch {
      // Fichier efface a la main : le relancement du moteur le recree.
      this.logsUnavailable.set(true)
    }
  }
```

Dans `settings-page.component.html`, après la rangée Cache :

```html
        <app-settings-row>
          <span rowLabel class="text-sm">{{ "settings.admin.logs.label" | translate }}</span>

          <div rowControl class="flex min-w-0 items-center justify-between gap-4">
            <span class="text-xs text-pretty whitespace-pre-line text-muted-color">{{
              "settings.admin.logs.hint" | translate
            }}</span>
            <button
              pButton
              type="button"
              size="small"
              severity="secondary"
              [outlined]="true"
              class="shrink-0"
              data-action="reveal-logs"
              [disabled]="logFile() === null"
              (click)="revealLogs()"
            >
              <app-icon name="external-link" [size]="16" />
              {{ "settings.admin.logs.action" | translate }}
            </button>
          </div>

          @if (logsUnavailable()) {
            <app-message data-logs-error severity="error" size="small">{{
              "settings.admin.logs.unavailable" | translate
            }}</app-message>
          }
        </app-settings-row>
```

Dans `public/i18n/fr.json`, bloc `settings.admin`, après `"cache"` :

```json
      "logs": {
        "label": "Logs",
        "hint": "Pour signaler un problème, joignez le fichier sélectionné à votre message.",
        "action": "Ouvrir le dossier des logs",
        "unavailable": "Le fichier de logs est introuvable.\nRelancez l'application pour le recréer."
      },
```

Dans `public/i18n/en.json`, au même endroit :

```json
      "logs": {
        "label": "Logs",
        "hint": "To report a problem, attach the selected file to your message.",
        "action": "Open the logs folder",
        "unavailable": "The log file cannot be found.\nRestart the application to create it again."
      },
```

- [ ] **Step 4: Vérifier le passage**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/features/settings/settings-page.component.spec.ts --include=src/app/core/i18n/translations.spec.ts`
Expected: PASS.

- [ ] **Step 5: Contrôler la fenêtre**

`just dev`, fenêtre à 1024 × 700, Réglages, section Administration :
- les quatre rangées tiennent sans défiler, dans l'ordre Cache, Logs, Restauration, Runs passés ;
- la taille du cache s'affiche ; « Vider le cache » la ramène à zéro et le toast annonce les octets libérés ;
- pendant une recherche, le bouton est grisé et son tooltip en donne la raison ;
- « Ouvrir le dossier des logs » ouvre l'Explorateur dans `logs`, `tagger.log` sélectionné.

- [ ] **Step 6: Mettre à jour les docs**

- `docs/DESIGN.md` :
  - retirer de « Post-MVP (non installés) » la ligne Actions d'administration (l.309) et la poser dans le Mapping : `| Actions d'administration | \`button pButton\` \`secondary\` outlined \`size="small"\`, icône à gauche (\`trash\`, \`external-link\`), aide sur la ligne du bouton | PrimeNG | « Vider le cache » sans confirmation (cache jetable), grisé avec sa raison ; « Ouvrir le dossier des logs » révèle le fichier de logs courant |` ;
  - Notifications (l.261) : ajouter le vidage du cache aux toasts, sans signal sonore ;
  - § Icônes : ajouter `trash` aux icônes employées si le document les énumère.
- `docs/ARCHITECTURE.md` :
  - l.387 (`opener`) : « bouton « ouvrir le dossier de logs » des Settings à l'étape 8 » devient « bouton « Ouvrir le dossier des logs » des Réglages : `revealItemInDir` sur le fichier de logs courant (`version.log_file`), sans permission de plus » ;
  - l.414 (`features/settings/`) : cache et logs câblés, plus rien en attente à l'étape 8 ;
  - l.948 : « (étape 8, pas encore câblé) » devient « révèle `tagger.log`, sélectionné dans l'Explorateur ».
- `docs/PRODUCTION.md` l.321 : le bouton des logs s'appuie sur `opener:allow-reveal-item-in-dir`, déjà accordé, sans nouvelle permission.

- [ ] **Step 7: Gate et commit**

```bash
just format-ui && just lint-ui && just typecheck-ui && just test-ui
git add src/app/features/settings/settings-page.component.ts src/app/features/settings/settings-page.component.html src/app/features/settings/settings-page.component.spec.ts public/i18n/fr.json public/i18n/en.json docs/DESIGN.md docs/ARCHITECTURE.md docs/PRODUCTION.md
git commit -m "feat(settings): ouvrir le dossier des logs depuis les réglages"
```
