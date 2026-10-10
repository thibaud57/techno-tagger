---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "ligne-depliee-avant-apres"
goal: "Afficher sous une ligne de la liste du run la comparaison avant / après de ses tags, champ par champ, avec la pochette en grand"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["07-contrat-detail-avant-apres-design.md"]
date: "2026-10-06"
---

# Ligne dépliée avant / après

## Scope

Couvre le bouton d'ouverture du détail en tête de la liste du run, le détail déplié sous la ligne de tout morceau (résolu, non résolu, en attente, à arbitrer), plusieurs ouverts à la fois, le composant du détail (pochette en grand, 15 lignes plus le commentaire, valeurs absentes), le scroll virtuel de la liste, conservé, et le composant partagé de la cellule sans valeur, repris par les trois cellules qui l'écrivent en dur. Met DESIGN.md et les notes de sync de la maquette à jour de ces choix.

Exclut le bouton de rollback d'un morceau dans le détail (sub-project 11), les états d'écriture dans la colonne État (10) et le contenu des tags, tranché au sub-project 07.

### État livré

À la fin de ce sub-project, on peut : dans `just dev-ui`, déplier sous sa ligne le détail d'un morceau résolu par le bouton de sa ligne et voir sa pochette en grand et ses 15 champs avant / après avec leur clé, fidèles à `TrackDetail` aux écarts près consignés, en ouvrir un second sans fermer le premier, sans que le clic sur une ligne à arbitrer change de rôle, et faire défiler un run de 2 000 morceaux sans à-coup, un détail ouvert ; et lancer `just test` sur les specs du détail et de la liste.

## Dependencies

- `07-contrat-detail-avant-apres-design.md` (statut: implemented) : `TaggingTrack.tagsBefore` (`system`, `comment`, 16 `TagValue` dans l'ordre de la table) et `tagsAfter`, clés du fichier écrit, valeur gardée en Après

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, `TrackDetail` (grille Champ / Avant / Après, pochette de 160px) et `Artwork` (trois états) ; colonne de chevron du `DataTable` expandable employé par `runColumns`
- **Design system** : `components/data/DataTable` (lignes dépliables, `rowClickable`), `components/data/Skeleton`, `components/overlay/Tooltip`, `components/overlay/TruncatedText`
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/shared/components/no-value.component.ts` (`app-no-value`, cadratin en `text-muted-color`)
- **À créer** : `src/app/shared/components/artwork.component.ts` (`app-artwork`, pochette en trois états, en 32 et en 160px, partagée par la liste et le détail)
- **À créer** : `src/app/features/tagging/track-detail.component.ts` et `.html` (`TrackDetailComponent`, plus le nombre de lignes de la liste que le détail occupe, `detailSpan` et `MAX_DETAIL_SPAN`)
- **À créer** : `src/app/features/tagging/track-detail.component.spec.ts`
- **À modifier** : `src/app/features/tagging/run-list.component.ts` et `.html` (colonne du bouton d'ouverture, liste rendue avec les lignes synthétiques du détail, `[virtualScroll]` gardé avec `virtualScrollOptions`, clés de ligne par nature, `colspan` à 7, trois cadratins remplacés par `app-no-value`)
- **À modifier** : `src/app/features/tagging/run-list.component.spec.ts` (détail déplié, refermé et doublé sans arbitrage, nombre de lignes du cadre par cas, indices de colonnes décalés par le bouton ; `stubOffscreenLayout` et les attentes du scroller gardés, la table restant virtualisée)
- **À modifier** : `src/app/shared/components/icon.component.ts` (`chevron-down` du bouton ouvert)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.detail.*` : en-têtes, 17 libellés de champ, tags illisibles ; `tagging.list.showDetail`)
- **À modifier** : `docs/DESIGN.md` (§ Layout, tableau des colonnes de la liste du run : sept avec le bouton, ligne Tables ; jeu de sept colonnes aux § Structure de Page et Responsive ; mapping « Liste des morceaux d'un run » et « Détail avant / après » ; Arbitrages : lignes du détail, colonne Champ et détail d'un morceau)
- **À modifier** : `docs/knowledges/primeng.md` (§ Table défilante : `#expandedrow` incompatible avec le scroll virtuel, mesures ; § Détail déplié sous une ligne virtualisée)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : `TrackDetail` montre encore 12 lignes, `TPE2` et la date complète)

