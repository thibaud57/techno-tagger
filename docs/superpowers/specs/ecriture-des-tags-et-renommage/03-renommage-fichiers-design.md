---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "renommage-fichiers"
goal: "Renommer un fichier écrit en `{artist} - {title}.{ext}` avec un nom lisible, valide sous Windows, sans collision et dont le chemin reste ouvrable par les autres logiciels"
status: "implemented"
complexity: "M"
tdd_scope: "full"
depends_on: ["01-ecriture-tags-design.md"]
date: "2026-10-11"
---

# Renommage des fichiers

## Scope

Couvre le calcul du nom `{artist} - {title}.{ext}` (remplacement lisible des caractères interdits par Windows, extension en minuscules, troncature du titre pour tenir dans un chemin de 259 caractères), son application dans le même dossier (collision suffixée, changement de casse seul, nom déjà correct, artiste ou titre absent), le préfixe `\\?\` de l'appel système et la traduction d'un échec en motif.

Exclut le moment du renommage dans l'enchaînement de l'écriture et le sort d'un morceau dont le renommage échoue (sub-project 04), le renommage inverse d'un rollback (06), et l'extension du préfixe `\\?\` aux autres opérations de fichiers du sidecar (extraction, écriture des tags).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer des tests qui calculent les noms de « QX/RT », « Mind: Body (Who? Remix) » et d'un titre trop long, puis renomment dans `tmp_path` un fichier simple, un fichier en collision, un fichier à la casse près et un fichier sans artiste, chacun relu sous son nouveau nom.

## Dependencies

- `01-ecriture-tags-design.md` (statut: implemented) : `file_failures.FileFailureReason` et `file_failure_reason`, sortis d'`extraction.py`.

## Files touched

- **À créer** : `sidecar/src/tagger/renaming.py` (`track_file_name`, `TrackFileName`, `plan_rename`, `RenamePlan`, `RenamedTrack`, `RenameError`, constantes de longueur)
- **À modifier** : `sidecar/src/tagger/paths.py` (`extended_path` : préfixe `\\?\`, UNC compris)
- **À créer** : `sidecar/tests/unit/test_renaming.py` (calcul du nom, application sur le disque, échec)
- **À modifier** : `sidecar/tests/unit/test_paths.py` (préfixe d'un chemin local, d'un chemin UNC, d'un chemin déjà préfixé)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.file_rename_failed`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Capacités Natives : règles du nom ; § Robustesse : limite de 259 caractères, collision ; use-case 5 : le renommage part de la projection, il ne relit pas les tags ; § Robustesse : la clé `LongPathsEnabled` est désactivée par défaut chez l'utilisateur et l'application ne peut pas l'activer, même si PyInstaller manifeste le binaire (`longPathAware`) ; arborescence : `renaming.py`)
- **À modifier** : `docs/PRODUCTION.md` (checklist, préfixe des chemins Windows : même correction)

## Architecture approach

