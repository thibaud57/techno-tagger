# Langue et signal sonore : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de forcer la langue FR ou EN et de couper le signal sonore de fin depuis les Réglages, choix persistés, dans une page passée en menu latéral.

**Architecture:** Trois tâches :
- la préférence `language` et `resolveStartupLanguage()`, appelée par l'initialiseur d'`app.config.ts` ;
- la page des Réglages en menu latéral (`p-menu`, une section affichée à la fois), sur les sections API et Administration existantes ;
- la section Interface : rangée Langue (`p-select`) et rangée Signal sonore (`p-toggleswitch`), enregistrées sur l'événement de changement, jamais par un `effect`.

Aucun changement côté sidecar.

**Tech Stack:** Angular 22 (signals, Signal Forms), PrimeNG 22 (`Menu`, `Select`, `ToggleSwitch`), ngx-translate 18, `@tauri-apps/plugin-store`, Vitest. Fixtures `sidecarStub`, `storeStub`, `translateWith`, `hostOf`.

**Spec:** `docs/superpowers/specs/settings/02-langue-et-signal-sonore-design.md`

## Global Constraints

- **Clé de store** : `language`, valeur `"fr"`, `"en"` ou absente. Fichier `preferences.json`, comme les autres préférences.
- **Sections** : identifiants `api`, `interface`, `admin`, dans cet ordre ; libellés du menu `settings.<section>.title`. Le sub-project 03 insère `matching` entre `api` et `interface`.
- **Aucun enregistrement sans geste** : la langue s'écrit sur l'événement `onChange` du select, le son sur celui de la bascule. Monter la page n'écrit rien.
- **Une section à la fois, la page ne défile pas** (DESIGN.md § Structure de Page, décision du spec).
- **Libellés** : tout passe par ngx-translate, les deux fichiers de langue dans le même commit, une phrase par ligne (`\n`), espace insécable avant `:` en français, vouvoiement.
- **Commentaires TypeScript sans accents**, comme le code existant, le pourquoi seulement.
- **Tests** : noms en anglais, AAA, aucun test de plomberie PrimeNG ou ngx-translate (no-lib-test). Le store est mocké par `vi.mock("@tauri-apps/plugin-store")`, indisponible par défaut comme hors Tauri.
- **Gate vert à chaque commit** : `just format-ui && just lint-ui && just typecheck-ui && just test-ui`. Commits `type(scope): description`, scope `settings`.
- **Numéros de ligne des docs** : relevés le 2026-10-14, avant le sub-project 01 qui édite `ARCHITECTURE.md`. Chercher le texte cité, pas la ligne.

## Review Focus

- **Store indisponible (`just dev-ui`)** : choisir une langue l'applique à la session sans lever (Task 3, `switches the language even when the store is unavailable`).
- **Préférence éditée à la main avec une langue inconnue** : retombe sur la locale système (Task 1, `ignores a stored language the application does not offer`).
- **Ouvrir les Réglages** : n'enregistre ni langue ni son (Task 3, `stores nothing when the page opens`).
- **Changer de langue avec le menu affiché** : les entrées du menu se retraduisent (Task 3, `translates the menu again once the language changes`).
- **Erreur d'une rangée masquée par le menu** : elle réapparaît quand sa section est rouverte (Task 2, `shows a key storage error again once its section is reopened`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/platform/preferences.ts` | Préférence `language` |
| `src/app/core/i18n/language.ts` | `resolveStartupLanguage` |
| `src/app/app.config.ts` | Initialiseur de langue |
| `src/app/features/settings/settings-page.component.ts` | Section active, menu, langue, son |
| `src/app/features/settings/settings-page.component.html` | Grille menu et section, section Interface |
| `src/app/features/settings/settings-page.component.spec.ts` | Menu, langue, son |
| `src/app/core/platform/preferences.spec.ts`, `src/app/core/i18n/language.spec.ts` | Préférence et démarrage |
| `public/i18n/{fr,en}.json` | `settings.interface.*` |
| `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCTION.md` | Layout, Mapping, préférences |

