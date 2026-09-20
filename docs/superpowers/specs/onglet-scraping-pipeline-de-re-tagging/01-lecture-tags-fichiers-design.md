---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "lecture-tags-fichiers"
goal: "Lire l'artiste et le titre des fichiers audio d'un dossier, dans les quatre formats supportés, sans jamais les modifier"
status: "draft"
complexity: "M"
tdd_scope: "full"
depends_on: []
date: "2026-09-19"
---

# Lecture de l'artiste et du titre des fichiers d'un dossier

## Scope

Couvre l'énumération récursive des fichiers audio du dossier à re-tagger et la lecture de leur artiste et de leur titre, sur les quatre formats retenus par ADR-011 : ID3v2 pour MP3, WAV et AIFF, Vorbis comments pour FLAC. Couvre aussi les fichiers audio vierges des quatre formats dont les tests ont besoin, aucun n'existant encore dans le dépôt.

Exclut toute écriture, le dump des tags d'origine et la lecture des autres champs de la table ADR-011 (Feature 5). Exclut la construction de la requête et le repli sur le nom de fichier (sub-project 03), ainsi que le traitement d'un fichier illisible au sein d'un run (sub-project 06) : ce module signale l'incident, il ne décide pas de sa suite.

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui liste récursivement les fichiers audio d'une arborescence de test en ignorant les autres, lit l'artiste et le titre d'un fichier de chacun des quatre formats, rend une identité vide pour un fichier sans tags et signale un fichier illisible par une erreur typée qui distingue le verrou de la corruption.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À modifier** : `sidecar/src/tagger/files.py` (remplace le placeholder par la lecture ; le TODO restant ne porte plus que sur l'écriture, livrée par la Feature 5)
- **À créer** : `sidecar/tests/helpers/audio_samples.py` (fichiers audio vierges minimaux des quatre formats, construits en octets)
- **À créer** : `sidecar/tests/unit/test_files_listing.py` (énumération du dossier)
- **À créer** : `sidecar/tests/unit/test_files_identity.py` (lecture de l'artiste et du titre)
- **À modifier** : `sidecar/tests/conftest.py` (fixture de fichiers audio ; le TODO ne mentionne plus que le transport httpx2 mocké)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.files_error`, `errors.tagging_folder_unreadable`, `errors.tags_unreadable` : le test `test_error_translations.py` exige une phrase par code, classes de base comprises)

## Architecture approach

- **`files.py` reste le seul module qui ouvre un fichier audio**, en lecture ici et en écriture à la Feature 5 (ARCHITECTURE.md § Arborescence). La requête, le scoring et l'orchestration restent dans leurs modules, conformément à `.claude/rules/python/imports-modules.md`.
- **Une seule table de correspondance** `IDENTITY_FIELDS`, du champ vers la paire (frame ID3, clé Vorbis) : `artist` vers `TPE1` / `ARTIST`, `title` vers `TIT2` / `TITLE` (ADR-011 § Correspondance des champs). La Feature 5 l'étend aux autres champs dans ce même module, jamais dans un second (cf. `.claude/rules/mutagen/tags.md`).
- **La colonne se choisit sur le type des tags lus, pas sur l'extension** : `mutagen.File()` ouvre le fichier, puis un `match` sur le conteneur retenu (`ID3` pour MP3, WAV et AIFF, `VComment` pour FLAC) désigne la colonne de la table. Un `.mp3` qui contient en réalité du FLAC est donc lu correctement. Le `match` se ferme sur un cas « aucun tag » qui rend l'identité vide.
- **Valeurs lues comme des listes** : le texte d'une frame ID3 par `.text`, toute valeur Vorbis comme une liste même pour un champ unique (`.claude/rules/mutagen/tags.md`). Chaque entrée est débarrassée de ses blancs, les entrées vides sont écartées, le reste est joint par `", "`. Ce séparateur est choisi pour le scoring : un artiste qui contient une virgule bascule sur `token_sort_ratio` (ARCHITECTURE.md § Use-case 2, `.claude/rules/rapidfuzz/matching.md`).
- **Énumération récursive calquée sur `build_source_index`** (`extraction.py`) : un seul parcours `rglob("*")`, fichiers seuls, extension comparée en minuscules à `AUDIO_EXTENSIONS` (`.mp3`, `.wav`, `.aif`, `.aiff`, `.flac`). Le résultat est trié segment par segment du chemin relatif au dossier, sans tenir compte de la casse : deux runs sur le même dossier traitent les morceaux dans le même ordre, quel que soit le séparateur de chemin de la plateforme.
- **Deux erreurs typées, famille `FilesError` héritée de `TaggerError`**, avec `code` stable et `params` en attributs (`.claude/rules/python/gestion-erreurs.md`) :
  - `TaggingFolderUnreadableError` (`tagging_folder_unreadable`, `folder` = nom du dossier) quand le dossier n'existe pas ou n'en est pas un. Elle porte sur le run entier et remonte jusqu'à l'interface, sur le modèle de `source_folder_unreadable`.
  - `TagsUnreadableError` (`tags_unreadable`, `file` = nom du fichier, `reason` = `locked` ou `unreadable`) quand la lecture échoue. `MutagenError` et `OSError` sont captés ensemble, et `__cause__` distingue le verrou (`PermissionError`) de la corruption (`.claude/rules/mutagen/tags.md`). Un `mutagen.File()` qui rend `None` sur un contenu non reconnu donne `unreadable`.
- **Ce module ne logue pas l'incident de lecture** : il ne connaît ni le `run` ni le `track` que PRODUCTION.md § Logging exige sur chaque ligne. Le pipeline (sub-project 06) attrape `TagsUnreadableError`, logue en WARNING avec ces clés et le `reason`, puis garde le morceau avec une identité vide, ce qui fait retomber la requête sur le nom de fichier. L'erreur est ainsi loguée une seule fois, là où elle est traitée.
- **API synchrone** : lecture de fichiers et parcours du disque sont bloquants, le pipeline les appellera par `asyncio.to_thread` (`.claude/rules/python/asyncio.md`).
- **Modèle interne en dataclass gelée** `IdentityTags(artist, title)`, chaînes vides quand le tag est absent, jamais pydantic : rien ne traverse ici de frontière externe (`.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`). `AUDIO_EXTENSIONS` et `IDENTITY_FIELDS` sont annotées `Final`.
- **Fichiers audio de test générés, jamais commités** : un fichier vierge minimal par format, construit en octets par `audio_samples.py`, tagué ensuite par mutagen dans l'arrange du test. Même choix que le dump VLC, construit à l'exécution pour garder le dépôt sans binaire. Le WAV passe par le module `wave` de la stdlib, l'AIFF s'écrit à la main (`aifc` a quitté la stdlib en 3.13), le MP3 tient en une trame MPEG silencieuse, le FLAC en sa signature suivie d'un bloc `STREAMINFO` (`.claude/rules/pytest/tests.md`).

## Acceptance criteria

### Scénario 1 : Énumération récursive des seuls fichiers audio
**GIVEN** un dossier contenant des fichiers des quatre formats, dont certains dans des sous-dossiers, plus un `.jpg`, un `.m3u8` et un `.txt`
**WHEN** le dossier est énuméré
**THEN** seuls les fichiers audio sont rendus, sous-dossiers compris
**AND** les extensions en majuscules (`.MP3`, `.Aif`) sont reconnues

### Scénario 2 : Ordre stable d'un run à l'autre
**GIVEN** un dossier dont les fichiers portent des noms de casses différentes, répartis dans des sous-dossiers
**WHEN** le dossier est énuméré deux fois
**THEN** les deux énumérations rendent le même ordre, trié par chemin relatif sans tenir compte de la casse

### Scénario 3 : Lecture de l'artiste et du titre sur chaque format
**GIVEN** un fichier de chacun des quatre formats, tagué avec un artiste et un titre
**WHEN** son identité est lue
**THEN** l'artiste et le titre rendus sont ceux posés, lus dans `TPE1` / `TIT2` pour MP3, WAV et AIFF, dans `ARTIST` / `TITLE` pour FLAC

### Scénario 4 : Artistes multiples joints
**GIVEN** un fichier dont le tag artiste porte deux valeurs
**WHEN** son identité est lue
**THEN** l'artiste rendu joint les deux valeurs par `", "`

### Scénario 5 : Fichier sans tags
**GIVEN** un fichier audio valide qui ne porte aucun tag
**WHEN** son identité est lue
**THEN** l'artiste et le titre rendus sont vides
**AND** aucune erreur n'est levée

### Scénario 6 : Fichier illisible
**GIVEN** un fichier portant une extension audio mais dont le contenu n'est reconnu par aucun format
**WHEN** son identité est lue
**THEN** une `TagsUnreadableError` est levée avec le motif `unreadable`

### Scénario 7 : Dossier illisible
**GIVEN** un chemin qui n'existe pas, ou qui désigne un fichier
**WHEN** il est énuméré
**THEN** une `TaggingFolderUnreadableError` est levée, portant le nom du dossier en paramètre

### Scénario 8 : Lecture seule
**GIVEN** un fichier tagué de chacun des quatre formats
**WHEN** son identité est lue
**THEN** son contenu en octets est identique avant et après la lecture

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_files_listing.py` :
  - lists audio files recursively and ignores other extensions
  - recognises extensions regardless of case
  - returns files sorted by relative path, case-insensitively
  - returns an empty tuple for a folder without audio files
  - raises a tagging folder error for a missing path
  - raises a tagging folder error for a path that is a file
  - ignores a folder named like an audio file
- `sidecar/tests/unit/test_files_identity.py` :
  - reads artist and title from the id3 frames of mp3, wav and aiff files (paramétré, `ids` en anglais)
  - reads artist and title from the vorbis keys of a flac file
  - joins multiple artist values with a comma
  - strips blanks and drops empty values
  - returns an empty identity for a file without tags
  - raises unreadable when the content matches no format
  - raises locked when the read fails on a permission error (échec simulé avec une cause `PermissionError`)
  - leaves the file bytes unchanged after reading

Aucun test ne vérifie que mutagen sait lire une frame : chaque cas échoue contre une régression de notre table, de notre jointure, de notre filtre ou de notre traduction d'erreur.

## Edge cases

- **Sous-dossier illisible pendant le parcours** : ignoré sans erreur, `rglob` absorbant l'`OSError` de son `scandir` (vérifié dans la source de `glob` en 3.14). Les fichiers qu'il contient n'entrent pas dans le run, comme pour le dossier source de l'extraction.
- **Dossier sans aucun fichier audio** : tuple vide, pas d'erreur. Le pipeline décide de ce qu'un run vide signifie.
- **Dossier très large choisi par erreur** : énuméré en entier. Risque accepté le 2026-09-19 au profit du parcours récursif, aucun garde-fou n'est ajouté ici.
- **Tag présent mais vide ou fait de blancs** : identité vide pour ce champ, comme un tag absent. Le repli sur le nom de fichier se décide au sub-project 03.
- **WAV ou AIFF sans chunk ID3** : `audio.tags` vaut `None`, identité vide, sans appeler `add_tags()`, réservé à l'écriture.
- **Extension audio sur un contenu d'un autre format audio** : lu selon le conteneur réellement détecté.

## Architectural decisions

### Décision : Où traiter un fichier dont les tags sont illisibles

**Options envisagées :**
- **A. `files.py` lève `TagsUnreadableError`, le pipeline logue et poursuit avec une identité vide** : la ligne de log porte `run` et `track`, l'erreur n'est loguée qu'une fois, là où elle est traitée. Le comportement « gardé, tags vides » se teste au sub-project 06.
- **B. `files.py` capte l'erreur, logue et rend une identité vide** : moins de code. Le log sort sans `run` ni `track`, contraire à PRODUCTION.md § Logging, et l'incident devient indiscernable d'un fichier simplement non tagué.

**Choix : A**

**Rationale :**
- Le jeu de clés logfmt est fixe et `run` figure sur chaque ligne : seul l'appelant les connaît.
- Un fichier illisible et un fichier sans tags ne sont pas le même fait, même si le run les traite pareil : les confondre dans le module de lecture effacerait la distinction avant qu'on puisse la loguer.

### Décision : Parcours du dossier à re-tagger

**Options envisagées :**
- **A. Dossier seul** : suffit pour la destination de l'onglet Playlist, qui est plate. Un dossier choisi par erreur ne ramasse que son premier niveau.
- **B. Récursif, comme le dossier source de l'extraction** : couvre un dossier organisé en sous-dossiers et réutilise le parcours existant. Un dossier trop large lance un run volumineux que la Feature 2 ne permet pas d'annuler.

**Choix : B**

**Rationale :**
- Décision du propriétaire le 2026-09-19 : le parcours ne coûte rien en code, le risque d'un run trop large est accepté.
- Un seul comportement de parcours dans le sidecar, celui de l'extraction.