## Architecture approach

- **Détail déplié sous la ligne, scroll virtuel conservé** : la liste ne rend plus ses morceaux tels quels mais une liste dérivée en `computed` (`renderRows`), union discriminée de trois natures de ligne. Après chaque morceau ouvert, elle insère des lignes synthétiques de 56px, la hauteur de toutes les autres : la première, porteuse, contient le détail dans un cadre en `position: absolute` de leur hauteur cumulée ; les suivantes, vides et `aria-hidden`, restent sous lui. Le scroller de PrimeNG 22.1.2 place chaque ligne à `rang × virtualScrollItemSize` sans la mesurer : aucune ligne ne change de hauteur, la position reste exacte (`.claude/rules/primeng/composants.md`)
- **Porteuse toujours montée** : `virtualScrollOptions.numToleratedItems` vaut le plus grand nombre de lignes d'un détail plus un, le scroller rendant toujours au moins cette valeur moins un de lignes au-dessus de la première visible. Technique et pièges : [knowledges/primeng.md § Détail déplié sous une ligne virtualisée](../../../knowledges/primeng.md#détail-déplié-sous-une-ligne-virtualisée)
- **Hauteur du cadre par morceau** : `detailSpan`, exporté par le composant du détail qui connaît son contenu, donne 7 lignes pour les champs, 8 avec le bouton « Restaurer ce morceau », 4 pour un fichier aux tags illisibles, mesurées sur le plus haut contenu de chaque cas. Le détail s'étire sur cette hauteur, sa grille répartit l'espace entre ses lignes : aucune bande vide sous la dernière. Au-delà, il défile dans son cadre
- **Bouton d'ouverture** : en tête de ligne, `pButton` texte `small` `secondary` à icône seule, `chevron-right` fermé et `chevron-down` ouvert (`IconComponent`), `aria-label` traduit, `aria-expanded`, et un `stopPropagation` sur le clic, Entrée et Espace : le clic sur la ligne garde son rôle (arbitrage, puis lien, cf. DataTable `rowClickable`). Le même bouton referme, un autre ouvre un second détail. La ligne ouverte est surlignée (`bg-highlight`, le token de sélection de DESIGN.md § États des Composants)
- **État d'ouverture** : `linkedSignal` d'un ensemble de `trackId` sur la liste des morceaux, qui perd ceux qui la quittent (nouveau run) ; l'état ouvert est porté par l'entrée de ligne, jamais recherché dans le template (`.claude/rules/angular/signals.md`, `.claude/rules/angular/change-detection.md`)
- **Références stables** : lignes de la liste mémoïsées par objet morceau, entrées de rendu fermées mémoïsées par ligne, lignes synthétiques construites à la première ouverture seulement. Clés préfixées par leur nature (`track:`, `detail:`, `filler:`) : `rowTrackBy` et `dataKey` les lisent, un nom de fichier ne peut pas prendre la clé d'une ligne synthétique. Le détail suit les événements de son morceau, la porteuse portant sa ligne
- **Superposition** : le cadre n'a pas de `z-index`, il passe ainsi au-dessus des lignes vides et sous l'en-tête collant de la table
- **Composant du détail** `TrackDetailComponent`, `input.required<TaggingTrack>()` (`.claude/rules/angular/components.md`) :
  - pochette de 160px à gauche en trois états, comme la vignette de la liste : image en fondu, `p-skeleton` tant que le morceau attend son tour, cadre neutre à l'icône `image` en 24 dès qu'il est tranché sans pochette
  - grille de trois colonnes à droite, en-tête « Champ / Avant / Après » en `text-xs text-muted-color` filetée, lignes en `text-xs` : libellé traduit suivi de sa clé en couleur atténuée, Avant en `text-muted-color` (arbitrage « Gris de légende »), Après en couleur de texte, chaque valeur en `app-truncated-text` (tooltip large au survol d'un texte coupé)
  - les lignes reçues toujours, sauf l'identifiant à la source, plus Commentaire quand `tagsBefore.comment` existe, son Après toujours vide
  - disposition horizontale (`flex`, `gap-6`, `p-4`) sur fond `bg-surface-950`, filet bas `border-surface`, comme la cellule dépliée du `DataTable`
  - une seule grille pour toutes les lignes (subgrid), colonne Champ à la largeur de son plus long libellé suivi de sa clé
  - lignes construites dans un `computed` qui associe Avant et Après par `field`, l'ordre et les clés venant du sidecar : aucune table de champs côté TypeScript (CLAUDE.md, tout le métier dans le sidecar)
- **Valeur absente** : `app-no-value`, cadratin en `text-muted-color` (DESIGN.md § Sans valeur, `NoValue` de la maquette) ; jamais rien d'écrit dans le fichier
- **i18n** : `tagging.detail.*`, libellés à l'infinitif pour le bouton (« Afficher le détail »), mêmes clés dans les deux langues (`.claude/rules/ngx-translate/i18n.md`)
- **Tests** : `.claude/rules/angular/tests.md`

## Acceptance criteria

### Scénario 1 : déplier le détail d'un morceau résolu
**GIVEN** un morceau résolu dont les tags avant et après sont connus
**WHEN** l'utilisateur clique sur le bouton de sa ligne
**THEN** le détail se déplie sous la ligne, pleine largeur, et montre la pochette en 160px et 15 lignes dans l'ordre de la table, sans l'identifiant à la source, chacune avec son libellé, sa clé, sa valeur avant et sa valeur après
**AND** une valeur absente porte un cadratin, le bouton passe en chevron vers le bas, un second clic sur lui replie le détail et le bouton d'une autre ligne déplie un second détail sans refermer le premier

### Scénario 2 : bouton d'une ligne à arbitrer
**GIVEN** un morceau en attente d'arbitrage
**WHEN** l'utilisateur clique sur le bouton de sa ligne
**THEN** le détail se déplie et la modale d'arbitrage ne s'ouvre pas
**AND** un clic ailleurs sur la ligne ouvre toujours la modale

### Scénario 3 : commentaire
**GIVEN** un fichier qui porte un commentaire `Ripped by X`
**WHEN** son détail est déplié
**THEN** une seizième ligne Commentaire montre `Ripped by X` en Avant et un cadratin en Après

### Scénario 4 : non résolu et fichier illisible
**GIVEN** un morceau non résolu
**WHEN** son détail est déplié
**THEN** l'Après ne porte que des cadratins et la pochette est le cadre neutre
**AND** pour un fichier aux tags illisibles et non résolu, le détail dit que les tags n'ont pas pu être lus, sur 4 lignes de la liste

### Scénario 5 : gros run
**GIVEN** un run de 2 000 morceaux sous `ng serve`, un détail déplié
**WHEN** l'utilisateur fait défiler la liste dans les deux sens et que les événements du run arrivent
**THEN** le détail reste visible tant qu'une de ses lignes est à l'écran, sans ligne vide découverte, et passe sous l'en-tête collant
**AND** chaque événement se rend en moins de 50ms et seules les lignes visibles sont montées

## Tests à écrire

### Unit
- `src/app/features/tagging/track-detail.component.spec.ts` :
  - lignes dans l'ordre reçu, libellé, clé, avant et après
  - identifiant à la source absent de la grille
  - cadratin pour une valeur nulle
  - ligne Commentaire seulement quand le fichier en porte un, Après en cadratin
  - non résolu : Après en cadratins
  - tags illisibles à l'ouverture : lignes tirées de l'Après, Avant en cadratins
  - ni avant ni après : phrase des tags illisibles
- `src/app/features/tagging/run-list.component.spec.ts` :
  - le bouton déplie le détail sur une porteuse suivie de lignes vides `aria-hidden` et un second clic le replie, sans émettre `arbitrate`
  - le détail est dans la porteuse et toutes les lignes gardent la hauteur du scroller
  - le cadre couvre 7 lignes, 8 avec le bouton Restaurer, 4 pour des tags illisibles
  - le bouton d'une autre ligne déplie un second détail sans replier le premier
  - Entrée et Espace sur le bouton n'atteignent pas l'action de la ligne
  - le détail d'une ligne rattrapable se déplie sans émettre `recover`
  - le détail suit son morceau quand il est résolu
  - le détail se replie quand son morceau quitte la liste, et ne se redéplie pas s'il revient
  - le clic sur une ligne à arbitrer émet toujours `arbitrate`

## Edge cases

- **Valeur longue** (URL, titre à remixeurs multiples) : coupée par l'ellipse, tooltip large au survol
- **Plusieurs détails** : chacun sous sa ligne, la liste reste utilisable et défile normalement
- **Ligne porteuse au-dessus de la zone visible** : montée tant qu'une ligne du détail est à l'écran, démontée au-delà ; le détail réapparaît au retour, son morceau restant ouvert
- **Morceau qui change d'état pendant que son détail est déplié** (résolu en cours de run, rendu restaurable après l'écriture) : le détail suit, son cadre prend le nombre de lignes du nouveau contenu
- **Morceau déplié qui quitte la liste** (nouveau run) : le détail se replie
- **Run de 500 ou 2 000 morceaux** : couvert par le scroll virtuel, seules les lignes visibles et la marge du scroller sont montées

