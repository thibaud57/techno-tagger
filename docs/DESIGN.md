---
title: "DESIGN — techno-tagger"
description: "Design system : typographie, couleurs, librairies UI, mapping composants et conventions de style de l'interface Angular + PrimeNG."
date: "2026-08-29"
keywords: ["design", "ui", "design-system", "typography", "colors", "animations", "layout", "dark-mode", "icons", "components", "spacing", "primeng", "tailwind"]
scope: ["docs", "frontend"]
technologies: ["Angular", "PrimeNG", "Tailwind CSS", "PrimeIcons", "Simple Icons", "Inter", "Tauri"]
---

> Versions de référence : PrimeNG **22.1.0**, `@primeuix/themes` **3.0.0**, `@primeicons/angular` **8.0.0**, Tailwind CSS **4.3.3**, `@fontsource-variable/inter` **5.3.0**. Détail et compatibilité croisée dans [VERSIONS.md](VERSIONS.md). La documentation de primeng.dev sert la 22.1.0-rc.2 au moment de la rédaction.

# 🎨 Identité Visuelle

## Typographie

### Police Principale

**Famille** : `Inter Variable`

**Source** : `@fontsource-variable/inter`, embarquée dans le bundle. Import `@fontsource-variable/inter/wght.css` (poids 100 à 900 sur un seul fichier), `font-family: 'Inter Variable', sans-serif` sur `body`

**Usage** : toute l'interface, sans exception

Aucun appel à un CDN de polices : l'application est un binaire local qui doit s'afficher identiquement hors ligne, et une webview qui attend un `fonts.googleapis.com` injoignable rend en police de repli le temps du timeout.

Le preset Aura ne déclare **aucune `font-family`** (vérifié dans sa source : seuls des `fontSize` et des `fontWeight` y figurent). La typographie est donc entièrement à la charge du projet, et rien n'est à défaire côté preset.

### Scale Typographique

Base **16px**, imposée par l'import `@primeuix/themes/aura` en version non-`compat` (cf. [ADR-003](adrs/003-primeng-community-license.md)).

