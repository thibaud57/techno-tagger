---
title: "DESIGN — techno-tagger"
description: "Design system : typographie, couleurs, librairies UI, mapping composants et conventions de style de l'interface Angular + PrimeNG."
date: "2026-08-29"
keywords: ["design", "ui", "design-system", "typography", "colors", "animations", "layout", "dark-mode", "icons", "desktop", "components", "spacing", "primeng", "tailwind"]
scope: ["docs", "frontend"]
technologies: ["Angular", "PrimeNG", "Tailwind CSS", "PrimeIcons", "Simple Icons", "Inter", "Tauri"]
---

> Versions de référence : PrimeNG **22.1.0**, `@primeuix/themes` **3.0.0**, `@primeicons/angular` **8.0.0**, Tailwind CSS **4.3.3**, `@fontsource-variable/inter` **5.3.0**. Détail et compatibilité croisée dans [VERSIONS.md](VERSIONS.md).

# 🎨 Identité Visuelle

## Typographie

### Police Principale

**Famille** : `Inter Variable`

**Source** : `@fontsource-variable/inter`, embarquée dans le bundle. Import `@fontsource-variable/inter/wght.css` (poids 100 à 900 sur un seul fichier)

**Usage** : toute l'interface, sans exception

**Tokens** : `--font-sans`, déclaré dans le bloc `@theme` du CSS global (valeur au § Installation), exposé en classe `font-sans`

Aucun appel à un CDN de polices : l'application est un binaire local qui doit s'afficher identiquement hors ligne, et une webview qui attend un `fonts.googleapis.com` injoignable rend en police de repli le temps du timeout.

Le preset Aura déclare `fontFamily: 'inherit'` (vérifié dans sa source, avec `fontSize` et `fontWeight`) : il ne fixe donc aucune police concrète, la valeur remonte jusqu'à `html`, où le preflight l'a posée. La typographie reste entièrement à la charge du projet, et rien n'est à défaire côté preset.

### Scale Typographique

Base **16px**, imposée par l'import `@primeuix/themes/aura` en version non-`compat` (cf. [ADR-003](adrs/003-primeng-community-license.md)).

> Une seule taille signifie aucun palier responsive. Le cas échéant, le palier est indiqué à la suite. L'application étant `desktop-only`, aucun niveau n'en porte.

