---
title: "DESIGN — techno-tagger"
description: "Design system : typographie, couleurs, librairies UI, mapping composants et conventions de style de l'interface Angular + PrimeNG."
date: "2026-10-23"
keywords: ["design", "ui", "design-system", "typography", "colors", "animations", "layout", "dark-mode", "icons", "desktop", "components", "spacing", "primeng", "tailwind"]
scope: ["docs", "frontend"]
technologies: ["Angular", "PrimeNG", "Tailwind CSS", "tailwindcss-primeui", "PrimeIcons", "Simple Icons", "Inter", "Tauri"]
---

# 🎨 Identité Visuelle

## Typographie

### Police Principale

**Famille** : `Inter Variable`

**Source** : `@fontsource-variable/inter`, import `wght.css` (poids 100 à 900 en un fichier), embarquée dans le bundle, aucun CDN : l'application s'affiche hors ligne

**Usage** : toute l'interface

**Tokens** : `--font-sans` (fallback `system-ui, sans-serif`), déclaré dans le `@theme` du CSS global, exposé en classe `font-sans`. Aura déclare `fontFamily: 'inherit'`, rien n'est à défaire de son côté

### Scale Typographique

> Une seule taille par niveau : l'application étant `desktop-only`, aucun n'a de palier responsive.

`rem` racine à 16px, imposé par l'import `@primeuix/themes/aura` en version non-`compat` (cf. [ADR-003](adrs/003-primeng-community-license.md)). Le texte courant est à 14px, celui d'Aura (`typography.fontSize`).

| Usage | Taille | Poids | Classe |
|-------|--------|-------|--------|
| H1 (titre d'écran) | 1.5rem (24px) | 600 | `text-2xl font-semibold` |
| Titre de section et de modale | 1.125rem (18px) | 600 | `text-lg font-semibold` : sections des Réglages, gabarits `#header` des modales, écran bloquant. Les confirmations `p-confirmdialog` gardent le titre d'Aura, de même taille et de même poids |
| Titre de bloc vide | 1rem (16px) | 400 | `text-base` |
| Body (tables, listes, formulaires) | 0.875rem (14px) | 400 | `text-sm`, et le texte des composants PrimeNG |
| Label (libellé de champ) | 0.875rem (14px) | 400 | `label pLabel`, taille et poids posés par le preset ; `text-sm` sur un `span` quand le contrôle est un groupe sans `<label>` (mode de Playlist, rangées des Réglages) |
| Contrôle compact | 0.75rem (12px) | 400 | `size="small"` d'Aura sur tous les boutons et les champs (§ Conventions de Code > Règles) : la densité est voulue, le libellé voisin reste en 14px |
| Caption (scores, compteurs, aides) | 0.75rem (12px) | 400 | `text-xs` : aussi la grille du détail déplié |

**Interlignes** : ceux de Tailwind (`text-2xl` 32px, `text-lg` 28px, `text-base` 24px, `text-sm` 20px, `text-xs` 16px), 1.5 dans les composants PrimeNG (21px en 14px, 18px en 12px)

Les composants PrimeNG gardent la typographie d'Aura, poids compris (500 sur un bouton et un message, 600 sur un onglet et un en-tête de colonne, 700 sur un tag et un badge) ; le preset n'y ramène que le libellé de champ (14px, 400) et le badge (12px, qu'Aura pose sous le plancher de l'échelle). Un `p-message` est en 14px, en 12px en `small`. Hors composants PrimeNG, les seuls poids 600 hors des titres sont l'indice de rattrapage (§ Tables et listes) et le nom de l'application (§ Identité). Les chiffres qui se comparent d'une ligne à l'autre (scores, compteurs, progression) prennent `tabular-nums`.

### Séparateurs

Trois glyphes, trois rôles distincts : un glyphe à double emploi rend la ligne illisible d'un coup d'œil.

| Glyphe | Rôle | Exemple |
|--------|------|---------|
| `-` entouré d'espaces | Artiste et titre d'un même morceau | `Adam Beyer - Your Mind` |
| `·` | Deux valeurs de même rang | `A 96 · T 92`, `Drumcode · 2023`, `Artiste · TPE1` |
| `—` seul | Cellule sans valeur (§ États des Composants) | la colonne Source d'un morceau non résolu |

Le point médian ne sépare jamais un total de son détail : en table `94` puis `A 96 · T 92` en `text-xs` dessous, sur une ligne `94 (A 96 · T 92)`. `A` disparaît quand la source ne donne pas de score artiste.

## Palette de Couleurs

### Tokens / Variables

Le projet ne définit aucune couleur : le preset Aura génère les variables `--p-*` au démarrage, que l'interface consomme directement ou par les classes du plugin `tailwindcss-primeui`.

| Token | Valeur en dark | Classe | Usage |
|-------|----------------|--------|-------|
| `--p-primary-color` | `{primary.400}` (rampe `emerald`) | `outline-primary`, `border-primary` | Actions primaires et sélection (par le preset), focus d'une ligne du run et de la liste des candidats |
| `--p-primary-contrast-color` | `{surface.900}` | par le preset | Texte posé sur `primary` |
| `--p-surface-950` | `{zinc.950}` | `bg-surface-950` | Fond de l'application (hôte du shell), fond du détail déplié |
| `--p-surface-900` | `{zinc.900}` | `bg-surface-900` | Panneau du bloc principal (§ Formes) |
| `--p-surface-800` | `{zinc.800}` | `bg-surface-800`, `border-surface-800` | Cadre d'une pochette absente, filet entre les lignes d'une liste |
| `--p-form-field-border-color` | `{surface.600}` | par le preset | Bordure des champs |
| `--p-text-color` | `{surface.0}` | `text-color` | Texte principal |
| `--p-text-muted-color` | `{surface.400}` | `text-muted-color` | Texte atténué, placeholders, aides, chemins |
| `--p-content-border-color` | `{surface.700}` | `border-surface` | Bordure d'un panneau, filet de structure (barre d'onglets, colonne du menu) |
| `--p-highlight-background` | `color-mix(in srgb, {primary.400}, transparent 84%)` | `bg-highlight` | Sélection : ligne dépliée de la liste du run, entrée active du menu des Réglages |
| `--p-content-hover-background` | `{surface.800}` | `bg-emphasis` | Survol d'une ligne actionnable |
| `--p-datatable-row-background` | `{content.background}` | par `fullHeightTable` | Fond de ligne étiré sur toute la hauteur d'une table |
| `--p-datatable-body-cell-border-color` | `{surface.800}` | `border-(--p-datatable-body-cell-border-color)` | Filet des lignes de table, et des lignes squelette qui les précèdent |
| `--p-disabled-opacity` | `0.6` | par le preset | Boutons et curseurs désactivés ; champs, sélecteurs et bascules prennent leur fond `disabled` |
| `--p-focus-ring-*` | 1px solid, `{primary.color}`, offset 2px | par le preset | Anneau de focus clavier |
| `--p-red-600` | `{red.600}` | `hover:bg-(--p-red-600)`, texte `hover:text-surface-0` | Croix de fenêtre au survol, le rouge de Windows : seule teinte rouge hors famille Échec |

Le plugin expose deux familles de classes à ne pas confondre : des **tokens combinables** avec n'importe quel préfixe Tailwind (`primary`, `surface-{0..950}`, d'où `bg-surface-950` ou `outline-primary`) et des **classes complètes**, préfixe déjà inclus, à écrire telles quelles (`text-color`, `text-muted-color`, `border-surface`, `bg-emphasis`, `bg-highlight`).

Valeurs de `@primeuix/themes` 3.0.1 (`dist/aura/`, relevé le 2026-10-16), le dépôt `primeuix` étant archivé.

### Couleurs Sémantiques

