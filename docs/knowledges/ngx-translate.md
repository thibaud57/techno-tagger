---
title: "ngx-translate — Internationalisation à l'exécution"
version: "18.0.0"
description: "Référence technique pour ngx-translate v18 : providers standalone, http-loader, fallbackLang, currentLang en Signal et bascule de langue sans rebuild."
date: "2026-08-29"
keywords: ["ngx-translate", "i18n", "angular", "signals", "standalone", "locale"]
scope: ["docs"]
technologies: ["Angular", "Tauri"]
---

# Description

Bibliothèque d'internationalisation qui charge les traductions à l'exécution. Français et anglais, **bascule sans rebuild**, choix initial dérivé de la locale système (cf. [ADR-004](../adrs/004-i18n-ngx-translate.md)).

C'est ce qui la distingue de l'i18n natif d'Angular, qui produit un bundle par langue : un utilisateur ne pourrait pas changer de langue sans réinstaller.

Cette fiche couvre `@ngx-translate/core` 18.0.0 et `@ngx-translate/http-loader` 18.0.0, dont les versions vont de pair.

---

# Concepts Clés

## Configuration standalone

### Description

`TranslateModule` et ses `forRoot()` / `forChild()` ont disparu en v18. La configuration passe par `provideTranslateService()`, et le chargeur par `provideTranslateHttpLoader()`.

### Exemple

```typescript
// app.config.ts
import { provideHttpClient } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideTranslateService({
      loader: provideTranslateHttpLoader({ prefix: '/i18n/', suffix: '.json' }),
      fallbackLang: 'en',
      lang: 'en',
    }),
  ],
};
```

### Points Importants

- **`provideHttpClient()` est requis** : sans lui, le loader ne peut pas récupérer les fichiers JSON
- **`provideTranslateHttpLoader({ prefix, suffix })` remplace le pattern `useFactory`** des versions antérieures
- Depuis Angular 18, `ng new` génère un dossier `public/` et non plus `src/assets/` : le `prefix` doit suivre l'arborescence réelle du projet
- Deux formes de configuration coexistent dans la doc (à plat et imbriquée) ; la forme imbriquée ci-dessus est celle qui prime en cas de conflit

---

## `fallbackLang` et non plus `defaultLang`

### Description

Le vocabulaire a changé en v18 : la langue de repli quand une clé manque s'appelle désormais `fallbackLang`.

### Exemple

```typescript
// v18
translate.setFallbackLang('en');
translate.onFallbackLangChange.subscribe(/* ... */);

// v17 et avant — n'existent plus
// translate.setDefaultLang('en');
// translate.onDefaultLangChange.subscribe(...);
```

### Points Importants

- **Renommages en cascade** : `defaultLang` → `fallbackLang`, `setDefaultLang()` → `setFallbackLang()`, `onDefaultLangChange` → `onFallbackLangChange`, `DefaultLangChangeEvent` → `FallbackLangChangeEvent`
- `useDefaultLang` a été supprimé de la configuration
- Un exemple copié d'un tutoriel antérieur à la v18 échoue à la compilation, ce qui est le bon symptôme : le renommage n'est pas silencieux

---

## `currentLang` en Signal

### Description

La langue courante est un Signal, lisible dans un template ou dans un `computed()`, sans abonnement RxJS.

### Exemple

```typescript
export class SettingsComponent {
  private readonly translate = inject(TranslateService);

  readonly isFrench = computed(() => this.translate.currentLang() === 'fr');

  switchTo(lang: 'fr' | 'en'): void {
    this.translate.use(lang);
  }
}
```

### Points Importants

- **`currentLang` s'appelle, elle ne se lit plus comme une propriété** : `currentLang()` et non `currentLang`. Un accès sans parenthèses rend la fonction elle-même, toujours truthy
- Son type est `Signal<Language | null>` : `null` avant le premier chargement
- `getCurrentLang()` peut rendre `null`, à traiter
- `isLoading` est également un Signal, utile pour un indicateur pendant le chargement d'une langue
- `translate.langs` a disparu au profit de `getLangs()`

---

## Compatibilité OnPush

### Description

Angular 22 fait d'OnPush la stratégie par défaut. La documentation de ngx-translate v18 présente le pipe et la directive comme pilotés par signals, donc mis à jour sans `markForCheck()` manuel.

### Exemple

```typescript
@Component({
  selector: 'app-run-summary',
  imports: [TranslatePipe, TranslateDirective],
  template: `
    <h2>{{ 'run.summary.title' | translate }}</h2>
    <p [translate]="'run.summary.count'" [translateParams]="{ count: total() }"></p>
  `,
})
export class RunSummaryComponent {}
```

