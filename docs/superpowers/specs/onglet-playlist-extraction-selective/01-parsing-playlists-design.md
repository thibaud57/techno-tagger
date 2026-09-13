---
feature: "Feature 1 — Onglet Playlist, extraction sélective"
subproject: "parsing-playlists"
goal: "Lire les deux formats de playlist du projet et en extraire les noms de fichiers à traiter, sans toucher au système de fichiers musical"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: []
date: "2026-09-08"
---

# Parsing des playlists : dump SQLite VLC et M3U8

## Scope

Couvre la lecture des deux formats d'entrée du use-case 1 : le dump SQLite de VLC Android (détection du format, vérification du schéma, listage des playlists avec leur nombre de morceaux, extraction des noms de fichiers d'une playlist donnée) et le fichier M3U8 (extraction des noms de fichiers). Couvre également la base d'exceptions métier du sidecar, dont ce module est le premier consommateur.

Exclut la recherche des fichiers sur disque, le départage des doublons et la copie ou le déplacement, qui relèvent du sub-project 02. Exclut le rapport d'extraction (03) et toute exposition par le protocole NDJSON (04) : les modèles produits ici sont internes au sidecar.

### État livré

À la fin de ce sub-project, on peut : lancer `just test` sur le sidecar et voir passer une suite qui, sur un dump construit à partir du DDL réel de VLC Android, liste les playlists avec leur nombre de morceaux, extrait les noms de fichiers d'une playlist dédupliqués et triés, et échoue avec un message nommant précisément la table ou la colonne manquante quand le schéma est amputé.

## Dependencies

Aucune — ce sub-project est autoporté.

## Files touched

- **À créer** : `sidecar/src/tagger/errors.py` (base `TaggerError` de toutes les erreurs métier du sidecar)
- **À créer** : `sidecar/src/tagger/playlists/models.py` (`PlaylistFormat`, `PlaylistSummary`)
- **À créer** : `sidecar/src/tagger/playlists/errors.py` (famille `PlaylistError`)
- **À créer** : `sidecar/src/tagger/playlists/vlc.py` (dump SQLite : connexion, collation, vérification de schéma, requêtes)
- **À créer** : `sidecar/src/tagger/playlists/m3u8.py` (parsing du fichier texte)
- **À créer** : `sidecar/tests/helpers/vlc_dump.py` (constructeur de dump bâti sur le DDL archivé dans [knowledges/vlc-media-db.md](../../../knowledges/vlc-media-db.md) § DDL relevé, avec de quoi omettre une table ou une colonne pour les variantes amputées)
- **À créer** : `sidecar/tests/fixtures/sample.m3u8` (BOM, `#EXTM3U`, `#EXTINF`, lignes vides, chemins Windows et POSIX, noms non-ASCII)
- **À créer** : `sidecar/tests/unit/test_playlists_vlc.py`
- **À créer** : `sidecar/tests/unit/test_playlists_m3u8.py`
- **À modifier** : `sidecar/src/tagger/playlists/__init__.py` (remplace le stub par la façade du package et son `__all__`)
- **À modifier** : `sidecar/tests/conftest.py` (fixtures de dump VLC et de playlist M3U8, annoncées par son `TODO`)

## Architecture approach

