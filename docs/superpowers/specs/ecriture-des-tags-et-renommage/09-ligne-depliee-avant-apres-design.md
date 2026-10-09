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

Couvre le bouton d'ouverture du détail en tête de la liste du run, le tiroir non modal qui affiche le détail de tout morceau (résolu, non résolu, en attente, à arbitrer), le composant du détail (pochette en grand, 15 lignes plus le commentaire, valeurs absentes), le scroll virtuel de la liste, conservé, et le composant partagé de la cellule sans valeur, repris par les trois cellules qui l'écrivent en dur. Met DESIGN.md et les notes de sync de la maquette à jour de ces choix.

Exclut le bouton de rollback d'un morceau dans le tiroir (sub-project 11), les états d'écriture dans la colonne État (10) et le contenu des tags, tranché au sub-project 07.

### État livré

À la fin de ce sub-project, on peut : dans `just dev-ui`, ouvrir le détail d'un morceau résolu par le bouton de sa ligne et voir, dans un tiroir à droite, sa pochette en grand et ses 15 champs avant / après avec leur clé, fidèles à `TrackDetail` aux écarts près consignés, sans que le clic sur une ligne à arbitrer change de rôle, et faire défiler un run de 2 000 morceaux sans à-coup ; et lancer `just test` sur les specs du détail et de la liste.

## Dependencies

- `07-contrat-detail-avant-apres-design.md` (statut: draft) : `TaggingTrack.tagsBefore` (`system`, `comment`, 16 `TagValue` dans l'ordre de la table) et `tagsAfter`, clés du fichier écrit, valeur gardée en Après

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, `TrackDetail` (grille Champ / Avant / Après, pochette de 160px) et `Artwork` (trois états) ; colonne de chevron du `DataTable` expandable employé par `runColumns`
- **Design system** : `components/data/DataTable` (lignes dépliables, `rowClickable`), `components/data/Skeleton`, `components/overlay/Tooltip`, `components/overlay/TruncatedText`
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/shared/components/no-value.component.ts` (`app-no-value`, cadratin en `text-muted-color`)
- **À créer** : `src/app/shared/components/artwork.component.ts` (`app-artwork`, pochette en trois états, en 32 et en 160px, partagée par la liste et le détail)
- **À créer** : `src/app/features/tagging/track-detail.component.ts` et `.html` (`TrackDetailComponent`)
- **À créer** : `src/app/features/tagging/track-detail.component.spec.ts`
- **À modifier** : `src/app/features/tagging/run-list.component.ts` et `.html` (colonne du bouton d'ouverture, `p-drawer` non modal, `[virtualScroll]` gardé, `rowTrackBy` sur `trackId`, `colspan` à 7, trois cadratins remplacés par `app-no-value`)
- **À modifier** : `src/app/features/tagging/run-list.component.spec.ts` (tiroir ouvert, remplacé et fermé sans arbitrage, indices de colonnes décalés par le bouton ; `stubOffscreenLayout` et les attentes du scroller gardés, la table restant virtualisée)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.detail.*` : en-têtes, 17 libellés de champ, tags illisibles ; `tagging.list.showDetail`, `tagging.detail.close`)
- **À modifier** : `docs/DESIGN.md` (§ Layout, tableau des colonnes de la liste du run : sept avec le bouton ; jeu de sept colonnes aux § Structure de Page et Responsive ; mapping « Liste des morceaux d'un run » et « Détail avant / après » : bouton et tiroir ; Arbitrages : lignes du détail et détail d'un morceau)
- **À modifier** : `docs/knowledges/primeng.md` (§ Table défilante : `#expandedrow` incompatible avec le scroll virtuel, mesures du 2026-10-09 ; § Tiroir non modal : API `Drawer` 22.1.2)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : `TrackDetail` montre encore 12 lignes, `TPE2` et la date complète)

## Architecture approach

