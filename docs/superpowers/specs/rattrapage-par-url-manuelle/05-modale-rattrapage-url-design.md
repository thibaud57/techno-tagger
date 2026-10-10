---
feature: "Feature 4 — Rattrapage par URL manuelle"
subproject: "modale-rattrapage-url"
goal: "Permettre de coller le lien d'un morceau sans correspondance dans une modale ouverte par sa ligne du run, par le badge « N à rattraper » ou par l'étape lien de l'arbitrage, et suivre la phase de rattrapage dans la barre du run"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["04-service-rattrapage-ui-design.md"]
date: "2026-10-03"
---

# Modale du lien de rattrapage par URL

## Scope

Couvre la modale du lien (un morceau à la fois, navigation entre les morceaux rattrapables), son état d'interface partagé (`RecoveryUiStore`), le champ de lien commun à la modale et à l'étape lien de l'arbitrage, l'indice « Coller un lien → » de la liste du run, le badge « N à rattraper » du shell, la barre de progression de la phase dans l'emplacement de celle du run, la ligne « rien à rattraper », les libellés FR et EN, le nom de marque du paramètre `source` dans les messages d'erreur et la mise à jour de DESIGN.md et de `.design-sync/NOTES.md`.

Exclut la modale de confirmation d'écriture (sub-project 10 de `ecriture-des-tags-et-renommage`), le toast de fin de recherche, inchangé, et toute logique de reconnaissance d'URL, qui vit dans le sidecar (sub-project 01).

### État livré

À la fin de ce sub-project, on peut : dans `tauri dev`, après un run qui laisse des morceaux sans correspondance, cliquer « Coller un lien → » sur une ligne, coller une URL Bandcamp dans la modale, voir le bouton attendre la réponse, la ligne de la liste passer en « URL » et la barre de phase avancer d'un cran ; coller une URL YouTube sur un autre morceau et lire l'erreur sous le champ de ce seul morceau ; refuser tous les candidats d'un arbitrage et coller le lien du même morceau dans la modale d'arbitrage.

## Dependencies