- **Façade de package** : `playlists/__init__.py` déclare `__all__` et expose `detect_format()`, `list_playlists()` et `read_playlist()`. Le découpage interne entre `vlc.py` et `m3u8.py` ne fuit pas vers les appelants, conformément à `.claude/rules/python/imports-modules.md`. Imports relatifs à l'intérieur du sous-package, absolus depuis `tagger.` en dehors.
- **`list_playlists()` accepte les deux formats** : sur un dump elle rend ses playlists, sur un M3U8 une liste vide. La commande sert aussi à faire reconnaître le format par l'interface, qui n'a pas le droit de le déduire elle-même. Lever sur un M3U8 obligerait l'appelant à traiter un canal d'erreur comme un canal d'information, et un fichier réellement illisible cesserait d'être distinguable d'un M3U8 valide.
- **Détection du format par en-tête de fichier, pas par extension** : les 16 premiers octets d'une base SQLite valent `SQLite format 3\x00`. Tout fichier ne portant pas cet en-tête est traité comme du M3U8. Un fichier qui n'est ni l'un ni l'autre lisible produit une erreur métier, comme l'exige `.claude/rules/vlc-media-db/playlists.md`.
- **Séquence d'ouverture du dump, dans cet ordre** : connexion en lecture seule par URI (`mode=ro`), puis enregistrement de la collation `FILENAME`, puis vérification du schéma, puis requêtes. La collation précède la vérification parce que celle-ci lit déjà `Media`. Détail du piège dans `.claude/rules/vlc-media-db/playlists.md` et [ADR-019](../../../adrs/019-resilience-schema-vlc-media-db.md) § Vérification sur un dump réel.
- **Collation `FILENAME` reproduite en Python** : `Media.filename` est déclaré `COLLATE FILENAME`, collation propre à VLC absente de `sqlite3`. La CLI d'origine l'enregistrait par `create_collation` avec une comparaison insensible à la casse ; ce comportement est repris à l'identique. Elle ne gouverne que la déduplication du `SELECT DISTINCT`, l'ordre étant imposé par le `CAST(... AS TEXT) COLLATE NOCASE` explicite de l'`ORDER BY`.
- **Vérification de schéma insensible à la casse** : `sqlite_master` pour les trois tables, `PRAGMA table_info` pour les six colonnes, comparaison sur les noms normalisés en minuscules. Un schéma partiellement compatible est traité comme incompatible (ADR-019). L'erreur porte en `params` la liste des tables et colonnes manquantes.
- **Requêtes SQL embarquées dans le code**, jamais externalisées dans un fichier (ADR-019). Le nom de la playlist est passé en paramètre lié, jamais interpolé.
- **Comptage des morceaux par `count(DISTINCT media_id)` sur `PlaylistMediaRelation`** : les compteurs dénormalisés de `Playlist` sont relevés à zéro sur un dump portant pourtant des morceaux, et un simple `count()` compterait les relations plutôt que les morceaux. Un même morceau pouvant figurer deux fois dans une playlist, le `DISTINCT` aligne le nombre annoncé par le sélecteur sur celui que l'extraction livrera réellement.
- **Parsing M3U8 tolérant aux provenances** : lecture en `utf-8-sig` pour absorber un BOM, lignes vides et lignes préfixées de `#` ignorées (`#EXTM3U`, `#EXTINF` compris), chaque ligne restante réduite à son dernier segment après découpe sur `/` et sur `\`. Les deux séparateurs sont traités ensemble parce que le fichier vient d'une autre machine que celle qui le lit, ce qu'une classe `PurePath` liée à la plateforme courante ne couvrirait pas.
- **Modèles internes en dataclasses** : `@dataclass(frozen=True, slots=True)` et `StrEnum` annoté `@verify(UNIQUE)`, jamais pydantic à ce stade — rien ne traverse encore de frontière, la validation des charges NDJSON appartenant au sub-project 04. Cf. `.claude/rules/python/modeles-donnees.md`.
- **Erreurs métier à code stable** : `TaggerError` hérite d'`Exception` à la racine du package, `PlaylistError` en dérive, et chaque erreur porte un `code` et des `params` en attributs plutôt que dans son message, puisque c'est ce que sérialisera l'événement `error` du protocole et que l'interface traduit. Codes préfixés `playlist.`. Une exception `sqlite3` n'est jamais laissée remonter telle quelle : elle est convertie avec `raise ... from e`. Cf. `.claude/rules/python/gestion-erreurs.md`.
- **Typage strict** : annotations complètes, `Path` et jamais `str` pour les chemins, conformément à `.claude/rules/python/type-hints.md`, `.claude/rules/python/fichiers-io.md` et `.claude/rules/mypy/strict.md`.

## Acceptance criteria

### Scénario 1 : Listage des playlists d'un dump valide
**GIVEN** un dump dont le schéma porte les trois tables et six colonnes attendues, contenant deux playlists de 8 et 3 morceaux
**WHEN** `list_playlists()` est appelé sur ce dump
**THEN** deux `PlaylistSummary` sont rendus, portant chacun identifiant, nom et nombre de morceaux
**AND** les nombres valent 8 et 3, comptés sur `PlaylistMediaRelation` et non sur les compteurs dénormalisés de `Playlist`
**AND** un morceau figurant deux fois dans une playlist n'y est compté qu'une fois, le nombre annoncé étant celui que l'extraction livrera

### Scénario 2 : Extraction des noms de fichiers d'une playlist
**GIVEN** un dump valide dont une playlist porte des noms de fichiers en casse mixte, dont un présent deux fois
**WHEN** `read_playlist()` est appelé avec le nom de cette playlist
**THEN** les noms sont rendus dédupliqués
**AND** ils sont triés en ordre insensible à la casse
**AND** aucun élément rendu ne contient de séparateur de chemin

### Scénario 3 : Collation absente
**GIVEN** un dump dont la colonne `Media.filename` est déclarée `COLLATE FILENAME`
**WHEN** `read_playlist()` est appelé sur ce dump
**THEN** l'appel aboutit sans lever `sqlite3.OperationalError: no such collation sequence: FILENAME`
**AND** les noms rendus sont ceux de la playlist demandée

### Scénario 4 : Schéma amputé d'une table
**GIVEN** un dump dont la table `PlaylistMediaRelation` est absente
**WHEN** `list_playlists()` est appelé sur ce dump
**THEN** une erreur de schéma incompatible est levée avant toute autre requête
**AND** ses `params` nomment `PlaylistMediaRelation`

### Scénario 5 : Schéma amputé d'une colonne
**GIVEN** un dump dont les trois tables existent mais dont `Media` ne porte pas de colonne `filename`
**WHEN** `list_playlists()` est appelé sur ce dump
**THEN** une erreur de schéma incompatible est levée
**AND** ses `params` nomment `Media.filename`

### Scénario 6 : Casse des noms de colonnes
**GIVEN** un dump dont la colonne est déclarée `filename` en minuscules
**WHEN** la vérification de schéma s'exécute
**THEN** le schéma est déclaré compatible
**AND** aucune erreur n'est levée, la comparaison ne tenant pas compte de la casse

### Scénario 7 : Playlist demandée absente du dump
**GIVEN** un dump valide ne contenant aucune playlist du nom demandé
**WHEN** `read_playlist()` est appelé avec ce nom
**THEN** une erreur de playlist introuvable est levée, portant le nom demandé en `params`
**AND** aucun tuple vide n'est rendu silencieusement

### Scénario 8 : Fichier ni SQLite ni playlist lisible
**GIVEN** un fichier binaire quelconque, sans en-tête SQLite et sans ligne exploitable
**WHEN** `detect_format()` puis `read_playlist()` sont appelés dessus
**THEN** une erreur de format non supporté est levée
**AND** aucune exception `sqlite3` brute ne remonte à l'appelant

### Scénario 9 : Parsing d'un M3U8 issu d'une autre machine
**GIVEN** un fichier M3U8 avec BOM, comportant `#EXTM3U`, des `#EXTINF`, des lignes vides, des chemins absolus Windows et des chemins POSIX
**WHEN** `read_playlist()` est appelé sur ce fichier
**THEN** seuls les noms de fichiers sont rendus, sans aucun segment de chemin
**AND** les directives, commentaires et lignes vides sont absents du résultat
**AND** le BOM n'apparaît pas dans le premier nom rendu