| Usage | Taille | Poids | Classe |
|-------|--------|-------|--------|
| H1 (titre d'écran) | 1.5rem (24px) | 600 | `text-2xl font-semibold` |
| H2 (section) | 1.25rem (20px) | 600 | `text-xl font-semibold` |
| H3 (entête de modale, sous-section) | 1.125rem (18px) | 600 | `text-lg font-semibold` |
| Body | 1rem (16px) | 400 | `text-base` |
| Body dense (tables, listes de candidats) | 0.875rem (14px) | 400 | `text-sm` |
| Label (libellé de champ) | 0.875rem (14px) | 400 | `label pLabel`, taille et poids posés par le preset |
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

| Token | Valeur | Usage |
|-------|--------|-------|
| `--p-tooltip-background` | `{surface.700}` | Fond, deux crans au-dessus du panneau |
| `--p-tooltip-color` | `{surface.0}` | Texte |
| `--p-tooltip-padding` | `0.375rem 0.625rem` | Espacement interne |
| `--p-tooltip-border-radius` | `--p-border-radius-md` (6px) | Coins, alignés sur le rayon de contenu |
| `--p-tooltip-max-width` | `12.5rem` | Défaut : gloses et aides courtes |
| `--tt-tooltip-max-width-wide` | `26rem` | Texte tronqué (chemins, colonnes fluides, lignes de candidats) et détail d'une ligne du rapport |
| `--p-tooltip-gutter` | `0.25rem` | Écart à l'élément décrit |
| `--p-tooltip-shadow` | = `--p-overlay-popover-shadow` | Élévation, commune aux popovers |

Les 12,5rem par défaut conviennent à une glose, mais coupent exactement ce qu'un texte tronqué ou un détail de ligne est là pour montrer.

Un tooltip n'est jamais le seul porteur d'une information : il révèle ce qui est déjà à l'écran mais coupé. Ce qui n'existe qu'en tooltip est invisible au clavier, au tactile et à l'impression, il ne remplace donc ni un libellé, ni une aide de formulaire, ni un message d'erreur : ceux-là sont des `p-message` inline. Deux exceptions : la raison pour laquelle une action est désactivée, posée sur le bouton lui-même, et le détail d'une ligne du rapport d'extraction.

Un tooltip se devine. L'ellipse annonce celui d'un texte coupé. Ailleurs, une icône `info-circle` en `text-muted-color` le signale, hors de tout tag pour ne pas se lire comme la famille Décision attendue.

`pointer-events: none`, pour qu'il ne se mette jamais entre le curseur et ce qu'il décrit. Son délai et son fondu vivent au § Composants Animés.

### Couleurs Sémantiques

Le design system ne connaît pas la liste des états d'un morceau, seulement **quatre familles** auxquelles chacun se rattache. L'énumération exacte vit dans le contrat NDJSON, en trois champs `state` / `resolution` / `failure_reason` (cf. [ARCHITECTURE.md § API](ARCHITECTURE.md#api)), et peut donc s'allonger sans qu'aucune couleur soit à inventer.

| Famille | Sévérité | Icône type | Source | Ce qu'elle couvre |
|---------|----------|------------|--------|-------------------|
| Neutre | `secondary` | `clock` | dérivée | Rien n'est encore arrivé sur ce morceau, il attend son tour dans la file |
| Décision attendue | `info` | `info-circle` | dérivée | `arbitration_required` reçu sans `track_resolved` derrière : le morceau attend un geste humain |
| Résolu | `success` | `check` | `state` | `resolved` et `written` |
| Échec | `danger` | `times` | `state` | `unresolved` et `write_error` |

Les sévérités sont déjà câblées dans `p-tag`, `p-badge`, `p-message` et `p-button`, et suivent le preset sans maintenance.

**Deux familles sur quatre sont dérivées par l'interface** et ne correspondent à aucune valeur de `state` : rien ne circule sur le flux tant qu'un morceau n'est pas tranché, l'interface affiche donc « en attente » ce qu'elle n'a pas reçu et « à arbitrer » ce pour quoi elle a reçu une demande sans réponse.

Le bleu plutôt que l'orange sur la décision attendue : un arbitrage qui attend n'est pas une anomalie, c'est une étape normale qui demande quelque chose. Le choix est déjà posé dans [BRAINSTORM.md](BRAINSTORM.md) (« bleu en attente d'arbitrage »). Conséquence, **`warn` n'est porté par aucun état de morceau** : il reste disponible pour les avertissements qui ne concernent pas une ligne, comme une clé API proche de l'expiration.

**Le libellé porte la voie, jamais la couleur.** `resolution` distingue trois issues positives qui restent toutes vertes :

| `state` | `resolution` | Tag affiché |
|---------|--------------|-------------|
| `resolved` ou `written` | `auto` | vert, `check`, « Auto » |
| `resolved` ou `written` | `arbitration` | vert, `check`, « Arbitré » |
| `resolved` ou `written` | `url` | vert, `check`, « URL » |
| `unresolved` | `none` | rouge, `times`, « Non résolu » |
| `write_error` | — | rouge, `exclamation-triangle`, « Échec d'écriture » |

Un morceau validé automatiquement à 94 est l'endroit le plus probable d'un mauvais match, puisque personne ne l'a regardé. Distinguer « Auto » d'« Arbitré » dit à l'utilisateur où porter son attention, et un glyphe ne se décode pas assez vite dans un tableau dense pour porter cette information.

Les deux rouges partagent la couleur sans partager l'icône, leurs corrections étant opposées : l'un se rattrape par une URL, l'autre en relançant l'écriture (cf. [ARCHITECTURE.md § Robustesse](ARCHITECTURE.md#-robustesse--modes-de-panne)).

**Le libellé d'échec d'écriture reste générique, le motif vit dans la ligne dépliée.** Le verrou n'est qu'un `failure_reason` parmi plusieurs, et la colonne État est dimensionnée sur le plus long des libellés livrés : nommer chaque cause obligerait à l'élargir ou à tronquer. Un motif est du diagnostic, pas de la colonne de balayage.

> **Deux pièges d'orthographe sur les sévérités.** C'est `warn`, jamais `warning`, sur `p-tag`, `p-badge`, `p-message` et `p-button` (seul `badgeSeverity` de `p-button` attend `warning`). Et `p-message` n'accepte pas `danger` : sa sévérité d'erreur est `error`.

### Règles

- ✅ Toujours référencer une couleur par token ou par classe du plugin : jamais de hex, jamais de couleur Tailwind brute (`bg-emerald-500`)
- ✅ **La couleur ne porte jamais seule l'information** : chaque état est toujours accompagné d'une icône et d'un libellé traduit
- ✅ L'accent `primary` reste réservé aux actions et à la sélection. Un écran où tout est vert ne signale plus rien
- ✅ Le `danger` **d'une action** est réservé aux trois qui touchent aux fichiers musicaux : la confirmation globale de l'écriture, la relance de l'écriture en échec, et le rollback. La même sévérité sur un `p-tag` ou un `p-message` ne décide de rien, elle rapporte la famille Échec ci-dessus

## Formes

### Border Radius

Primitives du preset Aura. Cette table fait foi : là où Aura donne un autre cran à un composant, le preset du projet l'y ramène (§ Installation).

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
| Simple Icons (SVG en assets) | Logos | Beatport, Bandcamp, SoundCloud, VLC media player |

### Installation

```css
/* src/styles.css */
@import "@fontsource-variable/inter/wght.css";

@import "tailwindcss";
@plugin "tailwindcss-primeui";
@custom-variant dark (&:where(.app-dark, .app-dark *));

@theme {
  --font-sans: "Inter Variable", system-ui, sans-serif;
}
```

L'ordre des couches CSS se règle côté TypeScript, pas dans le CSS :

```ts
providePrimeNG({
  theme: {
    preset: TECHNO_TAGGER_PRESET,
    options: {
      darkModeSelector: '.app-dark',
      cssLayer: { name: 'primeng', order: 'theme, base, primeng' }
    }
  }
})
```

Le preset du projet dérive d'Aura et n'y change que ce que ce document décide ailleurs : les rayons du § Formes, qu'Aura dérive autrement pour la carte, le tag et le badge, l'absence d'ombre sur la carte, l'élévation ne vivant que sur les overlays, et le libellé de champ du § Scale Typographique. La liste exacte vit dans le preset, pas ici. Un nouvel écart s'y range selon sa portée, `primitive` pour une rampe ou un rayon, `semantic` pour un rôle, `components` pour un composant.

> **Tailwind v4 ne compile ni SCSS ni LESS.** Le fichier global doit être un `.css`, sinon l'import échoue sur `Can't resolve './theme/colors.css'`. C'est la raison pour laquelle tout le styling du projet est en CSS pur (cf. § Conventions de Code).

## Mapping Composants

> Une section par famille d'usage. Les composants **post-MVP** vivent dans la dernière section et rejoignent leur famille au moment de leur installation ; la section disparaît quand elle se vide.

Une ligne par catégorie d'usage, par famille. L'interface s'écrit à partir de l'étape 5 de l'ordre de développement : ce mapping la précède et la contraint. Les features référencées sont celles de [ARCHITECTURE.md § Flux Fonctionnels](ARCHITECTURE.md#flux-fonctionnels-use-cases-critiques).

> Les lignes qui nomment encore `p-button` se lisent avec la directive `pButton`, le composant étant déprécié depuis PrimeNG 22 (cf. [composants.md](../.claude/rules/primeng/composants.md)).

### Navigation

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Navigation principale | `p-tabs` synchronisé à la main avec le Router | PrimeNG | PrimeNG v22 ne fournit aucun mode router, et `p-tabMenu` a été supprimé. L'onglet actif se dérive de l'URL, la navigation se déclenche au changement de valeur |

### Playlist et fichiers

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Sélection de dossier / de fichier | `button pButton` primaire outlined en `size="small"` + plugin `dialog` de Tauri | PrimeNG + Tauri | Le chemin retenu s'affiche au bout de la ligne, aligné à droite, en `text-muted-color`, tronqué par la gauche pour garder le nom du dossier visible |
| Playlist détectée | Logo VLC (SVG) ou `file` | Simple Icons / PrimeIcons | Le logo signale un dump VLC reconnu. Un M3U8 tombe sur l'icône générique, le logiciel qui l'a exporté étant inconnu |
| Sélecteur de playlist (dump VLC) | `p-select` en `size="small"` | PrimeNG | Option = nom de la playlist + nombre de morceaux. Masqué pour un M3U8, qui n'en contient qu'une |
| Mode copie / déplacement | `p-selectbutton` en `size="small"` | PrimeNG | Deux options, copie par défaut |
| Lancement de l'extraction | `button pButton` primaire en `size="small"` | PrimeNG | Seul sur sa ligne, du bord des libellés au bout des contrôles. Désactivé, son tooltip nomme les choix manquants |
| Résumé du run | Ligne de texte + `button pButton` secondary outlined en `size="small"` | PrimeNG | Remplace le formulaire dès le lancement (cf. § Layout). « Modifier » est figé pendant le run, puis rouvre le formulaire au-dessus du rapport |
| Passage au tagging | `button pButton` `severity="secondary"` outlined en `size="small"` + icône `arrow-right` | PrimeNG | Sous le rapport, une fois l'extraction terminée. Mémorise la destination, qui préremplit l'onglet suivant |
| Rapport d'extraction | `p-table` `[scrollable]`, `[virtualScroll]` | PrimeNG | Deux colonnes (cf. § Layout), une ligne par morceau plus une par doublon départagé. Pas de ligne dépliée : le détail tient dans le tooltip du badge. « Extraction terminée (N sur N) » en `text-sm text-muted-color` sous la table, à droite |

### Liste du run

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Lancement du run | `button pButton` primaire en `size="small"` | PrimeNG | Reste visible et désactivé pendant le run, jamais masqué (cf. § États des Composants). Son tooltip nomme ce qui bloque, du plus proche de l'utilisateur au plus lointain : run en cours, clé API, dossier, sidecar |
| Liste des morceaux d'un run | `p-table` `[scrollable]`, `[virtualScroll]` | PrimeNG | Six colonnes (cf. § Layout), 100 lignes |
| Vignette de pochette | `<img>` via `convertFileSrc()` de Tauri + `p-skeleton` | Tauri + PrimeNG | 32px, rayon `sm`. Lue depuis le cache disque, jamais transportée en base64 dans le flux NDJSON. Demande le protocole asset de Tauri, cf. [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives) |
| État d'un morceau | `p-tag` | PrimeNG | Familles du § Couleurs Sémantiques |
| Source retenue | SVG Simple Icons + libellé | Simple Icons | Beatport / Bandcamp / SoundCloud |
| Détail avant / après | `[expandedRowKeys]` + `<ng-template #expandedrow>` | PrimeNG | Comparaison champ par champ, pochette en grand, sur le morceau déplié |
| Texte tronqué d'une colonne fluide | `pTooltip` | PrimeNG | Avant et Après sont fluides et tronquent en permanence, et ce sont exactement les deux chaînes que l'utilisateur compare. Jamais seul porteur d'une information, cf. § Tokens de Tooltip |
| Progression d'une phase | `p-progressbar` + compteur | PrimeNG | Alimentée par l'événement `progress` du sidecar |
| Chargement | `p-skeleton` | PrimeNG | Lignes de table en attente du premier événement |

### Arbitrage

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Modale d'arbitrage | `p-dialog` modal, largeur et hauteur figées | PrimeNG | S'ouvre dès qu'un morceau entre en zone grise et qu'aucune autre n'est ouverte. Dimensions fixes, cf. § Layout |
| Candidats en zone grise | `p-listbox` à hauteur fixe, scroll interne | PrimeNG | Sélection simple, scores en `text-xs` par ligne. La liste Bandcamp remplace celle de Beatport dans la même fenêtre après un refus, sans que rien ne se déplace |
| Navigation entre arbitrages | `p-button` icon (`chevron-left` / `chevron-right`) + `p-badge` | PrimeNG | Compteur du type 1/3, la file se réduisant au fil des décisions |
| Refus explicite | `p-button` `severity="secondary"` outlined | PrimeNG | Action distincte de la fermeture de la modale, qui ne décide rien |
| Rattrapage par URL | `p-inputgroup` + `input pInputText` + `p-button` | PrimeNG | Une ligne par morceau non résolu, validation de l'hôte avant envoi |

### Écriture et récapitulatif

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Confirmation globale de l'écriture | `p-confirmdialog`, bouton `danger` | PrimeNG | Le point de non-retour du run : seule modale dont le bouton principal est destructif |
| Récapitulatif filtrable | `p-table` + `p-selectbutton` + `p-iconfield` | PrimeNG | Filtres tout / validés / arbitrés / échecs, plus une recherche texte. « Échecs » lit `state`, les deux autres `resolution` (cf. § Conventions de Code) |
| Relance de l'écriture en échec | `p-button` `severity="danger"` outlined + `p-confirmdialog` | PrimeNG | Dans le récapitulatif, actif seulement s'il reste des `write_error`. Rejoue l'écriture sur ces seuls fichiers, sans refaire ni la phase réseau ni les arbitrages. Destructif comme la confirmation globale, donc même traitement |
| Reprise d'un run interrompu | `p-dialog` au démarrage | PrimeNG | Deux actions : reprendre, repartir de zéro |
| Rollback | `p-button` `severity="danger"` outlined + `p-confirmdialog` | PrimeNG | Par run ou par morceau |
| Envoi du rapport | `p-button` `severity="secondary"` | PrimeNG | Geste explicite, seul endroit d'où des titres quittent la machine |

### Settings

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Clé API | `input pInputPassword` dans un `p-iconfield`, masqué par défaut, œil de bascule composé à la main | PrimeNG | Jamais préremplie, jamais relue depuis le keyring vers la webview, remasquée après l'envoi. `p-password` déprécié en PrimeNG 22, et `pInputPassword` n'expose que le model `mask` : la bascule est un bouton du template (décisions du 2026-09-21) |
| Seuils de matching | `p-slider` lié à un `p-inputnumber` | PrimeNG | Plancher et seuil haut, valeurs de départ 70 et 90 |
| Langue | `p-select` | PrimeNG | FR / EN, force la locale détectée au premier lancement |
| Bascules des Settings | `p-toggleswitch` | PrimeNG | Signal sonore, copie par défaut |
| Actions d'administration | `p-button` `severity="secondary"` outlined | PrimeNG | Vider le cache, ouvrir le dossier de logs |

### Feedback

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Sidecar absent ou en quarantaine | `p-card` centrée, action `secondary` outlined | PrimeNG | Écran bloquant, pas une modale : la barre d'onglets n'est pas rendue. Neutre plutôt qu'un `p-message`, dont le fond d'alerte couvrirait la phrase qui explique comment s'en sortir. Même écran pour une divergence de version, sans action |
| Notifications non bloquantes | `p-toast` | PrimeNG | Fin d'une phase longue. Une clé enregistrée se confirme au contraire par un `p-tag` persistant : l'état de la clé se relit, il ne s'annonce pas |
| Erreurs contextuelles | `p-message` inline | PrimeNG | Dans l'écran concerné, jamais en toast : une erreur qui disparaît toute seule est une erreur perdue |

### Composants Custom

Des wrappers écrits une fois, pour que ce qu'ils encapsulent ne soit pas recopié écran par écran.

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Icône d'interface | `IconComponent` | `@primeicons/angular` | Nom d'icône et token de taille en props. Le nom est une union littérale des icônes utilisées, jamais `string` : un nom ouvert imposerait un registre des 360 icônes de la 8.0.0 et casserait le tree-shaking. Un import et un `@case` par icône, plus un test qui parcourt la liste, Angular ne vérifiant pas l'exhaustivité d'un `@switch`. Le rendu passe par `data-p-icon` sur un `<svg>`, la taille se pose donc en `width` / `height` et non en `font-size`. Sans ce wrapper, les trois tailles 16 / 20 / 24 se recopient à la main partout |
| Logo de source | `SourceLogoComponent` | Simple Icons | Les logos de source en `currentColor`, même jeu de tailles que les icônes |
| État d'un morceau | `StateTagComponent` | PrimeNG (`p-tag`) | Porte le mapping `state` / `resolution` / `failure_reason` → famille, icône, libellé. Entièrement spécifié au § Couleurs Sémantiques : l'encoder une fois évite qu'il soit re-dérivé, de travers, écran par écran |
| Bloc vide | `EmptyStateComponent` | — (from scratch) | Le bloc vide décrit au § États des Composants. PrimeNG n'a pas d'équivalent, il s'écrit from scratch |
| Sélection de chemin | `PathPickerComponent` | PrimeNG (`pButton`, `pLabel`) | Libellé, bouton et chemin retenu, un par dossier ou fichier à choisir. Ses trois éléments sont des cellules de la grille de l'appelant (`display: contents`) : libellés, boutons et chemins s'alignent en colonnes d'un sélecteur à l'autre |
| Progression d'une phase | `PhaseProgressComponent` | PrimeNG (`p-progressbar`) | Libellé et compteur au-dessus de la barre, que `p-progressbar` ne sait pas porter. La barre n'écrit aucune valeur, le compteur la porte. Sans valeur, elle passe en indéterminée |
| Table pleine hauteur | `fullHeightTable` (`shared/utils/table.ts`) | PrimeNG (`[pt]` de `p-table`) | Fond de ligne sur toute la hauteur du conteneur, et table étirée quand elle est vide pour centrer son bloc vide. Jamais étirée remplie : ses lignes dépasseraient la hauteur attendue par le défilement virtuel |
| Erreur contextuelle | `ErrorMessageComponent` | PrimeNG (`p-message`) | Erreur du sidecar traduite depuis son `code` et ses `params`, sous la forme décrite au § Feedback |
| Texte tronqué | `TruncatedTextComponent` | PrimeNG (`pTooltip`) | Chemin ou valeur de colonne fluide coupé par l'ellipse. Le tooltip `wide` ne s'ouvre que sur un texte coupé, et `rtl` coupe un chemin par la gauche |

### Post-MVP (non installés)

> Chaque entrée rejoint sa famille ci-dessus au moment de son installation.

| Catégorie | Composant | Librairie | Notes |
|-----------|-----------|-----------|-------|
| Bascule du mode agent IA | `p-toggleswitch` dans les Settings | PrimeNG | Arrive avec l'agent d'arbitrage, cf. [ARCHITECTURE.md § Évolutions Futures](ARCHITECTURE.md#-évolutions-futures-post-mvp) |

> `pInputText` et `pTooltip` sont des **directives** posées sur un élément existant, pas des composants `<p-inputtext>` ou `<p-tooltip>`.

## États des Composants

> Les composants PrimeNG portent déjà leurs états (hover, focus, disabled, invalid) via le preset. Ce tableau ne couvre que les éléments **custom** écrits from scratch, plus `p-badge`, dont les tailles sont une décision projet (§ Tailles de Badge).

| État | Style / Comportement | Contexte |
|------|---------------------|----------|
| Survol d'une zone cliquable custom | `bg-emphasis`, transition `background-color 150ms ease-out` | Jamais de déplacement ni de scale : les lignes de la liste ne bougent pas sous le curseur |
| Sélection | `bg-highlight` | Cohérent avec la sélection des composants PrimeNG |
| Focus clavier | Anneau `--p-focus-ring-*`, identique aux composants PrimeNG | La modale d'arbitrage se traite entièrement au clavier, `outline: none` est interdit |
| Désactivé | `--p-disabled-opacity` (0.6) + `cursor: not-allowed` | Un bouton désactivé garde son libellé, il n'est jamais masqué |
| Chargement | `p-skeleton` aux dimensions de la ligne finale | Évite le saut de layout à l'arrivée des événements |
| Curseur | Flèche partout, `text` sur les seuls champs de saisie | Le curseur texte sur une table ou un libellé fait lire une page web |
| Vide | Icône 24px en `text-muted-color`, titre en `text-base`, une phrase en `text-sm text-muted-color`, et l'action qui débloque quand elle existe | Quatre cas à couvrir : dossier sans fichier audio, playlist dont aucun morceau n'est retrouvé dans la source, aucun run passé, cache déjà vide. Dans une table, le template `#emptymessage` de `p-table` porte ce bloc, centré sur toute la hauteur par `fullHeightTable`, et sa cellule pose `border-b-0` : le pass-through n'atteint pas les lignes, et la bordure basse traînerait au pied de la table |

### Tailles de Badge

Deux tailles, celle par défaut (20px, aucune prop `size`) et `large` (24px, `size="large"`). Pas de `small` : le badge n'a qu'un usage réel dans le produit, le compteur de la file d'arbitrage, et rien n'y demande moins de 20px. Vérifié dans le composant `p-badge` : `size="small"` map sur `p-badge-sm` (18px), `size="large"` sur `p-badge-lg` (24px), et l'absence de `size` reste sur le token racine (20px). Ni `small` ni `xlarge` n'ont d'usage ici.

La taille s'apparie à celle des éléments de la même rangée, pas à une préférence : défaut à côté de boutons `small`, `large` à côté de boutons `normal`. Dans le footer d'arbitrage, le compteur est encadré de boutons `small`, il reste donc en taille par défaut. Un badge plus court que ce qui l'entoure sur une même ligne est un défaut, pas une variante.

**La puce portée par un `p-button` est neutre par défaut**, avec les mêmes paires de couleurs que `p-badge`. Un compteur de file n'est pas une action, et l'accent reste réservé aux actions et à la sélection (cf. § Palette de Couleurs). Un compteur porté par un bouton doit par ailleurs être indiscernable du même compteur posé à côté, sinon `1/3` et `2/3` ne se ressemblent pas.

---

# 🖼️ Icônes

**Librairie UI** : `@primeicons/angular` 8, tiré par PrimeNG v22. Des composants standalone rendant du **SVG inline**, et non plus la police et ses classes `pi pi-*` des versions antérieures. Aucun asset de police à copier, donc rien à embarquer pour l'affichage hors ligne

**Librairie logos** : SVG [Simple Icons](https://simpleicons.org) copiés dans `src/assets/icons/`, en `fill="currentColor"`

| Logo | Où |
|------|-----|
| Beatport, Bandcamp, SoundCloud | Colonne Source de la liste du run, entête de la modale d'arbitrage, récapitulatif |
| VLC media player | Onglet Playlist, quand le fichier sélectionné est un dump VLC reconnu |

**Règles** :

- Taille cohérente par contexte : `16px` inline (tables, tags), `20px` UI standard (boutons, entêtes), `24px` standalone (écran bloquant, états vides), posées en `width` / `height` sur le SVG et non en `font-size`
- PrimeIcons couvre toute l'interface. Ses icônes de marques ne contiennent **aucun des logos** dont le projet a besoin, d'où les SVG en assets
- Quatre fichiers copiés plutôt que le paquet `simple-icons` complet : on en extrairait quatre chemins sur plus de trois mille
- `currentColor` obligatoire sur les SVG : la couleur vient du contexte, elle n'est jamais écrite dans le fichier
- Aucune action destructive n'est signalée par une icône seule : rollback et confirmation d'écriture portent toujours un libellé traduit

---

# ✨ Animations & Motion

## Librairie

**Aucune dépendance d'animation.** Les entrées et sorties passent par `animate.enter` / `animate.leave` natifs d'Angular, et PrimeNG anime en CSS. Ses props `showTransitionOptions` / `hideTransitionOptions` ne sont plus fonctionnelles : les régler ne produit rien, sans erreur.

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

> Les transitions des composants PrimeNG (Dialog, Toast, Tabs, Skeleton) sont intégrées et ne sont pas reprises ici. Ce tableau ne couvre que les éléments custom, plus trois composants PrimeNG dont les paramètres sont une décision projet : la modale d'arbitrage, dont l'absence d'animation en est une, le tooltip, dont le délai n'a aucun défaut dans la bibliothèque, et la barre de progression, dont la transition par défaut retarde l'information.

| Composant | Type d'animation | Mécanisme | Trigger |
|-----------|-----------------|-----------|---------|
| Modale d'arbitrage | **Aucune** | — | La décision est sur le chemin critique du run, une transition d'entrée ne fait que la retarder |
| Bandeau d'erreur, invite de reprise | `animate-fadein animate-duration-200` | Plugin + `animate.enter` | Montage |
| Zone cliquable custom | Transition de fond 150ms | CSS | Hover |
| Ligne de table changeant d'état | Transition de couleur du tag 150ms | CSS | Événement `track_resolved` |
| Vignette de pochette | Fondu à l'arrivée de l'image | `animate-fadein animate-duration-200` | Chargement terminé |
| Contenu d'un onglet | Fondu, opacité seule, jamais de déplacement | `animate-fadein animate-duration-200` | Changement d'onglet |
| Formulaire et résumé de l'onglet Playlist | Fondu de celui qui entre | `animate-fadein animate-duration-200` + `animate.enter` | Repli au lancement, « Modifier » |
| Barre de progression | Largeur suivie en 200ms `ease-out` | `[pt]` sur l'élément `value` de `p-progressbar` | Chaque événement `progress`. La transition de 1s de PrimeNG, relancée à chaque événement, laissait la barre à 5 % d'un run fini à 97 % |
| Tooltip | Fondu de 250ms à l'apparition, rien à la disparition | Intégré à PrimeNG (`fadeIn` codé en dur, non réglable) + `showDelay` à 400ms, `undefined` par défaut | Survol maintenu : un survol de passage n'allume rien, un survol intentionnel oui |

La barre `p-tabs` reste **hors du conteneur animé** : elle ne clignote pas, seul ce qu'elle commande se substitue.

---

# 📐 Layout & Espacement

## Structure de Page

| Élément | Valeur | Usage |
|---------|--------|-------|
| Fenêtre | 1280 × 800 à l'ouverture, plancher 1024 × 700, sans plafond | Plancher dicté par le jeu de six colonnes ci-dessous. Réglages dans `tauri.conf.json`, cf. [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives) |
| Shell | Barre `p-tabs` en haut, contenu sur le reste de la hauteur | La page elle-même ne défile jamais, le scroll vit dans la table. Le shell masque son débordement, et `overscroll-behavior: none` coupe le rebond de WebView2, qui fait trembler toute la fenêtre à la molette |
| Container | Pleine largeur, `px-16 py-8` | Tous les écrans, porté par le shell : une page ne pose que son contenu |
| Modale d'arbitrage | 720 × 560px, zone de liste 268px | Figée quelle que soit la fenêtre : ne relève pas du container |
| Tables | `p-table` à sa taille par défaut, `[scrollable]` en `scrollHeight="flex"`, `[virtualScroll]` | Seules les lignes visibles sont montées : une playlist de plusieurs milliers de morceaux s'affiche aussi vite qu'une de trente, là où tout monter prend des secondes. En contrepartie, `virtualScrollItemSize` doit valoir la hauteur exacte d'une ligne, posée par une classe et à remesurer quand leur style change |
| Rythme interne d'un groupe | `gap-2` | Éléments d'un même groupe |
| Espacement entre groupes | `gap-4` | Groupes d'un même écran |
| Espacement entre sections | `gap-6` | Échelle Tailwind par 4px |
| Grid principal | Flexbox et CSS Grid natifs | Aucune librairie de grid |

**Un seul container, pour tous les écrans.** Un formulaire et une table qui ne partagent pas la même largeur ne s'alignent sur rien, et chaque onglet finissait par inventer ses marges. La pleine largeur sert les colonnes Avant et Après de la liste d'un run, qui portent chacune un artiste plus un titre et sont exactement ce que l'utilisateur compare.

**Colonnes de la liste d'un run** :

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Pochette | 48px fixe | Vignette de 32px, `p-skeleton` tant que le morceau n'est pas résolu. Mesurée sur la vignette plus sa gouttière |
| Avant | **fluide** | Artiste et titre lus dans le fichier, avec le **nom du fichier en sous-texte** `text-xs text-muted-color`. Deux lignes en toutes circonstances : quand les tags sont vides, c'est le nom de fichier privé de son extension qui passe en ligne principale, le sous-texte gardant le nom complet. La colonne s'aligne ainsi d'une ligne à l'autre, au prix d'une redite sur les seuls fichiers sans tags |
| Après | **fluide** | Ce que la source retenue va écrire |
| Source | fixe | Logo 16px + libellé, Beatport / Bandcamp / SoundCloud. Mesurée sur « SoundCloud » |
| Score | fixe | Moyenne des deux scores en ligne principale, `A 96 · T 92` en `text-xs` dessous. Mesurée sur `A 100 · T 100` |
| État | fixe | `p-tag`, cf. § Couleurs Sémantiques. Mesurée sur le plus long des libellés livrés, et à remesurer quand l'écriture ajoute le sien, plus long que tous |

Ces trois colonnes se figent pour la raison du rapport, doublée ici : leur contenu arrive pendant le run. Chacune se mesure à l'implémentation sur son contenu le plus large, dans les deux langues, et pas un pixel de plus : ce qui leur est repris va aux deux colonnes qu'on compare vraiment.

**Colonnes du rapport d'extraction** :

| Colonne | Largeur | Contenu |
|---------|---------|---------|
| Fichier | **fluide** | Nom du fichier, tronqué et révélé au survol |
| État | 197px | `p-tag`, cf. § Couleurs Sémantiques, suivi de l'icône info quand la ligne porte un détail en tooltip : critère et candidats d'un doublon, motif d'un échec. Mesurée sur « Doublon départagé » plus son glyphe et l'icône, le plus long des cinq libellés ; l'anglais est plus court |

Sans largeur figée sur État, la colonne se redimensionne au défilement selon les tags que le défilement virtuel a montés, et la table bouge sous le curseur.

**Ce qui demande un geste ouvre le rapport** : échecs de transfert, introuvables, puis doublons départagés, et enfin les déjà présents et les extraits. Un rapport de plusieurs centaines de lignes se lit par le haut, et ce qui est passé tout seul n'attend rien de l'utilisateur.

**Onglet Playlist en deux temps.** Le formulaire est une grille de trois colonnes, `grid-cols-[max-content_max-content_1fr]` en `gap-4` : libellés, contrôles de même largeur, chemins alignés à droite, et « Extraire la playlist » seul sur la ligne suivante. Dès le lancement, il cède la place à une ligne de résumé, source › destination › playlist · mode, avec la barre de progression dessous pendant le run. Le rapport récupère ainsi la hauteur du formulaire (le 2026-09-17 : 12 lignes visibles à 1280 × 800, 10 au plancher). « Modifier » rouvre le formulaire sans masquer le rapport, et le lancement suivant replie de nouveau.

**Source dit d'où vient la donnée écrite, État dit par quel chemin on y est arrivé.** Un morceau résolu en collant une URL SoundCloud affiche donc SoundCloud en source et « URL » en état : c'est la seule voie par laquelle SoundCloud entre dans le produit, jamais la recherche automatique. C'est la même séparation que celle posée entre `state` et `resolution` dans le contrat NDJSON, portée cette fois côté affichage.

Seules **Avant** et **Après** absorbent le redimensionnement, les autres restent à largeur fixe. Le détail champ par champ (label, BPM, key, année, genre) et la pochette en grand vivent dans la ligne dépliée.

Deux choix qui portent le tableau. Le **nom de fichier est un sous-texte d'Avant**, pas une colonne : quand les tags manquent, c'est déjà lui qui sert de requête, et deux colonnes pour la même chaîne coûteraient de la largeur aux deux colonnes qu'on compare vraiment. Et le **score s'affiche en trois nombres** : le scoring plancher à 70 s'applique séparément à l'artiste et au titre, le seuil haut à 90 sur leur moyenne. Un seul chiffre cacherait lequel des deux fait tomber le morceau en zone grise, qui est précisément ce que l'utilisateur a besoin de savoir pour arbitrer.

**Modale d'arbitrage** : largeur et hauteur **figées**, indépendantes du nombre de candidats. La liste occupe une zone de hauteur fixe avec son propre scroll, le compteur et les boutons sont ancrés en bas. Le remplacement de la liste Beatport par la liste Bandcamp après un refus ne déplace donc rien. C'est le seul écran où l'utilisateur enchaîne les clics à cadence rapide, sur une file qui peut compter des dizaines d'arbitrages : un bouton qui se décale entre deux clics fait valider le mauvais candidat, et cette erreur ne se voit qu'après l'écriture. Les dimensions sont au tableau ci-dessus : sans valeurs, la règle n'est pas vérifiable et se perd à la première reprise du composant.

## Responsive

> Approche : `desktop-only`. Application de bureau Windows, aucune cible mobile ni tactile.

| Breakpoint | Notation Tailwind | Largeur | Changements clés |
|------------|-------------------|---------|------------------|
| Base | (défaut) | ≥ 1024px, plancher de la fenêtre | Jeu de six colonnes au complet. Aucune colonne masquée : le redimensionnement est absorbé par Avant et Après |

Un jeu de colonnes qui tient au plancher, plutôt qu'un masquage progressif : personne n'a à retenir quelle information disparaît à quelle taille.

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
- ✅ **Une largeur se mesure sur le contenu le plus long, dans les deux langues** : les libellés existent en FR et en EN (cf. [ADR-004](adrs/004-i18n-ngx-translate.md)), et le français est généralement le plus long des deux. Un bouton ou un libellé n'a donc aucune largeur en dur et se dimensionne sur son contenu, ou sur le plus large de sa colonne de grille. Une colonne de table se fige au contraire sur le plus long de ses libellés (§ Layout), sinon elle change de taille au défilement
- ✅ **Aucun libellé en dur dans un template** : tout passe par ngx-translate, y compris les messages d'erreur, que le sidecar émet en `code` + `params` et que l'interface traduit
- ✅ **Navigation clavier complète sur la modale d'arbitrage** : flèches entre arbitrages, entrée pour valider, focus visible en permanence
- ✅ **Les filtres du récapitulatif se lisent dans cet ordre : `state` pour l'échec, `resolution` pour la voie.** « Échecs » vaut `state ∈ {unresolved, write_error}`, « validés » et « arbitrés » se lisent sur `resolution` **et** excluent les échecs, sans quoi un `write_error` apparaîtrait dans les deux à la fois. « Arbitrés » vaut `resolution ∈ {arbitration, url}`, jamais `arbitration` seul. Les trois pièges que ça évite sont détaillés dans [ARCHITECTURE.md § API](ARCHITECTURE.md#api)

## Anti-Patterns

- ❌ **`::ng-deep`** : percer l'encapsulation d'un composant PrimeNG produit du style qui casse à la première mise à jour de la bibliothèque, et qui n'apparaît dans aucune recherche quand on cherche d'où vient une couleur. Passer par `[dt]` ou `[pt]`
- ❌ **`!important`** : si un style ne s'applique pas, c'est l'ordre des couches qui est en cause. Le corriger dans `cssLayer`, pas par la force. Seule exception, la coupure des animations sous `prefers-reduced-motion` (cf. § Animations & Motion)
- ❌ **Couleurs en dur** : ni hex, ni `bg-emerald-500`. Un changement de preset doit rester un changement de preset
- ❌ **`font-family` sur `body`** : la police est un token. `--font-sans` alimente `--default-font-family`, que le preflight applique à `html, :host`, et c'est la même valeur que rend la classe `font-sans`. Une règle sur `body` afficherait la bonne police tout en laissant `font-sans` sur la pile système, écart muet jusqu'au jour où la classe apparaît quelque part
- ❌ **Styles inline `[style]`** : réservés aux valeurs calculées à l'exécution (largeur d'une barre, position d'un élément virtualisé)
- ❌ **Logique métier dans un composant** : les scores, les seuils et le classement des candidats viennent du sidecar. L'interface affiche ce qu'elle reçoit, à l'exception des deux familles qu'elle dérive de ce qu'elle n'a pas reçu (cf. [ARCHITECTURE.md § Frontend](ARCHITECTURE.md#-frontend))
- ❌ **Animation sur le chemin de décision** : rien ne s'anime entre l'arrivée d'un `arbitration_required` et l'affichage des candidats
- ❌ **Pochettes en base64 dans le flux NDJSON** : les images passent par `convertFileSrc()` depuis le cache disque, le protocole reste textuel et lisible

---

# 🔗 Ressources

## Maquette et design system externes

- **Design system** : [Techno Tagger Design System](https://claude.ai/design/p/66daf6c5-f225-4dcc-bf7d-1d792e633ee5) : les composants du mapping ci-dessus, chacun avec son miroir JSX, son typage et sa fiche d'usage, plus les tokens et les guidelines. Fait foi sur les composants, quand ce document fait foi sur les règles
- **Maquette** : le même projet, dossier `ui_kits/techno-tagger/` : un écran cliquable par onglet, plus le shell. Fait foi sur l'apparence d'un écran là où ce document se tait
- **Synchronisation** : fichier par fichier, procédure et journal dans `.design-sync/NOTES.md`. Le convertisseur automatique ne s'applique pas, l'interface étant Angular sans point d'entrée de librairie : les composants du projet distant sont des recréations React bâties depuis ce document, jamais depuis le code livré

## Documentation Officielle

- [PrimeNG : Theming](https://primeng.dev/theming) : design tokens, `definePreset()`, `darkModeSelector`, tokens scopés `[dt]`
- [PrimeNG : Configuration](https://primeng.dev/configuration) : `providePrimeNG()`, licence, ripple (désactivé par défaut)
- [PrimeNG : Tailwind CSS](https://primeng.dev/tailwind) : installation, liste des classes issues des tokens, utilitaires d'animation, dark mode
- [PrimeNG : PassThrough](https://primeng.dev/passthrough) : API `[pt]`, locale et globale
- [PrimeNG : Table](https://primeng.dev/table) : `scrollHeight="flex"`, scroll virtuel, `expandedRowKeys`
- [PrimeNG : Migration v21](https://primeng.dev/migration/v21) : passage aux animations CSS natives
- [Tailwind CSS : Dark mode](https://tailwindcss.com/docs/dark-mode) : `@custom-variant`
- [PrimeIcons](https://primeicons.dev) : catalogue, catégories, recherche
- [Angular : Enter and Leave animations](https://angular.dev/guide/animations) : `animate.enter` / `animate.leave`
- [Angular : Migrating to Native CSS Animations](https://angular.dev/guide/animations/migration) : sortie de `@angular/animations`
- [Simple Icons](https://simpleicons.org) : logos Beatport, Bandcamp, SoundCloud, VLC media player
- [Fontsource : Inter](https://fontsource.org/fonts/inter) : paquet `@fontsource-variable/inter`, axes et poids

## Ressources Complémentaires

- [Techno Tagger Design System](https://claude.ai/design/p/66daf6c5-f225-4dcc-bf7d-1d792e633ee5) : ce document porté dans Claude Design, avec une maquette cliquable de chaque écran. À lire avant d'en implémenter un, elle fait foi sur l'apparence quand ce document fait foi sur les règles
- [Preset Aura : source](https://github.com/primefaces/primeuix/blob/main/packages/themes/src/presets/aura/base/index.ts) : valeurs exactes des primitives et des tokens sémantiques
- [primeng#17946](https://github.com/primefaces/primeng/issues/17946) et [tailwindcss-primeui#27](https://github.com/primefaces/tailwindcss-primeui/issues/27) : l'incompatibilité SCSS de Tailwind v4
- [ARCHITECTURE.md](ARCHITECTURE.md) : stack, écrans, contrat NDJSON et modes de panne à couvrir visuellement
- [ADR-003](adrs/003-primeng-community-license.md) : PrimeNG sous Community License, preset Aura, `definePreset()` comme seule voie de personnalisation **du thème**, le Theme Designer n'étant pas inclus
- [ADR-004](adrs/004-i18n-ngx-translate.md) : bascule FR / EN à l'exécution, contrainte d'élasticité des libellés
