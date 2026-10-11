---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "protocole-ndjson-ecriture"
goal: "Exposer la confirmation globale et la relance de l'écriture sur le protocole NDJSON, avec les gardes qui figent le run et protègent une écriture en cours"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["04-phase-ecriture-sidecar-design.md"]
date: "2026-10-11"
---

# Protocole NDJSON de l'écriture

## Scope

Couvre les commandes `commit_run` et `retry_write` (modèles, unions, dispatch, écriture en tâche de fond), leurs gardes (`write_not_open`, `write_in_progress`), le gel du run confirmé pour l'arbitrage, la bascule de source et le rattrapage (`run_committed`), le refus d'un nouveau run pendant l'écriture, une écriture que ni `cancel_run` ni `shutdown` ne coupent, la traduction de la progression d'écriture, `run_finished(write)` et ses compteurs `written` et `write_error`, et le miroir TypeScript du contrat.

Exclut le service et le store Angular de l'écriture (sub-project 08), l'écran de confirmation et l'affichage des états (10), la commande `rollback` (06), et le rapport (Feature 6).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer des tests d'intégration qui, en conversant avec la boucle NDJSON sur une API simulée, résolvent un run, le confirment par `commit_run`, reçoivent `track_resolved(written)`, `progress(write)` et `run_finished(write)` avec le fichier renommé sur le disque, relancent un échec par `retry_write`, et lisent chaque refus (`write_not_open`, `write_in_progress`, `run_committed`) avec sa commande.

## Dependencies

- `04-phase-ecriture-sidecar-design.md` (statut: implemented) : `RunWriter`, `WriteProgress`, `WriteEvent`, états `written` / `write_error` et motifs d'écriture ; par lui, le dump (02) et sa `TagDumpWriteError`, `tag_dump.dump_dir`.

## Files touched

