# Seuils de matching : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Régler le plancher et le seuil haut du matching depuis les Réglages et les appliquer aux runs suivants.

**Architecture:** Deux tâches :
- la préférence `thresholds` (un écart aux défauts du sidecar, `null` sinon), lue par l'onglet Tagging au lancement d'un run ;
- la section Matching du menu des Réglages : deux rangées curseur + champ aux bornes croisées, valeurs de départ lues de `SidecarService.defaultThresholds`, enregistrement en fin de geste, bouton « Rétablir les valeurs par défaut ».

Aucun changement côté sidecar : `start_tagging` accepte déjà des seuils optionnels.

**Tech Stack:** Angular 22 (signals, Signal Forms), PrimeNG 22 (`Slider`, `InputNumber`, `Button`, `Tooltip`), ngx-translate 18, `@tauri-apps/plugin-store`, Vitest.

**Spec:** `docs/superpowers/specs/settings/03-seuils-de-matching-ui-design.md`

## Global Constraints

- **Dépend des sub-projects 01 et 02, implémentés avant** :
  - 01 : `VersionEvent.default_thresholds`, `SidecarService.defaultThresholds: Signal<ThresholdsPayload | null>`, entrée `defaultThresholds` du stub ;
  - 02 : `SettingsSection`, `SECTIONS`, `menuItems`, section Interface, `mountWith(overrides, section)` et `vi.mock("@tauri-apps/plugin-store")` (indisponible par défaut) dans `settings-page.component.spec.ts`.
- **Clé de store** : `thresholds`, valeur `{ floor, ceiling }` ou `null`. `null` : aucun seuil envoyé, le sidecar applique les siens.
- **Une valeur, une source** : aucune valeur de départ écrite côté TS ; les défauts viennent de `defaultThresholds`. Les tests emploient des valeurs fictives distinctes des défauts réels.
- **Échelle 0–100** : une seule constante TS (`SCORE_SCALE`), l'échelle des scores rapidfuzz.
- **Enregistrement en fin de geste** : `onSlideEnd` du curseur, `onBlur` du champ. Des valeurs égales aux défauts s'enregistrent `null`.
- **Libellés** : ngx-translate, deux fichiers dans le même commit, une phrase par ligne, espace insécable avant `:` en français, « correspondance incertaine » et jamais « zone grise ».
- **Commentaires TypeScript sans accents**, le pourquoi seulement.
- **Tests** : noms en anglais, AAA, aucun test de plomberie PrimeNG (no-lib-test).
- **Gate vert à chaque commit** : `just format-ui && just lint-ui && just typecheck-ui && just test-ui`. Commits `type(scope): description`, scope `settings`.
- **Numéros de ligne des docs** : relevés le 2026-10-14, avant les sub-projects 01 et 02 qui éditent les mêmes fichiers. Chercher le texte cité, pas la ligne.

## Review Focus

