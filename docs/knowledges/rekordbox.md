---
title: "Rekordbox — Lecture des tags à l'import"
acces: "logiciel-tiers"
releve: "2026-10-23"
volatilite: "moyenne"
description: "Carte de ce que Rekordbox lit dans les tags écrits par techno-tagger, format par format (MP3, AIFF, FLAC, WAV) : champs lus, champs ignorés, écarts observés et points non relevés."
date: "2026-10-23"
keywords: ["rekordbox", "id3", "vorbis-comments", "riff-info", "initialkey", "tkey", "tpe4", "wav", "flac"]
scope: ["docs", "source"]
technologies: ["mutagen", "Python"]
---

# Description

Rekordbox est le logiciel DJ visé en premier par les tags que techno-tagger écrit : un tag bien écrit mais que Rekordbox ne lit pas est perdu pour l'utilisateur. Ce n'est ni un site ni une API, mais un **lecteur fermé de nos fichiers** dont le comportement change d'une version à l'autre et ne se connaît que par observation : la documentation de Pioneer est partielle (aucune section FLAC) et sa matrice date de 2019. D'où une fiche source plutôt qu'une fiche techno.

> **Champ `acces` hors référentiel.** Aucune valeur du template ne décrit un logiciel tiers qui lit nos fichiers. `logiciel-tiers` est posé faute de mieux, comme `fichier-local` pour [vlc-media-db.md](vlc-media-db.md).

> **Trois origines, à ne pas confondre.** La page Pioneer « rekordbox metadata » (MP3, AIFF, M4A, WAV), l'analyse statique de Rekordbox 7.2.19 (macOS) publiée dans le dépôt rbxport, et un import réel dans le Rekordbox du propriétaire le 2026-10-23, version non notée. Chaque ligne ci-dessous dit de laquelle elle vient.

---

# Concepts Clés

## Accès & anti-bot

### Description

Aucune protection : on observe ce que Rekordbox lit en important des fichiers tagués, puis en lisant le panneau Infos d'un morceau et les colonnes de la collection.

### Exemple

```
Collection > glisser le dossier → panneau Infos du morceau (Titre, Artiste, Remixeur, Tonalité, Label…)
Clic droit > Recharger les tags → relit les tags d'un morceau déjà importé
```

### Points Importants

- **Un tag écrit après l'import n'est pas relu de lui-même** : il faut « Recharger les tags » ou réimporter (forum Pioneer, fil Mixed In Key)
- **L'analyse de Rekordbox écrase BPM et tonalité** quand elle tourne : une tonalité affichée peut venir de l'analyse et non du tag. Pour juger un tag de tonalité, regarder un morceau que l'analyse n'a pas traité, ou couper la détection de tonalité
- Le BPM affiché vient toujours de l'analyse (relevé le 2026-10-23 : 126, 168, 126 alors que les tags portaient 126, 84 et 115)

---

## Routes & URLs

_Non applicable : logiciel local, aucune URL ni endpoint._

---

## Network observé

_Non applicable : Rekordbox lit des fichiers locaux, aucun trafic n'est en jeu._

---

## Structure DOM & sélecteurs

_Non applicable : aucun HTML, les champs se lisent dans l'interface de Rekordbox._

---

## Schémas de données

> Relevé : lecture des sources citées en Ressources le 2026-10-23, et import réel dans le Rekordbox du propriétaire (version non notée) le 2026-10-23 sur 2 MP3 et 2 FLAC écrits par techno-tagger

### Description

Correspondance entre les champs que techno-tagger écrit (table de `tagger/tags/files.py`) et ce que Rekordbox en lit, par format. MP3 et AIFF portent de l'ID3v2.3, FLAC des Vorbis Comments, WAV un chunk `id3 `.

### Exemple

