---
title: "PrimeNG v22 — Bibliothèque de composants Angular"
version: "22.1.2"
description: "Référence technique pour PrimeNG v22 : licence PrimeUI, preset Aura, design tokens, mode sombre forcé, table défilante, tiroir non modal, tabs et icônes SVG."
date: "2026-10-09"
keywords: ["primeng", "primeuix", "aura", "design-tokens", "dark-mode", "table", "drawer", "primeicons"]
scope: ["docs"]
technologies: ["Angular", "Tailwind CSS", "Tauri"]
---

# Description

Bibliothèque de composants Angular qui fournit l'essentiel de l'interface : tableaux, modales, formulaires, onglets. Le projet l'utilise en **mode sombre forcé**, cohérent avec les outils DJ et avec un usage nocturne (cf. [ADR-003](../adrs/003-primeng-community-license.md)).

Cette fiche couvre trois paquets indissociables : `primeng` 22.1.2, `@primeuix/themes` 3.0.1 (le moteur de thème, **pas une dépendance transitive**, à déclarer explicitement) et `@primeicons/angular` 8.0.2 (les icônes, tirées par PrimeNG v22).

Le détail visuel du projet (tokens retenus, scale typographique, mapping composant par composant) vit dans [DESIGN.md](../DESIGN.md), pas ici.

---

# Concepts Clés

## Licence PrimeUI et clé obligatoire

### Description

PrimeNG v22 passe sous licence PrimeUI, avec un modèle dual Community / Commercial. **Une clé est requise même en Community License**, gratuite et renouvelable, valable 12 mois avec 30 jours de grâce (cf. [ADR-003](../adrs/003-primeng-community-license.md)).

### Exemple

```typescript
// app.config.ts
providePrimeNG({
  theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } },
  license: PRIMENG_LICENSE_KEY,   // fournie au build, jamais commitée
})
```

### Points Importants

- **Sans clé valide, les composants affichent une notice de licence** : ce n'est pas une limitation fonctionnelle mais c'est visible par l'utilisateur. La clé est donc un prérequis de premier build, pas une formalité de fin de projet
- **La notice ne se masque pas en développement dans ce projet.** La documentation PrimeUI mentionne une exemption sur `localhost`, mais la webview Tauri n'est pas un navigateur pointé sur `localhost` : elle n'en bénéficie pas, la notice s'affiche donc dès le premier `just dev` sans clé
- **Aucune limitation fonctionnelle sur la bibliothèque centrale** en Community : tous les composants sont là
- **Le Theme Designer n'est pas inclus** : toute personnalisation passe par `definePreset()`, jamais par un outil visuel
- Les versions antérieures à la v22 restent MIT pour toujours, le changement n'est pas rétroactif
- **Le dépôt GitHub `primefaces/primeng` ne porte plus que la lignée MIT 21.x** : archivé le 2026-06-28, désarchivé au plus tard le 2026-08-27 sans annonce, il annonce dans son README « receives security fixes only », issues en lecture seule. Le code des 22.x vit dans `primefaces/primeng-nextchapter`, privé, et le support passe par PrimeUI (relevé le 2026-10-09)
- **La Community License dure 12 mois**, renouvelable gratuitement, avec 30 jours de grâce après expiration (primeui.dev/licenses/community)

---

## Preset Aura et configuration

### Description

Le thème se déclare une fois dans `providePrimeNG()`. Le projet utilise le preset **Aura** en base 16px, sans la variante `-compat`.

### Exemple

```typescript
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          prefix: 'p',
          darkModeSelector: '.app-dark',
          cssLayer: { name: 'primeng', order: 'theme, base, primeng' },
        },
      },
      license: PRIMENG_LICENSE_KEY,   // fournie au build, jamais commitée
    }),
  ],
};
```

### Points Importants

- **`@primeuix/themes` n'est pas tiré par PrimeNG** : le déclarer explicitement dans `package.json`, sinon l'import `@primeuix/themes/aura` échoue
- **La base rem est passée de 14px à 16px** en v22 : tout style maison calé sur 14px se retrouve décalé. La variante `aura-compat` préserve l'ancien calibrage mais le projet ne la retient pas
- `prefix: 'p'` fixe le préfixe des variables CSS (`--p-primary-color`), qui sert aussi côté Tailwind

