# Câblage i18n et résolution de la langue initiale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'interface traduisible dès son premier écran, pour qu'aucun libellé n'ait à être repris ensuite.

**Architecture:** Une fonction pure porte la règle de correspondance entre un tag BCP-47 et une langue, une fonction asynchrone compose les trois sources de langue, et un initializer applicatif pose la langue avant le premier rendu. Les sources sont passées en paramètres, ce qui rend la chaîne de repli testable sans lancer Tauri ni simuler un navigateur.

**Tech Stack:** Angular 22, ngx-translate 18, `@tauri-apps/plugin-os` 2.3.2, Vitest.

**Spec:** `docs/superpowers/specs/onglet-playlist-extraction-selective/05-cablage-i18n-design.md`

## Global Constraints

- **Angular 22** : `HttpClient` est fourni d'office, `provideHttpClient()` ne s'ajoute pas ; `strictTemplates` est activé ; le mode zoneless est le défaut.
- **ngx-translate v18** : ni `TranslateModule` ni `setDefaultLang()`, qui n'existent plus. `fallbackLang` remplace `defaultLang`, `setFallbackLang()` remplace `setDefaultLang()`. `currentLang` est un `Signal<Language | null>`, à lire avec des parenthèses.
- **`TranslatePipe` s'importe composant par composant**, il n'y a plus de module.
- **`failOnError: true` en développement** : sans lui, un `prefix` erroné produit une interface de clés brutes avec un simple avertissement.
- **Aucun libellé en dur ne subsiste** dans les templates touchés (DESIGN.md § Conventions de Code), et aucune largeur fixe n'est posée sur du texte traduit.
- **Le vocabulaire technique ne se traduit pas** : « Playlist » et « Tagging » restent identiques en français, seul « Settings » devient « Réglages ».
- **Les deux fichiers de langue portent exactement les mêmes clés**, dans le même commit.
- **Aucune permission Tauri à ajouter** : `os:allow-locale` est déjà déclaré.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`.
- **Convention de commit** : `type(scope): description`, scope `ui`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/language.ts` | Type de langue, règle de correspondance BCP-47, composition des trois sources. Aucune dépendance Angular. |
| `src/app/core/language.spec.ts` | Règle de correspondance et chaîne de repli. |
| `public/i18n/fr.json` et `public/i18n/en.json` | Libellés, structurés par feature. |
| `src/app/core/translations.spec.ts` | Cohérence des clés entre les deux fichiers de langue. |
| `src/app/app.config.ts` | Providers ngx-translate et initializer de langue. |
| `src/app/app.component.html` / `.ts` | Libellés des trois onglets. |
| `src/app/features/*/​*-page.component.html` / `.ts` | Titre de chaque écran. |

---

## Task 1: Règle de langue et chaîne de repli

**Files:**
- Create: `src/app/core/language.ts`
- Test: `src/app/core/language.spec.ts`

**Interfaces:**
- Consumes: `locale` de `@tauri-apps/plugin-os` (déjà installé)
- Produces:
  - `LANGUAGES: readonly ["fr", "en"]`, `type Language = "fr" | "en"`, `FALLBACK_LANGUAGE: Language`
  - `languageFromTag(tag: string | null | undefined): Language`
  - `resolveInitialLanguage(readSystemLocale?, readBrowserLanguage?): Promise<Language>`

- [ ] **Step 1: Écrire les tests**

Les sources sont injectées en paramètres plutôt que mockées au niveau du module : la rule de test du projet demande de mocker à la frontière qu'on expose, pas les plugins Tauri sous-jacents.

Créer `src/app/core/language.spec.ts` :

