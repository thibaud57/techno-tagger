---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "rollback-sidecar"
goal: "Restaurer depuis le dump disque les tags et le nom d'origine d'un morceau ou d'un run entier, y compris d'un run écrit dans une session précédente"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["02-dump-tags-origine-design.md", "03-renommage-fichiers-design.md", "04-phase-ecriture-sidecar-design.md", "05-protocole-ndjson-ecriture-design.md"]
date: "2026-10-11"
---

# Rollback côté sidecar

## Scope

Couvre la restauration d'un morceau depuis son entrée de dump (nom d'origine puis tags d'origine), la consommation du dump (entrée restaurée retirée, dump vide supprimé), la recherche du dernier run annulable, les commandes `get_rollback_target` et `rollback` (run entier ou morceau), les événements `rollback_target` et `rollback_finished`, l'état `rolled_back` du run affiché, le motif `name_taken`, les gardes de concurrence et le miroir TypeScript du contrat.

Exclut le service et le store Angular (sub-project 08), les boutons et confirmations de Tagging et des Réglages (11), ainsi que la restauration des pochettes et commentaires, que le dump ne garde pas (02).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer un test d'intégration qui écrit un run dans une première conversation NDJSON, ouvre une seconde conversation, y lit le run par `get_rollback_target`, le restaure par `rollback` et relit des fichiers revenus à leur nom et à leurs tags d'origine, le dump supprimé et `get_rollback_target` rendu à `null`.

## Dependencies

- `02-dump-tags-origine-design.md` (statut: implemented) : `TagDump`, `DumpEntry` et son `renamed_path`, `load_dump`, `dump_dir`, `dump_path`, `restore_tags` et `TagDumpUnreadableError`
- `03-renommage-fichiers-design.md` (statut: implemented) : `RenameError`, `extended_path`, `_taken_by_another_file` (casse seule)
- `04-phase-ecriture-sidecar-design.md` (statut: implemented) : `TrackState` et `FailureReason` étendus par l'écriture, `TrackRecord`, `RunWriter.retry` qui ne vise que `write_error`
- `05-protocole-ndjson-ecriture-design.md` (statut: implemented) : créneau d'écriture de la session, `CurrentRun`, `WriteInProgressError`, attente par `shutdown`, traduction `PipelineEvent`

## Files touched

