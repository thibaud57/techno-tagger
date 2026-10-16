---
title: "DESIGN — techno-tagger"
description: "Design system : typographie, couleurs, librairies UI, mapping composants et conventions de style de l'interface Angular + PrimeNG."
date: "2026-10-16"
keywords: ["design", "ui", "design-system", "typography", "colors", "animations", "layout", "dark-mode", "icons", "desktop", "components", "spacing", "primeng", "tailwind"]
scope: ["docs", "frontend"]
technologies: ["Angular", "PrimeNG", "Tailwind CSS", "tailwindcss-primeui", "PrimeIcons", "Simple Icons", "Inter", "Tauri"]
---

# 🎨 Identité Visuelle

## Typographie

### Police Principale

**Famille** : `Inter Variable`

**Source** : `@fontsource-variable/inter`, import `wght.css` (poids 100 à 900 en un fichier), embarquée dans le bundle. Aucun CDN : rendu identique hors ligne, sans attente d'un `fonts.googleapis.com` injoignable

**Usage** : toute l'interface

**Tokens** : `--font-sans` (fallback `system-ui, sans-serif`), déclaré dans le `@theme` du CSS global, exposé en classe `font-sans`. Aura déclare `fontFamily: 'inherit'`, rien n'est à défaire de son côté

### Scale Typographique

> Une seule taille par niveau : l'application étant `desktop-only`, aucun n'a de palier responsive.

Base 16px, imposée par l'import `@primeuix/themes/aura` en version non-`compat` (cf. [ADR-003](adrs/003-primeng-community-license.md)).

| Usage | Taille | Poids | Classe |
|-------|--------|-------|--------|
| H1 (titre d'écran) | 1.5rem (24px) | 600 | `text-2xl font-semibold` |
| H2 (section) | 1.25rem (20px) | 600 | `text-xl font-semibold` : titres de section des Réglages (« API », « Administration »), affichés une à la fois |
| H3 (titre de modale) | 1.125rem (18px) | 600 | `text-lg font-semibold` : gabarits `#header` des modales, titre de l'écran bloquant. Les confirmations `p-confirmdialog` gardent le titre d'Aura, de même taille et de même poids |
| Body | 1rem (16px) | 400 | `text-base` : titre d'un bloc vide |
| Body dense (tables, listes de candidats) | 0.875rem (14px) | 400 | `text-sm` |
| Label (libellé de champ) | 0.875rem (14px) | 400 | `label pLabel`, taille et poids posés par le preset ; `text-sm` sur un `span` quand le contrôle est un groupe sans `<label>` (mode de Playlist, rangées des Réglages) |
| Caption (scores, compteurs, aides) | 0.75rem (12px) | 400 | `text-xs` |

Les écrans de données tournent en body dense : chaque cran de taille en moins est une ligne de plus visible sans défiler. Les chiffres qui se comparent d'une ligne à l'autre (scores, compteurs, progression) prennent `tabular-nums`. Hors composants PrimeNG, le seul poids 600 hors des titres est l'indice de rattrapage (§ Tables et listes).

Les composants PrimeNG gardent la typographie d'Aura : seul le libellé de champ est ramené par le preset.

### Séparateurs

Trois glyphes, trois rôles qui ne se recouvrent pas : un glyphe employé pour deux rôles et la ligne cesse de se lire d'un coup d'œil.

| Glyphe | Rôle | Exemple |
|--------|------|---------|
| `-` entouré d'espaces | Artiste et titre d'un même morceau | `Adam Beyer - Your Mind` |
| `·` | Deux valeurs de même rang | `A 96 · T 92`, `Drumcode · 2023` |
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
| `--p-surface-900` | `{zinc.900}` | `bg-surface-900` | Panneau d'un bloc vide hors table |
| `--p-surface-800` | `{zinc.800}` | `bg-surface-800` | Cadre d'une pochette absente |
| `--p-surface-600` | `{zinc.600}` | `text-surface-600` | Clé d'un champ du détail, à côté du libellé |
| `--p-text-color` | `{surface.0}` | `text-color` | Texte principal |
| `--p-text-muted-color` | `{surface.400}` | `text-muted-color` | Texte atténué, placeholders, aides, chemins |
| `--p-content-border-color` | `{surface.700}` | `border-surface` | Bordures et filets |
| `--p-highlight-background` | `color-mix(in srgb, {primary.400}, transparent 84%)` | `bg-highlight` | Sélection : ligne dépliée de la liste du run, entrée active du menu des Réglages |
| `--p-content-hover-background` | `{surface.800}` | `bg-emphasis` | Survol d'une ligne actionnable |
| `--p-datatable-row-background` | `{content.background}` | par `fullHeightTable` | Fond de ligne étiré sur toute la hauteur d'une table |
| `--p-datatable-body-cell-border-color` | `{surface.800}` | `border-(--p-datatable-body-cell-border-color)` | Filet des lignes squelette, celui des vraies lignes |
| `--p-disabled-opacity` | `0.6` | par le preset | Boutons et curseurs désactivés ; champs, sélecteurs et bascules prennent leur fond `disabled` |
| `--p-focus-ring-*` | 1px solid, `{primary.color}`, offset 2px | par le preset | Anneau de focus clavier |

Le plugin expose deux familles de classes à ne pas confondre : des **tokens combinables** avec n'importe quel préfixe Tailwind (`primary`, `surface-{0..950}`, d'où `bg-surface-950` ou `outline-primary`) et des **classes complètes**, préfixe déjà inclus, à écrire telles quelles (`text-color`, `text-muted-color`, `border-surface`, `bg-emphasis`, `bg-highlight`).

