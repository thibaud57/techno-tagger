---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "liste-du-run"
goal: "Afficher les morceaux d'un run dans une table à six colonnes qui se met à jour événement par événement"
status: "draft"
complexity: "L"
tdd_scope: "partial"
depends_on: ["08-service-sidecar-tagging-design.md"]
date: "2026-09-20"
---

# Liste du run : table à six colonnes

## Scope

Couvre `StateTagComponent`, aujourd'hui un placeholder, avec le mapping complet de `state`, `resolution`, `failure_reason` et de l'attente d'arbitrage vers les quatre familles sémantiques, et le composant de liste du run : table à six colonnes (Pochette, Avant, Après, Source, Score, État) en scroll virtuel pleine hauteur, vignettes lues dans le cache par `convertFileSrc`, squelettes tant qu'un morceau n'est pas résolu, bloc vide, et les libellés FR et EN.

Exclut la page qui porte la table, le choix du dossier, le lancement et la progression (sub-project 10), la ligne dépliable du détail avant/après (Feature 5), le récapitulatif filtrable (Feature 6) et la modale d'arbitrage (Feature 3).

### État livré

À la fin de ce sub-project, on peut : lancer `pnpm test` et voir passer le mapping des six états que la Feature 2 fait circuler, puis, une fois la page livrée au sub-project 10, voir une liste de 100 morceaux défiler sans saccade, chaque ligne portant sa pochette, son avant, son après, sa source, ses scores et son état.

## Dependencies

- `08-service-sidecar-tagging-design.md` (statut: draft) : fournit `TaggingTrack` et les signaux du run, que la page passera à ce composant.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, fonction `runColumns` (les six colonnes, le sous-texte du nom de fichier, le tiret pour une valeur absente) et composant `Artwork` (vignette et squelette). La ligne dépliable `TrackDetail` n'est pas reprise (Feature 5).
- **Design system** : `components/data/DataTable.prompt.md`, `components/data/Skeleton.prompt.md`, `components/feedback/StateTag.prompt.md`, `components/feedback/Tag.prompt.md`, `components/icons/SourceLogo.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`, arbitrages dans `.design-sync/NOTES.md` § Reste ouvert (container unique porté par le shell, page qui ne défile jamais, tables à scroll virtuel)

## Files touched

- **À modifier** : `src/app/shared/components/state-tag.component.ts` (remplace le placeholder)
- **À créer** : `src/app/shared/components/state-tag.component.spec.ts`
- **À modifier** : `src/app/shared/components/icon.component.ts` (icône `clock`, absente de la liste)
- **À modifier** : `src/app/shared/components/source-logo.component.ts` (tracés Beatport, Bandcamp et SoundCloud, seul VLC étant câblé)
- **À créer** : `src/app/features/tagging/run-list.component.ts` et `.html`
- **À créer** : `src/app/features/tagging/run-list.component.spec.ts`
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (en-têtes, états, bloc vide)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : taille de la table)

Aucun changement côté Tauri : `assetProtocol` est déjà activé avec le scope `$APPLOCALDATA/cache/artworks/**` et la CSP porte déjà `img-src asset:`, ce qui couvre exactement le dossier de cache du sub-project 04.

## Architecture approach

- **`StateTagComponent` porte le mapping une fois pour toutes** (DESIGN.md § Couleurs Sémantiques, fiche `StateTag.prompt.md`). Ordre de décision : une attente d'arbitrage donne la famille « décision attendue », un `state` absent donne « neutre », sinon la table s'applique. Les valeurs d'écriture (`written`, `write_error`) n'existent pas encore dans le contrat (`TrackState` du sub-project 08) : la Feature 5 les ajoutera au contrat et à cette table en même temps, sans rien poser d'avance qui resterait mort.

  | Cas | Sévérité | Icône | Libellé |
  |---|---|---|---|
  | attente d'arbitrage | `info` | `info-circle` | À arbitrer |
  | aucun état reçu | `secondary` | `clock` | En attente |
  | `resolved`, `auto` | `success` | `check` | Auto |
  | `resolved`, `arbitration` | `success` | `check` | Arbitré |
  | `resolved`, `url` | `success` | `check` | URL |
  | `unresolved` | `danger` | `times` | Non résolu |

  La Feature 5 ajoutera `written` (mêmes trois lignes vertes) et `write_error` (`danger`, `exclamation-triangle`, libellé générique, le motif vivant dans la ligne dépliée). Le libellé porte la voie, jamais la couleur. La sévérité s'écrit `warn` et jamais `warning`, piège documenté dans DESIGN.md, même si aucun état ne l'emploie.
