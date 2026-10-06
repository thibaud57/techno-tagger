---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "phase-ecriture-sidecar"
goal: "Appliquer sur le disque un run confirmé, dump des tags d'origine d'abord puis tags, pochette et renommage morceau par morceau, et rejouer ses seuls échecs d'écriture"
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: ["01-ecriture-tags-design.md", "02-dump-tags-origine-design.md", "03-renommage-fichiers-design.md"]
date: "2026-10-06"
---

# Phase d'écriture d'un run

## Scope

Couvre l'enchaînement de l'écriture d'un run vivant hors protocole : choix des morceaux visés, dump des tags d'origine en une passe avant le premier fichier, écriture des tags et de la pochette puis renommage morceau par morceau, états `written` et `write_error` avec les six motifs de fichier, chemin renommé noté dans le dump et dans le morceau, résultat de l'écriture gardé pour le rapport, relance des seuls échecs, événements par morceau et progression, logs.

Exclut les commandes `commit_run` et `retry_write`, les gardes de phase, l'attente de l'écriture par `shutdown` et la traduction des événements en NDJSON (sub-project 05), le rollback (06) et le rapport (Feature 6).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer des tests qui écrivent un `LiveRun` mêlant résolus, non résolus, en attente, un fichier verrouillé et un renommage raté, sans réseau ni interface, puis relancent l'écriture : morceaux écrits et renommés, autres intacts, échecs en `write_error` avec leur motif puis écrits à la relance, dump enregistré avant le premier fichier et jamais réécrit.

## Dependencies

- `01-ecriture-tags-design.md` (statut: draft) : `project_tags`, `write_tags`, `TagsWriteError`, `TagField`, `FileFailureReason`, `file_failure_reason`.
- `02-dump-tags-origine-design.md` (statut: draft) : `read_original_tags`, `TagDump`, `DumpEntry`, `save_entries`, `record_renamed_path`, `TagDumpWriteError`.
- `03-renommage-fichiers-design.md` (statut: draft) : `rename_track`, `RenameError`.

## Files touched