## Architectural decisions

### Décision : détail et scroll virtuel
**Options envisagées :**
- **A. Détail sous la ligne par `#expandedrow`, liste du run sans scroll virtuel** (livré puis abandonné au `/verify` du 2026-10-09, reprototypé le 2026-10-10)
- **B. Tiroir non modal à droite**, scroll virtuel gardé (livré le 2026-10-09)
- **C. Modale de détail** avec Précédent / Suivant, scroll virtuel gardé
- **D. Détail sous la ligne sur des lignes synthétiques de hauteur fixe**, scroll virtuel gardé
- **E. Virtualisation maison à hauteurs variables** (TanStack Virtual ou stratégie du CDK Angular), à la place du scroller de `p-table`

**Choix : D**

**Rationale :**
- Décision du propriétaire du 2026-10-10, sur la barre de 2 000 morceaux fluides, après prototypes mesurés par la même sonde sous `ng serve`. D : 34 ms de premier rendu et 27 ms par événement, aucun trou au défilement fin dans les deux sens. A, lignes mémoïsées et ligne en composant OnPush : encore 11,5 s de premier rendu et 118 ms par événement
- D rend la maquette, qui déplie la ligne et en ouvre plusieurs, là où B couvrait la droite de la table et n'en montrait qu'un
- D garde `p-table`, son style Aura et son scroll virtuel ; E aurait quitté `p-table` pour cette seule liste, sans gain mesurable sur D
- Une modale (C) interdit d'utiliser la liste pendant que le détail est ouvert

### Décision : hauteur du cadre
**Options envisagées :**
- **A. Fixe**, sur le plus haut détail
- **B. Par morceau**, sur le plus haut contenu de chaque cas, contenu étiré sur le cadre

**Choix : B**

**Rationale :**
- Choix du propriétaire du 2026-10-10 : un cadre fixe laissait une bande vide sous les détails sans bouton Restaurer
- Le contenu étiré comble le reste de la dernière ligne entamée

### Décision : lignes vides des deux côtés
**Options envisagées :**
- **A. Toujours les lignes reçues**
- **B. Masquer les lignes sans valeur ni avant ni après**

**Choix : A**

**Rationale :**
- Choix du propriétaire : la même grille pour chaque morceau, ce que la source ne fournit pas se voit aussi
- Seule exception, l'identifiant à la source : écrit dans le fichier, il ne dit rien à l'utilisateur (décidé au `/verify` du 2026-10-09)

### Décision : cellule sans valeur
**Options envisagées :**
- **A. Cadratin grisé**, par un composant partagé repris dans la liste
- **B. Cellule vide**

**Choix : A**

**Rationale :**
- Choix du propriétaire, comme la maquette et DESIGN.md § Sans valeur ; le composant remplace les trois cadratins écrits en dur dans la liste
