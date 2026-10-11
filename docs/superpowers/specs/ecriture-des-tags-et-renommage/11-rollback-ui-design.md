---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "rollback-ui"
goal: "Restaurer depuis l'interface les tags d'origine d'un morceau ou du run affiché dans l'onglet Tagging, et ceux du dernier run écrit depuis les Réglages"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["06-rollback-sidecar-design.md", "08-service-ecriture-ui-design.md", "09-ligne-depliee-avant-apres-design.md", "10-confirmation-et-ecriture-ui-design.md"]
date: "2026-10-11"
---

# Rollback depuis l'interface

## Scope

Couvre le bouton « Restaurer le run » du run affiché au bout de la barre d'écriture, le bouton « Restaurer ce morceau » de la ligne dépliée, la rangée Restauration d'une section Administration des Réglages (dernier run annulable avec date, dossier et nombre de morceaux), leurs confirmations, dont l'acceptation « Restaurer » est en `danger`, l'état « Restauré » à l'écran, la liste partagée des fichiers non restaurés, les erreurs du rollback, et le décompte des échecs d'écriture lu sur les lignes.

Exclut le rollback côté sidecar (06), le store et les commandes (08), les autres rangées d'administration de la maquette (cache, logs) et le récapitulatif (Feature 6).

### État livré

À la fin de ce sub-project, on peut : dans `just dev`, écrire un run, restaurer un morceau depuis sa ligne dépliée puis le reste du run depuis la barre d'écriture, voir les lignes passer à « Restauré » ; relancer l'application et restaurer le dernier run depuis les Réglages, qui nomment sa date, son dossier et son nombre de morceaux puis passent au run précédent ; et lancer `just test` sur les specs concernées.

## Dependencies

- `06-rollback-sidecar-design.md` (statut: implemented) : chaînage des runs annulables, échec `name_taken`, pochettes et commentaires non restaurés
- `08-service-ecriture-ui-design.md` (statut: implemented) : `rollback(runId, trackId?)`, `loadRollbackTarget()`, `rollingBack`, `rollbackFinished`, `rollbackTarget`, `errorFor("rollback", "get_rollback_target")`, toast de fin
- `09-ligne-depliee-avant-apres-design.md` (statut: implemented) : `TrackDetailComponent` sous la ligne dépliée, `RunListComponent` à chevron
- `10-confirmation-et-ecriture-ui-design.md` (statut: implemented) : `ConfirmationService` racine, `p-confirmdialog` de la page Tagging, barre d'écriture, `committed`, message d'échec d'écriture, bouton d'action unique, `filesBusy`, icône `refresh`, clé `tagging.blocked.restoring`

## Références de design

- **Maquette** : `ui_kits/techno-tagger/SettingsScreen.jsx`, section Administration, rangée `Rollback` et son bouton « Annuler le dernier run » (libellés « Restauration » et « Restaurer le dernier run » dans l'application, décidés en revue d'écran le 2026-10-11 : le geste rend les tags d'origine, il n'annule pas l'écriture)
- **Design system** : `components/overlay/ConfirmDialog`, `components/feedback/StateTag`, `components/feedback/Message`, `components/overlay/Tooltip`
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/shared/components/rollback-failures.component.ts` et `.spec.ts` (liste des fichiers non restaurés et de leur motif, dans un `app-message` `error`)
- **À modifier** : `src/app/shared/components/state-tag.component.ts`, `.spec.ts` (`rolled_back`)
- **À modifier** : `src/app/shared/components/icon.component.ts` (`undo` ; `refresh` est posée par le 10)
- **À modifier** : `src/app/features/tagging/track-detail.component.ts`, `.html`, `.spec.ts` (bouton « Restaurer ce morceau », inputs `restorable`, `restoring`, `blocked`, output `restore`)
- **À modifier** : `src/app/features/tagging/run-list.component.ts`, `.html` (relais des inputs et de l'output du détail)
- **À modifier** : `src/app/features/tagging/tagging-page.component.ts`, `.html`, `.spec.ts` (bouton du run, confirmations, liste des échecs du run affiché, erreurs du rollback, échecs d'écriture comptés sur les lignes ; test du message d'échec du 10 réécrit sur les lignes)
- **À modifier** : `src/app/features/settings/settings-page.component.ts`, `.html`, `.spec.ts` (section Administration, rangée Restauration, `app-danger-confirm`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.state.rolledBack`, `tagging.rollback.*`, `settings.admin.*` dont `settings.admin.rollback.targetCount`, `rollback.failures`, `rollback.failure`)
- **À modifier** : `docs/DESIGN.md` (§ Couleurs Sémantiques : « Restauré » et la phrase des familles dérivées ; § Écriture et récapitulatif, ligne Rollback : emplacements ; § Settings : rangée Rollback)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : état « Restauré », bouton par morceau, bouton du run sur la barre, texte de la cible dans les Réglages)

