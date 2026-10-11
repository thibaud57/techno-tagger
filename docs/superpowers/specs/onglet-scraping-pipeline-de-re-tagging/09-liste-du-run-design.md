---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "liste-du-run"
goal: "Afficher les morceaux d'un run dans une table en scroll virtuel qui se met à jour événement par événement"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["08-service-sidecar-tagging-design.md"]
date: "2026-10-11"
---

# Liste du run : table en scroll virtuel

## Scope

Couvre `StateTagComponent`, avec le mapping de `state`, `resolution`, `failure_reason`, de l'attente d'arbitrage et du run arrêté vers les quatre familles sémantiques et `RunListComponent` : table en scroll virtuel pleine hauteur (le bouton du détail, la Pochette, Avant, Après, Source, Score, État), vignettes lues dans le cache par `convertFileSrc`, squelettes tant qu'un morceau n'est pas résolu, bloc vide et les libellés FR et EN.

Exclut la page qui porte la table, le choix du dossier, le lancement et la progression (sub-project 10), le contenu du détail déplié (`ecriture-des-tags-et-renommage/09-ligne-depliee-avant-apres-design.md`), les modales d'arbitrage et du lien que la ligne ouvre (epics `arbitrage-utilisateur` et `rattrapage-par-url-manuelle`) et le récapitulatif filtrable (Feature 6).

### État livré

À la fin de ce sub-project, on peut : lancer `pnpm test` et voir passer le mapping de chaque état de morceau vers sa famille visuelle, puis, une fois la page livrée au sub-project 10, voir une liste de 100 morceaux défiler sans saccade, chaque ligne portant sa pochette, son avant, son après, sa source, ses scores et son état.

## Dependencies

- `08-service-sidecar-tagging-design.md` (statut: implemented) : fournit `TaggingTrack` et les signaux du run, que la page passera à ce composant.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, fonction `runColumns` (les colonnes de données, le sous-texte du nom de fichier, la cellule sans valeur) et composant `Artwork` (trois états). `TrackDetail` relève du sub-project de la ligne dépliée.
- **Design system** : `components/data/DataTable.prompt.md`, `components/data/Skeleton.prompt.md`, `components/feedback/StateTag.prompt.md`, `components/feedback/Tag.prompt.md`, `components/icons/SourceLogo.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`, `.claude/rules/primeng/ligne-depliee.md`, arbitrages dans `docs/DESIGN.md` § Structure de Page et § Arbitrages (container unique porté par le shell, page qui ne défile jamais, tables à scroll virtuel)

## Files touched

