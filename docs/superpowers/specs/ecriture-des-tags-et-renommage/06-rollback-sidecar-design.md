---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "rollback-sidecar"
goal: "Restaurer depuis le dump disque les tags et le nom d'origine d'un morceau ou d'un run entier, y compris d'un run écrit dans une session précédente"
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: ["02-dump-tags-origine-design.md", "03-renommage-fichiers-design.md", "04-phase-ecriture-sidecar-design.md", "05-protocole-ndjson-ecriture-design.md"]
date: "2026-10-06"
---

# Rollback côté sidecar

## Scope

Couvre la restauration d'un morceau depuis son entrée de dump (nom d'origine puis tags d'origine), la consommation du dump (entrée restaurée retirée, dump vide supprimé), la recherche du dernier run annulable, les commandes `get_rollback_target` et `rollback` (run entier ou morceau), les événements `rollback_target` et `rollback_finished`, l'état `rolled_back` du run affiché, le motif `name_taken`, les gardes de concurrence et le miroir TypeScript du contrat.

Exclut le service et le store Angular (sub-project 08), les boutons et confirmations de Tagging et des Réglages (11), et la restauration des pochettes et commentaires, que le dump ne garde pas (02).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer un test d'intégration qui écrit un run dans une première conversation NDJSON, ouvre une seconde conversation, y lit le run par `get_rollback_target`, le restaure par `rollback` et relit des fichiers revenus à leur nom et à leurs tags d'origine, le dump supprimé et `get_rollback_target` rendu à `null`.

## Dependencies

- `02-dump-tags-origine-design.md` (statut: draft) : `TagDump`, `DumpEntry` et son `renamed_path`, `load_dump`, `dump_dir`, `dump_path`, `restore_tags` et `TagDumpUnreadableError`
- `03-renommage-fichiers-design.md` (statut: draft) : `RenameError`, `extended_path`, `_taken_by_another_file` (casse seule)
- `04-phase-ecriture-sidecar-design.md` (statut: draft) : `TrackState` et `FailureReason` étendus par l'écriture, `TrackRecord`, `RunWriter.retry` qui ne vise que `write_error`
- `05-protocole-ndjson-ecriture-design.md` (statut: draft) : créneau d'écriture de la session, `CurrentRun`, `WriteInProgressError`, attente par `shutdown`, traduction `PipelineEvent`

## Files touched