---

## Design tokens et `definePreset()`

### Description

Trois niveaux de tokens : **primitive** (palettes brutes), **semantic** (rôles contextuels) et **component** (isolés par composant). La personnalisation consiste à redéfinir des tokens, pas à écrire du CSS par-dessus.

### Exemple

```typescript
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

const TaggerPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{violet.50}',
      500: '{violet.500}',
      900: '{violet.900}',
    },
  },
});

// puis : providePrimeNG({ theme: { preset: TaggerPreset, ... } })
```

### Points Importants

- **Le Theme Designer étant hors Community, `definePreset()` est la seule voie** de personnalisation
- Les tokens sont exposés en variables CSS (`var(--p-primary-color)`), donc lisibles depuis Tailwind via `tailwindcss-primeui`
- Surcharger un composant par du CSS de sélecteur plutôt que par ses tokens casse à la première montée de version : passer par `components` dans le preset
- Une référence `{violet.500}` pointe une primitive : c'est la façon de garder la palette cohérente sans recopier des hexadécimaux

---

## Mode sombre forcé

### Description

`darkModeSelector` vaut `'system'` par défaut, ce qui génère une media query `prefers-color-scheme`. Le projet force le sombre en permanence par une classe posée sur `<html>`.

### Exemple

```html
<!-- index.html -->
<html lang="fr" class="app-dark">
```

```css
/* styles.css — aligner le variant Tailwind sur le sélecteur PrimeNG */
@custom-variant dark (&:where(.app-dark, .app-dark *));
```

### Points Importants

- **La classe est posée en dur dans `index.html`, jamais togglée** : aucun sélecteur clair/sombre à maintenir au MVP
- **Le variant `dark:` de Tailwind doit viser exactement le même sélecteur**, sinon les composants PrimeNG sont sombres et les utilitaires Tailwind clairs (cf. [tailwindcss.md](tailwindcss.md))
- L'alternative (désactiver la variante dark et réécrire tous les tokens clairs en valeurs sombres) demande de retravailler l'ensemble des tokens semantic : la classe fixe est plus simple et plus proche de l'usage prévu

---

## Table défilante

### Description

Les listes du projet montent à une centaine de lignes, le récapitulatif filtrable davantage. La table défile dans son cadre, la page jamais.

### Exemple

```html
<p-table
  [value]="tracks()"
  [scrollable]="true"
  scrollHeight="flex"
  [virtualScroll]="true"
  [virtualScrollItemSize]="41">
  <ng-template #body let-track>
    <tr class="h-10.25"><td>{{ track.artist }}</td><td>{{ track.title }}</td></tr>
  </ng-template>
</p-table>
```

### Points Importants

- `scrollHeight="flex"` laisse la table prendre la hauteur disponible, plus adapté qu'une valeur en pixels dans une fenêtre redimensionnable
- **`virtualScrollItemSize` doit valoir la hauteur réelle de la ligne** : PrimeNG ne mesure rien, il multiplie ce nombre. Une valeur fausse produit un scroll qui saute ou des lignes coupées, donc une classe fixe la hauteur de la ligne et pas l'inverse
- **Mesuré le 2026-09-17 en mode développement, sans défilement virtuel** : 0,6 s pour monter 500 lignes du rapport, 5 s pour 2 000, 29 s pour 5 000. C'est ce coût que le défilement virtuel supprime
- Le scroll virtuel et le filtrage cohabitent, mais le filtrage recalcule la liste rendue : c'est le jeu de données filtré qui compte, pas le total
- **`#expandedrow` ne va pas avec le scroll virtuel** : le scroller place chaque ligne à `rang × virtualScrollItemSize` et dimensionne son espaceur sur le même produit, sans mesure ; une ligne dépliée de hauteur variable décale donc toutes les suivantes (lu dans `primeng-scroller.mjs`, PrimeNG 22.1.2, 2026-10-06). Une table à lignes dépliables se rend sans `[virtualScroll]`
- **Mesuré le 2026-10-09 sous `ng serve` sur la liste du run, sans scroll virtuel et avec lignes dépliées** : 500 morceaux, 1 à 3 s de premier rendu et 43 à 78 ms par événement ; 2 000 morceaux, 16 s de premier rendu bloquant, 214 ms par événement et jusqu'à 320 ms par saut de défilement. Le projet garde le scroll virtuel et ouvre le détail dans un tiroir (cf. § Tiroir non modal)

