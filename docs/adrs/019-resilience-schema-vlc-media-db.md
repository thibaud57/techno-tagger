---
title: "ADR-019 — Lecture du dump VLC : sélection de playlist et résilience au schéma"
status: "accepted"
description: "La requête SQL est embarquée dans le code, la playlist est choisie dans l'interface au lieu d'être codée en dur, et le schéma est vérifié avant tout traitement."
date: "2026-08-29"
keywords: ["architecture", "adr", "vlc", "sqlite", "playlist", "resilience"]
scope: ["docs", "architecture"]
technologies: ["SQLite", "Python", "VLC"]
---

# 🎯 Contexte

Le cas d'usage principal est une playlist curée sur téléphone dans VLC Android. Cette application **n'a aucune fonction d'export de playlist** : le dump de la médiathèque (`Réglages > Avancé > Dump media database`) est sa seule sortie. Les scripts tiers type `vlc-to-m3u` ne font rien d'autre que lire cette base.

La CLI externalise sa requête SQL dans un fichier (`SQLITE_QUERY_PATH`), ce que le BRAINSTORM interprétait comme un signe d'instabilité du schéma. L'inspection du fichier montre autre chose :

```sql
SELECT DISTINCT m.fileName
FROM Playlist p
INNER JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
INNER JOIN Media m ON m.id_media = pm.media_id
WHERE p.name = 'final'
ORDER BY CAST(m.fileName AS TEXT) COLLATE NOCASE;
```

**Le nom de la playlist est codé en dur.** L'externalisation ne servait pas à absorber un changement de schéma, elle servait à changer de playlist sans recompiler. C'est exactement la corvée que le projet veut supprimer.

Aucune spécification publique du schéma de `vlc_media.db` n'existe : c'est un détail d'implémentation interne de VLC Android, susceptible de changer sans préavis. Les sources tierces confirment l'existence de `PlaylistMediaRelation` et d'un champ de nom de fichier, sans documenter de version.

---

# 🧩 Problème

Comment lire le dump VLC sans imposer d'édition de SQL, en laissant choisir la playlist, et comment détecter un schéma devenu incompatible autrement qu'en plantant au milieu d'un traitement ?

---

# 🛠️ Options Envisagées

## Option A : Requête embarquée, playlists listées dans l'interface, schéma vérifié

**Description :** La requête vit dans le code. Une première requête liste les playlists présentes dans le dump et les propose dans un sélecteur. Avant toute exécution, une inspection des tables et colonnes attendues valide la compatibilité.

**Avantages :**
- **Supprime la seule vraie raison d'être du fichier externe** : le choix de la playlist devient une interaction, pas une édition de SQL
- L'échec est détecté **avant tout traitement**, avec un message nommant la table ou la colonne manquante
- Le message est exploitable dans un rapport d'erreur, contrairement à une exception SQLite brute
- Aucun fichier externe à empaqueter, à localiser à l'exécution et à garder cohérent avec le code
- La vérification est testable sur des bases de versions différentes

**Inconvénients :**
- Un schéma modifié impose une nouvelle version de l'application pour tous
- La vérification est du code en plus, à maintenir en cohérence avec la requête

**Coût estimé :** Faible. Deux requêtes et une inspection de `sqlite_master`.

## Option B : Requête externalisée dans un fichier, comme la CLI

**Description :** La requête reste dans un fichier, éventuellement remplaçable par l'utilisateur.

**Avantages :**
- Adaptable sans nouvelle version : une requête corrigée peut être envoyée à un ami

**Inconvénients :**
- **Demande d'écrire du SQL à des utilisateurs qui ne sont pas développeurs**
- Contredit l'objectif du projet, qui est de supprimer l'édition de fichiers avant chaque usage
- Une requête modifiée peut renvoyer des colonnes inattendues, déplaçant l'erreur plus loin
- Un fichier de plus à empaqueter et à garder cohérent avec le code

**Coût estimé :** Faible, à contre-emploi.

## Option C : Détection de plusieurs schémas connus

**Description :** Plusieurs requêtes correspondant aux schémas observés, sélectionnées après inspection.

**Avantages :**
- Couvrirait plusieurs versions de VLC sans intervention

**Inconvénients :**
- **Suppose de disposer d'échantillons de plusieurs versions, ce qui n'est pas le cas** : aucun changement de schéma n'a été constaté, seulement supposé
- Complexité croissant à chaque version de VLC
- Ne dispense pas du message d'erreur pour un schéma inconnu

**Coût estimé :** Non finançable en l'état, faute d'échantillons.

---

# 🎉 Décision

**Requête embarquée, playlists listées dans l'interface, schéma vérifié avant traitement.**

Le fichier SQL externe disparaît : son usage réel était de changer le `WHERE p.name`, ce qu'un sélecteur fait mieux. Le bénéfice qu'on lui prêtait, absorber un changement de schéma, n'a jamais été exercé et supposerait de toute façon un utilisateur capable d'écrire du SQL.

L'option C est écartée faute de preuve : **aucun changement de schéma n'a été observé**, seulement redouté. Coder pour des variantes hypothétiques serait spéculatif ; détecter et nommer une incompatibilité ne l'est pas.

Mise en œuvre retenue :

- **Étape 1, listage** : lecture des playlists du dump (identifiant et nom), avec le nombre de morceaux de chacune, présentés dans un sélecteur. C'est une commande à part entière du contrat, `list_playlists`, rendue par l'événement `playlists_listed` : l'extraction ne peut pas la précéder puisqu'elle a besoin de l'identifiant choisi (cf. [ARCHITECTURE.md § Backend > API](../ARCHITECTURE.md#api))
- **Étape 2, vérification** : inspection de `sqlite_master` pour les tables `Playlist`, `PlaylistMediaRelation` et `Media`, puis des colonnes utilisées. Un écart produit un message nommant précisément ce qui manque.
- **Étape 3, extraction** : la requête existante, paramétrée par l'identifiant de playlist choisi et non plus par un nom en dur
- **Schéma partiellement compatible** : traité comme incompatible. Extraire à moitié une playlist est pire qu'échouer clairement, l'utilisateur découvrant les morceaux manquants bien plus tard.

---

# 🔄 Conséquences

## Positives

- Le choix de la playlist devient une interaction, ce qui supprime la principale corvée de la CLI sur ce chemin
- Un dump provenant d'une version non supportée produit un message clair avant tout traitement
- Le message nomme ce qui manque, ce qui rend le diagnostic à distance possible chez un ami
- Le sélecteur rend visible le contenu du dump, y compris quand l'utilisateur s'est trompé de fichier

## Négatives

- Un changement de schéma côté VLC impose une nouvelle version de l'application, sans contournement
- La vérification doit rester synchronisée avec la requête, sous peine de valider un schéma qui échouera quand même
- Le listage ajoute une requête et un aller-retour d'interface avant l'extraction
- Un dump volumineux (toute la médiathèque) est chargé pour n'en extraire qu'une playlist

---

# 📝 Notes complémentaires

Le format M3U8 n'a aucun de ces problèmes : textuel, stable, il couvre Rekordbox, Traktor, foobar et VLC desktop avec un seul parser, et contient une seule playlist, donc sans sélection à faire.

Rappel valable pour les deux formats : la résolution se fait **par nom de fichier, pas par chemin**. Le chemin stocké est ignoré, seul le nom est cherché récursivement dans le dossier source, la base venant du téléphone et les fichiers étant sur le PC. La requête ne sélectionne d'ailleurs que `fileName`, jamais un chemin.

Le `COLLATE NOCASE` de la requête d'origine est conservé : il rend l'ordre de traitement stable et lisible dans le rapport.
