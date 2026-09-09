---
title: "vlc_media.db — Dump de la médiathèque VLC Android"
acces: "fichier-local"
releve: "2026-08-29"
volatilite: "moyenne"
description: "Carte de la source vlc_media.db : obtention du dump, tables et colonnes attestées, vérification de schéma et points non relevés."
date: "2026-08-29"
keywords: ["vlc", "sqlite", "playlist", "android", "dump", "schema"]
scope: ["docs", "source"]
technologies: ["SQLite", "Python"]
---

# Description

Base SQLite exportée depuis **VLC Android**, seule sortie de playlist de cette application, qui n'a aucune fonction d'export. Le cas d'usage principal du projet est une playlist curée sur téléphone : l'extraction sélective part de ce fichier (cf. [ADR-019](../adrs/019-resilience-schema-vlc-media-db.md)).

Ce n'est ni un site scrapé ni une API, mais un **format non documenté d'un système qu'on ne contrôle pas** : le schéma est un détail d'implémentation interne de VLC, susceptible de changer sans préavis, et il ne se connaît que par observation. D'où une fiche source plutôt qu'une fiche techno.

> **Champ `acces` hors référentiel.** Le template n'accepte que `scraping-html`, `api-publique`, `api-privee` et `hybride`, dont aucune ne décrit un fichier local exporté à la main. La valeur `fichier-local` est posée faute de mieux et n'est pas comparable à celle des autres fiches source.

> **Aucune session de reconnaissance n'a été menée sur un dump réel.** Ce qui suit vient de l'inspection du fichier SQL de la CLI existante et de l'ADR-019. Tout le reste est marqué non relevé, y compris quand une hypothèse paraîtrait raisonnable.

---

# Concepts Clés

## Accès & anti-bot

### Description

Aucun accès distant, aucune protection à contourner. L'utilisateur exporte lui-même la base depuis son téléphone, par **Réglages > Avancé > Dump media database** dans VLC Android, puis la transfère sur le PC et la sélectionne dans l'application.

Le dump contient **toute la médiathèque**, pas une playlist : la sélection se fait ensuite dans l'interface.

### Exemple

```python
import sqlite3

connection = sqlite3.connect(f"file:{dump_path}?mode=ro", uri=True)
```

### Points Importants

- **Ouvrir en lecture seule** (`mode=ro`) : le fichier appartient à l'utilisateur, l'application n'a aucune raison de l'écrire
- Les scripts tiers de type `vlc-to-m3u` ne font rien d'autre que lire cette même base : il n'existe pas de chemin d'export plus direct
- **Le format M3U8 n'a aucune de ces contraintes** : textuel, stable, une seule playlist par fichier, donc aucune sélection à faire. C'est l'autre entrée acceptée par le use-case d'extraction
- Un fichier qui n'est pas une base SQLite valide doit être rejeté avec un message clair, l'utilisateur pouvant s'être trompé de fichier

---

## Routes & URLs

_Non applicable : source locale, aucune URL ni endpoint._

---

## Network observé

_Non applicable : aucun trafic réseau, le dump est un fichier transféré à la main._

---

## Structure DOM & sélecteurs

_Non applicable : base SQLite, aucun HTML à parser._

---

## Schémas de données