```typescript
import { FALLBACK_LANGUAGE, languageFromTag, resolveInitialLanguage } from "./language"

/**
 * La composition locale systeme -> langue n'est documentee ni cote Tauri ni cote
 * ngx-translate : c'est une regle du projet, donc a couvrir ici.
 */
describe("languageFromTag", () => {
  it("resolves French from a regional tag", () => {
    expect(languageFromTag("fr-FR")).toBe("fr")
  })

  it("resolves French from a tag without region", () => {
    expect(languageFromTag("fr")).toBe("fr")
  })

  it("matches on the prefix, not on equality", () => {
    expect(languageFromTag("fr-BE")).toBe("fr")
    expect(languageFromTag("fr-Latn-FR")).toBe("fr")
  })

  it("resolves English for any other language", () => {
    expect(languageFromTag("de-DE")).toBe("en")
    expect(languageFromTag("en-US")).toBe("en")
  })

  it("ignores the tag case", () => {
    expect(languageFromTag("FR-fr")).toBe("fr")
  })

  it("resolves English for a missing or empty value", () => {
    expect(languageFromTag(null)).toBe(FALLBACK_LANGUAGE)
    expect(languageFromTag(undefined)).toBe(FALLBACK_LANGUAGE)
    expect(languageFromTag("")).toBe(FALLBACK_LANGUAGE)
  })
})

describe("resolveInitialLanguage", () => {
  it("prefers the system locale when it answers", async () => {
    const language = await resolveInitialLanguage(
      async () => "fr-FR",
      () => "de-DE",
    )

    expect(language).toBe("fr")
  })

  it("falls back to the browser when the system locale is null", async () => {
    const language = await resolveInitialLanguage(
      async () => null,
      () => "fr-BE",
    )

    expect(language).toBe("fr")
  })

  it("falls back to the browser when the Tauri call rejects", async () => {
    const language = await resolveInitialLanguage(
      () => Promise.reject(new TypeError("__TAURI_INTERNALS__ is undefined")),
      () => "fr-FR",
    )

    expect(language).toBe("fr")
  })

  it("falls back to English when no source answers", async () => {
    const language = await resolveInitialLanguage(
      () => Promise.reject(new TypeError("hors Tauri")),
      () => "",
    )

    expect(language).toBe(FALLBACK_LANGUAGE)
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm test --run src/app/core/language.spec.ts`
Expected: FAIL, le module `./language` n'existe pas

- [ ] **Step 3: Écrire le module**

Créer `src/app/core/language.ts` :

```typescript
import { locale } from "@tauri-apps/plugin-os"

export const LANGUAGES = ["fr", "en"] as const

export type Language = (typeof LANGUAGES)[number]

/** L'anglais couvre tout ce qui n'est pas explicitement francais. */
export const FALLBACK_LANGUAGE: Language = "en"

const FRENCH_PREFIX = "fr"

/**
 * Traduit un tag BCP-47 en langue de l'interface.
 *
 * La comparaison porte sur le prefixe et non sur l'egalite : `fr`, `fr-FR`,
 * `fr-BE` et `fr-Latn-FR` doivent tous donner le francais.
 */
export function languageFromTag(tag: string | null | undefined): Language {
  return tag?.toLowerCase().startsWith(FRENCH_PREFIX) ? "fr" : FALLBACK_LANGUAGE
}

/**
 * Resout la langue du premier lancement, en consultant trois sources dans l'ordre.
 *
 * La locale systeme de Tauri d'abord, puis celle du navigateur, puis l'anglais.
 * Le deuxieme niveau existe parce que `invoke()` appelle `window.__TAURI_INTERNALS__`
 * sans garde : hors Tauri, sous le `ng serve` seul de `just dev-ui`, l'appel rejette
 * avec une `TypeError`. Sans ce repli, l'interface passerait en anglais sur une
 * machine francaise des qu'on developpe la webview seule.
 *
 * Les deux sources sont injectables pour que la chaine se teste sans lancer Tauri.
 */
export async function resolveInitialLanguage(
  readSystemLocale: () => Promise<string | null> = locale,
  readBrowserLanguage: () => string = () => navigator.language,
): Promise<Language> {
  try {
    const systemLocale = await readSystemLocale()
    if (systemLocale) {
      return languageFromTag(systemLocale)
    }
  } catch {
    // Hors Tauri : on passe au navigateur, ce n'est pas une panne.
  }

  return languageFromTag(readBrowserLanguage())
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `pnpm test --run src/app/core/language.spec.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add src/app/core/language.ts src/app/core/language.spec.ts
git commit -m "feat(ui): resolution de la langue initiale depuis la locale systeme"
```

---

## Task 2: Fichiers de langue et providers

**Files:**
- Create: `public/i18n/fr.json`
- Create: `public/i18n/en.json`
- Create: `src/app/core/translations.spec.ts`
- Modify: `src/app/app.config.ts`

**Interfaces:**
- Consumes: `resolveInitialLanguage` et `Language` de la Task 1
- Produces: un `TranslateService` configuré, langue posée avant le premier rendu

- [ ] **Step 1: Écrire les fichiers de langue**

Les clés reprennent les libellés aujourd'hui en dur, structurées par feature en miroir de l'arborescence des composants. « Playlist » et « Tagging » ne se traduisent pas, ce sont des termes techniques.

Créer `public/i18n/en.json` :

```json
{
  "nav": {
    "playlist": "Playlist",
    "tagging": "Tagging",
    "settings": "Settings"
  },
  "playlist": {
    "title": "Playlist"
  },
  "tagging": {
    "title": "Tagging"
  },
  "settings": {
    "title": "Settings"
  }
}
```

Créer `public/i18n/fr.json` :

```json
{
  "nav": {
    "playlist": "Playlist",
    "tagging": "Tagging",
    "settings": "Réglages"
  },
  "playlist": {
    "title": "Playlist"
  },
  "tagging": {
    "title": "Tagging"
  },
  "settings": {
    "title": "Réglages"
  }
}
```

- [ ] **Step 2: Écrire le test qui garde les deux fichiers synchronisés**

Une clé ajoutée d'un seul côté produit du texte anglais au milieu d'une interface française, sans que rien ne casse ni ne se voie. C'est exactement le cas qu'un test de cohérence entre deux manifestes du dépôt couvre.

Créer `src/app/core/translations.spec.ts` :

```typescript
import en from "../../../public/i18n/en.json"
import fr from "../../../public/i18n/fr.json"

