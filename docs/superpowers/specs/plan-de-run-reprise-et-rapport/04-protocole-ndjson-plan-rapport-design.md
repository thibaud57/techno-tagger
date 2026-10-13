---
feature: "Feature 6 : Plan de run, reprise et rapport"
subproject: "protocole-ndjson-plan-rapport"
goal: "Figer dans le contrat NDJSON la détection, la reprise et l'abandon d'un run interrompu, les rapports de re-tagging et les runs passés, avant tout TypeScript qui s'en sert"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["01-plan-run-sidecar-design.md", "02-reprise-run-sidecar-design.md", "03-rapport-re-tagging-sidecar-design.md"]
date: "2026-10-12"
---

# Contrat NDJSON du plan, de la reprise et des rapports

## Scope

Ce sub-project expose dans le contrat NDJSON le domaine des sub-projects 01 à 03 : cinq commandes (`get_interrupted_run`, `resume_run`, `discard_run`, `list_runs`, `load_run`), trois événements (`interrupted_run`, `runs_listed`, `run_loaded`), deux champs (`run_finished.report_path` et `track_resolved.source_url`) et le code d'erreur `run_not_found`. Il comprend leurs handlers, leur câblage dans la session, le miroir TypeScript (`protocol.ts` et les fixtures) livré avec chaque champ, la reconnaissance des nouveaux événements par `SidecarService` et la mise à jour du contrat dans `ARCHITECTURE.md`. Il exclut les stores et les composants de l'interface (sub-projects 05 à 07) : les trois nouveaux événements y sont reconnus, sans effet.

### État livré

À la fin de ce sub-project, on peut rejouer un crash réel par l'injection NDJSON, de bout en bout, sans interface :
1. un run est coupé par `shutdown` en pleine phase réseau ;
2. une nouvelle session le détecte par `get_interrupted_run`, le reprend par `resume_run`, puis le mène jusqu'à `run_finished` ;
3. après `commit_run`, `list_runs` le liste et `load_run` rend son récapitulatif sans rien rejouer.

## Dependencies

- `01-plan-run-sidecar-design.md` (statut: draft) : `PlanRecorder`, `RunPlan.opened`, `plan_dir`, `load_plan`, `RunPlanUnreadableError`, `CurrentRun.plan`, `CurrentRun.abandon` et `_open_plan(..., started_at=...)`, pour rebrancher le plan d'un run repris et abandonner celui d'un run remplacé.
- `02-reprise-run-sidecar-design.md` (statut: draft) : `detect_interrupted` (avec `active_run_id`), `InterruptedRun`, `UnreadablePlan`, `find_plan`, `discard_plan`, `reopen_run` (qui lève `TaggingFolderUnreadableError` sur un dossier sans audio), `PlanThresholds.to_matching` et `resolve_run` sélectif, qui font la reprise elle-même.
- `03-rapport-re-tagging-sidecar-design.md` (statut: draft) : `CurrentRun.report`, `load_tagging_report`, `TaggingReportUnreadableError`, `TaggingReport` (dont `TaggingReportTrack.system`), `list_reports` et `index_path`, que `run_finished` et les runs passés lisent.

## Files touched

- **À modifier** : `sidecar/src/tagger/protocol.py` :
  - commandes `GetInterruptedRun`, `ResumeRun`, `DiscardRun`, `ListRuns`, `LoadRun` ;
  - événements `InterruptedRunEvent`, `RunsListed`, `RunLoaded` et leurs charges ;
  - `RunFinished.report_path`, `TrackResolved.source_url` ;
  - unions `AnyCommand`, `ExecutableCommand`, `CommandName`.
- **À modifier** : `sidecar/src/tagger/handlers.py` :
  - `open_tagging` factorisé : ouverture des clients d'un côté, ouverture du run de l'autre (`open_resumed_tagging` pour la reprise) ;
  - `handle_get_interrupted_run`, `read_resumable_plan`, `handle_resume_run`, `handle_list_runs`, `handle_load_run` ;
  - `source_url` dans `_resolved` et `report_path` dans `_run_finished`.
