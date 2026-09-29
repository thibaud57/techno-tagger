---
paths:
  - "sidecar/src/tagger/playlists/**/*.py"
---

# vlc_media.db — Lecture des playlists

## À faire
- Ouvrir le dump en lecture seule par `sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)` : `as_uri()` échappe `#` et `%`, légaux sous Windows
- Enregistrer la collation `FILENAME` par `create_collation` juste après l'ouverture : `Media.filename` la déclare et `sqlite3` ne la connaît pas
- Vérifier le schéma (`Playlist`, `PlaylistMediaRelation`, `Media` et leurs colonnes) avant tout traitement, avec un message qui nomme ce qui manque
- Traiter un schéma partiellement compatible comme incompatible : une extraction à moitié est pire qu'un échec clair
- Garder la requête SQL embarquée, `COLLATE NOCASE` compris, pour un ordre stable dans le rapport
- Lister les playlists avec leur nombre de morceaux avant l'extraction
- Compter les morceaux par `count()` sur `PlaylistMediaRelation`, jamais par les compteurs dénormalisés de `Playlist`
- Résoudre par `filename` en cherchant récursivement dans le dossier source : la base vient du téléphone, les fichiers sont sur le PC
- Rejeter avec un message clair un fichier qui n'est pas une base SQLite valide
- Traiter le M3U8 comme l'autre entrée du use-case : textuel, stable, une seule playlist par fichier, donc aucune sélection à proposer

## À éviter
- Utiliser le chemin stocké en base : il pointe vers l'arborescence du téléphone, pas vers le PC
- Externaliser la requête SQL dans un fichier éditable
- Coder des variantes de schéma sans échantillon réel
- Laisser remonter une exception SQLite brute plutôt qu'un message nommant la table manquante
- Se fier aux compteurs dénormalisés de `Playlist` (`nb_audio`…) : ils peuvent valoir 0 sur une playlist remplie
- Comparer les noms de colonnes en respectant la casse : SQLite ne la respecte pas

## Gotchas
- Le schéma est interne à VLC Android, sans spécification publique : seules les six colonnes de la requête sont attestées
- Sans `create_collation`, la requête échoue sur `no such collation sequence: FILENAME` au premier dump réel
- `Playlist.name` est `COLLATE NOCASE` : deux playlists qui ne diffèrent que par la casse se confondent
- Le dump porte toute la médiathèque et se charge entier pour une seule playlist (cf. [ADR-019](../../../docs/adrs/019-resilience-schema-vlc-media-db.md))
- Noter la version de VLC Android de tout nouveau dump capturé : sans elle, un écart de schéma n'est rattachable à rien
- Un schéma incompatible impose une nouvelle version de l'application

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
connection = sqlite3.connect(f"{dump_path.as_uri()}?mode=ro", uri=True)
connection.create_collation("FILENAME", collate_filename)
verify_schema(connection)   # lève une erreur métier nommant la table ou la colonne manquante

# ❌ requête transcrite sans sa collation : OperationalError au premier dump réel
connection = sqlite3.connect(f"{dump_path.as_uri()}?mode=ro", uri=True)
connection.execute(EXTRACT_QUERY, (playlist_name,))

# ❌ le chemin de la base utilisé tel quel
path = Path(row["path"])
```