- **À créer** : `sidecar/src/tagger/rollback.py` (restauration d'un morceau et d'un run, `RollbackTarget`, `find_rollback_target`, `RollbackSummary`, `RollbackFailure`, `RollbackUnavailableError`)
- **À modifier** : `sidecar/src/tagger/tag_dump.py` (`find_dump`, `dumps_newest_first` qui écarte les noms non reconnus, `remove_entries`)
- **À modifier** : `sidecar/src/tagger/renaming.py` (`restore_name`, `OriginalNameTakenError`)
- **À modifier** : `sidecar/src/tagger/tagging.py` (`TrackState.ROLLED_BACK`, `FailureReason.NAME_TAKEN`, `TrackRecord.rolled_back`, qui vide le candidat)
- **À modifier** : `sidecar/src/tagger/protocol.py` (`GetRollbackTarget`, `Rollback`, `RollbackTarget`, `RollbackFinished`, payloads, `AnyCommand`, `ExecutableCommand`, `CommandName`)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`handle_get_rollback_target`, `handle_rollback`)
- **À modifier** : `sidecar/src/tagger/__main__.py` (`RollbackInProgressError`, `_Session.rollback`, gardes de `start_tagging`, `commit_run`, `retry_write`, attente dans `close`, dispatch)
- **À créer** : `sidecar/tests/unit/test_rollback.py` (restauration d'un morceau, d'un run, dernier run annulable)
- **À modifier** : `sidecar/tests/unit/test_tag_dump.py` (recherche par `run_id`, ordre, retrait d'entrées, suppression du dump vide)
- **À modifier** : `sidecar/tests/unit/test_renaming.py` (`restore_name`)
- **À créer** : `sidecar/tests/integration/test_ndjson_rollback.py` (conversations de rollback et refus)
- **À modifier** : `src/app/core/models/protocol.ts` (`GetRollbackTargetCommand`, `RollbackCommand` dans `SidecarCommand`, `RollbackTargetEvent`, `RollbackFinishedEvent` déclarés hors `SidecarEvent`, `TrackState`, `TrackFailureReason`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.rollback_unavailable`, `errors.rollback_in_progress`, `errors.original_name_taken`, `tagging.reason.name_taken`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : `get_rollback_target`, `rollback`, `rollback_target`, `rollback_finished`, `shutdown`, refus, chaînage des runs annulables ; état `rolled_back` dans la table des états, le diagramme et les filtres du récapitulatif ; motif `name_taken` ; § Concurrence ; § Données ; arborescence ; ordre de développement)

## Architecture approach

- **Module `rollback.py` hors protocole**, rendu par rappel comme `writing.py` : `roll_back(folder, run_id, track_id, on_restored)` traite les entrées une à une par `asyncio.to_thread`, de la dernière écrite à la première, et appelle `on_restored(track_id, path)` dans la boucle, `path` étant le chemin d'origine (`.claude/rules/python/asyncio.md`). L'ordre inverse de l'écriture rend d'abord le morceau écrit après les autres : son nom final peut être l'ancien nom d'un morceau écrit avant, que `restore_name` refuserait sinon en `name_taken`
- **Un morceau, en sens inverse de l'écriture** :
  - fichier retrouvé sous `renamed_path`, sinon sous `path`, sinon `file_missing` ;
  - nom d'origine rendu par `restore_name`, qui lève `OriginalNameTakenError` si un autre fichier le porte (casse seule exclue, comme `_taken_by_another_file`) et `RenameError` sinon ;
  - tags rendus par `restore_tags`.
  Un fichier verrouillé échoue au renommage, avant que ses tags soient touchés
- **Rejouable** : un fichier déjà revenu à son nom n'est pas renommé, et ses tags d'origine sont réécrits à l'identique. Une session coupée en plein rollback ou un dump non réécrit se rattrapent par un nouveau rollback
- **Consommation du dump**, réécrit une seule fois en fin de rollback par `remove_entries` : entrées restaurées retirées, entrées en échec gardées, fichier supprimé quand il est vide. Un morceau dont le fichier n'existe plus sous aucun nom (`file_missing`) sort aussi du dump : rien à lui rendre plus tard, et son entrée ferait viser au bouton un run irrestaurable. Seul un échec que le temps peut lever (`name_taken`, verrou) garde son entrée. L'échec de cette réécriture est logué en warning, sans erreur : les fichiers restaurés le sont, et le prochain rollback les rejoue sans dégât
- **Dernier run annulable** : `find_rollback_target` parcourt les dumps du plus récent au plus ancien (horodatage du nom, `dumps_newest_first`) et rend le premier lisible qui a des entrées. Seuls les fichiers au nom d'un dump comptent (horodatage reconnu). Un dump illisible est sauté et logué en warning. Le dossier affiché est le chemin commun des fichiers d'origine, déduit et non stocké (une valeur, une source)
- **Motif `name_taken`** dans `FailureReason` seul : l'extraction ne le produit jamais, `FileFailureReason` reste inchangé. `test_track_failures_carry_every_file_failure_under_the_same_name` tient toujours, et `test_every_shown_reason_has_a_translation` impose la phrase `tagging.reason.name_taken`
- **Commandes strictes** (`extra="forbid"`, ADR-022, `.claude/rules/pydantic/modeles.md`) : `get_rollback_target {}` et `rollback {run_id, track_id: str | None}`. `get_rollback_target` est traitée dans la boucle, comme `list_playlists`, puisqu'elle ne lit que quelques JSON. `rollback` part en tâche de fond dans le `TaskGroup`
- **Événements** : `rollback_target {run: {run_id, written_at, folder, tracks} | null}` et `rollback_finished {run_id, track_id, restored: [track_id], failed: [{track_id, file_name, reason}]}`. Sur le run courant, chaque morceau restauré passe en `rolled_back` dans `LiveRun` et part en `track_resolved`, qui ne porte plus ni source, ni scores, ni pochette, ni `after` ni `tags_after` : `rolled_back` vide le candidat, la ligne retombe à ce que le fichier contient, `resolution` restant pour que `_resolved` la lise. Un morceau en échec garde son état
- **Créneau unique pour les fichiers** : `_Session._rollback` à côté de `_write`. Un rollback est refusé en `tagging_in_progress` pendant la phase réseau, en `write_in_progress` pendant l'écriture, en `rollback_in_progress` pendant un autre rollback. `commit_run`, `retry_write` et `start_tagging` sont refusés en `rollback_in_progress` pendant un rollback. `cancel_run` ne le coupe pas, `shutdown` et l'EOF l'attendent (fichier coupé en plein renommage)
- **Erreurs** : `RollbackUnavailableError` (`rollback_unavailable`, `params.run_id` et `params.track_id` le cas échéant) dans `rollback.py` ; `RollbackInProgressError` dans `__main__.py` à côté de `WriteInProgressError` ; `TagDumpUnreadableError` (existante) sur un dump visé illisible (`.claude/rules/python/gestion-erreurs.md`, `.claude/rules/ngx-translate/i18n.md`)
- **Logs** sans nom de fichier ni titre : run et motifs seulement, clés du jeu fixe (CLAUDE.md, rien de personnel ; `.claude/rules/python/gestion-erreurs.md`)
- **Miroir TypeScript** manuel (ADR-005, `.claude/rules/typescript/types.md`) : les deux commandes rejoignent `SidecarCommand`, `TrackState` gagne `rolled_back`, `TrackFailureReason` gagne `name_taken`. Les deux événements sont déclarés mais ne rejoignent `SidecarEvent` qu'au sub-project 08 avec leur routage : le `switch` exhaustif de `sidecar.service.ts` refuserait un événement non routé, et l'interface n'émet aucune des deux commandes avant. Le comportement de l'interface reste aux sub-projects 08 et 11
- Autres rules : `.claude/rules/python/fichiers-io.md`, `.claude/rules/python/pattern-matching.md`, `.claude/rules/python/modeles-donnees.md`, `.claude/rules/pytest/tests.md`, `.claude/rules/mutagen/tags.md`

## Acceptance criteria

### Scénario 1 : rollback d'un run d'une session précédente
**GIVEN** un run écrit dans une conversation fermée depuis, son fichier renommé en `Adam Beyer - Your Mind (Original Mix).mp3`
**WHEN** une nouvelle conversation envoie `get_rollback_target` puis `rollback` avec le `run_id` reçu
**THEN** elle reçoit `rollback_target` avec ce run, son dossier et 1 morceau, puis `rollback_finished` avec 1 restauré et 0 échec
**AND** le fichier a repris son nom et ses tags d'origine, le dump est supprimé et `get_rollback_target` rend `run: null`

### Scénario 2 : rollback d'un morceau du run affiché
**GIVEN** le run courant écrit, deux morceaux `written`
**WHEN** l'interface envoie `rollback` avec son `run_id` et le `track_id` du premier
**THEN** elle reçoit `track_resolved(rolled_back)` pour ce morceau puis `rollback_finished` qui ne nomme que lui
**AND** le second reste écrit et `get_rollback_target` vise toujours le run avec 1 morceau

### Scénario 3 : nom d'origine pris
**GIVEN** un run écrit dont le nom d'origine d'un fichier est depuis porté par un autre fichier
**WHEN** l'interface envoie `rollback`
**THEN** `rollback_finished` porte ce morceau en échec `name_taken`, son nom et ses tags inchangés
**AND** il reste dans le dump : après suppression de l'autre fichier, un nouveau `rollback` le restaure

### Scénario 4 : chaînage des runs annulables
**GIVEN** deux runs A puis B écrits
**WHEN** l'interface restaure B en entier
**THEN** `get_rollback_target` vise A

### Scénario 5 : rien à restaurer
**GIVEN** un `run_id` sans dump, ou un morceau absent du dump
**WHEN** l'interface envoie `rollback`
**THEN** elle reçoit `error` `rollback_unavailable` portant la commande et le `run_id` ou le `track_id`

### Scénario 6 : opérations de fichiers concurrentes
**GIVEN** un rollback en cours
**WHEN** l'interface envoie `rollback`, `commit_run`, `retry_write` ou `start_tagging`
**THEN** elle reçoit `error` `rollback_in_progress` portant la commande, et le rollback se termine normalement

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_rollback.py` :
  - un fichier renommé reprend son nom puis ses tags d'origine
  - un nom d'origine pris par un autre fichier : échec `name_taken`, nom et tags inchangés
  - un nom qui ne diffère que par la casse n'est pas une collision
  - un fichier introuvable sous ses deux noms : échec `file_missing`
  - un fichier verrouillé au renommage : échec `file_locked`, tags inchangés
  - un fichier déjà revenu à son nom (rollback interrompu) est restauré sans renommage
  - un run : entrées restaurées et fichiers disparus retirés du dump, entrée en échec (`name_taken`) gardée, dump vidé supprimé
  - un run est restauré dans l'ordre inverse de l'écriture : un ancien nom devenu le nom final d'un morceau écrit après est rendu sans `name_taken`
  - un morceau seul : les autres entrées restent
  - `run_id` sans dump ou morceau absent : `RollbackUnavailableError`
  - dernier run annulable : le plus récent qui a des entrées, dump illisible sauté, `None` sans dump, dossier commun des fichiers, le run précédent une fois le plus récent restauré en entier
- `sidecar/tests/unit/test_tag_dump.py` :
  - `find_dump` retrouve le dump d'un `run_id`, `None` sinon
  - `dumps_newest_first` suit l'horodatage du nom et écarte un fichier au nom non reconnu
  - `remove_entries` retire les entrées et supprime le fichier vidé
- `sidecar/tests/unit/test_renaming.py` :
  - `restore_name` rend le nom d'origine, refuse un nom pris, accepte un changement de casse seul

### Integration
- `sidecar/tests/integration/test_ndjson_rollback.py` :
  - état livré : écriture dans une conversation, `get_rollback_target` et `rollback` dans une seconde, fichier relu identique à l'origine
  - morceau du run affiché : `track_resolved(rolled_back)` sans source ni `after`, puis `retry_write` qui ne le réécrit pas
  - ancien run restauré pendant qu'un run plus récent du même dossier est affiché : aucun `rolled_back`, le fichier portant déjà son nom conforme pour que les `track_id` coïncident
  - `rollback` sans dump : `rollback_unavailable`
  - `rollback` pendant l'écriture : `write_in_progress` ; pendant la phase réseau : `tagging_in_progress`
  - `rollback`, `commit_run`, `retry_write` et `start_tagging` pendant un rollback : `rollback_in_progress`
  - `shutdown` pendant un rollback : il va à son terme

## Edge cases

- **Run ouvert non confirmé sur le même dossier** : rollback accepté ; les morceaux de ce run dont le fichier a repris son nom d'origine échouent à l'écriture en `file_missing`, sans dégât
- **Fichier introuvable sous ses deux noms** : échec `file_missing`, et l'entrée sort du dump
- **Morceau en `write_error`** : restaurable, ses tags ont pu être écrits avant l'échec du renommage ; sans effet s'il n'a rien reçu
- **Dump non réécrit en fin de rollback** : warning logué, `rollback_finished` inchangé ; les entrées restaurées restent et le prochain rollback les rejoue à l'identique
- **Dump visé illisible** : `error` `tag_dump_unreadable` sur `rollback`, aucun fichier touché
- **Limite acceptée** : un fichier renommé disparu dont le nom d'origine est porté par un autre fichier reçoit les tags d'origine, rien ne les distinguant
- **Pochettes et commentaires** : non restaurés, le dump ne les garde pas (02) ; la confirmation de l'interface ne doit pas promettre plus (11)

## Architectural decisions

### Décision : chaînage des runs annulables
**Options envisagées :**
- **A. Entrées consommées** : un morceau restauré sort du dump, un dump vide est supprimé, le dernier run annulable devient le précédent
- **B. Dump gardé tel quel** : un second rollback rejoue le même run, les runs antérieurs ne sont plus atteignables depuis les Réglages
- **C. Un seul rollback** : bouton grisé jusqu'au prochain run écrit
**Choix : A**
**Rationale :**
- Choix du propriétaire : annulation en pile du plus récent au plus ancien, sur les 30 jours du dump ; un échec reste dans le dump et se retente au clic suivant

### Décision : nom d'origine pris par un autre fichier
**Options envisagées :**
- **A. Échec du morceau, rien touché** : motif `name_taken`, entrée gardée pour un nouveau rollback
- **B. Tags rendus, nom actuel gardé** : restauration partielle
- **C. Suffixe ` (2)`** comme à l'écriture
**Choix : A**
**Rationale :**
- Choix du propriétaire : les logiciels DJ retrouvent un fichier par son chemin exact, un nom approchant ne rétablit pas leurs références
- Renommer avant de toucher aux tags garde le morceau entier ou intact, jamais à moitié

### Décision : dernier run décrit par le sidecar
**Options envisagées :**
- **A. `get_rollback_target`** : date, dossier et nombre de morceaux, bouton grisé sans run annulable
- **B. `rollback` sans `run_id`** : message générique, erreur après le clic s'il n'y a rien
**Choix : A**
**Rationale :**
- Choix du propriétaire : la confirmation nomme le run, on n'annule pas le mauvais par erreur