- **À créer** : `sidecar/src/tagger/rollback.py` (restauration d'un morceau et d'un run, `RollbackTarget`, `find_rollback_target`, `RollbackSummary`, `RollbackFailure`, `RollbackUnavailableError`)
- **À modifier** : `sidecar/src/tagger/tag_dump.py` (`find_dump`, `dumps_newest_first` qui écarte les noms non reconnus, `remove_entries`, `dump_on_disk` rendu public, `record_renamed_path` qui place l'entrée renommée en fin de dump)
- **À modifier** : `sidecar/src/tagger/writing.py` (`RunWriter` relit le dump du disque avant de choisir les origines à sauvegarder)
- **À modifier** : `sidecar/src/tagger/renaming.py` (`restore_name`, `OriginalNameTakenError`)
- **À modifier** : `sidecar/src/tagger/tagging.py` (`TrackState.ROLLED_BACK`, `FailureReason.NAME_TAKEN`, `TrackRecord.rolled_back`, qui vide le candidat)
- **À modifier** : `sidecar/src/tagger/protocol.py` (`GetRollbackTarget`, `Rollback`, `RollbackTarget`, `RollbackFinished`, payloads, `AnyCommand`, `ExecutableCommand`, `CommandName`)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`handle_get_rollback_target`, `handle_rollback`)
- **À modifier** : `sidecar/src/tagger/__main__.py` (`RollbackInProgressError`, `_Session.rollback`, gardes de `start_tagging`, `commit_run`, `retry_write`, `extract_playlist`, `rollback`, attente dans `close`, dispatch)
- **À créer** : `sidecar/tests/unit/test_rollback.py` (restauration d'un morceau, d'un run, dernier run annulable)
- **À modifier** : `sidecar/tests/unit/test_tag_dump.py` (recherche par `run_id`, ordre, retrait d'entrées, suppression du dump vide)
- **À modifier** : `sidecar/tests/unit/test_renaming.py` (`restore_name`)
- **À modifier** : `sidecar/tests/unit/test_writing.py` (relance après un rollback du run affiché)
- **À créer** : `sidecar/tests/integration/test_ndjson_rollback.py` (conversations de rollback et refus)
- **À modifier** : `sidecar/tests/integration/test_ndjson_phases.py` (refus mutuel de l'extraction et du rollback)
- **À modifier** : `src/app/core/models/protocol.ts` (`GetRollbackTargetCommand`, `RollbackCommand` dans `SidecarCommand`, `RollbackTargetEvent`, `RollbackFinishedEvent`, `TrackState`, `TrackFailureReason`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.rollback_unavailable`, `errors.phase_busy`, `errors.original_name_taken`, `rollback.reason.name_taken`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : `get_rollback_target`, `rollback`, `rollback_target`, `rollback_finished`, `shutdown`, refus, chaînage des runs annulables ; état `rolled_back` dans la table des états, le diagramme et les filtres du récapitulatif ; motif `name_taken` ; § Concurrence ; § Données ; arborescence ; ordre de développement)
- **À modifier** : `docs/DESIGN.md` (filtres du récapitulatif lus sur `state`, un morceau `rolled_back` hors des trois filtres, alignés sur ARCHITECTURE.md)

## Architecture approach

- **Module `rollback.py` hors protocole**, rendu par rappel comme `writing.py` : `roll_back(folder, run_id, track_id, on_restored)` traite les entrées une à une par `asyncio.to_thread`, de la dernière écrite à la première. Il appelle `on_restored(track_id, path)` dans la boucle, `path` étant le chemin d'origine (`.claude/rules/python/asyncio.md`). L'ordre inverse de l'écriture rend d'abord le morceau écrit après les autres : son nom final peut être l'ancien nom d'un morceau écrit avant, que `restore_name` refuserait sinon en `name_taken`. L'ordre suivi est celui des renommages, relances comprises : `record_renamed_path` place l'entrée renommée en fin de dump
- **Un morceau, en sens inverse de l'écriture** :
  - fichier retrouvé sous `renamed_path`, sinon sous `path`, sinon `file_missing` ;
  - nom d'origine rendu par `restore_name`, qui lève `OriginalNameTakenError` si un autre fichier le porte (casse seule exclue, comme `_taken_by_another_file`) et `RenameError` sinon ;
  - tags rendus par `restore_tags`.
  Un fichier verrouillé échoue au renommage, avant que ses tags soient touchés
- **Rejouable** : un fichier déjà revenu à son nom n'est pas renommé, ses tags d'origine sont réécrits à l'identique. Une session coupée en plein rollback ou un dump non réécrit se rattrapent par un nouveau rollback
- **Consommation du dump**, réécrit une seule fois en fin de rollback par `remove_entries` : entrées restaurées retirées, entrées en échec gardées, fichier supprimé quand il est vide. Un morceau dont le fichier n'existe plus sous aucun nom (`file_missing`) sort aussi du dump quand le dossier de son chemin d'origine existe encore : rien à lui rendre plus tard, et son entrée ferait viser au bouton un run irrestaurable. Quand ce dossier a disparu (disque externe débranché, lettre de lecteur changée), l'entrée reste : le morceau échoue en `file_missing` mais ses tags d'origine survivent ; `get_rollback_target` peut continuer à viser ce run. Le dossier se teste par `extended_path`, comme le fichier. Un échec que le temps peut lever (`name_taken`, verrou, dossier absent) garde son entrée. Sur le run affiché, le morceau ainsi retiré du dump repart en `track_resolved` à `restorable: false`, son état inchangé : l'interface ne lui propose plus une restauration qui rendrait `rollback_unavailable`. L'échec de cette réécriture est logué en warning, sans erreur : les fichiers restaurés le sont ; le prochain rollback les rejoue sans dégât
- **Dernier run annulable** : `find_rollback_target` parcourt les dumps du plus récent au plus ancien (horodatage du nom, `dumps_newest_first`) et rend le premier lisible qui a des entrées. Seuls les fichiers au nom d'un dump comptent (horodatage reconnu). Un dump illisible est sauté et logué en warning. Le dossier affiché est le `folder` du run, enregistré dans le dump à l'écriture (une valeur, une source : celui de `start_tagging`), et non déduit du chemin commun des fichiers
- **Motif `name_taken`** dans `FailureReason` seul : l'extraction ne le produit jamais, `FileFailureReason` reste inchangé. `test_track_and_file_failures_share_no_name` garde les deux enums disjoints ; `test_every_shown_reason_has_a_translation` impose la phrase `rollback.reason.name_taken`
- **Commandes strictes** (`extra="forbid"`, ADR-022, `.claude/rules/pydantic/modeles.md`) : `get_rollback_target {}` et `rollback {run_id, track_id: str | None}`. `get_rollback_target` est traitée dans la boucle, comme `list_playlists`, puisqu'elle ne lit que quelques JSON. `rollback` part en tâche de fond dans le `TaskGroup`
- **Événements** : `rollback_target {run: {run_id, written_at, folder, tracks} | null}` et `rollback_finished {run_id, track_id, restored: [track_id], failed: [{track_id, file_name, reason}]}`. Sur le run courant, chaque morceau restauré passe en `rolled_back` dans `LiveRun` et part en `track_resolved`, qui ne porte plus ni source, ni scores, ni pochette, ni `after` ni `tags_after` : `rolled_back` vide le candidat, la ligne retombe à ce que le fichier contient, `resolution` restant pour que `_resolved` la lise. Un morceau en échec garde son état
- **Créneau unique pour les fichiers** : `_Session._rollback` à côté de `_write`. Un rollback est refusé en `phase_busy` dès qu'une phase longue tourne (`params.phase` à `tagging`, `write`, `extraction` ou `rollback`). `commit_run`, `retry_write`, `start_tagging` et `extract_playlist` sont refusés en `phase_busy` (`params.phase` à `rollback`) pendant un rollback. `cancel_run` ne le coupe pas, `shutdown` et l'EOF l'attendent (fichier coupé en plein renommage)
- **Erreurs** : `RollbackUnavailableError` (`rollback_unavailable`, `params.run_id` et `params.track_id` le cas échéant) dans `rollback.py` ; `PhaseBusyError` dans `__main__.py`, partagée par toutes les phases longues ; `TagDumpUnreadableError` (existante) sur un dump visé illisible (`.claude/rules/python/gestion-erreurs.md`, `.claude/rules/ngx-translate/i18n.md`)
- **Logs** sans nom de fichier ni titre : run et motifs seulement, clés du jeu fixe (CLAUDE.md, rien de personnel ; `.claude/rules/python/gestion-erreurs.md`)
- **Miroir TypeScript** manuel (ADR-005, `.claude/rules/typescript/types.md`) : les deux commandes rejoignent `SidecarCommand`, `TrackState` gagne `rolled_back`, `TrackFailureReason` gagne `name_taken`. Les deux événements rejoignent `SidecarEvent` avec leur routage au sub-project 08 : le `switch` exhaustif de `sidecar.service.ts` refuserait un événement non routé. Le comportement de l'interface reste aux sub-projects 08 et 11
- Autres rules : `.claude/rules/python/fichiers-io.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/python/modeles-donnees.md`, `.claude/rules/pytest/tests.md`, `.claude/rules/mutagen/tags.md`

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
**WHEN** l'interface envoie `rollback`, `commit_run`, `retry_write`, `start_tagging` ou `extract_playlist`
**THEN** elle reçoit `error` `phase_busy` (`params.phase` à `rollback`) portant la commande
**AND** le rollback se termine normalement

### Scénario 7 : rollback pendant une extraction
**GIVEN** une extraction en cours
**WHEN** l'interface envoie `rollback`
**THEN** elle reçoit `error` `phase_busy` (`params.phase` à `extraction`) portant la commande
**AND** l'extraction se termine normalement

### Scénario 8 : dossier d'origine introuvable
**GIVEN** un run écrit dont le dossier musical a disparu (disque externe débranché)
**WHEN** l'interface envoie `rollback`
**THEN** `rollback_finished` porte ses morceaux en échec `file_missing`
**AND** leurs entrées restent dans le dump : une fois le dossier revenu, un nouveau `rollback` les restaure

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_rollback.py` :
  - un fichier renommé reprend son nom puis ses tags d'origine
  - un nom d'origine pris par un autre fichier : échec `name_taken`, nom et tags inchangés
  - un nom qui ne diffère que par la casse n'est pas une collision
  - un fichier introuvable sous ses deux noms : échec `file_missing`
  - un morceau dont le dossier d'origine a disparu : échec `file_missing`, entrée gardée dans le dump
  - un tag restauré en échec (`TagsWriteError`) après le retour du nom : échec avec le nom d'origine, entrée gardée, un second rollback restaure le morceau
  - un fichier verrouillé au renommage : échec `file_locked`, tags inchangés
  - un fichier déjà revenu à son nom (rollback interrompu) est restauré sans renommage
  - un run : entrées restaurées et fichiers disparus (dossier présent) retirés du dump, entrée en échec (`name_taken`) gardée, dump vidé supprimé
  - un run est restauré dans l'ordre inverse de l'écriture : un ancien nom devenu le nom final d'un morceau écrit après est rendu sans `name_taken`
  - un morceau seul : les autres entrées restent
  - `run_id` sans dump ou morceau absent : `RollbackUnavailableError`
  - dernier run annulable : le plus récent qui a des entrées, dump illisible sauté, `None` sans dump, dossier enregistré dans le dump, le run précédent une fois le plus récent restauré en entier
  - dossier du run pris dans le dump, jamais déduit des fichiers (deux lecteurs sans ancêtre commun compris)
- `sidecar/tests/unit/test_tag_dump.py` :
  - `find_dump` retrouve le dump d'un `run_id`, `None` sinon
  - `dumps_newest_first` suit l'horodatage du nom et écarte un fichier au nom non reconnu
  - `remove_entries` retire les entrées et supprime le fichier vidé
  - `record_renamed_path` place l'entrée renommée après les autres
- `sidecar/tests/unit/test_writing.py` :
  - une relance sauvegarde de nouveau l'origine d'un échec dont un rollback a retiré l'entrée du disque
- `sidecar/tests/unit/test_renaming.py` :
  - `restore_name` rend le nom d'origine, refuse un nom pris, accepte un changement de casse seul

### Integration
- `sidecar/tests/integration/test_ndjson_rollback.py` :
  - état livré : écriture dans une conversation, `get_rollback_target` et `rollback` dans une seconde, fichier relu identique à l'origine
  - morceau du run affiché : `track_resolved(rolled_back)` sans source ni `after`, puis `retry_write` qui ne le réécrit pas
  - ancien run restauré pendant qu'un run plus récent du même dossier est affiché : aucun `rolled_back`, le fichier portant déjà son nom conforme pour que les `track_id` coïncident
  - `rollback` sans dump : `rollback_unavailable`
  - `rollback` pendant l'écriture ou la phase réseau : `phase_busy`, `params.phase` à `write` ou `tagging`
  - `rollback`, `commit_run`, `retry_write` et `start_tagging` pendant un rollback : `phase_busy`, `params.phase` à `rollback`
  - `shutdown` pendant un rollback : il va à son terme
- `sidecar/tests/integration/test_ndjson_phases.py` :
  - `rollback` pendant une extraction : `phase_busy`, `params.phase` à `extraction`
  - `extract_playlist` pendant un rollback : `phase_busy`, `params.phase` à `rollback`

## Edge cases

- **Run ouvert non confirmé sur le même dossier** : rollback accepté ; les morceaux de ce run dont le fichier a repris son nom d'origine échouent à l'écriture en `file_missing`, sans dégât
- **Fichier introuvable sous ses deux noms** : échec `file_missing`, et l'entrée sort du dump ou reste selon l'existence du dossier d'origine (Consommation du dump)
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

### Décision : fichier introuvable quand son dossier a disparu
**Options envisagées :**
- **A. Toujours oublier l'entrée** : tout `file_missing` sort du dump, y compris sur un disque externe débranché ou dont la lettre a changé
- **B. Garder l'entrée quand le dossier d'origine n'existe plus** : le morceau échoue en `file_missing`, le dump garde ses tags d'origine
- **C. Toujours garder l'entrée** : un fichier supprimé pour de bon maintient indéfiniment un run irrestaurable dans le dump
**Choix : B**
**Rationale :**
- Choix du propriétaire : un disque externe débranché fait échouer tous les morceaux en `file_missing` : A supprimerait le dump et ses tags d'origine pour toujours
- Dossier présent et fichier absent sous les deux noms : suppression délibérée, l'entrée sort du dump (C laisserait le bouton viser un run irrestaurable)
- Limite acceptée : un fichier présent sous un nouveau nom que le dump n'a pas noté (`renamed_path` non noté, cf. `writing._note_rename`) sort du dump, rien ne permet de le retrouver

### Décision : extraction et rollback se refusent mutuellement
**Options envisagées :**
- **A. Refus mutuel** : `rollback` refusé en `phase_busy` (`extraction`), `extract_playlist` refusé en `phase_busy` (`rollback`)
- **B. Rollback autorisé pendant l'extraction** : les deux phases tournent ensemble
**Choix : A**
**Rationale :**
- Choix du propriétaire : extraction et rollback touchent aux fichiers de l'utilisateur, deux phases mêlées pourraient viser le même dossier
- Une seule phase de fichiers à la fois, comme pour l'écriture (ARCHITECTURE.md § Concurrence)