- **Calcul pur** `track_file_name(artist, title, suffix, room, copy=1) -> TrackFileName(name, truncated) | None`, testable sans disque, `None` quand l'artiste ou le titre est vide après nettoyage ; `copy` au-delà de 1 ajoute ` (copy)` avant l'extension, pour une collision. Remplacements lisibles appliqués à l'artiste et au titre séparément : `/`, `\` et `|` deviennent `-`, `": "` devient `" - "` et un `:` isolé `-`, `"` devient `'`, `?`, `*`, `<`, `>` et les caractères de contrôle disparaissent, les espaces multiples se réduisent à un seul. Le nom est `Artiste - Titre`, le titre débarrassé de ses points et espaces finaux (Windows les retire en silence), suivi de l'extension en minuscules (`.aif` reste `.aif`). Les longueurs se comptent en unités UTF-16, celles de NTFS et de `MAX_PATH` : un emoji en vaut deux. Expressions compilées une fois (`.claude/rules/python/stdlib-donnees.md`)
- **Troncature** : quand le nom dépasse `room`, la fin du titre est coupée, puis les espaces, points et tirets laissés en bout de coupe, et `truncated` le signale. L'artiste n'est entamé que si `room` ne laisse plus de place au titre
- **Application** `plan_rename(path, artist, title) -> RenamePlan | None`, puis `RenamePlan.apply() -> RenamedTrack(path, truncated)`, synchrones (le sub-project 04 les appelle par `asyncio.to_thread`, `.claude/rules/python/asyncio.md`) :
  - artiste ou titre absent, ou vide après nettoyage : aucun renommage, `plan_rename` rend `None`, jugé avant la place disponible (un fichier sans artiste garde son nom même dans un dossier profond)
  - `room` = le plus petit de 255 (nom NTFS) et de 259 moins la longueur du dossier et du séparateur (chemin `MAX_PATH` des logiciels non adaptés aux chemins longs)
  - nom déjà identique : `None`, aucun appel système
  - même fichier à la casse près (`samefile`) : renommage direct, ce n'est pas une collision
  - collision avec un autre fichier : ` (2)`, ` (3)`… avant l'extension, le titre recoupé pour que le suffixe tienne. Quand l'extension et le marqueur d'une collision ne laissent aucune place au nom dans `room`, `track_file_name` rend `None` et `plan_rename` lève `RenameError` au motif `path_too_long` : un nom hors limite ne se fabrique pas, le préfixe `\\?\` ne refusant plus rien
  - `RenamePlan` porte la cible avant que le fichier ne bouge, sans rappel : le sub-project 04 la note au journal du dump (02) puis appelle `apply()`, qui échoue (verrou, droits, fichier disparu) sans déplacer le fichier
  - l'appel système passe par `extended_path` (`\\?\`, cf. ARCHITECTURE.md § Robustesse), le chemin rendu n'en porte pas
- **Échec** : une `OSError` devient `RenameError(path, reason)` (code `file_rename_failed`, `params` `file` et `reason`), motif traduit par `file_failure_reason` (`.claude/rules/python/gestion-erreurs.md`). Aucun log dans le module, l'appelant connaît le run
- **Valeurs** : l'artiste et le titre viennent de la projection écrite par le sub-project 01 (`TagField.ARTIST`, `TagField.TITLE`), identiques aux tags relus, sans rouvrir le fichier
- **Types** : `TrackFileName` en `NamedTuple`, `RenamedTrack` en `dataclass(frozen=True, slots=True)`, constantes `Final` (`.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/python/fichiers-io.md`)

## Acceptance criteria

### Scénario 1 : renommage simple
**GIVEN** `lior vance - dim orbit.MP3` et les valeurs « Lior Vance », « Dim Orbit (Extended Mix) »
**WHEN** on renomme le fichier
**THEN** il s'appelle `Lior Vance - Dim Orbit (Extended Mix).mp3`, dans le même dossier
**AND** `RenamedTrack.path` désigne ce nouveau chemin, sans préfixe `\\?\`

### Scénario 2 : caractères interdits
**GIVEN** les valeurs « QX/RT », « Down In Amber » puis « Someone », « Mind: Body (Who? Remix) »
**WHEN** on calcule les noms
**THEN** on obtient `QX-RT - Down In Amber.flac` et `Someone - Mind - Body (Who Remix).wav`

### Scénario 3 : collision
**GIVEN** un dossier qui contient déjà `Lior Vance - Dim Orbit (Extended Mix).mp3`
**WHEN** on renomme un autre fichier vers ce nom
**THEN** il devient `Lior Vance - Dim Orbit (Extended Mix) (2).mp3` et le fichier existant est intact

### Scénario 4 : casse seule
**GIVEN** `lior vance - dim orbit (extended mix).mp3`
**WHEN** on le renomme avec « Lior Vance », « Dim Orbit (Extended Mix) »
**THEN** il s'appelle `Lior Vance - Dim Orbit (Extended Mix).mp3`, sans suffixe

### Scénario 5 : sans artiste
**GIVEN** `rip_0042.wav` et un artiste absent
**WHEN** on le renomme
**THEN** il garde son nom et aucun appel système n'a lieu

### Scénario 6 : chemin trop long
**GIVEN** un dossier dont le chemin laisse 40 caractères au nom
**WHEN** on renomme un fichier dont le nom complet en ferait 60
**THEN** le nom tient en 40 caractères, extension comprise, le titre est coupé
**AND** `RenamedTrack.truncated` est vrai

### Scénario 7 : fichier verrouillé
**GIVEN** un fichier qu'un autre processus tient ouvert
**WHEN** on le renomme
**THEN** `RenameError` est levée avec le motif `file_locked` et le fichier garde son nom

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_renaming.py` :
  - parametrize des remplacements lisibles : `/`, `\`, `|`, `": "`, `:` isolé, `"`, `?`, `*`, `<`, `>`, caractère de contrôle, espaces multiples, point final
  - extension mise en minuscules, `.aif` conservé
  - troncature : fin du titre coupée, bout de coupe nettoyé, `truncated` vrai ; nom intact et `truncated` faux quand il tient
  - artiste ou titre absent ou vide après nettoyage : pas de renommage, même dans un dossier qui ne laisse aucune place
  - la cible est connue du plan alors que le fichier porte encore son ancien nom et `plan_rename` rend `None` quand il garde son nom
  - renommage simple relu sur le disque
  - nom déjà correct : fichier inchangé
  - changement de casse seul : renommé sans suffixe
  - collision : ` (2)` puis ` (3)`, fichiers existants intacts
  - collision dans un dossier au chemin long : le suffixe tient dans la limite
  - extension et marqueur de collision qui ne tiennent pas dans une `room` minuscule : `RenameError` au motif `path_too_long`
  - dossier qui ne laisse aucune place : `RenameError` au motif `path_too_long`
  - fichier verrouillé ou absent : `RenameError` au motif `file_locked` ou `file_missing`