- **Moteur pas encore répondu, aucun réglage** : rangées grisées plutôt qu'à zéro (Task 2, `disables the thresholds until the engine answers`).
- **Préférence éditée à la main** (croisée, hors échelle, pas des nombres) : ignorée, le run part sans seuils (Task 1, `ignores stored thresholds that are %s`).
- **Store indisponible au lancement** : le run part sans seuils, sans lever (Task 1, `sends no thresholds when the store is unavailable`).
- **Réglage ramené exactement sur les défauts** : enregistré `null`, il suit un recalibrage futur (Task 2, `stores no setting for thresholds equal to the defaults`).
- **« Rétablir les valeurs par défaut »** : efface le réglage et ramène les rangées aux défauts (Task 2, `resets the thresholds to the engine defaults`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/sidecar/protocol.ts` | `SCORE_SCALE`, à côté de `ThresholdsPayload` |
| `src/app/core/platform/preferences.ts` | Préférence `thresholds` |
| `src/fixtures/tauri-store.ts` | `storeOf`, store dont chaque clé a sa valeur |
| `src/app/features/tagging/run/tagging-page.component.ts` | `start()` envoie le réglage |
| `src/app/features/settings/settings-page.component.{ts,html}` | Section Matching |
| `public/i18n/{fr,en}.json` | `settings.matching.*` |
| `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCTION.md` | Mapping, préférences |

---

### Task 1: Préférence des seuils et lancement d'un run

**Files:**
- Modify: `src/app/core/sidecar/protocol.ts` (`SCORE_SCALE`)
- Modify: `src/app/core/platform/preferences.ts`
- Modify: `src/fixtures/tauri-store.ts`
- Modify: `src/app/features/tagging/run/tagging-page.component.ts` (`start`)
- Test: `src/app/core/platform/preferences.spec.ts`, `src/app/features/tagging/run/tagging-page.component.spec.ts`

**Interfaces:**
- Consumes: `ThresholdsPayload` (`protocol.ts`), `definePreference` (privé à `preferences.ts`), `SidecarService.startTagging(folder: string, thresholds?: ThresholdsPayload)`.
- Produces :
  - `SCORE_SCALE: { readonly min: 0; readonly max: 100 }` ;
  - `readThresholds(): Promise<ThresholdsPayload | null>`, `writeThresholds(value: ThresholdsPayload | null): Promise<void>` ;
  - `storeOf(entries: Record<string, unknown>): Store` (fixture).

- [ ] **Step 1: Écrire les tests**

Dans `src/fixtures/tauri-store.ts`, ajouter après `storeStub` :

```typescript
/** Store dont `get(cle)` rend la valeur de cette cle dans `entries`, `undefined` sinon. */
export const storeOf = (entries: Record<string, unknown>): Store =>
  ({
    get: vi.fn((key: string) => Promise.resolve(entries[key])),
    set: vi.fn(() => Promise.resolve()),
    save: vi.fn(() => Promise.resolve()),
  }) as unknown as Store
```

Dans `src/app/core/platform/preferences.spec.ts`, ajouter `readThresholds` à l'import de `./preferences`, puis à la fin du `describe` :

```typescript
  it("restores stored thresholds", async () => {
    vi.mocked(load).mockResolvedValue(storeStub({ floor: 72, ceiling: 95 }))

    const result = await readThresholds()

    expect(result).toEqual({ floor: 72, ceiling: 95 })
  })

  it.each([
    ["crossed", { floor: 95, ceiling: 72 }],
    ["out of the score scale", { floor: 72, ceiling: 120 }],
    ["not numbers", { floor: "72", ceiling: 95 }],
    ["not an object", "72-95"],
  ])("ignores stored thresholds that are %s", async (_case, stored) => {
    vi.mocked(load).mockResolvedValue(storeStub(stored))

    const result = await readThresholds()

    expect(result).toBeNull()
  })
```

Dans `src/app/features/tagging/run/tagging-page.component.spec.ts` :
- ajouter `storeOf` à l'import de `../../../../fixtures/tauri-store` ;
- dans `sends the start tagging command with the chosen folder` (l.755), remplacer l'attente par `expect(service.startTagging).toHaveBeenCalledWith("D:/Sets/Aout", undefined)` : le store de `mountWith` rend `"D:/Sets/Aout"` pour toute clé, que le filtre des seuils rejette ;
- ajouter après ce test :

```typescript
  it("sends the thresholds set in the settings", async () => {
    const { component, service } = await mountWith()
    component["folder"].set("D:/Sets/Aout")
    vi.mocked(load).mockResolvedValue(storeOf({ thresholds: { floor: 72, ceiling: 95 } }))

    await component["start"]()

    expect(service.startTagging).toHaveBeenCalledWith("D:/Sets/Aout", { floor: 72, ceiling: 95 })
  })

  it("sends no thresholds when the store is unavailable", async () => {
    const { component, service } = await mountWith()
    component["folder"].set("D:/Sets/Aout")
    vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))

    await component["start"]()

    expect(service.startTagging).toHaveBeenCalledWith("D:/Sets/Aout", undefined)
  })
```

- [ ] **Step 2: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Module './preferences' has no exported member 'readThresholds'`.

- [ ] **Step 3: Implémenter**

Dans `src/app/core/sidecar/protocol.ts`, après `ThresholdsPayload` :

```typescript
/**
 * Echelle des scores rapidfuzz, que la librairie fixe : ce n'est pas un reglage du projet.
 * `check_thresholds` la borne aussi cote sidecar.
 */
export const SCORE_SCALE = { min: 0, max: 100 } as const
```

Dans `src/app/core/platform/preferences.ts` :
- étendre l'import de `../sidecar/protocol` : `import { SCORE_SCALE, type ExtractionMode, type ThresholdsPayload } from "../sidecar/protocol"` (l'import devient une valeur, plus un `import type`) ;
- ajouter avant les déclarations de préférences :