Le design system ne connaît pas la liste des états d'un morceau, seulement **quatre familles** auxquelles chacun se rattache. L'énumération exacte vit dans le contrat NDJSON, en trois champs `state` / `resolution` / `failure_reason` (cf. [ARCHITECTURE.md § API](ARCHITECTURE.md#api)) : elle peut s'allonger sans qu'aucune couleur soit à inventer.

| Famille | Sévérité | Icône type | Source | Ce qu'elle couvre |
|---------|----------|------------|--------|-------------------|
| Neutre | `secondary` | `clock`, `minus-circle`, `undo` | dérivée et `state` pour `rolled_back` | Le morceau attend son tour, le run s'est arrêté avant lui, ou ses fichiers ont retrouvé leur état d'origine |
| Décision attendue | `info` | `info-circle` | dérivée | `arbitration_required` reçu sans `track_resolved` derrière : le morceau attend un geste humain |
| Résolu | `success` | `check` | `state` | `resolved` et `written` |
| Échec | `danger` (`error` sur `p-message`) | `times`, `exclamation-triangle` | `state` | `unresolved` et `write_error` |

Les sévérités, déjà câblées dans `p-tag`, `p-badge`, `p-message` et `pButton`, suivent le preset sans maintenance. `info` est en `sky` partout : `p-tag` et `p-badge` par Aura, `p-message` par le preset (Aura le teinte en `blue`).

**Trois états sont dérivés par l'interface**, faute d'événement : « en attente » pour ce qu'elle n'a pas encore reçu, « non traité » pour ce qu'un run interrompu ou figé (confirmé, ou perdu avec le moteur) n'atteindra plus, « à arbitrer » pour une demande restée sans réponse. Les autres se lisent sur `state`.

**Bleu plutôt qu'orange sur la décision attendue** : un arbitrage qui attend est une étape normale, pas une anomalie (choix posé dans [BRAINSTORM.md](BRAINSTORM.md)). `warn` n'est donc porté par aucun état de morceau : il reste aux avertissements qui ne concernent pas une ligne.

Hors morceau : `info` sur les trois badges de la barre d'onglets (§ Navigation), `success` et `error` sur les retours de la rangée Version (§ Formulaires).

**Le libellé porte la voie, jamais la couleur.** `resolution` distingue trois issues positives, toutes vertes :

| `state` | `resolution` | Tag affiché |
|---------|--------------|-------------|
| `resolved` ou `written` | `auto` | vert, `check`, « Auto » |
| `resolved` ou `written` | `arbitration` | vert, `check`, « Arbitré » |
| `resolved` ou `written` | `url` | vert, `check`, « URL » |
| `unresolved` | `none` | rouge, `times`, « Non résolu » |
| `write_error` | - | rouge, `exclamation-triangle`, « Échec d'écriture » |
| `rolled_back` | - | neutre, `undo`, « Restauré » |
| absent du flux, arbitrage demandé | - | bleu, `info-circle`, « À arbitrer » |
| absent du flux, run en cours | - | neutre, `clock`, « En attente » |
| absent du flux, run interrompu | - | neutre, `minus-circle`, « Non traité » |

- **Auto contre Arbitré** : un morceau validé automatiquement à 94 est l'endroit le plus probable d'un mauvais match, puisque personne ne l'a regardé. Un glyphe ne se décode pas assez vite dans un tableau dense, le libellé si
- **Horloge contre `minus-circle`** : une horloge promet une suite, ce qu'un run interrompu ne tiendra pas
- **Restauré reste neutre** : ni écrit ni en échec, le morceau n'a aucune voie à montrer en vert ni aucune correction à attendre
- **Deux rouges, deux icônes** : leurs corrections sont opposées, l'un se rattrape par une URL, l'autre en relançant l'écriture (cf. [ARCHITECTURE.md § Robustesse](ARCHITECTURE.md#%EF%B8%8F-robustesse--modes-de-panne))
- **Libellé d'échec générique, motif au survol** : « Non résolu » et « Échec d'écriture » couvrent chacun plusieurs `failure_reason`. Les nommer élargirait la colonne État : l'icône `info-circle` suit le tag et le motif s'ouvre en tooltip, du diagnostic, pas de la colonne de balayage

Le rapport d'extraction rattache ses catégories aux mêmes familles :

| Catégorie | Tag affiché |
|-----------|-------------|
| `extracted` | vert, `check`, « Extrait » |
| `duplicate` | vert, `check`, « Doublon départagé » |
| `already_present` | neutre, `check-circle`, « Déjà présent » |
| `missing` | rouge, `times`, « Introuvable » |
| `failure` | rouge, `exclamation-triangle`, « Échec du transfert » |

### Règles

- ✅ Toujours référencer une couleur par token ou par classe du plugin : jamais de hex, jamais de couleur Tailwind brute (`bg-emerald-500`)
- ✅ **La couleur ne porte jamais seule l'information** : chaque état a toujours une icône et un libellé traduit
- ✅ L'accent `primary` marque l'interactif : actions, sélection, focus, contrôle actif et progression. Seule exception, le logo de l'application (§ Identité). Un écran où tout est vert ne signale plus rien
- ✅ `success` est le seul autre vert, réservé aux états : jamais sur un contrôle
- ✅ Le `danger` **d'une action** est réservé au bouton d'acceptation du rollback, qui défait l'écriture et consomme la sauvegarde des tags d'origine ; les déclencheurs (écriture, relance, restauration) restent `primary`. Sur un `p-tag` ou un `p-message`, la même sévérité ne décide rien : elle rapporte la famille Échec

## Formes

### Border Radius

Primitives du preset Aura. Là où Aura donne un autre cran à un composant, le preset du projet l'y ramène (§ Composition de Styles).

| Token | Valeur | Usage |
|-------|--------|-------|
| `--p-border-radius-xs` | `2px` | Réservé |
| `--p-border-radius-sm` | `4px` | Marqueurs (tags, badges, vignettes et cadres de pochette) et entrées d'une liste ou d'un menu (options, menu des Réglages, par Aura) |
| `--p-border-radius-md` | `6px` | **Défaut** d'Aura, contrôles : champs (`formField.borderRadius`), boutons, contenu (`content.borderRadius`), tooltips |
| `--p-border-radius-lg` | `8px` | Ce qui est posé dans la page : panneau du bloc principal (`panel` : table, bloc vide, panneau des Réglages), cartes |
| `--p-border-radius-xl` | `12px` | Ce qui flotte au-dessus d'elle : modales (`overlay.modal.borderRadius`) |

### Bordures

Toujours 1px. Trois gris, du plus marqué au plus discret :

| Rôle | Couleur | Classe |
|------|---------|--------|
| Champ, cadre d'un `p-selectbutton` | `{surface.600}` | par le preset |
| Panneau et filet de structure | `{surface.700}` | `border-surface` |
| Filet entre les lignes d'une liste (tables, rangées des Réglages) | `{surface.800}` | `border-surface-800`, par le preset dans une table |

### Ombres / Élévation

Aucune ombre posée par le projet : celles d'Aura restent sur les overlays (modales, tooltips, toasts, listes déroulantes), les champs (quasi invisible en dark), la poignée du curseur, le segment actif du `p-selectbutton`, le menu des Réglages et, teintée à 4 %, le `p-message`. Le toast garde le flou `blur(10px)` d'Aura. Le preset retire celle de la carte. La hiérarchie entre surfaces passe par les bordures et les crans de `surface`.

## Dark / Light Mode

**Stratégie** : dark permanent, aucun sélecteur dans l'interface

**Mécanisme** : `darkModeSelector: '.app-dark'` dans `providePrimeNG()`, classe `app-dark` posée en dur sur `<html>` (`index.html`), jamais retirée, cas documenté par PrimeNG. Côté Tailwind, le variant suit le même sélecteur :

```css
@custom-variant dark (&:where(.app-dark, .app-dark *));
```

### Règles

- ✅ Le mode clair n'existe pas : aucun style sous un variant `light:`, aucune valeur doublée
- ✅ La classe reste posée en dur plutôt que dérivée de `prefers-color-scheme` : un thème qui bascule selon l'heure système sur un outil utilisé de nuit est un bug
- ✅ Si un mode clair devient nécessaire, il passe par le `darkModeSelector` déjà en place et par les tokens : aucun composant n'est à reprendre

---

# 📦 Librairies UI

## Stack UI

| Librairie | Rôle | Périmètre |
|-----------|------|-----------|
| PrimeNG v22 (preset Aura) | Bibliothèque de composants | Tout le fonctionnel : tables, modales, formulaires, progression, notifications |
| Tailwind CSS v4 | Styling utilitaire | Layout, espacement, typographie, états custom |
| `tailwindcss-primeui` | Pont entre les deux | Expose les tokens du preset en classes et fournit les utilitaires d'animation. Le variant `dark:` reste à aligner à la main (§ Dark / Light Mode) |
| `@primeicons/angular` 8 | Icônes d'interface | Composants SVG standalone, sous licence PrimeUI comme PrimeNG (cf. [ADR-003](adrs/003-primeng-community-license.md)) |
| Simple Icons (SVG inline) | Logos | Beatport, Bandcamp, SoundCloud, VLC media player |

Versions exactes et compatibilité croisée dans [VERSIONS.md](VERSIONS.md).

## Mapping Composants

> Une section par famille d'usage. Les composants **post-MVP** vivent dans la dernière section et rejoignent leur famille au moment de leur installation ; la section disparaît quand elle se vide.

Les composants maison vivent dans `shared/components/`, leurs utilitaires dans `shared/utils/`, le preset dans `core/platform/` ; un composant d'un seul écran est rangé dans sa feature. Écrans de référence : [ARCHITECTURE.md § Flux Fonctionnels](ARCHITECTURE.md#flux-fonctionnels-use-cases-critiques).

### Navigation

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Navigation principale | `p-tabs` synchronisé à la main avec le Router | PrimeNG | Aucun mode router en v22 : l'onglet actif se dérive de l'URL. Playlist (`list`) et Tagging (`tag`) au centre de la barre, Réglages en icône seule (`cog`) tout à droite, nommé par `title`. Trait de l'actif sur la bordure de l'onglet. Un clic sur l'onglet actif, depuis une sous-page (le récapitulatif), ramène à sa racine. Barre de 40px, aussi barre de titre de la fenêtre (§ Structure de Page) : déplacement et double-clic sur ce qui n'est pas un contrôle, puis, après un filet, réduire, agrandir ou restaurer et fermer en boutons de 46px (largeur de Windows 11) sur toute la hauteur de la barre, `bg-emphasis` au survol, croix en `--p-red-600` (§ Tokens / Variables). Fermer passe par la garde de sortie |
| Navigation des Réglages | `p-menu` dans le panneau de la page, une entrée par section, l'active en `bg-highlight` et `aria-current="page"` | PrimeNG | Icônes `key`, `sliders-h`, `desktop`, `wrench`, en `primary` sur l'entrée active. Une section affichée à la fois (§ Structure de Page) |
| Badges de file, de rattrapage et de mise à jour | bouton portant un `p-tag` `info`, icône `info-circle` (`download` pour la mise à jour) | PrimeNG | À droite de la barre, en `gap-2`, séparés de l'engrenage par un filet vertical, masqués sur 0. Chacun rouvre sa modale : « N à arbitrer » celle de l'arbitrage, « N à rattraper » celle du lien (masqué aussi pendant la recherche), « Mise à jour X.Y.Z » l'invite fermée (masqué pendant le téléchargement) |
| Bandeau de démo | `app-demo-banner` : `h-8`, `border-b border-surface-800`, `bg-surface-900`, `text-xs text-muted-color`, centré ; icône `info-circle` en 16px par `IconComponent`, texte, puis deux boutons `pButton [link]="true"` : « Me contacter » (`a`) suivi de l'icône `external-link` (16px, après le libellé, comme le lien source du détail), puis « Recommencer la démo » (`button`, sans icône) | composant maison (PrimeNG) | Édition démo seule, sous la barre d'onglets, hors du desktop. Porte deux boutons `link`, dans cet ordre : « Me contacter » (nouvel onglet, `rel="noopener noreferrer"`), puis « Recommencer la démo » (recharge la démo sur Playlist, la langue choisie est conservée ; ajouté le 2026-10-26). Nouveau motif, écart au design system : il parle de l'environnement, pas de l'application, et ne se confond avec aucun `Message`. Décidé le 2026-10-25, options dans `docs/superpowers/specs/demo-web-publique/02-bandeau-options.html` |

### Actions

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Bouton d'action du run | `button pButton` `size="small"` | PrimeNG | Un seul bouton au bout de la ligne du dossier, à la largeur de son libellé, qui suit la phase (tableau ci-dessous) |
| Sélection de chemin | `PathPickerComponent` : `button pButton` `primary` outlined `size="small"` + plugin `dialog` de Tauri | composant maison (PrimeNG, Tauri) | Icône `folder`, logo VLC sur un dump, `file` sur un M3U8. Chemin en `text-muted-color`, tronqué par la gauche. Hôte transparent (`display: contents`) : ses cellules sont celles de la grille de l'appelant (§ Layout) |
| Lancement de l'extraction | `button pButton` `primary` `size="small"` | PrimeNG | Sur la ligne du mode (§ Layout) |
| Modification de l'extraction | `button pButton` `secondary` outlined `size="small"` | PrimeNG | « Modifier », au bout de la ligne de résumé (§ Layout) |
| Passage au tagging | `button pButton` `primary` outlined `size="small"`, icône `arrow-right` | PrimeNG | Sous le rapport. `primary` : étape suivante ; outlined : le plein reste aux lancements et aux validations |
| Restauration | `button pButton` `primary` outlined `size="small"`, icône `refresh`, `spinner` pendant l'opération | PrimeNG | « Restaurer ce morceau » sous la pochette du détail, « Restaurer le run » à droite de la barre d'écriture, « Restaurer le dernier run » dans la colonne d'actions des Réglages, sa cible dessous en `text-xs text-muted-color`. Un seul verbe, « Restaurer ». Ouvre la confirmation d'un geste sur les fichiers |
| Ouverture du récapitulatif | `button pButton` `secondary` outlined `size="small"` | PrimeNG | « Récapitulatif », à droite de la barre d'écriture une fois l'écriture terminée |
| Actions d'administration | `button pButton` `secondary` outlined `size="small"`, icône à gauche (`trash`, `external-link`) | PrimeNG | « Vider le cache » et « Ouvrir le dossier des logs », rangées Cache et Logs des Réglages, dans la colonne d'actions, l'aide à la place du contrôle. Vidage sans confirmation (cache jetable), `spinner` jusqu'à la réponse, taille du cache entre parenthèses dans la première phrase de l'aide. Grisés tant que le moteur démarre, le cache aussi sur un run affiché non écrit : raison en tooltip |
| Envoi du rapport | `button pButton` `secondary` outlined `size="small"`, icône `external-link` puis `spinner` | PrimeNG | « Envoyer ce rapport », pied du récapitulatif. Seul geste par lequel des titres quittent la machine ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md)) : tooltip `WIDE_TOOLTIP` d'avertissement ; grisé, sa raison en tooltip |

