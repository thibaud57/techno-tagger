---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "confirmation-et-ecriture-ui"
goal: "Confirmer l'écriture d'un run depuis l'onglet Tagging, puis en suivre l'avancement, les échecs et leur relance, le run étant figé dès la confirmation"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["07-contrat-detail-avant-apres-design.md", "08-service-ecriture-ui-design.md", "09-ligne-depliee-avant-apres-design.md"]
date: "2026-10-11"
---

# Confirmation et suivi de l'écriture

## Scope

Couvre le bouton d'action unique du run et son cycle (lancer, interrompre, confirmer l'écriture, relancer l'écriture), la modale de confirmation, le gel du run confirmé (lignes, badges et modales d'arbitrage et de rattrapage), la barre de progression de l'écriture, l'état « Échec d'écriture » et son motif, la remesure de la colonne État, le message d'échec et la relance confirmée, les erreurs de `commit_run` et `retry_write`, et la modale de fermeture, bloquée pendant l'écriture ou un rollback et qui nomme un run cherché mais non confirmé.

Exclut le récapitulatif filtrable (Feature 6), les boutons de rollback et l'état `rolled_back` à l'écran (sub-project 11), le service et le store de l'écriture (08).

### État livré

À la fin de ce sub-project, on peut : dans `just dev`, lancer un run, voir le bouton passer à « Interrompre » puis à « Confirmer l'écriture », confirmer dans la modale qui dit le nombre de fichiers, suivre la barre d'écriture, voir les lignes écrites ou en échec d'écriture avec leur motif, relancer les échecs par le bouton d'action, et constater que la fenêtre ne se ferme pas pendant l'écriture ; et lancer `just test` sur les specs de la page, de la liste, de l'état, du shell et de la fermeture.

## Dependencies

