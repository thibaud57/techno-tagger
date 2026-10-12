---
title: "DESIGN — techno-tagger"
description: "Design system : typographie, couleurs, librairies UI, mapping composants et conventions de style de l'interface Angular + PrimeNG."
date: "2026-10-11"
keywords: ["design", "ui", "design-system", "typography", "colors", "animations", "layout", "dark-mode", "icons", "desktop", "components", "spacing", "primeng", "tailwind"]
scope: ["docs", "frontend"]
technologies: ["Angular", "PrimeNG", "Tailwind CSS", "PrimeIcons", "Simple Icons", "Inter", "Tauri"]
---

# 🎨 Identité Visuelle

## Typographie

### Police Principale

**Famille** : `Inter Variable`

**Source** : `@fontsource-variable/inter`, import `wght.css` (poids 100 à 900 en un fichier), embarquée dans le bundle. Aucun CDN : l'application doit s'afficher identiquement hors ligne, et une webview qui attend un `fonts.googleapis.com` injoignable rend en police de repli le temps du timeout

**Usage** : toute l'interface

**Tokens** : `--font-sans`, déclaré dans le `@theme` du CSS global, exposé en classe `font-sans`. Le preset Aura déclare `fontFamily: 'inherit'` : il ne fixe aucune police, rien n'est à défaire de son côté

### Scale Typographique

> Une seule taille signifie aucun palier responsive. L'application étant `desktop-only`, aucun niveau n'en porte.

Base 16px, imposée par l'import `@primeuix/themes/aura` en version non-`compat` (cf. [ADR-003](adrs/003-primeng-community-license.md)).

| Usage | Taille | Poids | Classe |
|-------|--------|-------|--------|
| H1 (titre d'écran) | 1.5rem (24px) | 600 | `text-2xl font-semibold` |
| H2 (section) | 1.25rem (20px) | 600 | `text-xl font-semibold` : sections « API » et « Administration » des Réglages |
| H3 (titre de modale) | 1.125rem (18px) | 600 | `text-lg font-semibold` : gabarits `#header` des modales, titre de l'écran bloquant. Les confirmations `p-confirmdialog` gardent le titre d'Aura, de même taille et de même poids |
| Body | 1rem (16px) | 400 | `text-base` : titre d'un bloc vide |
| Body dense (tables, listes de candidats) | 0.875rem (14px) | 400 | `text-sm` |
| Label (libellé de champ) | 0.875rem (14px) | 400 | `label pLabel`, poids ramené à 400 par le preset |
| Caption (scores, compteurs, aides) | 0.75rem (12px) | 400 | `text-xs` |

Les écrans de données tournent en body dense : chaque cran de taille en moins est une ligne de plus visible sans défiler. Les chiffres qui se comparent d'une ligne à l'autre (scores, compteurs, progression) prennent `tabular-nums`. Seul poids 600 hors des titres : l'indice de rattrapage (§ Arbitrages).

### Séparateurs

Trois glyphes, trois rôles qui ne se recouvrent pas : un glyphe employé pour deux rôles et la ligne cesse de se lire d'un coup d'œil.

| Glyphe | Rôle | Exemple |
|--------|------|---------|
| `-` entouré d'espaces | Artiste et titre d'un même morceau | `Lior Vance - Dim Orbit` |
| `·` | Deux valeurs de même rang | `A 96 · T 92`, `Beatport · 2024` |
| `—` seul | Cellule sans valeur (§ États des Composants) | la colonne Source d'un morceau non résolu |

Le point médian ne sépare jamais un total de son détail. Le score a donc deux notations : en table, `94` sur la ligne principale et `A 96 · T 92` en `text-xs` dessous ; sur une seule ligne, `94 (A 96 · T 92)`. Écrit `94 · A 96 · T 92`, il ferait lire trois valeurs de même rang, alors que 94 est la moyenne des deux autres. `A` disparaît quand la source ne donne pas de score artiste.

## Palette de Couleurs

### Tokens / Variables

Le projet ne définit aucune couleur : le preset Aura génère les variables `--p-*` au démarrage, que l'interface consomme directement ou par les classes du plugin `tailwindcss-primeui`.

| Token | Valeur en dark | Classe | Usage |
|-------|----------------|--------|-------|
| `--p-primary-color` | `{emerald.400}` | `outline-primary`, `border-primary` | Actions primaires et sélection (par le preset), focus d'une ligne du run et de la liste des candidats |
| `--p-primary-contrast-color` | `{surface.900}` | par le preset | Texte posé sur `primary` |
| `--p-surface-950` | palette `zinc` | `bg-surface-950` | Fond du détail déplié |
| `--p-surface-900` | palette `zinc` | `bg-surface-900` | Panneau d'un bloc vide hors table |
| `--p-surface-800` | palette `zinc` | `bg-surface-800` | Cadre d'une pochette absente |
| `--p-surface-600` | palette `zinc` | `text-surface-600` | Clé d'un champ du détail, sous le libellé |
| `--p-text-color` | `{surface.0}` | `text-color` | Texte principal |
| `--p-text-muted-color` | `{surface.400}` | `text-muted-color` | Texte atténué, placeholders, aides, chemins |
| `--p-content-border-color` | `{surface.700}` | `border-surface` | Bordures et filets |
| `--p-highlight-background` | `color-mix(in srgb, {primary.400}, transparent 84%)` | `bg-highlight` | Ligne dépliée de la liste du run |
| `--p-content-hover-background` | `{surface.800}` | `bg-emphasis` | Survol d'une ligne actionnable |
| `--p-disabled-opacity` | `0.6` | par le preset | Éléments désactivés |
| `--p-focus-ring-*` | 1px solid, `{primary.color}`, offset 2px | par le preset | Anneau de focus clavier |

Le plugin expose deux familles de classes à ne pas confondre : des **tokens combinables** avec n'importe quel préfixe Tailwind (`primary`, `surface-{0..950}`, d'où `bg-surface-950` ou `outline-primary`) et des **classes complètes**, préfixe déjà inclus, à écrire telles quelles (`text-color`, `text-muted-color`, `border-surface`, `bg-emphasis`, `bg-highlight`).

