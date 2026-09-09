---
paths:
  - "sidecar/src/tagger/playlists/**/*.py"
---

# vlc_media.db — Lecture des playlists

## À faire
- Ouvrir le dump en lecture seule : `sqlite3.connect(f"file:{path}?mode=ro", uri=True)`. Le fichier appartient à l'utilisateur, l'application n'a aucune raison de l'écrire
- Enregistrer la collation `FILENAME` par `create_collation` juste après l'ouverture, avant toute requête touchant `Media.filename` : la colonne est déclarée `COLLATE FILENAME`, une collation propre à VLC que `sqlite3` ne connaît pas, et un `SELECT DISTINCT` suffit à la déclencher
- Vérifier le schéma avant tout traitement en inspectant `sqlite_master` pour `Playlist`, `PlaylistMediaRelation` et `Media`, puis les colonnes utilisées, et produire un message nommant précisément ce qui manque
- Traiter un schéma partiellement compatible comme incompatible : extraire à moitié une playlist est pire qu'échouer clairement, l'utilisateur découvrant les morceaux manquants bien plus tard
- Garder la requête SQL embarquée dans le code, `COLLATE NOCASE` compris : il rend l'ordre de traitement stable et lisible dans le rapport
- Lister les playlists avec leur nombre de morceaux avant l'extraction : le sélecteur rend visible le contenu du dump, y compris quand l'utilisateur s'est trompé de fichier
- Compter les morceaux par `count()` sur `PlaylistMediaRelation`, jamais par les compteurs dénormalisés de `Playlist`
- Résoudre par `filename` en cherchant récursivement dans le dossier source : la base vient du téléphone, les fichiers sont sur le PC
- Rejeter avec un message clair un fichier qui n'est pas une base SQLite valide
- Traiter le M3U8 comme l'autre entrée du use-case : textuel, stable, une seule playlist par fichier, donc aucune sélection à proposer

## À éviter
- Utiliser le chemin stocké en base : il pointe vers l'arborescence du téléphone, pas vers le PC
- Externaliser la requête SQL dans un fichier éditable : son usage réel serait de changer le `WHERE p.name`, ce qu'un sélecteur fait mieux, et absorber un changement de schéma supposerait un utilisateur capable d'écrire du SQL
- Coder plusieurs variantes de schéma « au cas où » : aucun changement n'a jamais été observé, et coder pour des variantes hypothétiques sans échantillon est spéculatif
- Laisser remonter une exception SQLite brute : elle n'est pas exploitable dans un rapport, là où un message nommant la table manquante l'est
- Se fier aux compteurs dénormalisés de `Playlist` (`nb_audio`, `nb_video`, `nb_unknown`) : relevés à 0 sur un dump portant pourtant 8 morceaux
- Comparer les noms de colonnes de façon sensible à la casse lors de la vérification de schéma : la colonne est `filename`, et une vérification cherchant `fileName` la déclarerait manquante alors que SQLite l'accepte en requête

## Gotchas
- Aucune spécification publique du schéma n'existe, c'est un détail d'implémentation interne de VLC Android : six colonnes réparties sur trois tables sont attestées (`Playlist.id_playlist`, `Playlist.name`, `PlaylistMediaRelation.playlist_id`, `PlaylistMediaRelation.media_id`, `Media.id_media`, `Media.filename`), tout le reste est non relevé
- La collation `FILENAME` de `Media.filename` est la raison d'être du `create_collation` : la CLI d'origine l'enregistrait, et transcrire sa requête SQL sans ce code produit du code qui échoue sur `no such collation sequence: FILENAME` au premier dump réel
- `Playlist.name` est déclaré `COLLATE NOCASE` : deux playlists dont les noms ne diffèrent que par la casse sont confondues par un filtre sur le nom
- Le dump contient toute la médiathèque, pas une playlist, et il est chargé entier pour n'en extraire qu'une seule ([ADR-019](../../../docs/adrs/019-resilience-schema-vlc-media-db.md)) : c'est le point à revoir si la volumétrie devenait un problème. Relevé sur un dump réel le 2026-09-08 : 68 tables, 795 entrées dans `Media` pour une seule playlist de 8 morceaux
- Capturer tout nouveau dump **avec la version de VLC Android qui l'a produit** : celle du dump relevé le 2026-09-08 n'a pas été notée, donc un écart de schéma futur ne serait pas rattachable à une version
- Un échec de vérification de schéma impose une nouvelle version de l'application, sans contournement côté utilisateur : c'est le prix de la requête embarquée
- Python 3.14 supprime `sqlite3.version`, banni côté Ruff (cf. [lint-format.md](../ruff/lint-format.md))

## Exemples
```sql
-- ✅ requête d'origine conservée, nom de playlist paramétré et non codé en dur
SELECT DISTINCT m.filename
FROM Playlist p
INNER JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
INNER JOIN Media m ON m.id_media = pm.media_id
WHERE p.name = ?
ORDER BY CAST(m.filename AS TEXT) COLLATE NOCASE;
```

```python
# ✅ lecture seule, collation enregistrée, schéma vérifié, dans cet ordre
connection = sqlite3.connect(f"file:{dump_path}?mode=ro", uri=True)
connection.create_collation("FILENAME", collate_filename)
verify_schema(connection)   # lève une erreur métier nommant la table ou la colonne manquante

# ❌ requête transcrite sans sa collation : OperationalError au premier dump réel
connection = sqlite3.connect(f"file:{dump_path}?mode=ro", uri=True)
connection.execute(EXTRACT_QUERY, (playlist_name,))

# ❌ le chemin de la base utilisé tel quel
path = Path(row["path"])
```