**Phases du bouton d'action du run** :

| Action | Quand | Libellé, icône | Style |
|--------|-------|----------------|-------|
| `start` | aucun run à confirmer ni à relancer | « Lancer le run », `play` | `primary` |
| `cancel` | recherche en cours | « Interrompre », `stop` | `secondary` outlined, actif en desktop ; grisé avec `demo.unavailable` en édition démo (décidé le 2026-10-25, spec 03) |
| `commit` | run cherché à confirmer | « Confirmer l'écriture », `check` | `primary` |
| `retry` | fichiers en échec d'écriture | « Relancer l'écriture », `refresh` | `primary` |

`cancel` n'a ni `danger` ni confirmation : la recherche n'écrit aucun fichier. `commit` et `retry` ouvrent la confirmation d'un geste sur les fichiers et passent en `spinner` pendant l'écriture.

### Formulaires

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Sélecteur de playlist (dump VLC) | `p-select` `size="small"` | PrimeNG | Option : nom et nombre de morceaux. Un `p-skeleton` à sa hauteur tant que la liste est attendue. Nom long coupé, lu au survol : `contain: inline-size` l'empêche d'élargir la colonne |
| Mode copie / déplacement | `p-selectbutton` `size="small"` `[fluid]="true"` | PrimeNG | Copie par défaut. Les deux segments se partagent la colonne, à la largeur des boutons de chemin du dessus |
| Champ de lien | `UrlLinkFormComponent` : `input pInputText` `pSize="small"` `type="url"` + `app-error-message`, boutons par `UrlLinkActionsComponent` | composant maison (PrimeNG) | Modale du lien et étape lien. Au-dessus du champ : cellule réservée `min-h-8` (deux lignes de `text-xs` : motif ou « Rattrapé sur »), puis l'aide `hint`. Refus sous le champ. « Résoudre » en `spinner` pendant le geste |
| Clé API | `input pInputPassword` dans un `p-iconfield` + « Enregistrer » `size="small"` | PrimeNG | Jamais préremplie ni relue ([ADR-012](adrs/012-securite-cle-api-keyring.md)) : 24 points en placeholder une fois enregistrée, sans tag, état en `sr-only`. L'œil, bouton du template (`p-password` déprécié), n'apparaît que pendant une saisie |
| Rangée des Réglages | `SettingsRowComponent`, rangées d'une section en `settings-rows` | composant maison (Tailwind) | Grille `10rem` / `minmax(0,1fr)` / `max-content` sur la section, chaque rangée en subgrid, 16px de padding entre les colonnes, `py-3`, filet `border-b border-surface-800`, rangées jointives. Libellé seul à gauche, 10rem mesurés sur « Signal sonore de fin » ; contrôle au milieu ; action à droite, dans une colonne à la largeur du plus long bouton de la section, que chaque bouton remplit (`w-full`), absente dans une section sans action. Aide avec le contrôle : dessous (`pt-2`), ou à la place du contrôle quand la rangée n'a qu'une action ; retours dessous, sur les colonnes du contrôle et de l'action, en `small` (§ Feedback et chargement) |
| Runs passés | `p-select` `size="small"` en contrôle, « Ouvrir le récapitulatif » `secondary` outlined dans la colonne d'actions | PrimeNG | Sous « Restauration ». Le sélecteur remplit la colonne du contrôle : le dossier est coupé, son tooltip le montre |
| Version | Version installée en aide à la place du contrôle, « Rechercher une mise à jour » `secondary` outlined (`refresh`, puis `spinner` et grisé pendant la recherche) dans la colonne d'actions | PrimeNG | Dernière d'Administration. Retour `small` dessous : `success` à jour, `error` en échec ; une mise à jour trouvée ouvre l'invite |
| Langue | `p-select` `size="small"`, 9rem (`w-36`) mesurés sur « Français » | PrimeNG | Largeur fixe : le select ne change pas de taille d'une langue à l'autre |
| Bascule des Réglages | `p-toggleswitch`, à droite, aide sur sa ligne | PrimeNG | Signal sonore de fin |
| Seuils de matching | `p-slider` lié à un `p-inputnumber` `size="small"` sans boutons de pas, 4rem (`w-16`) mesurés sur « 100 » ; « Rétablir les valeurs par défaut » en `secondary` outlined, calé à droite sous la section | PrimeNG | Plancher et seuil haut, les deux pistes sur 0-100 : le seuil qui bouge bute sur l'autre, le champ refuse les bornes croisées |