```typescript
/** Une valeur editee a la main hors de ces bornes ferait refuser `start_tagging`. */
const isThresholds = (stored: unknown): stored is ThresholdsPayload => {
  if (typeof stored !== "object" || stored === null) {
    return false
  }
  const { floor, ceiling } = stored as Record<string, unknown>

  return (
    typeof floor === "number" &&
    typeof ceiling === "number" &&
    SCORE_SCALE.min <= floor &&
    floor <= ceiling &&
    ceiling <= SCORE_SCALE.max
  )
}
```

- après la préférence `language` (sub-project 02) :

```typescript
const thresholds = definePreference<ThresholdsPayload | null>("thresholds", null, isThresholds)
```

- en fin de fichier :

```typescript
/** `null` : suivre les defauts du sidecar, aucun seuil n'est envoye. */
export const readThresholds = thresholds.read
export const writeThresholds = thresholds.write
```

Dans `src/app/features/tagging/run/tagging-page.component.ts`, ajouter `readThresholds` à l'import de `../../../core/platform/preferences`, puis :

```typescript
  protected async start(): Promise<void> {
    if (this.blockedReason() !== null) {
      return
    }
    // Lu au clic : un reglage fait dans les Reglages vaut des le run suivant.
    const thresholds = await readThresholds()
    await this.sidecar.startTagging(this.folder(), thresholds ?? undefined)
  }
```

- [ ] **Step 4: Vérifier le passage**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/core/platform/preferences.spec.ts --include=src/app/features/tagging/run/tagging-page.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Gate et commit**

```bash
just format-ui && just lint-ui && just typecheck-ui && just test-ui
git add src/app/core/sidecar/protocol.ts src/app/core/platform/preferences.ts src/app/core/platform/preferences.spec.ts src/fixtures/tauri-store.ts src/app/features/tagging/run/tagging-page.component.ts src/app/features/tagging/run/tagging-page.component.spec.ts
git commit -m "feat(settings): seuils enregistrés envoyés au lancement d'un run"
```

---

### Task 2: Section Matching des Réglages

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts`
- Modify: `src/app/features/settings/settings-page.component.html`
- Test: `src/app/features/settings/settings-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCTION.md`

**Interfaces:**
- Consumes: `readThresholds`, `writeThresholds`, `SCORE_SCALE`, `storeOf` (Task 1) ; `SidecarService.defaultThresholds` (sub-project 01) ; `SettingsSection`, `SECTIONS`, `TOOLTIP` (sub-project 02 et existant).
- Produces (membres protégés de `SettingsPageComponent`) :
  - `SettingsSection` étendu : `"api" | "matching" | "interface" | "admin"` ;
  - `storedThresholds: WritableSignal<ThresholdsPayload | null | undefined>` (`undefined` avant lecture) ;
  - `thresholdsChoice: WritableSignal<ThresholdsChoice>`, `thresholdsFields` ;
  - `floorMax: Signal<number>`, `ceilingMin: Signal<number>`, `thresholdsCustomized: Signal<boolean>` ;
  - `storeThresholds(): void`, `resetThresholds(): void`.

- [ ] **Step 1: Écrire les tests**

Dans `src/app/features/settings/settings-page.component.spec.ts`, ajouter `storeOf` à l'import de `../../../fixtures/tauri-store`, puis à la fin du `describe("SettingsPageComponent")` :

```typescript
  describe("matching", () => {
    /** Defauts fictifs du moteur, distincts des vrais : rien ici ne doit les recopier. */
    const DEFAULTS = { floor: 65, ceiling: 85 }

    it("shows the engine defaults without a setting", async () => {
      vi.mocked(load).mockResolvedValue(storeOf({}))

      const { component } = mountWith({ defaultThresholds: signal(DEFAULTS) }, "matching")

      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).toBeNull()
      })
      expect(component["thresholdsChoice"]()).toEqual(DEFAULTS)
      expect(component["thresholdsCustomized"]()).toBe(false)
    })

    it("prefers the stored setting over the engine defaults", async () => {
      vi.mocked(load).mockResolvedValue(storeOf({ thresholds: { floor: 72, ceiling: 95 } }))

      const { component } = mountWith({ defaultThresholds: signal(DEFAULTS) }, "matching")

      await vi.waitFor(() => {
        expect(component["thresholdsChoice"]()).toEqual({ floor: 72, ceiling: 95 })
      })
      expect(component["thresholdsCustomized"]()).toBe(true)
    })

    it("disables the thresholds until the engine answers", () => {
      const { component } = mountWith({ defaultThresholds: signal(null) }, "matching")

      const disabled = component["thresholdsFields"].floor().disabled()

      expect(disabled).toBe(true)
    })

    it("stores thresholds that differ from the defaults", async () => {
      const store = storeOf({})
      vi.mocked(load).mockResolvedValue(store)
      const { component } = mountWith({ defaultThresholds: signal(DEFAULTS) }, "matching")
      component["thresholdsChoice"].set({ floor: 65, ceiling: 95 })

      component["storeThresholds"]()

      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("thresholds", { floor: 65, ceiling: 95 })
      })
    })

    it("stores no setting for thresholds equal to the defaults", async () => {
      const store = storeOf({ thresholds: { floor: 72, ceiling: 95 } })
      vi.mocked(load).mockResolvedValue(store)
      const { component } = mountWith({ defaultThresholds: signal(DEFAULTS) }, "matching")
      await vi.waitFor(() => {
        expect(component["thresholdsCustomized"]()).toBe(true)
      })
      component["thresholdsChoice"].set({ ...DEFAULTS })

      component["storeThresholds"]()

      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("thresholds", null)
      })
      expect(component["thresholdsCustomized"]()).toBe(false)
    })

    it("resets the thresholds to the engine defaults", async () => {
      const store = storeOf({ thresholds: { floor: 72, ceiling: 95 } })
      vi.mocked(load).mockResolvedValue(store)
      const { component } = mountWith({ defaultThresholds: signal(DEFAULTS) }, "matching")
      await vi.waitFor(() => {
        expect(component["thresholdsCustomized"]()).toBe(true)
      })

      component["resetThresholds"]()

      expect(component["thresholdsChoice"]()).toEqual(DEFAULTS)
      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("thresholds", null)
      })
    })

    it("never lets the floor pass the high threshold", () => {
      const { component } = mountWith({ defaultThresholds: signal(DEFAULTS) }, "matching")

      component["thresholdsChoice"].set({ floor: 60, ceiling: 80 })

      expect(component["floorMax"]()).toBe(80)
      expect(component["ceilingMin"]()).toBe(60)
    })
  })