/**
 * Les deux fichiers de langue se maintiennent a la main : rien n'empeche d'en
 * enrichir un seul, et le manque ne se verrait qu'a l'ecran, sur une cle brute.
 */
describe("language files", () => {
  function leaves(source: object, prefix = ""): [string, unknown][] {
    return Object.entries(source).flatMap(([key, value]) =>
      typeof value === "object" && value !== null
        ? leaves(value as object, `${prefix}${key}.`)
        : ([[`${prefix}${key}`, value]] as [string, unknown][]),
    )
  }

  function flatten(source: object): string[] {
    return leaves(source).map(([key]) => key)
  }

  it("carry exactly the same keys", () => {
    expect(flatten(fr).sort()).toEqual(flatten(en).sort())
  })

  it("leave no empty value at any depth", () => {
    const empties = [...leaves(fr), ...leaves(en)].filter(([, value]) => value === "")

    expect(empties).toEqual([])
  })
})
```

L'import d'un `.json` compile sans configuration : `tsconfig.json` pose `"module": "preserve"`, qui active `resolveJsonModule` par défaut depuis TypeScript 5.4. Ne rien ajouter.

- [ ] **Step 3: Lancer le test pour le voir passer**

Run: `pnpm test --run src/app/core/translations.spec.ts`
Expected: PASS, 2 tests

- [ ] **Step 4: Câbler les providers**

Dans `src/app/app.config.ts`, ajouter aux `providers` existants, après `providePrimeNG({...})` :

```typescript
    provideTranslateService({
      // `fallbackLang` et non `defaultLang` : renomme en v18.
      fallbackLang: FALLBACK_LANGUAGE,
      // Un fichier de traduction absent rend `{}` avec un simple avertissement,
      // donc un `prefix` errone produit une interface de cles brutes sans rien
      // signaler. En developpement, on veut l'erreur.
      failOnError: APP_ENVIRONMENT !== "production",
      loader: provideTranslateHttpLoader({ prefix: "/i18n/", suffix: ".json" }),
    }),
    // La langue est posee avant le premier rendu : `locale()` est asynchrone quand
    // les providers sont synchrones, et un rendu dans la mauvaise langue suivi
    // d'une bascule se voit a l'ecran.
    provideAppInitializer(async () => {
      const translate = inject(TranslateService)
      translate.addLangs([...LANGUAGES])
      await firstValueFrom(translate.use(await resolveInitialLanguage()))
    }),