### Scénario 10 : Listage demandé sur un M3U8
**GIVEN** un fichier M3U8 valide
**WHEN** `list_playlists()` est appelé dessus
**THEN** une liste vide est rendue sans qu'aucune erreur soit levée
**AND** le format reconnu reste disponible pour l'appelant, qui n'a pas à le déduire

## Tests à écrire

### Unit

- `sidecar/tests/unit/test_playlists_vlc.py` :
  - le listage rend un résumé par playlist, avec identifiant, nom et nombre de morceaux
  - le nombre de morceaux est compté sur la relation, et reste juste quand `Playlist.nb_audio` vaut zéro
  - l'extraction déduplique les noms et les trie en ordre insensible à la casse
  - l'extraction aboutit sur une colonne déclarée `COLLATE FILENAME`, sans `OperationalError`
  - une table manquante lève une erreur de schéma nommant cette table, avant toute requête d'extraction
  - une colonne manquante lève une erreur de schéma nommant table et colonne
  - une colonne nommée `filename` en minuscules est acceptée par la vérification
  - un nom de playlist absent lève une erreur de playlist introuvable plutôt que de rendre un résultat vide
  - un fichier sans en-tête SQLite n'est pas traité comme un dump
  - le listage sur un M3U8 rend une liste vide sans lever
  - une erreur `sqlite3` est convertie en erreur métier, sans remonter telle quelle
  - la connexion est ouverte en lecture seule : une tentative d'écriture sur la base échoue

