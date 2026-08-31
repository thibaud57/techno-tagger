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

> Relevé : inspection du fichier SQL de la CLI [`BeatportScrapper-TrackTagger`](https://github.com/thibaud57/BeatportScrapper-TrackTagger) le 2026-08-29. **Aucun dump réel n'a été ouvert.**

### Description

Trois tables et cinq colonnes sont attestées, par la seule requête que la CLI exécute depuis des mois sur des dumps réels. Le reste du schéma n'a pas été inspecté.

### Exemple

```sql
-- Requête d'origine de la CLI, dont le nom de playlist était codé en dur
SELECT DISTINCT m.fileName
FROM Playlist p
INNER JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
INNER JOIN Media m ON m.id_media = pm.media_id
WHERE p.name = 'final'
ORDER BY CAST(m.fileName AS TEXT) COLLATE NOCASE;
```

| Table | Colonnes attestées |
|---|---|
| `Playlist` | `id_playlist`, `name` |
| `PlaylistMediaRelation` | `playlist_id`, `media_id` |
| `Media` | `id_media`, `fileName` |

### Points Importants

- **Ce sont les seules colonnes dont l'existence est attestée.** Types, nullabilité, clés, index et colonnes voisines : `_Non relevé_`
- **`fileName` est un nom de fichier, pas un chemin.** La requête ne sélectionne d'ailleurs jamais de chemin : la base vient du téléphone, les fichiers sont sur le PC, et la résolution se fait par nom cherché récursivement dans le dossier source
- Le `COLLATE NOCASE` de la requête d'origine est conservé : il rend l'ordre de traitement stable et lisible dans le rapport
- **Aucune spécification publique du schéma n'existe.** Des sources tierces confirment l'existence de `PlaylistMediaRelation` et d'un champ de nom de fichier, sans documenter de version
- **Aucun changement de schéma n'a été constaté à ce jour**, seulement supposé : c'est ce qui a fait écarter la détection multi-schémas, faute d'échantillons de versions différentes

---

## Pagination & volumétrie

> Relevé : aucune mesure. Aucun dump réel n'a été ouvert au 2026-08-29.

### Description

_Non relevé._

### Points Importants

- **Taille typique d'un dump, nombre de playlists, nombre de morceaux par playlist : `_Non relevé_`.** Aucune mesure n'a été prise
- Ce qui est décidé, en revanche : **le dump entier est chargé pour n'en extraire qu'une playlist**, conséquence assumée de l'ADR-019. Si la volumétrie devenait un problème, c'est ce point qui serait à revoir
- Le listage des playlists ajoute une requête et un aller-retour d'interface avant l'extraction

---

## Auth & quotas

_Non applicable : fichier local, aucune authentification, aucun quota, aucun rate limit._

---

## Fixtures & rejeu

### Description

_Non relevé._ Aucun dump n'a été capturé comme fixture à ce jour.

### Points Importants

- **Aucune fixture en place**, donc aucune commande de régénération à documenter
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

- [VLC pour Android](https://www.videolan.org/vlc/download-android.html) — aucune spécification du schéma de `vlc_media.db` n'est publiée

## Ressources Complémentaires

- [ADR-019 — Lecture du dump VLC](../adrs/019-resilience-schema-vlc-media-db.md)
- [ADR-020 — Doublons de noms de fichiers](../adrs/020-doublons-noms-de-fichiers.md)
- [BeatportScrapper-TrackTagger](https://github.com/thibaud57/BeatportScrapper-TrackTagger) — CLI d'origine, source de la requête SQL