```

- [ ] **Step 2: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Argument of type '"matching"' is not assignable to parameter of type 'SettingsSection'`.

- [ ] **Step 3: Implémenter le composant**

Dans `src/app/features/settings/settings-page.component.ts` :
- imports : `import { InputNumber } from "primeng/inputnumber"`, `import { Slider } from "primeng/slider"` (et les deux aux `imports` du `@Component`) ; `readThresholds`, `writeThresholds` à l'import de `../../core/platform/preferences` ; `import { SCORE_SCALE, type ThresholdsPayload } from "../../core/sidecar/protocol"` ;
- sections :

```typescript
export type SettingsSection = "api" | "matching" | "interface" | "admin"

/** Ordre du menu, celui de la maquette ; une section sans rangee n'y entre pas. */
const SECTIONS: readonly SettingsSection[] = ["api", "matching", "interface", "admin"]
```

- interface, après `SoundChoice` :

```typescript
interface ThresholdsChoice {
  floor: number
  ceiling: number
}
```

- constante, après `STORED_KEY_MASK` :

```typescript
/** Chiffres alignes d'une rangee a l'autre (fiche InputNumber). */
const NUMBER_PT = { pcInputText: { root: { class: "tabular-nums" } } }
```

- champs, après `soundFields` :

```typescript
  protected readonly scale = SCORE_SCALE
  protected readonly numberPt = NUMBER_PT
  /** `undefined` tant que le store n'est pas lu, `null` sans reglage. */
  protected readonly storedThresholds = signal<ThresholdsPayload | null | undefined>(undefined)
  /** Le reglage, sinon les defauts du moteur ; `null` tant qu'aucun des deux n'est connu. */
  private readonly shownThresholds = computed(
    () => this.storedThresholds() ?? this.sidecar.defaultThresholds(),
  )
  protected readonly thresholdsChoice = linkedSignal<ThresholdsChoice>(() => {
    const shown = this.shownThresholds()

    return {
      floor: Math.round(shown?.floor ?? SCORE_SCALE.min),
      ceiling: Math.round(shown?.ceiling ?? SCORE_SCALE.max),
    }
  })
  protected readonly thresholdsFields = form(this.thresholdsChoice, (path) => {
    // Sans valeur connue, des curseurs actifs enregistreraient 0 et 100 au premier geste.
    disabled(path.floor, { when: () => this.shownThresholds() === null })
    disabled(path.ceiling, { when: () => this.shownThresholds() === null })
  })
  /** Bornes croisees : `check_thresholds` refuserait un plancher au-dessus du seuil haut. */
  protected readonly floorMax = computed(() => this.thresholdsChoice().ceiling)
  protected readonly ceilingMin = computed(() => this.thresholdsChoice().floor)
  protected readonly thresholdsCustomized = computed(() => {
    const stored = this.storedThresholds()

    return stored !== null && stored !== undefined
  })
```