> Relevé : inspection du fichier SQL de la CLI [`BeatportScrapper-TrackTagger`](https://github.com/thibaud57/BeatportScrapper-TrackTagger) le 2026-08-29, puis **ouverture d'un dump réel le 2026-09-08**, version de VLC Android non notée. Le DDL ci-dessous est celui de ce dump.

### Description

Six colonnes réparties sur trois tables sont attestées, d'abord par la requête que la CLI exécute depuis des mois sur des dumps réels, puis confirmées par l'ouverture d'un dump. Le dump relevé porte 68 tables au total : le reste du schéma n'est pas inspecté.

### Exemple

```sql
-- Requête d'origine de la CLI, dont le nom de playlist était codé en dur
SELECT DISTINCT m.filename
FROM Playlist p
INNER JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
INNER JOIN Media m ON m.id_media = pm.media_id
WHERE p.name = 'final'
ORDER BY CAST(m.filename AS TEXT) COLLATE NOCASE;
```

Cette requête **échoue seule** : `Media.filename` est déclaré `COLLATE FILENAME`, une collation propre à VLC absente de `sqlite3`. La CLI l'enregistrait avant d'exécuter la requête, et c'est ce que sa transcription dans la documentation avait perdu.

```python
# Collation de la CLI d'origine, sans laquelle toute requête touchant
# Media.filename lève OperationalError: no such collation sequence: FILENAME
connection.create_collation(
    "FILENAME",
    lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()),
)
```

| Table | Colonnes attestées | Déclaration relevée |
|---|---|---|
| `Playlist` | `id_playlist`, `name` | `id_playlist INTEGER PRIMARY KEY AUTOINCREMENT`, `name TEXT COLLATE NOCASE` |
| `PlaylistMediaRelation` | `playlist_id`, `media_id` | `media_id INTEGER`, `playlist_id INTEGER`, plus `position INTEGER` |
| `Media` | `id_media`, `filename` | `id_media INTEGER PRIMARY KEY AUTOINCREMENT`, `filename TEXT COLLATE FILENAME` |

### DDL relevé

> Relevé verbatim dans `sqlite_master` d'un dump réel, le 2026-09-08. Reproduire ces déclarations telles quelles dans une fixture : `COLLATE FILENAME` et `COLLATE NOCASE` portent les pièges, un DDL simplifié n'en reproduirait aucun.

```sql
CREATE TABLE Playlist(id_playlist INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT COLLATE NOCASE,creation_date UNSIGNED INT NOT NULL,artwork_mrl TEXT,nb_video UNSIGNED INT NOT NULL DEFAULT 0,nb_audio UNSIGNED INT NOT NULL DEFAULT 0,nb_unknown UNSIGNED INT NOT NULL DEFAULT 0,nb_present_video UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_video <= nb_video),nb_present_audio UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_audio <= nb_audio),nb_present_unknown UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_unknown <= nb_unknown),duration UNSIGNED INT NOT NULL DEFAULT 0,nb_duration_unknown UNSIGNED INT NOT NULL DEFAULT 0, is_favorite BOOLEAN NOT NULL DEFAULT FALSE);

CREATE TABLE PlaylistMediaRelation(media_id INTEGER,playlist_id INTEGER,position INTEGER,FOREIGN KEY(media_id) REFERENCES Media(id_media) ON DELETE NO ACTION,FOREIGN KEY(playlist_id) REFERENCES Playlist(id_playlist) ON DELETE CASCADE);

CREATE TABLE Media(id_media INTEGER PRIMARY KEY AUTOINCREMENT,type INTEGER,subtype INTEGER NOT NULL DEFAULT 0,duration INTEGER DEFAULT -1,last_position REAL DEFAULT -1,last_time INTEGER DEFAULT -1,play_count UNSIGNED INTEGER NOT NULL DEFAULT 0,last_played_date UNSIGNED INTEGER,insertion_date UNSIGNED INTEGER,release_date UNSIGNED INTEGER,title TEXT COLLATE NOCASE,filename TEXT COLLATE FILENAME,is_favorite BOOLEAN NOT NULL DEFAULT 0,is_present BOOLEAN NOT NULL DEFAULT 1,device_id INTEGER,nb_playlists UNSIGNED INTEGER NOT NULL DEFAULT 0,folder_id UNSIGNED INTEGER,import_type UNSIGNED INTEGER NOT NULL,group_id UNSIGNED INTEGER,forced_title BOOLEAN NOT NULL DEFAULT 0,artist_id UNSIGNED INTEGER,genre_id UNSIGNED INTEGER,track_number UNSIGNED INTEGER,album_id UNSIGNED INTEGER,disc_number UNSIGNED INTEGER,lyrics TEXT,is_public BOOLEAN NOT NULL DEFAULT FALSE,nb_subscriptions UNSIGNED INTEGER NOT NULL DEFAULT 0,description TEXT);
```

SQLite refuse un `CREATE TABLE` déclarant une collation qu'il ne connaît pas : construire une fixture à partir de ce DDL exige d'enregistrer `FILENAME` avant la création des tables, comme la lecture l'exige avant les requêtes.

### Points Importants

- **La colonne est `filename`, pas `fileName`.** SQLite étant insensible à la casse sur les identifiants, la requête d'origine fonctionne malgré son casing, mais une vérification de schéma qui compare les noms de colonnes littéralement la déclarerait manquante
- **`filename` est un nom de fichier, pas un chemin.** Relevé sur le dump : aucune valeur ne contient de séparateur de chemin. La base vient du téléphone, les fichiers sont sur le PC, et la résolution se fait par nom cherché récursivement dans le dossier source
- **La collation `FILENAME` doit être enregistrée avant toute requête** touchant `Media.filename`. Un `SELECT DISTINCT` suffit à la déclencher, et le `CAST(... AS TEXT) COLLATE NOCASE` de l'`ORDER BY` n'y change rien
- Le `COLLATE NOCASE` de la requête d'origine est conservé : il rend l'ordre de traitement stable et lisible dans le rapport, indépendamment de la collation de la colonne
- **Les compteurs dénormalisés de `Playlist` ne sont pas fiables** : `nb_audio` relevé à 0 sur une playlist portant 8 morceaux. Compter par `count()` sur `PlaylistMediaRelation`
- **`Playlist.name` est déclaré `COLLATE NOCASE`** : deux playlists dont les noms ne diffèrent que par la casse sont confondues par un filtre sur le nom
- **Aucune spécification publique du schéma n'existe.** Des sources tierces confirment l'existence de `PlaylistMediaRelation` et d'un champ de nom de fichier, sans documenter de version
- **Aucun changement de schéma n'a été constaté à ce jour**, seulement supposé : c'est ce qui a fait écarter la détection multi-schémas, faute d'échantillons de versions différentes. Le dump du 2026-09-08 confirme les colonnes relevées sur la CLI en 2026-08-29

---

## Pagination & volumétrie

> Relevé : mesures prises sur un dump réel le 2026-09-08, un seul échantillon.

### Description

Un dump de 29 Mo portant 68 tables, 795 entrées dans `Media` et une seule playlist de 8 morceaux. L'écart entre 795 et 8 illustre le point décidé ci-dessous : le dump est la médiathèque entière, pas un export de playlist.

### Points Importants

- **Un seul échantillon mesuré**, le 2026-09-08 : 29 Mo, 68 tables, 795 entrées dans `Media`, 1 playlist de 8 morceaux. Rien ne dit qu'il soit représentatif d'une grosse médiathèque
- Ce qui est décidé, en revanche : **le dump entier est chargé pour n'en extraire qu'une playlist**, conséquence assumée de l'ADR-019. Si la volumétrie devenait un problème, c'est ce point qui serait à revoir
- Le listage des playlists ajoute une requête et un aller-retour d'interface avant l'extraction

---

## Auth & quotas

_Non applicable : fichier local, aucune authentification, aucun quota, aucun rate limit._

---

## Fixtures & rejeu

### Description

Un dump réel a été fourni le 2026-09-08 et inspecté hors du dépôt. Il n'y entre pas : le dépôt est public ([ADR-021](../adrs/021-visibilite-du-depot.md)) et un dump porte la médiathèque entière de son propriétaire.

### Points Importants

- **Un dump réel ne se commite jamais**, il porte les noms de fichiers de toute une bibliothèque personnelle. L'inspecter hors du dépôt, en extraire le DDL, puis construire la fixture à partir de ce DDL avec un contenu inventé
- **Noter la version de VLC Android à chaque capture** : celle du dump du 2026-09-08 ne l'a pas été, donc un écart de schéma futur ne serait pas rattachable à une version
- Ce qui rendrait la recon rejouable : un dump réel anonymisé, avec la version de VLC Android qui l'a produit. **La version compte autant que le fichier** : sans elle, un écart de schéma futur ne serait rattachable à rien
- Signal de casse à surveiller : l'échec de la vérification de schéma décrite ci-dessous, qui nomme la table ou la colonne manquante
- Un tel échec impose une nouvelle version de l'application, sans contournement côté utilisateur : c'est le prix de la requête embarquée

---

# Bonnes Pratiques

## ✅ Recommandations

- **Vérifier le schéma avant tout traitement** : inspecter `sqlite_master` pour `Playlist`, `PlaylistMediaRelation` et `Media`, puis les colonnes utilisées, et produire un message nommant précisément ce qui manque
- **Traiter un schéma partiellement compatible comme incompatible** : extraire à moitié une playlist est pire qu'échouer clairement, l'utilisateur découvrant les morceaux manquants bien plus tard
- **Lister les playlists avec leur nombre de morceaux** avant l'extraction : le sélecteur rend visible le contenu du dump, y compris quand l'utilisateur s'est trompé de fichier
- **Résoudre par nom de fichier, jamais par chemin**, et chercher récursivement dans le dossier source
- **Ouvrir la base en lecture seule**
- **Capturer un dump de référence avec sa version de VLC** dès qu'un utilisateur en fournit un : c'est la fixture qui manque aujourd'hui

## ❌ Anti-Patterns

- **Externaliser la requête SQL dans un fichier éditable** : c'est ce que faisait la CLI, et son usage réel était de changer le `WHERE p.name`, ce qu'un sélecteur fait mieux. Le bénéfice qu'on lui prêtait, absorber un changement de schéma, n'a jamais été exercé et supposerait un utilisateur capable d'écrire du SQL
- **Coder plusieurs variantes de schéma « au cas où »** : aucun changement n'a été observé, et coder pour des variantes hypothétiques sans échantillon est spéculatif
- **Utiliser le chemin stocké dans la base** : il pointe vers l'arborescence du téléphone, pas vers le PC
- **Laisser remonter une exception SQLite brute** : elle n'est pas exploitable dans un rapport d'erreur, là où un message nommant la table manquante l'est
- **Compléter cette fiche par déduction** : une hypothèse plausible écrite au présent devient indiscernable d'une mesure. Tant qu'aucun dump n'a été ouvert, les rubriques marquées non relevées le restent

---

# 🔗 Ressources

## Documentation Officielle

- [VLC pour Android](https://www.videolan.org/vlc/download-android.html) : aucune spécification du schéma de `vlc_media.db` n'est publiée

## Ressources Complémentaires

- [ADR-019 : Lecture du dump VLC](../adrs/019-resilience-schema-vlc-media-db.md)
- [ADR-020 : Doublons de noms de fichiers](../adrs/020-doublons-noms-de-fichiers.md)
- [BeatportScrapper-TrackTagger](https://github.com/thibaud57/BeatportScrapper-TrackTagger) : CLI d'origine, source de la requête SQL
