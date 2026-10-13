---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "dump-tags-origine"
goal: "Sauvegarder avant réécriture les tags d'origine des champs de la table dans un dump JSON par run, conservé 30 jours, et savoir les restaurer sur un fichier"
status: "implemented"
complexity: "M"
tdd_scope: "full"
depends_on: ["01-ecriture-tags-design.md"]
date: "2026-10-11"
---

# Dump des tags d'origine

## Scope

Couvre la lecture des tags d'origine des 15 champs de la table (toutes leurs valeurs, système de tags et version ID3), la restauration de cet état sur un fichier, le fichier de dump d'un run (modèles, écriture atomique, ajout sans écrasement, relecture versionnée, chemin après renommage) et la purge des dumps de plus de 30 jours au démarrage du sidecar.

Exclut l'appel du dump avant l'écriture et l'enregistrement du chemin renommé (sub-project 04), la commande `rollback`, le renommage inverse et la recherche du dernier run annulable (06). Le dump ne garde ni pochettes ni commentaires : un rollback rend les tags, pas les images ni les commentaires que l'écriture a retirés.

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer des tests qui lisent un MP3 v2.3, un MP3 v2.4, un WAV, un AIFF et un FLAC tagués, enregistrent leur état dans un dump, y écrivent un candidat Beatport, puis les restaurent depuis le dump relu : mêmes champs, même version ID3, champs ajoutés par l'écriture supprimés.

## Dependencies

- `01-ecriture-tags-design.md` (statut: implemented) : `TagField`, `TAG_FIELDS`, `write_tags`, `TagsWriteError`, `FileFailureReason`, construction des frames ID3.

## Files touched