- constructeur, après la lecture du son :

```typescript
    // Une lecture tardive n'ecrase pas un geste deja fait : elle ne pose que l'etat initial.
    void readThresholds().then((stored) => {
      this.storedThresholds.update((current) => (current === undefined ? stored : current))
    })
```

- méthodes, après `chooseSound` :

```typescript
  /**
   * En fin de geste, jamais a chaque cran. Des valeurs egales aux defauts s'enregistrent `null` :
   * le reglage suit alors les defauts du moteur, recalibrage futur compris (ADR-008).
   */
  protected storeThresholds(): void {
    const { floor, ceiling } = this.thresholdsChoice()
    const defaults = this.sidecar.defaultThresholds()
    const atDefaults = defaults !== null && floor === defaults.floor && ceiling === defaults.ceiling
    const stored = atDefaults ? null : { floor, ceiling }
    this.storedThresholds.set(stored)
    void writeThresholds(stored)
  }

  protected resetThresholds(): void {
    this.storedThresholds.set(null)
    void writeThresholds(null)
  }
```

- [ ] **Step 4: Implémenter le gabarit**

Dans `settings-page.component.html`, ajouter entre `@case ("api")` et `@case ("interface")` :

```html
    @case ("matching") {
      <section class="flex flex-col gap-4">
        <h2 class="text-xl font-semibold">{{ "settings.matching.title" | translate }}</h2>

        <app-settings-row>
          <span rowLabel id="floor-label" class="text-sm">{{
            "settings.matching.floor.label" | translate
          }}</span>

          <!-- Curseur pour le mouvement grossier, champ pour le nombre exact (fiche Slider). -->
          <div rowControl class="flex items-center gap-4">
            <p-slider
              class="flex-1"
              data-field="floor"
              ariaLabelledBy="floor-label"
              [formField]="thresholdsFields.floor"
              [min]="scale.min"
              [max]="floorMax()"
              (onSlideEnd)="storeThresholds()"
            />
            <!-- w-16 : mesuree sur « 100 », le plus large des scores. -->
            <p-inputnumber
              class="w-16 shrink-0"
              size="small"
              ariaLabelledBy="floor-label"
              [fluid]="true"
              [formField]="thresholdsFields.floor"
              [min]="scale.min"
              [max]="floorMax()"
              [pt]="numberPt"
              (onBlur)="storeThresholds()"
            />
          </div>

          <span class="text-xs text-pretty whitespace-pre-line text-muted-color">{{
            "settings.matching.floor.hint" | translate
          }}</span>
        </app-settings-row>

        <app-settings-row>
          <span rowLabel id="ceiling-label" class="text-sm">{{
            "settings.matching.ceiling.label" | translate
          }}</span>

          <div rowControl class="flex items-center gap-4">
            <p-slider
              class="flex-1"
              data-field="ceiling"
              ariaLabelledBy="ceiling-label"
              [formField]="thresholdsFields.ceiling"
              [min]="ceilingMin()"
              [max]="scale.max"
              (onSlideEnd)="storeThresholds()"
            />
            <p-inputnumber
              class="w-16 shrink-0"
              size="small"
              ariaLabelledBy="ceiling-label"
              [fluid]="true"
              [formField]="thresholdsFields.ceiling"
              [min]="ceilingMin()"
              [max]="scale.max"
              [pt]="numberPt"
              (onBlur)="storeThresholds()"
            />
          </div>

          <span class="text-xs text-pretty whitespace-pre-line text-muted-color">{{
            "settings.matching.ceiling.hint" | translate
          }}</span>
        </app-settings-row>

        <div class="flex justify-end">
          @let resetBlocked =
            thresholdsCustomized() ? undefined : ("settings.matching.reset.blocked" | translate);
          <button
            pButton
            type="button"
            size="small"
            severity="secondary"
            [outlined]="true"
            data-action="reset-thresholds"
            [disabled]="resetBlocked !== undefined"
            [pTooltip]="resetBlocked"
            [tooltipOptions]="tooltip"
            (click)="resetThresholds()"
          >
            {{ "settings.matching.reset.action" | translate }}
          </button>
        </div>
      </section>
    }
```

