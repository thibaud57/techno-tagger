---
feature: "Feature 1 — Onglet Playlist, extraction sélective"
subproject: "resolution-extraction-fichiers"
goal: "Retrouver sur disque les morceaux d'une playlist par leur nom de fichier et les copier ou les déplacer vers le dossier destination"
status: "implemented"
complexity: "M"
tdd_scope: "full"
depends_on: ["01-parsing-playlists-design.md"]
date: "2026-10-11"
---

# Résolution par nom de fichier et extraction vers le dossier destination

## Scope

Couvre la recherche récursive des morceaux dans le dossier source à partir de leur seul nom de fichier, le départage des homonymes selon ADR-020, la copie ou le déplacement vers le dossier destination, et la poursuite du traitement sur chaque incident. Rend en mémoire un résultat détaillant ce qui a été extrait, ce qui était déjà présent, ce qui reste introuvable, quels homonymes ont été départagés et quelles copies ont échoué.

Exclut la sérialisation de ce résultat en rapport sur disque (sub-project 03) et son exposition par le protocole NDJSON (sub-project 04). Exclut toute lecture ou écriture de tags : aucun fichier n'est ouvert autrement que pour être copié ou déplacé.

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui, sur une arborescence de test portant des homonymes de tailles différentes, retient le fichier le plus volumineux, dépose les morceaux dans la destination, laisse la source intacte en mode copie, et rend la liste des introuvables et des homonymes départagés avec leurs candidats écartés, leur chemin et leur taille.

## Dependencies

- `01-parsing-playlists-design.md` (statut: implemented) : fournit `read_playlist()`, dont les noms de fichiers sont l'entrée de ce module et `TaggerError`, base des erreurs métier.

## Files touched