- **À modifier** : `sidecar/src/tagger/errors.py` (`RunNotFoundError`).
- **À modifier** : `sidecar/src/tagger/__main__.py` (dispatch des cinq commandes ; `resume_run` sur la mécanique de `start_tagging` ; `load_run` en tâche de fond, refusée pendant une phase longue et annulée à la fermeture de la session).
- **À modifier** : `src/app/core/models/protocol.ts` (cinq commandes, trois événements, deux champs, `TrackLoaded` et charges).
- **À modifier** : `src/app/core/sidecar.service.ts` (`KNOWN_EVENTS`, cas sans effet dans `handleLine`).
- **À modifier** : `src/app/core/tagging-run.store.ts` : `restored()` construit un `track_resolved`, il porte `source_url: null`.
- **À modifier** : `src/fixtures/tagging.ts`, `src/fixtures/url-recovery.ts` (`source_url`) et `src/fixtures/write.ts` (`report_path` : `WRITE_FINISHED` porte un chemin, `NETWORK_FINISHED` l'étale et le remet à `null`).
- **À modifier** : `src/app/core/sidecar.service.spec.ts` et `src/app/core/tagging-run.store.spec.ts` : leurs littéraux `run_finished` portent `report_path`.
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.run_not_found`).
- **À créer** : `sidecar/tests/integration/test_ndjson_resume.py`.
- **À créer** : `sidecar/tests/integration/test_ndjson_reports.py`.
- **À modifier** : `sidecar/tests/integration/test_ndjson_tagging.py` (`report_path` dans le littéral exact de `run_finished`, `source_url`).
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : lignes de commandes et d'événements, champs ajoutés, `run_not_found`).

## Architecture approach

### Conventions du protocole

Les nouvelles commandes héritent de `Command` (`extra="forbid"`, `strict=True`, ADR-022) et les événements de `Event` (`frozen`). Les noms sont en snake_case, avec un discriminant `command` ou `event`. Le sidecar n'émet jamais de phrase, seulement un `code` et des `params` (ARCHITECTURE § API, `.claude/rules/pydantic/modeles.md`). Le protocole n'est pas versionné (ADR-018) : l'interface et le sidecar partent du même installeur et `get_version` couvre la divergence.

Chaque champ ajouté au contrat Python a, dans la même tâche et le même commit, son miroir `protocol.ts`, ses fixtures et ses specs TypeScript (`.claude/rules/pydantic/modeles.md`, les types TypeScript étant maintenus à la main).

### Détection et abandon

- **`get_interrupted_run`** répond `interrupted_run`. Son champ `run` est une union discriminée par `kind`, ou `null` :
  - `InterruptedRunPayload` (`kind: "interrupted"`) : `run_id`, `started_at`, `folder`, `processed`, `total`, `folder_missing` (dossier absent ou vidé de ses fichiers audio, cf. sub-project 02) ;
  - `UnreadablePlanPayload` (`kind: "unreadable"`) : `run_id`, `started_at`, `found`, `expected`, de quoi composer le message de l'ADR-018. `found` est la version trouvée (entier ou chaîne) ou `null` quand le plan n'en porte pas de lisible, parce que son JSON est corrompu ou n'est pas un objet. L'interface dit alors que le plan est illisible et non qu'il vient d'une version `null`.

  `handle_get_interrupted_run(active_run_id)` traduit `detect_interrupted(plan_dir(), dump_dir(), active_run_id=active_run_id)` par `asyncio.to_thread`. Le plan du run actuellement ouvert est vivant, jamais interrompu : la session passe son `run_id`, sinon `None`. Le modèle reprend le patron pull de `get_rollback_target` : l'interface demande, le sidecar n'émet rien de lui-même.
- **`discard_run(run_id)`** : refusé en `phase_busy` pendant une phase longue, qui peut tenir ce plan (une reprise en cours). Puis `find_plan` et `discard_plan`. Il répond par un nouvel `interrupted_run` : le plan suivant, ou `null`. La réponse exclut elle aussi le run ouvert.
  - Un `run_id` sans plan lève `RunNotFoundError`.
  - Sur le run courant, `discard_run` l'abandonne (`CurrentRun.abandon`), ce qui ferme le run et supprime son plan.

### Reprise

`resume_run(run_id)` suit la mécanique de `start_tagging` : `_ensure_idle`, phase `TAGGING` en tâche de fond. Le run affiché n'est abandonné qu'une fois le plan validé. Le handler enchaîne :
1. `read_resumable_plan` : `find_plan` (sinon `RunNotFoundError`), puis `load_plan` (sinon `RunPlanUnreadableError`), puis refus par `RunNotFoundError` si le plan est confirmé ou si le dump du run existe. Un plan confirmé ou dont des fichiers ont bougé n'est pas reprenable, comme le dit déjà la détection ;
2. abandon du run remplacé (`CurrentRun.abandon`) ;
3. ouverture des clients, puis des sources avec les seuils du plan (`PlanThresholds.to_matching`) ;
4. `reopen_run`, qui rejoue `run_started`, les décisions et `progress` ; un dossier disparu ou sans fichier audio lève `TaggingFolderUnreadableError`, qui remonte comme pour `start_tagging` ;
5. un `PlanRecorder` rebranché sur `RunPlan.opened(live, seuils, plan.started_at)`, qui garde le même fichier ;
6. adoption du run par la session, puis `resolve_run`, `run_finished` en phase `network` et la progression du rattrapage, comme `handle_start_tagging`.

`open_tagging` est factorisé : l'ouverture de la clé, des caches, du client et des pochettes est partagée et seul l'ouvreur du run diffère (`open_run` ou `reopen_run`).

### Runs passés

- **`list_runs`** répond `runs_listed` : une liste de `PastRunPayload` (`run_id`, `written_at`, `folder`, `report_path`), issue de `list_reports(index_path())`.
- **`load_run(run_id)`** répond `run_loaded`, qui porte `run_id`, `folder`, `generated_at` et `tracks`. Chaque `TrackLoaded` contient :
  - `track_id`, `file_name` ;
  - `artist` et `title` d'origine, lus dans les lignes `tags_before` ;
  - `state`, `resolution`, `failure_reason`, `source` ;
  - `after` (`TrackNames`) et `scores` (`TrackScores`, arrondis comme dans `track_resolved`) ;
  - `tags_before`, de même forme que dans `run_started` (`system` lu dans le rapport, `comment`, lignes) et `tags_after` ;
  - `source_url` ;
  - `artwork_path`, retéléchargé depuis `artwork_url` par le cache puis le CDN, sans clé API ni quota de l'API.

  `TrackLoaded` ne porte pas `restorable` : le récapitulatif d'un run passé est en lecture seule et la restauration reste dans les Réglages.

  Le rapport est relu par `load_tagging_report`, le point d'entrée de la migration (ADR-018 B). Un `run_id` absent du registre, ou dont le JSON a disparu, lève `RunNotFoundError`.

  `load_run` tourne en tâche de fond et ne touche à aucun fichier de musique. Il est refusé en `phase_busy` pendant une phase longue. Les pochettes passent par un `ArtworkFetcher` ouvert pour la tâche, dont le pool est borné et la tâche est annulée à la fermeture de la session. Il n'emprunte pas le cache du run vivant.

### Champs ajoutés

- **`run_finished.report_path`** : `CurrentRun.report.json_path` en phase `write`, `null` en phase `network` ou si le rapport n'a pas pu être écrit. C'est le pendant de `extraction_finished.report_path`.
- **`track_resolved.source_url`** : `candidate.url`, `null` sans candidat. L'interface ne dépend pas de la ligne `url` du détail.

### Erreur

`RunNotFoundError(TaggerError)` porte le code `run_not_found` et le param `run_id`. La commande en échec est déjà portée par l'événement `error`. Sa traduction FR et EN dit le geste qui répare (`.claude/rules/python/gestion-erreurs.md`, `.claude/rules/ngx-translate/i18n.md`).

### Miroir TypeScript

Le miroir est maintenu à la main (ADR-005) :
- `protocol.ts` reçoit les cinq commandes, les trois événements avec leurs charges en unions discriminées (`.claude/rules/typescript/types.md`), `source_url` et `report_path` ;
- `SidecarService` complète `KNOWN_EVENTS` ;
- dans le `switch` de `handleLine`, fermé par `never`, les trois nouveaux événements sont reconnus sans effet jusqu'à leurs stores (sub-projects 05 et 07) ;
- les fixtures partagées, `restored()` du store et les littéraux des specs reçoivent les champs ajoutés.

### Dispatch

Le `match` de `_dispatch` reste fermé par `assert_never` (`.claude/rules/python/pattern-matching.md`). Toute I/O passe par `asyncio.to_thread` et toute tâche est nommée et gardée par référence forte (`.claude/rules/python/asyncio.md`).

### Conventions

`.claude/rules/python/type-hints.md`, `.claude/rules/mypy/strict.md`, `.claude/rules/ruff/lint-format.md`, `.claude/rules/angular/services.md`, `.claude/rules/angular/tests.md`, `.claude/rules/pytest/tests.md`.

## Acceptance criteria

### Scénario 1 : aucun run interrompu
**GIVEN** un dossier de données sans plan
**WHEN** l'interface envoie `get_interrupted_run`
**THEN** le sidecar répond `interrupted_run` avec `run` nul

### Scénario 2 : reprise après un crash
**GIVEN** un run de deux morceaux dont la phase réseau a été coupée par `shutdown` après le premier
**WHEN** une nouvelle session envoie `get_interrupted_run`, puis `resume_run` avec le `run_id` annoncé
**THEN** `interrupted_run` annonce 1 morceau traité sur 2, avec le dossier et la date du run
**AND** `resume_run` rejoue `run_started` et le `track_resolved` du premier morceau, puis ne recherche que le second et finit par `run_finished` en phase `network`

### Scénario 3 : plan d'une autre version
**GIVEN** un plan dont la `schema_version` vaut 2
**WHEN** l'interface envoie `get_interrupted_run`
**THEN** `run` porte `kind` `unreadable`, son `run_id`, `found` 2 et `expected` 1

### Scénario 4 : plan corrompu
**GIVEN** un plan dont le contenu n'est pas du JSON
**WHEN** l'interface envoie `get_interrupted_run`
**THEN** `run` porte `kind` `unreadable`, son `run_id`, `found` nul et `expected` 1, de quoi dire que le plan est illisible plutôt que d'une autre version

### Scénario 5 : le run ouvert n'est pas annoncé
**GIVEN** un run ouvert dans la session, dont le plan est sur le disque
**WHEN** l'interface envoie `get_interrupted_run`
**THEN** le sidecar répond `interrupted_run` avec `run` nul

### Scénario 6 : abandon
**GIVEN** un run interrompu détecté
**WHEN** l'interface envoie `discard_run` avec son `run_id`
**THEN** le plan disparaît et le sidecar répond `interrupted_run` avec `run` nul

### Scénario 7 : abandon pendant qu'un run est ouvert
**GIVEN** un plan interrompu sur le disque et un autre run ouvert dans la session
**WHEN** l'interface envoie `discard_run` avec le `run_id` du plan interrompu
**THEN** le plan disparaît et `interrupted_run` répond `run` nul, le run ouvert n'étant pas annoncé

### Scénario 8 : run inconnu
**GIVEN** aucun plan ni rapport pour le `run_id` `000000`
**WHEN** l'interface envoie `resume_run`, `discard_run` ou `load_run` avec ce `run_id`
**THEN** le sidecar répond `error` avec le code `run_not_found`, la commande et le param `run_id`

### Scénario 9 : plan non reprenable
**GIVEN** un plan confirmé, ou un plan ouvert dont le run a un dump et un autre run ouvert dans la session
**WHEN** l'interface envoie `resume_run` avec le `run_id` de ce plan
**THEN** le sidecar répond `error` avec le code `run_not_found`
**AND** le plan reste sur le disque et le run ouvert n'est pas abandonné

### Scénario 10 : dossier disparu ou vidé
**GIVEN** un run interrompu dont le dossier a été supprimé, ou vidé de ses fichiers audio
**WHEN** l'interface envoie `resume_run`
**THEN** le sidecar répond `error` avec le code `tagging_folder_unreadable`

### Scénario 11 : rapport et runs passés
**GIVEN** un run écrit par `commit_run`
**WHEN** l'interface reçoit `run_finished` en phase `write`, puis envoie `list_runs` et `load_run`
**THEN** `run_finished.report_path` désigne le JSON du rapport et `runs_listed` le liste
**AND** `run_loaded` rend le morceau écrit avec ses noms avant et après, son `source_url` et une pochette

### Scénario 12 : lien vers la fiche source en direct
**GIVEN** un morceau résolu sur Beatport
**WHEN** le sidecar émet son `track_resolved`
**THEN** `source_url` vaut l'URL du candidat retenu

## Tests à écrire

### Unit
Aucun test unitaire neuf. La garde existante de `test_protocol_models.py` (`test_command_name_lists_every_command`) échoue tant que `CommandName` ne liste pas une commande ajoutée. La validation des champs d'une commande est celle de Pydantic, non testée ici (no-lib-test). Côté interface, aucun test non plus : `KNOWN_EVENTS` et le `switch` fermé par `never` font de l'oubli d'un événement une erreur de typecheck et ces trois événements n'ont encore aucun effet à observer.

### Integration
- `sidecar/tests/integration/test_ndjson_resume.py` :
  - `get_interrupted_run` sans plan, avec un plan ouvert, avec un plan d'une autre version, avec un plan corrompu (scénarios 1, 3 et 4)
  - le run ouvert n'est pas annoncé (scénario 5)
  - crash réel puis reprise dans une seconde conversation (scénario 2)
  - `resume_run` sans clé API garde le plan
  - `resume_run` sur un run inconnu, sur un plan confirmé, sur un plan dont le run a un dump, sans abandonner le run ouvert (scénarios 8 et 9)
  - `resume_run` sur un dossier disparu et sur un dossier vidé (scénario 10)
  - `discard_run` supprime le plan et annonce le suivant, sans annoncer le run ouvert (scénarios 6 et 7)
  - `discard_run` sur le run courant le ferme et supprime son plan et pendant une phase longue il est refusé en `phase_busy`
- `sidecar/tests/integration/test_ndjson_reports.py` :
  - `run_finished` porte `report_path` en phase `write`, `null` en phase `network`
  - `list_runs` puis `load_run` après un `commit_run` (scénario 11)
  - `load_run` sur un run inconnu rend `run_not_found`, sur un rapport illisible `tagging_report_unreadable`, pendant une phase longue `phase_busy`
  - `load_run` rend le morceau sans pochette quand le CDN la refuse
  - la fermeture de la session annule un `load_run` en cours
- `sidecar/tests/integration/test_ndjson_tagging.py` :
  - le littéral de `run_finished` porte `report_path` nul
  - `track_resolved` porte le `source_url` du candidat retenu (scénario 12)

## Edge cases

- **`resume_run` pendant une phase longue** : il est refusé en `phase_busy`, comme `start_tagging`.
- **`resume_run` sans clé API** : il est refusé en `api_key_missing` avant toute ouverture, comme `start_tagging`. Le plan reste en place.
- **`resume_run` d'un plan refusé** (confirmé, dump présent, inconnu) : `run_not_found`, sans effet sur le plan ni sur le run affiché. Le run affiché n'est abandonné qu'une fois le plan validé.
- **`discard_run` pendant une phase longue** : `phase_busy`, pour ne pas supprimer sous elle le plan d'une reprise en cours.
- **`load_run` pendant une phase longue** : `phase_busy`, la tâche n'est pas une phase longue mais elle télécharge des pochettes.
- **`load_run` hors ligne** : une pochette absente du cache reste nulle et le morceau est rendu quand même.
- **`load_run` pendant un geste de rattrapage ou d'arbitrage en vol** : il ouvre son propre cache de pochettes sur le même dossier, dont l'ouverture supprime les temporaires. Un téléchargement du run vivant qui y était en cours échoue alors, son morceau continuant sans pochette.
- **Rapport supprimé entre `list_runs` et `load_run`** : `run_not_found`.
- **`discard_run` d'un plan qu'on ne peut pas supprimer** : la suppression ratée est logguée (sub-project 02) et `interrupted_run` annonce à nouveau ce plan.

## Architectural decisions

### Décision : annonce du run interrompu
**Options envisagées :**
- **A. Commande `get_interrupted_run` et événement `interrupted_run`** : l'interface demande quand elle est prête, sur le patron de `get_rollback_target`.
- **B. Événement émis spontanément après `version`** : ce serait le premier événement non sollicité du protocole et sa réception dépendrait de l'ordre de démarrage de l'interface.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- `discard_run` réutilise la même réponse pour annoncer le plan suivant.

### Décision : ordre de la reprise
**Options envisagées :**
- **A. Valider le plan, puis abandonner le run affiché, puis rouvrir** : un refus à la validation laisse le run affiché et le plan intacts, un refus à la réouverture survient après l'abandon.
- **B. Abandonner d'abord, comme `start_tagging`** : un seul chemin pour les deux lancements, mais un `resume_run` refusé a déjà supprimé le plan du run affiché, voire celui qu'il voulait reprendre.
- **C. Valider le plan, rouvrir le run repris, puis seulement retirer le run affiché** : tout ce qui peut refuser (plan, clé API, clients, dossier) passe avant l'abandon.

**Choix : C** (révisé le 2026-10-13, A le 2026-10-12)

**Rationale :**
- Choix du propriétaire.
- Aucun refus ne coûte le run en cours ni son plan : ses décisions restent reprenables au lancement suivant.

### Décision : restaurabilité dans un récapitulatif passé
**Options envisagées :**
- **A. Pas de `restorable` sur `TrackLoaded`** : le récapitulatif d'un run passé est en lecture seule, la restauration reste dans les Réglages.
- **B. `restorable` lu sur le dump du run** : un bouton de restauration par morceau, mais le handler doit lire le dump et le champ vaut faux dès que le dump a expiré.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le récapitulatif d'un run passé ne propose aucune action : le champ n'aurait aucun lecteur.

### Décision : pochettes d'un run passé
**Options envisagées :**
- **A. Retéléchargées par `load_run`**, cache d'abord puis CDN : le récapitulatif rouvert ressemble au récapitulatif vivant.
- **B. Aucune** : `load_run` ne fait aucun appel réseau, mais la colonne Pochette reste vide.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le CDN des sources ne consomme ni la clé ni le quota de l'API et le cache sert la plupart des runs récents.

### Décision : lien vers la fiche source
**Options envisagées :**
- **A. Champ `source_url` dédié** sur `track_resolved` et sur les morceaux de `run_loaded`.
- **B. Lecture de la ligne `url` de `tags_after`** : rien à ajouter, mais l'interface dépendrait de l'ordre et du contenu du détail.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le lien est une donnée de navigation, pas un tag affiché.