### Points Importants

- **`TranslatePipe` et `TranslateDirective` s'importent composant par composant** : il n'y a plus de module à importer
- La compatibilité OnPush est **annoncée par la documentation officielle** ; une source tierce décrit au contraire un pipe impur à base de RxJS. En cas de traduction qui ne se rafraîchit pas après un `use()`, c'est la première hypothèse à tester plutôt qu'à écarter
- Utiliser le texte d'un élément comme clé (`<span translate>HELLO</span>`) est déprécié et prévu à la suppression : préférer `[translate]="'HELLO'"`

---

## Locale système au premier lancement

### Description

Au premier démarrage, la langue vient du système via le plugin `os` de Tauri. Le sélecteur des Settings force ensuite l'une ou l'autre.

### Exemple

```typescript
import { locale } from '@tauri-apps/plugin-os';

export async function resolveInitialLang(): Promise<'fr' | 'en'> {
  const systemLocale = await locale();            // 'fr-FR' | null
  return systemLocale?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
```

### Points Importants

- **Le plugin rend un tag BCP-47 complet** (`fr-FR`, `fr-CA`) : comparer le préfixe, jamais l'égalité stricte avec `'fr'`
- **`locale()` peut rendre `null`** : le repli est l'anglais
- La règle du projet : commence par `fr` donne du français, tout le reste donne de l'anglais
- Le choix de l'utilisateur, une fois posé dans le `store`, prime sur la locale système aux lancements suivants
- Ce câblage n'est documenté ni côté Tauri ni côté ngx-translate : c'est une composition des deux API, à couvrir par un test si la logique de repli évolue

---

## Chargement des fichiers de traduction

### Description

Un fichier JSON par langue, chargé en HTTP par le loader. Structure imbriquée plutôt que plate.

### Exemple

```json
// public/i18n/fr.json
{
  "run": {
    "summary": {
      "title": "Récapitulatif du run",
      "count": "{{count}} morceaux traités"
    }
  }
}
```

### Points Importants

- **Un 404 rend `{}` silencieusement avec un simple warning** en v18, au lieu de propager l'erreur. Un chemin de `prefix` erroné produit donc une interface où toutes les clés s'affichent brutes, sans erreur visible : passer `failOnError: true` en développement
- **`setTranslation()` remplace les traductions au lieu de les fusionner** par défaut en v18
- `instant(key)` rend la clé elle-même si les traductions ne sont pas encore chargées : à éviter au démarrage, préférer le pipe
- Les rapports de run sont **en anglais quelle que soit la langue de l'interface** (cf. [ADR-014](../adrs/014-observabilite-sentry-et-rgpd.md)) : ils ne passent pas par ngx-translate

---

# Bonnes Pratiques

## ✅ Recommandations

- **Activer `failOnError: true` en développement** pour que le chemin des fichiers de traduction se vérifie tout de suite
- **Structurer les clés par feature** (`run.summary.title`), en miroir de l'arborescence des composants
- **Lire `currentLang()` comme un Signal** dans les `computed()`, sans abonnement manuel
- **Comparer le préfixe du tag BCP-47**, jamais la chaîne complète
- **Garder les deux fichiers de langue synchronisés** : une clé ajoutée en français doit l'être en anglais dans le même commit, sinon le fallback rend un texte anglais au milieu d'une interface française

## ❌ Anti-Patterns

- **Importer `TranslateModule`** : il n'existe plus en v18
- **Utiliser `instant()` au démarrage** : les traductions ne sont pas chargées et la clé brute s'affiche
- **Écrire `currentLang` sans parenthèses** : c'est un Signal, l'expression est toujours truthy
- **Traduire les rapports de run** : ils sont en anglais par décision, y compris pour un utilisateur francophone
- **Coder la langue en dur au bootstrap** en ignorant la locale système : c'est précisément le confort que le premier lancement doit offrir
- **Utiliser le texte de l'élément comme clé** : déprécié, avec suppression annoncée

---

# 🔗 Ressources

## Documentation Officielle

- [ngx-translate](https://ngx-translate.org/)
- [Guide de migration v18](https://ngx-translate.org/getting-started/migration-guide/)
- [Configuration](https://ngx-translate.org/reference/configuration/)
- [TranslateService API](https://ngx-translate.org/reference/translate-service-api/)

## Ressources Complémentaires

- [ADR-004 — i18n par ngx-translate](../adrs/004-i18n-ngx-translate.md)
- [Tauri — plugin OS (locale)](https://v2.tauri.app/plugin/os-info/)
