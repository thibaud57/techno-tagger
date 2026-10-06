---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "ligne-depliee-avant-apres"
goal: "Afficher sous une ligne de la liste du run la comparaison avant / après de ses tags, champ par champ, avec la pochette en grand"
status: "draft"
complexity: "L"
tdd_scope: "partial"
depends_on: ["07-contrat-detail-avant-apres-design.md"]
date: "2026-10-06"
---

# Ligne dépliée avant / après

## Scope

Couvre le chevron de dépliage en tête de la liste du run, la ligne dépliée de tout morceau (résolu, non résolu, en attente, à arbitrer), le composant du détail (pochette en grand, 16 lignes plus le commentaire, valeurs absentes), l'abandon du scroll virtuel sur cette seule liste et le composant partagé de la cellule sans valeur, repris par les trois cellules qui l'écrivent en dur. Met DESIGN.md et les notes de sync de la maquette à jour de ces choix.

Exclut le bouton de rollback d'un morceau dans la ligne dépliée (sub-project 11), les états d'écriture dans la colonne État (10) et le contenu des tags, tranché au sub-project 07.

### État livré

À la fin de ce sub-project, on peut : dans `just dev-ui`, déplier un morceau résolu par son chevron et voir sa pochette en grand et ses 16 champs avant / après avec leur clé, fidèles à `TrackDetail` aux écarts près consignés, sans que le clic sur une ligne à arbitrer change de rôle ; et lancer `just test` sur les specs du détail et de la liste.

## Dependencies

