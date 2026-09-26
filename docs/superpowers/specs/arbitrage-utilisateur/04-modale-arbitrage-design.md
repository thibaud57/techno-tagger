---
feature: "Feature 3 : Arbitrage utilisateur"
subproject: "modale-arbitrage"
goal: "Afficher la modale qui laisse choisir un candidat en zone grise, refuser pour basculer sur Bandcamp, revenir à Beatport et parcourir la file au clavier"
status: "draft"
complexity: "L"
tdd_scope: "partial"
depends_on: ["03-service-arbitrage-ui-design.md"]
date: "2026-09-26"
---

# Modale d'arbitrage

## Scope

Couvre la modale d'arbitrage montée dans le shell et visible depuis tous les onglets : en-tête du morceau, liste des candidats avec score et ligne label · année, message de bascule et lien de retour à Beatport, message quand Beatport était injoignable, liste Bandcamp vide et son action « Passer », erreur inline, attente pendant un geste, navigation et compteur, clavier. Couvre aussi sa visibilité (ouverture automatique, croix qui ne décide rien, réouverture par le badge de file de la barre d'onglets) et les docs de design qui en découlent.

Exclut la confirmation à la fermeture de l'application (sub-project 05) et toute règle de file, portée par le sub-project 03.

### État livré

À la fin de ce sub-project, on peut : lancer `tauri dev` sur un dossier de test, voir la modale s'ouvrir sur le premier morceau en zone grise, choisir un candidat, refuser Beatport puis y revenir, fermer par la croix et rouvrir par le badge, parcourir la file au clavier, et voir la ligne du run passer en « Arbitré » ; et lancer `pnpm exec ng test --watch=false` pour voir passer les règles portées par la modale et par le shell.

## Dependencies

- `03-service-arbitrage-ui-design.md` (statut: draft) : `SidecarService.arbitrations`, `currentArbitration`, `arbitrationPosition`, `arbitrationCount`, `arbitrationBusy`, `hasPreviousArbitration`, `hasNextArbitration`, `errorFor(...)`, `chooseCandidate`, `refuseCandidates`, `showArbitrationSource`, `previousArbitration`, `nextArbitration`, et `taggingTracks` pour l'identité lue du morceau.

## Références de design