---

## Tiroir non modal

### Description

Le détail d'un morceau du run s'ouvre dans un `p-drawer` à droite, sans masque : la liste reste utilisable et un autre bouton de ligne remplace le contenu. API lue dans `primeng-drawer.mjs` et `primeng-drawer.d.ts` (PrimeNG 22.1.2, le 2026-10-09).

### Exemple

```html
<p-drawer
  [visible]="shown() !== null"
  (visibleChange)="onDrawerVisible($event)"
  [modal]="false"
  position="right"
  appendTo="body"
  styleClass="w-[35rem]"
  [ariaCloseLabel]="'tagging.detail.close' | translate">
  <ng-template #header>{{ title() }}</ng-template>
  @if (shown(); as row) {
    <app-track-detail [track]="row" />
  }
</p-drawer>
```

### Points Importants

- **`visible` est un `model`** (`[visible]` plus `(visibleChange)`) : la croix et Échap l'écrivent à `false` eux-mêmes, d'où un `visibleChange` à relayer vers l'état du parent si `visible` en est dérivé
- **`modal` vaut `true` par défaut** : `[modal]="false"` supprime le masque, `dismissible` (clic sur le masque) et `blockScroll` n'ont alors plus d'objet
- **`position` vaut `left` par défaut** et `.p-drawer-right` pose `width: 20rem` : la largeur se change par `styleClass` (une classe Tailwind), pas par `[style]`
- **`appendTo` vaut `self` par défaut**, `"body"` déplace le panneau hors de l'hôte : ses tests le cherchent dans `document`
- **Le panneau prend son z-index d'un compteur partagé avec les modales** (`ZIndexUtils`, `autoZIndex` à `true`) : ce qui s'ouvre après passe au-dessus, une modale ouverte pendant que le tiroir est affiché le recouvre
- **`closeOnEscape` vaut `true`** et l'écouteur est sur le `document`, mais il ne ferme que le panneau dont le z-index est le plus haut
- **`closable` et `showCloseIcon` valent `true`** et `ariaCloseLabel` n'a pas de valeur par défaut : il faut le traduire
- **Titre** : l'input `header` (chaîne) ou un `ng-template #header` ; le template permet un composant, comme `TruncatedTextComponent`
- **Le contenu projeté est créé par le parent même panneau fermé** : un `@if` sur la donnée affichée dans le panneau évite de monter le composant sans donnée
- **Le panneau porte `role="complementary"` et `pFocusTrap` en dur, y compris non modal** : Tab tourne dans le tiroir, la liste ne s'atteint alors qu'à la souris ou après l'avoir fermé (non revalidé au clavier sur le bundle)

---

## Onglets sans mode router

### Description

Le shell de l'application affiche trois routes dans des onglets. **PrimeNG v22 ne fournit aucun mode router sur `p-tabs`** : l'onglet actif se dérive de l'URL et la navigation se déclenche au changement de valeur.

### Exemple

```typescript
@Component({
  template: `
    <p-tabs [value]="activeTab()" (valueChange)="onTabChange($event)">
      <p-tablist>
        <p-tab value="playlist">{{ 'nav.playlist' | translate }}</p-tab>
        <p-tab value="tagging">{{ 'nav.tagging' | translate }}</p-tab>
        <p-tab value="settings">{{ 'nav.settings' | translate }}</p-tab>
      </p-tablist>
    </p-tabs>
    <router-outlet />
  `,
})
export class ShellComponent {
  private readonly router = inject(Router);
  readonly activeTab = toSignal(
    this.router.events.pipe(map(() => this.router.url.split('/')[1])),
  );

  onTabChange(value: string): void {
    void this.router.navigate([value]);
  }
}
```