```
Champ          MP3 / AIFF (ID3)            FLAC (Vorbis)                         WAV
Titre          TIT2   lu (Pioneer)         TITLE   lu (import réel)              chunk id3 ignoré
Artiste        TPE1   lu (Pioneer)         ARTIST  lu (import réel)              chunk id3 ignoré
Remixeur       TPE4   lu (Pioneer)         REMIXER non lu (import réel)          chunk id3 ignoré
Nom du mix     TIT3   lu (Pioneer)         non trouvé                            —
Genre          TCON   lu (Pioneer)         GENRE   lu (import réel)              chunk id3 ignoré
BPM            TBPM   non lu (rbxport)     non lu (rbxport)                      —
Tonalité       TKEY   lu tel quel (Pioneer, import réel « 7A »)
                                           INITIALKEY lu (rbxport 7.2.19, import réel), KEY seul non lu (import réel)
Label          TPUB   lu (Pioneer)         ORGANIZATION lu (rbxport), LABEL lu (import réel)
Album          TALB   lu (Pioneer)         ALBUM   lu (import réel)              chunk id3 ignoré
N° de piste    TRCK   lu (Pioneer)         TRACKNUMBER lu (import réel)          chunk id3 ignoré
Année          TYER   lu (import réel)     DATE    lu (import réel)              chunk id3 ignoré
Date de sortie TDRL   lu, AAAA-MM-JJ (Pioneer)  non trouvé                       —
Pochette       APIC   lu (Pioneer)         image FLAC : non relevé              non lue (test flackey)
ISRC           TSRC   non trouvé           non trouvé                            —
Catalogue, URL, source : aucun champ Rekordbox (absents de la liste Pioneer)
```

### Points Importants