## Architecture approach

- **Composants d'affichage** : `TrackDetailComponent` émet `restore` sans rien appeler ; `RunListComponent` relaie ; la page Tagging ouvre la confirmation et appelle le service (`.claude/rules/angular/components.md`). Le détail montre le bouton quand `restorable` (morceau `written` ou `write_error` d'un run confirmé, calculé par la page sur les états reçus), en chargement quand `restoring`, grisé quand `blocked` (une opération sur les fichiers en cours)
- **Run entier dans Tagging** : « Restaurer le run » (`pButton` `size="small"` `primary` contour, icône `refresh`, le `danger` restant à l'acceptation de la modale) au bout de la barre d'écriture, une fois l'écriture finie et tant qu'une ligne du run est `written` ou `write_error`
- **Confirmations** par `injectDangerConfirm` et `app-danger-confirm` du sub-project 10 (`.claude/rules/primeng/composants.md`), boutons en `size="small"`, « Restaurer » en `danger` : nombre de fichiers, nom et tags d'origine rendus, pochettes et commentaires non rendus ; pour les Réglages, date et dossier du run en tête. Une phrase par ligne, une ligne vide entre le compte et les précisions. Les nombres se lisent sur les états reçus ou sur `rollbackTarget.tracks`
- **Une opération à la fois** : tout bouton de restauration et le bouton d'action du run se grisent pendant `writing` ou `rollingBack` ; celui qui a lancé l'opération montre l'icône `spinner` animée, comme la confirmation d'écriture
- **État « Restauré »** : `StateTagComponent` lit `rolled_back` en `secondary`, icône `undo`, `tagging.state.rolledBack`. Plus court qu'« Échec d'écriture », la colonne État garde sa largeur
- **Échecs d'écriture comptés sur les lignes** (`state === "write_error"`) et non sur le dernier `run_finished` : un morceau restauré sort du message et de la relance (ajuste le sub-project 10)
- **Liste des échecs de restauration** : `RollbackFailuresComponent` reçoit `RollbackFailure[]` et affiche « Fichiers non restaurés : N » puis, par fichier, son nom et la phrase de son motif (`tagging.reason.*`, `name_taken` compris). Dans Tagging, seulement si `rollbackFinished.run_id` est celui du run affiché ; dans les Réglages, le dernier bilan
- **Réglages** : section « Administration » sous la clé API, rangée au gabarit de celle de la clé, `app-settings-row` (grille à colonne de libellé commune de 16rem, libellé « Restauration » à gauche en `rowLabel`, filet du bas). Sans champ, l'aide (`settings.admin.rollback.hint`) prend la place du contrôle, sur la ligne du bouton « Restaurer le dernier run » calé à droite. `loadRollbackTarget()` est demandée dès que le moteur est disponible (un `effect` sur `available()` : la page se monte avant sa réponse au lancement, et la demande ne part pas sans moteur). Sous cette ligne, la cible n'apparaît que s'il y a un run, en `text-xs text-muted-color` sur deux lignes : le run (`settings.admin.rollback.target` : date formatée par `Intl.DateTimeFormat` dans la langue courante (`translate.currentLang()`) et dossier, tronqué par `app-truncated-text`), puis le nombre de morceaux (`settings.admin.rollback.targetCount`). Aucun texte ne dit l'absence de run : le bouton est grisé et son tooltip (jeu `TOOLTIP`, lié par `[tooltipOptions]`) en donne la raison (`settings.admin.rollback.none`), comme pendant la recherche d'un run (`settings.admin.rollback.loading`) puis pendant une écriture ou une restauration. Erreurs par `errorFor("rollback", "get_rollback_target")` dans un `app-error-message`
- **i18n** : vouvoiement, infinitif, forme « Libellé : {{count}} », espace insécable avant `:`, une phrase par ligne (`\n` dans la traduction), mêmes clés en FR et en EN (`.claude/rules/ngx-translate/i18n.md`)
- Autres rules : `.claude/rules/angular/signals.md`, `.claude/rules/angular/tests.md`, `.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/tailwindcss/echelles.md`

## Acceptance criteria

### Scénario 1 : restaurer un morceau
**GIVEN** un run écrit affiché, un morceau déplié en `written`
**WHEN** l'utilisateur clique « Restaurer ce morceau » puis « Restaurer » dans la confirmation
**THEN** `rollback` part avec le `run_id` du run et le `track_id` du morceau, le bouton tourne pendant l'opération
**AND** la ligne passe à « Restauré »

### Scénario 2 : restaurer le run affiché
**GIVEN** un run écrit affiché, 87 lignes `written`
**WHEN** l'utilisateur clique « Restaurer le run » au bout de la barre puis confirme
**THEN** la confirmation dit 87 fichiers et ce qui ne revient pas, et `rollback` part sans `track_id`

### Scénario 3 : restaurer le dernier run depuis les Réglages
**GIVEN** un run écrit dans une session précédente
**WHEN** l'utilisateur ouvre les Réglages
**THEN** la rangée Restauration montre sur deux lignes la date et le dossier du run, puis son nombre de morceaux
**AND** « Restaurer le dernier run » puis « Restaurer » lancent son rollback ; la rangée passe ensuite au run précédent, ou, sans autre run, au bouton grisé

### Scénario 4 : rien à restaurer
**GIVEN** aucun dump de moins de 30 jours
**WHEN** l'utilisateur ouvre les Réglages
**THEN** le bouton est grisé, sa raison (`settings.admin.rollback.none`) au survol
**AND** aucune cible ni texte d'absence ne s'affiche sous l'aide

### Scénario 5 : fichiers non restaurés
**GIVEN** un rollback dont un fichier a son nom d'origine pris
**WHEN** le bilan arrive
**THEN** la liste des fichiers non restaurés nomme ce fichier avec la phrase de `name_taken`

## Tests à écrire

### Unit
- `src/app/shared/components/rollback-failures.component.spec.ts` :
  - nombre puis, par fichier, nom et motif traduits
- `src/app/shared/components/state-tag.component.spec.ts` :
  - `rolled_back` en `secondary`, `undo`, « Restauré »
- `src/app/features/tagging/track-detail.component.spec.ts` :
  - bouton seulement si `restorable` ; clic émet `restore` avec le `trackId` ; grisé si `blocked`
- `src/app/features/tagging/tagging-page.component.spec.ts` :
  - bouton du run après l'écriture tant qu'une ligne est restaurable ; confirmation puis `rollback(runId)`
  - restauration d'un morceau : confirmation puis `rollback(runId, trackId)`
  - échecs d'écriture comptés sur les lignes `write_error`, message d'échec du 10 piloté par les lignes seules
  - échecs de restauration listés pour le run affiché seulement
- `src/app/features/settings/settings-page.component.spec.ts` :
  - cible demandée une fois le moteur disponible, non à la construction, affichée avec date, dossier et nombre
  - bouton grisé avec sa raison sans cible et pendant la recherche d'un run
  - confirmation avec date, dossier et nombre ; accepter appelle `rollback(runId)`
  - échecs et erreur affichés

## Edge cases

- **Restauration pendant l'écriture d'un autre run** : boutons grisés, raison au survol ; le sidecar la refuserait (`write_in_progress`)
- **Run restauré en partie** (fichier verrouillé) : les lignes en échec gardent leur état, le bouton du run reste, la liste des échecs le dit ; dans les Réglages, la rangée vise encore ce run
- **Ligne « Restauré »** : le sidecar la remet à son état d'origine, `track_resolved(rolled_back)` ne portant plus `after`, `source`, `scores`, `artwork_path` ni `tags_after` : Après, Source et Score s'affichent en cadratins et la pochette en cadre neutre, et le détail montre l'Avant seul
- **Restauration d'un morceau en `write_error`** : permise, ses tags ont pu être écrits avant l'échec du renommage
- **Run d'une session précédente restauré depuis les Réglages pendant qu'un autre run est affiché** : la liste affichée ne change pas, seul le bilan des Réglages montre les échecs
- **Langue changée dans les Réglages** : la date de la cible se reformate, `currentLang()` étant un signal

## Architectural decisions

### Décision : rollback du run dans l'onglet Tagging
**Options envisagées :**
- **A. Au bout de la barre d'écriture**
- **B. À côté du bouton d'action du run**
- **C. Pas dans Tagging**, les Réglages couvrant le dernier run
**Choix : A**
**Rationale :**
- Choix du propriétaire : jamais côte à côte avec le bouton d'action, là où l'on vient de voir l'écriture

### Décision : état d'un morceau restauré
**Options envisagées :**
- **A. « Restauré », famille Neutre**, icône `undo`
- **B. Retour à l'état d'avant l'écriture** (« Auto », « Arbitré »…)
**Choix : A**
**Rationale :**
- Le fichier n'est ni écrit ni en échec : un libellé de voie en vert dirait qu'il porte les tags de la source, ce qui n'est plus vrai