- **Un composant de liste séparé de la page** : la table se teste et se lit seule, la page gère le dossier, le lancement et la progression. Elle reçoit les lignes en `input.required` et ne connaît aucun service (`.claude/rules/angular/components.md`).
- **Table PrimeNG à sa taille par défaut** (DESIGN.md § Layout), `[scrollable]` en `scrollHeight="flex"`, `[virtualScroll]` avec un `virtualScrollItemSize` égal à la hauteur réelle d'une ligne, posée par une classe : une valeur fausse fait sauter le défilement ou coupe les lignes (`.claude/rules/primeng/composants.md`). La hauteur est à revalider chaque fois que le style d'une ligne change.
- **Écart à la maquette, tranché le 2026-09-20** : la fiche `DataTable` pose la table en `size="small"`, DESIGN.md § Layout la veut à sa taille par défaut. DESIGN.md prime (`.claude/rules/design/claude-design.md`), et l'écart est consigné dans `.design-sync/NOTES.md` § Reste ouvert pour le prochain push vers le design system.
- **Colonnes** (DESIGN.md § Colonnes de la liste d'un run) : Pochette 32px, Avant et Après fluides, Source, Score et État figées, mesurées sur leur contenu le plus long dans les deux langues. Rien n'est masqué à aucune largeur, le plancher de la fenêtre étant dicté par ces six colonnes.
  - **Avant** : artiste et titre lus, nom de fichier en sous-texte `text-xs text-muted-color`. Quand les tags sont vides, le nom de fichier passe en ligne principale, comme dans la maquette.
  - **Après** : ce que la source écrira, déjà calculé par le sidecar. Un tiret discret tant que rien n'est résolu.
  - **Source** : `SourceLogoComponent` en 16px, plus le libellé. Le composant ne porte aujourd'hui que le tracé VLC, livré avec l'onglet Playlist : les trois logos de sources sont repris de `src/assets/icons/` en SVG inline et `currentColor`, jamais par `<img src>`, le build n'émettant que `public/`.
  - **Score** : moyenne en ligne principale, `A 96 · T 92` en `text-xs` dessous. Sans artiste, seul le score titre s'affiche.
  - Les deux colonnes fluides passent par `TruncatedTextComponent`, dont le tooltip large ne s'ouvre que sur un texte coupé et ne porte jamais seul une information (DESIGN.md § Tokens de Tooltip).
- **Vignettes** : `convertFileSrc` traduit le chemin du cache en URL d'asset (`.claude/rules/tauri/config-bundle.md`). Tant que le morceau n'est pas résolu, un `p-skeleton` de 32px au rayon `sm` tient la place ; l'image arrive en fondu de 200 ms (DESIGN.md § Composants Animés). Aucune image ne transite en base64 par le protocole NDJSON.
- **Bloc vide** par le template `#emptymessage` de `p-table` et `EmptyStateComponent`, avec `[pt]="fullHeightTable(vide)"` sur la table et `border-b-0` sur la cellule, exactement comme le rapport d'extraction déjà livré.
- **Aucune logique métier** : scores, états et « après » viennent du sidecar. Le seul calcul de ce sub-project est la dérivation de la famille visuelle, que DESIGN.md confie explicitement à l'interface.
- **i18n** : en-têtes, libellés d'état et bloc vide passent par ngx-translate, FR et EN dans le même commit, colonnes figées mesurées sur le libellé le plus long des deux langues.

## Acceptance criteria

### Scénario 1 : Morceau en attente
**GIVEN** un morceau dont aucun événement n'est encore arrivé
**WHEN** sa ligne est rendue
**THEN** son état affiche « En attente » en gris avec l'icône d'horloge
**AND** sa pochette est un squelette

### Scénario 2 : Morceau validé automatiquement
**GIVEN** un morceau résolu en `auto` sur Beatport, avec pochette et scores
**WHEN** sa ligne est rendue
**THEN** son état affiche « Auto » en vert
**AND** la colonne Source montre le logo Beatport et son libellé, et la colonne Score la moyenne puis le détail par champ

### Scénario 3 : Morceau à arbitrer
**GIVEN** un morceau dont l'arbitrage est en attente
**WHEN** sa ligne est rendue
**THEN** son état affiche « À arbitrer » en bleu, jamais en orange

### Scénario 4 : Morceau non résolu
**GIVEN** un morceau `unresolved`
**WHEN** sa ligne est rendue
**THEN** son état affiche « Non résolu » en rouge avec l'icône de croix
**AND** les colonnes Après, Source et Score montrent un tiret

### Scénario 5 : Fichier sans tags
**GIVEN** un morceau dont l'artiste et le titre lus sont vides
**WHEN** sa ligne est rendue
**THEN** la colonne Avant montre le nom de fichier en ligne principale, sans sous-texte répété

### Scénario 6 : Dossier sans fichier audio
**GIVEN** un run démarré sur un dossier vide
**WHEN** la table est rendue
**THEN** le bloc vide s'affiche centré sur toute la hauteur de la table

### Scénario 7 : Cent morceaux
**GIVEN** un run de cent morceaux
**WHEN** la liste défile
**THEN** seules les lignes visibles sont montées, et l'en-tête reste collé en haut

## Tests à écrire

### Unit
- `src/app/shared/components/state-tag.component.spec.ts` :
  - renders the family, the icon and the label of every state (paramétré sur les six cas de la table)
  - prefers the pending arbitration over the received state
- `src/app/shared/components/icon.component.spec.ts` (existant) : la nouvelle icône entre dans la liste que le test parcourt, sans test à écrire
- `src/app/shared/components/source-logo.component.spec.ts` :
  - renders a path for every source (paramétré : beatport, bandcamp, soundcloud, vlc)
- `src/app/features/tagging/run-list.component.spec.ts` :
  - converts an artwork path into an asset url (`convertFileSrc` mocké)
  - shows the file name as the main line when the tags are empty

Aucun test ne vérifie que `@for` produit des lignes ni que PrimeNG défile : ce serait tester Angular et la bibliothèque. Ce qui est testé est la seule règle que le sidecar ne fournit pas, la dérivation de la famille visuelle, et la traduction d'un chemin en URL d'asset.

## Edge cases

- **Pochette absente** (`artwork_path` nul) sur un morceau résolu : la case reste vide, sans squelette, l'image ne viendra jamais.
- **Fichier d'image disparu du cache** (vidé entre-temps) : l'image ne charge pas, la case reste vide, aucune erreur visible.
- **Score sans artiste** : la ligne de détail n'affiche que `T 92`.
- **Morceau résolu par URL** (Feature 4) : la colonne Source montre l'hôte de l'URL, la colonne État « URL ». Le mapping le couvre déjà.
- **Titre très long dans les deux langues** : les colonnes figées ne bougent pas, seules Avant et Après absorbent, en tronquant avec un tooltip.
- **Changement de hauteur de ligne** : `virtualScrollItemSize` est à remesurer, sans quoi le défilement saute.

## Architectural decisions

### Décision : Taille de la table

**Options envisagées :**
- **A. Taille par défaut, comme DESIGN.md § Layout** : cohérente avec le rapport d'extraction déjà livré, et conforme à la règle qui fait primer DESIGN.md sur la maquette.
- **B. `size="small"`, comme la fiche `DataTable` du design system** : plus de lignes à l'écran sur un run de cent morceaux, au prix d'un alignement à faire dans DESIGN.md et dans le rapport d'extraction.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-20.
- `.claude/rules/design/claude-design.md` : la maquette fait foi sur l'apparence là où DESIGN.md se tait, DESIGN.md gagne quand les deux se contredisent. L'écart est consigné plutôt que tranché en silence.
