---
title: "Rekordbox — Lecture des tags à l'import"
acces: "logiciel-tiers"
releve: "2026-10-23"
volatilite: "moyenne"
description: "Ce que Rekordbox lit des tags écrits par techno-tagger, par format (MP3, AIFF, FLAC, WAV) : champs lus, champs ignorés, points non relevés."
date: "2026-10-23"
keywords: ["rekordbox", "id3", "vorbis-comments", "riff-info", "initialkey", "tkey", "wav", "flac"]
scope: ["docs", "source"]
technologies: ["mutagen", "Python"]
---

# Description

Rekordbox est le premier lecteur des tags que techno-tagger écrit. Son comportement change selon la version et ne se connaît que par observation : la page Pioneer n'a pas de section FLAC et sa matrice date de 2019. D'où une fiche source.

> **`acces` hors référentiel** : `logiciel-tiers` faute de valeur adaptée, comme `fichier-local` pour [vlc-media-db.md](vlc-media-db.md).

> **Trois origines** : la page Pioneer « rekordbox metadata », le désassemblage de Rekordbox 7.2.19 (dépôt rbxport) et un import réel dans le Rekordbox du propriétaire le 2026-10-23 (version non notée). Chaque ligne nomme la sienne.

---

# Concepts Clés

## Accès & anti-bot

### Description

Aucune protection : on importe des fichiers tagués et on lit le panneau Infos et les colonnes de la collection.

### Exemple

```
Collection > glisser le dossier → panneau Infos du morceau
Clic droit > Recharger les tags → relit un morceau déjà importé
```

### Points Importants

- Un tag réécrit après l'import n'est relu qu'après « Recharger les tags » ou un réimport (forum Pioneer)
- L'analyse de Rekordbox remplace BPM et tonalité quand elle tourne : juger un tag de tonalité sur un morceau non analysé
- Le BPM affiché vient toujours de l'analyse (relevé le 2026-10-23 : 126, 168, 126 pour des tags à 126, 84, 115)

---

## Routes & URLs

_Non applicable : logiciel local, aucune URL._

---

## Network observé

_Non applicable : lecture de fichiers locaux, aucun trafic._

---

## Structure DOM & sélecteurs

_Non applicable : aucun HTML._

---

## Schémas de données

> Relevé : sources citées en Ressources, lues le 2026-10-23, et import réel de 2 MP3 et 2 FLAC écrits par techno-tagger le 2026-10-23 (version de Rekordbox non notée)

### Description

Champs écrits par techno-tagger (table de `tagger/tags/files.py`) et ce que Rekordbox en lit. MP3 et AIFF en ID3v2.3, FLAC en Vorbis Comments, WAV en chunk `id3 `.

### Exemple

```
Champ          MP3 / AIFF (ID3)              FLAC (Vorbis)                          WAV
Titre          TIT2  lu (Pioneer)            TITLE lu (import)                      ignoré
Artiste        TPE1  lu (Pioneer)            ARTIST lu (import)                     ignoré
Remixeur       TPE4  lu (Pioneer)            REMIXER non lu (import)                ignoré
Nom du mix     TIT3  lu (Pioneer)            non trouvé                             —
Genre          TCON  lu (Pioneer)            GENRE lu (import)                      ignoré
BPM            TBPM  non lu (rbxport)        non lu (rbxport)                       —
Tonalité       TKEY  lu (Pioneer, import)    INITIALKEY lu (rbxport, import)        ignoré
                                             KEY seul non lu (import)
Label          TPUB  lu (Pioneer)            LABEL lu (import)                      ignoré
Album          TALB  lu (Pioneer)            ALBUM lu (import)                      ignoré
N° de piste    TRCK  lu (Pioneer)            TRACKNUMBER lu (import)                ignoré
Année          TYER  lu (import)             DATE lu (import)                       ignoré
Date de sortie TDRL  lu, AAAA-MM-JJ (Pioneer)  non trouvé                           —
Pochette       APIC  lu (Pioneer)            non relevé                             ignorée (flackey)
ISRC, catalogue, URL, source : aucun champ Rekordbox
```

### Points Importants