- **À modifier** : `src/app/shared/components/state-tag.component.ts` (remplace le placeholder)
- **À créer** : `src/app/shared/components/state-tag.component.spec.ts`
- **À modifier** : `src/app/shared/components/icon.component.ts` (icône `clock`, absente de la liste)
- **À modifier** : `src/app/shared/components/source-logo.component.ts` (tracés Beatport, Bandcamp et SoundCloud, seul VLC étant câblé)
- **À créer** : `src/app/features/tagging/run-list.component.ts` et `.html`
- **À créer** : `src/app/features/tagging/run-list.component.spec.ts`
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (en-têtes, états, bloc vide)
- **À modifier** : `.design-sync/NOTES.md` (écart de taille de la table)
- **À modifier** : `docs/DESIGN.md` (§ Colonnes de la liste d'un run : largeur de la colonne Pochette, comportement de la colonne Avant)

Aucun changement côté Tauri : `assetProtocol` est déjà activé avec le scope `$APPLOCALDATA/cache/artworks/**` et la CSP porte déjà `img-src asset:`, ce qui couvre exactement le dossier de cache du sub-project 04.

## Architecture approach

- **`StateTagComponent` porte le mapping une fois pour toutes** (DESIGN.md § Couleurs Sémantiques, fiche `StateTag.prompt.md`). Ordre de décision : une attente d'arbitrage donne la famille « décision attendue », sinon `state` s'applique. `written` reprend les trois lignes vertes de `resolved`, la voie restant celle de `resolution`. Un `state` absent donne « neutre », avec l'horloge tant que le run avance et le `minus-circle` quand il est interrompu ou confirmé (les lignes encore vides ne recevront plus rien).

  | Cas | Sévérité | Icône | Libellé |
  |---|---|---|---|
  | attente d'arbitrage | `info` | `info-circle` | À arbitrer |
  | aucun état reçu | `secondary` | `clock` | En attente |
  | aucun état reçu, run interrompu ou confirmé | `secondary` | `minus-circle` | Non traité |
  | `resolved` ou `written`, `auto` | `success` | `check` | Auto |
  | `resolved` ou `written`, `arbitration` | `success` | `check` | Arbitré |
  | `resolved` ou `written`, `url` | `success` | `check` | URL |
  | `unresolved` | `danger` | `times` | Non résolu |
  | `write_error` | `danger` | `exclamation-triangle` | Échec d'écriture |
  | `rolled_back` | `secondary` | `undo` | Restauré |

  Le libellé porte la voie, jamais la couleur. Celui d'un échec reste générique, son motif se lit au survol de la colonne État. La sévérité s'écrit `warn` et jamais `warning`, piège documenté dans DESIGN.md, même si aucun état ne l'emploie.
- **Un composant de liste séparé de la page** : la table se teste et se lit seule, la page gère le dossier, le lancement et la progression. Elle reçoit les lignes en `input.required` et ne connaît aucun service (`.claude/rules/angular/components.md`) : les gestes sur une ligne (arbitrer, rattraper, restaurer) sortent par des `output`, la page les branche.
- **Table PrimeNG à sa taille par défaut** (DESIGN.md § Structure de Page), `[scrollable]` en `scrollHeight="flex"`, `[virtualScroll]` avec un `virtualScrollItemSize` égal à la hauteur réelle d'une ligne, posée par une classe : une valeur fausse fait sauter le défilement ou coupe les lignes (`.claude/rules/primeng/composants.md`). La hauteur est à revalider chaque fois que le style d'une ligne change.
- **Écart à la maquette, tranché le 2026-09-20** : la fiche `DataTable` posait la table en `size="small"`, DESIGN.md § Structure de Page la veut à sa taille par défaut. DESIGN.md prime (`.claude/rules/design/claude-design.md`) et le design system a été réaligné le 2026-09-24 (DESIGN.md § Arbitrages, « Densité des tables »).
- **Colonnes** (DESIGN.md § Colonnes de la liste d'un run) : le bouton du détail et la Pochette figés sur leur contenu plus les marges de la cellule, Avant et Après fluides, Source, Score et État figées, mesurées sur leur contenu le plus long dans les deux langues. Rien n'est masqué à aucune largeur, le plancher de la fenêtre étant dicté par ce jeu de colonnes.
  - **Avant** : artiste et titre lus, nom de fichier en sous-texte `text-xs text-muted-color`. La colonne garde ses deux lignes en toutes circonstances : quand les tags sont vides, c'est le nom de fichier privé de son extension qui passe en ligne principale, le sous-texte gardant le nom complet (décision du propriétaire, cf. § Architectural decisions).
  - **Après** : ce que la source écrira, déjà calculé par le sidecar. Tant que rien n'est résolu, l'indice « Coller un lien » sur un morceau que le sidecar accepte de rattraper (`rattrapage-par-url-manuelle`), sinon `NoValueComponent`.
  - **Source** : `SourceLogoComponent` en 16px, plus le libellé. Les tracés Beatport, Bandcamp et SoundCloud sont repris de `src/assets/icons/` en SVG inline et `currentColor`, jamais par `<img src>`, le build n'émettant que `public/`.
  - **Score** : moyenne en ligne principale, `A 96 · T 92` en `text-xs` dessous. Sans artiste, seul le score titre s'affiche.
  - Les deux colonnes fluides passent par `TruncatedTextComponent`, dont le tooltip large ne s'ouvre que sur un texte coupé et ne porte jamais seul une information (DESIGN.md § Conventions de Code).
- **Vignettes** : `convertFileSrc` traduit le chemin du cache en URL d'asset (`.claude/rules/tauri/config-bundle.md`). `ArtworkComponent` les rend en trois états, jamais deux : l'image en fondu de 200 ms (DESIGN.md § Composants Animés), le `p-skeleton` de 32px au rayon `sm` tant que le morceau attend son tour (aucun état reçu et run en cours), un cadre neutre à l'icône `image` dès qu'il est tranché sans pochette. Aucune image ne transite en base64 par le protocole NDJSON.
- **Bloc vide et chargement** par le template `#emptymessage` de `p-table`, avec `[pt]="fullHeightTable(vide)"` sur la table et `border-b-0` sur la cellule, comme le rapport d'extraction. Tant que le sidecar parcourt le dossier (`loading`), `SkeletonRowsComponent` remplit la hauteur de lignes entières ; ensuite, un dossier sans fichier audio affiche `EmptyStateComponent`.
- **Lignes mémoïsées** : le store ne remplace que le morceau qu'un événement touche. Les lignes de la table sont gardées par objet morceau et `rowTrackBy` suit une clé de ligne : les autres lignes ne sont pas recontrôlées et le focus d'un bouton survit à l'événement.
- **Détail déplié** : lignes synthétiques sous la ligne du morceau, cf. `.claude/rules/primeng/ligne-depliee.md` et le sub-project de la ligne dépliée. La ligne d'un morceau à arbitrer ou à rattraper reste actionnable, au clic comme au clavier ; le bouton du détail n'ouvre ni l'un ni l'autre.
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
**AND** les colonnes Source et Score montrent la cellule sans valeur
**AND** sa pochette montre le cadre neutre, sans squelette

### Scénario 5 : Fichier sans tags
**GIVEN** un morceau dont l'artiste et le titre lus sont vides
**WHEN** sa ligne est rendue
**THEN** la colonne Avant montre le nom de fichier privé de son extension en ligne principale
**AND** son sous-texte garde le nom de fichier complet, la cellule restant sur deux lignes

### Scénario 6 : Dossier sans fichier audio
**GIVEN** un run démarré sur un dossier vide
**WHEN** la table est rendue
**THEN** le bloc vide s'affiche centré sur toute la hauteur de la table

### Scénario 7 : Dossier en cours de parcours
**GIVEN** un run lancé dont le sidecar n'a pas encore listé les fichiers
**WHEN** la table est rendue
**THEN** des lignes de squelette à la hauteur des vraies lignes remplissent la table
**AND** le bloc vide ne s'affiche pas

### Scénario 8 : Cent morceaux
**GIVEN** un run de cent morceaux
**WHEN** la liste défile
**THEN** seules les lignes visibles sont montées, et l'en-tête reste collé en haut

## Tests à écrire

### Unit
- `src/app/shared/components/state-tag.component.spec.ts` :
  - renders the family, the icon and the label of every state (paramétré sur les cas de la table)
  - shows a track left behind by an interrupted run as not processed
  - prefers the pending arbitration over the received state
- `src/app/shared/components/icon.component.spec.ts` (existant) : la nouvelle icône entre dans la liste que le test parcourt, sans test à écrire
- `src/app/shared/components/source-logo.component.spec.ts` :
  - renders a path for every source (paramétré : beatport, bandcamp, soundcloud, vlc)
- `src/app/features/tagging/run-list.component.spec.ts` :
  - converts an artwork path into an asset url (`convertFileSrc` mocké)
  - falls back to a placeholder when a resolved track has no artwork
  - shows the placeholder and not the skeleton on a track without a source
  - marks every valueless cell of an unresolved track with an em dash
  - shows the file name without its extension as the main line when the tags are empty
  - shows only the artist, or only the title, without an orphan separator

Aucun test ne vérifie que `@for` produit des lignes ni que PrimeNG défile : ce serait tester Angular et la bibliothèque. Ce qui est testé est la seule règle que le sidecar ne fournit pas, la dérivation de la famille visuelle, et la traduction d'un chemin en URL d'asset.

## Edge cases

- **Pochette absente** (`artwork_path` nul) sur un morceau tranché : le cadre neutre à l'icône `image` tient la place, sans squelette, l'image ne viendra jamais.
- **Fichier d'image disparu du cache** (vidé entre-temps) : l'image ne charge pas, la case reste vide, aucune erreur visible.
- **Score sans artiste** : la ligne de détail n'affiche que `T 92`.
- **Morceau résolu par URL** : la colonne Source montre la source de l'URL (Beatport, Bandcamp ou SoundCloud), la colonne État « URL ».
- **Titre très long dans les deux langues** : les colonnes figées ne bougent pas, seules Avant et Après absorbent, en tronquant avec un tooltip.
- **Changement de hauteur de ligne** : `virtualScrollItemSize` est à remesurer, sans quoi le défilement saute.

## Architectural decisions

### Décision : Taille de la table

**Options envisagées :**
- **A. Taille par défaut, comme DESIGN.md § Structure de Page** : cohérente avec le rapport d'extraction déjà livré et conforme à la règle qui fait primer DESIGN.md sur la maquette.
- **B. `size="small"`, comme la fiche `DataTable` du design system** : plus de lignes à l'écran sur un run de cent morceaux, au prix d'un alignement à faire dans DESIGN.md et dans le rapport d'extraction.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-20. Design system réaligné le 2026-09-24.
- `.claude/rules/design/claude-design.md` : la maquette fait foi sur l'apparence là où DESIGN.md se tait, DESIGN.md gagne quand les deux se contredisent. L'écart est consigné plutôt que tranché en silence.

### Décision : Colonne Avant sur un fichier sans tags

**Options envisagées :**
- **A. Nom de fichier complet seul en ligne principale** : la cellule perd son sous-texte, la même chaîne n'apparaît pas deux fois.
- **B. Nom de fichier privé de son extension en ligne principale, nom complet en sous-texte** : la cellule garde ses deux lignes, comme la maquette le fait dans `runColumns`.

**Choix : B**

**Rationale :**
- Décision du propriétaire le 2026-09-22, sur comparaison des deux rendus.
- En A, la ligne unique se centre verticalement dans les 56px que fige le scroll virtuel : son texte ne s'aligne avec aucune de ses voisines, et le décrochage se lit sur toute la colonne dès qu'un fichier sur dix n'a pas de tags. La redite de B ne se voit que sur la ligne concernée.
- La maquette fait foi sur l'apparence, et c'est déjà ce qu'elle rend.
