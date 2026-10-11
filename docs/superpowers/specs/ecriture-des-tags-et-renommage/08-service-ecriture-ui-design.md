---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "service-ecriture-ui"
goal: "Piloter depuis l'interface la confirmation, l'écriture, la relance et le rollback d'un run, et en exposer l'état aux écrans par un store de phase"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["05-protocole-ndjson-ecriture-design.md", "06-rollback-sidecar-design.md", "07-contrat-detail-avant-apres-design.md"]
date: "2026-10-11"
---

# Service de l'écriture côté interface

## Scope

Couvre le store de phase `WriteStore`, les commandes `commit_run`, `retry_write`, `rollback` et `get_rollback_target` envoyées par `SidecarService`, et le routage de `progress(write)`, `run_finished(write)`, `rollback_target` et `rollback_finished`, ces deux derniers rejoignant `SidecarEvent`. Couvre aussi les règles d'erreur par commande, la fin de l'écriture et du rollback à la mort du moteur, le refus de fermer la fenêtre pendant l'une ou l'autre, et le signal de fin des deux.

Exclut les écrans : bouton et modale de confirmation, progression, modale de fermeture (sub-project 10), boutons de rollback et rangée des Réglages (11). Exclut aussi la ligne dépliée (09).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer des specs qui rejouent sur `FakeTransport` une écriture de bout en bout (confirmation, progression, lignes écrites, fin, cible de rollback redemandée), une relance, une confirmation refusée, puis un rollback de bout en bout, ainsi que la fermeture refusée pendant l'écriture et les toasts de fin.

## Dependencies

- `05-protocole-ndjson-ecriture-design.md` (statut: implemented) : `commit_run`, `retry_write`, `run_finished(write)` et ses compteurs, codes `write_not_open`, `phase_busy`, `run_committed`, `tag_dump_write_failed`, miroir TS des commandes et des états
- `06-rollback-sidecar-design.md` (statut: implemented) : `get_rollback_target`, `rollback`, `RollbackTargetEvent`, `RollbackFinishedEvent` (que ce sub-project ajoute à `SidecarEvent`), codes `rollback_unavailable`, `phase_busy`, état `rolled_back`
- `07-contrat-detail-avant-apres-design.md` (statut: implemented) : `TaggingTrack.tagsBefore` / `tagsAfter`, que les fixtures complètent

## Files touched