Valeurs vérifiées dans la [source du preset Aura](https://github.com/primefaces/primeuix/blob/main/packages/themes/src/presets/aura/base/index.ts), classes dans la [doc Tailwind de PrimeNG](https://primeng.dev/tailwind).

### Couleurs Sémantiques

Le design system ne connaît pas la liste des états d'un morceau, seulement **quatre familles** auxquelles chacun se rattache. L'énumération exacte vit dans le contrat NDJSON, en trois champs `state` / `resolution` / `failure_reason` (cf. [ARCHITECTURE.md § API](ARCHITECTURE.md#api)) : elle peut s'allonger sans qu'aucune couleur soit à inventer.

| Famille | Sévérité | Icône type | Source | Ce qu'elle couvre |
|---------|----------|------------|--------|-------------------|
| Neutre | `secondary` | `clock`, `minus-circle`, `undo` | dérivée, et `state` pour `rolled_back` | Le morceau attend son tour, le run s'est arrêté avant lui, ou ses fichiers ont retrouvé leur état d'origine |
| Décision attendue | `info` | `info-circle` | dérivée | `arbitration_required` reçu sans `track_resolved` derrière : le morceau attend un geste humain |
| Résolu | `success` | `check` | `state` | `resolved` et `written` |
| Échec | `danger` | `times`, `exclamation-triangle` | `state` | `unresolved` et `write_error` |

Les sévérités, déjà câblées dans `p-tag`, `p-badge`, `p-message` et `pButton`, suivent le preset sans maintenance.

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
- **Libellé d'échec générique, motif au survol** : « Non résolu » couvre cinq `failure_reason`, « Échec d'écriture » plusieurs autres. Les nommer élargirait la colonne État ou la tronquerait : l'icône `info-circle` suit le tag et le motif s'ouvre en tooltip. Un motif est du diagnostic, pas de la colonne de balayage

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
- ✅ Le `danger` **d'une action** est réservé au bouton d'acceptation d'un geste destructif : le rollback, qui défait l'écriture et consomme la sauvegarde des tags d'origine. L'écriture et sa relance, dont l'origine est sauvegardée avant, acceptent en `primary`, et tous les déclencheurs restent `primary` (§ Arbitrages). Sur un `p-tag` ou un `p-message`, la même sévérité ne décide rien : elle rapporte la famille Échec

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

Aucune ombre posée par le projet : celles d'Aura restent sur les overlays (modales, tooltips, toasts, listes déroulantes), et le preset retire celle de la carte (`card.root.shadow: none`). La hiérarchie entre surfaces passe par les bordures et les crans de `surface`.

## Dark / Light Mode

**Stratégie** : dark permanent, aucun sélecteur dans l'interface

**Mécanisme** : `darkModeSelector: '.app-dark'` dans les options de thème de `providePrimeNG()`, classe `app-dark` posée en dur sur `<html>` dans `index.html`, jamais retirée. C'est le cas documenté par PrimeNG : « In case you prefer to use dark mode all the time, apply the `darkModeSelector` initially and never change it ». Côté Tailwind, le variant suit le même sélecteur :

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

Les composants maison sont écrits une fois pour que ce qu'ils encapsulent ne soit pas recopié écran par écran : ils vivent dans `shared/components/`, sauf ceux d'un seul écran, rangés dans sa feature. Les écrans référencés sont ceux de [ARCHITECTURE.md § Flux Fonctionnels](ARCHITECTURE.md#flux-fonctionnels-use-cases-critiques).

### Navigation

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Navigation principale | `p-tabs` synchronisé à la main avec le Router | PrimeNG | PrimeNG v22 n'a aucun mode router et a supprimé `p-tabMenu` : l'onglet actif se dérive de l'URL, la navigation part du changement de valeur |
| Badges de file et de rattrapage | bouton portant un `p-tag` `info`, icône `info-circle` | PrimeNG | À droite de la barre d'onglets, groupés en `gap-2`, masqués sur 0. « N à arbitrer » rouvre la modale d'arbitrage après la croix. « N à rattraper », masqué aussi pendant la recherche, ouvre Tagging et la modale du lien |

### Actions

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Bouton d'action du run | `button pButton` `size="small"` | PrimeNG | Un seul bouton au bout de la ligne du dossier, qui suit la phase (tableau ci-dessous), à la largeur de son libellé. Grisé quand quelque chose le bloque, jamais masqué, la raison en tooltip. Un autre dossier choisi le ramène à « Lancer le run » ; un run sans morceau résolu, ou perdu avec le moteur, laisse « Lancer le run » sur son propre dossier |
| Sélection de chemin | `PathPickerComponent` : `button pButton` `primary` outlined `size="small"` + plugin `dialog` de Tauri | composant maison (PrimeNG, Tauri) | Icône `folder` pour un dossier ; pour la playlist, logo VLC sur un dump reconnu et `file` sur un M3U8, dont le logiciel d'export est inconnu. Libellé facultatif, bouton, chemin retenu en `text-muted-color` tronqué par la gauche pour garder le nom du dossier. Ses éléments sont des cellules de la grille de l'appelant (`display: contents`) : libellés, boutons et chemins s'alignent en colonnes. Chemin aligné à droite sur Playlist, où trois chemins font colonne ; collé au bouton (`pathAlign`) sur Tagging, absent tant qu'aucun dossier n'est choisi |
| Lancement de l'extraction | `button pButton` `primary` `size="small"` | PrimeNG | Sur la ligne du mode, calé sur le bord droit des chemins. Grisé, son tooltip nomme les choix manquants, ou le run de tagging en cours |
| Modification de l'extraction | `button pButton` `secondary` outlined `size="small"` | PrimeNG | « Modifier », au bout de la ligne de résumé qui remplace le formulaire dès le lancement (§ Layout). Figé pendant l'extraction, puis rouvre le formulaire au-dessus du rapport |
| Passage au tagging | `button pButton` `primary` outlined `size="small"`, icône `arrow-right` | PrimeNG | Sous le rapport, extraction terminée. `primary` parce que c'est l'étape suivante, outlined pour laisser le plein aux deux lancements. Mémorise la destination, qui préremplit Tagging |
| Restauration | `button pButton` `primary` outlined `size="small"`, icône `refresh`, `spinner` pendant l'opération | PrimeNG | « Restaurer ce morceau » au bas du détail déplié, « Restaurer le run » au bout de la barre d'écriture (présent aussi quand la barre est masquée), « Restaurer le dernier run » dans la rangée Restauration des Réglages. Grisé, la raison en tooltip, tant qu'une écriture ou une restauration tourne ; celui des Réglages aussi pendant une recherche, en attendant la réponse du moteur, ou sans run à restaurer. Ouvre la confirmation d'un geste sur les fichiers (§ Overlays). Dans les Réglages, l'aide est sur la ligne du bouton calé à droite ; dessous, seulement s'il y a un run, sa cible en `text-xs text-muted-color` sur deux lignes : « Run du {date} sur {dossier} », tronquée, puis « Morceaux à restaurer : N » |
| Actions d'administration | `button pButton` `secondary` outlined `size="small"` | PrimeNG | Vider le cache, ouvrir le dossier de logs |
| Envoi du rapport | `button pButton` `secondary` `size="small"` | PrimeNG | Geste explicite, seul endroit d'où des titres quittent la machine |

**Phases du bouton d'action du run** :

| Action | Quand | Libellé, icône | Style | Tooltip quand grisé, par priorité |
|--------|-------|----------------|-------|-----------------------------------|
| `start` | aucun run à confirmer ni à relancer sur ce dossier | « Lancer le run », `play` | `primary` | run en cours, restauration en cours, geste de rattrapage en vol, clé API, dossier, extraction, sidecar |
| `cancel` | recherche en cours | « Interrompre », `stop` | `secondary` outlined | jamais grisé |
| `commit` | run cherché, non confirmé, tenu par le moteur, au moins un morceau résolu | « Confirmer l'écriture », `check` | `primary` | restauration en cours, écriture en cours, geste de rattrapage ou d'arbitrage en vol |
| `retry` | fichiers en échec d'écriture sur le même dossier, run écrit encore tenu par le moteur | « Relancer l'écriture », `refresh` | `primary` | comme `commit` |

`cancel` n'a ni `danger` ni confirmation : la recherche n'écrit aucun fichier. `commit` et `retry` ouvrent la confirmation d'un geste sur les fichiers et passent en `spinner` pendant l'écriture. `retry` ne rejoue que les fichiers en échec, sans refaire la recherche ni les arbitrages.

### Formulaires

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Sélecteur de playlist (dump VLC) | `p-select` `size="small"` | PrimeNG | Option : nom de la playlist et nombre de morceaux. Masqué pour un M3U8, qui n'en contient qu'une. Un `p-skeleton` à sa hauteur (tokens `--p-form-field-sm-*`) le remplace tant que la liste est attendue. Fermé, un nom long se coupe à la largeur des contrôles et se lit au survol : `contain: inline-size` l'empêche d'élargir la colonne |
| Mode copie / déplacement | `p-selectbutton` `size="small"` | PrimeNG | Deux options, copie par défaut |
| Champ de lien | `UrlLinkFormComponent` : `input pInputText` `type="url"` + `app-error-message` | composant maison (PrimeNG) | Commun à la modale du lien et à l'étape lien. Au-dessus, une cellule réservée (`min-h-8`) porte le motif du non résolu ou « Rattrapé sur `<Source>` » ; dessous, l'aide en `text-xs`, qui dit pendant la recherche que le champ attend sa fin. Placeholder : un lien Beatport. Focalisé à chaque morceau, désactivé pendant la recherche (le sidecar refuserait), le focus passant alors sur « Passer ». « Résoudre » actif champ rempli, `spinner` pendant le geste, refus sous le champ |
| Clé API | `input pInputPassword` dans un `p-iconfield` + « Enregistrer » `size="small"` | PrimeNG | Jamais préremplie ni relue depuis le keyring vers la webview ([ADR-012](adrs/012-securite-cle-api-keyring.md)), remasquée après l'envoi. « Enregistrer » grisé sans saisie. Une clé enregistrée se signale par 24 points en placeholder, sans `p-tag`, et par un texte `sr-only` relié au champ par `aria-describedby` pour un lecteur d'écran. L'œil n'apparaît que pendant une saisie, une clé qu'on ne relit pas n'ayant rien à révéler : c'est un bouton du template, `p-password` étant déprécié en v22 et `pInputPassword` n'exposant que `mask` |
| Rangée des Réglages | `SettingsRowComponent` (`features/settings/`) | composant maison (Tailwind) | Grille `grid-cols-[16rem_minmax(0,1fr)]` en `gap-x-4`, `py-3`, `border-b border-surface`, slots `[rowLabel]` et `[rowControl]`. La colonne de gauche ne porte que le libellé, la même pour toutes les rangées : leurs contrôles s'alignent. 16rem à remesurer sur le plus long libellé FR et EN. Le contenu par défaut passe sous le contrôle : une aide colle au contrôle (`pt-2`), un retour en garde 12px, comme le `py-3` sous lui (`gap-3` après une aide, `mt-1` quand il vient en premier). Vide, cette zone ne pèse rien. Une rangée à bouton seul pose son aide sur la ligne du bouton |
| Runs passés | `p-select` `size="small"` en Signal Forms + bouton « Ouvrir le récapitulatif » `secondary` outlined, dans une `SettingsRowComponent` | PrimeNG | Sous « Restauration ». Options « Run du {date} sur {dossier} », le plus récent d'abord, sans largeur figée : le dossier est coupé et son tooltip le montre. Sélecteur et bouton désactivés sans run. Ouvre `/tagging/recap/:runId`, récapitulatif en lecture seule sous une ligne de contexte |
| Seuils de matching | `p-slider` lié à un `p-inputnumber` | PrimeNG | Plancher et seuil haut, valeurs de départ 70 et 90 |
| Langue | `p-select` `size="small"` | PrimeNG | FR / EN, force la locale détectée au premier lancement |
| Bascules des Réglages | `p-toggleswitch` | PrimeNG | Signal sonore, copie par défaut |

### Tables et listes

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Rapport d'extraction | `p-table` `[scrollable]`, `[virtualScroll]` | PrimeNG | Deux colonnes (§ Layout), une ligne par morceau plus une par doublon départagé, ce qui demande un geste en tête. Catégorie en `p-tag` (§ Couleurs Sémantiques), son détail en tooltip derrière l'icône `info-circle` : critère et candidats d'un doublon, motif d'un échec. Aucun détail déplié. « Extraction terminée (N sur N) » en `text-sm text-muted-color` sous la table, à droite |
| Liste des morceaux d'un run | `RunListComponent` : `p-table` `[scrollable]`, `[virtualScroll]` | PrimeNG | Sept colonnes, bouton du détail en tête (§ Layout). La ligne d'un morceau à arbitrer ouvre sa modale d'arbitrage, celle d'un non résolu ou rattrapé la modale du lien, au clic comme au clavier (§ États des Composants) |
| Table pleine hauteur | `fullHeightTable` (`shared/utils/table.ts`), en `[pt]` de `p-table` | composant maison (PrimeNG) | `table-layout: fixed`, fond de ligne sur toute la hauteur du conteneur, table étirée quand elle est vide pour centrer son bloc vide. Jamais étirée remplie : ses lignes dépasseraient la hauteur attendue par le défilement virtuel |
| Détail avant / après | `TrackDetailComponent`, sur des lignes synthétiques de la table | composant maison (PrimeNG) | Déplié sous la ligne du morceau, pleine largeur, plusieurs ouverts à la fois. Bouton en tête de ligne, `chevron-right` fermé et `chevron-down` ouvert avec `aria-expanded`, qui ne déclenche ni l'arbitrage ni le lien ; la ligne ouverte reste en `bg-highlight`. Le détail occupe sous le morceau un nombre entier de lignes à la hauteur des autres, la première le portant en absolu (§ Layout, Tables) : 7 pour les champs, 8 avec « Restaurer ce morceau », 4 pour un fichier aux tags illisibles, mesurées sur le plus haut contenu de chaque cas. Ses lignes de champs se répartissent la hauteur, sans bande vide. Fond `bg-surface-950`, filet bas `border-surface`, glisse sous l'en-tête collant. Pochette de 160px à gauche, grille Champ / Avant / Après à droite, colonne Champ à la largeur de son plus long libellé suivi de sa clé. Champs écrits, sauf l'identifiant à la source, plus le commentaire du fichier, dans l'ordre posé par le sidecar : artiste, titre, remixeur ; genre, BPM, key ; label, numéro de catalogue, ISRC, album, numéro de piste, année ; source, URL ; commentaire. Clé en `text-surface-600`, sans le préfixe `TXXX:` (`CATALOGNUMBER`, `SOURCE`) : l'affichage seulement, les frames écrites ne changent pas |
| Lien vers la fiche source | `ButtonDirective` `link` dans la ligne URL du détail, icône `external-link` | PrimeNG | Ouvre la page de la source retenue par `openUrl` du plugin `opener`. Sans `sourceUrl`, la ligne reste du texte tronqué |
| Pochette | `ArtworkComponent` : `<img>` par `convertFileSrc()` de Tauri + `p-skeleton` | composant maison (PrimeNG, Tauri) | Vignette de 32px dans la liste, 160px dans le détail, rayon `sm`. Lue depuis le cache disque, jamais en base64 dans le flux NDJSON (protocole asset, cf. [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives)). Trois états, jamais deux : l'image ; le squelette tant que le morceau attend son tour ou son arbitrage ; un cadre `bg-surface-800` à l'icône `image` dès qu'il est tranché sans pochette. Une cellule vide se lirait comme un chargement qui n'arrive jamais |
| Source retenue | `SourceLogoComponent` 16px + libellé | composant maison (Simple Icons) | Beatport, Bandcamp ou SoundCloud |
| Score | moyenne, puis `A 96 · T 92` en `text-xs` dessous | Tailwind | Aligné à droite, `tabular-nums`. Notation au § Séparateurs |
| Indice de rattrapage | `font-semibold text-muted-color` + icône `arrow-right` | Tailwind | « Coller un lien → » dans la colonne Après d'un non résolu, y compris pendant la recherche : la modale s'ouvre alors champ désactivé |
| Récapitulatif filtrable | `p-table` + `p-selectbutton` + `p-iconfield` | PrimeNG | Filtres tout / validés / arbitrés / échecs, plus une recherche texte, lus selon § Conventions de Code. Écran `RecapPageComponent` sur `/tagging/recap`, ouvert par « Récapitulatif » une fois l'écriture terminée, la liste restant la vue par défaut. En-tête : bouton « Retour à la liste » (`text` `secondary`, icône `chevron-left`) avant le titre, l'onglet Tagging déjà actif ne ramenant pas à la liste. Pied : « Restaurer le run », « Nouveau run ». `/tagging/recap/:runId` rouvre un run passé dans le même écran, en lecture seule (ni restauration ni « Nouveau run »), sous une ligne de contexte « Run du {date} sur {dossier} ». Sans relance, sans « Envoyer ce rapport » (Feature 9) |

### Badges

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| État d'un morceau | `StateTagComponent` (`p-tag`) | composant maison (PrimeNG) | Entrées `state`, `resolution`, `awaiting`, `interrupted`, traduites en famille, icône et libellé (§ Couleurs Sémantiques) : encodé une fois, ce mapping n'est pas re-dérivé de travers écran par écran. Un morceau qui porte un `failure_reason` (non résolu, échec d'écriture ou de restauration) a l'icône `info-circle` derrière le tag et son motif en tooltip, posés par la liste du run |
| Catégorie du rapport | `p-tag` + icône `info-circle` | PrimeNG | Familles du § Couleurs Sémantiques |
| Compteur de navigation | `p-badge` `secondary`, sans `size`, `h-auto`, `tabular-nums` | PrimeNG | « 1/3 » entre les flèches ‹ › des modales d'arbitrage et du lien. `h-auto` lui donne la hauteur des boutons `small` qui l'encadrent : un badge plus court que sa rangée est un défaut. Neutre : un compteur n'est pas une action |

### Feedback et chargement

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Écran bloquant | `p-card` centrée, action `secondary` outlined `size="small"` | PrimeNG | Sidecar absent ou en quarantaine, avec « Réessayer » ; divergence de version, sans action. Pas une modale : la barre d'onglets n'est pas rendue. Neutre plutôt qu'un `p-message`, dont le fond d'alerte couvrirait la phrase qui explique comment s'en sortir |
| Notifications | `p-toast` en bas à droite, `success` et 4s par défaut | PrimeNG | Fin d'une phase longue quel que soit l'onglet : extraction, run, écriture, restauration, précédée d'un signal sonore si la préférence le permet. Avec des échecs, l'écriture et la restauration passent en `warn` et en donnent le nombre, écart assumé à la fiche `Toast` du design system. Couvre 4s le pied de Playlist, fermable d'un clic. L'état de la clé API se relit dans son champ, il ne s'annonce pas |
| Message inline | `MessageComponent` | composant maison (`p-message`) | Seule voie vers `p-message`. Icône selon la sévérité, comme la fiche `Message` : `info-circle`, `check-circle`, `exclamation-triangle`, `times-circle`, à 20px, 16px en `small`. Texte en `whitespace-pre-line`. `[animated]="false"` coupe l'entrée de `p-message` dans une cellule réservée, où rien ne doit bouger |
| Erreur contextuelle | `ErrorMessageComponent` | composant maison (`MessageComponent`) | Erreur du sidecar traduite depuis son `code` et ses `params`, dans l'écran concerné, jamais en toast : une erreur qui disparaît seule est perdue. Même écart au-dessus et en dessous, celui de son conteneur : `gap-6` sous l'en-tête d'un écran, `gap-4` sous le champ de lien, 12px dans une rangée des Réglages, sous l'aide comme sous le contrôle, aligné sur son `py-3`. Un message plus près de ce qui précède que de ce qui suit se lit comme une marge ratée |
| Échec de l'écriture | `MessageComponent` `error` | composant maison | Au-dessus de la liste du run, texte seul : la relance passe par le bouton d'action |
| Fichiers non restaurés | `RollbackFailuresComponent` (`MessageComponent` `error`) | composant maison | Sous l'action qui a restauré (détail, barre d'écriture, Réglages), une phrase par fichier propre à la restauration, jamais celle de l'écriture, qui invite à relancer l'écriture |
| Une phrase par ligne | `\n` des fichiers de traduction + `whitespace-pre-line` | Tailwind | Tout message de plusieurs phrases (toasts, bandeaux, modales, tooltips, aides, écran bloquant) met chaque phrase sur sa ligne, et une modale longue sépare ses blocs par une ligne vide : confirmation d'écriture (dossier ; comptes, un par ligne ; garantie de sauvegarde), restauration (compte ; conséquences). Les conteneurs les rendent : `MessageComponent`, `DangerConfirmComponent`, la modale de fermeture, les aides des Réglages et l'écran bloquant ; toasts et tooltips PrimeNG le font d'eux-mêmes. Deux exceptions, pour qu'une cellule réservée garde la liste ou le champ immobile : les bandeaux de source de l'arbitrage tiennent en une phrase sur une ligne ; le motif d'un non résolu, dans la modale du lien, tient sur deux lignes de `text-xs` (`min-h-8`). L'aide de la clé API garde ses deux phrases sur une ligne, décidé le 2026-10-11 |
| Progression d'une phase | `PhaseProgressComponent` (`p-progressbar`) | composant maison | Libellé et compteur au-dessus de la barre, que `p-progressbar` ne sait pas porter ; la barre n'écrit aucune valeur et passe en indéterminée sans elle. Alimentée par l'événement `progress`. Phase de rattrapage ouverte (fin de recherche ou interruption), « N sur M rattrapés » prend la place de la barre du run |
| Rien à rattraper | ligne `check-circle` en `text-sm` | Tailwind | À la place de la barre de rattrapage sur 0 sur 0 |
| Chargement d'une table | `SkeletonRowsComponent`, puis `p-skeleton` | composant maison (`p-skeleton`) | Tant que la table est vide, des lignes entières en squelette, à la hauteur et au filet des vraies, dans la cellule du `#emptymessage` : sans elles, la table afficherait son bloc vide avant le premier événement. Dès la première ligne reçue, le squelette ne tient plus que la vignette d'un morceau qui attend son tour, les autres cellules portant le cadratin : un squelette par cellule ferait clignoter la table à chaque événement |
| Bloc vide | `EmptyStateComponent` | composant maison | Forme au § États des Composants, PrimeNG n'ayant pas d'équivalent. Dans une table par le `#emptymessage`, centré par `fullHeightTable` ; hors table, `framed` lui donne le panneau (`rounded-lg border border-surface bg-surface-900`) qu'une table lui aurait donné |

### Overlays

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| En-tête de modale | `p-dialog`, réglé par le preset (hook `css` de `dialog`) | PrimeNG | Titre en 1.125rem / 600 partout. La croix se cale sur la ligne du titre (centre de l'icône sur celui de la ligne de 1.75rem) et le bord droit de son icône sur le padding du contenu, au même écart que le titre au bord gauche, même sous un en-tête de deux lignes : réglé une fois dans le preset, jamais modale par modale. Le preset pose aussi `display: contents` sur l'hôte de `p-dialog` et `p-confirmdialog` : fermée, une modale ne pèse rien dans la colonne flex de sa page |
| En-tête d'une modale de morceau | `DialogHeaderComponent`, dans le gabarit `#header` | composant maison (`p-dialog`) | Modales d'arbitrage et du lien. Entrées `title`, `fileName`, `source` : titre en `h3` tronqué, nom de fichier dessous en `text-xs text-muted-color`, ligne gardée même vide pour que le contenu ne se décale pas d'un morceau à l'autre, logo de la source sur la ligne du titre (`h-7`) |
| Modale d'arbitrage | `ArbitrationDialogComponent` : `p-dialog` modal, sans animation | PrimeNG | Dimensions figées (§ Layout). S'ouvre dès qu'un morceau entre en zone grise, depuis n'importe quel onglet. La croix ne décide rien : l'arbitrage reste en file et l'ouverture automatique est suspendue jusqu'au badge de file ou au clic sur une ligne à arbitrer |
| Arbitrage : candidats | `p-listbox` à hauteur fixe, scroll interne | PrimeNG | Sélection simple au clic ou aux flèches, jamais au survol : le pointeur qui rejoint « Valider » changerait le choix. `metaKeySelection` : un second clic ne désélectionne pas. Candidat en « Artiste - Titre », score en `text-xs` (§ Séparateurs), ligne « label · année » gardée même vide quand la source ne les rend pas (Bandcamp) : les deux listes ont des lignes de même hauteur. Aide clavier en `text-xs` sous la liste |
| Arbitrage : bandeau de source | cellule réservée (`min-h-6.5`) au-dessus de la liste | composant maison (`MessageComponent` `small`) | « Correspondances incertaines : N » en `text-xs text-muted-color` par défaut. Candidats Beatport refusés : bandeau `info` et bouton `link` « Revenir à Beatport » en `text-xs`. Beatport injoignable : bandeau `warn`, aucun candidat n'ayant été validé seul. Sans animation, une phrase sur une ligne : la liste ne bouge pas |
| Arbitrage : décision | « Valider » `primary`, « Aucune correspondance » `secondary` outlined, `size="small"`, `spinner` pendant le geste | PrimeNG | Le refus est distinct de la croix. Après un refus, la liste Bandcamp remplace celle de Beatport dans la même fenêtre, sans que rien ne se déplace. Liste Bandcamp vide : son motif centré dans la hauteur de la liste, « Passer » seule action. Un geste refusé s'affiche en `app-error-message` sous la liste, pour le seul morceau affiché |
| Arbitrage : étape lien | champ de lien + « Passer » et « Résoudre » | composant maison | Après le refus de la liste Bandcamp, ou « Passer » sur une liste vide : même morceau, même cadre, sans compteur. « Passer » ou un lien accepté mène à l'arbitrage suivant. La croix quitte l'étape : le morceau revient par sa ligne ou par le badge du rattrapage |
| Navigation entre morceaux | `button pButton` `secondary` outlined à icône seule (`chevron-left`, `chevron-right`) + compteur (§ Badges) | PrimeNG | Modale d'arbitrage, sur la file ; modale du lien, sur les non résolus et rattrapés, aussi par ← → (Alt dans un champ rempli) |
| Modale du lien | `UrlRecoveryDialogComponent` : `p-dialog` modal, sans animation | PrimeNG | Dimensions au § Layout. Ouverte par la ligne d'un non résolu ou rattrapé, ou par le badge du rattrapage. En-tête de morceau, logo de la source sur un rattrapé. « Passer » ferme au dernier morceau |
| Confirmation d'un geste sur les fichiers | `DangerConfirmComponent` + `injectDangerConfirm` (`p-confirmdialog`) | composant maison (PrimeNG) | Écriture (« Écrire les tags »), relance et rollback (« Restaurer »). 30rem comme la fiche `ConfirmDialog`. Message en `text-sm text-muted-color`, `whitespace-pre-line`, interpolé plutôt que passé au `innerHTML` de PrimeNG : un chemin de dossier y figure. Acceptation `danger` pour le seul rollback, `primary` sinon (l'appelant le dit) ; « Annuler » `secondary` outlined avec le focus, Entrée ne validant rien ; les deux en `size="small"`. L'écriture est le point de non-retour du run, sans rouge pour autant : les tags d'origine sont sauvegardés avant et le rollback les rend |
| Confirmation de sortie | `CloseConfirmationComponent` : `p-dialog` modal | composant maison (PrimeNG) | À la fermeture de la fenêtre pendant une extraction, une écriture ou un rollback. Nomme chaque travail perdu et le fichier qu'une copie coupée peut laisser à moitié écrit. « Rester » `primary` avec le focus, « Quitter quand même » `secondary` outlined. Pendant l'écriture ou un rollback, titrée « Impossible de quitter maintenant », « Rester » seul. Ni `p-confirmdialog` ni `danger` : la sortie ne touche aucun fichier musical |
| Tooltip | `pTooltip`, `[tooltipOptions]` lié à `TOOLTIP` ou `WIDE_TOOLTIP` (`shared/utils/tooltip.ts`) | PrimeNG | Sous l'élément, retourné au-dessus par PrimeNG quand la place manque : à droite, elle manque dès que l'élément touche le bord de la fenêtre. Délai au § Composants Animés. 12.5rem par défaut ; `WIDE_TOOLTIP` passe à 26rem (`--tt-tooltip-max-width-wide`) pour un texte tronqué, le détail d'une ligne du rapport et un motif d'échec, que 12.5rem couperaient. `pointer-events: none` : jamais entre le curseur et ce qu'il décrit. Rien n'est posé sur l'instance (`[showDelay]`, `[tooltipPosition]`) : PrimeNG n'a aucun défaut global, un tooltip sans ce jeu s'ouvre à droite et sans délai. Usage au § Conventions de Code |
| Reprise d'un run interrompu | `ResumeDialogComponent` : `p-dialog` modal non fermable, `w-120` | composant maison (PrimeNG) | Au démarrage, une fois la version du moteur vérifiée, différée comme les autres modales. Résumé (date, « N / M traités ») puis le dossier sur sa propre ligne, tronqué à gauche. Aucun focus à l'ouverture (`focusOnShow` coupé) : Entrée ne supprime jamais le plan. Boutons `small` : « Repartir de zéro » en texte `secondary`, « Reprendre » en `primary`. Dossier introuvable ou vidé : « Plus tard » et « Repartir de zéro ». Plan illisible ou corrompu : « Repartir de zéro » seul. Aucune confirmation : aucun fichier n'est touché |

### Contenu et texte

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Texte tronqué | `TruncatedTextComponent` | composant maison (`pTooltip`) | Chemin ou valeur d'une colonne fluide coupé par l'ellipse. Le tooltip `wide` ne s'ouvre que sur un texte coupé ; `rtl` coupe un chemin par la gauche. Avant et Après tronquent en permanence : ce sont les deux chaînes que l'utilisateur compare |
| Sans valeur | `NoValueComponent` | composant maison | Le cadratin du § Séparateurs en `text-muted-color`, écrit une fois pour que la liste du run et le détail ne divergent pas |

### Identité

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Logo de source | `SourceLogoComponent` | composant maison (Simple Icons) | Beatport, Bandcamp, SoundCloud et VLC en `currentColor`, au même jeu de tailles que les icônes (§ Icônes) |
| Playlist détectée | logo VLC ou icône `file` | composant maison | Bouton de la playlist et ligne de résumé de l'extraction : le logo signale un dump VLC reconnu, un M3U8 tombe sur l'icône générique |

### Post-MVP (non installés)

> Chaque entrée rejoint sa famille ci-dessus au moment de son installation.

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Bascule du mode agent IA | `p-toggleswitch` dans les Réglages | PrimeNG | Arrive avec l'agent d'arbitrage, cf. [ARCHITECTURE.md § Évolutions Futures](ARCHITECTURE.md#-évolutions-futures-post-mvp) |

> `pInputText`, `pInputPassword`, `pButton` et `pTooltip` sont des **directives** posées sur un élément existant, pas des composants.

## États des Composants

> Les composants PrimeNG portent leurs états (hover, focus, disabled, invalid) par le preset. Ce tableau couvre les éléments custom écrits from scratch.

| État | Style / Comportement | Contexte |
|------|---------------------|----------|
| Survol d'une zone cliquable custom | `bg-emphasis`, transition `background-color 150ms ease-out` | Lignes actionnables de la liste du run. Jamais de déplacement ni de scale : les lignes ne bougent pas sous le curseur. Les badges de file et de rattrapage s'en passent, leur tag portant déjà un fond : la main suffit |
| Survol d'une surface inerte | Aucun | Lignes non actionnables, cellules, libellés : rien ne réagit à ce qui ne fait rien |
| Sélection | `bg-highlight` | Ligne dépliée de la liste du run, comme la sélection des composants PrimeNG |
| Focus clavier | Anneau du preset (1px `primary`), recopié en `focus-visible:outline-1 outline-primary` sur une ligne actionnable et posé vers l'intérieur (`-outline-offset-2`) | Le défilement de la table rognerait un anneau extérieur. Une ligne actionnable s'ouvre par Entrée ou Espace, la modale d'arbitrage se traite entièrement au clavier. `outline: none` est interdit |
| Désactivé | `--p-disabled-opacity` (0.6), curseur flèche | Un bouton désactivé garde son libellé, il n'est jamais masqué. La flèche comme sur les boutons PrimeNG et dans une application Windows, `not-allowed` étant une convention web : le grisé et le tooltip disent déjà pourquoi |
| Chargement | `p-skeleton` aux dimensions de l'élément final ; `spinner` dans le bouton d'un geste en attente de réponse | Évite le saut de layout à l'arrivée des événements (§ Feedback et chargement). Le `spinner` remplace `[loading]` de `pButton`, déprécié en v22 |
| Sans valeur | Cadratin en `text-muted-color` (§ Séparateurs) | Cellule d'une ligne qui existe, mais dont la source ne fournit pas la donnée : Après, Source et Score d'un morceau non résolu. Un trait d'union se lirait comme un caractère du contenu, une cellule vide comme un rendu manqué |
| Curseur | La main sur ce qui est cliquable et actif, la flèche ailleurs et sur un contrôle désactivé, `text` sur les seuls champs de saisie | Le CSS global pose la flèche sur `body` et `text` sur `input` et `textarea`. Un élément custom cliquable sous la flèche passerait pour inerte, et le curseur texte sur une table ou un libellé fait lire une page web |
| Vide | Icône 24px en `text-muted-color`, titre en `text-base`, une phrase en `text-sm text-muted-color`, l'action qui débloque quand elle existe | Aucune extraction lancée, dossier sans fichier audio, playlist dont aucun morceau n'est retrouvé, aucun run lancé, cache déjà vide. La phrase dit le geste qui débloque. Dans une table, la cellule du `#emptymessage` pose `border-b-0` : le pass-through n'atteint pas les lignes et la bordure basse traînerait au pied de la table |

---

# 🖼️ Icônes

**Librairie UI** : `@primeicons/angular` 8, tirée par PrimeNG v22 : des composants standalone qui rendent du SVG inline, sans police ni classes `pi pi-*`, donc rien à embarquer pour l'affichage hors ligne. Rendue par `IconComponent`

**Librairie logos** : SVG [Simple Icons](https://simpleicons.org) gardés dans `src/assets/icons/`, leurs tracés rendus inline par `SourceLogoComponent` (le build n'émet que `public/`)

| Logo | Où |
|------|-----|
| Beatport, Bandcamp, SoundCloud | Colonne Source de la liste du run, en-tête des modales d'arbitrage et du lien, récapitulatif |
| VLC media player | Bouton de la playlist et résumé de l'extraction, sur un dump VLC reconnu |

**Règles** :

- Toute icône passe par `IconComponent`. Son nom est une union littérale des icônes employées, jamais `string` : un nom ouvert imposerait un registre des 360 icônes de la 8.0.0 et casserait le tree-shaking. Un import et un `@case` par icône, plus un test qui parcourt la liste, Angular ne vérifiant pas l'exhaustivité d'un `@switch`
- Taille cohérente par contexte : `16px` inline, dans les tables, les tags, les boutons et un message `small` ; `20px` en en-tête et dans un message ; `24px` dans un état vide et sur une pochette absente en grand. Posée en `width` / `height` sur le SVG, jamais en `font-size`
- PrimeIcons ne contient aucun des logos dont le projet a besoin, d'où Simple Icons : quatre fichiers copiés plutôt que le paquet complet, dont on n'extrairait que quatre tracés sur plus de trois mille
- `currentColor` obligatoire sur les SVG : la couleur vient du contexte, jamais du fichier
- Aucune action destructive n'est signalée par une icône seule : rollback et confirmation d'écriture portent toujours un libellé traduit

---

# ✨ Animations & Motion

## Librairie(s)

| Librairie | Rôle | Périmètre |
|-----------|------|-----------|
| Angular (`animate.enter`) | Entrée d'un élément | Hôtes de page, écran bloquant, formulaire et résumé de Playlist, erreur contextuelle, pochette |
| `tailwindcss-primeui` | Utilitaires d'animation | `animate-fadein`, `animate-duration-*`, `animate-ease-out`, combinés dans `FADE_IN` (`shared/utils/motion.ts`) |
| PrimeNG | Transitions de ses composants, en CSS | Modales, toasts, onglets, squelettes, `p-message`. `showTransitionOptions` / `hideTransitionOptions` sont sans effet, sans erreur |

Aucune dépendance d'animation dédiée.

## Principes Directeurs

- **Intensité** : `subtile`. L'application est un outil de production, pas une vitrine
- **Durée standard** : `animate-duration-200`, jamais au-delà pour ce que le projet anime lui-même. Le fondu du tooltip, codé en dur par PrimeNG, est la seule exception
- **Easing** : `animate-ease-out`
- **Intention** : rendre lisible un changement d'état. Une animation qui ne fait que décorer est du délai ajouté
- **Mouvement réduit** : tout est coupé sous `prefers-reduced-motion: reduce`, par une règle du CSS global qui surcharge la propriété `animation` des utilitaires `animate-*` et des `p-animate-*` de PrimeNG. Le plugin pose la propriété elle-même, pas une variable interposée : une variable custom sur `:root` ne couperait rien. C'est le seul `!important` toléré (§ Anti-Patterns). Le mouvement ne porte aucune information : rien ne casse quand il s'éteint

## Composants Animés

> Les transitions des composants PrimeNG sont intégrées et ne sont pas reprises ici. Ce tableau couvre les éléments custom, plus les composants PrimeNG dont les paramètres sont une décision projet : les deux modales de morceau, dont l'absence d'animation en est une ; `p-message`, coupé dans les cellules réservées ; le tooltip, dont le délai n'a aucun défaut dans la bibliothèque ; la barre de progression, dont la transition par défaut retarde l'information.

| Composant | Type d'animation | Librairie | Trigger |
|-----------|-----------------|-----------|---------|
| Modales d'arbitrage et du lien | **Aucune** (`NO_MOTION`) | PrimeNG | La décision est sur le chemin critique du run : une transition d'entrée ne fait que la retarder |
| Contenu d'un onglet | Fondu, opacité seule, jamais de déplacement | `FADE_IN` + `animate.enter` sur l'hôte de page | Changement d'onglet. La barre `p-tabs` reste hors du conteneur animé : seul ce qu'elle commande se substitue |
| Écran bloquant | Fondu | `FADE_IN` + `animate.enter` | Montage |
| Formulaire et résumé de Playlist | Fondu de celui qui entre | `FADE_IN` + `animate.enter` | Repli au lancement, « Modifier » |
| Erreur contextuelle, invite de reprise | Fondu | `FADE_IN` + `animate.enter` | Montage |
| Message inline dans une cellule réservée | **Aucune** (`[animated]="false"`) | PrimeNG | Bandeaux de source de l'arbitrage, « Rattrapé sur » du lien : la cellule ne bouge pas, son contenu non plus |
| Vignette de pochette | Fondu à l'arrivée de l'image | `FADE_IN` | Chargement terminé |
| Zone cliquable custom | Transition de fond 150ms `ease-out` | CSS | Hover |
| Tag d'état | Transition de couleur 150ms | CSS | Événements `arbitration_required` et `track_resolved` |
| Barre de progression | Largeur suivie en 200ms `ease-out` | `[pt]` sur l'élément `value` de `p-progressbar` | Chaque événement `progress`. La transition de 1s de PrimeNG, relancée à chaque événement, laissait la barre à 5 % d'un run fini à 97 % |
| Tooltip | Fondu de 250ms à l'apparition, rien à la disparition, après 400ms de survol | PrimeNG (`fadeIn` codé en dur) + `showDelay` du jeu `TOOLTIP` | Survol maintenu : un survol de passage n'allume rien |

---

# 📐 Layout & Espacement

## Structure de Page

| Élément | Valeur | Usage |
|---------|--------|-------|
| Fenêtre | 1280 × 800 à l'ouverture, plancher 1024 × 700, sans plafond | Plancher dicté par les sept colonnes de la liste du run. Réglages dans `tauri.conf.json`, cf. [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives) |
| Shell | Barre `p-tabs` en haut, contenu sur le reste de la hauteur | La page ne défile jamais, le scroll vit dans la table. Le shell masque son débordement et `overscroll-behavior: none` coupe le rebond de WebView2, qui fait trembler toute la fenêtre à la molette |
| Container | Pleine largeur, `px-16 py-8` | Tous les écrans, porté par le shell : une page ne pose que son contenu |
| Densité | Body dense (`text-sm`) dans les tables et les listes de candidats | Chaque cran de taille en moins est une ligne de plus sans défiler (§ Scale Typographique) |
| Modale d'arbitrage | 720 × 560px, zone de liste 268px | Figée quelle que soit la fenêtre, étape lien comprise |
| Modale du lien | 720px, hauteur au contenu, erreur réservée `min-h-13.5`, contenu en `pb-4` | Largeur de l'arbitrage. `min-h-13.5` (54px) : une erreur sur deux lignes en FR, le pied ne bouge pas. `pb-4` : l'erreur garde 16px au champ et au pied |
| Confirmation d'un geste sur les fichiers | 30rem (`w-120`) | Largeur de la fiche `ConfirmDialog` |
| Invite de reprise | 30rem (`w-120`) | Largeur de la `Dialog` d'`AppShell`, reprise telle quelle. Le titre et les trois boutons français du dossier introuvable sont à contrôler à l'écran par `/verify` |
| Confirmation de sortie | 512px (`w-128`) | Mesurée sur le titre et les deux boutons en français |
| Tables | `p-table` à sa taille par défaut, `[scrollable]` en `scrollHeight="flex"`, `[virtualScroll]` | Seules les lignes visibles sont montées : une playlist de plusieurs milliers de morceaux s'affiche aussi vite qu'une de trente. En contrepartie, `virtualScrollItemSize` doit valoir la hauteur exacte d'une ligne, posée par une classe et à remesurer quand leur style change. Un contenu plus haut, comme le détail avant / après, se pose sur plusieurs lignes de cette hauteur, jamais dans une ligne qui grandit |
| Rythme interne d'un groupe | `gap-2` | Éléments d'un même groupe |
| Espacement entre groupes | `gap-4` | Groupes d'un même écran |
| Espacement entre sections | `gap-6` | Blocs d'un écran, sur les trois onglets |
| Grid principal | Flexbox et CSS Grid natifs | Aucune librairie de grid |

Un formulaire et une table qui ne partagent pas la même largeur ne s'alignent sur rien : d'où le container unique. La pleine largeur sert les colonnes Avant et Après, qui portent chacune un artiste et un titre et sont exactement ce que l'utilisateur compare.

**Colonnes de la liste d'un run** :

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Chevron | 48px (`w-12`) | Bouton d'ouverture du détail, `small` de 34px plus la seule marge gauche de sa cellule, sans marge droite : l'écart chevron → vignette égale ainsi l'écart vignette → texte |
| Pochette | 60px (`w-15`) | Vignette de 32px plus les marges de la cellule : plus étroite, la pochette se réduit et le cadre vide déborde |
| Avant | **fluide** | Artiste et titre lus dans le fichier, **nom du fichier en sous-texte** `text-xs text-muted-color`. Deux lignes en toutes circonstances : tags vides, le nom de fichier sans extension passe en ligne principale, le sous-texte gardant le nom complet |
| Après | **fluide** | Ce que la source retenue va écrire |
| Source | 144px (`w-36`) | Logo 16px et libellé, mesurée sur « SoundCloud » |
| Score | 128px (`w-32`) | Aligné à droite, mesurée sur `A 100 · T 100` |
| État | 192px (`w-48`) | Tag et icône info, mesurée sur « Échec d'écriture » : 184px en français, 155px en anglais |

Les colonnes fixes sont figées parce que leur contenu arrive pendant le run : sans largeur, elles bougeraient à chaque morceau résolu. Chacune se mesure sur son contenu le plus large, dans les deux langues et pas un pixel de plus : ce qui leur est repris va aux deux colonnes qu'on compare.

**Colonnes du rapport d'extraction** :

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Fichier | **fluide** | Nom du fichier, tronqué et révélé au survol |
| État | 197px (`w-49.25`) | Tag et icône info, mesurée sur « Doublon départagé », le plus long des libellés du rapport ; l'anglais est plus court |

Sans largeur figée sur État, la colonne se redimensionnerait au défilement selon les tags que le défilement virtuel a montés. Les deux tables sont en `table-layout: fixed` (par `fullHeightTable`) : en disposition auto, les largeurs de l'en-tête ne sont qu'indicatives.

**Ce qui demande un geste ouvre le rapport** : échecs de transfert, introuvables, puis doublons départagés, enfin déjà présents et extraits. Ce qui est passé tout seul n'attend rien de l'utilisateur.

**Onglet Playlist en deux temps.** Le formulaire est une grille de trois colonnes, `grid-cols-[max-content_max-content_1fr]` en `gap-4` : libellés, contrôles de même largeur, chemins alignés à droite, « Extraire la playlist » sur la ligne du mode, calé à droite. Au lancement, il cède la place à une ligne de résumé, source › destination › playlist · mode, la barre de progression dessous pendant l'extraction. Le rapport récupère ainsi la hauteur du formulaire (le 2026-09-17 : 12 lignes visibles à 1280 × 800, 10 au plancher). « Modifier » rouvre le formulaire sans masquer le rapport, et le lancement suivant replie de nouveau.

**Onglet Tagging** : le titre, puis la ligne du dossier en `grid-cols-[max-content_1fr_max-content]` : bouton de sélection, chemin collé à lui, bouton d'action du run calé à droite. Ni libellé ni « Aucun dossier sélectionné » : le bloc vide dit déjà quoi faire. La phase de rattrapage ouverte, sa barre prend l'emplacement de celle du run et la liste garde toute la hauteur.

**Source dit d'où vient la donnée écrite, État par quel chemin on y est arrivé.** Un morceau résolu par une URL SoundCloud affiche SoundCloud en source et « URL » en état : c'est la seule voie par laquelle SoundCloud entre dans le produit. C'est la séparation entre `state` et `resolution` du contrat NDJSON, portée à l'affichage.

Deux choix portent le tableau. Le **nom de fichier est un sous-texte d'Avant**, pas une colonne : quand les tags manquent, c'est lui qui sert de requête, et deux colonnes pour la même chaîne coûteraient de la largeur à celles qu'on compare. Le **score s'affiche en trois nombres** : le plancher à 70 s'applique séparément à l'artiste et au titre, le seuil haut à 90 sur leur moyenne. Un seul chiffre cacherait lequel des deux fait tomber le morceau en zone grise, ce qu'il faut savoir pour arbitrer.

**Modale d'arbitrage** : largeur et hauteur figées, indépendantes du nombre de candidats. La liste occupe une zone de hauteur fixe avec son propre scroll, le compteur et les boutons sont ancrés en bas : le remplacement de la liste Beatport par la liste Bandcamp ne déplace rien. C'est le seul écran où l'utilisateur enchaîne les clics à cadence rapide, sur une file qui peut compter des dizaines d'arbitrages : un bouton qui se décale entre deux clics fait valider le mauvais candidat, et l'erreur ne se voit qu'après l'écriture.

## Responsive

> Approche : `desktop-only`. Application de bureau Windows, aucune cible mobile ni tactile.

| Breakpoint | Notation Tailwind | Largeur | Changements clés |
|------------|-------------------|---------|------------------|
| Base | (défaut) | ≥ 1024px, plancher de la fenêtre | Sept colonnes au complet, le redimensionnement absorbé par Avant et Après |

Un jeu de colonnes qui tient au plancher plutôt qu'un masquage progressif : personne n'a à retenir quelle information disparaît à quelle taille.

---

# 🔧 Conventions de Code

## Composition de Styles

**CSS pur, aucun SCSS** : Tailwind v4 ne compile ni SCSS ni LESS, un fichier global en `.scss` échoue sur `Can't resolve './theme/colors.css'`. Un seul fichier d'entrée, `src/styles.css` : police, Tailwind, plugin, variant `dark`, `@theme`, plus les règles globales qu'aucun utilitaire ne porte (rebond de WebView2, curseur, tooltip, mouvement réduit).

**Utilitaire** : classes Tailwind dans le template, conditionnées par `[class.x]` ou `[ngClass]`. Le DOM interne d'un composant PrimeNG se règle par `[pt]`, ou dans le preset quand l'écart vaut partout.

**Preset** : `TECHNO_TAGGER_PRESET` (`core/theme.ts`) dérive d'Aura par `definePreset()` et n'y change que ce que ce document décide : rayons de la carte (`lg`), du tag (`sm`) et du badge (`xs`), carte sans ombre, poids 400 du libellé de champ, en-tête des modales (§ Overlays). Un nouvel écart s'y range selon sa portée : `primitive` pour une rampe ou un rayon, `semantic` pour un rôle, `components` pour un composant.

**Cascade** : `cssLayer: { name: 'primeng', order: 'theme, base, primeng' }` dans `providePrimeNG()`. La couche `primeng` passe après `theme` et `base` et avant les utilitaires : les classes Tailwind gagnent sur les styles de composant, sans rien déclarer dans le CSS.

**Ordre des classes** : réordonné au format par `prettier-plugin-tailwindcss`. Aucune convention manuelle, rien à relire en review sur ce point.

## Règles

- ✅ **Composant PrimeNG d'abord** : aucun composant custom tant que la bibliothèque en fournit un équivalent. Le catalogue large est la raison du choix de PrimeNG (cf. [ADR-003](adrs/003-primeng-community-license.md))
- ✅ **Trois niveaux de personnalisation, dans cet ordre** : `definePreset()` pour ce qui vaut partout (seule voie pour le thème sans le Theme Designer, cf. [ADR-003](adrs/003-primeng-community-license.md)), `[dt]` pour les design tokens d'une seule instance, `[pt]` pour les classes et attributs de ses éléments internes. La doc PrimeNG recommande cette voie contre `::ng-deep` (« This approach is recommended over the `::ng-deep` as it offers a cleaner API while avoiding the hassle of CSS rule overrides »)
- ✅ **Tokens uniquement** : `bg-highlight`, `text-muted-color`, `border-surface`. Aucune valeur de couleur écrite dans un composant
- ✅ **Une largeur se mesure sur le contenu le plus long, dans les deux langues** : les libellés existent en FR et en EN (cf. [ADR-004](adrs/004-i18n-ngx-translate.md)), le français étant généralement le plus long. Un bouton ou un libellé n'a aucune largeur en dur et se dimensionne sur son contenu, ou sur le plus large de sa colonne de grille. Une colonne de table se fige au contraire sur le plus long de ses contenus (§ Layout), sinon elle bouge au défilement
- ✅ **Boutons en `size="small"` partout** : pages, modales et confirmations (`DangerConfirmComponent`, acceptation et « Annuler »). Seuls les boutons `link` y échappent
- ✅ **Un tooltip révèle, il ne porte pas** : il montre ce qui est déjà à l'écran mais coupé. Invisible au clavier, au tactile et à l'impression, il ne remplace ni un libellé, ni une aide de formulaire, ni un message d'erreur, qui sont des `p-message` inline. Trois exceptions : la raison d'une action désactivée, sur le bouton ; le détail d'une ligne du rapport d'extraction ; le motif d'un morceau en échec. Il se devine : l'ellipse annonce celui d'un texte coupé, ailleurs une icône `info-circle` en `text-muted-color`, hors de tout tag pour ne pas se lire comme la famille Décision attendue
- ✅ **Aucun libellé en dur dans un template** : tout passe par ngx-translate, y compris les erreurs, que le sidecar émet en `code` + `params`
- ✅ **Navigation clavier complète sur la modale d'arbitrage** : flèches entre arbitrages, Entrée pour valider, focus visible en permanence
- ✅ **Les filtres du récapitulatif lisent `state` pour l'échec, `resolution` pour la voie** : « échecs » vaut `state ∈ {unresolved, write_error}` ; « validés » et « arbitrés » valent `state ∈ {resolved, written}`, puis se distinguent sur `resolution`, sans quoi un `write_error` apparaîtrait dans deux filtres. « Arbitrés » vaut `resolution ∈ {arbitration, url}`, jamais `arbitration` seul. Un morceau `rolled_back` n'appartient à aucun filtre, aucune décision ne le décrivant plus. Pièges détaillés dans [ARCHITECTURE.md § API](ARCHITECTURE.md#api)

## Anti-Patterns

- ❌ **`::ng-deep`** : percer l'encapsulation d'un composant PrimeNG produit du style qui casse à la première mise à jour et qu'aucune recherche ne retrouve quand on cherche d'où vient une couleur. Passer par `[dt]` ou `[pt]`
- ❌ **`!important`** : si un style ne s'applique pas, l'ordre des couches est en cause, à corriger dans `cssLayer`. Seule exception, la coupure des animations sous `prefers-reduced-motion` (§ Principes Directeurs)
- ❌ **Couleurs en dur** : ni hex, ni `bg-emerald-500`. Un changement de preset doit rester un changement de preset
- ❌ **`font-family` sur `body`** : `--font-sans` alimente `--default-font-family`, que le preflight applique à `html, :host`, la même valeur que rend `font-sans`. Une règle sur `body` afficherait la bonne police en laissant `font-sans` sur la pile système, écart muet jusqu'au jour où la classe sert
- ❌ **Sévérités mal orthographiées** : `warn`, jamais `warning`, sur `p-tag`, `p-badge`, `p-message` et `pButton` (seul `badgeSeverity` de `pButton` attend `warning`). `p-message` n'accepte pas `danger` : son erreur est `error`
- ❌ **Styles inline `[style]`** : réservés aux valeurs calculées à l'exécution (largeur d'une barre, position d'un élément virtualisé)
- ❌ **Logique métier dans un composant** : scores, seuils et classement des candidats viennent du sidecar. L'interface affiche ce qu'elle reçoit, hors les trois états qu'elle dérive de ce qu'elle n'a pas reçu (cf. [ARCHITECTURE.md § Frontend](ARCHITECTURE.md#-frontend))
- ❌ **Animation sur le chemin de décision** : rien ne s'anime entre l'arrivée d'un `arbitration_required` et l'affichage des candidats
- ❌ **Pochettes en base64 dans le flux NDJSON** : les images passent par `convertFileSrc()` depuis le cache disque, le protocole reste textuel et lisible

---

# 🔗 Ressources

## Maquette et design system externes

- **Design system** : [Techno Tagger Design System](https://claude.ai/design/p/66daf6c5-f225-4dcc-bf7d-1d792e633ee5) : les composants du mapping ci-dessus, chacun avec son miroir JSX, son typage et sa fiche d'usage, plus les tokens et les guidelines. Fait foi sur les composants, ce document sur les règles
- **Maquette** : le même projet, dossier `ui_kits/techno-tagger/` : un écran cliquable par onglet, plus le shell. Fait foi sur l'apparence d'un écran là où ce document se tait
- **Synchronisation** : fichier par fichier, procédure et journal dans `.design-sync/NOTES.md`. Le convertisseur automatique ne s'applique pas, l'interface étant Angular sans point d'entrée de librairie : les composants du projet distant sont des recréations React bâties depuis ce document, jamais depuis le code livré
- **Lecture locale** : export dans `.design-sync/design-system/`, ignoré par git. Un écran ou une fiche se lit là plutôt qu'à distance, la lecture distante coûtant un appel par fichier. À refaire après chaque push et avant toute comparaison au code : l'export ne s'invalide pas tout seul, et un fichier périmé se lit exactement comme un fichier à jour

### Arbitrages

Écarts au design system ou à la maquette tranchés par le propriétaire. Ils priment sur eux pour tous les écrans. Une ligne datée « réaligné » décrit une source déjà mise à jour : elle reste ici parce que la règle tient toujours.

- **Icônes** : SVG inline par `IconComponent` et `SourceLogoComponent`, là où le design system rend les mêmes glyphes par la police PrimeIcons. Écart définitif : React ne peut pas importer un composant d'icône Angular, et la v22 rend ses icônes en SVG
- **Largeurs** : une largeur se remesure sur le contenu le plus long en FR et en EN, là où le design system en donne une en pixels. Design system réaligné le 2026-09-24 sur les trois colonnes fixes du run, qui cessent d'annoncer des valeurs
- **Container** : un seul container pleine largeur pour tous les écrans, là où le design system posait deux régimes, données en pleine largeur et formulaires centrés. Réaligné le 2026-09-24
- **Densité des tables** : `p-table` à sa taille par défaut, là où le design system les donnait en `small`. Réaligné le 2026-09-24
- **Séparateur artiste / titre** : un tiret simple, là où la maquette employait le cadratin, que le produit réserve à la cellule sans valeur. Réaligné le 2026-09-24
- **Candidat d'arbitrage** : « Artiste - Titre » et score « 94 (A 96 · T 92) » sur une ligne, là où la maquette ne montrait que le titre et « A · T ». C'est souvent l'artiste qui fait tomber un candidat en zone grise. Décidé le 2026-09-26, réaligné le 2026-09-29
- **Croix de la modale d'arbitrage** : l'arbitrage reste en file, la modale revient par le badge de file ou par la ligne du morceau, là où la maquette le retirait de la file. Décidé le 2026-09-26, retour par la ligne et réaligné le 2026-09-29
- **Vocabulaire « zone grise »** : interne au scoring, jamais affiché ; l'interface dit « correspondances incertaines », là où le `SettingsScreen` l'employait dans l'indice du Seuil haut. Décidé le 2026-09-27, réalignement constaté le 2026-10-05
- **Zone hôte du rattrapage** : aucun logo ni message d'hôte à la frappe, le sidecar juge l'URL et un refus revient sous le champ, là où `UrlRescue` reconnaissait l'hôte et grisait le bouton. Décidé le 2026-09-29, réaligné le 2026-10-05
- **Barre de la phase de rattrapage** : « N sur M rattrapés » à l'emplacement de la barre du run, masquée sur 0 sur 0, là où la maquette gardait la barre réseau figée à 100 %. Décidé le 2026-10-03, réaligné le 2026-10-05
- **Lignes rattrapées** : gardées dans la navigation de la modale du lien avec « Rattrapé sur `<Source>` » et leur lien, pour corriger, là où la maquette les retirait. Décidé le 2026-10-02, réaligné le 2026-10-06
- **Rattrapage après interruption** : ouvert aussi sur un run interrompu, là où la maquette ne montrait rien en phase `interrupted`. Décidé le 2026-10-02, réaligné le 2026-10-05
- **Rattrapage par modale** : modale du lien par morceau, ouverte par la ligne du run ou le badge, là où `UrlRescue` empilait un bloc de lignes sous la table. Décidé et réaligné le 2026-10-06
- **Badge du rattrapage** : « N à rattraper » à droite du badge de file, les deux groupés en `gap-2`, là où la maquette n'en avait pas. Décidé et réaligné le 2026-10-06
- **Étape lien de l'arbitrage** : après le refus de la liste Bandcamp, ou « Passer » sur une liste vide, la modale enchaîne sur le lien du même morceau dans le même cadre, là où `ArbitrationDialog` fermait. Décidé et réaligné le 2026-10-06
- **Indice de rattrapage** : « Coller un lien → » en gras dans la colonne Après, là où la maquette laissait la cellule vide ; poids 600 hors des titres, seul écart à la Scale Typographique. Décidé et réaligné le 2026-10-06
- **Rien à rattraper** : ligne `check-circle` à la place de la barre, là où `UrlRescue` posait un `EmptyState` dans le bloc. Décidé et réaligné le 2026-10-06
- **Bouton d'action du run** : un seul bouton qui suit la phase, à la largeur de son libellé (§ Actions), là où la maquette posait « Interrompre » à côté de « Lancer le run ». Décidé le 2026-10-06, relance du même dossier et relance de l'écriture dans ce bouton le 2026-10-11, réaligné le 2026-10-11
- **Rouge des gestes sur les fichiers** : `danger` sur le seul bouton d'acceptation du rollback ; « Écrire les tags » et « Relancer l'écriture » acceptent en `primary`, les tags d'origine étant sauvegardés avant toute écriture. Les déclencheurs restent `primary`, pleins pour le bouton d'action du run, en contour pour la restauration, là où le `Recap` de la maquette posait la relance en `danger` contour. C'est la modale qui avertit, pas le bouton qui l'ouvre. Décidé le 2026-10-10, relance passée en plein le 2026-10-11, réaligné le 2026-10-11
- **Relance de l'écriture** : « Relancer l'écriture », portée par le bouton d'action du run, le message d'échec au-dessus de la liste ne gardant que le texte, là où la maquette l'intitule « Relancer l'écriture sur les échecs » dans le `Recap`. Décidé le 2026-10-06, bouton sorti du message le 2026-10-11, réaligné le 2026-10-11
- **Boutons du `p-confirmdialog`** : « Annuler » en `secondary` outlined et aucune icône devant le message, comme toutes les modales de l'app, là où la fiche `ConfirmDialog` et la maquette posent « Annuler » en texte et une icône `exclamation-triangle`. Les deux boutons en `size="small"`. Vaut pour l'écriture, la relance et le rollback. Décidé le 2026-10-10, `small` le 2026-10-11, réaligné le 2026-10-11
- **Espacement entre sections** : `gap-6` (24px) entre les blocs d'un écran, sur les trois onglets, là où la maquette les espaçait de 16px. Décidé et réaligné le 2026-10-05
- **Gris de légende et séparateurs** : tokens nommés, `text-muted-color` pour l'aide de la modale d'arbitrage et `border-surface` pour le séparateur des Réglages, là où la maquette posait `--p-surface-500` et `--p-surface-800`. Décidé et réaligné le 2026-10-05
- **Lignes du détail avant / après** : les champs écrits avec la clé du fichier écrit, plus le commentaire, là où `TrackDetail` montrait `TPE2`, la date complète et une traçabilité combinée : le détail montre ce que l'écriture fait. Décidé le 2026-10-06. Sans l'identifiant à la source, qui ne dit rien à l'utilisateur, le 2026-10-09. Ordre par blocs et clé sans préfixe `TXXX:` (§ Tables et listes) le 2026-10-11. Réaligné le 2026-10-11
- **Colonne Champ du détail** : à la largeur de son plus long libellé suivi de sa clé, Avant et Après se partageant le reste, là où `TrackDetail` posait trois tiers égaux, qui coupaient « Numéro de catalogue » et sa clé au plancher de 1024px. Décidé le 2026-10-09, réaligné le 2026-10-11
- **Détail d'un morceau** : déplié sous la ligne comme dans la maquette (`DataTable` expandable), mais sur des lignes de la hauteur des autres, le cadre prenant un nombre entier de lignes : le scroll virtuel de `p-table` place chaque ligne à son rang multiplié par la hauteur d'une ligne, sans la mesurer. La ligne dépliée native, sans scroll virtuel, coûte 11,5 s de premier rendu à 2 000 morceaux, mesuré le 2026-10-10 ([knowledges/primeng.md](knowledges/primeng.md#détail-déplié-sous-une-ligne-virtualisée)). Le bouton d'ouverture reste un `pButton` texte `small` `secondary` à icône seule, dans une colonne mesurée sur lui, là où le `DataTable` pose un bouton nu de 1.25rem dans une colonne de 2rem. Décidé le 2026-10-10, réaligné le 2026-10-11
- **Taille des boutons** : `size="small"` sur tous les boutons, de page comme de modale, là où la maquette laisse la taille par défaut à « Lancer le run », « Interrompre » et « Réessayer ». Décidé et réaligné le 2026-10-11
- **Position des tooltips** : sous l'élément partout, là où le `Tooltip` du design system s'ouvre au-dessus par défaut et où la page Playlist ouvrait à gauche. Décidé et réaligné le 2026-10-11
- **Rangée de Réglages** : la colonne de gauche ne porte que le libellé, l'aide va avec le contrôle (sous le champ, ou sur la ligne d'un bouton seul), là où `Row` empile libellé et aide dans une colonne de 256px. Décidé et réaligné le 2026-10-11
- **État de la clé API** : 24 points en placeholder du champ, sans tag, là où `SettingsScreen` pose un `Tag` « Clé enregistrée » ou « Aucune clé ». Décidé et réaligné le 2026-10-11
- **Vocabulaire de la restauration** : un seul verbe, « Restaurer », rangée « Restauration » dans les Réglages, là où la maquette dit « Annuler le dernier run » sous un libellé « Rollback », en `danger` contour. La modale du run a son propre « Annuler » de fermeture, qu'un « Annuler l'écriture » aurait fait lire comme son contraire. Décidé et réaligné le 2026-10-11
- **Une phrase par ligne** : chaque phrase d'un message sur sa ligne (§ Feedback et chargement), là où la maquette écrit ses messages en prose continue. Décidé et réaligné le 2026-10-11
- **États de l'invite de reprise** : dossier introuvable ou vidé, plan illisible et plan corrompu, trois états que la maquette ne montre pas, « Plus tard » étant réservé au dossier introuvable ou vidé, là où `AppShell` n'a qu'une invite de run reprenable. Décidé le 2026-10-12
- **Focus de l'invite de reprise** : aucun bouton focalisé à l'ouverture, là où `Dialog` focalise le premier. Entrée ne supprime pas le plan. Décidé le 2026-10-12
- **Dossier de l'invite de reprise** : le dossier sur sa propre ligne sous le résumé, tronqué à gauche, là où `AppShell` l'écrit dans la phrase. Décidé le 2026-10-12
- **Confirmation de sortie** : run, arbitrages et run non confirmé ne retiennent plus la fenêtre, le plan de run les rend à la reprise. La maquette `CloseConfirmation` garde ces trois lignes. Décidé le 2026-10-12
- **Ouverture du récapitulatif** : un bouton « Récapitulatif » à la fin de l'écriture, là où la maquette simulait un lien dans la barre d'onglets. Décidé le 2026-10-12
- **Lien vers la fiche source** : dans la ligne URL du détail déplié, en bouton `link`, là où la maquette n'en montrait aucun et où la fiche `Button` réserve cette variante à « Revenir à Beatport ». Décidé le 2026-10-12
- **« Envoyer ce rapport »** : absent du récapitulatif jusqu'à la Feature 9, là où le `Recap` de la maquette le pose en pied. Décidé le 2026-10-12
- **Retour du récapitulatif** : bouton « Retour à la liste » en tête du récapitulatif, là où la maquette n'offre aucun retour, l'onglet Tagging déjà actif ne naviguant pas. Décidé le 2026-10-12
- **Runs passés** : rangée des Réglages, sélecteur et bouton plutôt qu'une table (la page ne défile pas), récapitulatif rouvert en lecture seule sous une ligne de contexte sur sa propre rangée, hauteur réservée pendant le chargement. Absents de la maquette. Décidé le 2026-10-13

## Documentation Officielle

- [PrimeNG : Theming](https://primeng.dev/theming) : design tokens, `definePreset()`, `darkModeSelector`, tokens scopés `[dt]`
- [PrimeNG : Configuration](https://primeng.dev/configuration) : `providePrimeNG()`, licence, ripple (désactivé par défaut)
- [PrimeNG : Tailwind CSS](https://primeng.dev/tailwind) : installation, classes issues des tokens, utilitaires d'animation, dark mode
- [PrimeNG : PassThrough](https://primeng.dev/passthrough) : API `[pt]`, locale et globale
- [PrimeNG : Table](https://primeng.dev/table) : `scrollHeight="flex"`, scroll virtuel
- [PrimeNG : Migration v21](https://primeng.dev/migration/v21) : passage aux animations CSS natives
- [Tailwind CSS : Dark mode](https://tailwindcss.com/docs/dark-mode) : `@custom-variant`
- [PrimeIcons](https://primeicons.dev) : catalogue, catégories, recherche
- [Angular : Enter and Leave animations](https://angular.dev/guide/animations) : `animate.enter` / `animate.leave`
- [Angular : Migrating to Native CSS Animations](https://angular.dev/guide/animations/migration) : sortie de `@angular/animations`
- [Simple Icons](https://simpleicons.org) : logos Beatport, Bandcamp, SoundCloud, VLC media player
- [Fontsource : Inter](https://fontsource.org/fonts/inter) : paquet `@fontsource-variable/inter`, axes et poids

## Ressources Complémentaires

- [Preset Aura : source](https://github.com/primefaces/primeuix/blob/main/packages/themes/src/presets/aura/base/index.ts) : valeurs exactes des primitives et des tokens sémantiques
- [primeng#17946](https://github.com/primefaces/primeng/issues/17946) et [tailwindcss-primeui#27](https://github.com/primefaces/tailwindcss-primeui/issues/27) : l'incompatibilité SCSS de Tailwind v4
- [ARCHITECTURE.md](ARCHITECTURE.md) : stack, écrans, contrat NDJSON et modes de panne à couvrir visuellement
- [VERSIONS.md](VERSIONS.md) : versions exactes de PrimeNG, `@primeuix/themes`, `@primeicons/angular`, Tailwind CSS et Inter
- [ADR-003](adrs/003-primeng-community-license.md) : PrimeNG sous Community License, preset Aura, `definePreset()` comme seule voie de personnalisation **du thème**, le Theme Designer n'étant pas inclus
- [ADR-004](adrs/004-i18n-ngx-translate.md) : bascule FR / EN à l'exécution, contrainte d'élasticité des libellés