Si `typecheck-ui` refuse `size` ou `ariaLabelledBy` sur `p-inputnumber`, lire leurs noms dans `node_modules/primeng/types/primeng-inputnumber.d.ts` et s'y aligner : le comportement attendu ne change pas.

Dans `public/i18n/fr.json`, entre `"api": {…}` et `"interface": {` du bloc `settings` (`\u00a0` : espace insécable avant les deux-points) :

```json
    "matching": {
      "title": "Matching",
      "floor": {
        "label": "Plancher",
        "hint": "Appliqué séparément au score artiste et au score titre.\nEn dessous, le candidat est écarté."
      },
      "ceiling": {
        "label": "Seuil haut",
        "hint": "Appliqué à la moyenne des deux.\nAu-dessus, validation automatique.\nEntre les deux, correspondance incertaine\u00a0: à arbitrer."
      },
      "reset": {
        "action": "Rétablir les valeurs par défaut",
        "blocked": "Les seuils sont déjà ceux par défaut."
      }
    },
```

Dans `public/i18n/en.json`, au même endroit :

```json
    "matching": {
      "title": "Matching",
      "floor": {
        "label": "Floor",
        "hint": "Applied separately to the artist score and the title score.\nBelow it, the candidate is discarded."
      },
      "ceiling": {
        "label": "High threshold",
        "hint": "Applied to the average of both.\nAbove it, automatic validation.\nIn between, uncertain match: to arbitrate."
      },
      "reset": {
        "action": "Restore default values",
        "blocked": "The thresholds are already the default ones."
      }
    },
```

- [ ] **Step 5: Vérifier le passage**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/features/settings/settings-page.component.spec.ts --include=src/app/core/i18n/translations.spec.ts`
Expected: PASS.

- [ ] **Step 6: Contrôler la fenêtre**

`just dev`, fenêtre à 1024 × 700, Réglages, section Matching :
- les rangées affichent les défauts du moteur, « Rétablir les valeurs par défaut » grisé avec sa raison au survol ;
- pousser le plancher vers le seuil haut : il s'arrête dessus ;
- régler le seuil haut à 95, lancer un run depuis Tagging : le plan du run (`appLocalDataDir()/plans`) porte ce seuil ;
- « Rétablir les valeurs par défaut », relancer : le plan porte les défauts du moteur ;
- la section tient sans défiler, le champ ne coupe pas « 100 ».

- [ ] **Step 7: Mettre à jour les docs**

- `docs/DESIGN.md` : retirer de « Post-MVP (non installés) » la ligne Seuils de matching (l.310) et la poser dans le Mapping, famille des champs :
  `| Seuils de matching | \`p-slider\` lié à un \`p-inputnumber\`, bornes croisées ; « Rétablir les valeurs par défaut » en \`secondary\` outlined sous la section | PrimeNG | Plancher et seuil haut. Valeurs de départ lues du sidecar (\`version.default_thresholds\`), jamais recopiées |`
- `docs/ARCHITECTURE.md` :
  - l.208 : « Réglables dans les Settings à l'étape 8 » devient « Réglables dans les Réglages, section Matching » ;
  - l.385 (`store`) : remplacer « seuils à l'étape 8 » par « seuils (`thresholds` : l'écart aux défauts du sidecar, `null` sinon) » ;
  - l.414 (`features/settings/`) : seuils câblés, « Cache et logs : étape 8, pas encore câblés ».
- `docs/PRODUCTION.md` l.242 : ajouter « seuils de matching » aux préférences du store Tauri.

- [ ] **Step 8: Gate et commit**

```bash
just format-ui && just lint-ui && just typecheck-ui && just test-ui
git add src/app/features/settings/settings-page.component.ts src/app/features/settings/settings-page.component.html src/app/features/settings/settings-page.component.spec.ts public/i18n/fr.json public/i18n/en.json docs/DESIGN.md docs/ARCHITECTURE.md docs/PRODUCTION.md
git commit -m "feat(settings): seuils de matching dans les réglages"
```