- `sidecar/tests/unit/test_playlists_m3u8.py` :
  - les lignes `#EXTM3U` et `#EXTINF` sont ignorées
  - les lignes vides et les lignes d'espaces sont ignorées
  - un chemin absolu Windows est réduit à son nom de fichier
  - un chemin POSIX est réduit à son nom de fichier
  - un BOM en tête de fichier n'apparaît pas dans le premier nom rendu
  - un nom non-ASCII est rendu intact
  - un fichier ne contenant que des directives rend un résultat vide sans lever
  - un fichier binaire, ni SQLite ni texte décodable, lève `UnsupportedPlaylistFormatError`

### Integration

Aucune : les deux parsers sont des modules isolés, sans dialogue entre eux ni avec le protocole. Le protocole NDJSON de bout en bout est testé au sub-project 04, conformément au découpage `unit/` et `integration/` décrit dans `sidecar/tests/conftest.py`.

## Edge cases

- **Dump volumineux** : le fichier porte la médiathèque entière, pas une playlist. Le relevé du 2026-09-08 donne 795 entrées dans `Media` pour une playlist de 8 morceaux. Aucun chargement en mémoire du dump n'est fait, seules les requêtes filtrées sont exécutées.
- **Homonymes de playlists** : `Playlist.name` étant déclaré `COLLATE NOCASE`, deux playlists dont les noms ne diffèrent que par la casse sont confondues par le filtre sur le nom. Le `SELECT DISTINCT` rend alors l'union de leurs morceaux. Comportement assumé, tracé ici plutôt que corrigé.
- **Playlist vide** : une playlist sans morceau est listée avec un compte de zéro, et son extraction rend un résultat vide sans lever.
- **Morceau répété dans une playlist** : `PlaylistMediaRelation` accepte deux lignes pour le même `media_id` et le même `playlist_id`. Le `SELECT DISTINCT` de l'extraction les fusionne, le comptage du listage doit donc être `DISTINCT` lui aussi, sous peine d'annoncer un morceau de plus que ce qui sera extrait.
- **Construction de la fixture** : SQLite refuse un `CREATE TABLE` déclarant une collation inconnue. Le constructeur de dump enregistre donc `FILENAME` avant de créer les tables, exactement comme le lecteur avant de requêter.
- **Fichier M3U8 sans aucune entrée** : rend un résultat vide. C'est l'appelant, au sub-project 02, qui décide qu'un run sans morceau n'a pas lieu d'être.
- **Nom de fichier contenant les deux séparateurs** : la découpe retient le dernier segment après découpe sur `/` comme sur `\`, ce qui donne le nom de fichier quelle que soit la plateforme d'origine.

## Architectural decisions

### Décision : Enregistrer la collation `FILENAME` plutôt que contourner le SQL

**Options envisagées :**
- **A. Enregistrer la collation par `create_collation`** : une comparaison insensible à la casse est déclarée avant toute requête. Le `SELECT DISTINCT` et l'`ORDER BY` restent en SQL. Reproduit ce que fait la CLI d'origine depuis des mois sur de vrais dumps. La collation déclarée n'est pas celle de VLC, dont la logique exacte est inconnue : elle ne gouverne ici que la déduplication.
- **B. Retirer `DISTINCT` et `ORDER BY` du SQL, dédupliquer et trier en Python** : évite entièrement la collation manquante. Rend le code indépendant de toute collation personnalisée que VLC ajouterait ailleurs, mais s'écarte de la requête éprouvée et déplace en Python une déduplication que SQLite fait mieux.

**Choix : A**

**Rationale :**
- Les deux options ont été vérifiées sur un dump réel le 2026-09-08 et fonctionnent ; le départage se joue donc ailleurs que sur la faisabilité
- L'option A reproduit le comportement d'une CLI qui tourne depuis des mois sur des dumps réels, ce qui vaut mieux qu'un comportement équivalent sur le papier
- La requête d'ADR-019 est conservée mot pour mot, ce que l'option B briserait
- Le risque propre à A, une collation déclarée qui n'est pas celle de VLC, est borné : elle ne sert qu'au `DISTINCT`, l'ordre étant imposé par le `COLLATE NOCASE` explicite

### Décision : Détecter le format par en-tête de fichier plutôt que par extension

**Options envisagées :**
- **A. Lire les 16 premiers octets et chercher `SQLite format 3\x00`** : indépendant du nom du fichier, et donne d'emblée le message d'erreur attendu pour un fichier qui n'est ni une base ni une playlist. Demande une lecture binaire préalable.
- **B. Se fier à l'extension `.db` ou `.m3u8`** : trivial, mais un dump renommé, une extension absente ou un `.txt` exporté par erreur enverraient le fichier au mauvais parser, avec un message d'erreur sans rapport avec la cause.

**Choix : A**

**Rationale :**
- Rien ne garantit le nom du fichier : l'utilisateur choisit un chemin dans un dialogue, pas un format
- La rule `.claude/rules/vlc-media-db/playlists.md` demande de rejeter avec un message clair un fichier qui n'est pas une base SQLite valide, ce que l'extension seule ne permet pas de constater
- L'interface affiche déjà un logo distinct selon que le fichier est un dump VLC reconnu ou non : cette reconnaissance a besoin d'un critère fiable, et elle viendra du sidecar

### Décision : Modèles en dataclasses plutôt qu'en modèles pydantic

**Options envisagées :**
- **A. `@dataclass(frozen=True, slots=True)`** : structures purement internes au sidecar, immuables, sans coût de validation. Devront être converties en modèles de protocole au sub-project 04.
- **B. `BaseModel` pydantic dès maintenant** : évite une conversion plus tard, mais valide des données qui ne viennent d'aucune frontière externe, et anticipe un contrat NDJSON qui n'est pas encore écrit.

**Choix : A**

**Rationale :**
- `.claude/rules/python/modeles-donnees.md` réserve pydantic à ce qui traverse une frontière et les dataclasses aux structures internes ; rien ici ne traverse de frontière
- Le contrat NDJSON s'écrit au sub-project 04 : figer sa forme ici reviendrait à décider à sa place, depuis un module qui ne le connaît pas
- La validation pydantic protégerait contre des charges malformées venues de l'extérieur, alors que les valeurs proviennent ici d'une base lue localement