- **À créer** : `sidecar/src/tagger/extraction.py` (modèles, erreurs du run, index du dossier source, départage, extraction)
- **À créer** : `sidecar/tests/unit/test_extraction_index.py` (construction de l'index et départage des homonymes)
- **À créer** : `sidecar/tests/unit/test_extraction_run.py` (copie, déplacement, incidents, progression)
- **À modifier** : `sidecar/tests/conftest.py` (fixture d'arborescence source, construite en `tmp_path`)

## Architecture approach

- **Module à responsabilité unique** `tagger/extraction.py` : résoudre des noms en chemins, puis déplacer des fichiers. Le parsing reste dans `tagger/playlists/`, la lecture et l'écriture des tags dans `files.py`. Aucun des trois ne déborde sur les autres, conformément à `.claude/rules/python/imports-modules.md`.
- **Index construit en une seule passe** : le dossier source est parcouru récursivement une fois, produisant une correspondance du nom de fichier vers la liste des chemins qui le portent. Une recherche répétée par nom relirait l'arborescence autant de fois qu'il y a de morceaux, ce qui est intenable sur une bibliothèque de dizaines de milliers de fichiers alors qu'un run type traite 100 morceaux.
- **Clés d'index normalisées en minuscules** : la cible est Windows, dont le système de fichiers est insensible à la casse. Un morceau nommé `Track.mp3` dans la playlist doit trouver `track.mp3` sur le disque.
- **Départage des homonymes selon ADR-020**, dans cet ordre : taille décroissante, puis ordre alphabétique du chemin à taille égale. Le second critère n'est pas cosmétique : il rend deux runs successifs sur le même dossier identiques. Le critère effectivement appliqué est consigné, le rapport devant dire pourquoi ce fichier-là a été retenu.
- **Rien n'interrompt le run** : un morceau introuvable, un homonyme départagé ou une copie en échec sont consignés et le traitement continue, conformément à ADR-020 et au use-case 1. Seule une erreur portant sur le run entier remonte en exception, sous la forme d'une famille `ExtractionError` héritée de `TaggerError` et définie dans le module, avec son `code` stable et ses `params` : `SourceFolderUnreadableError` (dossier source absent ou qui n'est pas un dossier) et `DestinationFolderUnwritableError` (dossier destination impossible à créer). Les deux lèvent avant tout transfert.
- **Le résultat porte cinq catégories** : extraits, déjà présents, introuvables, homonymes départagés, échecs. `extracted`, `already_present`, `missing` et `failures` partitionnent les morceaux demandés, `duplicates` est une annotation qui co-occurre avec eux (un morceau départagé figure aussi parmi les extraits, les déjà présents ou les échecs). L'événement `extraction_finished` les porte toutes (sub-project 04), sans quoi l'interface ne pourrait afficher ni un fichier déjà présent ni une copie en échec.
- **Motifs d'échec repris de la nomenclature existante** : `permission_denied`, `disk_full`, `path_too_long`, `file_locked`, `file_missing` et `write_failed` sont les six valeurs d'écriture de `failure_reason` dans ARCHITECTURE.md § Backend > API, reprises au complet. Elles vivent dans `tagger/file_failures.py` (`FileFailureReason` et `file_failure_reason()`, qui classe une `OSError`), partagé avec l'écriture des tags : un seul vocabulaire pour l'extraction et l'écriture.
- **Une collision en destination n'écrase jamais** : un fichier du même nom déjà présent fait passer le morceau en « déjà présent ». C'est ce qui rend l'extraction rejouable, un run relancé ne recopiant pas ce qui est là. Écraser détruirait le travail d'un re-tagging déjà passé sur le dossier de destination.
- **Destination et source ne s'excluent pas mutuellement, le module les arbitre** : une destination posée dans la source est écartée de l'index (`excluded`, comparée lexicalement), faute de quoi chaque morceau déjà extrait deviendrait l'homonyme de son original au second run. Une destination confondue avec la source ne transfère rien.
- **Un nom demandé deux fois par la playlist n'est transféré qu'une fois** : la seconde occurrence est comptée « déjà présent » et l'ambiguïté d'homonymes qu'elle porte n'est consignée qu'une fois.
- **Copie et déplacement par `Path.copy()` et `Path.move()`** de la stdlib 3.14, sans importer `shutil` (cf. `.claude/rules/python/fichiers-io.md`). `Path` partout, jamais `os.path` ni de concaténation de chaînes.
- **Progression remontée par rappel** : l'extraction accepte une fonction optionnelle appelée après chaque morceau avec le nombre traité et le total. Le module ignore tout du protocole NDJSON, que `handlers.py` (sub-project 04) branche dessus pour alimenter l'événement `progress`.
- **Modèles internes en dataclasses gelées et `StrEnum` annotés `@verify(UNIQUE)`**, jamais pydantic : rien ne traverse ici de frontière externe (cf. `.claude/rules/python/modeles-donnees.md`). Le sub-project 03 les sérialise, le 04 les convertit en modèles de protocole.
- **Logs en logfmt** par `logging.getLogger(__name__)`, sans jamais faire sortir de chemin complet vers Sentry (cf. `.claude/rules/python/gestion-erreurs.md`).

## Acceptance criteria

### Scénario 1 : Extraction nominale en mode copie
**GIVEN** un dossier source contenant les cinq morceaux d'une playlist, répartis dans des sous-dossiers
**WHEN** l'extraction est lancée en mode copie vers un dossier destination vide
**THEN** les cinq fichiers se retrouvent dans la destination
**AND** les cinq fichiers d'origine sont toujours présents dans la source
**AND** le résultat les liste comme extraits

### Scénario 2 : Extraction en mode déplacement
**GIVEN** le même dossier source et la même playlist
**WHEN** l'extraction est lancée en mode déplacement
**THEN** les fichiers se retrouvent dans la destination
**AND** ils ont disparu de la source

### Scénario 3 : Résolution par nom et non par chemin
**GIVEN** une playlist dont les entrées portent des noms de fichiers sans aucun chemin, et un dossier source où ces fichiers sont enfouis dans des sous-dossiers
**WHEN** l'extraction est lancée
**THEN** chaque morceau est retrouvé
**AND** l'arborescence de la source n'a joué aucun rôle dans la recherche

### Scénario 4 : Homonymes départagés par la taille
**GIVEN** un dossier source contenant deux fichiers du même nom, dans deux sous-dossiers, de 5 Mo et 12 Mo
**WHEN** l'extraction est lancée
**THEN** le fichier de 12 Mo est celui déposé en destination
**AND** le résultat consigne le fichier retenu, le candidat écarté avec son chemin et sa taille, et le critère de taille

### Scénario 5 : Homonymes de taille égale départagés par le chemin
**GIVEN** un dossier source contenant deux fichiers du même nom et de taille identique
**WHEN** l'extraction est lancée deux fois de suite
**THEN** le même fichier est retenu aux deux passages, celui dont le chemin vient en premier dans l'ordre alphabétique
**AND** le résultat consigne le critère d'ordre de chemin

### Scénario 6 : Morceau introuvable
**GIVEN** une playlist dont une entrée ne correspond à aucun fichier du dossier source
**WHEN** l'extraction est lancée
**THEN** le traitement va jusqu'au bout et les autres morceaux sont extraits
**AND** le nom introuvable figure dans le résultat comme tel
**AND** aucune exception ne remonte à l'appelant

### Scénario 7 : Fichier déjà présent en destination
**GIVEN** un dossier destination contenant déjà un fichier du même nom qu'un morceau à extraire
**WHEN** l'extraction est lancée
**THEN** le fichier de destination est laissé intact, son contenu inchangé
**AND** le morceau est compté comme déjà présent, distinct des morceaux extraits

### Scénario 8 : Copie en échec
**GIVEN** un morceau dont la copie échoue par refus de permission
**WHEN** l'extraction est lancée
**THEN** le traitement continue sur les morceaux suivants
**AND** le résultat consigne l'échec avec le motif `permission_denied`

### Scénario 9 : Casse différente entre la playlist et le disque
**GIVEN** une playlist demandant `Artist One - Alpha Track.mp3` et un dossier source contenant `artist one - alpha track.mp3`
**WHEN** l'extraction est lancée
**THEN** le fichier est retrouvé et extrait

### Scénario 10 : Progression remontée à l'appelant
**GIVEN** une playlist de cinq morceaux et une fonction de rappel de progression
**WHEN** l'extraction est lancée
**THEN** le rappel est appelé cinq fois
**AND** le dernier appel porte un nombre traité égal au total

### Scénario 11 : Dossier source illisible
**GIVEN** un chemin de dossier source qui n'existe pas
**WHEN** l'extraction est lancée
**THEN** une erreur métier est levée avant tout traitement
**AND** aucun fichier n'a été écrit en destination

### Scénario 12 : Dossier destination impossible à créer
**GIVEN** un chemin de destination que le système refuse de créer
**WHEN** l'extraction est lancée
**THEN** une erreur métier de destination non inscriptible est levée avant tout transfert
**AND** aucune exception `OSError` brute ne remonte

### Scénario 13 : Destination posée dans la source
**GIVEN** un dossier destination situé dans le dossier source, déjà peuplé par un premier run
**WHEN** l'extraction est relancée
**THEN** les fichiers de la destination n'entrent pas dans l'index
**AND** aucun morceau n'est départagé contre sa propre copie

## Tests à écrire

### Unit

- `sidecar/tests/unit/test_extraction_index.py` :
  - l'index rassemble sous une même clé deux fichiers homonymes situés dans des sous-dossiers différents
  - l'index est insensible à la casse, un nom demandé en casse mixte trouvant un fichier en minuscules
  - le départage retient le fichier le plus volumineux et consigne le critère de taille
  - le départage à taille égale retient le premier chemin en ordre alphabétique et consigne ce critère
  - le départage à taille égale rend le même fichier sur deux constructions successives de l'index
  - les candidats écartés sont consignés avec leur chemin et leur taille
  - un nom sans aucun candidat ne produit aucune entrée d'index
  - un sous-dossier exclu de l'index n'y figure pas
  - un dossier source inexistant, ou qui est un fichier, lève une erreur métier
  - les dossiers n'entrent pas dans l'index

- `sidecar/tests/unit/test_extraction_run.py` :
  - le mode copie dépose les fichiers en destination et laisse la source intacte
  - le mode déplacement dépose les fichiers et vide la source
  - un morceau introuvable est consigné et le traitement se poursuit sur les suivants
  - un fichier déjà présent en destination n'est pas écrasé et est compté à part
  - un échec de copie est consigné avec son motif et n'interrompt pas le run
  - le rappel de progression est appelé une fois par morceau, le dernier appel portant le total
  - l'extraction sans rappel de progression fonctionne à l'identique
  - le dossier destination est créé s'il n'existe pas
  - une playlist vide ne laisse derrière elle aucun dossier destination
  - une destination confondue avec la source ne transfère rien, même en mode déplacement
  - une destination posée dans la source est ignorée au second run
  - un nom demandé deux fois est extrait une fois puis compté déjà présent, son doublon consigné une seule fois
  - un homonyme disparu entre l'indexation et la copie est consigné en `file_missing`
  - une destination impossible à créer lève une erreur métier
  - une copie qui échoue poursuit sur les morceaux suivants, avec le motif de l'échec (`permission_denied`, `disk_full`)

- `sidecar/tests/unit/test_file_failures.py` (partagé avec l'écriture des tags) :
  - une `OSError` est classée en motif du projet, le code Windows prévalant sur le type (verrou, chemin trop long)

## Edge cases

- **Playlist vide** : l'extraction rend un résultat vide sans lever et sans créer de dossier destination inutile. C'est l'appelant, au sub-project 04, qui décide qu'un run sans morceau n'a pas lieu d'être.
- **Fichier verrouillé sous Windows** : l'ouverture d'un fichier tenu par un lecteur audio lève `PermissionError` comme un vrai refus de permission. Les deux se distinguent par le code d'erreur Windows porté par l'exception, qui prime sur son type et le motif consigné en dépend.
- **Chemin de destination trop long** : au-delà de la limite historique de Windows, l'écriture échoue en `path_too_long`.
- **Source et destination confondues** : si les deux chemins désignent le même dossier, chaque morceau est trouvé puis vu comme déjà présent, et rien n'est copié. Aucun fichier n'est perdu, y compris en mode déplacement.
- **Destination dans la source** : exclue de l'index, les originaux restent les seuls candidats.
- **Homonymes dont l'un disparaît entre l'indexation et la copie** : l'index est un instantané. Un fichier retiré entre-temps produit un échec de copie consigné, pas une exception.

## Architectural decisions

### Décision : Indexer le dossier source en une passe plutôt que chercher morceau par morceau

**Options envisagées :**
- **A. Une passe récursive unique, construisant une correspondance nom vers chemins** : le coût du parcours est payé une fois, quel que soit le nombre de morceaux. Occupe la mémoire à proportion du nombre de fichiers de la bibliothèque, non du nombre de morceaux à extraire. Détecte les homonymes gratuitement, puisqu'ils tombent sous la même clé.
- **B. Une recherche récursive par nom demandé** : mémoire négligeable, mais relit l'arborescence autant de fois qu'il y a de morceaux, et doit de toute façon parcourir l'ensemble pour être sûre d'avoir vu tous les homonymes.

**Choix : A**

**Rationale :**
- Le déséquilibre est structurel : une bibliothèque compte des dizaines de milliers de fichiers quand un run type en traite 100
- L'option B ne peut pas s'arrêter au premier fichier trouvé sans renoncer au départage des homonymes, qu'ADR-020 impose : elle paie donc le parcours complet, cent fois
- L'empreinte mémoire d'une correspondance de noms vers des chemins reste modeste au regard de ce que représente la bibliothèque elle-même sur le disque

### Décision : Ne jamais écraser un fichier déjà présent en destination

**Options envisagées :**
- **A. Passer le morceau et le compter comme déjà présent** : l'extraction devient rejouable, un run relancé après interruption ne recopiant que ce qui manque. Le rapport distingue ce qui a été extrait de ce qui était déjà là.
- **B. Écraser systématiquement** : la destination reflète toujours le dernier run, au prix d'une perte réelle. Un second run sur un dossier déjà retagué remplacerait les fichiers corrigés par leurs versions d'origine.

**Choix : A**

**Rationale :**
- Le dossier de destination est un dossier de travail qui sera réécrit par le re-tagging : y déverser à nouveau les originaux annulerait ce travail sans prévenir
- La reprise après interruption est un cas prévu par le projet, et l'option A la rend triviale sans plan ni état persisté
- Le principe d'intégrité du projet, ne jamais toucher un fichier musical sans nécessité, s'applique aussi au dossier de destination

### Décision : Réutiliser les motifs d'échec de l'écriture plutôt qu'en créer

**Options envisagées :**
- **A. Reprendre `permission_denied`, `disk_full`, `path_too_long`, `file_locked`, `file_missing`, `write_failed`** : ces valeurs sont déjà fixées par ARCHITECTURE.md pour l'écriture des tags et décrivent exactement les mêmes pannes de système de fichiers.
- **B. Définir un jeu de motifs propre à l'extraction** : nommage libre, au prix de deux vocabulaires décrivant les mêmes incidents à deux endroits du même run.

**Choix : A**

**Rationale :**
- Les causes sont identiques : un disque plein ou un fichier verrouillé ne change pas de nature selon la phase où on le rencontre
- L'utilisateur lit deux rapports produits par le même run ; un même incident doit y porter le même nom
- Créer un second vocabulaire obligerait à le traduire dans l'interface une seconde fois, pour un gain nul