Valeurs lues dans `@primeuix/themes` 3.0.1 installé (`dist/aura/`, le 2026-10-16), le dépôt `primeuix` étant archivé ; classes dans la [doc Tailwind de PrimeNG](https://primeng.dev/tailwind).

### Couleurs Sémantiques

Le design system ne connaît pas la liste des états d'un morceau, seulement **quatre familles** auxquelles chacun se rattache. L'énumération exacte vit dans le contrat NDJSON, en trois champs `state` / `resolution` / `failure_reason` (cf. [ARCHITECTURE.md § API](ARCHITECTURE.md#api)) : elle peut s'allonger sans qu'aucune couleur soit à inventer.

| Famille | Sévérité | Icône type | Source | Ce qu'elle couvre |
|---------|----------|------------|--------|-------------------|
| Neutre | `secondary` | `clock`, `minus-circle`, `undo` | dérivée et `state` pour `rolled_back` | Le morceau attend son tour, le run s'est arrêté avant lui, ou ses fichiers ont retrouvé leur état d'origine |
| Décision attendue | `info` | `info-circle` | dérivée | `arbitration_required` reçu sans `track_resolved` derrière : le morceau attend un geste humain |
| Résolu | `success` | `check` | `state` | `resolved` et `written` |
| Échec | `danger` (`error` sur `p-message`) | `times`, `exclamation-triangle` | `state` | `unresolved` et `write_error` |

Les sévérités, déjà câblées dans `p-tag`, `p-badge`, `p-message` et `pButton`, suivent le preset sans maintenance : `p-tag` et `p-badge` teintent `info` en `sky`, `p-message` en `blue`.

**Trois états sont dérivés par l'interface**, faute d'événement : « en attente » pour ce qu'elle n'a pas encore reçu, « non traité » pour ce qu'un run interrompu n'a jamais atteint, « à arbitrer » pour une demande restée sans réponse. Les autres se lisent sur `state`.

**Bleu plutôt qu'orange sur la décision attendue** : un arbitrage qui attend est une étape normale, pas une anomalie (choix posé dans [BRAINSTORM.md](BRAINSTORM.md)). `warn` n'est donc porté par aucun état de morceau : il reste aux avertissements qui ne concernent pas une ligne.

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

- **Auto contre Arbitré** : un morceau validé automatiquement à 94 est l'endroit le plus probable d'un mauvais match, puisque personne ne l'a regardé. Un glyphe ne se décode pas assez vite dans un tableau dense pour porter cette différence, le libellé si
- **Horloge contre `minus-circle`** : une horloge promet une suite, ce qu'un run interrompu ne tiendra pas. Le `minus-circle` dit l'inverse sans changer de famille
- **Restauré reste neutre** : ni écrit ni en échec, le morceau n'a aucune voie à montrer en vert ni aucune correction à attendre. `undo` le distingue de l'attente et du non traité
- **Deux rouges, deux icônes** : leurs corrections sont opposées, l'un se rattrape par une URL, l'autre en relançant l'écriture (cf. [ARCHITECTURE.md § Robustesse](ARCHITECTURE.md#%EF%B8%8F-robustesse--modes-de-panne))
- **Libellé d'échec générique, motif au survol** : « Non résolu » couvre plusieurs `failure_reason` de résolution, « Échec d'écriture » plusieurs autres. Les nommer élargirait la colonne État ou la tronquerait : l'icône `info-circle` suit le tag et le motif s'ouvre en tooltip. Un motif est du diagnostic, pas de la colonne de balayage

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
- ✅ L'accent `primary` reste réservé aux actions et à la sélection. Un écran où tout est vert ne signale plus rien
- ✅ Le `danger` **d'une action** est réservé au bouton d'acceptation du rollback, qui défait l'écriture et consomme la sauvegarde des tags d'origine (§ Arbitrages, « Rouge des gestes sur les fichiers »). Sur un `p-tag` ou un `p-message`, la même sévérité ne décide rien : elle rapporte la famille Échec

## Formes

### Border Radius

Primitives du preset Aura. Là où Aura donne un autre cran à un composant, le preset du projet l'y ramène (§ Composition de Styles).

| Token | Valeur | Usage |
|-------|--------|-------|
| `--p-border-radius-xs` | `2px` | Badges |
| `--p-border-radius-sm` | `4px` | Tags, vignettes et cadres de pochette |
| `--p-border-radius-md` | `6px` | **Défaut** d'Aura : champs (`formField.borderRadius`), contenu (`content.borderRadius`), tooltips |
| `--p-border-radius-lg` | `8px` | Cartes, panneau d'un bloc vide |
| `--p-border-radius-xl` | `12px` | Modales (`overlay.modal.borderRadius`) |

### Ombres / Élévation

Aucune ombre posée par le projet : celles d'Aura restent sur les overlays (modales, tooltips, toasts, listes déroulantes), les champs (quasi invisible en dark), la poignée du curseur, le segment actif du `p-selectbutton`, le menu des Réglages et, teintée à 4 %, le `p-message`. Le toast garde le flou `blur(10px)` d'Aura. Le preset retire celle de la carte (`card.root.shadow: none`). La hiérarchie entre surfaces passe par les bordures et les crans de `surface`.

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

Les composants maison vivent dans `shared/components/`, sauf ceux d'un seul écran, rangés dans sa feature. Écrans de référence : [ARCHITECTURE.md § Flux Fonctionnels](ARCHITECTURE.md#flux-fonctionnels-use-cases-critiques).

> `pInputText`, `pInputPassword`, `pLabel`, `pButton` et `pTooltip` sont des **directives** posées sur un élément existant, pas des composants.

### Navigation

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Navigation principale | `p-tabs` synchronisé à la main avec le Router | PrimeNG | Aucun mode router en v22 (`p-tabMenu` supprimé) : l'onglet actif se dérive de l'URL |
| Navigation des Réglages | `p-menu`, une entrée par section, l'active en `bg-highlight` | PrimeNG | Rendu natif (§ Arbitrages), une section affichée à la fois (§ Structure de Page), l'active nommée aussi par `aria-current="page"` |
| Badges de file et de rattrapage | bouton portant un `p-tag` `info`, icône `info-circle` | PrimeNG | À droite de la barre d'onglets, en `gap-2`, masqués sur 0 ; « N à rattraper » masqué aussi pendant la recherche |

### Actions

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Bouton d'action du run | `button pButton` `size="small"` | PrimeNG | Un seul bouton au bout de la ligne du dossier, à la largeur de son libellé, qui suit la phase (tableau ci-dessous) |
| Sélection de chemin | `PathPickerComponent` : `button pButton` `primary` outlined `size="small"` + plugin `dialog` de Tauri | composant maison (PrimeNG, Tauri) | Icône `folder`, logo VLC sur un dump, `file` sur un M3U8. Chemin en `text-muted-color`, tronqué par la gauche. Cellules de la grille de l'appelant (`display: contents`), placement du chemin au § Layout |
| Lancement de l'extraction | `button pButton` `primary` `size="small"` | PrimeNG | Sur la ligne du mode (§ Layout) |
| Modification de l'extraction | `button pButton` `secondary` outlined `size="small"` | PrimeNG | « Modifier », au bout de la ligne de résumé (§ Layout) |
| Passage au tagging | `button pButton` `primary` outlined `size="small"`, icône `arrow-right` | PrimeNG | Sous le rapport. `primary` : étape suivante ; outlined : le plein reste aux lancements et aux validations |
| Restauration | `button pButton` `primary` outlined `size="small"`, icône `refresh`, `spinner` pendant l'opération | PrimeNG | « Restaurer ce morceau » sous la pochette du détail, « Restaurer le run » à droite de la barre d'écriture, « Restaurer le dernier run » dans les Réglages, sa cible dessous en `text-xs text-muted-color`. Ouvre la confirmation d'un geste sur les fichiers |
| Ouverture du récapitulatif | `button pButton` `secondary` outlined `size="small"` | PrimeNG | « Récapitulatif », à droite de la barre d'écriture une fois l'écriture terminée |
| Actions d'administration | `button pButton` `secondary` outlined `size="small"`, icône à gauche (`trash`, `external-link`) | PrimeNG | Rangées Cache et Logs des Réglages, aide sur la ligne du bouton. « Vider le cache » sans confirmation (cache jetable), `spinner` jusqu'à la réponse, taille à sa droite en `text-sm text-muted-color tabular-nums`. Grisés, raison en tooltip |

**Phases du bouton d'action du run** :

| Action | Quand | Libellé, icône | Style |
|--------|-------|----------------|-------|
| `start` | aucun run à confirmer ni à relancer | « Lancer le run », `play` | `primary` |
| `cancel` | recherche en cours | « Interrompre », `stop` | `secondary` outlined, jamais grisé |
| `commit` | run cherché à confirmer | « Confirmer l'écriture », `check` | `primary` |
| `retry` | fichiers en échec d'écriture | « Relancer l'écriture », `refresh` | `primary` |

`cancel` n'a ni `danger` ni confirmation : la recherche n'écrit aucun fichier. `commit` et `retry` ouvrent la confirmation d'un geste sur les fichiers et passent en `spinner` pendant l'écriture.

### Formulaires

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Sélecteur de playlist (dump VLC) | `p-select` `size="small"` | PrimeNG | Option : nom et nombre de morceaux. Un `p-skeleton` à sa hauteur (`--p-form-field-sm-*`) tant que la liste est attendue. Nom long coupé, lu au survol : `contain: inline-size` l'empêche d'élargir la colonne |
| Mode copie / déplacement | `p-selectbutton` `size="small"` | PrimeNG | Copie par défaut |
| Champ de lien | `UrlLinkFormComponent` : `input pInputText` `pSize="small"` `type="url"` + `app-error-message`, boutons par `UrlLinkActionsComponent` | composant maison (PrimeNG) | Modale du lien et étape lien. Au-dessus du champ : cellule réservée `min-h-8` (deux lignes de `text-xs` : motif ou « Rattrapé sur »), puis l'aide `text-xs`. Refus sous le champ. « Résoudre » en `spinner` pendant le geste |
| Clé API | `input pInputPassword` dans un `p-iconfield` + « Enregistrer » `size="small"` | PrimeNG | Jamais préremplie ni relue ([ADR-012](adrs/012-securite-cle-api-keyring.md)). Clé enregistrée : 24 points en placeholder, sans `p-tag`, texte `sr-only` par `aria-describedby`. L'œil, bouton du template (`p-password` déprécié), n'apparaît que pendant une saisie |
| Rangée des Réglages | `SettingsRowComponent` (`features/settings/`) | composant maison (Tailwind) | Grille `grid-cols-[10rem_minmax(0,1fr)]` `gap-x-4`, `py-3`, filet `border-b border-surface`, slots `[rowLabel]` et `[rowControl]`. Libellé seul à gauche, 10rem mesurés sur « Signal sonore de fin ». Aide avec le contrôle : dessous (`pt-2`) ou sur la ligne d'un bouton seul. Retours sous le contrôle (§ Feedback et chargement). Rangées d'une section jointives |
| Runs passés | `p-select` `size="small"` + « Ouvrir le récapitulatif » `secondary` outlined, dans une rangée | PrimeNG | Sous « Restauration ». Sans largeur figée : le dossier est coupé, son tooltip le montre |
| Langue | `p-select` `size="small"`, 9rem (`w-36`) mesurés sur « Français » | PrimeNG | Largeur fixe : le select ne change pas de taille d'une langue à l'autre |
| Bascule des Réglages | `p-toggleswitch`, à droite, aide sur sa ligne | PrimeNG | Signal sonore de fin |
| Seuils de matching | `p-slider` lié à un `p-inputnumber` `size="small"` sans boutons de pas, 4rem (`w-16`) mesurés sur « 100 » ; « Rétablir les valeurs par défaut » en `secondary` outlined, calé à droite sous la section | PrimeNG | Plancher et seuil haut, curseurs sur 0-100 (§ Arbitrages), champs aux bornes croisées |

### Tables et listes

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Rapport d'extraction | `p-table` `[scrollable]`, `[virtualScroll]` | PrimeNG | Deux colonnes (§ Layout), une ligne par morceau plus une par doublon départagé. Ce qui demande un geste en tête : échecs, introuvables, doublons, puis déjà présents et extraits. Catégorie en `p-tag`, détail en tooltip derrière `info-circle`. « Extraction terminée (N sur N) » en `text-sm text-muted-color` sous la table, à droite |
| Liste des morceaux d'un run | `RunListComponent` : `p-table` `[scrollable]`, `[virtualScroll]` | PrimeNG | Sept colonnes (§ Layout). Ligne actionnable vers la modale d'arbitrage ou du lien (§ États des Composants) |
| Table pleine hauteur | `fullHeightTable` (`shared/utils/table.ts`), en `[pt]` de `p-table` | composant maison (PrimeNG) | `table-layout: fixed`, fond de ligne sur toute la hauteur, table étirée vide pour centrer son bloc vide, jamais remplie (le défilement virtuel attend des lignes exactes) |
| Détail avant / après | `TrackDetailComponent`, sur des lignes synthétiques de la table | composant maison (PrimeNG) | Déplié sous la ligne, pleine largeur, plusieurs ouverts, sur un nombre entier de lignes (7, 4 pour des tags illisibles ; § Layout). Bouton `chevron-right` / `chevron-down` en tête de ligne (`aria-expanded`), ligne ouverte en `bg-highlight`. Fond `bg-surface-950`, filet bas `border-surface`. Pochette à gauche, « Restaurer ce morceau » dessous, grille Champ / Avant / Après, colonne Champ à la largeur de son plus long libellé suivi de sa clé, clé en `text-surface-600` sans préfixe `TXXX:` |
| Lien vers la fiche source | `ButtonDirective` `link`, icône `external-link` | PrimeNG | Ligne URL du détail, ouvre la page par `openUrl` du plugin `opener` |
| Pochette | `ArtworkComponent` : `<img>` par `convertFileSrc()` + `p-skeleton` | composant maison (PrimeNG, Tauri) | 32px dans la liste, 168px dans le détail (largeur de « Restaurer ce morceau » en FR), rayon `sm`. Trois états : image, squelette tant que le morceau attend, cadre `bg-surface-800` bordé à l'icône `image` une fois tranché sans pochette |
| Score | moyenne, puis `A 96 · T 92` en `text-xs` dessous | Tailwind | Aligné à droite, `tabular-nums` (§ Séparateurs) |
| Indice de rattrapage | `font-semibold text-muted-color` + icône `arrow-right` | Tailwind | « Coller un lien → » dans la colonne Après d'un non résolu |
| Récapitulatif filtrable | `RecapPageComponent` : `RunListComponent` figée + `p-selectbutton` + `p-iconfield` (`p-inputicon` `search`, `pInputText` `pSize="small"`) | composant maison (PrimeNG) | Filtres avec leur compte, recherche texte. En-tête : titre puis filtres. Pied : « Retour à la liste » `text` `secondary` (`chevron-left`), ligne de contexte `text-sm text-muted-color` tronquée. Un run passé s'y rouvre en lecture seule |

### Badges

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| État d'un morceau | `StateTagComponent` (`p-tag`) | composant maison (PrimeNG) | `state`, `resolution`, `awaiting`, `interrupted` traduits en famille, icône et libellé (§ Couleurs Sémantiques), écrits une fois. Un `failure_reason` ajoute `info-circle` derrière le tag, motif en tooltip |
| Catégorie du rapport | `p-tag` + icône `info-circle` | PrimeNG | Familles du § Couleurs Sémantiques |
| Compteur de navigation | `p-badge` `secondary`, sans `size`, `h-auto`, `tabular-nums` | PrimeNG | « 1/3 » entre les flèches des modales d'arbitrage et du lien, à la hauteur des boutons `small` qui l'encadrent. Neutre : un compteur n'est pas une action |

### Feedback et chargement

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Écran bloquant | `p-card` centrée dans la page, à l'anatomie de nos modales : titre `text-lg` 600, texte `text-sm text-muted-color` à gauche, action `secondary` outlined `size="small"` en pied à droite | PrimeNG | Sidecar absent ou en quarantaine (« Réessayer »), divergence de version (sans action). Pas une modale : la barre d'onglets n'est pas rendue. Neutre plutôt qu'un `p-message`, dont le fond d'alerte couvrirait la phrase qui dit quoi faire |
| Notifications | `p-toast` en bas à droite, `success` et 4s par défaut | PrimeNG | Fin d'une phase longue (extraction, run, écriture, restauration) et vidage du cache ; `warn` avec le nombre d'échecs. Recouvre le pied de Playlist pendant ses 4s, un clic le ferme |
| Message inline | `MessageComponent` | composant maison (`p-message`) | Seule voie vers `p-message`. Icône selon la sévérité (`info-circle`, `check-circle`, `exclamation-triangle`, `times-circle`), 20px, 16px en `small`. `whitespace-pre-line`. `[animated]="false"` dans une cellule réservée |
| Erreur contextuelle | `ErrorMessageComponent` | composant maison (`MessageComponent`) | Erreur du sidecar traduite (`code`, `params`), dans l'écran concerné, jamais en toast. Même écart au-dessus et en dessous que son conteneur : `gap-6` sous l'en-tête d'un écran, `gap-4` sous le champ de lien, 12px dans une rangée des Réglages (`gap-3` après une aide, `mt-1` en premier) |
| Échec de l'écriture | `MessageComponent` `error` | composant maison | Au-dessus de la liste du run, texte seul : la relance passe par le bouton d'action |
| Fichiers non restaurés | `RollbackFailuresComponent` (`MessageComponent` `error`) | composant maison | Rangée Restauration des Réglages, sous son bouton ; Tagging et récapitulatif, au-dessus de la liste. Une phrase par fichier, propre à la restauration |
| Logs introuvables | `MessageComponent` `error`, taille par défaut | composant maison | Sous la rangée Logs quand l'Explorateur ne peut pas révéler le fichier. Erreur locale, sans `code` du sidecar : pas d'`ErrorMessageComponent` |
| Progression d'une phase | `PhaseProgressComponent` (`p-progressbar`) | composant maison | Libellé et compteur au-dessus de la barre, qui n'écrit aucune valeur et passe en indéterminée sans total. « N sur M rattrapés » prend la place de la barre du run pendant le rattrapage |
| Rien à rattraper | ligne `check-circle` en `text-sm` | Tailwind | À la place de la barre de rattrapage sur 0 sur 0 |
| Chargement d'une table | `SkeletonRowsComponent`, puis `p-skeleton` | composant maison (`p-skeleton`) | Table vide : lignes entières en squelette, à la hauteur et au filet des vraies, dans le `#emptymessage`. Dès la première ligne, le squelette ne tient plus que la vignette d'un morceau qui attend, les autres cellules en cadratin |
| Bloc vide | `EmptyStateComponent` | composant maison | Forme au § États des Composants. Dans une table par le `#emptymessage` ; hors table, `framed` lui donne le panneau `rounded-lg border border-surface bg-surface-900` |

### Overlays

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| En-tête de modale | `p-dialog`, réglé par le preset (hook `css` de `dialog`) | PrimeNG | Titre en 1.125rem / 600. Croix calée sur la ligne du titre et sur le padding du contenu, réglée une fois dans le preset. `display: contents` sur l'hôte de `p-dialog` et `p-confirmdialog` : fermée, une modale ne pèse rien dans sa colonne |
| En-tête d'une modale de morceau | `DialogHeaderComponent`, dans le gabarit `#header` | composant maison (`p-dialog`) | Modales d'arbitrage et du lien : titre `h3` tronqué, nom de fichier dessous en `text-xs text-muted-color` (ligne gardée même vide), logo de la source sur la ligne du titre (`h-7`, hauteur de ligne du `text-lg`) |
| Modale d'arbitrage | `ArbitrationDialogComponent` : `p-dialog` modal, sans animation | PrimeNG | Dimensions figées (§ Layout). S'ouvre depuis n'importe quel onglet ; la croix ne décide rien, l'arbitrage reste en file |
| Arbitrage : candidats | `p-listbox` à hauteur fixe, scroll interne, `metaKeySelection` | PrimeNG | Sélection au clic ou aux flèches, jamais au survol. Candidat « Artiste - Titre », score en `text-xs` (§ Séparateurs), ligne « label · année » gardée même vide : des lignes de même hauteur dans les deux listes. Aide clavier en `text-xs` sous la liste |
| Arbitrage : bandeau de source | cellule réservée `min-h-6.5` (un bandeau `small`) au-dessus de la liste | composant maison (`MessageComponent` `small`) | « Correspondances incertaines : N » en `text-xs text-muted-color` ; Beatport refusé : `info` et bouton `link` « Revenir à Beatport » en `text-xs` ; Beatport injoignable : `warn`. Une phrase, sans animation |
| Arbitrage : décision | « Valider » `primary`, « Aucune correspondance » `secondary` outlined, `size="small"`, `spinner` pendant le geste | PrimeNG | La liste Bandcamp remplace celle de Beatport sans que rien ne bouge. Liste vide : motif centré, « Passer » à la place du refus. Geste refusé en `app-error-message` sous la liste |
| Arbitrage : étape lien | champ de lien + `UrlLinkActionsComponent` (« Passer » `secondary` outlined, « Résoudre » `primary`) | composant maison | Même morceau, même cadre, sans compteur |
| Navigation entre morceaux | `button pButton` `secondary` outlined à icône seule (`chevron-left`, `chevron-right`) + compteur (§ Badges) | PrimeNG | Modales d'arbitrage et du lien, aussi par ← → |
| Modale du lien | `UrlRecoveryDialogComponent` : `p-dialog` modal, sans animation | PrimeNG | Dimensions au § Layout. En-tête de morceau, logo de la source sur un rattrapé |
| Confirmation d'un geste sur les fichiers | `DangerConfirmComponent` + `injectDangerConfirm` (`p-confirmdialog`) | composant maison (PrimeNG) | Écriture, relance, restauration. Message en `text-sm text-muted-color` `whitespace-pre-line`, interpolé plutôt qu'en `innerHTML` (un chemin y figure). Acceptation `danger` pour la seule restauration, `primary` sinon ; « Annuler » `secondary` outlined avec le focus |
| Confirmation de sortie | `CloseConfirmationComponent` : `p-dialog` modal | composant maison (PrimeNG) | Fermeture pendant une extraction, une écriture ou une restauration : « Rester » `primary` avec le focus, « Quitter quand même » `secondary` outlined ; « Rester » seul pendant l'écriture ou la restauration. Ni `p-confirmdialog` ni `danger` : la sortie ne touche aucun fichier musical |
| Tooltip | `pTooltip` lié à `TOOLTIP` ou `WIDE_TOOLTIP` (`shared/utils/tooltip.ts`) | PrimeNG | Sous l'élément, retourné au-dessus quand la place manque. 12.5rem, 26rem en `WIDE_TOOLTIP` (texte tronqué, détail du rapport, motif d'échec). `pointer-events: none`. Délai au § Composants Animés, usage au § Conventions de Code > Règles |
| Reprise d'un run interrompu | `ResumeDialogComponent` : `p-dialog` modal non fermable, `w-120` | composant maison (PrimeNG) | Au démarrage (§ Arbitrages). « Repartir de zéro » texte `secondary`, « Reprendre » `primary` |

### Contenu et texte

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Texte tronqué | `TruncatedTextComponent` | composant maison (`pTooltip`) | Ellipse, tooltip `wide` sur un texte coupé seulement, `rtl` pour couper un chemin par la gauche |
| Sans valeur | `NoValueComponent` | composant maison | Cellule sans valeur (§ États des Composants) |

### Identité

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Logo de source | `SourceLogoComponent` | composant maison (Simple Icons) | Beatport, Bandcamp, SoundCloud et VLC en `currentColor`, aux tailles des icônes (§ Icônes) |
| Source retenue | `SourceLabelComponent` : `SourceLogoComponent` 16px + nom de marque | composant maison (Simple Icons) | Colonne Source de la liste, ligne Source du détail |

### Post-MVP (non installés)

> Chaque entrée rejoint sa famille ci-dessus au moment de son installation.

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Envoi du rapport | `button pButton` `secondary` `size="small"` | PrimeNG | Feature 9. Seul geste par lequel des titres quittent la machine |
| Bascule du mode agent IA | `p-toggleswitch` dans les Réglages | PrimeNG | Avec l'agent d'arbitrage, cf. [ARCHITECTURE.md § Évolutions Futures](ARCHITECTURE.md#-évolutions-futures-post-mvp) |

## États des Composants

> Les composants PrimeNG portent leurs états (hover, focus, disabled, invalid) par le preset. Ce tableau couvre les éléments custom écrits from scratch.

| État | Style / Comportement | Contexte |
|------|---------------------|----------|
| Survol d'une zone cliquable custom | `bg-emphasis`, transition de couleur 150ms `ease-out` | Lignes actionnables de la liste du run, sans déplacement ni scale. Les badges de file et de rattrapage s'en passent : leur tag porte déjà un fond |
| Survol d'une surface inerte | Aucun | Lignes non actionnables, cellules, libellés |
| Sélection | `bg-highlight` | Ligne dépliée de la liste du run, entrée active du menu des Réglages, comme l'option choisie de `p-select` et `p-listbox`. Le survol reste gris (`bg-emphasis`) |
| Focus clavier | Anneau du preset (1px `primary`, à la couleur de sa sévérité sur un bouton `secondary` ou `danger`), recopié en `focus-visible:outline-1 outline-primary` `-outline-offset-2` sur une ligne actionnable | Vers l'intérieur : le défilement de la table rognerait un anneau extérieur. `outline: none` interdit |
| Désactivé | `--p-disabled-opacity` (0.6) sur les boutons et les curseurs des seuils ; fond `disabled` à opacité 1 sur les champs, `p-select`, `p-selectbutton` et `p-toggleswitch` ; flèche de la souris | Libellé gardé, jamais masqué, raison en tooltip. Flèche comme dans une application Windows, `not-allowed` étant une convention web |
| Chargement | `p-skeleton` aux dimensions de l'élément final ; `spinner` dans le bouton d'un geste en attente | Aucun saut de layout. Le `spinner` remplace `[loading]` de `pButton`, déprécié |
| Sans valeur | Cadratin en `text-muted-color` (§ Séparateurs) | Cellule d'une ligne qui existe sans donnée de la source : Après, Source et Score d'un non résolu |
| Curseur | La main sur ce qui est cliquable et actif, la flèche ailleurs et sur un contrôle désactivé, `text` sur les seuls champs de saisie | CSS global : flèche sur `body`, `text` sur `textarea` et `input` hors cases et bascules. Piste d'un `p-slider` actif en `cursor-pointer` |
| Vide | Icône 24px en `text-muted-color`, titre en `text-base`, une phrase en `text-sm text-muted-color` qui dit le geste qui débloque | Extraction ou run pas lancé, dossier sans fichier audio, playlist vide, récapitulatif sans run, sans correspondance ou introuvable. Dans une table, `border-b-0` sur la cellule du `#emptymessage` |

---

# 🖼️ Icônes

**Librairie UI** : `@primeicons/angular` 8 : composants standalone en SVG inline, sans police ni classes `pi pi-*`, rendus par `IconComponent`

**Librairie logos** : SVG [Simple Icons](https://simpleicons.org) dans `src/assets/icons/`, tracés rendus inline par `SourceLogoComponent`

| Logo | Où |
|------|-----|
| Beatport, Bandcamp, SoundCloud | Colonne Source de la liste du run et du récapitulatif, ligne Source du détail, en-tête des modales d'arbitrage et du lien |
| VLC media player | Bouton de la playlist et résumé de l'extraction, sur un dump VLC reconnu |

**Règles** :

- Toute icône passe par `IconComponent`, dont le nom est une union littérale des icônes employées : un `string` imposerait un registre de toutes les icônes du paquet et casserait le tree-shaking. Par icône : un nom, un import, une entrée `imports` et un `@case`, couverts par un test qui parcourt la liste
- Taille cohérente par contexte : `16px` inline, dans les tables, les tags, les boutons et un message `small` ; `20px` en en-tête et dans un message ; `24px` dans un état vide et sur une pochette absente en grand. Posée en `width` / `height` sur le SVG, jamais en `font-size`
- Simple Icons pour les logos, absents de PrimeIcons : quatre SVG copiés plutôt que le paquet
- `currentColor` obligatoire sur les SVG : la couleur vient du contexte, jamais du fichier
- Aucune action destructive n'est signalée par une icône seule : rollback et confirmation d'écriture portent toujours un libellé traduit

---

# ✨ Animations & Motion

## Librairie(s)

| Librairie | Rôle | Périmètre |
|-----------|------|-----------|
| Angular (`animate.enter`) | Entrée d'un élément | Hôtes de page, écran bloquant, formulaire et résumé de Playlist, erreur contextuelle, invite de reprise, pochette |
| `tailwindcss-primeui` | Utilitaires d'animation | `animate-fadein`, `animate-duration-*`, `animate-ease-out`, combinés dans `FADE_IN` (`shared/utils/motion.ts`) |
| PrimeNG | Transitions de ses composants, en CSS | Modales, toasts, onglets, squelettes, `p-message`. Une modale se coupe par `motionOptions` et `maskMotionOptions` |

Aucune dépendance d'animation dédiée.

## Principes Directeurs

- **Intensité** : `subtile`, pour un outil de production
- **Durée standard** : `animate-duration-200` pour les fondus d'entrée et la barre de progression, 150ms pour les transitions de couleur. PrimeNG garde ses durées (22.1.2, relevé le 2026-10-16) : modales et `p-message` 300ms, tooltip 250ms, boucles de chargement de 1.2s à 2.1s
- **Easing** : `animate-ease-out`
- **Intention** : rendre lisible un changement d'état, jamais décorer
- **Mouvement réduit** : sous `prefers-reduced-motion: reduce` (animations coupées dans Windows), le CSS global coupe les fondus `animate-*` et les entrées et sorties de PrimeNG (`*-enter-active`, `*-leave-active` : modales, messages, toasts), seul `!important` toléré (§ Anti-Patterns). Restent les transitions de couleur et de largeur, le fondu du tooltip (piloté en JS) et les boucles de chargement, qui disent qu'un travail tourne

## Composants Animés

> Éléments custom, plus les composants PrimeNG dont les paramètres sont une décision projet : modales de morceau sans animation, `p-message` dans une cellule réservée, délai du tooltip, transition de la barre. Les transitions de survol vivent au § États des Composants.

| Composant | Type d'animation | Librairie | Trigger |
|-----------|-----------------|-----------|---------|
| Modales d'arbitrage et du lien | **Aucune** (`NO_MOTION`) | PrimeNG | Ouverture : la décision est sur le chemin critique du run |
| Contenu d'un onglet | Fondu, opacité seule | `FADE_IN` + `animate.enter` sur l'hôte de page | Changement d'onglet, ouverture du récapitulatif. La barre `p-tabs` reste hors du conteneur animé |
| Écran bloquant, erreur contextuelle, invite de reprise | Fondu | `FADE_IN` + `animate.enter` | Montage |
| Formulaire et résumé de Playlist | Fondu de celui qui entre | `FADE_IN` + `animate.enter` | Repli au lancement, « Modifier » |
| Message inline dans une cellule réservée | **Aucune** (`[animated]="false"`) | PrimeNG | Bandeaux de source de l'arbitrage, « Rattrapé sur » du lien |
| Vignette de pochette | Fondu | `FADE_IN` | Image chargée |
| Tag d'état | Transition de couleur 150ms | CSS | `arbitration_required`, `track_resolved` |
| Barre de progression | Largeur suivie en 200ms `ease-out` | `[pt]` sur l'élément `value` de `p-progressbar` | Chaque `progress`. La transition de 1s de PrimeNG laissait la barre en retard sur le run |
| Tooltip | Fondu de 250ms après 400ms de survol, rien à la disparition | PrimeNG + `showDelay` du jeu `TOOLTIP` | Survol maintenu |

---

# 📐 Layout & Espacement

## Structure de Page

| Élément | Valeur | Usage |
|---------|--------|-------|
| Fenêtre | 1280 × 800 à l'ouverture, plancher 1024 × 700, sans plafond | Plancher dicté par les sept colonnes de la liste du run (`tauri.conf.json`, cf. [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives)) |
| Shell | Barre `p-tabs` en haut, contenu sur le reste de la hauteur | La page ne défile jamais, le scroll vit dans la table. `overscroll-behavior: none` coupe le rebond de WebView2 |
| Container | Pleine largeur, `px-16 py-8`, porté par le shell | Tous les écrans : formulaire et table sur la même largeur, la pleine largeur servant Avant et Après |
| Réglages | Menu des sections à gauche (`p-menu` à sa largeur), la section choisie à droite | Toutes les rangées ne tiennent pas au plancher : une section à la fois, sans défilement. Choisi le 2026-10-14 |
| Densité | `text-sm` dans les tables et les listes de candidats | Une ligne de plus visible par cran |
| Modale d'arbitrage | 720 × 560px, liste de 268px à scroll interne | Figée quel que soit le nombre de candidats, étape lien comprise, tenue sans défiler au plancher : rien ne se décale entre deux clics rapides |
| Modale du lien | 720px, hauteur au contenu, erreur réservée `min-h-13.5`, `pb-4` | `min-h-13.5` (54px) : une erreur de deux lignes en FR sans déplacer le pied |
| Confirmation d'un geste sur les fichiers | 30rem (`w-120`) | Largeur de la fiche `ConfirmDialog` |
| Invite de reprise | 30rem (`w-120`) | Largeur de la `Dialog` de la maquette |
| Confirmation de sortie | 32rem (`w-128`) | Mesurée sur le titre et les deux boutons en français |
| Écran bloquant | 30rem (`w-120`), centré dans la page en `p-8` | Largeur de nos modales |
| Tables | `p-table` à sa taille par défaut, `scrollHeight="flex"`, `[virtualScroll]` | `virtualScrollItemSize` égal à la hauteur exacte d'une ligne (`h-14` liste du run, `h-10.25` rapport), à remesurer si leur style change. Un contenu plus haut s'étale sur plusieurs lignes, jamais dans une ligne qui grandit |
| Rythme interne d'un groupe | `gap-2` | Éléments d'un même groupe |
| Espacement entre groupes | `gap-4` | Groupes d'un même écran |
| Espacement entre sections | `gap-6` | Blocs d'un écran |
| Écarts hors échelle | `gap-3` et `py-3` (12px), `gap-0.5` (2px) | `gap-3` : modale d'arbitrage et son `Listbox` (maquette), en-tête de modale de morceau, retour après une aide dans une rangée des Réglages. `py-3` : rangée des Réglages. `gap-0.5` : nom de fichier collé au titre |
| Grid principal | Flexbox et CSS Grid natifs | Aucune librairie de grid |

**Colonnes de la liste d'un run** :

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Chevron | 48px (`w-12`) | Bouton `small` de 34px plus la seule marge gauche de sa cellule : l'écart chevron → vignette égale l'écart vignette → texte |
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

**CSS pur, aucun SCSS** : Tailwind v4 ne compile ni SCSS ni LESS. Un seul fichier d'entrée, `src/styles.css` : police, Tailwind, plugin, variant `dark`, `@theme` et les règles globales qu'aucun utilitaire ne porte (rebond de WebView2, curseur, tooltip, mouvement réduit).

**Utilitaire** : classes Tailwind dans le template, conditionnées par `[class.x]` ou `[ngClass]`. Le DOM interne d'un composant PrimeNG se règle par `[pt]`, ou dans le preset quand l'écart vaut partout.

**Preset** : `TECHNO_TAGGER_PRESET` (`core/platform/theme.ts`) dérive d'Aura par `definePreset()` et n'y change que ce que ce document décide : rayons de la carte (`lg`), du tag (`sm`) et du badge (`xs`), carte sans ombre, taille 0.875rem et poids 400 du libellé de champ, en-tête des modales (§ Overlays). Un écart s'y range selon sa portée : `primitive`, `semantic` ou `components`.

**Cascade** : `cssLayer: { name: 'primeng', order: 'theme, base, primeng' }` dans `providePrimeNG()` : les classes Tailwind gagnent sur les styles de composant.

**Ordre des classes** : réordonné au format par `prettier-plugin-tailwindcss`, aucune convention manuelle.

## Règles

- ✅ **Composant PrimeNG d'abord** : aucun composant custom tant que la bibliothèque en fournit un équivalent (cf. [ADR-003](adrs/003-primeng-community-license.md))
- ✅ **Trois niveaux de personnalisation, dans cet ordre** : `definePreset()` pour ce qui vaut partout, `[dt]` pour les tokens d'une instance, `[pt]` pour les éléments internes. La doc PrimeNG recommande `[dt]` contre `::ng-deep` (Theming, Scoped Tokens)
- ✅ **Une largeur se mesure sur le contenu le plus long, dans les deux langues** (cf. [ADR-004](adrs/004-i18n-ngx-translate.md)) : un bouton ou un libellé n'a aucune largeur en dur ; une colonne de table se fige sur son plus long contenu, sinon elle bouge au défilement
- ✅ **Boutons en `size="small"` partout**, confirmations comprises. Seuls les boutons `link` y échappent
- ✅ **Un tooltip révèle, il ne porte pas** : il montre ce qui est déjà à l'écran mais coupé, jamais un libellé, une aide ou une erreur. Trois exceptions : la raison d'une action désactivée (portée par le bouton grisé), le détail d'une ligne du rapport et le motif d'un morceau en échec, ces deux derniers annoncés par une icône `info-circle` en `text-muted-color` hors de tout tag
- ✅ **Tout `pTooltip` se lie à `[tooltipOptions]`** (`TOOLTIP` ou `WIDE_TOOLTIP`) : PrimeNG n'a aucun défaut global, sans ce jeu il s'ouvre à droite et sans délai. Jamais de `[showDelay]` ni de `[tooltipPosition]` sur l'instance
- ✅ **Aucun libellé en dur dans un template** : tout passe par ngx-translate, erreurs du sidecar comprises (`code` + `params`)
- ✅ **Une phrase par ligne** : chaque phrase d'un message sur sa ligne par un `\n` de traduction, une ligne vide entre les blocs d'une modale longue, rendu en `whitespace-pre-line`. Exceptions, pour qu'une cellule réservée reste immobile : le bandeau de source de l'arbitrage (une phrase), le motif d'un non résolu dans la modale du lien (deux lignes de `text-xs`) ; l'aide de la clé API tient sur une ligne
- ✅ **Modale d'arbitrage au clavier** : flèches entre arbitrages, Entrée pour valider, focus visible en permanence

## Anti-Patterns

- ❌ **`::ng-deep`** : du style qui casse à la première mise à jour et qu'aucune recherche ne retrouve. Passer par `[dt]` ou `[pt]`
- ❌ **`!important`** : l'ordre des couches est en cause, à corriger dans `cssLayer`. Seule exception, la coupure des animations sous `prefers-reduced-motion`
- ❌ **Couleurs en dur** : ni hex, ni `bg-emerald-500`. Un changement de preset doit rester un changement de preset
- ❌ **`font-family` sur `body`** : `--font-sans` alimente `--default-font-family`, que le preflight applique à `html, :host`. Une règle sur `body` laisserait `font-sans` sur la pile système, écart muet
- ❌ **`warning`** : `warn` partout (`p-tag`, `p-badge`, `p-message`, `pButton` et son `badgeSeverity`), le compilateur refuse l'autre. `p-message` n'a pas `danger` : son erreur est `error`
- ❌ **Styles inline `[style]`** : réservés aux valeurs calculées à l'exécution (largeur d'une barre, position d'un élément virtualisé)
- ❌ **Logique métier dans un composant** : scores, seuils et classement viennent du sidecar. L'interface ne dérive que les trois états du § Couleurs Sémantiques et les groupes du filtre du récapitulatif (cf. [ARCHITECTURE.md § Frontend](ARCHITECTURE.md#-frontend) et [§ API](ARCHITECTURE.md#api))
- ❌ **Animation sur le chemin de décision** : rien ne s'anime entre un `arbitration_required` et l'affichage des candidats

---

# 🔗 Ressources

## Maquette et design system externes

- **Design system** : [Techno Tagger Design System](https://claude.ai/design/p/66daf6c5-f225-4dcc-bf7d-1d792e633ee5) : miroirs JSX, typages et fiches d'usage des composants du mapping, plus les tokens et les guidelines. Bâti depuis ce document, qui l'emporte sur les règles et les composants
- **Maquette** : le même projet, dossier `ui_kits/techno-tagger/` : un fichier par écran (Playlist, Tagging, Réglages), la modale d'arbitrage et le shell. Fait foi sur l'apparence d'un écran là où ce document se tait
- **Synchronisation** : fichier par fichier, procédure et journal dans `.design-sync/NOTES.md`. Le convertisseur automatique ne s'applique pas (interface Angular sans point d'entrée de librairie) : le lancer effacerait le projet distant
- **Lecture locale** : export dans `.design-sync/design-system/`, ignoré par git, donc absent après un clone. Un écran ou une fiche s'y lit plutôt qu'à distance (un appel par fichier). L'export ne s'invalide pas tout seul : le comparer au distant avant de s'y fier

### Arbitrages

Écarts au design system ou à la maquette tranchés par le propriétaire. Ils priment sur eux pour tous les écrans. Une ligne sans « réaligné » attend la mise à jour de sa source (`.design-sync/NOTES.md` § Reste ouvert).

- **Icônes** : SVG inline par `IconComponent` et `SourceLogoComponent`, là où le design system rend les glyphes par la police PrimeIcons. Écart définitif : React n'importe pas un composant Angular
- **Container** : un seul container pleine largeur, là où le design system centrait les formulaires. Réaligné le 2026-09-24
- **Densité des tables** : `p-table` à sa taille par défaut, là où le design system les donnait en `small`. Réaligné le 2026-09-24
- **Séparateur artiste / titre** : tiret simple, là où la maquette employait le cadratin, réservé à la cellule sans valeur. Réaligné le 2026-09-24
- **Candidat d'arbitrage** : « Artiste - Titre » et « 94 (A 96 · T 92) » sur une ligne, là où la maquette ne montrait que le titre et « A · T ». Décidé le 2026-09-26, réaligné le 2026-09-29
- **Croix de la modale d'arbitrage** : l'arbitrage reste en file, la modale revient par le badge ou la ligne, là où la maquette le retirait. Décidé le 2026-09-26, réaligné le 2026-09-29
- **Vocabulaire « zone grise »** : jamais affiché, l'interface dit « correspondances incertaines », là où `SettingsScreen` l'employait. Décidé le 2026-09-27, réaligné le 2026-10-05
- **Rattrapage par URL** : modale du lien par morceau, ouverte par la ligne ou par le badge « N à rattraper » (à droite du badge de file), aussi après une interruption, lignes rattrapées gardées avec « Rattrapé sur `<Source>` » ; aucune reconnaissance d'hôte à la frappe, le sidecar juge l'URL. Là où `UrlRescue` empilait sous la table un bloc qui reconnaissait l'hôte. Décidé du 2026-09-29 au 2026-10-06, réaligné le 2026-10-06
- **Progression du rattrapage** : « N sur M rattrapés » à la place de la barre du run, une ligne `check-circle` sur 0 sur 0, là où la maquette gardait la barre réseau à 100 % puis posait un `EmptyState`. Décidé le 2026-10-03, réaligné le 2026-10-06
- **Espacement entre sections** : `gap-6` entre les blocs d'un écran, là où la maquette posait 16px. Décidé et réaligné le 2026-10-05
- **Gris de légende et séparateurs** : `text-muted-color` et `border-surface`, là où la maquette posait `--p-surface-500` et `--p-surface-800`. Décidé et réaligné le 2026-10-05
- **Étape lien de l'arbitrage** : après le refus de la liste Bandcamp ou « Passer » sur une liste vide, le lien du même morceau dans le même cadre, là où `ArbitrationDialog` fermait. Décidé et réaligné le 2026-10-06
- **Indice de rattrapage** : « Coller un lien → » en 600 dans la colonne Après d'un non résolu, là où la maquette laissait la cellule vide. Décidé et réaligné le 2026-10-06
- **Bouton d'action du run** : un seul bouton qui suit la phase, là où la maquette posait « Interrompre » à côté de « Lancer le run ». Décidé le 2026-10-06, réaligné le 2026-10-11
- **Relance de l'écriture** : « Relancer l'écriture » par le bouton d'action du run, le message d'échec ne gardant que le texte, là où le `Recap` portait « Relancer l'écriture sur les échecs ». Décidé le 2026-10-06, réaligné le 2026-10-11
- **Lignes du détail avant / après** : champs écrits sauf l'identifiant à la source, clé sans préfixe `TXXX:`, plus le commentaire, par blocs, là où `TrackDetail` montrait `TPE2`, la date complète et une traçabilité combinée. Décidé le 2026-10-06, réaligné le 2026-10-11
- **Colonne Champ du détail** : à la largeur de son plus long libellé suivi de sa clé, là où `TrackDetail` posait trois tiers égaux. Décidé le 2026-10-09, réaligné le 2026-10-11
- **Rouge des gestes sur les fichiers** : `danger` sur le seul bouton d'acceptation du rollback, les déclencheurs restant `primary`, là où le `Recap` posait la relance en `danger` contour. Décidé le 2026-10-10, réaligné le 2026-10-11
- **Boutons du `p-confirmdialog`** : « Annuler » en `secondary` outlined, sans icône devant le message, là où la fiche `ConfirmDialog` posait « Annuler » en texte et une icône `exclamation-triangle`. Décidé le 2026-10-10, réaligné le 2026-10-11
- **Détail d'un morceau** : déplié sur un nombre entier de lignes de la hauteur des autres ([knowledges/primeng.md](knowledges/primeng.md#détail-déplié-sous-une-ligne-virtualisée)), ouvert par un `pButton` texte `small` `secondary` à icône seule, là où le `DataTable` faisait grandir la ligne sous un bouton nu de 1.25rem. Décidé le 2026-10-10, réaligné le 2026-10-11
- **Taille des contrôles** : `size="small"` sur tous les boutons (réaligné le 2026-10-11) et tous les champs, champ de lien compris (décidé et réaligné le 2026-10-16), là où la maquette laissait la taille par défaut à « Lancer le run », « Interrompre », « Réessayer » et au champ de lien
- **Position des tooltips** : sous l'élément partout, là où le `Tooltip` du design system s'ouvrait au-dessus. Décidé et réaligné le 2026-10-11
- **État de la clé API** : 24 points en placeholder, sans tag, là où `SettingsScreen` posait un `Tag`. Décidé et réaligné le 2026-10-11
- **Vocabulaire de la restauration** : un seul verbe, « Restaurer », là où la maquette disait « Annuler le dernier run » sous « Rollback ». Décidé et réaligné le 2026-10-11
- **Une phrase par ligne** : chaque phrase d'un message sur sa ligne, là où la maquette écrivait en prose continue. Décidé et réaligné le 2026-10-11
- **Invite de reprise** : quatre états (run reprenable, dossier introuvable ou vidé avec « Plus tard », plan illisible, plan corrompu), aucun bouton focalisé (Entrée ne supprime jamais le plan), dossier sur sa ligne tronqué à gauche, là où `AppShell` n'avait qu'un état, focalisait le premier bouton et écrivait le dossier dans la phrase. Décidé le 2026-10-12, réaligné le 2026-10-13
- **Confirmation de sortie** : seules l'extraction, l'écriture et la restauration retiennent la fenêtre, là où `CloseConfirmation` nommait aussi le run et les arbitrages. Décidé le 2026-10-12, réaligné le 2026-10-13
- **Récapitulatif** : ouvert par un bouton « Récapitulatif » à la fin de l'écriture ; pied « Retour à la liste » à gauche et ligne de contexte à droite, sans « Restaurer le run », « Nouveau run » ni « Envoyer ce rapport » (Feature 9). Là où la maquette simulait un lien dans la barre d'onglets et posait ces boutons en pied. Décidé le 2026-10-12, réaligné le 2026-10-13
- **Lien vers la fiche source** : bouton `link` dans la ligne URL du détail, là où la fiche `Button` réservait cette variante à « Revenir à Beatport ». Décidé le 2026-10-12, réaligné le 2026-10-13
- **« Restaurer ce morceau »** : sous la pochette du détail, à sa largeur (168px), là où `TrackDetail` le posait en bas à droite. Décidé et réaligné le 2026-10-13
- **Runs passés** : rangée des Réglages (sélecteur et bouton), récapitulatif rouvert en lecture seule, là où la maquette n'offrait aucune entrée vers un run passé. Décidé et réaligné le 2026-10-13
- **Pochettes après une restauration** : la confirmation dit que la pochette posée par l'écriture reste en place, là où la maquette ne parlait que des pochettes retirées (ADR-011). Décidé et réaligné le 2026-10-13
- **Aide d'une rangée des Réglages** : avec le contrôle, là où `SettingsRow` empilait libellé et aide dans la colonne de gauche. Décidé et réaligné le 2026-10-11
- **Colonne des libellés des Réglages** : libellé seul dans 10rem mesurés sur le plus long libellé FR et EN, rangées d'une section jointives (filet seul), là où `SettingsRow` pose 16rem et `SettingsScreen` espace les rangées de `gap-4`. Décidé le 2026-10-15, réaligné le 2026-10-16
- **Champ et curseur des seuils** : `p-inputnumber` `small` sans boutons de pas et curseur au rendu natif d'Aura, là où les miroirs posaient 72px avec boutons et une piste `surface-800`. Décidé et réaligné le 2026-10-15
- **Butée des curseurs de seuils** : les deux pistes sur 0-100, le seuil qui bouge butant sur l'autre, là où la maquette bornait chaque piste par l'autre seuil. Décidé le 2026-10-15, réaligné le 2026-10-16
- **Actions d'administration** : « Vider le cache » grisé aussi tant que le moteur démarre et sur un run affiché non écrit, « Ouvrir le dossier des logs » tant que le moteur démarre, raison en tooltip, là où la maquette ne grise que « Vider le cache » pendant une opération. Décidé le 2026-10-15, réaligné le 2026-10-16
- **Menu des Réglages** : rendu natif de `p-menu`, entrée active en `bg-highlight` comme l'option choisie d'une liste, là où `SectionMenu` le recompose en 1rem avec l'active en `bg-emphasis`, la couleur du survol. Décidé et réaligné le 2026-10-16
- **Écran bloquant** : anatomie de nos modales, 30rem et action en pied à droite, là où `BlockingCard` pose 34rem et l'action à gauche sous le texte. Décidé et réaligné le 2026-10-16

## Documentation Officielle

- [PrimeNG : Theming](https://primeng.dev/theming) : design tokens, `definePreset()`, `darkModeSelector`, tokens scopés `[dt]`
- [PrimeNG : Configuration](https://primeng.dev/configuration) : `providePrimeNG()`, licence, ripple (désactivé par défaut)
- [PrimeNG : Tailwind CSS](https://primeng.dev/tailwind) : installation, classes issues des tokens, utilitaires d'animation, dark mode
- [PrimeNG : PassThrough](https://primeng.dev/passthrough) : API `[pt]`, locale et globale
- [PrimeNG : Table](https://primeng.dev/table) : `scrollHeight="flex"`, scroll virtuel
- [PrimeNG : Tooltip](https://primeng.dev/tooltip) : `tooltipOptions`, aucun défaut global
- [PrimeNG : Migration v21](https://primeng.dev/migration/v21) et [v22](https://primeng.dev/migration/v22) : animations CSS natives, base 16px, dépréciations et retraits
- [Tailwind CSS : Dark mode](https://tailwindcss.com/docs/dark-mode) : `@custom-variant`
- [PrimeIcons](https://primeicons.dev) : catalogue, catégories, recherche
- [Angular : Enter and Leave animations](https://angular.dev/guide/animations) : `animate.enter` / `animate.leave`
- [Angular : Migrating to Native CSS Animations](https://angular.dev/guide/animations/migration) : sortie de `@angular/animations`
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