- `sidecar/tests/unit/test_paths.py` :
  - `extended_path` préfixe un chemin local et un chemin UNC, et ne repréfixe pas un chemin déjà préfixé

## Edge cases

- **Fichier sans artiste dans un dossier trop profond** : il garde son nom, sans `RenameError` : l'absence d'artiste ou de titre se juge avant la place disponible
- **Noms réservés Windows** (`CON`, `NUL`, `COM1`…) : impossibles, le nom contient toujours ` - `
- **Titre réduit à rien par la troncature** : l'artiste est coupé à son tour pour qu'au moins un caractère du nom tienne ; un dossier qui ne laisse aucune place lève `RenameError` au motif `path_too_long`
- **Fichier déjà suffixé par un run précédent** (`X (2).mp3` alors que `X.mp3` existe) : le premier nom libre est le sien, il le garde
- **Tabulation ou retour à la ligne dans un tag** : devient une espace avant la purge des caractères de contrôle, les mots restent séparés
- **Résolution du chemin** : seul le dossier est résolu par `extended_path`, jamais le nom, sinon Windows rendrait la casse du fichier existant et un renommage de casse seule n'aurait plus d'effet
- **Accents et caractères non latins** : conservés tels quels, NTFS les accepte
- **Dossier sur un partage réseau** : chemin UNC préfixé `\\?\UNC\`

## Architectural decisions

### Décision : remplacement lisible des caractères interdits
**Options envisagées :**
- **A. Remplacement lisible** (`-`, `'`, suppression) : le nom se lit comme le titre
- **B. Underscore**, convention de Picard (« replace all Windows-incompatible characters with an underscore »), de beets (`'[<>:"\?\*\|]': _`) et de l'usage `$validate(…,_)` de Mp3tag
- **C. Suppression pure** : `QX/RT` devient `ACDC`
**Choix : A**
**Rationale :**
- Choix du propriétaire après comparaison sur exemples
- Picard le permet aussi depuis sa 2.9 (« allows the user to specify what replacement characters to use »)

### Décision : chemin limité à 259 caractères
**Options envisagées :**
- **A. Chemin complet ≤ 259** : Explorateur et logiciels DJ non adaptés aux chemins longs ouvrent le fichier, au prix d'un titre parfois tronqué
- **B. Nom ≤ 255 seulement** : aucun titre coupé, mais un chemin que d'autres logiciels peuvent refuser
**Choix : A**
**Rationale :**
- La bibliothèque sert d'abord dans le logiciel DJ ; le préfixe `\\?\` protège le sidecar, pas les autres programmes (ARCHITECTURE.md § Robustesse)

### Décision : collision suffixée
**Options envisagées :**
- **A. Suffixe ` (2)`, ` (3)`…** : rien n'est écrasé, chaque fichier porte un nom au motif
- **B. Nom d'origine gardé** : aucune ambiguïté, mais un fichier non renommé sans raison visible
**Choix : A**
**Rationale :**
- Choix du propriétaire ; même principe que les rapports d'extraction (`-2`, `-3`)

### Décision : pas de renommage sans artiste
**Options envisagées :**
- **A. Nom d'origine gardé**
- **B. `Titre.ext`**
**Choix : A**
**Rationale :**
- Choix du propriétaire : le nom d'origine porte peut-être l'artiste que la source n'a pas rendu