---

### Task 1: Langue choisie au démarrage

**Files:**
- Modify: `src/app/core/platform/preferences.ts`
- Modify: `src/app/core/i18n/language.ts`
- Modify: `src/app/app.config.ts`
- Test: `src/app/core/platform/preferences.spec.ts`, `src/app/core/i18n/language.spec.ts`

**Interfaces:**
- Consumes: `definePreference` (privé à `preferences.ts`), `LANGUAGES`, `Language`, `resolveInitialLanguage`.
- Produces :
  - `readLanguage(): Promise<Language | null>`, `writeLanguage(value: Language | null): Promise<void>` ;
  - `resolveStartupLanguage(readStored: () => Promise<Language | null>, resolveSystem?: () => Promise<Language>): Promise<Language>`. `readStored` sans défaut : `language.ts` n'importe pas `preferences.ts`, qui importe déjà `LANGUAGES` de lui (pas de cycle).

- [ ] **Step 1: Écrire les tests**

Dans `src/app/core/platform/preferences.spec.ts`, ajouter `readLanguage` à l'import de `./preferences`, puis à la fin du `describe` :

```typescript
  it("ignores a stored language the application does not offer", async () => {
    vi.mocked(load).mockResolvedValue(storeStub("de"))

    const result = await readLanguage()

    expect(result).toBeNull()
  })
```

Dans `src/app/core/i18n/language.spec.ts`, ajouter `resolveStartupLanguage` à l'import de `./language`, puis en fin de fichier :

```typescript
describe("resolveStartupLanguage", () => {
  it("prefers the language chosen in the settings over the system locale", async () => {
    const language = await resolveStartupLanguage(
      () => Promise.resolve("en"),
      () => Promise.resolve("fr"),
    )

    expect(language).toBe("en")
  })

  it("lets the system locale decide until a language is chosen", async () => {
    const language = await resolveStartupLanguage(
      () => Promise.resolve(null),
      () => Promise.resolve("fr"),
    )

    expect(language).toBe("fr")
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Module './preferences' has no exported member 'readLanguage'` et `Module './language' has no exported member 'resolveStartupLanguage'`.

- [ ] **Step 3: Implémenter**

Dans `src/app/core/platform/preferences.ts`, ajouter l'import de type après celui d'`ExtractionMode` :

```typescript
import { LANGUAGES, type Language } from "../i18n/language"
```

`LANGUAGES` est une valeur : l'import n'est pas `import type`. Le sens inverse n'existe pas : `language.ts` n'importe rien de `preferences.ts`.

Après `lastDestination` :

```typescript
const language = definePreference<Language | null>(
  "language",
  null,
  (stored): stored is Language => LANGUAGES.some((known) => known === stored),
)
```

Remplacer les exports du son et ajouter ceux de la langue :

```typescript
export const readSoundSignal = soundSignal.read
export const writeSoundSignal = soundSignal.write

/** `null` tant que l'utilisateur n'a rien choisi : la locale systeme decide alors. */
export const readLanguage = language.read
export const writeLanguage = language.write
```

Dans `src/app/core/i18n/language.ts`, en fin de fichier :

```typescript
/**
 * Le choix pose dans les Reglages, sinon la locale : il prime aux lancements suivants.
 * `readStored` est fourni par l'appelant : `preferences.ts` importe deja ce module.
 */
export const resolveStartupLanguage = async (
  readStored: () => Promise<Language | null>,
  resolveSystem: () => Promise<Language> = resolveInitialLanguage,
): Promise<Language> => (await readStored()) ?? (await resolveSystem())
```

Dans `src/app/app.config.ts`, remplacer `resolveInitialLanguage` par `resolveStartupLanguage` dans l'import de `./core/i18n/language`, ajouter `import { readLanguage } from "./core/platform/preferences"`, et dans l'initialiseur :

```typescript
      await firstValueFrom(translate.use(await resolveStartupLanguage(readLanguage)))
```