- **Tonalité FLAC** : Rekordbox 7.2.19 lit `INITIALKEY`, pas `KEY` (rbxport PR #231). Depuis le 2026-10-23, techno-tagger écrit les deux avec la même valeur (ADR-011) : réimportés le jour même, les FLAC affichent leur tonalité (7A, 7B), vide avec `KEY` seul
- **Les deux noms ensemble** : VirtualDJ lit `KEY` en priorité (CTO de VirtualDJ, 2022) et Mixed In Key y met un base64. Un `KEY` divergent fait lire une mauvaise tonalité, d'où la même valeur sous les deux noms
- **Remixeur FLAC** : `REMIXER` vide à l'import. Aucune source n'établit le nom lu (rbxport : « Fields not covered »)
- **WAV** : le chunk ID3 n'est jamais lu, seul le RIFF `LIST/INFO` l'est (rbxport PR #231 : « A WAV reads its RIFF INFO, never its `id3 ` chunk »). Un WAV tagué s'affiche avec son nom de fichier pour titre, sans artiste. Seuls `INAM` et `IART` sont attestés côté INFO
- **AIFF** : chunk `ID3 ` lu comme un MP3, pochette comprise (rbxport PR #231 et #391, flackey)
- **Camelot** : « 7A » dans `TKEY` est gardé tel quel (rbxport). Affichage en notation classique non relevé
- **Nom du mix et date de sortie** vides par choix : la version est dans `TIT2`, seule l'année est écrite (ADR-011)
- **La matrice Pioneer de 2019 contredit la 7.2.19** sur la tonalité FLAC : toujours dater un relevé et noter la version

---

## Pagination & volumétrie

_Non applicable : lecture fichier par fichier._

---

## Auth & quotas

_Non applicable : logiciel local._

---

## Fixtures & rejeu

### Description

Aucun fichier de référence commité. Un relevé se refait en important dans Rekordbox des fichiers écrits par techno-tagger, un par format.

### Exemple

```bash
PYTHONPATH=tests/helpers uv run --directory sidecar python <verify>/scripts/build_fixture.py <dossier> --formats
# run réel sur <dossier>, écriture confirmée, import du dossier dans Rekordbox
```

### Points Importants

- Noter la version de Rekordbox à chaque relevé : celle du 2026-10-23 manque
- Trancher un nom de champ par un import de variantes, un nom par fichier : seule preuve possible pour le remixeur FLAC
- Signal de casse : un champ jusqu'ici lu qui reste vide après import

---

# Bonnes Pratiques

## ✅ Recommandations

- Prouver un nom de champ par un import réel avant de le changer dans `files.py`
- Annoncer à l'utilisateur que titre et artiste d'un WAV n'apparaissent pas dans Rekordbox tant que le RIFF INFO n'est pas écrit

## ❌ Anti-Patterns

- Changer la casse du chunk ID3 d'un WAV : sans effet, testé sur quatre variantes (flackey)
- Se fier à la matrice Pioneer de 2019 pour une version récente
- Déduire un nom de champ non prouvé par un import

---

# 🔗 Ressources

## Documentation Officielle

- [rekordbox metadata (Pioneer DJ)](https://forums.pioneerdj.com/hc/en-us/articles/205021569-rekordbox-metadata) : ID3 pour MP3, AIFF, M4A, WAV, sans FLAC
- [Matrice des métadonnées (PDF, 2019-02-28)](https://forums.pioneerdj.com/hc/en-us/article_attachments/360023009731)

## Ressources Complémentaires

- [rbxport PR #231](https://github.com/chrisle/rbxport/pull/231) : lecture à l'import, désassemblage de Rekordbox 7.2.19
- [rbxport PR #391](https://github.com/chrisle/rbxport/pull/391) : écriture de la tonalité par Rekordbox
- [flackey, issue 17](https://github.com/EyalDelarea/flackey/issues/17) : WAV, RIFF INFO lu, pochette ignorée
- [Mp3tag : champs de Rekordbox 6.8.4](https://community.mp3tag.de/t/which-rekordbox-fields-are-saved-in-mp3-tracks/67557)
- [VirtualDJ : priorité de KEY](https://virtualdj.com/forums/263550/VirtualDJ_Technical_Support/Change_the_Key_in_the_Browser_with_the_result_of_MIK.html)
- [ADR-011 : Politique d'écriture des tags](../adrs/011-politique-ecriture-tags.md)