### Tables et listes

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Rapport d'extraction | `p-table` `[scrollable]`, `[virtualScroll]` | PrimeNG | Deux colonnes (§ Layout), une ligne par morceau plus une par doublon départagé. Ce qui demande un geste en tête : échecs, introuvables, doublons, puis déjà présents et extraits. Catégorie en `p-tag`, détail en tooltip derrière `info-circle`. « Extraction terminée (N sur N) » en `text-sm text-muted-color` sous la table, à droite |
| Liste des morceaux d'un run | `RunListComponent` : `p-table` `[scrollable]`, `[virtualScroll]` | PrimeNG | Sept colonnes (§ Layout). Ligne actionnable vers la modale d'arbitrage ou du lien (§ États des Composants) |
| Table pleine hauteur | `fullHeightTable`, en `[pt]` de `p-table` | composant maison (PrimeNG) | Cadre `panel`, `table-layout: fixed`, fond de ligne sur toute la hauteur, table étirée vide pour centrer son bloc vide, jamais remplie (le défilement virtuel attend des lignes exactes) |
| Détail avant / après | `TrackDetailComponent`, sur des lignes synthétiques de la table ([knowledges/primeng.md](knowledges/primeng.md#détail-déplié-sous-une-ligne-virtualisée)) | composant maison (PrimeNG) | Déplié sous la ligne, pleine largeur, plusieurs ouverts, sur un nombre entier de lignes (§ Layout). Bouton `chevron-right` / `chevron-down` texte `small` `secondary` en tête de ligne (`aria-expanded`), ligne ouverte en `bg-highlight`. Fond `bg-surface-950`, filet bas `border-surface`. Pochette à gauche, « Restaurer ce morceau » dessous ; grille Champ / Avant / Après des champs écrits (sauf l'identifiant à la source, plus le commentaire), la colonne Champ à la largeur de son plus long libellé suivi de `·` et de sa clé, en `text-muted-color`, sans préfixe `TXXX:` |
| Lien vers la fiche source | `ButtonDirective` `link`, icône `external-link` | PrimeNG | Ligne URL du détail, ouvre la page par `openUrl` du plugin `opener` |
| Pochette | `ArtworkComponent` : `<img>` par `convertFileSrc()` + `p-skeleton` | composant maison (PrimeNG, Tauri) | 32px dans la liste, 168px dans le détail (largeur de « Restaurer ce morceau » en FR), rayon `sm`. Image, squelette tant que le morceau attend, cadre `bg-surface-800` bordé à l'icône `image` une fois tranché sans pochette |
| Score | moyenne, puis `A 96 · T 92` en `text-xs` dessous | Tailwind | Aligné à droite, `tabular-nums` (§ Séparateurs) |
| Indice de rattrapage | `font-semibold text-muted-color` + icône `arrow-right` | Tailwind | « Coller un lien → » dans la colonne Après d'un non résolu rattrapable |
| Récapitulatif filtrable | `RecapPageComponent` : `RunListComponent` figée + `p-selectbutton` + `p-iconfield` (`p-inputicon` `search`, `pInputText` `pSize="small"`) | composant maison (PrimeNG) | Filtres avec leur compte, recherche texte. En-tête : titre puis filtres. Pied : « Retour à la liste » `text` `secondary` (`chevron-left`), « Envoyer ce rapport » (§ Actions), ligne de contexte `text-sm text-muted-color` tronquée à droite. Un run passé s'y rouvre en lecture seule |

### Badges

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| État d'un morceau | `StateTagComponent` (`p-tag`) | composant maison (PrimeNG) | `status` (le `state` reçu, ou l'un des trois états dérivés, calculé par la liste du run) et `resolution` traduits en famille, icône et libellé (§ Couleurs Sémantiques), écrits une fois. Un `failure_reason` ajoute `info-circle` derrière le tag, motif en tooltip |
| Catégorie du rapport | `p-tag` + icône `info-circle` | PrimeNG | Familles du § Couleurs Sémantiques |
| Compteur de navigation | `p-badge` `secondary`, sans `size`, `h-auto`, `tabular-nums` | PrimeNG | « 1/3 » entre les flèches des modales d'arbitrage et du lien, à la hauteur des boutons `small` qui l'encadrent. Neutre : un compteur n'est pas une action |

### Feedback et chargement

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Écran bloquant | `p-card` centrée dans la page, sous une barre de titre réduite au logo, au nom et aux boutons de fenêtre, à l'anatomie de nos modales : titre `text-lg` 600, texte `text-sm text-muted-color`, action `secondary` outlined `size="small"` en pied à droite | PrimeNG | Sidecar absent ou en quarantaine (« Réessayer »), divergence de version (sans action). Pas une modale : la barre d'onglets n'est pas rendue. Neutre plutôt qu'un `p-message`, dont le fond d'alerte couvrirait la phrase qui dit quoi faire |
| Notifications | `p-toast` en bas à droite, `success` et 4s par défaut | PrimeNG | Fin d'une phase longue (extraction, run, écriture, restauration) et vidage du cache ; `warn` avec le nombre d'échecs. Recouvre le pied de Playlist pendant ses 4s, la croix le ferme |
| Message inline | `MessageComponent` | composant maison (`p-message`) | Seule voie vers `p-message`. Icône selon la sévérité (`info-circle`, `check-circle`, `exclamation-triangle`, `times-circle`), 20px, 16px en `small`. `whitespace-pre-line`. `[animated]="false"` dans une cellule réservée |
| Erreur contextuelle | `ErrorMessageComponent` | composant maison (`MessageComponent`) | Erreur du sidecar traduite (`code`, `params`), dans l'écran concerné, jamais en toast (récapitulatif compris, sous son en-tête). Même écart au-dessus et en dessous que son conteneur (§ Structure de Page) |
| Échec de l'écriture | `MessageComponent` `error` | composant maison | Au-dessus de la liste du run, texte seul : la relance passe par le bouton d'action |
| Fichiers non restaurés | `RollbackFailuresComponent` (`MessageComponent` `error`) | composant maison | Rangée Restauration des Réglages, sous son bouton ; Tagging et récapitulatif, au-dessus de la liste. Une phrase par fichier |
| Logs introuvables | `MessageComponent` `error` `small` | composant maison | Sous la rangée Logs quand l'Explorateur ne peut pas révéler le fichier. Erreur locale, sans `code` du sidecar |
| Progression d'une phase | `PhaseProgressComponent` (`p-progressbar`) | composant maison | Libellé et compteur au-dessus de la barre, qui n'écrit aucune valeur et passe en indéterminée sans total. « N sur M rattrapés » prend la place de la barre du run pendant le rattrapage |
| Rien à rattraper | ligne `check-circle` en `text-sm` | Tailwind | À la place de la barre de rattrapage sur 0 sur 0 |
| Chargement d'une table | `SkeletonRowsComponent`, puis `p-skeleton` | composant maison (`p-skeleton`) | Table vide : lignes entières en squelette, à la hauteur et au filet des vraies, dans le `#emptymessage`. Dès la première ligne, le squelette ne tient plus que la vignette d'un morceau qui attend, les autres cellules en cadratin |
| Bloc vide | `EmptyStateComponent` | composant maison | Forme au § États des Composants. Dans une table par le `#emptymessage` ; hors table, `framed` lui donne le cadre `panel` |

### Overlays

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| En-tête de modale | `p-dialog`, réglé une fois dans le preset | PrimeNG | Titre `h3` `text-lg font-semibold` du gabarit `#header` de chaque modale, qui pose sur lui l'`id` de `aria-labelledby` (variable de gabarit `ariaLabelledBy`) : `p-dialog` ne le reporte sur aucun élément avec ce gabarit. Croix en contrôle compact (§ Structure de Page), calée sur la ligne du titre et sur le padding du contenu |
| Corps et pied de modale | texte en `text-sm text-muted-color`, boutons du pied à 8px (`gap-2`, preset pour les pieds d'Aura) | PrimeNG | Le titre porte le blanc, le texte se lit en second ; une valeur citée (le dossier de l'invite de reprise) reste en blanc |
| En-tête d'une modale de morceau | `DialogHeaderComponent`, dans le gabarit `#header` | composant maison (`p-dialog`) | Modales d'arbitrage et du lien : titre `h3` tronqué, qui reçoit l'`id` par `titleId`, nom de fichier dessous en `text-xs text-muted-color` (ligne gardée même vide), logo de la source sur la ligne du titre (`h-7`, hauteur de ligne du `text-lg`) |
| Modale d'arbitrage | `ArbitrationDialogComponent` : `p-dialog` modal, sans animation | PrimeNG | Dimensions figées (§ Layout). S'ouvre depuis n'importe quel onglet ; la croix ne décide rien, l'arbitrage reste en file et revient par le badge ou la ligne |
| Arbitrage : candidats | `p-listbox` à hauteur fixe, scroll interne, `metaKeySelection` | PrimeNG | Sélection au clic ou aux flèches, jamais au survol. Candidat « Artiste - Titre », score en `text-xs` (§ Séparateurs), ligne « label · année » gardée même vide : des lignes de même hauteur dans les deux listes. Aide clavier `hint` sous la liste |
| Arbitrage : bandeau de source | cellule réservée `min-h-6.5` (un bandeau `small`) au-dessus de la liste | composant maison (`MessageComponent` `small`) | « Correspondances incertaines : N » en `text-xs text-muted-color` ; Beatport refusé : `info` et bouton `link` « Revenir à Beatport » ; Beatport injoignable : `warn`. Une phrase, sans animation |
| Arbitrage : décision | « Valider » `primary`, « Aucune correspondance » `secondary` outlined, `size="small"`, `spinner` pendant le geste | PrimeNG | La liste Bandcamp remplace celle de Beatport sans que rien ne bouge. Liste vide : motif centré, « Passer » à la place du refus. Geste refusé en `app-error-message` sous la liste |
| Arbitrage : étape lien | champ de lien + `UrlLinkActionsComponent` (« Passer » `secondary` outlined, « Résoudre » `primary`) | composant maison | Après le refus de la liste Bandcamp ou « Passer » sur une liste vide : même morceau, même cadre, sans compteur |
| Navigation entre morceaux | `button pButton` `secondary` outlined à icône seule (`chevron-left`, `chevron-right`, `[iconOnly]`) + compteur (§ Badges) | PrimeNG | Modales d'arbitrage et du lien, aussi par ← → |
| Modale du lien | `UrlRecoveryDialogComponent` : `p-dialog` modal, sans animation | PrimeNG | Dimensions au § Layout. En-tête de morceau, logo de la source sur un rattrapé. Ouverte par la ligne ou par le badge, aussi après une interruption ; aucune reconnaissance d'hôte à la frappe, le sidecar juge l'URL. En édition démo, deux états propres (décidés le 2026-10-25) : un morceau dont le lien est enregistré a son champ en lecture seule, pré-rempli, « Résoudre » actif ; un morceau sans lien enregistré a « Résoudre » grisé, avec `demo.unavailable` en tooltip (`TOOLTIP`) |
| Confirmation d'un geste sur les fichiers | `DangerConfirmComponent` + `injectDangerConfirm` (`p-confirmdialog`) | composant maison (PrimeNG) | Écriture, relance, restauration. Message en `text-sm text-muted-color` `whitespace-pre-line`, interpolé plutôt qu'en `innerHTML` (un chemin y figure) ; celui de la restauration dit que la pochette écrite reste en place ([ADR-011](adrs/011-politique-ecriture-tags.md)). Acceptation `danger` pour la seule restauration, `primary` sinon ; « Annuler » `secondary` outlined avec le focus, sans icône devant le message |
| Confirmation de sortie | `CloseConfirmationComponent` : `p-dialog` modal | composant maison (PrimeNG) | Fermeture pendant une extraction, une écriture ou une restauration : « Rester » `primary` avec le focus, « Quitter quand même » `secondary` outlined ; « Rester » seul pendant l'écriture ou la restauration. Ni `p-confirmdialog` ni `danger` : la sortie ne touche aucun fichier musical |
| Tooltip | `pTooltip` lié à `TOOLTIP` ou `WIDE_TOOLTIP` | PrimeNG | Sous l'élément, retourné au-dessus quand la place manque. 12.5rem (défaut d'Aura), 26rem en `WIDE_TOOLTIP` (texte tronqué, détail du rapport, motif d'échec, avertissement d'envoi du rapport). `pointer-events: none`. Délai au § Composants Animés, usage au § Conventions de Code > Règles |
| Reprise d'un run interrompu | `ResumeDialogComponent` : `p-dialog` modal non fermable, `w-120` | composant maison (PrimeNG) | Au démarrage, quatre états (run reprenable, dossier introuvable ou vidé, plan illisible, plan corrompu), dossier sur sa ligne tronqué à gauche. « Repartir de zéro » texte `secondary` ; « Reprendre » `primary` si le dossier existe, sinon « Plus tard » texte `secondary`. Aucun bouton focalisé : Entrée ne supprime jamais le plan. Le focus va au corps (`tabindex="-1"`), sans quoi il reste derrière le masque et Tab parcourt la page |
| Invite de mise à jour | `UpdateDialogComponent` : `p-dialog` modal `w-120`, fermable sauf pendant le téléchargement, Échap compris ; focus sur le corps (`tabindex="-1"`) comme la reprise | composant maison (PrimeNG) | Au démarrage, différée comme les autres modales, ou depuis la rangée Version ; une invite de reprise ou un travail du moteur la renvoie au badge. Versions proposée et installée, « Voir les nouveautés » en bouton `link` vers la Release. « Plus tard » texte `secondary`, « Installer » `primary`, désactivé pendant un travail du moteur (tooltip). Téléchargement : `PhaseProgressComponent` et phrase de fermeture, sans bouton. « Réessayer » remplace « Installer » sur un échec (`MessageComponent` `error`) ou une installation non aboutie (`MessageComponent` `warn` en tête) |