- `07-contrat-detail-avant-apres-design.md` (statut: implemented) : `SidecarService.taggingFolder`, le dossier de `run_started`
- `08-service-ecriture-ui-design.md` (statut: implemented) : `commitRun()`, `retryWrite()`, signaux `committed`, `writing`, `writeProgress`, `writeFinished`, `rollingBack`, `errorFor("commit_run", "retry_write")`, `CloseGuard.blocked`, travaux `write` et `rollback`, libellés `app.close.write` et `app.close.rollback`
- `09-ligne-depliee-avant-apres-design.md` (statut: implemented) : `RunListComponent` à sept colonnes, `TrackDetailComponent` et son input `interrupted`, `app-no-value`

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, rangée d'actions du `TaggingScreen`, barre de la phase `writing`, `Message` d'échec et bouton « Relancer l'écriture sur les échecs » du `Recap` ; `ui_kits/techno-tagger/AppShell.jsx`, `ConfirmDialog` « Confirmer l'écriture » et `CloseConfirmation`
- **Design system** : `components/overlay/ConfirmDialog`, `components/data/PhaseProgress`, `components/data/ProgressBar`, `components/feedback/StateTag`, `components/feedback/Message`, `components/feedback/Toast`, `components/overlay/Tooltip`, `components/overlay/Dialog`
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À modifier** : `src/app/app.config.ts` (`ConfirmationService` fourni à la racine, partagé avec le rollback du sub-project 11)
- **À créer** : `src/app/shared/components/danger-confirm.component.ts` (`DangerConfirmComponent`, le `p-confirmdialog` des gestes sur les fichiers à poser une fois par écran, message en `whitespace-pre-line`, boutons en `size="small"`, et `injectDangerConfirm`, partagés avec le sub-project 11)
- **À créer** : `src/app/shared/components/message.component.ts`, `.spec.ts` (`app-message`, seule voie vers `p-message`, icône selon la sévérité, texte en `whitespace-pre-line`)
- **À modifier** : `src/app/shared/components/error-message.component.ts`, `src/app/features/tagging/arbitration-dialog.component.ts`, `.html`, `src/app/features/tagging/url-link-form.component.ts`, `.html` (passent par `app-message` au lieu de `p-message`)
- **À modifier** : `src/app/features/tagging/tagging-page.component.ts`, `.html`, `.spec.ts` (bouton d'action et ses quatre rôles, dossier du run comparé au dossier choisi, confirmations, barre d'écriture, message d'échec, `filesBusy`, erreurs, `app-danger-confirm`)
- **À modifier** : `src/app/features/tagging/url-recovery-dialog.component.spec.ts`, `src/app/features/tagging/arbitration-dialog.component.spec.ts` (stub de `SidecarService` : `committed`)
- **À modifier** : `src/app/features/tagging/run-list.component.ts`, `.html`, `.spec.ts` (input `frozen` : aucune ligne actionnable, attente d'arbitrage rendue « Non traité » et pochette sans squelette)
- **À modifier** : `src/app/core/arbitration.store.ts`, `.spec.ts` et `src/app/core/sidecar.service.ts` (`anyBusy`, `arbitrationInFlight` : gestes d'arbitrage en vol sur n'importe quel morceau)
- **À modifier** : `src/app/shared/components/icon.component.ts` (icône `refresh`)
- **À modifier** : `src/app/shared/utils/tooltip.ts` (jeu `TOOLTIP` : `TOOLTIP_POSITION` et `TOOLTIP_DELAY`, liés par `[tooltipOptions]` ; tooltip du bouton d'action sous lui)
- **À modifier** : `src/app/features/tagging/recovery-ui.store.ts`, `.spec.ts` (rattrapage indisponible une fois le run confirmé)
- **À modifier** : `src/app/shared/components/state-tag.component.ts`, `.spec.ts` (`written` comme `resolved`, `write_error`)
- **À modifier** : `src/app/shared/components/close-confirmation.component.ts`, `.spec.ts` (mode bloqué : titre, « Rester » seul)
- **À modifier** : `src/app/core/close-guard.service.ts`, `.spec.ts` (arbitrages en attente non comptés une fois le run confirmé ; run cherché mais non confirmé compté, sans bloquer)
- **À modifier** : `src/app/app.component.ts`, `.spec.ts` (badge et modale d'arbitrage masqués une fois le run confirmé)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (bouton, confirmations dont `tagging.commit.backup`, barre, message d'échec, raisons de blocage dont `tagging.blocked.restoring`, titre de la fermeture bloquée, `app.close.unwritten`, état d'échec d'écriture)
- **À modifier** : `docs/DESIGN.md` (Arbitrages : « Bouton d'action du run » remplace « Bouton Lancer le run pendant la phase », et « Relance de l'écriture » ; ligne « Relance de l'écriture en échec » : dans l'onglet Tagging en attendant le récapitulatif ; lignes « Lancement du run », « Interruption du run » et « Confirmation de sortie » du mapping ; § Tokens de Tooltip : le motif d'un échec d'écriture ; § Layout, largeur de la colonne État)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : cycle du bouton, relance dans Tagging, fermeture bloquée)

## Architecture approach

- **Bouton d'action unique**, dérivé par un `computed` de la page (`.claude/rules/angular/signals.md`), en `size="small"`, au bout de la ligne du dossier et à la largeur de son libellé :
  - `start` (« Lancer le run », principal) avant tout run, après une écriture finie, ou quand le dossier choisi diffère de celui du run affiché (`run_started.folder`, lu par `SidecarService.taggingFolder`) ;
  - `cancel` (« Interrompre », secondaire contour) pendant la phase réseau ;
  - `commit` (« Confirmer l'écriture », `primary`) sur un run que le moteur écrirait (`SidecarService.runConfirmable` : phase réseau finie ou interrompue, ni confirmé ni perdu avec le moteur, au moins un morceau résolu) ; en chargement (icône `spinner`, `[loading]` de `pButton` ne dessine rien sur un contenu projeté) pendant la première écriture ;
  - `retry` (« Relancer l'écriture », `primary`, icône `refresh`) tant qu'il reste des lignes en échec d'écriture sur le dossier du run écrit et que le moteur le tient encore (`SidecarService.runRetryable` : bilan d'écriture reçu et run non perdu), `spinner` pendant la relance (une écriture qui suit un bilan est une relance). Un run écrit perdu avec le moteur ne se relance pas : le bouton revient à `start` sur son propre dossier, même avec des échecs (décidé en revue d'écran le 2026-10-11). La relance ouvre sa propre confirmation.
  Choisir un autre dossier abandonne le run non écrit et ses échecs : le bouton revient à `start` ; rechoisir le même le laisse confirmable. Un run qui n'est pas confirmable laisse `start` sur son propre dossier. Une page recréée au retour sur l'onglet reprend d'abord le dossier du run affiché (`taggingFolder`), non la dernière destination. Grisé (pendant une écriture ou une restauration pour `commit` et `retry`), il garde son libellé et dit sa raison en tooltip sous lui (jeu `TOOLTIP`, lié par `[tooltipOptions]`) : geste en vol, rollback en cours, clé absente, dossier manquant, seule exception admise au tooltip porteur d'information (DESIGN.md § Conventions de Code)
- **Confirmation** par `ConfirmationService` et `app-danger-confirm` (un `p-confirmdialog` posé par la page, ouvert par `injectDangerConfirm`), « Annuler » en `secondary` contour, bouton d'acceptation « Écrire les tags » en `primary`, les deux en `size="small"` comme tous les boutons, le rouge étant réservé au rollback (DESIGN.md § Arbitrages, « Rouge des gestes sur les fichiers »), et focus par défaut sur « Annuler » (`defaultFocus="reject"` : Entrée ne valide pas une écriture) (`.claude/rules/primeng/composants.md`). Le texte se compose en trois blocs séparés d'une ligne vide : le dossier du run, les comptes un par ligne (fichiers résolus, puis, quand leur nombre n'est pas nul, les non résolus laissés intacts et les morceaux encore à arbitrer qui ne seront ni écrits ni arbitrables), puis la garantie (`tagging.commit.backup` : tags d'origine sauvegardés avant l'écriture, restauration du run ou d'un morceau possible). Les nombres se lisent sur les états reçus, l'interface ne décide rien
- **Run figé** dès `committed` : `RunListComponent.frozen` retire toute ligne actionnable (ni clic, ni touche, ni `tabindex`), `RecoveryUiStore.available` devient faux, l'`app.component` masque le badge et la modale d'arbitrage, `CloseGuard` ne compte plus les arbitrages en attente. Les morceaux encore à arbitrer y passent en « Non traité », avec le cadre neutre de pochette et non un squelette. Une confirmation refusée (dump impossible) fait retomber `committed` et tout revient
- **Progression** : `app-phase-progress` « Écriture des tags et des pochettes, puis renommage » sur `writeProgress`, à la place des barres réseau et rattrapage dès la confirmation, gardée sur son dernier palier une fois l'écriture finie
- **États** : `StateTagComponent` lit `written` comme `resolved` (libellé de la voie, vert) et `write_error` en `danger`, `exclamation-triangle`, « Échec d'écriture » ; le motif suit l'icône info en tooltip, comme pour un non résolu (DESIGN.md § Couleurs Sémantiques, fiche `StateTag`). La colonne État se remesure sur ce libellé et son icône, en FR et en EN
- **Échecs** : `app-message` `error` au-dessus de la liste tant que des lignes sont en `write_error` (le sub-project 11 compte sur les lignes, non sur `writeFinished`), repris du `Recap` de la maquette, sans bouton : la relance est le bouton d'action du run (écart à la maquette, décidé le 2026-10-11). Pendant la relance, le message d'échec est masqué et le bouton d'action est en chargement
- **Erreurs** : `errorFor("start_tagging", "commit_run", "retry_write")`, plus `rollback` depuis le sub-project 11, dans l'`app-error-message` existant de la page
- **Fermeture bloquée** : `CloseConfirmationComponent` lit `CloseGuard.blocked` ; bloquée, elle titre « Impossible de quitter maintenant » et n'offre que « Rester ». Un run cherché mais non confirmé compte parmi les travaux perdus (`unwritten`), sans bloquer : la sortie reste offerte
- **i18n** : vouvoiement, infinitif pour les actions, espace insécable avant `:`, mêmes clés en FR et en EN, une phrase par ligne (`\n` dans la traduction) et une ligne vide entre les blocs de la modale de confirmation (`.claude/rules/ngx-translate/i18n.md`)
- Autres rules : `.claude/rules/angular/components.md`, `.claude/rules/angular/tests.md`, `.claude/rules/tailwindcss/utilitaires.md`

## Acceptance criteria

### Scénario 1 : cycle du bouton
**GIVEN** un dossier choisi
**WHEN** l'utilisateur lance le run, que la recherche se termine, qu'il confirme puis que l'écriture se termine
**THEN** le bouton affiche successivement « Lancer le run », « Interrompre », « Confirmer l'écriture », « Confirmer l'écriture » en chargement, puis « Lancer le run » (ou « Relancer l'écriture » tant qu'il reste des échecs d'écriture sur un run que le moteur tient encore, scénario 5)

### Scénario 2 : abandon d'un run non écrit
**GIVEN** un run dont la recherche est finie, non confirmé
**WHEN** l'utilisateur choisit un autre dossier
**THEN** le bouton revient à « Lancer le run »

### Scénario 3 : confirmation
**GIVEN** un run de 87 morceaux résolus, 3 non résolus et 2 à arbitrer
**WHEN** l'utilisateur clique « Confirmer l'écriture »
**THEN** la modale cite le dossier du run, puis dit sur une ligne chacun que 87 fichiers seront réécrits et renommés, que 3 non résolus sont laissés intacts et que 2 morceaux à arbitrer ne seront ni écrits ni arbitrables
**AND** une dernière ligne garantit la sauvegarde des tags d'origine
**AND** « Écrire les tags » envoie la confirmation, « Annuler » n'envoie rien

### Scénario 4 : run figé
**GIVEN** un run confirmé
**WHEN** l'utilisateur clique une ligne non résolue ou à arbitrer
**THEN** aucune modale ne s'ouvre, et les badges de file et de rattrapage ont disparu

### Scénario 5 : échec d'écriture et relance
**GIVEN** une écriture finie avec 2 fichiers verrouillés
**WHEN** l'utilisateur lit la liste
**THEN** leurs lignes portent « Échec d'écriture » et le motif au survol, et un message au-dessus de la liste en donne le nombre
**AND** le bouton d'action devient « Relancer l'écriture » et la relance passe par sa confirmation avant de partir

### Scénario 6 : fermeture pendant l'écriture
**GIVEN** une écriture en cours
**WHEN** l'utilisateur ferme la fenêtre
**THEN** la modale titre « Impossible de quitter maintenant » et n'offre que « Rester »

## Tests à écrire

### Unit
- `src/app/features/tagging/tagging-page.component.spec.ts` :
  - le bouton suit le cycle start, cancel, commit, commit en chargement, start ; retry tant qu'il reste des échecs d'écriture sur le même dossier d'un run que le moteur tient encore (`runRetryable`), en chargement pendant la relance, start sur un autre dossier ou sur un run écrit perdu avec le moteur
  - un autre dossier choisi remet start sur un run non écrit, le même le laisse à commit
  - un run qui n'est pas confirmable laisse start sur son propre dossier
  - une page recréée garde le dossier du run affiché
  - la confirmation porte les nombres, phrases conditionnelles comprises ; accepter appelle `commitRun`, annuler non
  - commit grisé avec sa raison pendant un geste en vol, un rollback et sans morceau résolu
  - message d'échec seulement avec des `write_error`, qui reste avec le nouveau nombre tant qu'il en reste ; la relance passe par sa confirmation et le bouton d'action se grise pendant une écriture ou un rollback
  - erreur de `commit_run` affichée
- `src/app/features/tagging/run-list.component.spec.ts` :
  - une ligne d'un run figé n'émet ni `arbitrate` ni `recover`, sort de l'ordre de tabulation et ne montre ni « À arbitrer » ni squelette
- `src/app/core/arbitration.store.spec.ts` :
  - un geste en vol sur n'importe quel morceau lève `anyBusy`, pas seulement sur le morceau affiché
- `src/app/features/tagging/recovery-ui.store.spec.ts` :
  - rattrapage indisponible une fois le run confirmé
- `src/app/shared/components/state-tag.component.spec.ts` :
  - `written` reprend le libellé de la voie ; `write_error` affiche « Échec d'écriture » en `danger`
- `src/app/shared/components/close-confirmation.component.spec.ts` :
  - fermeture bloquée : titre dédié, « Rester » seul
- `src/app/core/close-guard.service.spec.ts` :
  - arbitrages en attente non comptés une fois le run confirmé
  - run cherché mais non confirmé compté, sans bloquer
- `src/app/app.component.spec.ts` :
  - badge et modale d'arbitrage masqués une fois le run confirmé

## Edge cases

- **Run interrompu** pendant la recherche : il garde son écriture, le bouton passe à « Confirmer l'écriture »
- **Aucun morceau résolu** : « Lancer le run » sur le même dossier ; un morceau rattrapé par lien rend le run confirmable
- **Moteur mort** : le run affiché est figé, ses lignes restent sans geste possible, « Lancer le run » le remplace et la fermeture ne le compte plus
- **Confirmation refusée** (dump impossible) : erreur affichée, run de nouveau confirmable, lignes et badges reviennent
- **Même dossier rechoisi** : le run non écrit reste confirmable, seul un autre dossier l'abandonne
- **Rollback en cours** : « Confirmer l'écriture » (raison au survol) et « Relancer l'écriture » grisés
- **Double clic sur « Lancer le run »** : le second clic peut tomber sur « Interrompre », sans gravité, la recherche ne touchant aucun fichier ; la confirmation passe toujours par sa modale
- **Relance qui laisse des échecs** : le message reste avec le nouveau nombre, le bouton d'action reste « Relancer l'écriture »

## Architectural decisions

### Décision : bouton d'action du run
**Options envisagées :**
- **A. Un bouton qui suit la phase** : lancer, interrompre, confirmer, relancer l'écriture, à la largeur de son libellé
- **B. Deux boutons** : « Interrompre » à côté pendant la recherche, l'autre alternant entre lancer et confirmer
- **C. « Confirmer l'écriture » à côté de « Lancer le run »**, ou dans une barre au-dessus de la liste
**Choix : A**
**Rationale :**
- Choix du propriétaire : jamais deux actions du run côte à côte, aucune action désactivée à garder visible
- Revient sur l'arbitrage du 2026-10-03, qui gardait « Lancer le run » pendant le rattrapage : choisir un autre dossier devient le geste qui abandonne un run non écrit

### Décision : rouge des gestes sur les fichiers
**Options envisagées :**
- **A. `danger` sur l'écriture, sa relance et le rollback** : relance en contour `danger` comme le `Recap` de la maquette
- **B. `danger` sur la seule acceptation du rollback** : « Écrire les tags » et « Relancer l'écriture » acceptent en `primary`, tous les déclencheurs restent `primary`
**Choix : B** (remplace A le 2026-10-10)
**Rationale :**
- Décision du propriétaire, DESIGN.md § Arbitrages, « Rouge des gestes sur les fichiers » : les tags d'origine sont sauvegardés avant toute écriture, c'est le rollback qui défait
- C'est la modale qui avertit, pas le bouton qui l'ouvre

### Décision : relance des échecs dans l'onglet Tagging
**Options envisagées :**
- **A. Message d'échec au-dessus de la liste**, repris du `Recap`, la relance étant le bouton d'action du run
- **B. Relance dans le seul récapitulatif**, comme DESIGN.md le prévoit
**Choix : A**
**Rationale :**
- La relance est livrée par la Feature 5, le récapitulatif par la Feature 6 (arbitrage de périmètre du 2026-10-06) ; DESIGN.md s'ajuste
- Le bouton « Relancer l'écriture » a quitté le message le 2026-10-11 : un second bouton d'action du run, ailleurs que le premier, contredisait « jamais deux actions du run côte à côte »

### Décision : relance du même dossier
**Options envisagées :**
- **A. « Confirmer l'écriture » grisé** tant que le dossier est celui du run non confirmé
- **B. « Lancer le run »** quand le run n'est pas confirmable (sans morceau résolu, ou perdu avec le moteur), un run écrit perdu avec le moteur compris, même avec des échecs d'écriture

**Choix : B**

**Rationale :**
- Décision du propriétaire du 2026-10-11 : avec A, une clé refusée au premier run, une panne de la source ou un moteur relancé bloquaient le dossier, rien ne permettant de le relancer sans passer par un autre dossier
- Rien n'est perdu : un run non confirmable n'a rien à écrire, et un morceau rattrapé par lien le rend confirmable