- **FLAC, tonalité** : Rekordbox 7.2.19 lit `INITIALKEY` (rbxport PR #231 : « the Vorbis comment `INITIALKEY` (FLAC) »). techno-tagger écrivait `KEY` seul : la tonalité restait vide sur les FLAC, alors qu'elle s'affichait sur les MP3 (« 7A », import réel du 2026-10-23). Depuis le 2026-10-23 il écrit `KEY` et `INITIALKEY` avec la même valeur (ADR-011) : réimportés le même jour, les deux FLAC affichent leur tonalité (7A, 7B)
- **FLAC, `KEY` et `INITIALKEY` ensemble** : VirtualDJ lit `KEY` en priorité et ne retombe pas sur `INITIALKEY` (CTO de VirtualDJ, 2022 ; utilisatrice, 2025). Mixed In Key remplit `KEY` d'un base64 : un `KEY` divergent fait lire une mauvaise tonalité. MusicBrainz Picard écrit `KEY`, Mp3tag et Mixed In Key `INITIALKEY`
- **FLAC, remixeur** : vide à l'import réel du 2026-10-23 avec `REMIXER`. Le nom que Rekordbox lit n'est établi par aucune source : rbxport le classe dans « Fields not covered », et la matrice Pioneer de 2019 marque le remixeur FLAC comme non lu
- **WAV : le chunk ID3 n'est jamais lu**, Rekordbox ne lit que le RIFF `LIST/INFO` (rbxport PR #231 : « A WAV reads its RIFF INFO, never its `id3 ` chunk »). Un WAV tagué par techno-tagger s'affiche avec son nom de fichier pour titre et sans artiste. La casse du chunk (`id3 ` ou `ID3 `) n'y change rien (test flackey, quatre variantes)
- **WAV, champs INFO** : `INAM` (titre) et `IART` (artiste) sont attestés par rbxport ; `IPRD`, `ICRD`, `IGNR` et les autres ne sont pas confirmés pour Rekordbox. Label, tonalité et pochette ne passent pas par INFO
- **AIFF** : le chunk `ID3 ` est lu (titre, artiste, album, genre, label, tonalité, pochette), comme en MP3 (rbxport PR #231 et #391, test flackey pour la pochette)
- **Tonalité Camelot** : « 7A » dans `TKEY` est gardé tel quel (rbxport : « It is kept exactly as written »). Son affichage en mode de notation classique n'est pas relevé
- **Version dans le titre** : techno-tagger écrit « Titre (Nom du mix) » dans `TIT2` et n'écrit pas `TIT3` : le champ « Nom du mix » de Rekordbox reste vide, par choix
- **Date de sortie** : Rekordbox lit `TDRL` au format AAAA-MM-JJ en MP3 et AIFF (staff Pioneer). techno-tagger n'écrit que l'année (`TYER`, ADR-011) : le champ reste vide. Un `TDRL` dans un tag v2.3 sort de la spécification ID3, effet non relevé
- **La matrice Pioneer de 2019 contredit les versions récentes** (tonalité FLAC « non lue » en 2019, `INITIALKEY` lu en 7.2.19) : toujours dater une observation et noter la version de Rekordbox

---

## Pagination & volumétrie

_Non applicable : aucune donnée paginée, la lecture se fait fichier par fichier._

---

## Auth & quotas

_Non applicable : logiciel local, ni authentification ni quota._

---

## Fixtures & rejeu

### Description

Aucun fichier de référence n'est commité. Une observation se refait en important dans Rekordbox des fichiers écrits par techno-tagger, un par format, puis en relevant le panneau Infos. `build_fixture.py --formats` de la recette `/verify` produit un fichier valide par format (MP3, FLAC, WAV, AIFF).

### Exemple

```bash
PYTHONPATH=tests/helpers uv run --directory sidecar python <verify>/scripts/build_fixture.py <dossier> --formats
# puis run réel sur <dossier>, écriture confirmée, import du dossier dans Rekordbox
```

### Points Importants

- **Noter la version de Rekordbox à chaque relevé** : celle de l'import du 2026-10-23 ne l'a pas été, un écart futur ne serait pas rattachable à une version
- Pour trancher un nom de champ, importer un même fichier en plusieurs variantes (un nom de champ par variante) plutôt que deviner : c'est la seule preuve disponible pour le remixeur FLAC
- Signaux de casse à surveiller : un champ jusqu'ici lu qui reste vide après un import, ou une tonalité MP3 qui ne s'affiche plus

---

# Bonnes Pratiques

## ✅ Recommandations

- **Vérifier un nom de champ par un import réel** avant de le changer dans la table de `files.py` : les sources sont partielles et se contredisent selon la version
- **Juger la tonalité sur un morceau non analysé** par Rekordbox, sinon on mesure l'analyse et non le tag
- **Recharger les tags** après une réécriture d'un fichier déjà dans la collection
- **Annoncer les limites du WAV** à l'utilisateur tant que le RIFF INFO n'est pas écrit : titre et artiste n'y apparaîtront pas dans Rekordbox

## ❌ Anti-Patterns

- **Changer la casse du chunk ID3 d'un WAV** pour qu'il soit lu : testé sans effet, Rekordbox ignore ce chunk quelle que soit sa casse
- **Se fier à la matrice Pioneer de 2019** pour une version récente : elle se contredit avec Rekordbox 7.2.19 sur la tonalité FLAC
- **Écrire le BPM en espérant qu'il s'affiche** : Rekordbox l'ignore à l'import et le recalcule. Il reste utile pour les lecteurs qui n'analysent pas (ADR-011)
- **Compléter un nom de champ par déduction** : le remixeur FLAC reste non trouvé tant qu'un import ne l'a pas montré

---

# 🔗 Ressources

## Documentation Officielle

- [rekordbox metadata (Pioneer DJ)](https://forums.pioneerdj.com/hc/en-us/articles/205021569-rekordbox-metadata) : correspondance ID3 pour MP3, AIFF, M4A et WAV, sans section FLAC
- [Matrice des métadonnées (PDF, 2019-02-28)](https://forums.pioneerdj.com/hc/en-us/article_attachments/360023009731) : cellules colorées sans légende, antérieure à Rekordbox 6

## Ressources Complémentaires

- [rbxport PR #231](https://github.com/chrisle/rbxport/pull/231) : lecture des tags à l'import, d'après le désassemblage de Rekordbox 7.2.19 (macOS)
- [rbxport PR #391](https://github.com/chrisle/rbxport/pull/391) : écriture de la tonalité par Rekordbox (`INITIALKEY` en FLAC, rien en WAV)
- [flackey, issue 17](https://github.com/EyalDelarea/flackey/issues/17) : WAV, RIFF INFO lu, pochette ID3 jamais affichée
- [Mp3tag : champs écrits par Rekordbox 6.8.4](https://community.mp3tag.de/t/which-rekordbox-fields-are-saved-in-mp3-tracks/67557) : `TPE4` remixeur, `TIT3` nom du mix
- [VirtualDJ : KEY et INITIALKEY en FLAC](https://virtualdj.com/forums/247705/VirtualDJ_Technical_Support/Keys_not_being_read_in_FLAC_files.html) et [priorité de KEY](https://virtualdj.com/forums/263550/VirtualDJ_Technical_Support/Change_the_Key_in_the_Browser_with_the_result_of_MIK.html)
- [MusicBrainz Picard : correspondance des tags](https://picard-docs.musicbrainz.org/en/appendices/tag_mapping.html) : `KEY` et `REMIXER` en Vorbis
- [Mp3tag : correspondance des champs](https://docs.mp3tag.de/mapping) : `INITIALKEY` ↔ `TKEY`, `MIXARTIST` ↔ `TPE4`
- [ADR-011 : Politique d'écriture des tags](../adrs/011-politique-ecriture-tags.md)
- [mutagen.md](mutagen.md) : écriture des tags, chunk `id3 ` du WAV