- **À créer** : `sidecar/src/tagger/writing.py` (`RunWriter`, `WriteProgress`, `WriteSummary`, `WriteEvent`)
- **À modifier** : `sidecar/src/tagger/tagging.py` (`TrackState.WRITTEN` et `WRITE_ERROR`, six motifs d'écriture dans `FailureReason`, `WriteOutcome`, `TrackRecord.written`, `written_to`, `write_failed`)
- **À créer** : `sidecar/tests/unit/test_writing.py` (phase d'écriture et relance sur des fichiers réels)
- **À modifier** : `sidecar/tests/unit/test_file_failures.py` (les motifs de fichier se retrouvent sous le même nom dans `FailureReason`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`tagging.reason` des six motifs d'écriture, exigés par `test_error_translations.py`)
- **À modifier** : `docs/ARCHITECTURE.md` (arborescence du sidecar : `writing.py`)

## Architecture approach

- **`RunWriter(live, dump_folder, on_event)`** dans `writing.py`, sur le modèle d'`UrlRecovery` : il travaille sur le `LiveRun` en mémoire (ADR-010, état en mémoire jusqu'à la Feature 6), émet par rappel et ignore le protocole. `write()` vise les morceaux `resolved`, `retry()` les seuls `write_error` ; un `unresolved`, un morceau en attente d'arbitrage ou jamais traité n'est jamais touché
- **Passe 1, dump** : lecture en parallèle (`asyncio.to_thread`, `.claude/rules/python/asyncio.md`) des tags d'origine des morceaux absents du dump, puis un seul `save_entries` avant le premier fichier. Une lecture en échec met son morceau en `write_error` avec son motif, et il n'est pas écrit : `UnreadableReason.LOCKED` se lit avant la cause système (un fichier tenu par un autre programme remonte en `PermissionError` sans `winerror`, que `file_failure_reason` prendrait pour un refus de droits). Ces `write_error` ne sont réglés qu'une fois le dump sauvé : un `TagDumpWriteError` remonte et arrête la phase avant tout fichier, sans qu'aucun morceau ait changé d'état
- **Passe 2, séquentielle** : pour chaque morceau lisible, `project_tags`, `write_tags` avec la pochette du cache, puis `rename_track` avec l'artiste et le titre projetés. Un `TagsWriteError` ou un `RenameError` met le morceau en `write_error` avec son motif, la phase continue ; un fichier tenu par un autre programme y ressort `file_locked` par l'heuristique de `_write_failure` (spec 01). Séquentielle : quelques secondes pour un run (PRODUCTION.md § Benchmarks), et deux morceaux visant le même nom ne se doublent pas
- **Chemin renommé** : `rename_track` annonce son chemin cible juste avant le déplacement (`before_rename`, y compris pour un changement de casse seule) et `record_renamed_path` le note au dump, puis `written_to(path, outcome)` sur le morceau, `track_id` inchangé. Un dump qui ne se met pas à jour est logué sans rien arrêter : le fichier est écrit, le morceau passe `written`, et son rollback échouera en `file_missing`, faute de chemin renommé `WriteOutcome` garde les champs écrits, la pose de la pochette et la troncature du nom, que le rapport de la Feature 6 reprendra
- **Relance** : le dump créé à la première écriture est gardé ; une entrée présente n'est jamais relue ni réécrite, un morceau dont la lecture d'origine avait échoué est relu
- **États et motifs** dans `tagging.py` : `TrackState.WRITTEN` et `WRITE_ERROR` ; `FailureReason` gagne `permission_denied`, `disk_full`, `path_too_long`, `file_locked`, `file_missing`, `write_failed`, mêmes valeurs que `FileFailureReason` (copie gardée par un test, `CLAUDE.md` § Une valeur, une source), le protocole n'ayant qu'un champ `failure_reason`. `write_failed` garde `resolution`, la relance n'a rien à redemander (`.claude/rules/python/modeles-donnees.md`)
- **Événements** : `TrackResolved(record)` du pipeline pour chaque morceau tranché, puis `WriteProgress(processed, total)` ; le handler du sub-project 05 les traduit
- **Logs** logfmt (`.claude/rules/python/gestion-erreurs.md`) : `write phase started` et `finished` en INFO avec `run`, chaque échec en ERROR avec `run`, `track` (rang du morceau) et `reason`
- **Résultat** : `WriteSummary(written, failed)` sur les morceaux visés, pour le `run_finished(write)` du sub-project 05

## Acceptance criteria

### Scénario 1 : écriture d'un run
**GIVEN** un run avec deux morceaux résolus (MP3 et FLAC), un non résolu et un en attente d'arbitrage
**WHEN** on écrit le run
**THEN** les deux résolus sont en `written`, tagués et renommés `Adam Beyer - Your Mind (Extended Mix)`
**AND** le non résolu et celui en attente sont identiques à l'octet près

### Scénario 2 : dump avant le premier fichier
**GIVEN** un run de deux morceaux résolus
**WHEN** le premier fichier est écrit
**THEN** le dump enregistré contient déjà l'origine des deux morceaux
**AND** il porte ensuite le chemin renommé de chacun

### Scénario 3 : dump impossible
**GIVEN** un dump qui ne peut pas être enregistré
**WHEN** on écrit le run
**THEN** `TagDumpWriteError` est levée, aucun fichier n'a changé et aucun morceau n'a changé d'état

### Scénario 4 : fichier verrouillé
**GIVEN** un morceau dont le fichier est verrouillé
**WHEN** on écrit le run
**THEN** il passe en `write_error` avec `file_locked` et les autres morceaux sont écrits

### Scénario 5 : renommage raté puis relance
**GIVEN** un morceau dont les tags s'écrivent mais dont le renommage échoue
**WHEN** on écrit le run puis on relance l'écriture
**THEN** il est d'abord en `write_error`, puis en `written` et renommé
**AND** seul ce fichier est réécrit à la relance, et son origine dans le dump reste celle d'avant la première écriture

### Scénario 6 : origine illisible
**GIVEN** un morceau dont la lecture d'origine échoue
**WHEN** on écrit le run
**THEN** il passe en `write_error`, son fichier n'est pas touché, et la relance le lit puis l'écrit

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_writing.py` :
  - écrit et renomme chaque morceau résolu, MP3 et FLAC
  - ne touche jamais un non résolu ni un morceau en attente
  - le dump contient l'origine de tous les morceaux avant l'écriture du premier fichier, puis le chemin renommé
  - un dump impossible arrête la phase avant tout fichier, et aucun morceau, même à l'origine illisible, ne change d'état
  - un fichier tenu par un autre programme (verrou réel, `held_open`) passe en `write_error` `file_locked`, les autres sont écrits
  - une origine illisible n'est jamais écrite ; un fichier disparu depuis le run passe en `file_missing`
  - un renommage raté laisse les tags écrits et le morceau en `write_error`
  - le chemin cible est noté au dump avant que le fichier ne bouge, y compris pour un changement de casse seule
  - un dump qui ne se met pas à jour au renommage laisse le morceau `written`, `renamed_path` vide
  - la relance ne réécrit que les échecs et garde l'origine du dump
  - la relance relit l'origine qu'une lecture ratée avait manquée
  - chaque morceau tranché émet son `TrackResolved` puis la progression
  - un fichier déjà au bon nom est écrit sans renommage, `renamed_path` vide
  - un fichier corrompu passe en `write_error` `write_failed`
- `sidecar/tests/unit/test_file_failures.py` :
  - les six motifs de fichier existent sous le même nom dans `FailureReason`

## Edge cases

- **Deux morceaux du run visant le même nom** : le second reçoit ` (2)`, la passe étant séquentielle
- **Pochette disparue du cache** : tags écrits, `WriteOutcome.artwork` faux, le morceau reste `written`
- **Dump impossible** : à la sauvegarde initiale, `TagDumpWriteError` remonte avant tout fichier et aucun morceau ne change d'état ; au chemin renommé (disque plein), l'erreur est loguée sans rien arrêter, le fichier est écrit et le morceau `written`, son rollback échouera en `file_missing`
- **Morceau résolu sans candidat** : invariant du pipeline, une `ValueError` le signale comme un bug
- **Relance sans échec** : aucun morceau visé, bilan à zéro

## Architectural decisions

### Décision : renommage raté après des tags écrits
**Options envisagées :**
- **A. `write_error` avec le motif du renommage** : la relance réécrit les mêmes tags et retente le renommage
- **B. `written` avec le nom d'origine** : rien à relancer, mais un fichier hors motif sans moyen de le rattraper avant le run suivant
**Choix : A**
**Rationale :**
- Choix du propriétaire ; réécrire des tags identiques est sans effet, et le dump n'est jamais réécrit

### Décision : motifs d'écriture dans `FailureReason`
**Options envisagées :**
- **A. Recopier les six valeurs dans `FailureReason`**, copie gardée par un test
- **B. Typer `failure_reason` en union `FailureReason | FileFailureReason`** : aucune copie, mais le protocole et ses tests changeraient de type dès ce sub-project
**Choix : A**
**Rationale :**
- Le champ `failure_reason` du protocole et son miroir TypeScript restent un seul enum, comme ARCHITECTURE.md le décrit
- Le test de cohérence rend la divergence impossible sans casser la CI

### Décision : passe d'écriture séquentielle
**Options envisagées :**
- **A. Séquentielle** : déterministe, aucun conflit de nom entre deux morceaux
- **B. Parallèle sur le pool de threads** : plus rapide sur de gros WAV, mais deux renommages concurrents vers le même nom se doubleraient
**Choix : A**
**Rationale :**
- La cible de quelques secondes pour 100 morceaux tient sans parallélisme ; seule la lecture d'origine, sans effet de bord, part en parallèle