- **À créer** : `src/app/core/write.store.ts` (`WriteStore`)
- **À modifier** : `src/app/core/sidecar.service.ts` (commandes, routage, `KNOWN_EVENTS`, délégation des signaux, règles d'erreur, `endRun`, `startTagging`)
- **À modifier** : `src/app/core/models/protocol.ts` (`SidecarEvent` gagne `RollbackTargetEvent` et `RollbackFinishedEvent`)
- **À modifier** : `src/app/core/close-guard.service.ts` (`PendingWork` `write` et `rollback`, `blocked`, `leave` refusé)
- **À modifier** : `src/app/core/completion-signal.service.ts` (fins de l'écriture et du rollback, toast d'avertissement avec compteur)
- **À créer** : `src/fixtures/write.ts` (événements d'écriture et de rollback partagés par les specs)
- **À modifier** : `src/app/core/sidecar.service.spec.ts`, `src/app/core/close-guard.service.spec.ts`, `src/app/core/completion-signal.service.spec.ts`
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`app.close.write`, `app.close.rollback`, `tagging.writeFinished`, `tagging.writeFinishedWithFailures`, `tagging.rollbackFinished`, `tagging.rollbackFinishedWithFailures`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Frontend, gestion d'état : le store de l'écriture ; § Capacités Natives : le signal sonore de fin d'écriture et de rollback)
- **À modifier** : `docs/DESIGN.md` (§ Feedback, ligne « Notifications non bloquantes » : toast `warn` avec le nombre d'échecs)

## Architecture approach

- **Store de phase** `WriteStore` (`.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`) : signaux privés, lecture par `asReadonly()`, mutations par méthodes appelées du seul routage de `SidecarService`, jamais injecté dans un composant. Signaux : `committed`, `writing`, `progress`, `finished`, `rollingBack` (`{runId, trackId}` ou `null`), `rollbackFinished`, `rollbackTarget` (`undefined` tant que non demandée, `null` sans run annulable)
- **Commandes** : `commitRun()` et `retryWrite()` sur `taggingRunId`, `rollback(runId, trackId?)` (`track_id` nul pour un run entier), `loadRollbackTarget()`. Chacune ignore un second appel tant que l'opération tourne, sur le modèle de `startTagging`. `commitRun` pose `committed` et `writing` à l'envoi. `loadRollbackTarget()` ne part que si le moteur est lancé : en lecture seule, elle ne passe pas par l'erreur d'un moteur indisponible, qui arrêterait le run affiché
- **Routage** : `progress` de phase `write` vers le store (la branche réservée de `routeProgress`), `run_finished` de phase `write` vers `finished`, `rollback_target` et `rollback_finished` vers le store. Les deux événements rejoignent `SidecarEvent` et `KNOWN_EVENTS`, ce que le `switch` exhaustif impose (`.claude/rules/typescript/types.md`). `written`, `write_error` et `rolled_back` des lignes passent déjà par `track_resolved` et `TaggingRunStore`
- **Cible rafraîchie** : `get_rollback_target` repart après `run_finished(write)` (un dump est créé) et après `rollback_finished` (un dump est consommé)
- **Erreurs**, lues par `errorFor(...)` sur la commande qui a échoué :
  - `commit_run` : fin de `writing`, et `committed` retombe sauf sur `phase_busy` portant `write`, l'écriture déjà lancée continuant ;
  - `retry_write` : fin de `writing`, `committed` reste ;
  - `rollback` : `rollingBack` levé ;
  - `start_tagging` : `phase_busy` ne ferme pas le run affiché, quelle que soit la phase qui tourne (spec 05) ;
  - `run_committed` sur un geste passe par le routage existant par morceau
- **Nouveau run** : `startTagging` vide le store sauf `rollbackTarget`, qui ne dépend pas du run affiché
- **Mort du moteur** : `endRun` arrête aussi l'écriture et le rollback
- **Fermeture** : `PendingWork` gagne `write` et `rollback` ; `CloseGuard.blocked` vaut vrai quand le travail en cours en contient un (lu en direct, non sur la demande figée : une écriture qui finit modale ouverte redevient quittable), et `leave()` ne ferme alors rien. Tauri arrête le sidecar à la sortie : quitter couperait un fichier en plein travail
- **Signal de fin** : `CompletionSignalService` annonce la fin de l'écriture et celle du rollback ; toast `success`, ou `warn` avec le nombre d'échecs (`write_error`, `failed`). `announce` prend des paramètres de traduction et une sévérité. Une relance qui finit s'annonce de nouveau, chaque `run_finished` étant un nouvel objet
- **i18n** : quatre messages de fin et deux libellés de fermeture (`app.close.write`, `app.close.rollback`), vouvoiement, espace insécable avant `:`, une phrase par ligne (`\n`) dans les messages de fin avec échecs (`.claude/rules/ngx-translate/i18n.md`)
- **Tests** : `.claude/rules/angular/tests.md`, sur le `FakeTransport` des specs existantes

## Acceptance criteria

### Scénario 1 : écriture de bout en bout
**GIVEN** un run résolu affiché
**WHEN** l'écran appelle `commitRun()` et le sidecar émet `progress(write)`, `track_resolved(written)` puis `run_finished(write)`
**THEN** `commit_run` part avec le `run_id` du run, `committed` et `writing` passent vrais puis `writing` retombe, `writeProgress` et `writeFinished` suivent les événements, la ligne passe `written`
**AND** `get_rollback_target` repart, et un toast « Écriture terminée » s'affiche

### Scénario 2 : confirmation refusée
**GIVEN** une confirmation envoyée
**WHEN** le sidecar répond `error` `tag_dump_write_failed` sur `commit_run`
**THEN** `writing` et `committed` retombent, l'erreur est lisible par `errorFor("commit_run")`

### Scénario 3 : rollback d'un morceau
**GIVEN** un run écrit affiché
**WHEN** l'écran appelle `rollback(runId, "a.mp3")` et le sidecar émet `track_resolved(rolled_back)` puis `rollback_finished`
**THEN** `rollback` part avec `track_id`, `rollingBack` vaut `{runId, trackId: "a.mp3"}` puis `null`, la ligne passe `rolled_back`, `rollbackFinished` porte le bilan
**AND** `get_rollback_target` repart

### Scénario 4 : fermeture pendant l'écriture
**GIVEN** une écriture en cours
**WHEN** l'utilisateur ferme la fenêtre
**THEN** la fermeture est empêchée, `blocked` est vrai et `leave()` ne ferme pas la fenêtre

### Scénario 5 : relance sur `start_tagging` pendant l'écriture
**GIVEN** une écriture en cours
**WHEN** le sidecar refuse `start_tagging` en `phase_busy` (`params.phase` à `write`)
**THEN** le run affiché reste en place, ses lignes intactes

## Tests à écrire

### Unit
- `src/app/core/sidecar.service.spec.ts` :
  - écriture de bout en bout, cible redemandée
  - confirmation refusée en `tag_dump_write_failed`
  - relance par `retryWrite()` : `retry_write` part, `writing` puis fin
  - `phase_busy` (`write` ou `rollback`) sur `start_tagging` : run gardé
  - double appel de `commitRun()` pendant l'écriture : une seule commande
  - rollback de bout en bout, puis `rollback_target` reçu exposé
  - rollback refusé en `rollback_unavailable` : `rollingBack` levé
  - mort du moteur pendant l'écriture : `writing` retombe
- `src/app/core/close-guard.service.spec.ts` :
  - fermeture empêchée et `blocked` pendant l'écriture, puis pendant un rollback
  - `blocked` retombe quand l'écriture finit modale ouverte
  - `leave()` ne ferme pas une fenêtre bloquée
- `src/app/core/completion-signal.service.spec.ts` :
  - toast de fin d'écriture, `success` sans échec, `warn` avec le nombre d'échecs
  - toast de fin de rollback, `success` puis `warn`

## Edge cases

- **Commit pendant un rollback** : refusé par le sidecar en `phase_busy` (`params.phase` à `rollback`), `committed` retombe
- **`rollback_target` reçu pendant un nouveau run** : gardé, la cible ne dépend pas du run affiché
- **Relance qui finit sans changement** (`retry_write` sans échec) : `run_finished(write)` arrive quand même, la fin s'annonce
- **Écriture finie modale de fermeture ouverte** : `blocked` retombe, le sub-project 10 y rend alors « Quitter quand même »
- **Fenêtre fermée pendant une simple attente** (écriture finie, run confirmé) : rien ne bloque, la garde ne compte que ce qui tourne

## Architectural decisions

### Décision : fermeture pendant l'écriture ou le rollback
**Options envisagées :**
- **A. Fermeture refusée** : modale avec « Rester » seul, jusqu'à la fin
- **B. Confirmation** : « Quitter quand même » possible, au risque d'un fichier à moitié écrit
**Choix : A**
**Rationale :**
- Choix du propriétaire : aucun fichier n'est coupé en plein travail, pour une attente de quelques secondes
- Le gestionnaire des tâches reste le recours si le moteur se bloquait

### Décision : store de phase distinct
**Options envisagées :**
- **A. `WriteStore` à part**, routé par `SidecarService` comme `UrlRecoveryStore`
- **B. État de l'écriture dans `TaggingRunStore`**
**Choix : A**
**Rationale :**
- Le commentaire de routage de `run_finished` et la rule `services.md` prévoient un store par phase ; l'écriture a son propre cycle (relance, rollback d'un run d'une autre session) que le run affiché n'a pas