### Points Importants

- **Le câblage tabs ↔ router est manuel**, soit une dizaine de lignes dans le shell. Aucune synchronisation automatique n'existe
- `p-tabMenu` n'est plus la voie recommandée : le pattern documenté est des tabs sans panneaux, dont le contenu vient du `router-outlet`
- Dériver l'onglet de l'URL, et non l'inverse, garde le deep-link fonctionnel (retour sur le récapitulatif d'un run passé)

---

## Icônes en composants SVG

### Description

`@primeicons/angular` rend des **composants Angular standalone en SVG inline**, et non plus une police avec des classes `pi pi-*`.

### Exemple

```typescript
import { PrIconFolderOpen } from '@primeicons/angular/icons';

@Component({
  selector: 'app-source-picker',
  imports: [PrIconFolderOpen],
  template: `<pr-icon-folder-open /> {{ 'picker.source' | translate }}`,
})
export class SourcePickerComponent {}
```

### Points Importants

- **Chaque icône s'importe individuellement** dans le tableau `imports` du composant : c'est ce qui permet le tree-shaking
- Le paquet CSS `primeicons` s'arrête à 7.0.0 pour le MIT ; la 8.0.0 est sous licence PrimeUI
- Quatre logos absents du jeu (Beatport, Bandcamp, SoundCloud, VLC) viennent de **Simple Icons**, en SVG dans `src/assets/icons/`

---

# Bonnes Pratiques

## ✅ Recommandations

- **Provisionner la clé PrimeUI avant le premier build**, pas au moment de la distribution
- **Déclarer `@primeuix/themes` explicitement** dans `package.json`, il n'arrive pas tout seul
- **Personnaliser par tokens via `definePreset()`**, jamais par des surcharges de sélecteurs CSS
- **Aligner `darkModeSelector` et le `@custom-variant dark` de Tailwind** sur le même sélecteur, dans le même commit
- **Fixer `virtualScrollItemSize` sur la hauteur réelle du `<tr>`** et la revalider quand le style de ligne change
- **Importer les icônes une par une** plutôt que par un baril d'import global

## ❌ Anti-Patterns

- **Copier une config PrimeNG d'un projet en v21** : la base rem, les icônes et la licence ont tous changé
- **Utiliser le preset `aura-compat` par confort** : il fige un calibrage 14px que le projet a explicitement écarté
- **Attendre un mode router de `p-tabs`** : il n'existe pas, et le contourner par un `p-tabMenu` s'appuie sur un composant qui n'est plus la voie recommandée
- **Écrire du CSS qui cible les classes internes des composants** : il casse à la montée de version, les tokens sont là pour ça
- **Utiliser les classes `pi pi-*`** : la police n'est plus l'approche de la v22
- **Ouvrir une issue sur le dépôt GitHub `primefaces/primeng`** en attendant une réponse : il ne sert plus que la lignée 21.x et n'est plus le canal de support

---

# 🔗 Ressources

## Documentation Officielle

- [PrimeNG](https://primeng.dev)
- [Configuration](https://primeng.dev/configuration)
- [Theming](https://primeng.dev/theming)
- [Table](https://primeng.dev/table) · [Tabs](https://primeng.dev/tabs) · [Dialog](https://primeng.dev/dialog) · [Drawer](https://primeng.dev/drawer)
- [Licence Community PrimeUI](https://primeui.dev/licenses/community)

## Ressources Complémentaires

- [ADR-002 : Framework UI Angular](../adrs/002-framework-ui-angular.md)
- [ADR-003 : PrimeNG Community License](../adrs/003-primeng-community-license.md)
- [DESIGN.md](../DESIGN.md) : tokens, layout et mapping composants du projet
- [tailwindcss.md](tailwindcss.md) : alignement du variant `dark:`
