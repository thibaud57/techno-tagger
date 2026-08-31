---
paths:
  - "sidecar/src/tagger/playlists/**/*.py"
---

# vlc_media.db — Lecture des playlists

## À faire
- Ouvrir le dump en lecture seule : `sqlite3.connect(f"file:{path}?mode=ro", uri=True)`. Le fichier appartient à l'utilisateur, l'application n'a aucune raison de l'écrire
- Vérifier le schéma avant tout traitement en inspectant `sqlite_master` pour `Playlist`, `PlaylistMediaRelation` et `Media`, puis les colonnes utilisées, et produire un message nommant précisément ce qui manque
- Traiter un schéma partiellement compatible comme incompatible : extraire à moitié une playlist est pire qu'échouer clairement, l'utilisateur découvrant les morceaux manquants bien plus tard
- Garder la requête SQL embarquée dans le code, `COLLATE NOCASE` compris : il rend l'ordre de traitement stable et lisible dans le rapport
- Lister les playlists avec leur nombre de morceaux avant l'extraction : le sélecteur rend visible le contenu du dump, y compris quand l'utilisateur s'est trompé de fichier
- Résoudre par `fileName` en cherchant récursivement dans le dossier source : la base vient du téléphone, les fichiers sont sur le PC
- Rejeter avec un message clair un fichier qui n'est pas une base SQLite valide
- Traiter le M3U8 comme l'autre entrée du use-case : textuel, stable, une seule playlist par fichier, donc aucune sélection à proposer

## À éviter
- Utiliser le chemin stocké en base : il pointe vers l'arborescence du téléphone, pas vers le PC
- Externaliser la requête SQL dans un fichier éditable : son usage réel serait de changer le `WHERE p.name`, ce qu'un sélecteur fait mieux, et absorber un changement de schéma supposerait un utilisateur capable d'écrire du SQL
- Coder plusieurs variantes de schéma « au cas où » : aucun changement n'a jamais été observé, et coder pour des variantes hypothétiques sans échantillon est spéculatif
- Laisser remonter une exception SQLite brute : elle n'est pas exploitable dans un rapport, là où un message nommant la table manquante l'est

## Gotchas
- Aucune spécification publique du schéma n'existe, c'est un détail d'implémentation interne de VLC Android : trois tables et cinq colonnes sont attestées (`Playlist.id_playlist`, `Playlist.name`, `PlaylistMediaRelation.playlist_id`, `PlaylistMediaRelation.media_id`, `Media.id_media`, `Media.fileName`), tout le reste est non relevé
- Le dump contient toute la médiathèque, pas une playlist, et il est chargé entier pour n'en extraire qu'une seule ([ADR-019](../../../docs/adrs/019-resilience-schema-vlc-media-db.md)) : c'est le point à revoir si la volumétrie devenait un problème
- Aucune fixture n'existe à ce jour : capturer un dump anonymisé **avec la version de VLC Android qui l'a produit** dès qu'un utilisateur en fournit un, sans quoi un écart de schéma futur ne serait rattachable à rien
- Un échec de vérification de schéma impose une nouvelle version de l'application, sans contournement côté utilisateur : c'est le prix de la requête embarquée
- Python 3.14 supprime `sqlite3.version`, banni côté Ruff (cf. [lint-format.md](../ruff/lint-format.md))

## Exemples
```sql
-- ✅ requête d'origine conservée, nom de playlist paramétré et non codé en dur
SELECT DISTINCT m.fileName
FROM Playlist p
INNER JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
INNER JOIN Media m ON m.id_media = pm.media_id
WHERE p.name = ?
ORDER BY CAST(m.fileName AS TEXT) COLLATE NOCASE;
```

```python
# ✅ lecture seule, schéma vérifié avant tout traitement
connection = sqlite3.connect(f"file:{dump_path}?mode=ro", uri=True)
verify_schema(connection)   # lève une erreur métier nommant la table ou la colonne manquante

# ❌ le chemin de la base utilisé tel quel
path = Path(row["path"])
```
