---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "ecriture-tags"
goal: "Écrire dans un fichier MP3, WAV, AIFF ou FLAC les champs de la table de correspondance de l'ADR-011 projetés depuis le candidat retenu, une seule pochette et aucun commentaire, sans toucher aux champs que la source ne renseigne pas"
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: []
date: "2026-10-06"
---

# Écriture des tags d'un fichier

## Scope

Couvre la table de correspondance complète de l'ADR-011 dans `files.py` (16 champs écrits, ID3v2.3 et Vorbis), la projection d'un `TrackCandidate` en valeurs à écrire, l'écriture de ces valeurs dans un fichier des quatre formats, la règle d'une seule image, la suppression des commentaires, et la traduction d'un échec en motif d'écriture partagé avec l'extraction.

Exclut le dump des tags d'origine (sub-project 02), le renommage (03), l'enchaînement sur un run, les états `written` / `write_error` et la journalisation (04), et tout le protocole NDJSON (05).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer des tests qui projettent un candidat Beatport, Bandcamp et SoundCloud, l'écrivent sur un MP3, un WAV, un AIFF et un FLAC construits à l'exécution, puis relisent chaque fichier : mêmes valeurs sur les quatre formats, `TYER` à l'année sans `TDAT` ni `TDRC`, remixeur absent de l'artiste, champ absent de la source préservé, une seule image, aucun commentaire.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À créer** : `sidecar/src/tagger/file_failures.py` (`FileFailureReason`, `file_failure_reason(OSError)`, codes d'erreur Windows, sortis d'`extraction.py`)
- **À modifier** : `sidecar/src/tagger/extraction.py` (retire l'enum, la traduction et les codes Windows, importe `file_failures`)
- **À modifier** : `sidecar/src/tagger/reports.py` (import de `FileFailureReason`)
- **À modifier** : `sidecar/src/tagger/protocol.py` (import de `FileFailureReason` pour `FailurePayload.reason`)
- **À modifier** : `sidecar/src/tagger/files.py` (table `TagField` → `TagKeys`, `IDENTITY_FIELDS` dérivé, `project_tags`, `write_tags`, `WrittenTags`, `TagsWriteError`, docstring et TODO de tête)
- **À créer** : `sidecar/tests/unit/test_files_write.py` (projection, table sur les quatre formats, images, commentaires, erreurs)
- **À créer** : `sidecar/tests/unit/test_file_failures.py` (traduction `OSError` → motif, cas repris de `test_extraction_run.py`)
- **À modifier** : `sidecar/tests/unit/test_extraction_run.py` (retire les cas de traduction déplacés, import)
- **À modifier** : `sidecar/tests/unit/test_error_translations.py` (import de `FileFailureReason`)
- **À modifier** : `sidecar/tests/helpers/extraction_samples.py` (import de `FileFailureReason`)
- **À modifier** : `sidecar/tests/helpers/audio_samples.py` (ajout d'un tag ID3v1 en fin de MP3, de `held_open` qui tient un fichier ouvert pour un vrai verrou Windows, retrait des deux `# type: ignore[no-untyped-call]` devenus inutiles)
- **À modifier** : `sidecar/pyproject.toml` (`untyped_calls_exclude = ["mutagen"]` dans `[tool.mypy]`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.tags_write_failed`, exigée par `test_error_translations.py`)
- **À modifier** : `docs/adrs/011-politique-ecriture-tags.md` (précisions datées : `update_to_v23()` avant `save(v2_version=3)`, pochette FLAC par `add_picture()`, une seule image, commentaires supprimés, date à l'année, valeurs multiples jointes)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Questions ouvertes : réglages de `save()` tranchés ; § Cache & Fichiers : pochette FLAC ; arborescence : `file_failures.py`)
- **À modifier** : `docs/VERSIONS.md` (§ mutagen, ID3v2.3 : `update_to_v23()` obligatoire, `v23_sep` sans objet)
- **À modifier** : `docs/knowledges/mutagen.md` (exemple au motif `write_failed`, règles d'image et de commentaire du projet)
- **À modifier** : `.claude/rules/mutagen/tags.md` (exemple au motif `write_failed`, une seule image, commentaires supprimés ; par le skill `rules-doc`)

## Architecture approach

- **Une table, une projection, un writer** dans `files.py`, seul module qui ouvre un fichier audio : la table `TagField` → `TagKeys(id3, vorbis)` remplace `IDENTITY_FIELDS`, qui en devient le sous-ensemble artiste et titre lu par `read_identity`. `TPE2` n'entre pas dans la table, faute de source (ADR-011). La pochette n'y est pas non plus : elle passe par son propre paramètre
- **Projection** `project_tags(candidate) -> TagValues`, où `TagValues` est un `Mapping[TagField, str]` qui ne contient que les champs présents : un `None`, une valeur vide ou faite d'espaces n'y entre pas, ce qui porte la règle `null` (ADR-011). Elle réutilise `matching.full_title` (« Titre (Mix Name) ») et `matching.credited_artists` (artistes joints par « , », remixeurs exclus). Les remixeurs sont joints de la même façon, la date réduite à l'année, `bpm` et `track_number` rendus en texte, `key` recopiée telle que l'API la rend (`.claude/rules/techno-scraper/contrat.md`). La même projection sert au dump (02), au renommage (03) et à la colonne Après (07)
- **Valeurs identiques sur les quatre formats** : une seule chaîne par champ, jamais une liste, donc `v23_sep` ne s'applique pas. MP3, WAV et AIFF reçoivent les mêmes frames, le FLAC les mêmes valeurs sous ses clés Vorbis
- **Écriture** `write_tags(path, values, artwork) -> WrittenTags`, synchrone (le sub-project 04 l'appelle par `asyncio.to_thread`, `.claude/rules/python/asyncio.md`), en place, sans copie du fichier :
  - le conteneur se choisit par `match` sur `audio.tags` comme `read_identity` (`.claude/rules/python/pattern-matching.md`) ; `add_tags()` sur un WAV ou un AIFF qui n'en a pas ; tout autre conteneur est refusé avant toute modification
  - ID3 : objet `ID3` complet, jamais `EasyID3`, frames en UTF-8 en mémoire, remplacement par clé de frame (un `TXXX` se remplace par sa description, jamais par un `delall("TXXX")` qui emporterait ceux des autres logiciels), puis `update_to_v23()` et seulement ensuite `save(v2_version=3)` (`.claude/rules/mutagen/tags.md`). Constaté au prototype du 2026-10-06 sur mutagen 1.48.1 : `save(v2_version=3)` seul écrit un en-tête v2.3 mais laisse `TDRC` et `TDOR` sur le disque, exactement le fichier hybride que l'ADR-011 voulait éviter ; c'est `update_to_v23()` qui les convertit en `TYER` et `TORY`
  - Vorbis : une valeur par clé, l'affectation remplaçant toutes les valeurs existantes de la clé
- **Une seule image**. Avec une pochette : toutes les images du fichier sont retirées, puis la pochette est posée en recto, MIME déduit de l'extension du cache (`jpg`, `png`, `webp`, cf. `cache._ARTWORK_EXTENSIONS`). Sans pochette, ou fichier disparu du cache (ADR-013) : on garde le recto existant, à défaut la première image, et on retire les autres. FLAC par `clear_pictures()` puis `add_picture()`, jamais `METADATA_BLOCK_PICTURE`, propre à Ogg
- **Aucun commentaire** : `COMM` retiré en ID3, `COMMENT` et `DESCRIPTION` en Vorbis, à chaque écriture. Les autres tags hors table restent intacts : Serato et Traktor rangent cue points et beatgrids dans des frames `GEOB` et `PRIV`
- **Motifs d'échec partagés** : `FileFailureReason` et `file_failure_reason(OSError)` quittent `extraction.py` pour `file_failures.py`, sans changer de valeurs (le miroir TypeScript `ExtractionFailureReason` reste tel quel). `write_tags` capture `MutagenError` et `OSError` ensemble, lit `__cause__`, et lève `TagsWriteError(path, reason)` (code `tags_write_failed`, sous `FilesError`) : motif traduit pour une `OSError`, `write_failed` pour une corruption ou un conteneur refusé (`.claude/rules/python/gestion-erreurs.md`). Un fichier tenu par un autre programme remonte en `PermissionError` sans `winerror` (ouverture par le CRT, mesuré le 2026-10-06), donc en `permission_denied` : `_write_failure` le rend `file_locked` quand `os.access(path, os.W_OK)` est vrai, un fichier en lecture seule étant la seule autre cause de cette erreur
- **Aucun log dans `files.py`**, comme pour `TagsUnreadableError` : l'appelant connaît le run et le morceau
- **Types** : `TagField` en `StrEnum` avec `@verify(UNIQUE)`, `WrittenTags` en `dataclass(frozen=True, slots=True)` portant les champs écrits (le rapport en compte le nombre, ADR-011) et si la pochette a été posée (`.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/mypy/strict.md`). mutagen livre un `py.typed` mais n'annote ni ses frames ni `setall`, `delall`, `add`, `update_to_v23` ou `add_picture` : `untyped_calls_exclude = ["mutagen"]` dans la configuration Mypy plutôt qu'un `# type: ignore[no-untyped-call]` par appel, ce qui rend inutiles les deux de `audio_samples.py`

### Table de correspondance

| `TagField` | ID3 (fichier v2.3) | Vorbis | Valeur projetée |
|---|---|---|---|
| `artist` | `TPE1` | `ARTIST` | `credited_artists` |
| `remixer` | `TPE4` | `REMIXER` | `remixers[].name` joints par « , » |
| `title` | `TIT2` | `TITLE` | `full_title` |
| `album` | `TALB` | `ALBUM` | `release.title` |
| `date` | `TDRC` → `TYER` | `DATE` | année de `release.release_date` |
| `original_date` | `TDOR` → `TORY` | `ORIGINALDATE` | année de `release.release_date` |
| `genre` | `TCON` | `GENRE` | `genre` |
| `label` | `TPUB` | `LABEL` | `label.name` |
| `catalog_number` | `TXXX:CATALOGNUMBER` | `CATALOGNUMBER` | `release.catalog_number` |
| `bpm` | `TBPM` | `BPM` | `bpm` |
| `key` | `TKEY` | `KEY` | `key` |
| `isrc` | `TSRC` | `ISRC` | `isrc` |
| `track_number` | `TRCK` | `TRACKNUMBER` | `track_number` |
| `url` | `WOAS` | `URL` | `url` |
| `source_id` | `TXXX:SOURCE_ID` | `SOURCE_ID` | `id` |
| `source` | `TXXX:SOURCE` | `SOURCE` | `source` |

## Acceptance criteria

### Scénario 1 : candidat Beatport complet sur un MP3 mal tagué
**GIVEN** un MP3 tagué `TPE1` « adam beyer », `TIT2` « your mind », un commentaire et deux images
**WHEN** on écrit la projection du candidat Beatport des fixtures (« Your Mind », mix « Extended Mix », sortie du 2023-06-16) avec sa pochette
**THEN** le fichier relu en ID3v2.3 porte chacun des 15 champs que le candidat renseigne (tous sauf le remixeur), dont `TIT2` « Your Mind (Extended Mix) » et `TYER` « 2023 »
**AND** il ne contient ni `TDRC`, ni `TDAT`, ni commentaire, et une seule image : la pochette fournie, en recto

### Scénario 2 : remix à plusieurs artistes
**GIVEN** un candidat aux artistes « Adam Beyer » et « Bart Skils », remixeur « Layton Giordani », mix « Layton Giordani Remix »
**WHEN** on l'écrit sur un fichier des quatre formats
**THEN** l'artiste vaut « Adam Beyer, Bart Skils », sans le remixeur
**AND** le titre vaut « Your Mind (Layton Giordani Remix) » et le champ remixeur « Layton Giordani »

### Scénario 3 : candidat Bandcamp sur un FLAC déjà renseigné
**GIVEN** un FLAC portant `BPM`, `KEY` et `GENRE`, et un candidat Bandcamp sans ces trois champs
**WHEN** on écrit sa projection
**THEN** `BPM`, `KEY` et `GENRE` gardent leur valeur d'origine
**AND** les champs que Bandcamp renseigne sont écrits, `SOURCE` valant `bandcamp`

### Scénario 4 : mêmes valeurs sur les quatre formats
**GIVEN** une même projection Beatport
**WHEN** on l'écrit sur un MP3, un WAV, un AIFF et un FLAC vierges
**THEN** chaque champ relu porte la même chaîne sur les quatre fichiers, sous sa clé ID3 ou Vorbis

### Scénario 5 : pochette absente
**GIVEN** un fichier portant un recto et un verso, et une pochette disparue du cache
**WHEN** on écrit la projection
**THEN** les tags sont écrits, le recto existant est la seule image restante
**AND** `WrittenTags` indique que la pochette n'a pas été posée

### Scénario 6 : fichier verrouillé
**GIVEN** un fichier tenu par un autre processus
**WHEN** on l'écrit
**THEN** `TagsWriteError` est levée avec le motif `file_locked`
**AND** le fichier n'a pas changé

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_files_write.py` :
  - `project_tags` sur un candidat Beatport complet rend les 15 champs qu'il renseigne avec leurs valeurs projetées (tous sauf le remixeur, que couvre le test de remix)
  - `project_tags` sur un candidat Bandcamp ne rend que les champs présents
  - un remixeur entre dans `title` et `remixer`, jamais dans `artist` ; plusieurs artistes sont joints par « , »
  - une valeur vide ou faite d'espaces est omise
  - la date est réduite à l'année dans `date` et `original_date`
  - parametrize sur les quatre formats : chaque champ de la table arrive sous sa clé et relu donne la même chaîne
  - ID3 : version relue 2.3, `TYER` présent, `TDRC` et `TDAT` absents, `TORY` à l'année, que le fichier arrive en v2.3 ou en v2.4
  - un texte accentué est relu à l'identique en ID3v2.3 comme en FLAC
  - une clé Vorbis d'origine en minuscules et à plusieurs valeurs est remplacée par une seule valeur
  - une deuxième écriture du même fichier laisse toujours une seule pochette
  - un champ absent de la projection laisse le tag existant intact (`BPM` d'un candidat Bandcamp)
  - un tag hors table (`TXXX` d'un autre logiciel, `TPE2`) reste intact
  - les commentaires sont retirés : `COMM`, `COMMENT`, `DESCRIPTION`, et celui d'un tag ID3v1 sur MP3
  - avec pochette : une seule image, le recto fourni, au MIME de son extension
  - sans pochette, ou pochette absente du cache, illisible ou d'extension inconnue : le recto existant est gardé, à défaut la première image, les autres retirées, `WrittenTags` le signale
  - un WAV et un AIFF sans tags reçoivent un bloc ID3
  - un fichier verrouillé lève `TagsWriteError` au motif `file_locked` et reste identique, sur un vrai verrou (`held_open`) comme sur une erreur Windows 32 fabriquée
  - un fichier en lecture seule lève `TagsWriteError` au motif `permission_denied`, distinct d'un verrou
  - un conteneur hors des quatre formats (WavPack sous `.wav`) lève `TagsWriteError` au motif `write_failed` et reste identique
- `sidecar/tests/unit/test_file_failures.py` :
  - verrou Windows → `file_locked`, chemin trop long → `path_too_long`, fichier absent → `file_missing`, droits → `permission_denied`, disque plein → `disk_full`, autre → `write_failed` (cas repris de `test_extraction_run.py`)

## Edge cases

- **Source sans date** : `date` et `original_date` absents de la projection, la date existante reste telle qu'elle est, même complète
- **Source sans `id`** : `source_id` omis, `source` toujours écrit, le champ étant obligatoire dans le contrat
- **Fichier en ID3v2.4** : réécrit en v2.3, ses autres frames converties par mutagen
- **Ancienne date complète en v2.3** : `TYER` + `TDAT` sont relus en un `TDRC` remplacé par l'année, `TDAT` disparaît
- **Clé Vorbis en casse différente** (`artist`) : remplacée, mutagen comparant les clés sans casse
- **Pochette en cache illisible** : traitée comme une pochette absente, jamais comme un échec du morceau
- **Fichier en lecture seule** : `permission_denied`, jamais `file_locked` : seul un fichier inscriptible refusé à l'ouverture passe pour un verrou
- **WAV** : écrit malgré le support inégal en lecture des logiciels DJ (ADR-011), l'avertissement relève du rapport (Feature 6)

## Architectural decisions

### Décision : écriture en place
**Options envisagées :**
- **A. En place par mutagen** : rapide (quelques secondes pour 100 morceaux), les échecs courants (verrou, droits, fichier absent) surviennent à l'ouverture et laissent le fichier intact ; une panne en pleine écriture peut l'abîmer, le dump (02) restaurant les tags et non l'audio
- **B. Copie voisine puis `os.replace`** : fichier intact quoi qu'il arrive, mais chaque fichier recopié en entier (6 Go pour 100 WAV de 60 Mo) et le double d'espace disque
**Choix : A**
**Rationale :**
- La cible de performance est « quelques secondes » (PRODUCTION.md § Benchmarks)
- La promesse « fichier intact » de l'ADR-011 tient pour les échecs que le terrain produit, et le dump couvre les tags

### Décision : valeurs multiples en une chaîne
**Options envisagées :**
- **A. Une chaîne jointe par « , »** : rendu identique sur les quatre formats et dans tous les lecteurs, cohérent avec la CLI et `read_identity`, `v23_sep` sans objet
- **B. Liste, `v23_sep` « / »** : rendu différent entre ID3 et FLAC, casse un nom d'artiste qui contient une barre oblique
- **C. Liste, `v23_sep=None`** : v2.3 non standard, déconseillé par la documentation mutagen
**Choix : A**
**Rationale :**
- Le propriétaire veut lire la même chose quel que soit le format
- Tranche la question ouverte de l'ADR-011 sur `v23_sep`

### Décision : date réduite à l'année
**Options envisagées :**
- **A. Année seule partout** : `TYER` sans `TDAT`, `TORY`, `DATE` et `ORIGINALDATE` à l'année, identiques sur les quatre formats
- **B. Date complète** : `TYER` + `TDAT` en ID3, date ISO en Vorbis, `TORY` à l'année faute de mieux, donc un rendu différent selon le format
**Choix : A**
**Rationale :**
- Choix du propriétaire : l'année suffit et se lit pareil partout
- Tranche la question ouverte de l'ADR-011 sur `TDOR` : `TORY` ne perd plus rien

### Décision : une seule image, aucun commentaire
**Options envisagées :**
- **A. Une seule image, commentaires supprimés, autres tags hors table intacts** : fichier propre sans effacer les données de Serato et Traktor
- **B. Tout tag hors table supprimé** : fichier réduit aux 16 champs, mais cue points et beatgrids stockés dans le fichier perdus
- **C. Tags hors table tous intacts (ADR-011 d'origine)** : commentaires de rip et pochettes multiples conservés
**Choix : A**
**Rationale :**
- Choix du propriétaire : une seule image, la pochette de la source, et zéro commentaire
- Les frames `GEOB` et `PRIV` portent du travail de préparation DJ qu'aucune source ne restitue

### Décision : motifs d'échec partagés
**Options envisagées :**
- **A. Module neutre `file_failures.py`** importé par l'extraction, les rapports et l'écriture
- **B. Import de `extraction.failure_reason`** depuis `files.py` : aucun déplacement, mais un type nommé « Extraction » dans l'écriture
- **C. Copie dans `files.py`** : deux traductions `winerror` / `errno` qui peuvent diverger
**Choix : A**
**Rationale :**
- Une même panne de fichier porte le même nom dans les deux rapports d'un run (docstring actuelle de l'enum)
- Le sub-project 04 reprend ces motifs pour `failure_reason` sans nouvelle traduction