- **Détail dans un tiroir non modal** : bouton en tête de ligne, `pButton` texte `small` `secondary` à icône `chevron-right` (`IconComponent`) portant un `aria-label` traduit, `aria-pressed` vrai sur la ligne affichée et un `stopPropagation` : le clic sur la ligne garde son rôle (arbitrage, puis lien, cf. DataTable `rowClickable`). Le tiroir est un `p-drawer` `[modal]="false"`, `position="right"`, `appendTo="body"` (son z-index se compare alors à celui des modales du shell, ouvertes après lui donc au-dessus), 560px de large : la grille Champ / Avant / Après y reste lisible. En-tête = la ligne du morceau (`afterLine ?? mainLine`), fermeture par la croix ou Échap. Un seul morceau à la fois : un autre bouton remplace le détail, le même le ferme, et la ligne affichée est surlignée (`bg-highlight`, le token de sélection de DESIGN.md § États des Composants). État en `signal` dans `RunListComponent` (`trackId` affiché, remis à `null` par `linkedSignal` quand le morceau quitte la liste), morceau affiché en `computed` sur les lignes : il suit les événements (`.claude/rules/angular/signals.md`, `.claude/rules/primeng/composants.md`)
- **Scroll virtuel conservé sur la liste du run** : `[virtualScroll]` et `[virtualScrollItemSize]` sur la hauteur du `<tr>`, comme avant ce sub-project. Une ligne dépliée de hauteur variable y est incompatible (le scroller de PrimeNG 22.1.2 place chaque ligne à `rang × virtualScrollItemSize`, sans mesure, lu dans `primeng-scroller.mjs` le 2026-10-06), d'où le tiroir. `rowTrackBy` sur `trackId` : un événement ne refait que la ligne qu'il touche
- **Composant du détail** `TrackDetailComponent`, `input.required<TaggingTrack>()` (`.claude/rules/angular/components.md`) :
  - pochette de 160px en trois états, comme la vignette de la liste : image en fondu, `p-skeleton` tant que le morceau attend son tour, cadre neutre à l'icône `image` en 24 dès qu'il est tranché sans pochette
  - grille de trois colonnes, en-tête « Champ / Avant / Après » en `text-xs text-muted-color` filetée, lignes en `text-xs` : libellé traduit suivi de la clé en `text-muted-color`, Avant en `text-muted-color` (arbitrage « Gris de légende »), Après en couleur de texte, chaque valeur en `app-truncated-text` (tooltip large au survol d'un texte coupé)
  - les lignes reçues toujours, sauf l'identifiant à la source, plus Commentaire quand `tagsBefore.comment` existe, son Après toujours vide
  - disposition verticale (`flex-col`, `gap-6`) : pochette de 160px en haut, grille pleine largeur dessous ; le remplissage vient du tiroir
  - une seule grille pour toutes les lignes (subgrid), colonne Champ à la largeur de son plus long libellé, clé du tag sous le libellé
  - lignes construites dans un `computed` qui associe Avant et Après par `field`, l'ordre et les clés venant du sidecar : aucune table de champs côté TypeScript (CLAUDE.md, tout le métier dans le sidecar)
- **Valeur absente** : `app-no-value`, cadratin en `text-muted-color` (DESIGN.md § Sans valeur, `NoValue` de la maquette) ; jamais rien d'écrit dans le fichier
- **i18n** : `tagging.detail.*`, libellés à l'infinitif pour le bouton (« Afficher le détail »), mêmes clés dans les deux langues (`.claude/rules/ngx-translate/i18n.md`)
- **Tests** : `.claude/rules/angular/tests.md`

## Acceptance criteria

### Scénario 1 : afficher le détail d'un morceau résolu
**GIVEN** un morceau résolu dont les tags avant et après sont connus
**WHEN** l'utilisateur clique sur le bouton de sa ligne
**THEN** le tiroir s'ouvre à droite avec la ligne du morceau en en-tête et montre la pochette en 160px et 15 lignes dans l'ordre de la table, sans l'identifiant à la source, chacune avec son libellé, sa clé, sa valeur avant et sa valeur après
**AND** une valeur absente porte un cadratin, un second clic sur le même bouton ferme le tiroir et le bouton d'une autre ligne remplace le détail affiché

### Scénario 2 : bouton d'une ligne à arbitrer
**GIVEN** un morceau en attente d'arbitrage
**WHEN** l'utilisateur clique sur le bouton de sa ligne
**THEN** le détail s'affiche dans le tiroir et la modale d'arbitrage ne s'ouvre pas
**AND** un clic ailleurs sur la ligne ouvre toujours la modale

### Scénario 3 : commentaire
**GIVEN** un fichier qui porte un commentaire `Ripped by X`
**WHEN** son détail est affiché
**THEN** une dix-septième ligne Commentaire montre `Ripped by X` en Avant et un cadratin en Après

### Scénario 4 : non résolu et fichier illisible
**GIVEN** un morceau non résolu
**WHEN** son détail est affiché
**THEN** l'Après ne porte que des cadratins et la pochette est le cadre neutre
**AND** pour un fichier aux tags illisibles et non résolu, le détail dit que les tags n'ont pas pu être lus

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
  - le bouton affiche le détail dans le tiroir et un second clic le ferme, sans émettre `arbitrate`
  - le bouton d'une autre ligne remplace le détail affiché
  - Entrée et Espace sur le bouton n'atteignent pas l'action de la ligne
  - le détail d'une ligne rattrapable s'affiche sans émettre `recover`
  - le détail suit son morceau quand il est résolu
  - le tiroir se ferme quand le morceau affiché quitte la liste, et ne se rouvre pas s'il revient
  - le clic sur une ligne à arbitrer émet toujours `arbitrate`

## Edge cases

- **Valeur longue** (URL, titre à remixeurs multiples) : coupée par l'ellipse, tooltip large au survol
- **Un seul tiroir** : un autre bouton remplace le détail affiché, la liste reste utilisable et défile normalement
- **Modale d'arbitrage ouverte avec le tiroir** : la modale passe au-dessus (z-index partagé, la plus récente au sommet)
- **Morceau qui change d'état pendant que son détail est affiché** (résolu en cours de run) : le détail suit, le tiroir reste ouvert
- **Morceau affiché qui quitte la liste** (nouveau run) : le tiroir se ferme
- **Run de 500 ou 2 000 morceaux** : couvert par le scroll virtuel, seules les lignes visibles sont montées

## Architectural decisions

### Décision : détail et scroll virtuel
**Options envisagées :**
- **A. Détail sous la ligne, liste du run sans scroll virtuel** (livré puis abandonné au `/verify`)
- **B. Tiroir non modal à droite**, scroll virtuel gardé
- **C. Modale de détail** avec Précédent / Suivant, scroll virtuel gardé
**Choix : B**
**Rationale :**
- Décision du propriétaire du 2026-10-09, après le stress test du `/verify` sous `ng serve` : A a été livré puis abandonné. Avec 500 morceaux, 1 à 3 s de premier rendu et 43 à 78 ms par événement ; avec 2 000 morceaux, 16 s de premier rendu bloquant, 214 ms par événement et jusqu'à 320 ms par saut de défilement
- Le scroller de PrimeNG ne connaît qu'une hauteur de ligne ; un scroll virtuel à hauteur variable demanderait une dépendance expérimentale (CDK) à la place de celui de `p-table`
- Un tiroir non modal laisse la liste utilisable pendant que le détail est ouvert, ce qu'une modale (C) interdit, et ne modifie aucune hauteur de ligne
- Écart consigné à la maquette, qui déplie la ligne : DESIGN.md § Arbitrages, « Détail d'un morceau »

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