| Usage | Taille | Poids | Classe |
|-------|--------|-------|--------|
| H1 (titre d'écran) | 1.5rem (24px) | 600 | `text-2xl font-semibold` |
| H2 (section) | 1.25rem (20px) | 600 | `text-xl font-semibold` |
| H3 (entête de modale, sous-section) | 1.125rem (18px) | 600 | `text-lg font-semibold` |
| Body | 1rem (16px) | 400 | `text-base` |
| Body dense (tables, listes de candidats) | 0.875rem (14px) | 400 | `text-sm` |
| Caption (scores, compteurs, aide) | 0.75rem (12px) | 400 | `text-xs` |

Les écrans de données tournent en **body dense** : un run affiche 100 lignes, et chaque cran de taille en moins est une ligne de plus visible sans scroller.

### Chiffres

Le point médian sépare deux valeurs de même rang, jamais un total de son détail. Le score a donc deux notations selon la place disponible :

- **En table** : `94` sur la ligne principale, `A 96 · T 92` en `text-xs` dessous
- **Sur une seule ligne** : `94 (A 96 · T 92)`

En table, la subordination du détail à la moyenne est portée par la mise en page. Sur une seule ligne, `94 · A 96 · T 92` utiliserait le même séparateur pour deux niveaux différents et ferait lire trois valeurs de même rang, alors que 94 est la moyenne des deux autres.

## Palette de Couleurs

### Tokens / Variables

Aucune couleur n'est définie par le projet. Le preset Aura génère l'arbre complet des variables `--p-*` au démarrage, et l'interface les consomme, directement ou via les classes du plugin `tailwindcss-primeui`.

| Token | Valeur en dark | Classe | Usage |
|-------|----------------|--------|-------|
| `--p-primary-color` | `{emerald.400}` | `bg-primary`, `text-primary` | Accent principal, actions primaires, sélection |
| `--p-primary-contrast-color` | `{surface.900}` | `text-primary-contrast` | Texte posé sur `primary` |
| `--p-surface-0` … `--p-surface-950` | palette `zinc` | `bg-surface-900`, `text-surface-500` | Fonds, panneaux, séparateurs |
| `--p-text-color` | `{surface.0}` | `text-color` | Texte principal |
| `--p-text-muted-color` | `{surface.400}` | `text-muted-color` | Texte atténué, placeholders, libellés secondaires |
| `--p-content-border-color` | `{surface.700}` | `border-surface` | Bordures de contenu |
| `--p-disabled-opacity` | `0.6` | — | Éléments désactivés |
| `--p-focus-ring-*` | 1px solid, `{primary.color}`, offset 2px | — | Anneau de focus clavier |

Deux familles de classes cohabitent dans le plugin, à ne pas confondre :

- **Tokens combinables** avec n'importe quel préfixe Tailwind : `primary`, `primary-contrast`, `primary-emphasis`, `primary-{50..950}`, `surface-{0..950}`. D'où `bg-primary`, `text-surface-500`, `ring-primary`
- **Classes complètes**, préfixe déjà inclus, à écrire telles quelles : `text-color`, `text-color-emphasis`, `text-muted-color`, `text-muted-color-emphasis`, `border-surface`, `bg-emphasis`, `bg-highlight`, `bg-highlight-emphasis`, `rounded-border`

Valeurs vérifiées dans la [source du preset Aura](https://github.com/primefaces/primeuix/blob/main/packages/themes/src/presets/aura/base/index.ts), classes dans la [doc Tailwind de PrimeNG](https://primeng.dev/tailwind).

### Tokens de Tooltip

Le tooltip se pose sur `--p-surface-700`, soit deux crans au-dessus du panneau. C'est le seul élément du système plus clair que ce qu'il recouvre, parce qu'il doit se lire par-dessus n'importe quoi.

| Token | Valeur |
|-------|--------|
| `--p-tooltip-background` | `{surface.700}` |
| `--p-tooltip-color` | `{surface.0}` |
| `--p-tooltip-padding` | `0.5rem 0.75rem` |
| `--p-tooltip-border-radius` | `--p-border-radius-md` (6px) |
| `--p-tooltip-max-width` | `12rem` |
| `--tt-tooltip-max-width-wide` | `26rem` |
| `--p-tooltip-gutter` | `0.25rem` |
| `--p-tooltip-shadow` | = `--p-overlay-popover-shadow` |

Les 12rem par défaut conviennent à une glose. Ils coupent en revanche exactement ce qu'un tooltip de colonne fluide est là pour montrer : les colonnes Avant et Après et les lignes de candidats passent donc en `--tt-tooltip-max-width-wide`.

Un tooltip n'est jamais le seul porteur d'une information : il révèle ce qui est déjà à l'écran mais coupé. Ce qui n'existe que dans un tooltip est invisible au clavier, au tactile et à l'impression. Il ne remplace ni un libellé, ni une aide de formulaire, ni un message d'erreur : ceux-là sont des `p-message` inline.

Délai 400ms, pour qu'un survol de passage n'allume rien et qu'un survol intentionnel oui. Fondu de 200ms à l'apparition, rien à la disparition. `pointer-events: none`, pour qu'il ne se mette jamais entre le curseur et ce qu'il décrit.

### Couleurs Sémantiques

Le design system ne connaît pas la liste des états d'un morceau, seulement **quatre familles** auxquelles chacun se rattache. L'énumération exacte vit dans le contrat NDJSON, en trois champs `state` / `resolution` / `failure_reason` (cf. [ARCHITECTURE.md § API](ARCHITECTURE.md#api)), et peut donc s'allonger sans qu'aucune couleur soit à inventer.

| Famille | Sévérité | Icône type | Source | Ce qu'elle couvre |
|---------|----------|------------|--------|-------------------|
| Neutre | `secondary` | `pi-clock` | dérivée | Rien n'est encore arrivé sur ce morceau, il attend son tour dans la file |
| Décision attendue | `info` | `pi-info-circle` | dérivée | `arbitration_required` reçu sans `track_resolved` derrière : le morceau attend un geste humain |
| Résolu | `success` | `pi-check` | `state` | `resolved` et `written` |
| Échec | `danger` | `pi-times` | `state` | `unresolved` et `write_error` |

Les sévérités sont déjà câblées dans `p-tag`, `p-badge`, `p-message` et `p-button`, et suivent le preset sans maintenance.

**Deux familles sur quatre sont dérivées par l'interface** et ne correspondent à aucune valeur de `state` : rien ne circule sur le flux tant qu'un morceau n'est pas tranché, l'interface affiche donc « en attente » ce qu'elle n'a pas reçu et « à arbitrer » ce pour quoi elle a reçu une demande sans réponse.

Le bleu plutôt que l'orange sur la décision attendue : un arbitrage qui attend n'est pas une anomalie, c'est une étape normale qui demande quelque chose. Le choix est déjà posé dans [BRAINSTORM.md](BRAINSTORM.md) (« bleu en attente d'arbitrage »). Conséquence, **`warn` n'est porté par aucun état de morceau** : il reste disponible pour les avertissements qui ne concernent pas une ligne, comme une clé API proche de l'expiration.

**Le libellé porte la voie, jamais la couleur.** `resolution` distingue trois issues positives qui restent toutes vertes :

| `state` | `resolution` | Tag affiché |
|---------|--------------|-------------|
| `resolved` ou `written` | `auto` | vert, `pi-check`, « Auto » |
| `resolved` ou `written` | `arbitration` | vert, `pi-check`, « Arbitré » |
| `resolved` ou `written` | `url` | vert, `pi-check`, « URL » |
| `unresolved` | `none` | rouge, `pi-times`, « Non résolu » |
| `write_error` | — | rouge, `pi-exclamation-triangle`, « Échec d'écriture » |

Un morceau validé automatiquement à 94 est l'endroit le plus probable d'un mauvais match, puisque personne ne l'a regardé. Distinguer « Auto » d'« Arbitré » dit à l'utilisateur où porter son attention, et un glyphe ne se décode pas assez vite dans un tableau dense pour porter cette information.

Les deux rouges partagent la couleur sans partager l'icône, leurs corrections étant opposées : l'un se rattrape par une URL, l'autre en relançant l'écriture (cf. [ARCHITECTURE.md § Robustesse](ARCHITECTURE.md#-robustesse--modes-de-panne)).

**Le libellé d'échec d'écriture reste générique, le motif vit dans la ligne dépliée.** Le verrou n'est qu'un `failure_reason` parmi plusieurs, et la colonne État est dimensionnée sur le plus long des cinq libellés d'état : nommer chaque cause obligerait à l'élargir ou à tronquer. Un motif est du diagnostic, pas de la colonne de balayage.

> **Deux pièges d'orthographe sur les sévérités.** C'est `warn`, jamais `warning`, sur `p-tag`, `p-badge`, `p-message` et `p-button` (seul `badgeSeverity` de `p-button` attend `warning`). Et `p-message` n'accepte pas `danger` : sa sévérité d'erreur est `error`.

### Règles

- ✅ Toujours référencer une couleur par token ou par classe du plugin : jamais de hex, jamais de couleur Tailwind brute (`bg-emerald-500`)
- ✅ **La couleur ne porte jamais seule l'information** : chaque état est toujours accompagné d'une icône et d'un libellé traduit
- ✅ L'accent `primary` reste réservé aux actions et à la sélection. Un écran où tout est vert ne signale plus rien
- ✅ Le `danger` est réservé aux trois actions qui touchent aux fichiers musicaux : la confirmation globale de l'écriture, la relance de l'écriture en échec, et le rollback

## Formes

### Border Radius

Primitives du preset Aura, consommées telles quelles.

| Token | Valeur | Usage |
|-------|--------|-------|
| `--p-border-radius-none` | `0` | Séparateurs, bords de fenêtre |
| `--p-border-radius-xs` | `2px` | Badges, puces de score |
| `--p-border-radius-sm` | `4px` | Petits éléments, tags, vignettes de pochette |
| `--p-border-radius-md` | `6px` | **Défaut** : champs de formulaire (`formField.borderRadius`) et contenu (`content.borderRadius`) |
| `--p-border-radius-lg` | `8px` | Panneaux, cartes |
| `--p-border-radius-xl` | `12px` | Modales, conteneurs larges |

La classe `rounded-border` du plugin applique le rayon de contenu sans passer par la variable.

## Dark / Light Mode

**Stratégie** : dark permanent, aucun sélecteur dans l'interface.

**Mécanisme** : `darkModeSelector: '.app-dark'` dans les options de thème de `providePrimeNG()`, classe `app-dark` posée en dur sur `<html>` dans `index.html`, jamais retirée. C'est le cas documenté par PrimeNG : « In case you prefer to use dark mode all the time, apply the `darkModeSelector` initially and never change it ». Sans cette option, PrimeNG reste calé sur `system`, donc sur `prefers-color-scheme`.

Côté Tailwind v4, le variant est aligné sur le même sélecteur dans le CSS global :

```css
@custom-variant dark (&:where(.app-dark, .app-dark *));
```

### Règles

- ✅ Le mode clair n'existe pas : aucun style ne s'écrit sous un variant `light:`, aucune valeur n'est doublée
- ✅ La classe reste posée en dur plutôt que dérivée de `prefers-color-scheme` : un thème qui bascule selon l'heure système sur un outil utilisé de nuit est un bug, pas une fonctionnalité
- ✅ Si un mode clair devient nécessaire, il passe par le `darkModeSelector` déjà en place et par les tokens : aucun composant n'est à reprendre

---

# 📦 Librairies UI

## Stack UI

| Librairie | Rôle | Périmètre |
|-----------|------|-----------|
| PrimeNG v22 (preset Aura) | Bibliothèque de composants | Tout le fonctionnel : tables, modales, formulaires, progression, notifications |
| Tailwind CSS v4 | Styling utilitaire | Layout, espacement, typographie, états custom |
| `tailwindcss-primeui` | Pont entre les deux | Expose les tokens du preset en classes et fournit les utilitaires d'animation. L'alignement du variant `dark:` reste à écrire à la main, cf. § Dark / Light Mode |
| `@primeicons/angular` 8 | Icônes d'interface | Toutes les icônes UI, câblées d'office dans les composants PrimeNG. Composants SVG standalone, sous licence PrimeUI comme PrimeNG (cf. [ADR-003](adrs/003-primeng-community-license.md)) |
| Simple Icons (4 SVG en assets) | Logos | Beatport, Bandcamp, SoundCloud, VLC media player |

### Installation

```css
/* src/styles.css */
@import "tailwindcss";
@plugin "tailwindcss-primeui";
@custom-variant dark (&:where(.app-dark, .app-dark *));
```

L'ordre des couches CSS se règle côté TypeScript, pas dans le CSS :

```ts
providePrimeNG({
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.app-dark',
      cssLayer: { name: 'primeng', order: 'theme, base, primeng' }
    }
  }
})
```

> **Tailwind v4 ne compile ni SCSS ni LESS.** Le fichier global doit être un `.css`, sinon l'import échoue sur `Can't resolve './theme/colors.css'` ([primeng#17946](https://github.com/primefaces/primeng/issues/17946), [tailwindcss-primeui#27](https://github.com/primefaces/tailwindcss-primeui/issues/27)). C'est la raison pour laquelle tout le styling du projet est en CSS pur (cf. § Conventions de Code).

## Mapping Composants

Une ligne par usage réel de l'application. Les features référencées sont celles de [ARCHITECTURE.md § Flux Fonctionnels](ARCHITECTURE.md#flux-fonctionnels-use-cases-critiques).

| Catégorie | Composant | Notes |
|-----------|-----------|-------|
| Navigation principale | `p-tabs` synchronisé à la main avec le Router | PrimeNG v22 ne fournit aucun mode router, et `p-tabMenu` a été supprimé. L'onglet actif se dérive de l'URL, la navigation se déclenche au changement de valeur |
| Sélection de dossier / de fichier | `p-button` (outlined) + plugin `dialog` de Tauri | Le chemin retenu s'affiche à côté en `text-muted-color`, tronqué par la gauche pour garder le nom du dossier visible |
| Playlist détectée | Logo VLC (SVG) ou `pi-file` | Le logo signale un dump VLC reconnu. Un M3U8 tombe sur l'icône générique, le logiciel qui l'a exporté étant inconnu |
| Sélecteur de playlist (dump VLC) | `p-select` | Option = nom de la playlist + nombre de morceaux. Masqué pour un M3U8, qui n'en contient qu'une |
| Mode copie / déplacement | `p-selectbutton` | Deux options, copie par défaut |
| Liste des morceaux d'un run | `p-table` en `[size]="'small'"`, `[scrollable]`, `[virtualScroll]`, `[virtualScrollItemSize]` | Six colonnes (cf. § Layout), 100 lignes |
| Vignette de pochette | `<img>` via `convertFileSrc()` de Tauri + `p-skeleton` | 32px, rayon `sm`. Lue depuis le cache disque, jamais transportée en base64 dans le flux NDJSON. Demande le protocole asset de Tauri, cf. [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives) |
| État d'un morceau | `p-tag` | Familles du § Couleurs Sémantiques |
| Source retenue | SVG Simple Icons + libellé | Beatport / Bandcamp / SoundCloud |
| Détail avant / après | `[expandedRowKeys]` + `<ng-template #expandedrow>` | Comparaison champ par champ, pochette en grand, sur le morceau déplié |
| Texte tronqué d'une colonne fluide | `pTooltip` | Avant et Après sont fluides et tronquent en permanence, et ce sont exactement les deux chaînes que l'utilisateur compare. Jamais seul porteur d'une information, cf. § Tokens de Tooltip |
| Progression d'une phase | `p-progressbar` + compteur | Alimentée par l'événement `progress` du sidecar |
| Modale d'arbitrage | `p-dialog` modal, largeur et hauteur figées | S'ouvre dès qu'un morceau entre en zone grise et qu'aucune autre n'est ouverte. Dimensions fixes, cf. § Layout |
| Candidats en zone grise | `p-listbox` à hauteur fixe, scroll interne | Sélection simple, scores en `text-xs` par ligne. La liste Bandcamp remplace celle de Beatport dans la même fenêtre après un refus, sans que rien ne se déplace |
| Navigation entre arbitrages | `p-button` icon (`pi-chevron-left` / `pi-chevron-right`) + `p-badge` | Compteur du type 1/3, la file se réduisant au fil des décisions |
| Refus explicite | `p-button` `severity="secondary"` outlined | Action distincte de la fermeture de la modale, qui ne décide rien |
| Rattrapage par URL | `p-inputgroup` + `input pInputText` + `p-button` | Une ligne par morceau non résolu, validation de l'hôte avant envoi |
| Confirmation globale de l'écriture | `p-confirmdialog`, bouton `danger` | Le point de non-retour du run : seule modale dont le bouton principal est destructif |
| Récapitulatif filtrable | `p-table` + `p-selectbutton` + `p-iconfield` | Filtres tout / validés / arbitrés / échecs, plus une recherche texte. « Échecs » lit `state`, les deux autres `resolution` (cf. § Conventions de Code) |
| Relance de l'écriture en échec | `p-button` `severity="danger"` outlined + `p-confirmdialog` | Dans le récapitulatif, actif seulement s'il reste des `write_error`. Rejoue l'écriture sur ces seuls fichiers, sans refaire ni la phase réseau ni les arbitrages. Destructif comme la confirmation globale, donc même traitement |
| Reprise d'un run interrompu | `p-dialog` au démarrage | Deux actions : reprendre, repartir de zéro |
| Sidecar absent ou en quarantaine | `p-message` `severity="error"` plein écran | Écran bloquant, pas une modale : rien d'autre n'est utilisable tant que le binaire manque |
| Clé API | `p-password` (`[feedback]="false"`, `[toggleMask]="true"`) | Jamais préremplie, jamais relue depuis le keyring vers la webview |
| URL de l'API | `input pInputText` | Champ ordinaire, pas un secret : l'URL est publique et déjà présente en clair dans le binaire. Persistée dans le `store`, contrairement à la clé |
| Seuils de matching | `p-slider` lié à un `p-inputnumber` | Plancher et seuil haut, valeurs de départ 70 et 90 |
| Langue | `p-select` | FR / EN, force la locale détectée au premier lancement |
| Bascules des Settings | `p-toggleswitch` | Signal sonore, copie par défaut, mode agent IA (Post-MVP) |
| Actions d'administration | `p-button` `severity="secondary"` outlined | Vider le cache, ouvrir le dossier de logs |
| Rollback | `p-button` `severity="danger"` outlined + `p-confirmdialog` | Par run ou par morceau |
| Notifications non bloquantes | `p-toast` | Fin de phase, cache vidé, clé enregistrée |
| Erreurs contextuelles | `p-message` inline | Dans l'écran concerné, jamais en toast : une erreur qui disparaît toute seule est une erreur perdue |
| Chargement | `p-skeleton` | Lignes de table en attente du premier événement |
| Envoi du rapport | `p-button` `severity="secondary"` | Geste explicite, seul endroit d'où des titres quittent la machine |

> `pInputText` et `pTooltip` sont des **directives** posées sur un élément existant, pas des composants `<p-inputtext>` ou `<p-tooltip>`.

### Composants Custom

Quatre wrappers, écrits une fois pour que ce qu'ils encapsulent ne soit pas recopié écran par écran.

| Composant | Base | Rôle |
|-----------|------|------|
| `IconComponent` | `@primeicons/angular` | Nom d'icône et token de taille en props. Les icônes étant rendues en SVG inline, la taille se pose en `width` / `height` et non en `font-size` : sans ce wrapper, les trois tailles 16 / 20 / 24 se recopient à la main partout |
| `SourceLogoComponent` | SVG Simple Icons | Les quatre logos en `currentColor`, même jeu de trois tailles |
| `StateTagComponent` | `p-tag` | Porte le mapping `state` / `resolution` / `failure_reason` → famille, icône, libellé. Entièrement spécifié au § Couleurs Sémantiques : l'encoder une fois évite qu'il soit re-dérivé, de travers, écran par écran |
| `EmptyStateComponent` | — | Le bloc vide décrit au § États des Composants. PrimeNG n'a pas d'équivalent, il s'écrit from scratch |

## États des Composants

> Les composants PrimeNG portent déjà leurs états (hover, focus, disabled, invalid) via le preset. Ce tableau ne couvre que les éléments **custom** écrits from scratch.

| État | Style / Comportement | Notes |
|------|---------------------|-------|
| Survol d'une zone cliquable custom | `bg-emphasis`, transition `background-color 150ms ease-out` | Jamais de déplacement ni de scale : les lignes de la liste ne bougent pas sous le curseur |
| Sélection | `bg-highlight` | Cohérent avec la sélection des composants PrimeNG |
| Focus clavier | Anneau `--p-focus-ring-*`, identique aux composants PrimeNG | La modale d'arbitrage se traite entièrement au clavier, `outline: none` est interdit |
| Désactivé | `--p-disabled-opacity` (0.6) + `cursor: not-allowed` | Un bouton désactivé garde son libellé, il n'est jamais masqué |
| Chargement | `p-skeleton` aux dimensions de la ligne finale | Évite le saut de layout à l'arrivée des événements |
| Vide | Icône 24px en `text-muted-color`, titre en `text-base`, une phrase en `text-sm text-muted-color`, et l'action qui débloque quand elle existe | Quatre cas à couvrir : dossier sans fichier audio, playlist dont aucun morceau n'est retrouvé dans la source, aucun run passé, cache déjà vide. Pour la liste du run, le template `#emptymessage` de `p-table` porte ce bloc |

### Tailles de Badge

Deux tailles, `small` (20px) et `normal` (24px). Pas de `large` : le badge n'a qu'un usage réel dans le produit, le compteur de la file d'arbitrage, et rien n'y demande plus de 24px.

La taille s'apparie à celle des éléments de la même rangée, pas à une préférence : `small` à côté de boutons `small`, `normal` à côté de boutons `normal`. Dans le footer d'arbitrage, le compteur est encadré de boutons `small`, il est donc en `small`. Un badge plus court que ce qui l'entoure sur une même ligne est un défaut, pas une variante.

**La puce portée par un `p-button` est neutre par défaut**, avec les mêmes paires de couleurs que `p-badge`. Un compteur de file n'est pas une action, et l'accent reste réservé aux actions et à la sélection (cf. § Palette de Couleurs). Un compteur porté par un bouton doit par ailleurs être indiscernable du même compteur posé à côté, sinon `1/3` et `2/3` ne se ressemblent pas.

---

# 🖼️ Icônes

**Librairie UI** : `@primeicons/angular` 8, tiré par PrimeNG v22. Des composants standalone rendant du **SVG inline**, et non plus la police et ses classes `pi pi-*` des versions antérieures. Aucun asset de police à copier, donc rien à embarquer pour l'affichage hors ligne

**Logos** : quatre SVG [Simple Icons](https://simpleicons.org) copiés dans `src/assets/icons/`, en `fill="currentColor"`

| Logo | Où |
|------|-----|
| Beatport, Bandcamp, SoundCloud | Colonne Source de la liste du run, entête de la modale d'arbitrage, récapitulatif |
| VLC media player | Onglet Playlist, quand le fichier sélectionné est un dump VLC reconnu |

**Tailles** : `16px` inline (tables, tags), `20px` UI standard (boutons, entêtes), `24px` standalone (écran bloquant, états vides), posées en `width` / `height` sur le SVG

**Règles** :

- PrimeIcons couvre toute l'interface. Ses 21 icônes de marques ne contiennent **aucune des quatre** dont le projet a besoin, d'où les SVG en assets
- Quatre fichiers copiés plutôt que le paquet `simple-icons` complet : on en extrairait quatre chemins sur plus de trois mille
- `currentColor` obligatoire sur les SVG : la couleur vient du contexte, elle n'est jamais écrite dans le fichier
- Aucune action destructive n'est signalée par une icône seule : rollback et confirmation d'écriture portent toujours un libellé traduit

---

# ✨ Animations & Motion

## Librairie

**Aucune dépendance d'animation.** `@angular/animations` est déprécié depuis Angular 20.2 au profit de `animate.enter` / `animate.leave` natifs, et PrimeNG a migré sur des animations CSS en v21 : `provideAnimationsAsync` est supprimable de `app.config.ts`, et les props `showTransitionOptions` / `hideTransitionOptions` ne sont plus fonctionnelles.

Le peu qui reste à animer passe par les **utilitaires du plugin** `tailwindcss-primeui` : `animate-fadein`, `animate-duration-{75..3000}`, `animate-delay-*`, `animate-ease-out`, `animate-fill-*`, combinables avec les variants Tailwind.

## Principes Directeurs

- **Intensité** : `subtile`. L'application est un outil de production, pas une vitrine
- **Durée standard** : `animate-duration-200`, jamais au-delà
- **Easing** : `animate-ease-out`
- **Intention** : rendre lisible un changement d'état. Une animation qui ne fait que décorer est du délai ajouté
- **Mouvement réduit** : les animations sont coupées sous `prefers-reduced-motion: reduce`. Le mouvement est un confort ici, il ne porte aucune information : rien ne casse quand il s'éteint

Le plugin pose une propriété `animation` sur `.animate-fadein`, pas une variable interposée : la coupure surcharge donc la propriété elle-même. Une variable custom déclarée sur `:root` ne serait branchée sur rien et ne désactiverait aucune animation.

```css
@media (prefers-reduced-motion: reduce) {
  .animate-fadein,
  [class*="animate-"] {
    animation: none !important;
  }
}
```

C'est le seul `!important` toléré du projet (cf. § Anti-Patterns) : il ne corrige pas un problème de cascade, il neutralise une préférence système par-dessus des utilitaires générés, et la règle ne peut pas perdre.

## Composants Animés

> Les transitions des composants PrimeNG (Dialog, Toast, Tabs, ProgressBar, Skeleton) sont intégrées et ne sont pas reprises ici. Ce tableau ne couvre que les éléments custom.

| Composant | Type d'animation | Mécanisme | Trigger |
|-----------|-----------------|-----------|---------|
| Modale d'arbitrage | **Aucune** | — | La décision est sur le chemin critique du run, une transition d'entrée ne fait que la retarder |
| Bandeau d'erreur, invite de reprise | `animate-fadein animate-duration-200` | Plugin + `animate.enter` | Montage |
| Zone cliquable custom | Transition de fond 150ms | CSS | Hover |
| Ligne de table changeant d'état | Transition de couleur du tag 150ms | CSS | Événement `track_resolved` |
| Vignette de pochette | Fondu à l'arrivée de l'image | `animate-fadein animate-duration-200` | Chargement terminé |
| Contenu d'un onglet | Fondu, opacité seule, jamais de déplacement | `animate-fadein animate-duration-200` | Changement d'onglet |

La barre `p-tabs` reste **hors du conteneur animé** : elle ne clignote pas, seul ce qu'elle commande se substitue.

---

# 📐 Layout & Espacement

## Structure de Page

**Shell** : barre `p-tabs` en haut, zone de contenu occupant le reste de la hauteur. La page elle-même ne défile jamais, le scroll vit dans la table.

**Fenêtre** : 1280 × 800 à l'ouverture, plancher à 1024 × 700, agrandissement libre sans plafond. Le plancher est dicté par le jeu de colonnes ci-dessous. Réglages dans `tauri.conf.json`, cf. [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives).

**Deux régimes de largeur** :

| Type d'écran | Largeur | Concernés |
|--------------|---------|-----------|
| Données | Pleine largeur, `p-4` | Liste du run, récapitulatif |
| Formulaire | `max-w-3xl mx-auto` (768px) | Settings, sélection des dossiers de l'onglet Playlist |

La modale d'arbitrage ne relève ni de l'un ni de l'autre, ses dimensions étant figées quelle que soit la fenêtre (voir plus bas).

Les colonnes **Avant** et **Après** portent chacune un artiste plus un titre, souvent cinquante caractères. Ce sont exactement les deux colonnes que l'utilisateur compare, et les brider dans un container centré les envoie en ellipse sur les écrans larges. Un formulaire de réglages étiré sur 2560px n'a aucun intérêt inverse, d'où les deux régimes.

**Colonnes de la liste d'un run** :

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Pochette | 32px fixe | Vignette, `p-skeleton` tant que le morceau n'est pas résolu |
| Avant | **fluide** | Artiste et titre lus dans le fichier, avec le **nom du fichier en sous-texte** `text-xs text-muted-color`. Quand les tags sont vides, le nom de fichier nettoyé passe en ligne principale |
| Après | **fluide** | Ce que la source retenue va écrire |
| Source | 116px | Logo 16px + libellé, Beatport / Bandcamp / SoundCloud. Mesurée sur « SoundCloud » plus son logo, son gap et le padding de cellule |
| Score | 92px | Moyenne des deux scores en ligne principale, `A 96 · T 92` en `text-xs` dessous |
| État | 124px | `p-tag`, cf. § Couleurs Sémantiques. Dimensionnée sur « Échec d'écriture » plus son glyphe, le plus long des cinq libellés, et à revérifier en anglais |

Les trois colonnes fixes tiennent sur leur contenu le plus large et pas un pixel de plus : ce qui leur est repris va aux deux colonnes qu'on compare vraiment. Une colonne fixe surdimensionnée est de la largeur volée à la comparaison.

**Source dit d'où vient la donnée écrite, État dit par quel chemin on y est arrivé.** Un morceau résolu en collant une URL SoundCloud affiche donc SoundCloud en source et « URL » en état : c'est la seule voie par laquelle SoundCloud entre dans le produit, jamais la recherche automatique. C'est la même séparation que celle posée entre `state` et `resolution` dans le contrat NDJSON, portée cette fois côté affichage.

Seules **Avant** et **Après** absorbent le redimensionnement, les autres restent à largeur fixe. Le détail champ par champ (label, BPM, key, année, genre) et la pochette en grand vivent dans la ligne dépliée.

Deux choix qui portent le tableau. Le **nom de fichier est un sous-texte d'Avant**, pas une colonne : quand les tags manquent, c'est déjà lui qui sert de requête, et deux colonnes pour la même chaîne coûteraient de la largeur aux deux colonnes qu'on compare vraiment. Et le **score s'affiche en trois nombres** : le scoring plancher à 70 s'applique séparément à l'artiste et au titre, le seuil haut à 90 sur leur moyenne. Un seul chiffre cacherait lequel des deux fait tomber le morceau en zone grise, qui est précisément ce que l'utilisateur a besoin de savoir pour arbitrer.

**Modale d'arbitrage** : largeur et hauteur **figées**, indépendantes du nombre de candidats. La liste occupe une zone de hauteur fixe avec son propre scroll, le compteur et les boutons sont ancrés en bas. Le remplacement de la liste Beatport par la liste Bandcamp après un refus ne déplace donc rien. C'est le seul écran où l'utilisateur enchaîne les clics à cadence rapide, sur une file qui peut compter des dizaines d'arbitrages : un bouton qui se décale entre deux clics fait valider le mauvais candidat, et cette erreur ne se voit qu'après l'écriture. **Largeur 720px, hauteur 560px, zone de liste 268px** : sans valeurs, la règle n'est pas vérifiable et se perd à la première reprise du composant.

**Densité** : `[size]="'small'"` sur toutes les tables. Sur un run de 100 morceaux, la densité compacte décide du nombre de lignes visibles sans scroller, et c'est la convention des outils DJ.

**Échelle d'espacement** : échelle Tailwind par 4px. `gap-2` à l'intérieur d'un groupe, `gap-4` entre groupes, `gap-6` ou `p-6` entre sections.

## Responsive

> Approche : `desktop-only`. Application de bureau Windows, aucune cible mobile ni tactile.

Le jeu de six colonnes tient à 1024px, le plancher de la fenêtre. Aucune colonne n'est masquée à aucune largeur : le redimensionnement est absorbé par les deux colonnes fluides, ce qui évite d'avoir à retenir quelle information disparaît à quelle taille. Les seuls variants de breakpoint utiles sont ceux du confort de lecture sur grand écran (`xl:` sur les paddings de section).

---

# 🔧 Conventions de Code

## Composition de Styles

**CSS pur, aucun SCSS**, pour la raison donnée au § Stack UI. Le fichier global est `src/styles.css`, les styles de composant sont en `.css` par cohérence, et le nesting natif est supporté par la webview Windows.

**Utilitaire** : classes Tailwind dans le template. Conditionnel par `[class.x]` ou `[ngClass]`. Le CSS de composant est réservé à ce que Tailwind ne couvre pas : keyframes, et sélecteurs visant le DOM interne d'un composant PrimeNG.

**Cascade** : réglée par `cssLayer: { name: 'primeng', order: 'theme, base, primeng' }` dans `providePrimeNG()`. La couche `primeng` se place après `theme` et `base` et avant les utilitaires, ce qui laisse les classes Tailwind gagner sur les styles de composant. Rien n'est à déclarer dans le CSS.

**Ordre des classes** : réordonné automatiquement par `prettier-plugin-tailwindcss` au format, selon l'ordre officiel du plugin. Aucune convention manuelle à retenir, rien à relire en review sur ce point, et aucun diff parasite venant de deux fichiers rangés différemment.

```html
<div class="flex items-center justify-between gap-4 rounded-border border-surface bg-surface-900 px-4 py-2 text-sm font-medium text-color xl:px-6">
```

## Règles

- ✅ **Composant PrimeNG d'abord** : aucun composant custom tant que la bibliothèque en fournit un équivalent. Le catalogue large est la raison pour laquelle PrimeNG a été retenu (cf. [ADR-003](adrs/003-primeng-community-license.md))
- ✅ **Trois niveaux de personnalisation, dans cet ordre** : `definePreset()` pour ce qui vaut partout (le thème, seule voie disponible sans le Theme Designer, cf. [ADR-003](adrs/003-primeng-community-license.md)), `[dt]` pour surcharger les design tokens d'une seule instance, `[pt]` pour attacher classes et attributs à ses éléments internes. La doc PrimeNG recommande explicitement cette voie contre `::ng-deep` (« This approach is recommended over the `::ng-deep` as it offers a cleaner API while avoiding the hassle of CSS rule overrides »)
- ✅ **Tokens uniquement** : `bg-primary`, `text-muted-color`, `border-surface`. Aucune valeur de couleur écrite dans un composant
- ✅ **Aucune largeur fixe sur du texte traduit** : les libellés existent en FR et en EN (cf. [ADR-004](adrs/004-i18n-ngx-translate.md)), et le français est généralement le plus long des deux. Les boutons se dimensionnent sur leur contenu
- ✅ **Aucun libellé en dur dans un template** : tout passe par ngx-translate, y compris les messages d'erreur, que le sidecar émet en `code` + `params` et que l'interface traduit
- ✅ **Densité compacte sur les tables** : `[size]="'small'"` systématique. La classe `p-datatable-sm` est générée par le composant, elle ne se pose jamais à la main
- ✅ **Navigation clavier complète sur la modale d'arbitrage** : flèches entre arbitrages, entrée pour valider, focus visible en permanence
- ✅ **Les filtres du récapitulatif se lisent dans cet ordre : `state` pour l'échec, `resolution` pour la voie.** « Échecs » vaut `state ∈ {unresolved, write_error}`, « validés » et « arbitrés » se lisent sur `resolution` **et** excluent les échecs, sans quoi un `write_error` apparaîtrait dans les deux à la fois. « Arbitrés » vaut `resolution ∈ {arbitration, url}`, jamais `arbitration` seul. Les trois pièges que ça évite sont détaillés dans [ARCHITECTURE.md § API](ARCHITECTURE.md#api)

## Anti-Patterns

- ❌ **`::ng-deep`** : percer l'encapsulation d'un composant PrimeNG produit du style qui casse à la première mise à jour de la bibliothèque, et qui n'apparaît dans aucune recherche quand on cherche d'où vient une couleur. Passer par `[dt]` ou `[pt]`
- ❌ **`!important`** : si un style ne s'applique pas, c'est l'ordre des couches qui est en cause. Le corriger dans `cssLayer`, pas par la force. Seule exception, la coupure des animations sous `prefers-reduced-motion` (cf. § Animations & Motion)
- ❌ **Couleurs en dur** : ni hex, ni `bg-emerald-500`. Un changement de preset doit rester un changement de preset
- ❌ **Styles inline `[style]`** : réservés aux valeurs calculées à l'exécution (largeur d'une barre, position d'un élément virtualisé)
- ❌ **Logique métier dans un composant** : les scores, les seuils et le classement des candidats viennent du sidecar. L'interface affiche ce qu'elle reçoit, à l'exception des deux familles qu'elle dérive de ce qu'elle n'a pas reçu (cf. [ARCHITECTURE.md § Frontend](ARCHITECTURE.md#-frontend))
- ❌ **Animation sur le chemin de décision** : rien ne s'anime entre l'arrivée d'un `arbitration_required` et l'affichage des candidats
- ❌ **Pochettes en base64 dans le flux NDJSON** : les images passent par `convertFileSrc()` depuis le cache disque, le protocole reste textuel et lisible

---

# 🔗 Ressources

## Documentation Officielle

- [PrimeNG — Theming](https://primeng.dev/theming) : design tokens, `definePreset()`, `darkModeSelector`, tokens scopés `[dt]`
- [PrimeNG — Configuration](https://primeng.dev/configuration) : `providePrimeNG()`, licence, ripple (désactivé par défaut)
- [PrimeNG — Tailwind CSS](https://primeng.dev/tailwind) : installation, liste des classes issues des tokens, utilitaires d'animation, dark mode
- [PrimeNG — PassThrough](https://primeng.dev/passthrough) : API `[pt]`, locale et globale
- [PrimeNG — Table](https://primeng.dev/table) : `size`, scroll virtuel, `expandedRowKeys`
- [PrimeNG — Migration v21](https://primeng.dev/migration/v21) : passage aux animations CSS natives
- [Tailwind CSS — Dark mode](https://tailwindcss.com/docs/dark-mode) : `@custom-variant`
- [PrimeIcons](https://primeicons.dev) : 357 icônes, catégories, recherche
- [Angular — Enter and Leave animations](https://angular.dev/guide/animations) : `animate.enter` / `animate.leave`
- [Angular — Migrating to Native CSS Animations](https://angular.dev/guide/animations/migration) : sortie de `@angular/animations`
- [Simple Icons](https://simpleicons.org) : logos Beatport, Bandcamp, SoundCloud, VLC media player
- [Fontsource — Inter](https://fontsource.org/fonts/inter) : paquet `@fontsource-variable/inter`, axes et poids

## Ressources Complémentaires

- [Preset Aura — source](https://github.com/primefaces/primeuix/blob/main/packages/themes/src/presets/aura/base/index.ts) : valeurs exactes des primitives et des tokens sémantiques
- [primeng#17946](https://github.com/primefaces/primeng/issues/17946) et [tailwindcss-primeui#27](https://github.com/primefaces/tailwindcss-primeui/issues/27) : l'incompatibilité SCSS de Tailwind v4
- [ARCHITECTURE.md](ARCHITECTURE.md) : stack, écrans, contrat NDJSON et modes de panne à couvrir visuellement
- [ADR-003](adrs/003-primeng-community-license.md) : PrimeNG sous Community License, preset Aura, `definePreset()` comme seule voie de personnalisation **du thème**, le Theme Designer n'étant pas inclus
- [ADR-004](adrs/004-i18n-ngx-translate.md) : bascule FR / EN à l'exécution, contrainte d'élasticité des libellés