```

Compléter les imports du fichier :

```typescript
import { ApplicationConfig, ErrorHandler, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from "@angular/core"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { provideTranslateHttpLoader } from "@ngx-translate/http-loader"
import { firstValueFrom } from "rxjs"

import { FALLBACK_LANGUAGE, LANGUAGES, resolveInitialLanguage } from "./core/language"
```

`APP_ENVIRONMENT` est déjà déclaré dans `src/build-constants.d.ts` et porte son repli inerte `'development'` dans le `define` d'`angular.json`, surchargé en `'production'` par le script `build` de `package.json`. Rien à ajouter de ce côté.

- [ ] **Step 5: Vérifier que l'application démarre et charge ses traductions**

Run: `just dev-ui`
Expected: l'application s'affiche sans erreur de console, et l'onglet réseau montre une requête réussie vers `/i18n/fr.json` ou `/i18n/en.json` selon la locale de la machine.

- [ ] **Step 6: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add public/i18n/fr.json public/i18n/en.json src/app/core/translations.spec.ts src/app/app.config.ts
git commit -m "feat(ui): cabler ngx-translate et poser les fichiers de langue"
```

---

## Task 3: Reprise des libellés dans les templates

**Files:**
- Modify: `src/app/app.component.html`, `src/app/app.component.ts`
- Modify: `src/app/features/playlist/playlist-page.component.html`, `.ts`
- Modify: `src/app/features/tagging/tagging-page.component.html`, `.ts`
- Modify: `src/app/features/settings/settings-page.component.html`, `.ts`

**Interfaces:**
- Consumes: les clés posées en Task 2
- Produces: quatre templates sans aucun libellé en dur

- [ ] **Step 1: Traduire les onglets**

Dans `src/app/app.component.html`, remplacer les trois `<p-tab>` :

```html
<!-- TODO: implement, deriver l'onglet actif de l'URL et naviguer sur
     valueChange, p-tabs n'ayant aucun mode router. -->
<p-tabs value="playlist">
  <p-tablist>
    <p-tab value="playlist">{{ "nav.playlist" | translate }}</p-tab>
    <p-tab value="tagging">{{ "nav.tagging" | translate }}</p-tab>
    <p-tab value="settings">{{ "nav.settings" | translate }}</p-tab>
  </p-tablist>
</p-tabs>

<router-outlet />
```

Le `TODO` conserve la dérivation de l'onglet actif depuis l'URL, hors scope ici, et perd sa mention des libellés, désormais faite.

Dans `src/app/app.component.ts`, ajouter `TranslatePipe` aux `imports` :

```typescript
import { Component } from "@angular/core"
import { RouterOutlet } from "@angular/router"
import { TranslatePipe } from "@ngx-translate/core"
import { Tab, TabList, Tabs } from "primeng/tabs"

@Component({
  selector: "app-root",
  imports: [RouterOutlet, Tabs, TabList, Tab, TranslatePipe],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {}
```

- [ ] **Step 2: Traduire le titre de l'écran Playlist**

Dans `src/app/features/playlist/playlist-page.component.html` :

```html
<!-- TODO: implement, regime formulaire (max-w-3xl) -->
<section class="mx-auto max-w-3xl p-4">
  <h1 class="text-2xl font-semibold">{{ "playlist.title" | translate }}</h1>
</section>
```

Dans `src/app/features/playlist/playlist-page.component.ts` :

```typescript
import { Component } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

@Component({
  selector: "app-playlist-page",
  imports: [TranslatePipe],
  templateUrl: "./playlist-page.component.html",
})
export default class PlaylistPageComponent {
  // TODO: implement, selection des dossiers source et destination, choix de la
  // playlist, mode copie ou deplacement, rapport d'extraction.
}
```

- [ ] **Step 3: Traduire le titre de l'écran Tagging**

Dans `src/app/features/tagging/tagging-page.component.html` :

```html
<!-- TODO: implement, regime donnees (pleine largeur) -->
<section class="p-4">
  <h1 class="text-2xl font-semibold">{{ "tagging.title" | translate }}</h1>
</section>
```

Dans `src/app/features/tagging/tagging-page.component.ts`, ajouter `imports: [TranslatePipe]` au décorateur et l'import `import { TranslatePipe } from "@ngx-translate/core"`, en conservant le reste du fichier tel quel.

- [ ] **Step 4: Traduire le titre de l'écran Settings**

Dans `src/app/features/settings/settings-page.component.html` :

```html
<!-- TODO: implement, regime formulaire (max-w-3xl) -->
<section class="mx-auto max-w-3xl p-4">
  <h1 class="text-2xl font-semibold">{{ "settings.title" | translate }}</h1>
</section>
```

Dans `src/app/features/settings/settings-page.component.ts`, ajouter `imports: [TranslatePipe]` au décorateur et l'import `import { TranslatePipe } from "@ngx-translate/core"`, en conservant le reste du fichier tel quel.

- [ ] **Step 5: Vérifier qu'aucun libellé en dur ne subsiste**

Run: `grep -rn ">Playlist<\|>Tagging<\|>Settings<" src/app --include="*.html"`
Expected: aucune correspondance

- [ ] **Step 6: Vérifier l'application dans les deux langues**

Run: `just dev-ui`
Expected: sur une machine française, les onglets affichent « Playlist », « Tagging », « Réglages » et l'écran courant son titre traduit. La bascule se vérifie en changeant la langue préférée du navigateur puis en rechargeant.

- [ ] **Step 7: Vérifier le gate qualité complet**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 8: Commit**

```bash
git add src/app/app.component.html src/app/app.component.ts src/app/features
git commit -m "feat(ui): passer les libelles des ecrans par ngx-translate"
```

---

## Vérification de l'état livré

L'incrément est complet quand `just test && just lint && just typecheck` rend les trois gates verts, que `just dev` affiche l'interface dans la langue de la machine, et que `grep -rn ">Playlist<\|>Tagging<\|>Settings<" src/app --include="*.html"` ne rend plus rien.

Les scénarios du spec sont couverts : locale française et non française, variante régionale, locale indisponible, exécution hors Tauri et absence totale de source (Task 1), libellés traduits à l'écran (Tasks 2 et 3), fichiers de langue synchronisés et sans valeur vide (Task 2).

Ce que ce sub-project ne fait pas : le sélecteur de langue et la persistance du choix dans le `store`, qui relèvent de la Feature 7 et primeront alors sur la locale système. La dérivation de l'onglet actif depuis l'URL reste également à faire, son `TODO` est conservé.