- **À modifier** : `sidecar/src/tagger/files.py` (`TagSystem`, `OriginalTags`, `read_original_tags`, `restore_tags`, construction d'une frame ID3 à plusieurs valeurs)
- **À créer** : `sidecar/src/tagger/tag_dump.py` (`TagDump`, `DumpEntry`, `dump_dir`, `dump_path`, `save_entries`, `load_dump`, `record_renamed_path`, `rewrite_dump`, `journal_path`, `purge_dumps`, erreurs)
- **À modifier** : `sidecar/src/tagger/__main__.py` (purge des dumps au démarrage, après `setup_logging`)
- **À modifier** : `sidecar/src/tagger/paths.py` (docstring : la racine des dumps)
- **À créer** : `sidecar/tests/unit/test_files_restore.py` (lecture et restauration sur les quatre formats)
- **À créer** : `sidecar/tests/unit/test_tag_dump.py` (écriture, ajout sans écrasement, relecture, version inconnue, chemin renommé, purge)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.tag_dump_error`, `errors.tag_dump_write_failed`, `errors.tag_dump_unreadable`)
- **À modifier** : `docs/PRODUCTION.md` (§ Rollback, § Sauvegardes, § Plan de reprise : le dump a sa propre durée de 30 jours, ADR-010)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Données : dossier `dumps/`, contenu du dump ; arborescence : `tag_dump.py`)
- **À modifier** : `docs/knowledges/mutagen.md` (§ Dump des tags d'origine : champs de la table, version ID3 restaurée)

## Architecture approach

- **Lecture dans `files.py`**, seul module qui ouvre un fichier audio : `read_original_tags(path) -> OriginalTags` rend, pour chaque champ de la table présent, toutes ses valeurs telles que le fichier les porte (jamais jointes, jamais nettoyées), le système de tags (`TagSystem.ID3` ou `TagSystem.VORBIS`) et la version ID3 d'origine (2 à 4, ou `None` sans tag ni sur FLAC). Mêmes erreurs que `read_identity` (`TagsUnreadableError`), même refus d'un conteneur hors des quatre formats. La colonne Avant (sub-project 07) la réutilise
- **Restauration** `restore_tags(path, original)` : un champ présent dans `original` est remis avec toutes ses valeurs, un champ absent est supprimé, puisque c'est l'écriture qui l'a ajouté. Le fichier repart dans sa version ID3 d'origine : `save(v2_version=4)` pour un v2.4, `update_to_v23()` puis `save(v2_version=3)` sinon. Commentaires, images et tags hors table ne sont pas touchés. Mêmes erreurs que l'écriture (`TagsWriteError`, `FileFailureReason`)
- **Valeurs ID3** : texte des frames (`.text`), URL pour `WOAS`. Une frame à plusieurs valeurs se reconstruit à l'identique ; la construction de frame du sub-project 01 passe d'une valeur à une séquence de valeurs
- **Fichier de dump** dans `tag_dump.py`, modèles Pydantic (ADR-022, `.claude/rules/pydantic/modeles.md`) : `TagDump` (`schema_version`, `run_id`, `created_at`, `folder` du run, `entries` par `track_id`) et `DumpEntry` (`path` d'origine, `renamed_path`, `system`, `id3_version`, `fields`). Un dump par run sous `app_data_dir() / "dumps"`, nommé `<horodatage>-<run_id>.json` avec le format d'horodatage des rapports (`reports.TIMESTAMP_FORMAT`)
- **Écriture atomique** : JSON en UTF-8 dans un fichier temporaire voisin, puis remplacement (`.claude/rules/python/fichiers-io.md`). Un échec lève `TagDumpWriteError` : sans dump, le sub-project 04 n'écrit pas le fichier
- **Ajout sans écrasement** : `save_entries` ajoute les entrées absentes et laisse les autres intactes. Une relance de l'écriture sur les échecs ne remplace jamais l'origine par l'état déjà écrit. La fusion repart du dump du disque, jamais de celui que l'appelant garde en mémoire : un rollback a pu y consommer des entrées entre deux écritures, et les réécrire ressusciterait des morceaux restaurés. Les entrées gardent leur ordre d'écriture, que le rollback parcourt à l'envers
- **Relecture versionnée** : `load_dump` refuse une `schema_version` inconnue et un JSON illisible par `TagDumpUnreadableError`, qui nomme la version trouvée et la version attendue (ADR-018, même durée de vie de 30 jours)
- **Chemin après renommage** : `record_renamed_path(folder, dump, track_id, path)` ajoute une note au journal voisin `<dump>.renames.ndjson`, append-only, `flush` puis `fsync` avant le retour, plutôt que de réécrire le dump : le sub-project 04 l'appelle avant le renommage avec le chemin cible (une coupure entre les deux laisse un chemin qui ne mène nulle part, que le rollback retrouve par l'ancien nom) et le sub-project 06 le lit pour retrouver le fichier. `load_dump` fusionne le journal (la dernière note d'un morceau gagne, une ligne illisible est écartée) et `rewrite_dump` réécrit le dump complet une fois en fin de phase, puis supprime le journal. Le dump reçu fait foi, sans relecture du disque. L'entrée passe en fin de dump : le rollback, qui le parcourt à l'envers, rend alors ce morceau en premier (06)
- **Purge** `purge_dumps(folder, now)` : supprime les dumps dont l'horodatage du nom a plus de 30 jours, quel que soit l'état du run (ADR-010), et ignore les fichiers au nom non reconnu. Un temporaire `.tmp` laissé par une écriture coupée porte les mêmes tags et suit la même durée, comme un journal de renommages, y compris quand son dump a déjà disparu. Appelée au démarrage du sidecar après `setup_logging` ; une erreur de purge est loguée, jamais fatale, et un dump qu'on ne peut pas supprimer (verrou d'un éditeur ou d'un antivirus) ne bloque pas les suivants
- **Erreurs** sous `TagDumpError(TaggerError)` (code `tag_dump_error`) : `TagDumpWriteError` (`tag_dump_write_failed`) et `TagDumpUnreadableError` (`tag_dump_unreadable`), traduites dans les deux langues (`.claude/rules/python/gestion-erreurs.md`, `.claude/rules/ngx-translate/i18n.md`)
- **Types** : `TagSystem` en `StrEnum` avec `@verify(UNIQUE)`, `OriginalTags` en `dataclass(frozen=True, slots=True)` (`.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/mypy/strict.md`, `.claude/rules/mutagen/tags.md`)

## Acceptance criteria

### Scénario 1 : aller-retour d'un MP3 v2.3
**GIVEN** un MP3 v2.3 portant « adam beyer/bart skils », « your mind », la date « 2019-06-16 » et un BPM 130
**WHEN** on lit ses tags d'origine, on y écrit le candidat Beatport, puis on restaure les tags lus
**THEN** le fichier relu porte exactement ces quatre champs, date complète comprise
**AND** il est toujours en v2.3, et les champs que l'écriture avait ajoutés ont disparu

### Scénario 2 : un fichier v2.4 repart en v2.4
**GIVEN** un MP3 en ID3v2.4 à deux artistes
**WHEN** on l'écrit puis on le restaure
**THEN** le fichier est de nouveau en v2.4 et ses deux artistes sont deux valeurs distinctes

### Scénario 3 : relance de l'écriture sur un dump existant
**GIVEN** un dump qui contient déjà l'entrée d'un morceau
**WHEN** on enregistre une nouvelle entrée pour ce morceau, lue après une première écriture
**THEN** l'entrée d'origine reste celle du dump

### Scénario 4 : purge au démarrage
**GIVEN** un dump daté de 31 jours et un autre de 17 jours
**WHEN** la purge passe
**THEN** seul le dump de 17 jours reste, que son run ait été écrit ou non

### Scénario 5 : dump d'une version inconnue
**GIVEN** un dump dont la `schema_version` vaut 2
**WHEN** on le relit
**THEN** `TagDumpUnreadableError` est levée, ses `params` nommant la version trouvée et la version attendue

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_files_restore.py` :
  - parametrize sur MP3 v2.3, MP3 v2.4, WAV, AIFF et FLAC : lecture, écriture du candidat Beatport, restauration, relecture identique à l'origine
  - un fichier v2.4 est restauré en v2.4, un v2.3 en v2.3 avec `TYER` et `TDAT`
  - un champ ajouté par l'écriture est supprimé à la restauration
  - un fichier sans tag se lit vide et, après écriture puis restauration, ne porte plus aucun champ de la table
  - plusieurs valeurs d'origine (deux artistes en v2.4, deux `ARTIST` en FLAC) sont rendues à l'identique
  - la restauration ne touche ni aux images ni aux tags hors table
  - un fichier verrouillé à la restauration lève `TagsWriteError` au motif `file_locked`
  - un conteneur hors des quatre formats lève `TagsUnreadableError` à la lecture et refuse la restauration
  - un fichier sans tag que l'écriture n'a pas atteint est restauré sans erreur
- `sidecar/tests/unit/test_tag_dump.py` :
  - un dump enregistré puis relu rend les mêmes entrées
  - le nom du fichier porte l'horodatage et le `run_id`
  - `save_entries` n'écrase pas une entrée existante et ajoute les nouvelles
  - `save_entries` fusionne sur le dump du disque, même quand le dump reçu en mémoire n'a pas ses entrées
  - `record_renamed_path` note le chemin renommé au journal sans réécrire le dump et le rechargement le fusionne à l'entrée
  - une version de schéma inconnue et un JSON illisible lèvent `TagDumpUnreadableError`
  - un dossier où l'écriture échoue lève `TagDumpWriteError` et ne laisse aucun fichier partiel
  - l'horodatage du nom est en UTC quel que soit le décalage local, et un dump daté sans fuseau est refusé
  - la purge supprime les dumps et temporaires de plus de 30 jours, garde les récents et ignore un nom non reconnu ou un dossier absent
  - la purge continue après un dump qu'elle ne peut pas supprimer, et le logue

## Edge cases

- **Fichier sans tag** : lu comme un état vide ; la restauration retire tous les champs de la table et laisse le bloc ID3 que l'écriture a créé
- **Valeurs multiples d'un v2.3** : mutagen les relit en une seule chaîne jointe par « / », restaurée telle quelle
- **Frames v2.4 sans équivalent v2.3** (tri `TSOP`, `TSOA`, `TSOT`) : supprimées par la conversion de l'écriture et absentes du dump, donc non restaurées
- **Morceau dont la lecture d'origine échoue** : aucune entrée dans le dump, et le sub-project 04 ne l'écrit pas
- **Dump du disque plus court que celui en mémoire** (entrées consommées par un rollback) : le disque l'emporte, une entrée restaurée ne revient pas
- **Dossier `dumps` absent** au démarrage : la purge n'a rien à faire, il est créé au premier enregistrement
- **Horloge** : `created_at` et l'horodatage du nom sont en UTC (`datetime.now(UTC)`)

## Architectural decisions

### Décision : contenu du dump
**Options envisagées :**
- **A. Les 15 champs de la table, avec le système et la version ID3** : environ 1 Mo par mois pour trois runs de 500 morceaux (830 octets par morceau mesurés sur un dump aux champs tous remplis)
- **B. Les champs, les commentaires et les images d'origine** : rollback complet, mais 150 à 900 Mo par mois selon le poids des pochettes, un ordre de grandeur au-dessus du plafond du cache
**Choix : A**
**Rationale :**
- Choix du propriétaire : le rollback défait des tags faux, les anciens commentaires sont ce qu'il veut voir disparaître
- Un nouveau run avec la bonne correspondance remplace la pochette d'une mauvaise

### Décision : un fichier par run
**Options envisagées :**
- **A. Un JSON par run** sous `dumps/`, horodaté : dernier run et purge se lisent sur le nom
- **B. Un JSON par morceau** : ajouts simples, mais des milliers de fichiers et un dernier run à reconstituer
- **C. Dans le plan de run (Feature 6)** : contredit l'ADR-010, qui donne au dump sa propre durée de vie
**Choix : A**
**Rationale :**
- L'ADR-010 décrit un dump « fait en une passe juste avant l'écriture » et un rollback « par run ou par morceau »
- Les Réglages annulent le dernier run (sub-project 11), que le nom horodaté désigne directement