- [ ] **Step 4: Vérifier le passage**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/core/i18n/language.spec.ts --include=src/app/core/platform/preferences.spec.ts`
Expected: PASS.

- [ ] **Step 5: Gate et commit**

```bash
just format-ui && just lint-ui && just typecheck-ui && just test-ui
git add src/app/core/platform/preferences.ts src/app/core/platform/preferences.spec.ts src/app/core/i18n/language.ts src/app/core/i18n/language.spec.ts src/app/app.config.ts
git commit -m "feat(settings): langue choisie prioritaire au démarrage"
```

---

### Task 2: Réglages en menu latéral

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts`
- Modify: `src/app/features/settings/settings-page.component.html`
- Test: `src/app/features/settings/settings-page.component.spec.ts`
- Modify: `docs/DESIGN.md` (§ Mapping, l.33 ; § Structure de Page déjà à jour)

**Interfaces:**
- Consumes: `TranslateService.currentLang()`, `TranslateService.instant()`.
- Produces :
  - `export type SettingsSection = "api" | "admin"` (étendu en Task 3) ;
  - `SettingsPageComponent.section: WritableSignal<SettingsSection>` (protégé), `menuItems: Signal<MenuItem[]>` (protégé, chaque item porte `id: "settings-section-<section>"`).

- [ ] **Step 1: Écrire les tests**

Dans `src/app/features/settings/settings-page.component.spec.ts` :

Ajouter `type SettingsSection` à l'import du composant :

```typescript
import SettingsPageComponent, {
  STORED_KEY_MASK,
  type SettingsSection,
} from "./settings-page.component"
```

Remplacer `mountWith` :

```typescript
const mountWith = (overrides: SidecarStubOverrides = {}, section: SettingsSection = "api") => {
  const service = sidecarStub({ apiKeyConfigured: signal<boolean | null>(false), ...overrides })

  TestBed.configureTestingModule({
    imports: [SettingsPageComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      ConfirmationService,
      { provide: SidecarService, useValue: service },
    ],
  })

  const fixture = TestBed.createComponent(SettingsPageComponent)
  fixture.componentInstance["section"].set(section)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

/** Ouvre une section comme le menu : par la commande de son entree. */
const openSection = (
  component: SettingsPageComponent,
  section: SettingsSection,
): void => {
  component["menuItems"]()
    .find((item) => item.id === `settings-section-${section}`)
    ?.command?.({})
}
```

Passer `"admin"` en second argument de `mountWith` dans les tests qui interrogent le DOM de la section Administration :
- `asks for the last undoable run and names it` ;
- `renders the raw date of a run whose date cannot be parsed` ;
- `blocks the undo while $name is in progress` ;
- dans `describe("past runs")` : `opens the summary of the chosen run`, `names the selector after the row label`, `$case` (enable/disable) ;
- `shows the files left as they were and the rollback error`.

Le cas paramétré `%s` (`waits for the target…`) cherche une ligne absente : lui passer aussi `"admin"`, sans quoi son assertion `toBeNull()` passerait pour une mauvaise raison.

Ajouter avant `describe("past runs")` :

```typescript
  it("shows the API section first", () => {
    const { fixture } = mountWith()

    const host = hostOf(fixture)

    expect(host.querySelector("input#api-key")).not.toBeNull()
    expect(host.querySelector('[data-action="restore-last"]')).toBeNull()
  })

  it("shows only the section chosen in the menu", () => {
    const { fixture, component } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })

    openSection(component, "admin")
    fixture.detectChanges()

    const host = hostOf(fixture)
    expect(host.querySelector('[data-action="restore-last"]')).not.toBeNull()
    expect(host.querySelector("input#api-key")).toBeNull()
  })

  it("shows a key storage error again once its section is reopened", () => {
    const { fixture, component } = mountWith(commandFailed("set_api_key", "api_key_not_stored"))
    openSection(component, "admin")
    fixture.detectChanges()

    openSection(component, "api")
    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-error-message")).not.toBeNull()
  })
```