- **À modifier** : `sidecar/src/tagger/protocol.py` (`CommitRun`, `RetryWrite`, `AnyCommand`, `ExecutableCommand`, `CommandName`, `RunFinished.written` et `write_error`)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`CurrentRun.writer`, `committed` et `busy`, `handle_commit_run`, `handle_retry_write`, `PipelineEvent`, traduction de `WriteProgress`, `_run_finished(run, phase)`)
- **À modifier** : `sidecar/src/tagger/__main__.py` (`WriteNotOpenError`, `WriteInProgressError`, `RunCommittedError`, `_Session.commit_run`, `retry_write`, `_writable`, gardes de `start_tagging`, `_arbitrable` et `_recoverable`, dispatch, docstring de `close`)
- **À modifier** : `sidecar/tests/helpers/ndjson_loop.py` (`resolved_run` et `held_call`, partagés avec le sub-project 06)
- **À créer** : `sidecar/tests/integration/test_ndjson_write.py` (conversation d'écriture et ses refus)
- **À modifier** : `sidecar/tests/integration/test_ndjson_tagging.py` (`run_finished(network)` porte `written` et `write_error` à 0)
- **À modifier** : `src/app/core/models/protocol.ts` (`CommitRunCommand`, `RetryWriteCommand`, `TrackState`, `TrackFailureReason`, `RunFinishedEvent`)
- **À modifier** : `src/app/core/tagging-run.store.spec.ts`, `src/app/core/sidecar.service.spec.ts` (événements `run_finished` complétés des deux compteurs)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.write_not_open`, `errors.write_in_progress`, `errors.run_committed`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : `commit_run`, `retry_write`, `shutdown`, `cancel_run`, `start_tagging`, `run_finished`, refus et gel du run ; § Concurrence : l'écriture attendue comme l'extraction ; § Robustesse : un sidecar mort en pleine écriture)

## Architecture approach

- **Commandes strictes** (`extra="forbid"`, ADR-022, `.claude/rules/pydantic/modeles.md`) : `commit_run {run_id}` et `retry_write {run_id}`, ajoutées aux trois listes de `protocol.py` ; `test_command_name_lists_every_command` garde la recopie de `CommandName`
- **Écriture en tâche de fond** dans le `TaskGroup` de la session, comme l'extraction : stdin reste lu et la progression part en direct. `_phase` émet `run_finished(write)` à la fin, ou l'`error` d'une `TaggerError` avec sa commande
- **Garde `_writable(run_id)`** : `write_in_progress` si une écriture tourne (`rollback_in_progress` et `extraction_in_progress` pour les deux autres phases de fichiers, cf. 06) ; `write_not_open` sans run courant, sur un autre `run_id`, pendant la phase réseau ou pendant un geste d'arbitrage ou de rattrapage en vol (`CurrentRun.busy` : un geste qui finirait pendant l'écriture écraserait un morceau écrit). `commit_run` exige ensuite un run jamais confirmé, `retry_write` un run confirmé, sinon `write_not_open`
- **Run figé** : `CurrentRun.writer` est posé à la confirmation, sa présence (`committed`) refuse arbitrage, bascule de source et rattrapage en `run_committed` avec `params.track_id`. Quand la sauvegarde initiale du dump échoue, aucun fichier n'a été touché : le `writer` est retiré et le run redevient confirmable. Elle est la seule à lever vers la session, le sub-project 04 logue sans rien arrêter un échec de mise à jour du chemin renommé
- **Écriture protégée** : `start_tagging` refusé en `write_in_progress` pendant l'écriture ; `cancel_run` n'arrête que la phase réseau ; `shutdown` et l'EOF n'annulent jamais l'écriture, attendue par le `TaskGroup` de la boucle comme l'extraction (un fichier coupé en vol resterait à moitié écrit)
- **Événements** : `track_resolved` du `RunWriter` traduit comme ceux du pipeline (états `written`, `write_error`, motifs d'écriture) ; `WriteProgress` devient `progress(phase=write)`. `run_finished` compte `resolved`, `unresolved`, `written`, `write_error` et les attentes d'arbitrage sur l'état de chaque morceau, dans les deux phases
- **Traduction** : `to_protocol_event` couvre `PipelineEvent` (pipeline, arbitrage, rattrapage, écriture), `match` fermé par `assert_never` ; PLR0911 neutralisé avec sa justification, une sortie par événement traduit
- **Miroir TypeScript** (ADR-005, manuel) : commandes, `TrackState` (`written`, `write_error`), `TrackFailureReason` (six motifs), `RunFinishedEvent` (`written`, `write_error`). Le comportement de l'interface reste au sub-project 08, qui traite `write_in_progress` reçu sur `start_tagging` comme `tagging_in_progress` : il refuse un lancement sans clore le run affiché
- **Erreurs** dans `__main__.py`, à côté de `TaggingInProgressError`, traduites dans les deux langues (`.claude/rules/python/gestion-erreurs.md`, `.claude/rules/ngx-translate/i18n.md`, `.claude/rules/python/asyncio.md`, `.claude/rules/python/pattern-matching.md`)

## Acceptance criteria

### Scénario 1 : écriture de bout en bout
**GIVEN** un run fini dont l'unique morceau est résolu par Beatport
**WHEN** l'interface envoie `commit_run` avec son `run_id`
**THEN** elle reçoit `track_resolved(written)`, `progress(write, 1/1)` puis `run_finished(write)` avec `written` 1 et `write_error` 0
**AND** le fichier s'appelle `Lior Vance - Dim Orbit (Original Mix).mp3` et le dump du run existe

### Scénario 2 : relance d'un échec
**GIVEN** un run confirmé dont l'écriture a échoué sur un fichier verrouillé
**WHEN** le verrou est levé et l'interface envoie `retry_write`
**THEN** le morceau passe en `written` et `run_finished(write)` porte `written` 1, `write_error` 0

### Scénario 3 : run figé
**GIVEN** un run confirmé
**WHEN** l'interface envoie `resolve_by_url` sur un de ses morceaux
**THEN** elle reçoit `error` `run_committed`, `command` `resolve_by_url`, `params.track_id`

### Scénario 4 : écriture en cours
**GIVEN** une écriture en cours
**WHEN** l'interface envoie `commit_run`, `retry_write` ou `start_tagging`
**THEN** elle reçoit `error` `write_in_progress` portant la commande, et l'écriture se termine normalement

### Scénario 5 : arrêt pendant l'écriture
**GIVEN** une écriture en cours
**WHEN** l'interface envoie `cancel_run` puis `shutdown`
**THEN** l'écriture va à son terme, `run_finished(write)` part et le fichier est écrit

### Scénario 6 : écriture non ouverte
**GIVEN** un run courant
**WHEN** l'interface envoie `commit_run` pendant la phase réseau, sur un autre `run_id`, une seconde fois ou pendant un geste d'arbitrage ou de rattrapage en vol, ou `retry_write` avant toute confirmation
**THEN** elle reçoit `error` `write_not_open` portant la commande

## Tests à écrire

### Integration
- `sidecar/tests/integration/test_ndjson_write.py` :
  - écriture de bout en bout : événements, fichier renommé, dump présent
  - `commit_run` et `retry_write` sur un autre run : `write_not_open`
  - `commit_run` pendant la phase réseau : `write_not_open`
  - second `commit_run` : `write_not_open`
  - `retry_write` avant toute confirmation : `write_not_open`
  - arbitrage, bascule de source et rattrapage après confirmation : `run_committed` avec `track_id`
  - dump impossible à la confirmation : `tag_dump_write_failed`, puis la même confirmation réussit
  - relance d'un fichier verrouillé : `write_error` puis `written`
  - `commit_run`, `retry_write` et `start_tagging` pendant l'écriture : `write_in_progress`
  - `cancel_run` et `shutdown` pendant l'écriture : elle va à son terme
- `sidecar/tests/integration/test_ndjson_tagging.py` :
  - `run_finished(network)` porte `written` et `write_error` à 0

## Edge cases

- **Dump impossible** : `error` `tag_dump_write_failed` sur `commit_run`, aucun fichier touché ni morceau changé, run de nouveau confirmable
- **Morceau en attente d'arbitrage à la confirmation** : jamais écrit, et plus arbitrable une fois le run confirmé (l'interface le signale avant, sub-project 10)
- **Nouveau run après l'écriture** : accepté, il remplace le run courant ; la relance de l'ancien n'est plus possible
- **`retry_write` sans échec** : accepté, aucun fichier visé, `run_finished(write)` aux mêmes compteurs

## Architectural decisions

### Décision : run figé après confirmation
**Options envisagées :**
- **A. Run figé** : arbitrage et rattrapage refusés en `run_committed`, seuls la relance et le rollback restent
- **B. Décisions encore admises**, avec une seconde confirmation pour écrire les morceaux tranchés après coup
**Choix : A**
**Rationale :**
- Choix du propriétaire : la confirmation est le point de non-retour (DESIGN.md § Overlays), un écran qui reste ouvert aux décisions après écriture le brouillerait

### Décision : compteurs d'écriture dans `run_finished`
**Options envisagées :**
- **A. `written` et `write_error` ajoutés, remplis dans les deux phases** : un seul calcul sur l'état des morceaux
- **B. Un événement de fin d'écriture distinct** : un second type à mirrorer et à router, pour la même information
**Choix : A**
**Rationale :**
- ARCHITECTURE.md décrit déjà `run_finished` comme l'événement des deux phases, distinguées par `phase`