### Contenu et texte

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Texte tronqué | `TruncatedTextComponent` | composant maison (`pTooltip`) | Ellipse, tooltip `wide` sur un texte coupé seulement, `rtl` pour couper un chemin par la gauche |
| Sans valeur | `NoValueComponent` | composant maison | Cellule sans valeur (§ États des Composants) |

### Identité

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Nom de l'application | Logo de l'application (`public/logo.png`, celui de l'installeur) en `size-5`, puis le nom en `text-sm` 600 | Tailwind | À gauche de la barre d'onglets, même nom et même icône que la fenêtre |
| Logo de source | `SourceLogoComponent` | composant maison (Simple Icons) | Beatport, Bandcamp, SoundCloud et VLC en `currentColor`, aux tailles des icônes (§ Icônes) |
| Source retenue | `SourceLabelComponent` : `SourceLogoComponent` 16px + nom de marque | composant maison (Simple Icons) | Colonne Source de la liste, ligne Source du détail |

### Post-MVP (non installés)

> Chaque entrée rejoint sa famille ci-dessus au moment de son installation.

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Bascule du mode agent IA | `p-toggleswitch` dans les Réglages | PrimeNG | Avec l'agent d'arbitrage, cf. [ARCHITECTURE.md § Évolutions Futures](ARCHITECTURE.md#-évolutions-futures-post-mvp) |

## États des Composants

> Les composants PrimeNG portent leurs états (hover, focus, disabled, invalid) par le preset. Ce tableau couvre les éléments custom écrits from scratch.

| État | Style / Comportement | Contexte |
|------|---------------------|----------|
| Survol d'une zone cliquable custom | `bg-emphasis`, `transition-colors` : 200ms `ease-out` par défaut du `@theme`, la durée des composants PrimeNG | Lignes actionnables de la liste du run, sans déplacement ni scale. Les badges de la barre d'onglets s'en passent : leur tag porte déjà un fond |
| Survol d'une surface inerte | Aucun | Lignes non actionnables, cellules, libellés |
| Sélection | `bg-highlight` | Ligne dépliée de la liste du run, entrée active du menu des Réglages, comme l'option choisie de `p-select` et `p-listbox`. Le survol reste gris (`bg-emphasis`) |
| Focus clavier | Anneau du preset (1px `primary`, à la couleur de sa sévérité sur un bouton `secondary` ou `danger`), recopié en `focus-visible:outline-1 outline-primary` `-outline-offset-2` sur une ligne actionnable. Un champ, lui, passe sa bordure en `primary`, sans anneau | Vers l'intérieur : le défilement de la table rognerait un anneau extérieur. `outline: none` interdit |
| Désactivé | `--p-disabled-opacity` (0.6) sur les boutons et les curseurs des seuils ; fond `disabled` à opacité 1 sur les champs, `p-select`, `p-selectbutton` et `p-toggleswitch` ; flèche de la souris | Libellé gardé, jamais masqué, raison en tooltip. Flèche comme dans une application Windows, `not-allowed` étant une convention web |
| Chargement | `p-skeleton` aux dimensions de l'élément final ; `spinner` dans le bouton d'un geste en attente | Aucun saut de layout. Le `spinner` remplace `[loading]` de `pButton`, déprécié |
| Sans valeur | Cadratin en `text-muted-color` (§ Séparateurs) | Cellule d'une ligne qui existe sans donnée de la source : Source et Score d'un non résolu, Après s'il n'est pas rattrapable |
| Curseur | La main sur ce qui est cliquable et actif, la flèche ailleurs et sur un contrôle désactivé, `text` sur les seuls champs de saisie (CSS global) | Piste d'un `p-slider` actif en `cursor-pointer` |
| Vide | Icône 24px en `text-muted-color`, titre en `text-base`, une phrase en `text-sm text-muted-color` qui dit le geste qui débloque | Extraction ou run pas lancé, dossier sans fichier audio, playlist vide, récapitulatif sans run, sans correspondance ou introuvable. Dans une table, `border-b-0` sur la cellule du `#emptymessage` |

---

# 🖼️ Icônes

**Librairie UI** : `@primeicons/angular` 8 : composants standalone en SVG inline, sans police ni classes `pi pi-*`, rendus par `IconComponent`

**Librairie logos** : [Simple Icons](https://simpleicons.org), quatre tracés recopiés dans `SourceLogoComponent` (sources dans `src/assets/icons/`)

**Logo de l'application** : `public/logo.png`, le dessin de l'icône de l'installeur (`src-tauri/icons/`) sur fond transparent, pour la barre d'onglets (20px) et le favicon

| Logo | Où |
|------|-----|
| Beatport, Bandcamp, SoundCloud | Colonne Source de la liste du run et du récapitulatif, ligne Source du détail, en-tête des modales d'arbitrage et du lien |
| VLC media player | Bouton de la playlist et résumé de l'extraction, sur un dump VLC reconnu |

**Règles** :

- Toute icône passe par `IconComponent`, dont le nom est une union des icônes employées (tree-shaking), couverte par un test. Seule exception, les trois glyphes de 10px des boutons de fenêtre, tracés dans `WindowControlsComponent` : ni le jeu d'`IconComponent` ni ses tailles n'ont ceux de Windows
- Taille cohérente par contexte : `16px` inline, dans les tables, les tags, les boutons et un message `small` ; `20px` dans un message et pour le logo d'en-tête de modale ; `24px` dans un état vide et sur une pochette absente en grand. Posée en `width` / `height` sur le SVG, jamais en `font-size`
- `currentColor` obligatoire sur les SVG : la couleur vient du contexte, jamais du fichier
- Aucune action destructive n'est signalée par une icône seule : rollback et confirmation d'écriture portent toujours un libellé traduit
- Dans un menu (barre d'onglets, menu des Réglages), une icône 16px précède chaque libellé. Titres de page et de section en texte nu

---

# ✨ Animations & Motion

## Librairie(s)

| Librairie | Rôle | Périmètre |
|-----------|------|-----------|
| Angular (`animate.enter`) | Entrée d'un élément | Hôtes de page, écran bloquant, formulaire et résumé de Playlist, erreur contextuelle, invite de reprise, invite de mise à jour, pochette |
| `tailwindcss-primeui` | Utilitaires d'animation | `animate-fadein`, `animate-duration-*`, `animate-ease-out`, combinés dans `FADE_IN` |
| PrimeNG | Transitions de ses composants, en CSS | Modales, toasts, onglets, squelettes, `p-message`. Une modale se coupe par `motionOptions` et `maskMotionOptions` (`NO_MOTION`) |

Aucune dépendance d'animation dédiée.

## Principes Directeurs

- **Intensité** : `subtile`, pour un outil de production
- **Durée standard** : 200ms pour les fondus d'entrée, la barre de progression et les transitions de couleur, celle d'Aura (`transition.duration`). PrimeNG garde ses durées (22.1.2, relevé le 2026-10-16) : modales et `p-message` 300ms, tooltip 250ms, boucles de chargement de 1.2s à 2.1s
- **Easing** : `animate-ease-out`
- **Intention** : rendre lisible un changement d'état, jamais décorer
- **Mouvement réduit** : sous `prefers-reduced-motion: reduce` (animations coupées dans Windows), le CSS global coupe les fondus `animate-*` et les entrées et sorties de PrimeNG (modales, messages, toasts), seul `!important` toléré (§ Anti-Patterns). Restent les transitions de couleur et de largeur, le fondu du tooltip (piloté en JS) et les boucles de chargement, qui disent qu'un travail tourne

## Composants Animés

> Éléments custom, plus les composants PrimeNG dont les paramètres sont une décision projet : modales de morceau sans animation, `p-message` dans une cellule réservée, délai du tooltip, transition de la barre. Les transitions de survol vivent au § États des Composants.

| Composant | Type d'animation | Librairie | Trigger |
|-----------|-----------------|-----------|---------|
| Modales d'arbitrage et du lien | **Aucune** (`NO_MOTION`) | PrimeNG | Ouverture : la décision est sur le chemin critique du run |
| Contenu d'un onglet | Fondu, opacité seule | `FADE_IN` + `animate.enter` sur l'hôte de page | Changement d'onglet, ouverture du récapitulatif. La barre `p-tabs` reste hors du conteneur animé |
| Écran bloquant, erreur contextuelle, invite de reprise | Fondu | `FADE_IN` + `animate.enter` | Montage |
| Invite de mise à jour | Fondu du corps qui entre | `FADE_IN` + `animate.enter` | Proposition, téléchargement, échec : à chaque changement d'état |
| Formulaire et résumé de Playlist | Fondu de celui qui entre | `FADE_IN` + `animate.enter` | Repli au lancement, « Modifier » |
| Message inline dans une cellule réservée | **Aucune** (`[animated]="false"`) | PrimeNG | Bandeaux de source de l'arbitrage, « Rattrapé sur » du lien |
| Vignette de pochette | Fondu | `FADE_IN` + `animate.enter` | URL de la pochette connue |
| Tag d'état | Transition de couleur 200ms | CSS | `arbitration_required`, `track_resolved` |
| Barre de progression | Largeur suivie en 200ms `ease-out` | `[pt]` sur l'élément `value` de `p-progressbar` | Chaque `progress`. La transition de 1s de PrimeNG laissait la barre en retard sur le run |
| Tooltip | Fondu de 250ms après 400ms de survol, rien à la disparition | PrimeNG + `showDelay` du jeu `TOOLTIP` | Survol maintenu |

---

# 📐 Layout & Espacement

## Structure de Page

| Élément | Valeur | Usage |
|---------|--------|-------|
| Fenêtre | 1280 × 800 à l'ouverture, plancher 1024 × 700, sans plafond, sans décorations : la barre d'onglets tient lieu de barre de titre | Plancher dicté par les sept colonnes de la liste du run (`tauri.conf.json`, cf. [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives)) |
| Shell | Barre `p-tabs` en haut, contenu sur le reste de la hauteur | La page ne défile jamais, le scroll vit dans la table. `overscroll-behavior: none` coupe le rebond de WebView2 |
| Contrôles de fenêtre en démo | Masqués dans la barre d'onglets comme dans celle de l'écran bloquant, avec le filet qui les précède ; la base du nom passe de `4rem + 147px` à `4rem` (engrenage et `pl-4`) | Une page de navigateur n'a ni fenêtre à réduire ni à fermer (édition démo, décidé le 2026-10-25). Sans ce réglage, Playlist et Tagging glisseraient de 69px à droite du centre (mesuré à 1024px) ; à `4rem`, écart nul (décidé le 2026-10-26) |
| Rendu téléphone de la démo | Page déclarée à `width=1280` par `index.demo.html` seulement | Le téléphone affiche l'app entière réduite, le visiteur zoome puis fait glisser ; `src/index.html` ne change pas. Décidé le 2026-10-25, options dans `docs/superpowers/specs/demo-web-publique/02-telephone-options.html` |
| Container | Pleine largeur, `px-16 py-8`, porté par le shell | Tous les écrans : formulaire et table sur la même largeur, la pleine largeur servant Avant et Après |
| Densité | `text-sm` dans les tables et les listes de candidats | Une ligne de plus visible par cran |
| Bloc principal | `panel` (`rounded-lg border-surface bg-surface-900`), jusqu'en bas de la page | Le même cadre vide ou rempli : bloc vide, table (par `fullHeightTable`), panneau des Réglages (menu des sections à gauche, séparé par un filet, une section à la fois sans défilement ; seuls plusieurs retours empilés au plancher font défiler la section dans son panneau) |
| Padding d'une surface | `p-6` panneau (bloc vide, section des Réglages), `p-4` détail déplié, `p-2` menu des Réglages (token `list.padding`) ; 18px d'Aura dans les modales et les cartes (`1.125rem`) | Plus la surface est grande, plus le padding l'est |
| Hauteur de contrôle | 28px (`size="small"`) ; à icône seule, carré de 28px (`[iconOnly]`), croix des modales et des toasts comprise ; `p-selectbutton` aussi (preset : padding `sm` à 2px, Aura le pose à 32px), son cadre entourant les segments | Sans `[iconOnly]`, un bouton à icône seule serait plus large que haut |
| Modale d'arbitrage | 720 × 560px, liste de 268px à scroll interne | Figée quel que soit le nombre de candidats, étape lien comprise, tenue sans défiler au plancher : rien ne se décale entre deux clics rapides |
| Modale du lien | 720px, hauteur au contenu, erreur réservée `min-h-13.5`, `pb-4` | `min-h-13.5` (54px) : une erreur de deux lignes en FR sans déplacer le pied |
| Modales de texte | 30rem (`w-120`) : confirmation d'un geste sur les fichiers, invite de reprise, invite de mise à jour, écran bloquant (centré dans la page en `p-8`) ; 32rem (`w-128`) pour la confirmation de sortie | 32rem mesurés sur le titre et les deux boutons en français |
| Tables | `p-table` à sa taille par défaut, `scrollHeight="flex"`, `[virtualScroll]` | `virtualScrollItemSize` égal à la hauteur exacte d'une ligne (`h-14` liste du run, `h-10.25` rapport), à remesurer si leur style change. Un contenu plus haut s'étale sur plusieurs lignes, jamais dans une ligne qui grandit |
| Détail déplié | 7 lignes de la liste (`h-14`), 4 pour des tags illisibles | 7 : 15 lignes de champs au plus en `text-xs` (mesuré le 2026-10-10) et « Restaurer ce morceau » sous la pochette de 168px. 4 : la phrase des tags illisibles à côté d'elle. Au-delà, le détail défile ; à remesurer si la grille change |
| Rythme interne d'un groupe | `gap-2` | Ce qui forme un tout : icône et libellé, champ et son bouton, boutons voisins d'un pied |
| Espacement entre groupes | `gap-4` | Ce qui reste distinct sur une ligne : cellules d'une rangée de formulaire, contrôles indépendants |
| Espacement entre sections | `gap-6` | Blocs d'un écran : titre, actions, barre de progression, bloc principal |
| Écarts hors échelle | `gap-3` et `py-3` (12px), `gap-0.5` et `py-0.5` (2px) | `gap-3` : en-tête de modale de morceau (l'écart des actions d'en-tête), retour après une aide dans une rangée des Réglages (le `py-3` de la rangée, `mt-1` en premier). `gap-0.5` : nom de fichier collé au titre d'une modale de morceau. `py-0.5` : lignes du détail, pour que tous ses champs tiennent dans les lignes que la liste lui réserve |
| Grid principal | Flexbox et CSS Grid natifs | Aucune librairie de grid |

**Colonnes de la liste d'un run** :

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Chevron | 48px (`w-12`) | Bouton à icône seule (28px) plus la marge gauche de sa cellule, sans marge droite |
| Pochette | 60px (`w-15`) | Vignette de 32px plus les marges de la cellule |
| Avant | **fluide** | Artiste et titre lus dans le fichier, nom du fichier en sous-texte `text-xs text-muted-color`. Tags vides : le nom de fichier sans extension en ligne principale |
| Après | **fluide** | Ce que la source retenue va écrire |
| Source | 144px (`w-36`) | Logo 16px et libellé, mesurée sur « SoundCloud » |
| Score | 128px (`w-32`) | Aligné à droite, mesurée sur `A 100 · T 100` |
| État | 192px (`w-48`) | Tag et icône info, mesurée sur « Échec d'écriture » |

Colonnes fixes figées, leur contenu arrivant pendant le run, chacune mesurée sur son contenu le plus large dans les deux langues : le reste va aux deux colonnes comparées. Source dit d'où vient la donnée écrite, État par quel chemin (`state` et `resolution`). Le nom de fichier est un sous-texte plutôt qu'une colonne : c'est la requête quand les tags manquent. Le score tient en trois nombres : un seul cacherait lequel des deux fait tomber le morceau en zone grise.

**Colonnes du rapport d'extraction** :

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Fichier | **fluide** | Nom du fichier, tronqué et révélé au survol |
| État | 197px (`w-49.25`) | Tag et icône info, mesurée sur « Doublon départagé », le plus long des libellés |

Sans largeur figée, État bougerait au fil du défilement virtuel. Les deux tables sont en `table-layout: fixed` (`fullHeightTable`).

**Onglet Playlist** : formulaire en `grid-cols-[max-content_max-content_1fr]` `gap-4` (libellés, contrôles de même largeur, chemins à droite, « Extraire la playlist » sur la ligne du mode, à la largeur des libellés et des contrôles réunis). Le résumé de lancement (source › destination › playlist · mode) le remplace (§ Composants Animés) et le rapport récupère sa hauteur.

**Onglet Tagging** : le titre, puis la ligne du dossier en `grid-cols-[max-content_1fr_max-content]` (sélection, chemin collé, bouton d'action calé à droite), sans libellé : le bloc vide dit quoi faire.

## Responsive

> Approche : `desktop-only`. Application de bureau Windows, aucune cible mobile ni tactile.

| Breakpoint | Notation Tailwind | Largeur | Changements clés |
|------------|-------------------|---------|------------------|
| Base | (défaut) | ≥ 1024px, plancher de la fenêtre | Sept colonnes au complet, le redimensionnement absorbé par Avant et Après. Au plancher, l'en-tête du récapitulatif et le résumé de Playlist passent à la ligne (`flex-wrap`) |

Un jeu de colonnes qui tient au plancher plutôt qu'un masquage progressif : personne n'a à retenir quelle information disparaît à quelle taille.

---

# 🔧 Conventions de Code

## Composition de Styles

**CSS pur, aucun SCSS** : Tailwind v4 ne le compile pas. Un seul fichier d'entrée, `src/styles.css` : police, Tailwind, plugin, variant `dark`, `@theme`, utilitaires de rôle et règles globales (rebond de WebView2, curseur, tooltip, mouvement réduit).

**Utilitaire** : classes Tailwind dans le template, conditionnées par `[class.x]` ou `[ngClass]`. Le DOM interne d'un composant PrimeNG se règle par `[pt]`, ou dans le preset quand l'écart vaut partout.

**Rôles partagés** : un `@utility` de `styles.css` (`page-host`, `panel`, `hint`, `settings-rows`) pour un rôle répété d'un écran à l'autre, employé comme toute classe pour qu'il ne dérive pas ; le preset pour un rôle d'un composant PrimeNG (bouton à icône seule, bouton `link`).

**Preset** : `TECHNO_TAGGER_PRESET` dérive d'Aura par `definePreset()` et n'y change que ce que ce document décide : rayons de la carte (`lg`), du tag et du badge (`sm`), badge en 12px, carte sans ombre, libellé de champ en 14px 400, en-tête, croix et pied des modales (§ Overlays), croix du toast, bouton à icône seule carré et bouton `link` en lien de texte, onglet centré, `info` de `p-message` en `sky`.

**Cascade** : `cssLayer: { name: 'primeng', order: 'theme, base, primeng' }` dans `providePrimeNG()` : les classes Tailwind gagnent sur les styles de composant.

**Ordre des classes** : réordonné au format par `prettier-plugin-tailwindcss`, aucune convention manuelle.

## Règles

- ✅ **Composant PrimeNG d'abord** : aucun composant custom tant que la bibliothèque en fournit un équivalent (cf. [ADR-003](adrs/003-primeng-community-license.md))
- ✅ **Trois niveaux de personnalisation, dans cet ordre** : `definePreset()` pour ce qui vaut partout, `[dt]` pour les tokens d'une instance, `[pt]` pour les éléments internes. La doc PrimeNG recommande `[dt]` contre `::ng-deep` (Theming, Scoped Tokens)
- ✅ **Une largeur se mesure sur le contenu le plus long, dans les deux langues** (cf. [ADR-004](adrs/004-i18n-ngx-translate.md)) : un bouton ou un libellé n'a aucune largeur en dur ; une colonne de table se fige sur son plus long contenu, sinon elle bouge au défilement
- ✅ **Boutons en `size="small"` partout**, confirmations comprises. Seuls les boutons `link` y échappent
- ✅ **Un tooltip révèle, il ne porte pas** : il montre ce qui est déjà à l'écran mais coupé, jamais un libellé, une aide ou une erreur. Quatre exceptions : la raison d'une action désactivée, l'avertissement d'« Envoyer ce rapport » (ticket GitHub public, noms de fichiers, cf. [ADR-014](adrs/014-observabilite-sentry-et-rgpd.md) ; l'issue s'ouvre pré-remplie pour relecture avant envoi), le détail d'une ligne du rapport et le motif d'un morceau en échec, ces deux derniers annoncés par une icône `info-circle` en `text-muted-color` hors de tout tag
- ✅ **Tout `pTooltip` se lie à `[tooltipOptions]`** (`TOOLTIP` ou `WIDE_TOOLTIP`) : PrimeNG n'a aucun défaut global, sans ce jeu il s'ouvre à droite et sans délai. Jamais de `[showDelay]` ni de `[tooltipPosition]` sur l'instance
- ✅ **Aucun libellé en dur dans un template** : tout passe par ngx-translate, erreurs du sidecar comprises (`code` + `params`)
- ✅ **Une phrase par ligne** : chaque phrase d'un message sur sa ligne par un `\n` de traduction, une ligne vide entre les blocs d'une modale longue, rendu en `whitespace-pre-line`. Exceptions, pour qu'une cellule réservée reste immobile : le bandeau de source de l'arbitrage (une phrase), le motif d'un non résolu dans la modale du lien (deux lignes de `text-xs`) ; l'aide de la clé API tient sur une ligne ; le bandeau de démo garde ses deux phrases sur sa ligne de 32px
- ✅ **Modale d'arbitrage au clavier** : flèches entre arbitrages, Entrée pour valider, focus visible en permanence

## Anti-Patterns

- ❌ **`::ng-deep`** : du style qui casse à la première mise à jour et qu'aucune recherche ne retrouve. Passer par `[dt]` ou `[pt]`
- ❌ **`!important`** : l'ordre des couches est en cause, à corriger dans `cssLayer`. Seule exception, la coupure des animations sous `prefers-reduced-motion`
- ❌ **Couleurs en dur** : ni hex, ni `bg-emerald-500`. Un changement de preset doit rester un changement de preset
- ❌ **Styles inline `[style]`** : réservés aux valeurs calculées à l'exécution (largeur d'une barre, position d'un élément virtualisé)
- ❌ **Logique métier dans un composant** : scores, seuils et classement viennent du sidecar. L'interface ne dérive que les trois états du § Couleurs Sémantiques et les groupes du filtre du récapitulatif (cf. [ARCHITECTURE.md § Frontend](ARCHITECTURE.md#-frontend) et [§ API](ARCHITECTURE.md#api))
- ❌ **Animation sur le chemin de décision** : rien ne s'anime entre un `arbitration_required` et l'affichage des candidats

---

# 🔗 Ressources

## Maquette et design system externes

- **Design system** : [Techno Tagger Design System](https://claude.ai/design/p/66daf6c5-f225-4dcc-bf7d-1d792e633ee5) : miroirs JSX, typages et fiches d'usage des composants du mapping, plus les tokens et les guidelines. Bâti depuis ce document, qui l'emporte sur les règles et les composants
- **Maquette** : le même projet, dossier `ui_kits/techno-tagger/` : un fichier par écran (Playlist, Tagging, Réglages), la modale d'arbitrage et le shell. Fait foi sur l'apparence d'un écran là où ce document se tait
- **Synchronisation et lecture locale** : procédure, journal et export local dans `.design-sync/NOTES.md`

### Arbitrages

Écarts au design system ou à la maquette tranchés par le propriétaire. Ils priment sur eux pour tous les écrans. Un écart réaligné dans la maquette sort de cette liste : sa règle vit dans sa section, son historique dans git et `.design-sync/NOTES.md`.

- **Icônes** : SVG inline par `IconComponent` et `SourceLogoComponent`, là où le design system rend les glyphes par la police PrimeIcons. Écart définitif : React n'importe pas un composant Angular
- **Marque de la barre d'onglets** : logo de l'application en `size-5`, là où `AppShell` pose le glyphe `tag` sur une tuile `bg-highlight`. Décidé le 2026-10-22
- **Barre de titre** : barre d'onglets fusionnée avec la barre de titre de Windows, en 40px avec les boutons de fenêtre à droite, là où `AppShell` garde la barre système au-dessus des onglets. Décidé le 2026-10-22

## Documentation Officielle

- [PrimeNG : Theming](https://primeng.dev/theming) : design tokens, `definePreset()`, `darkModeSelector`, tokens scopés `[dt]`
- [PrimeNG : Configuration](https://primeng.dev/configuration) : `providePrimeNG()`, licence, ripple (désactivé par défaut)
- [PrimeNG : Tailwind CSS](https://primeng.dev/tailwind) : installation, classes issues des tokens, utilitaires d'animation, dark mode
- [PrimeNG : PassThrough](https://primeng.dev/passthrough) : API `[pt]`, locale et globale
- [PrimeNG : Table](https://primeng.dev/table) : `scrollHeight="flex"`, scroll virtuel
- [PrimeNG : Tooltip](https://primeng.dev/tooltip) : `tooltipOptions`, aucun défaut global
- [Tailwind CSS : Dark mode](https://tailwindcss.com/docs/dark-mode) : `@custom-variant`
- [PrimeIcons](https://primeicons.dev) : catalogue, catégories, recherche
- [Angular : Enter and Leave animations](https://angular.dev/guide/animations) : `animate.enter` / `animate.leave`
- [Angular : Signal Forms](https://angular.dev/guide/forms/signals/overview) : `form()`, `[formField]` des Réglages
- [Simple Icons](https://simpleicons.org) : logos Beatport, Bandcamp, SoundCloud, VLC media player
- [Fontsource : polices variables](https://fontsource.org/docs/getting-started/variable) : paquet `@fontsource-variable/inter`, import `wght.css`

## Ressources Complémentaires

- [tailwindcss-primeui](https://github.com/primefaces/tailwindcss-primeui) : classes des tokens et utilitaires d'animation
- [primeng#17946](https://github.com/primefaces/primeng/issues/17946) et [tailwindcss-primeui#27](https://github.com/primefaces/tailwindcss-primeui/issues/27) : l'incompatibilité SCSS de Tailwind v4
- [knowledges/primeng.md](knowledges/primeng.md) et [knowledges/tailwindcss.md](knowledges/tailwindcss.md) : fiches techniques du projet
- [ARCHITECTURE.md](ARCHITECTURE.md) : stack, écrans, contrat NDJSON et modes de panne à couvrir visuellement
- [VERSIONS.md](VERSIONS.md) : versions exactes de PrimeNG, `@primeuix/themes`, `@primeicons/angular`, Tailwind CSS et Inter
- [ADR-003](adrs/003-primeng-community-license.md) : PrimeNG sous Community License, preset Aura, `definePreset()` comme seule voie de personnalisation **du thème**, le Theme Designer n'étant pas inclus
- [ADR-004](adrs/004-i18n-ngx-translate.md) : bascule FR / EN à l'exécution, contrainte d'élasticité des libellés