- `04-service-rattrapage-ui-design.md` (statut: implemented) : `urlRecoveryProgress`, `urlRecoveryBusy`, `urlRecoveryErrors`, `recoverableTracks`, `resolveByUrl` sur `SidecarService`.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx` → `LinkDialog` (modale du lien), `LinkForm`, `LinkActions`, `LinkHint` (indice de la colonne Après) et leur montage dans `TaggingScreen` ; `ui_kits/techno-tagger/AppShell.jsx` → badge « N à rattraper » (`openRecovery`, `linkTarget`, `linkStep`) ; `ui_kits/techno-tagger/ArbitrationDialog.jsx` → étape lien (`linkStep`)
- **Design system** : `components/overlay/Dialog`, `components/forms/InputText`, `components/forms/Button`, `components/feedback/ErrorMessage`, `components/feedback/Message`, `components/feedback/Tag`, `components/feedback/Badge`, `components/data/PhaseProgress`, `components/overlay/TruncatedText` ; `components/icons/SourceLogo` lue pour le logo d'un morceau rattrapé et pour la colonne Source de la liste du run
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/features/tagging/url-recovery-dialog.component.ts`, `src/app/features/tagging/url-recovery-dialog.component.html`, `src/app/features/tagging/url-recovery-dialog.component.spec.ts`
- **À créer** : `src/app/features/tagging/url-link-form.component.ts`, `src/app/features/tagging/url-link-form.component.html` (champ de lien), `src/app/features/tagging/url-link-actions.component.ts`, `src/app/features/tagging/url-link-actions.component.html` (« Passer » et « Résoudre »)
- **À créer** : `src/app/features/tagging/recovery-ui.store.ts`, `src/app/features/tagging/recovery-ui.store.spec.ts`
- **À modifier** : `src/app/features/tagging/tagging-page.component.ts`, `src/app/features/tagging/tagging-page.component.html` (montage de la modale, barre de la phase, ligne « rien à rattraper », blocage du bouton d'action pendant un geste), `src/app/features/tagging/tagging-page.component.spec.ts`
- **À modifier** : `src/app/features/tagging/run-list.component.ts`, `src/app/features/tagging/run-list.component.html`, `src/app/features/tagging/run-list.component.spec.ts` (indice « Coller un lien → », ouverture par le clic et le clavier)
- **À modifier** : `src/app/features/tagging/arbitration-dialog.component.ts`, `src/app/features/tagging/arbitration-dialog.component.html`, `src/app/features/tagging/arbitration-dialog.component.spec.ts` (étape lien)
- **À modifier** : `src/app/app.component.ts`, `src/app/app.component.html`, `src/app/app.component.spec.ts` (badge « N à rattraper », modale d'arbitrage gardée ouverte sur l'étape lien)
- **À créer** : `src/app/shared/utils/sources.ts` (`SOURCE_NAMES`, `brandName`)
- **À modifier** : `src/app/shared/components/error-message.component.ts`, `src/app/shared/components/error-message.component.spec.ts` (nom de marque du paramètre `source`)
- **À modifier** : `src/app/shared/utils/identity.ts` (`failureReasonKey`), `src/app/shared/utils/motion.ts` (`NO_MOTION`), `src/fixtures/dialog.ts` (`linkField`, `pasteLink`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.recovery.*`, `tagging.list.addLink`, `tagging.blocked.recovering`, texte de `errors.track_not_found`)
- **À modifier** : `docs/DESIGN.md` (§ Mapping Composants, § Layout, § Structure de Page, § Maquette et design system externes > Arbitrages)
- **À modifier** : `.design-sync/NOTES.md` (journal et § Reste ouvert)

## Architecture approach

- **Composants de présentation** standalone, `OnPush` par défaut (`.claude/rules/angular/components.md`, `.claude/rules/angular/change-detection.md`). Leurs lectures du service passent par des `computed()`, jamais par un appel de méthode dans le template. Aucune règle métier : quels morceaux, quelle source, quelle progression, tout vient du sidecar par `SidecarService`.
  - **`UrlRecoveryDialogComponent`** (`app-url-recovery-dialog`) : `p-dialog` modal, montée par la page Tagging, sans animation (`NO_MOTION`, chemin de décision). Largeur et hauteur au § Layout de DESIGN.md.
  - **`UrlLinkFormComponent`** : motif d'échec ou « Rattrapé sur <Source> », aide, champ, place réservée de l'erreur. Commun à la modale du lien et à l'étape lien de l'arbitrage.
  - **`UrlLinkActionsComponent`** : « Passer » et « Résoudre », au pied de la modale hôte. « Passer » appartient à l'hôte, qui sait où aller ensuite.
- **`RecoveryUiStore`** : l'état propre à l'interface, que `SidecarService` ne porte pas. Les composants l'injectent directement (`.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`) :
  - le lien collé par morceau, rattaché à son run (les `track_id` se répètent d'un run à l'autre), gardé après un succès pour qu'on voie le lien utilisé et qu'on puisse le corriger ;
  - le morceau ouvert dans la modale (`target`) et celui de l'étape lien (`linkStep`) ;
  - `available`, faux pendant la recherche (le sidecar refuse le geste) et sur un run confirmé ;
  - `unresolvedCount`, le décompte du badge ;
  - `resolve`, qui reprend la garde du bouton (champ vide, geste en vol, geste indisponible) parce que la touche Entrée ne passe pas par `[disabled]` (`.claude/rules/angular/forms.md`). Le geste appelle `resolveByUrl` sans attendre, l'échec revenant plus tard dans `urlRecoveryErrors`. Le texte part tel quel : la normalisation appartient au sidecar.
- **Morceaux de la modale** : `recoverableTracks` dans l'ordre du run, donc les non résolus et les rattrapés par URL (arbitrage « Lignes rattrapées »). Navigation par ‹ N/M ›, par ← et → (Alt dans un champ rempli, où les flèches déplacent le curseur), « Passer » mène au suivant et ferme au dernier. Elle se ferme d'elle-même quand son morceau n'est plus rattrapable (run suivant).
- **Ouverture**, trois portes :
  - **la ligne du run** : clic, Entrée ou Espace sur une ligne non résolue ou rattrapée. La colonne Après porte l'indice « Coller un lien → » sur un non résolu. Un morceau en file d'arbitrage ouvre l'arbitrage, jamais le lien ; un run confirmé n'ouvre rien ;
  - **le badge « N à rattraper »** du shell, groupé avec le badge de file, masqué pendant la recherche, sur 0 et sur un run confirmé. Il bascule sur Tagging et ouvre le premier non résolu ;
  - **l'étape lien** de la modale d'arbitrage (ci-dessous).
- **Étape lien de l'arbitrage** : après le refus de la liste Bandcamp, ou « Passer » quand elle est vide, `ArbitrationDialogComponent` affiche le champ et ses actions à la place des candidats, dans le même cadre et sans compteur. `RecoveryUiStore.linkStep` ne s'allume que quand le sidecar a retiré le morceau de la file et l'a rendu non résolu : un refus de la liste Beatport laisse le morceau en file pour sa liste Bandcamp. Aucun filtre sur le motif d'échec (« Passer » sur une liste Bandcamp vide rend celui de la liste). « Passer » ou un lien accepté mène à l'arbitrage suivant ; la croix quitte l'étape, le morceau reste rattrapable par sa ligne ou le badge.
- **Champ** :
  - `input pInputText` `type="url"`, focalisé à chaque morceau, `aria-label` traduit qui nomme le morceau (l'identité visible n'est pas un `label` lié). Désactivé quand le rattrapage n'est pas disponible, avec son aide `tagging.recovery.unavailable` et le focus sur « Passer » ; en lecture seule pendant l'attente ;
  - « Résoudre » actif dès que le champ n'est pas vide et que le morceau n'attend pas de réponse ; pendant l'attente, un spinner enfant, `[loading]` étant déprécié en PrimeNG 22 (même motif que la modale d'arbitrage) ;
  - l'erreur de ce seul morceau (`urlRecoveryErrors`) dans `app-error-message` sous le champ, jamais un toast (fiche `ErrorMessage`), dans une place réservée qui garde le pied immobile.
- **Écart à la maquette : pas de zone hôte** (décision du propriétaire du sub-project 01, 2026-09-29) : ni logo de source à la frappe, ni « Hôte non reconnu », ni bouton grisé tant que l'hôte n'est pas reconnu. La reconnaissance vit dans le sidecar, un hôte refusé revient en `unsupported_url` sous le champ. La source s'affiche dans l'en-tête de la modale et dans la colonne Source de la liste une fois le morceau rattrapé.
- **Barre de phase** : `app-phase-progress` dans l'emplacement de la barre du run en haut de page, une seule phase tournant à la fois (la barre du run puis celle de l'écriture priment). Libellé de phase, compteur « rattrapés sur à rattraper » et valeur par `progressPercentage` (`shared/utils/progress.ts`). Sur 0 sur 0, une ligne `check-circle` la remplace : « rien à rattraper ».
- **Bouton d'action du run pendant la phase** (décision ci-dessous) : un seul bouton suit la phase, et un geste de rattrapage en vol le grise, « Lancer le run » comme « Confirmer l'écriture », avec son aide `tagging.blocked.recovering` : fermer le run couperait l'appel en vol.
- **Nom de marque dans les erreurs** : le sidecar envoie `params.source` en valeur de `Source` (`bandcamp`). `ErrorMessageComponent` le passe par `brandName` (`shared/utils/sources.ts`, qui porte aussi `SOURCE_NAMES` : une valeur, une source), sinon l'écran lirait « bandcamp ne répond pas ». `errors.track_not_found` ne s'affiche que dans ce contexte : son texte dit que le lien ne mène à aucun morceau sur la source.
- **Largeurs** : aucune largeur en dur sur le champ ni sur les boutons. Seule la modale porte la sienne (arbitrage « Largeurs », `.claude/rules/primeng/composants.md`).
- **Libellés** : clés `tagging.recovery.*` dans les deux fichiers de langue, même commit, vouvoiement, espace insécable avant `:` en français (`.claude/rules/ngx-translate/i18n.md`). Tokens de couleur et classes Tailwind seulement (`.claude/rules/tailwindcss/utilitaires.md`).
- **Docs** : DESIGN.md (skill `design-doc`) décrit la modale du lien, l'indice, le badge, l'étape lien et la ligne « rien à rattraper » dans son mapping et son layout, et consigne dans § Arbitrages, datés, les écarts à la maquette tranchés par le propriétaire : zone hôte retirée, barre de phase dans l'emplacement de celle du run, lignes rattrapées conservées, rattrapage après interruption, rattrapage par modale, badge, étape lien, indice, « rien à rattraper », bouton d'action unique. `.design-sync/NOTES.md` § Reste ouvert liste ce que le code livre et que la maquette n'a pas encore, pour la synchronisation.

## Acceptance criteria

### Scénario 1 : Phase ouverte
**GIVEN** un run terminé avec deux morceaux `unresolved` (motifs `no_result` et `below_threshold`) et un résolu en `auto`
**WHEN** la phase de rattrapage s'ouvre
**THEN** le badge « 2 à rattraper » apparaît à droite du badge de file et la barre de phase affiche 0 sur 2 dans l'emplacement de la barre du run
**AND** les deux lignes non résolues portent « Coller un lien → » dans la colonne Après

### Scénario 2 : Ouverture par la ligne
**GIVEN** la phase ouverte et deux morceaux non résolus
**WHEN** l'utilisateur clique la seconde ligne, ou la focalise et appuie sur Entrée
**THEN** la modale s'ouvre sur ce morceau, avec son identité, son nom de fichier, son motif d'échec et « 2/2 »
**AND** le champ de lien est focalisé

### Scénario 3 : Ouverture par le badge
**GIVEN** la phase ouverte, un morceau rattrapé par URL puis un morceau non résolu, l'utilisateur sur un autre onglet
**WHEN** il clique le badge « N à rattraper »
**THEN** l'application bascule sur Tagging et la modale s'ouvre sur le premier morceau non résolu

### Scénario 4 : Rattrapage d'un morceau
**GIVEN** la modale ouverte sur un morceau non résolu
**WHEN** l'utilisateur colle une URL Bandcamp et clique « Résoudre »
**THEN** `resolveByUrl` part avec ce morceau et cette URL
**AND** le bouton est désactivé avec un spinner tant que la réponse n'est pas arrivée
**AND** la touche Entrée dans le champ aurait produit le même envoi

### Scénario 5 : Morceau rattrapé conservé
**GIVEN** un morceau dont la résolution par URL sur Bandcamp vient d'aboutir
**WHEN** l'écran se met à jour
**THEN** la modale reste sur ce morceau, dit « Rattrapé sur Bandcamp », montre le logo de la source et garde l'URL collée dans le champ
**AND** la barre de phase affiche 1 sur 2, le badge n'en compte plus qu'un et la ligne du run passe en « URL »

### Scénario 6 : Erreur sur un morceau
**GIVEN** la modale ouverte sur un morceau, un autre morceau ayant reçu une erreur
**WHEN** le sidecar refuse le geste du morceau affiché en `unsupported_url`
**THEN** le message traduit s'affiche sous le champ de ce seul morceau
**AND** aucun toast n'apparaît, le pied de la modale ne bouge pas

### Scénario 7 : Bouton inactif sur un champ vide
**GIVEN** la modale ouverte
**WHEN** le champ est vide
**THEN** « Résoudre » est désactivé

### Scénario 8 : Navigation et sortie
**GIVEN** la modale ouverte sur le premier de deux morceaux rattrapables
**WHEN** l'utilisateur clique « Passer », puis « Passer » encore
**THEN** la modale affiche le second morceau, puis se ferme sans rien envoyer
**AND** les deux morceaux restent rattrapables par leur ligne ou par le badge

### Scénario 9 : Recherche en cours
**GIVEN** une recherche en cours et un morceau déjà non résolu
**WHEN** l'utilisateur clique sa ligne
**THEN** la modale s'ouvre avec le champ désactivé et l'aide « Disponible à la fin de la recherche »
**AND** le focus est sur « Passer », le badge « N à rattraper » reste masqué

### Scénario 10 : Étape lien de l'arbitrage
**GIVEN** la modale d'arbitrage sur la liste Bandcamp d'un morceau
**WHEN** l'utilisateur refuse tous les candidats et que le sidecar rend le morceau non résolu
**THEN** la modale d'arbitrage, sans compteur, affiche le champ de lien de ce morceau
**AND** « Résoudre » envoie l'URL de ce morceau, « Passer » mène à l'arbitrage suivant

### Scénario 11 : Rien à rattraper
**GIVEN** un run dont tous les morceaux sont résolus en `auto` ou par arbitrage
**WHEN** la phase de rattrapage s'ouvre
**THEN** une ligne « rien à rattraper » remplace la barre de phase
**AND** aucun badge « N à rattraper » n'est affiché

### Scénario 12 : Nom de marque dans un message
**GIVEN** une erreur `source_unavailable` dont `params.source` vaut `bandcamp`
**WHEN** le message s'affiche
**THEN** il nomme « Bandcamp »

### Scénario 13 : Action du run bloquée pendant un geste
**GIVEN** la phase ouverte, un geste de rattrapage en attente de réponse
**WHEN** l'utilisateur survole le bouton d'action du run
**THEN** le bouton est désactivé et son aide dit qu'un rattrapage est en cours
**AND** il redevient actif à la réponse, succès ou erreur

### Scénario 14 : Run confirmé
**GIVEN** un run dont l'écriture est confirmée
**WHEN** l'écran se met à jour
**THEN** les lignes du run n'ouvrent plus rien et le badge « N à rattraper » disparaît

## Tests à écrire

### Unit
- `src/app/features/tagging/url-recovery-dialog.component.spec.ts` :
  - shows the identity of the targeted track with its reason
  - names the source of a track already resolved by url
  - disables the resolve button on an empty field
  - sends the pasted url for its track
  - sends the pasted url on enter and ignores enter on an empty field and on a waiting track (paramétré)
  - names the track in the field label
  - keeps the pasted url in its field once the track is recovered
  - shows a spinner and disables the button while the track waits
  - shows an error for the displayed track only
  - goes to the next track on skip and closes on the last one
  - disables the field during a search
  - closes when its track is no longer recoverable
- `src/app/features/tagging/recovery-ui.store.spec.ts` :
  - `available` : closes once the run is committed ; opens again when a refused commit falls back
  - `linkStep` : stays empty while nothing was refused ; stays empty while the refused track is still in the queue ; targets the refused track once it left the queue unresolved ; ignores a refusal made during a previous run ; targets a track passed on an empty Bandcamp list, unresolved with its list reason ; stays empty when the refused track was resolved meanwhile ; empties once the step is left
  - `canResolve` : refuses an empty link ; accepts a pasted link ; refuses while a gesture is in flight for the track ; refuses during a search
  - `resolve` : sends the pasted link for its track ; sends nothing on an empty link, while a gesture is in flight and during a search
  - `open` : targets the given track ; targets the first unresolved track without an id ; closes back to no target
  - counts the unresolved recoverable tracks only
  - forgets the links pasted during a previous run
- `src/app/features/tagging/tagging-page.component.spec.ts` :
  - shows the recovery progress bar after an interrupted run
  - shows nothing about recovery while the phase is closed
  - shows the empty recovery state in place of the bar on zero out of zero
  - opens the link dialog on the track of a clicked run row
  - shows the url recovery progress in place of the run progress (run terminé, run en cours)
  - blocks a new run while a url recovery waits
  - blocks the confirmation while a link is being resolved
- `src/app/features/tagging/run-list.component.spec.ts` :
  - asks to recover a recoverable row when it is clicked
  - asks to recover a recoverable row from the keyboard (Entrée, Espace)
  - asks to recover nothing when a row that is not recoverable is clicked
  - hints at pasting a link on an unresolved recoverable row only
  - keeps a row without action out of the tab order
  - leaves the rows of a committed run without action
- `src/app/features/tagging/arbitration-dialog.component.spec.ts` (étape lien) :
  - shows the link field and the skip action without a counter once the track left the queue unresolved
  - sends the pasted link for the refused track
  - leaves the step on skip and keeps the track to recover
  - offers no link step while the refused track stays in the queue for the Bandcamp list
- `src/app/app.component.spec.ts` :
  - hides the recovery badge when nothing is left to recover
  - hides the recovery badge during a search
  - counts the unresolved tracks only in the recovery badge
  - opens the link dialog on the first unresolved track and goes to the tagging page on a badge click
  - keeps the arbitration dialog open on the link step of an emptied queue
- `src/app/shared/components/error-message.component.spec.ts` :
  - names the source brand in a translated message

Aucun test ne vérifie PrimeNG, ngx-translate ni Angular : chacun échoue contre une régression de notre lecture de l'état, de notre geste, de notre placement de l'erreur, de notre étape lien ou de notre nom de marque.

## Edge cases

- **Entrée sur un champ vide ou un morceau en attente** : rien ne part, comme le bouton désactivé.
- **Texte fait d'espaces** : le bouton est actif, le geste part, le sidecar le refuse en `unsupported_url` sous le champ. L'interface ne filtre que la chaîne vide.
- **Morceau rattrapé puis recollé avec un mauvais lien** : l'erreur s'affiche sous le champ, qui garde « Rattrapé sur <Source> » : le sidecar n'a pas touché au morceau (sub-project 02).
- **Arbitrage refusé pendant la phase** : le morceau devient `unresolved`, entre dans la navigation de la modale à la mise à jour de `recoverableTracks` et dans le décompte du badge, avec son motif.
- **Nouveau run** : la phase se ferme (sub-project 04), la modale se ferme avec elle, les liens collés du run précédent sont oubliés.
- **Modale fermée par la croix ou Échap** : rien n'est envoyé, le lien collé reste dans le champ du morceau jusqu'au run suivant.
- **Refus de la liste Beatport** : le morceau reste en file pour sa liste Bandcamp, l'étape lien n'apparaît qu'à la fin de celle-ci.
- **Recherche en cours ou run confirmé** : le geste ne part pas de l'interface, le sidecar le refuserait (`url_recovery_not_open`, `run_committed`). La modale s'ouvre quand même pendant la recherche, champ désactivé ; un run confirmé n'ouvre plus rien.

## Architectural decisions

### Décision : Partage de la hauteur entre la liste du run et le rattrapage

**Options envisagées :**
- **A. Bloc borné sous la liste** : sa hauteur suit son contenu jusqu'à une borne, au-delà ses lignes défilent ; la liste garde le reste.
- **B. Moitié-moitié** : chacun son scroll, mais un bloc d'une ligne occupe la moitié de la page.
- **C. Le bloc remplace la liste pendant la phase** : on ne voit plus la ligne du run passer en « URL ».
- **D. Modale du lien par morceau**, ouverte par la ligne du run, le badge du shell ou l'étape lien de l'arbitrage : la liste garde toute la hauteur.

**Choix : D** (remplace A, retenu le 2026-10-03)

**Rationale :**
- Remplacé le 2026-10-06 : explorée parmi cinq directions par `/swarm-ui-variations`, la modale a été retenue par le propriétaire, et la maquette réalignée le même jour (DESIGN.md § Arbitrages, « Rattrapage par modale »).
- La liste du run garde toute sa hauteur et la page ne défile pas (DESIGN.md § Structure de Page). Le bloc de l'option A, décidé par le propriétaire le 2026-10-03 pour rester fidèle à la maquette d'alors, la lui prenait.
- Le champ de lien sert aussi à l'étape lien de l'arbitrage : un composant pour deux hôtes.

### Décision : Bouton « Lancer le run » pendant la phase

**Options envisagées :**
- **A. Conservé, bloqué seulement pendant un geste en vol** : un nouveau run ferme la phase, comme il efface déjà un run terminé sans rattrapage ; seul l'appel en cours est protégé.
- **B. Remplacé par « Confirmer l'écriture » dès la phase ouverte**, comme la maquette : sans la Feature 5, plus aucun moyen de relancer un run tant que l'app tourne.
- **C. Désactivé tant que la phase est ouverte** : même impasse que B, sans le bouton de sortie.

**Choix : B** (remplace A, retenu le 2026-10-03)

**Rationale :**
- Remplacé le 2026-10-06 : la Feature 5 livre la confirmation d'écriture, qui donne une sortie à la phase. Un seul bouton suit la phase (« Lancer le run », « Interrompre » pendant la recherche, « Confirmer l'écriture » sur un run cherché non écrit) ; choisir un autre dossier abandonne un run non écrit (DESIGN.md § Arbitrages, « Bouton d'action du run »).
- Le choix A, décidé le 2026-10-03, gardait « Lancer le run » faute de sortie à la phase : la perte d'un run terminé au lancement du suivant était déjà le comportement de l'écran depuis la Feature 2.
- La protection du geste en vol demeure : il grise le bouton d'action, quel que soit son rôle, le temps d'un appel à l'API.

### Décision : Emplacement de la barre de phase

**Options envisagées :**
- **A. Emplacement de la barre du run, en haut de page** : une seule barre à un seul endroit, la phase en cours.
- **B. Dans l'en-tête du bloc** : la barre colle à ses lignes, mais la page aurait deux emplacements de progression selon la phase.

**Choix : A**

**Rationale :**
- Validé par le propriétaire le 2026-10-03. Une seule phase tourne à la fois, la maquette garde aussi la barre en haut pendant `urlRescue`.
- `app-phase-progress` y est déjà monté pour la phase réseau : le rattrapage n'ajoute pas un second motif de progression à l'écran.