- **Maquette** : `ArbitrationDialog` (la modale entière), `AppShell` (montage de la modale hors onglet, tag « N à arbitrer » de la barre d'onglets), `TaggingScreen` (puce « À arbitrer » de la ligne), dans `.design-sync/design-system/ui_kits/techno-tagger/`
- **Design system** : fiches `components/overlay/Dialog`, `components/forms/Listbox`, `components/forms/Button`, `components/feedback/Badge`, `components/feedback/Message`, `components/icons/SourceLogo`, `components/feedback/Tag`, `components/navigation/Tabs`, `components/feedback/StateTag`, sous `.design-sync/design-system/`
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/features/tagging/arbitration-dialog.component.ts`
- **À créer** : `src/app/features/tagging/arbitration-dialog.component.html`
- **À créer** : `src/app/features/tagging/arbitration-dialog.component.spec.ts`
- **À modifier** : `src/app/app.component.ts` (visibilité de la modale, badge de file)
- **À modifier** : `src/app/app.component.html` (montage de la modale, badge dans la barre d'onglets)
- **À créer** : `src/app/app.component.spec.ts`
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (bloc `arbitration.*`)
- **À modifier** : `docs/DESIGN.md` (§ Mapping Composants > Arbitrage ; § Maquette et design system externes > Arbitrages)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : ce que le code livre et que la maquette n'a pas encore)

## Architecture approach

- **`ArbitrationDialogComponent`** (`features/tagging/`, `.claude/rules/angular/components.md`) : lit `SidecarService` et ne connaît aucun store. Il reçoit `visible` en `input()` et émet `dismissed` en `output()` : sa visibilité appartient au shell. Aucune logique métier : ordre, scores et source affichée viennent du sidecar.
- **Cadre** (DESIGN.md § Mapping Composants > Arbitrage, § Layout) : `p-dialog` modal aux dimensions figées de DESIGN.md (720 × 560, zone de liste 268), ni déplaçable ni redimensionnable, sans animation d'entrée (§ Composants Animés, fiche Dialog). La croix et Échap émettent `dismissed` et ne décident rien.
- **En-tête** : « Artiste - Titre » lus sur le fichier, pris dans la ligne du run de même `track_id`, en H3 `text-lg font-semibold` ; le nom du fichier en `text-xs text-muted-color` dessous ; à droite le `SourceLogoComponent` de la source affichée. Tiret simple (arbitrage « Séparateur artiste / titre »). Tags vides : le nom du fichier seul.
- **Corps selon l'état reçu** :
  - Beatport affiché : « N candidats en zone grise », `text-xs text-muted-color`, sans les seuils (décision du 2026-09-26) ;
  - Bandcamp affiché avec `other_source` à `beatport` : `p-message` info annonçant le refus des candidats Beatport et leur remplacement ici même, suivi du lien « Revenir à Beatport » (`showArbitrationSource`) ;
  - Bandcamp affiché avec `beatport_unavailable` : `p-message` warn « Beatport ne répond pas : ces candidats viennent de Bandcamp et aucun n'a été validé seul » ;
  - liste vide : message de liste selon `empty_reason` (`no_result`, `below_threshold`, `source_unavailable`) ; le bouton de refus devient « Passer » et « Valider » reste grisé ;
  - erreur d'un geste sur ce morceau (`errorFor("resolve_arbitration", "switch_arbitration_source")` dont `params.track_id` est le morceau affiché) : `p-message` error sous la liste, traduit depuis `errors.<code>`.
- **Candidats** (`p-listbox`, fiche Listbox) : sélection simple, hauteur fixe à scroll interne. Par ligne : « Artiste - Titre » du candidat en `text-sm` ; « Label · Année » en `text-xs text-muted-color`, omis quand les deux sont nuls ; à droite le score sur une ligne « 94 (A 96 · T 92) » en `text-xs tabular-nums`, format de DESIGN.md § Séparateurs, « A » omis quand le score artiste est nul, par deux phrases à paramètres (`arbitration.score`, `arbitration.scoreTitleOnly`) : assemblé dans le template, le score garderait une espace parasite après la parenthèse ; infobulle portant le libellé complet (`.claude/rules/primeng/composants.md`).
- **Pied** : bouton précédent (icône `chevron-left`), `p-badge` « position/total » (`tabular-nums`, taille par défaut face à des boutons `small`, fiche Badge), bouton suivant (`chevron-right`), puis « Aucune correspondance » (`outlined`, `secondary`) et « Valider » (primary, grisé sans sélection). Boutons `small`, icônes par `IconComponent` (arbitrage « Icônes »), libellés d'accessibilité traduits sur les flèches.
- **Attente** : tant que `arbitrationBusy` est vrai, toutes les actions sont grisées et le bouton du dernier geste porte `[loading]`. La liste reste en place : rien ne se déplace (fiche Dialog).
- **Clavier** (DESIGN.md § Conventions de Code, `.claude/rules/primeng/composants.md`) : ← et → changent d'arbitrage, ↑ et ↓ parcourent la liste, Entrée valide le candidat sélectionné. Focus visible en permanence, rendu à la liste à chaque changement d'arbitrage. La sélection est un `linkedSignal` sur le couple morceau et source affichée, remise à zéro quand l'un change (`.claude/rules/angular/signals.md`).
- **Visibilité** (shell, décision du 2026-09-26) : `AppComponent` tient un `linkedSignal` « suspendu » dont la source est « file vide » : il repasse à faux chaque fois que la file se vide ou se remplit. `visible = arbitrationCount > 0 && !suspendu`. `dismissed` suspend, le badge relance. La modale s'ouvre donc seule au premier arbitrage, reste fermée après une croix même si d'autres arrivent, et se rouvre seule au run suivant ou après une file vidée.
- **Montage** : dans `app.component.html`, dans la branche non bloquée, hors du `router-outlet` : la modale suit l'utilisateur sur tous les onglets (maquette `AppShell`).
- **Badge de file** : un bouton portant un `p-tag` info, icône `info-circle`, « N à arbitrer », famille « Décision attendue » de DESIGN.md § Couleurs Sémantiques. Présent quand la file n'est pas vide, aligné à droite de la barre d'onglets ; son clic rouvre la modale.
- **i18n** (`.claude/rules/ngx-translate/i18n.md`) : bloc `arbitration.*` dans les deux langues, même commit, vouvoiement et libellés d'action à l'infinitif. Aucun libellé en dur, largeurs mesurées sur le libellé le plus long en FR et en EN (arbitrage « Largeurs »).
- **Tokens et classes** (`.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/primeng/theming.md`) : aucune couleur en dur, aucun `::ng-deep`, personnalisation par `[pt]` ou `[dt]`.

## Acceptance criteria

### Scénario 1 : Ouverture automatique
**GIVEN** un run en cours, file vide, onglet Playlist ouvert
**WHEN** le premier `arbitration_required` arrive
**THEN** la modale s'ouvre sur ce morceau, « 1/1 » au compteur
**AND** le badge « 1 à arbitrer » apparaît dans la barre d'onglets

### Scénario 2 : Choix
**GIVEN** la modale ouverte sur une liste Beatport de deux candidats
**WHEN** l'utilisateur sélectionne le second et valide
**THEN** `chooseCandidate` part avec `beatport` et l'index 1, les actions se grisent jusqu'à la réponse
**AND** à `track_resolved`, l'arbitrage suivant s'affiche et la ligne du run passe en « Arbitré »

### Scénario 3 : Refus et retour
**GIVEN** la modale ouverte sur une liste Beatport
**WHEN** l'utilisateur clique « Aucune correspondance », puis « Revenir à Beatport » une fois la liste Bandcamp affichée
**THEN** la liste Bandcamp remplace celle de Beatport à la même place, avec le message de bascule
**AND** le retour réaffiche la liste Beatport, sans que ni la modale ni ses boutons ne bougent

### Scénario 4 : Bandcamp vide
**GIVEN** un refus de Beatport dont Bandcamp ne rend rien
**WHEN** la liste Bandcamp s'affiche
**THEN** elle porte le message de son motif, « Valider » est grisé et le bouton de refus s'intitule « Passer »
**AND** « Passer » met le morceau en non résolu et affiche l'arbitrage suivant

### Scénario 5 : Beatport injoignable
**GIVEN** un morceau en attente sur Bandcamp avec `beatport_unavailable`
**WHEN** son arbitrage s'affiche
**THEN** le message warn annonce que Beatport n'a pas répondu, sans lien de retour

### Scénario 6 : Croix et réouverture
**GIVEN** la modale ouverte sur une file de deux arbitrages
**WHEN** l'utilisateur la ferme par la croix, qu'un troisième arbitrage arrive, puis qu'il clique le badge
**THEN** la modale reste fermée à l'arrivée du troisième, sans aucun geste envoyé
**AND** le badge la rouvre, « 3 à arbitrer », sur l'arbitrage qui était affiché

### Scénario 7 : Clavier
**GIVEN** la modale ouverte sur le premier de trois arbitrages
**WHEN** l'utilisateur presse →, descend dans la liste par ↓ et presse Entrée
**THEN** le deuxième arbitrage s'affiche et son candidat sélectionné est validé

## Tests à écrire

### Unit
- `src/app/features/tagging/arbitration-dialog.component.spec.ts` :
  - shows the candidates of the current arbitration with their score and their label and year
  - omits the label line of a candidate that has none
  - falls back on the track id without a run row
  - replaces the Beatport list by the Bandcamp list and offers to go back
  - warns when the candidates come from Bandcamp because Beatport did not answer
  - offers a single pass action on an empty Bandcamp list with its reason
  - validates only a selected candidate, with its source and its index
  - refuses the shown list with its source
  - disables every action while a gesture awaits its answer
  - changes arbitration with the left and right arrows and validates with Enter
  - ignores Enter pressed on a button
  - resets the selection when the current arbitration changes
  - shows only the error of the current track
  - dismisses by the cross without any gesture
- `src/app/app.component.spec.ts` :
  - opens the arbitration dialog as soon as the queue fills
  - keeps it closed after the cross until the queue badge is clicked
  - opens it again once the queue has emptied and filled again
  - hides the queue badge on an empty queue

`SidecarService` est stubé par signals, comme dans `tagging-page.component.spec.ts`. Aucun test ne vérifie PrimeNG ni Angular : chaque cas échoue contre une régression de nos règles d'affichage, d'attente ou de visibilité. La fidélité à la maquette se contrôle à `/implement-subproject`.

## Edge cases

- **Morceau absent des lignes du run** (contrat désynchronisé) : en-tête réduit au `track_id`, la modale reste utilisable.
- **Candidat à score artiste nul** (requête sans artiste) : score « 92 (T 92) ».
- **Arbitrage courant retiré pendant l'attente** (`arbitration_not_pending`) : la modale passe au suivant, ou se ferme si la file se vide.
- **Erreur d'un geste sur un autre morceau** : non affichée sur l'arbitrage courant.
- **Navigation pendant l'attente d'un morceau** : permise, l'attente reste attachée à son morceau.
- **Fenêtre au plancher (1024 × 700)** : la modale de 720 × 560 tient sans défiler (DESIGN.md § Layout).

## Architectural decisions

### Décision : Réouverture après la croix

**Options envisagées :**
- **A. Par le badge seulement** : la croix suspend l'ouverture automatique jusqu'au clic sur le badge, ou jusqu'à ce que la file se vide.
- **B. À chaque nouvel arbitrage** : lettre de la feature, la modale revient dès qu'un arbitrage arrive et qu'aucune n'est ouverte.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- L'utilisateur qui ferme pour regarder la liste du run n'est pas réinterrompu à chaque zone grise d'un run de centaines de morceaux.
- La maquette retirait l'arbitrage de la file à la croix, contre la feature : la file est gardée, et le badge devient le chemin de retour.

### Décision : Où vit la visibilité de la modale

**Options envisagées :**
- **A. Dans le shell** : `AppComponent` tient l'état « suspendu », passe `visible` à la modale et porte le badge.
- **B. Dans l'`ArbitrationStore`**, exposé par `SidecarService` : état global, mais présentation mêlée à la file du protocole et sub-project 03 à retoucher.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- C'est un état d'écran partagé par deux éléments du shell, qui n'est jamais détruit.

### Décision : Ce que montre un candidat

**Options envisagées :**
- **A. Comme la maquette** : titre seul, score « A · T ».
- **B. Artiste et titre du candidat, score sur une ligne** « 94 (A 96 · T 92) ».

**Choix : B**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- C'est souvent l'artiste qui fait tomber un candidat en zone grise : le masquer rend le score A illisible.
- DESIGN.md § Séparateurs fixe le format sur une ligne ; il prime sur la maquette quand les deux se contredisent (`.claude/rules/design/claude-design.md`).

### Décision : Ligne d'aide au-dessus de la liste Beatport

**Options envisagées :**
- **A. Sans les seuils** : « N candidats en zone grise ».
- **B. Seuils portés par le contrat** : retouche des sub-projects 02 et 03.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- L'interface n'invente aucune valeur métier ; les seuils y reviendront avec les Réglages (Feature 7), qui les enverront.