- `07-contrat-detail-avant-apres-design.md` (statut: draft) : `TaggingTrack.tagsBefore` (`system`, `comment`, 16 `TagValue` dans l'ordre de la table) et `tagsAfter`, clés du fichier écrit, valeur gardée en Après

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, `TrackDetail` (grille Champ / Avant / Après, pochette de 160px) et `Artwork` (trois états) ; colonne de chevron du `DataTable` expandable employé par `runColumns`
- **Design system** : `components/data/DataTable` (lignes dépliables, `rowClickable`), `components/data/Skeleton`, `components/overlay/Tooltip`, `components/overlay/TruncatedText`
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/shared/components/no-value.component.ts` (`app-no-value`, cadratin en `text-muted-color`)
- **À créer** : `src/app/features/tagging/track-detail.component.ts` et `.html` (`TrackDetailComponent`)
- **À créer** : `src/app/features/tagging/track-detail.component.spec.ts`
- **À modifier** : `src/app/features/tagging/run-list.component.ts` et `.html` (colonne de chevron, `#expandedrow`, plus de `[virtualScroll]`, `rowTrackBy` sur `trackId`, `colspan` à 7, trois cadratins remplacés par `app-no-value`)
- **À modifier** : `src/app/features/tagging/run-list.component.spec.ts` (dépliage sans arbitrage, indices de colonnes décalés par le chevron ; `stubOffscreenLayout` et les attentes du scroller retirés, la table n'étant plus virtualisée : les 15 cas existants passent sans eux, essayé le 2026-10-06)
- **À modifier** : `src/app/shared/components/icon.component.ts` (icône `chevron-down`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.detail.*` : en-têtes, 17 libellés de champ, tags illisibles ; `tagging.list.expand` / `tagging.list.collapse`)
- **À modifier** : `docs/DESIGN.md` (§ Layout, ligne Tables : la liste du run n'est pas virtualisée, et tableau de ses colonnes : sept avec le chevron ; jeu de sept colonnes aux § Structure de Page et Responsive ; mapping « Liste des morceaux d'un run » et « Détail avant / après » : chevron et composant ; Arbitrages : lignes du détail)
- **À modifier** : `docs/knowledges/primeng.md` (§ Table défilante : `#expandedrow` incompatible avec le scroll virtuel)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : `TrackDetail` montre encore 12 lignes, `TPE2` et la date complète)

## Architecture approach

- **Dépliage par chevron** : colonne mesurée sur le bouton du chevron en tête, `pButton` texte à icône (`chevron-right` / `chevron-down` par `IconComponent`) portant un `aria-label` traduit, `aria-expanded`, et un `stopPropagation` : le clic sur la ligne garde son rôle (arbitrage, puis lien, cf. DataTable `rowClickable`). État tenu par `p-table` via `pRowToggler` et `dataKey="trackId"`, plusieurs lignes ouvertes à la fois comme la maquette (`.claude/rules/primeng/composants.md`)
- **Plus de scroll virtuel sur la liste du run** : le scroller de PrimeNG 22.1.2 place chaque ligne à `rang × virtualScrollItemSize` et dimensionne son espaceur sur le même produit, sans mesure, et `autoSize` ne règle que le conteneur. Une ligne dépliée d'environ 200px y décale tout et fait sauter la liste quand elle sort de la zone rendue (lu dans `primeng-scroller.mjs`, 2026-10-06). `rowTrackBy` sur `trackId` : un événement ne refait que la ligne qu'il touche. Le rapport d'extraction, qui compte des milliers de lignes, garde le sien
- **Composant du détail** `TrackDetailComponent`, `input.required<TaggingTrack>()` (`.claude/rules/angular/components.md`) :
  - pochette de 160px en trois états, comme la vignette de la liste : image en fondu, `p-skeleton` tant que le morceau attend son tour, cadre neutre à l'icône `image` en 24 dès qu'il est tranché sans pochette
  - grille de trois colonnes, en-tête « Champ / Avant / Après » en `text-xs text-muted-color` filetée, lignes en `text-xs` : libellé traduit suivi de la clé en `text-muted-color`, Avant en `text-muted-color` (arbitrage « Gris de légende »), Après en couleur de texte, chaque valeur en `app-truncated-text` (tooltip large au survol d'un texte coupé)
  - les 16 lignes toujours, plus Commentaire quand `tagsBefore.comment` existe, son Après toujours vide
  - lignes construites dans un `computed` qui associe Avant et Après par `field`, l'ordre et les clés venant du sidecar : aucune table de champs côté TypeScript (CLAUDE.md, tout le métier dans le sidecar)
- **Valeur absente** : `app-no-value`, cadratin en `text-muted-color` (DESIGN.md § Sans valeur, `NoValue` de la maquette) ; jamais rien d'écrit dans le fichier
- **Ligne dépliée** : cellule `colspan` sur les 7 colonnes, fond `bg-surface-950`, filet du bas, `p-4` et `gap-6` entre pochette et grille (`.claude/rules/tailwindcss/echelles.md`, `.claude/rules/tailwindcss/utilitaires.md`)
- **i18n** : `tagging.detail.*`, libellés à l'infinitif pour le chevron, mêmes clés dans les deux langues (`.claude/rules/ngx-translate/i18n.md`)
- **Tests** : `.claude/rules/angular/tests.md`

## Acceptance criteria

### Scénario 1 : déplier un morceau résolu
**GIVEN** un morceau résolu dont les tags avant et après sont connus
**WHEN** l'utilisateur clique sur son chevron
**THEN** la ligne dépliée montre la pochette en 160px et 16 lignes dans l'ordre de la table, chacune avec son libellé, sa clé, sa valeur avant et sa valeur après
**AND** une valeur absente porte un cadratin, et un second clic replie la ligne

### Scénario 2 : chevron d'une ligne à arbitrer
**GIVEN** un morceau en attente d'arbitrage
**WHEN** l'utilisateur clique sur son chevron
**THEN** le détail se déplie et la modale d'arbitrage ne s'ouvre pas
**AND** un clic ailleurs sur la ligne ouvre toujours la modale

### Scénario 3 : commentaire
**GIVEN** un fichier qui porte un commentaire `Ripped by X`
**WHEN** son détail est déplié
**THEN** une dix-septième ligne Commentaire montre `Ripped by X` en Avant et un cadratin en Après

### Scénario 4 : non résolu et fichier illisible
**GIVEN** un morceau non résolu
**WHEN** son détail est déplié
**THEN** l'Après ne porte que des cadratins et la pochette est le cadre neutre
**AND** pour un fichier aux tags illisibles et non résolu, le détail dit que les tags n'ont pas pu être lus

## Tests à écrire

### Unit
- `src/app/features/tagging/track-detail.component.spec.ts` :
  - 16 lignes dans l'ordre reçu, libellé, clé, avant et après
  - cadratin pour une valeur nulle
  - ligne Commentaire seulement quand le fichier en porte un, Après en cadratin
  - non résolu : Après en cadratins
  - tags illisibles à l'ouverture : lignes tirées de l'Après, Avant en cadratins
  - ni avant ni après : phrase des tags illisibles
- `src/app/features/tagging/run-list.component.spec.ts` :
  - le chevron déplie puis replie le détail sans émettre `arbitrate` ni `recover`
  - le clic sur une ligne à arbitrer émet toujours `arbitrate`

## Edge cases

- **Valeur longue** (URL, titre à remixeurs multiples) : coupée par l'ellipse, tooltip large au survol
- **Plusieurs lignes ouvertes** : chacune garde son détail, la liste défile normalement
- **Morceau qui change d'état pendant qu'il est déplié** (résolu en cours de run) : le détail suit, la ligne reste ouverte
- **Run de 500 morceaux** : toutes les lignes sont montées ; défilement et arrivée des événements à vérifier au `/verify`, repli sur un panneau sous la table si la liste rame

## Architectural decisions

### Décision : détail et scroll virtuel
**Options envisagées :**
- **A. Détail sous la ligne, liste du run sans scroll virtuel**
- **B. Panneau fixe sous la table**, scroll virtuel gardé
- **C. Modale de détail** avec Précédent / Suivant, scroll virtuel gardé
**Choix : A**
**Rationale :**
- Choix du propriétaire : fidèle à `TrackDetail` et à la ligne « Détail avant / après » de DESIGN.md
- Le scroller de PrimeNG ne connaît qu'une hauteur de ligne ; un scroll virtuel à hauteur variable demanderait une dépendance expérimentale (CDK) à la place de celui de `p-table`
- Un run compte quelques centaines de morceaux, là où le scroll virtuel sert les milliers de lignes du rapport d'extraction

### Décision : lignes vides des deux côtés
**Options envisagées :**
- **A. Toujours les 16 lignes**
- **B. Masquer les lignes sans valeur ni avant ni après**
**Choix : A**
**Rationale :**
- Choix du propriétaire : la même grille pour chaque morceau, ce que la source ne fournit pas se voit aussi

### Décision : cellule sans valeur
**Options envisagées :**
- **A. Cadratin grisé**, par un composant partagé repris dans la liste
- **B. Cellule vide**
**Choix : A**
**Rationale :**
- Choix du propriétaire, comme la maquette et DESIGN.md § Sans valeur ; le composant remplace les trois cadratins écrits en dur dans la liste