- [ ] **Step 2: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Module './settings-page.component' has no exported member 'SettingsSection'`.

- [ ] **Step 3: Implémenter le composant**

Dans `src/app/features/settings/settings-page.component.ts` :
- ajouter les imports `import type { MenuItem } from "primeng/api"` et `import { Menu } from "primeng/menu"`, et `Menu` aux `imports` du `@Component` (après `Label`) ;
- ajouter après `STORED_KEY_MASK` :

```typescript
export type SettingsSection = "api" | "admin"

/** Ordre du menu, celui de la maquette ; une section sans rangee n'y entre pas. */
const SECTIONS: readonly SettingsSection[] = ["api", "admin"]
```

- ajouter en tête des champs de la classe, après les injections :

```typescript
  /**
   * Une section a la fois : neuf rangees ne tiennent pas au plancher de 700px, et la page ne
   * defile pas (DESIGN.md § Structure de Page). Locale : aucun lien ne vise une section.
   */
  protected readonly section = signal<SettingsSection>("api")
  protected readonly menuItems = computed<MenuItem[]>(() => {
    // `currentLang()` est lu ici : le menu se retraduit au changement de langue.
    this.translate.currentLang()
    const active = this.section()

    return SECTIONS.map((section) => ({
      id: `settings-section-${section}`,
      label: this.translate.instant(`settings.${section}.title`) as string,
      styleClass: section === active ? "bg-emphasis rounded-border" : undefined,
      command: () => {
        this.section.set(section)
      },
    }))
  })
```

- [ ] **Step 4: Implémenter le gabarit**

Dans `src/app/features/settings/settings-page.component.html`, garder le `h1`, puis envelopper les deux `<section>` existantes ainsi (leur contenu ne change pas) :

```html
<!-- Colonne du menu a sa propre largeur : celle du composant, plus large seulement si un
     libelle l'exige. -->
<div class="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-6">
  <p-menu class="self-start" [model]="menuItems()" />

  @switch (section()) {
    @case ("api") {
      <section class="flex flex-col gap-4">
        <!-- contenu actuel de la section API, inchange -->
      </section>
    }
    @case ("admin") {
      <section class="flex flex-col gap-4">
        <!-- contenu actuel de la section Administration, inchange -->
      </section>
    }
  }
</div>

<app-danger-confirm />
```

Les deux commentaires `contenu actuel… inchange` désignent les blocs existants à déplacer tels quels, pas du texte à écrire.

- [ ] **Step 5: Vérifier le passage**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/features/settings/settings-page.component.spec.ts`
Expected: PASS.

- [ ] **Step 6: Contrôler la fenêtre**

Lancer `just dev` (skill `dev-server`), réduire la fenêtre à 1024 × 700, ouvrir Réglages : menu à gauche, API affichée, Administration au clic sans défilement, entrée active marquée. Vérifier que la colonne du menu ne coupe pas « Administration ».

- [ ] **Step 7: Mettre à jour DESIGN.md**

- § Structure de Page : la ligne « Réglages » (menu des sections, une section à la fois) est déjà posée, écrite le 2026-10-14 au réalignement de la maquette. Vérifier qu'elle décrit ce qui est livré, sans la réécrire.
- § Mapping, famille de la Navigation principale (l.196), ajouter : `| Navigation des Réglages | \`p-menu\`, une entrée par section, l'active en \`bg-emphasis\` | PrimeNG | Une section affichée à la fois (§ Structure de Page) |`.
- l.33 : la cellule nomme les sections « API » et « Administration » des Réglages ; les nommer comme titres de section des Réglages, affichées une à la fois.

- [ ] **Step 8: Gate et commit**

```bash
just format-ui && just lint-ui && just typecheck-ui && just test-ui
git add src/app/features/settings/settings-page.component.ts src/app/features/settings/settings-page.component.html src/app/features/settings/settings-page.component.spec.ts docs/DESIGN.md
git commit -m "feat(settings): réglages en menu latéral, une section à la fois"
```

---

### Task 3: Section Interface, langue et signal sonore

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts`
- Modify: `src/app/features/settings/settings-page.component.html`
- Test: `src/app/features/settings/settings-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `docs/DESIGN.md` (§ Mapping, Post-MVP), `docs/ARCHITECTURE.md` (l.385, l.414), `docs/PRODUCTION.md` (l.242)

**Interfaces:**
- Consumes: `readSoundSignal`, `writeSoundSignal`, `writeLanguage` (Task 1), `LANGUAGES`, `Language`, `languageFromTag` ; `section`, `menuItems`, `SECTIONS` (Task 2).
- Produces :
  - `SettingsSection` étendu : `"api" | "interface" | "admin"` ;
  - `chooseLanguage(language: Language): void`, `chooseSound(enabled: boolean): void` (protégés) ;
  - `languageChoice`, `soundChoice` (modèles Signal Forms, protégés).

- [ ] **Step 1: Écrire les tests**

Dans `src/app/features/settings/settings-page.component.spec.ts`, ajouter en tête :

```typescript
import { TranslateService } from "@ngx-translate/core"
import { load } from "@tauri-apps/plugin-store"

import { storeStub } from "../../../fixtures/tauri-store"
```

(fusionner `TranslateService` dans l'import existant de `@ngx-translate/core`), puis après les imports :

```typescript
/** Store indisponible par defaut, comme hors Tauri, sauf quand un test fournit le sien. */
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() => Promise.reject(new TypeError("store unavailable"))),
}))
```

Ajouter à la fin du `describe("SettingsPageComponent")` :

```typescript
  describe("interface", () => {
    it("switches the language and stores the choice", async () => {
      const store = storeStub()
      vi.mocked(load).mockResolvedValue(store)
      const { component } = mountWith({}, "interface")

      component["chooseLanguage"]("en")

      expect(TestBed.inject(TranslateService).getCurrentLang()).toBe("en")
      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("language", "en")
      })
    })

    it("switches the language even when the store is unavailable", () => {
      const { component } = mountWith({}, "interface")

      component["chooseLanguage"]("en")

      expect(TestBed.inject(TranslateService).getCurrentLang()).toBe("en")
    })

    it("stores nothing when the page opens", async () => {
      const store = storeStub(true)
      vi.mocked(load).mockResolvedValue(store)

      mountWith({}, "interface")

      // Le montage a bien lu le store : l'absence d'ecriture n'est pas une lecture manquee.
      await vi.waitFor(() => {
        expect(store.get).toHaveBeenCalled()
      })
      expect(store.set).not.toHaveBeenCalled()
    })

    it("translates the menu again once the language changes", () => {
      const { component } = mountWith()
      const translate = TestBed.inject(TranslateService)
      translate.setTranslation("fr", { settings: { admin: { title: "Administration" } } })
      translate.setTranslation("en", { settings: { admin: { title: "Admin" } } })
      translate.use("fr")

      component["chooseLanguage"]("en")

      const admin = component["menuItems"]().find((item) => item.id === "settings-section-admin")
      expect(admin?.label).toBe("Admin")
    })

    it("stores a muted completion sound", async () => {
      const store = storeStub(true)
      vi.mocked(load).mockResolvedValue(store)
      const { component } = mountWith({}, "interface")

      component["chooseSound"](false)

      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("sound_signal", false)
      })
    })

    it("shows the completion sound as stored", async () => {
      vi.mocked(load).mockResolvedValue(storeStub(false))

      const { component } = mountWith({}, "interface")

      // La lecture est une promesse que `whenStable` ne suit pas.
      await vi.waitFor(() => {
        expect(component["soundChoice"]().enabled).toBe(false)
      })
    })
  })
```

- [ ] **Step 2: Vérifier l'échec**

Run: `just typecheck-ui`
Expected: FAIL, `Argument of type '"interface"' is not assignable to parameter of type 'SettingsSection'` et `Property 'chooseLanguage' does not exist`.

- [ ] **Step 3: Implémenter le composant**

Dans `src/app/features/settings/settings-page.component.ts` :
- imports : `import { ToggleSwitch } from "primeng/toggleswitch"` (et `ToggleSwitch` aux `imports` du `@Component`, après `Tooltip`) ; `import { LANGUAGES, type Language, languageFromTag } from "../../core/i18n/language"` ; `import { DEFAULT_SOUND_SIGNAL, readSoundSignal, writeLanguage, writeSoundSignal } from "../../core/platform/preferences"` ;
- étendre les sections :

```typescript
export type SettingsSection = "api" | "interface" | "admin"

/** Ordre du menu, celui de la maquette ; une section sans rangee n'y entre pas. */
const SECTIONS: readonly SettingsSection[] = ["api", "interface", "admin"]
```

- ajouter les interfaces, après `PastRunChoice` :

```typescript
interface LanguageOption {
  readonly value: Language
  readonly label: string
}

interface LanguageChoice {
  language: Language
}

interface SoundChoice {
  enabled: boolean
}
```

- ajouter les champs, après `menuItems` :

```typescript
  /** Chaque langue se nomme dans sa propre langue, quelle que soit celle de l'interface. */
  protected readonly languageOptions = computed<LanguageOption[]>(() => {
    this.translate.currentLang()

    return LANGUAGES.map((value) => ({
      value,
      label: this.translate.instant(`settings.interface.language.options.${value}`) as string,
    }))
  })
  /** Suit la langue courante ; seul `chooseLanguage` en fait un choix enregistre. */
  protected readonly languageChoice = linkedSignal<LanguageChoice>(() => ({
    language: languageFromTag(this.translate.currentLang()),
  }))
  protected readonly languageFields = form(this.languageChoice)
  protected readonly soundChoice = signal<SoundChoice>({ enabled: DEFAULT_SOUND_SIGNAL })
  protected readonly soundFields = form(this.soundChoice)
```

- dans le constructeur, après l'`effect` existant :

```typescript
    // Lu au montage, jamais ecrit : seule la bascule enregistre un choix.
    void readSoundSignal().then((enabled) => {
      this.soundChoice.set({ enabled })
    })
```

- ajouter les méthodes, après `openPastRun` :

```typescript
  /**
   * Sur l'evenement du select, jamais par un `effect` : celui-ci enregistrerait au premier
   * rendu la langue detectee, qui deviendrait un choix fige.
   */
  protected chooseLanguage(language: Language): void {
    this.translate.use(language)
    void writeLanguage(language)
  }

  /** `CompletionSignalService` relit la preference a chaque annonce : rien d'autre a prevenir. */
  protected chooseSound(enabled: boolean): void {
    void writeSoundSignal(enabled)
  }
```

`translate.use()` bascule sans souscription : l'appel suffit, la langue étant déjà chargée ou chargée par lui.

- [ ] **Step 4: Implémenter le gabarit**

Dans `settings-page.component.html`, ajouter le cas entre `@case ("api")` et `@case ("admin")` :

```html
    @case ("interface") {
      <section class="flex flex-col gap-4">
        <h2 class="text-xl font-semibold">{{ "settings.interface.title" | translate }}</h2>

        <app-settings-row>
          <span rowLabel id="language-label" class="text-sm">{{
            "settings.interface.language.label" | translate
          }}</span>

          <div rowControl class="flex items-center">
            <!-- Largeur figee : sinon le select change de taille d'une langue a l'autre. Mesuree
                 sur « Francais », le plus long des deux noms, identiques en FR et en EN. -->
            <p-select
              class="w-36"
              size="small"
              data-field="language"
              ariaLabelledBy="language-label"
              [formField]="languageFields.language"
              [options]="languageOptions()"
              optionLabel="label"
              optionValue="value"
              (onChange)="chooseLanguage($event.value)"
            />
          </div>

          <span class="text-xs text-pretty whitespace-pre-line text-muted-color">{{
            "settings.interface.language.hint" | translate
          }}</span>
        </app-settings-row>

        <app-settings-row>
          <span rowLabel id="sound-label" class="text-sm">{{
            "settings.interface.sound.label" | translate
          }}</span>

          <!-- Sans champ, l'aide prend la place du controle, sur la ligne de la bascule. -->
          <div rowControl class="flex min-w-0 items-center justify-between gap-4">
            <span class="text-xs text-pretty whitespace-pre-line text-muted-color">{{
              "settings.interface.sound.hint" | translate
            }}</span>
            <p-toggleswitch
              class="shrink-0"
              data-field="sound"
              ariaLabelledBy="sound-label"
              [formField]="soundFields.enabled"
              (onChange)="chooseSound($event.checked)"
            />
          </div>
        </app-settings-row>
      </section>
    }
```

Remesurer `w-36` dans la fenêtre sur « Français » (Step 7) : la valeur se corrige au besoin, le commentaire reste.

Dans `public/i18n/fr.json`, entre `"api": {…}` et `"admin": {` du bloc `settings` :

```json
    "interface": {
      "title": "Interface",
      "language": {
        "label": "Langue",
        "hint": "S'applique immédiatement.\nAu premier lancement, l'application suit la langue du système.",
        "options": {
          "fr": "Français",
          "en": "English"
        }
      },
      "sound": {
        "label": "Signal sonore de fin",
        "hint": "Un bip à la fin d'une extraction, d'une recherche, d'une écriture ou d'une restauration."
      }
    },
```

Dans `public/i18n/en.json`, au même endroit :

```json
    "interface": {
      "title": "Interface",
      "language": {
        "label": "Language",
        "hint": "Applies immediately.\nOn first launch, the application follows the system language.",
        "options": {
          "fr": "Français",
          "en": "English"
        }
      },
      "sound": {
        "label": "Completion sound",
        "hint": "A beep when an extraction, a search, a write or a restore ends."
      }
    },
```

- [ ] **Step 5: Vérifier le passage**

Run: `just typecheck-ui && pnpm exec ng test --watch=false --include=src/app/features/settings/settings-page.component.spec.ts --include=src/app/core/i18n/translations.spec.ts`
Expected: PASS.

- [ ] **Step 6: Mettre à jour les docs**

- `docs/DESIGN.md` : retirer de « Post-MVP (non installés) » les lignes Langue (l.311) et Bascules des Réglages (l.312), et les poser dans le Mapping, famille des champs (à côté de Runs passés, l.231) :
  - `| Langue | \`p-select\` \`size="small"\`, largeur figée mesurée sur « Français » | PrimeNG | Force la locale détectée au premier lancement ; enregistrée au changement, jamais à l'ouverture |`
  - `| Bascules des Réglages | \`p-toggleswitch\`, à droite, aide sur sa ligne | PrimeNG | Signal sonore de fin. Le mode copie / déplacement reste sur Playlist |`
- `docs/ARCHITECTURE.md` :
  - l.385 (`store`) : « langue et seuils à l'étape 8 » devient « langue (`language`, `null` tant que rien n'est choisi) ; seuils à l'étape 8 » ;
  - l.414 (`features/settings/`) : « Onglet 3 : menu des sections ; clé API, langue, signal sonore, runs passés, restauration. Seuils, cache et logs : étape 8, pas encore câblés » (« copie ou déplacement » retiré, il reste sur Playlist).
- `docs/PRODUCTION.md` l.242 : ajouter « langue » à la liste des préférences du store Tauri dans le tableau de la configuration runtime.

- [ ] **Step 7: Contrôler la fenêtre**

`just dev`, fenêtre à 1024 × 700, section Interface :
- choisir « English » : l'interface bascule, menu compris ; relancer l'application : elle reste en anglais ;
- couper le son, lancer une extraction courte : toast de fin, aucun bip ;
- le select ne change pas de largeur entre « Français » et « English ».

- [ ] **Step 8: Gate et commit**

```bash
just format-ui && just lint-ui && just typecheck-ui && just test-ui
git add src/app/features/settings/settings-page.component.ts src/app/features/settings/settings-page.component.html src/app/features/settings/settings-page.component.spec.ts public/i18n/fr.json public/i18n/en.json docs/DESIGN.md docs/ARCHITECTURE.md docs/PRODUCTION.md
git commit -m "feat(settings): langue et signal sonore dans les réglages"
```
