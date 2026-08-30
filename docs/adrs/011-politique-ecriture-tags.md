---
title: "ADR-011 — Politique d'écriture des tags"
status: "accepted"
description: "Quatre formats supportés via mutagen, écriture de tout ce que l'API renvoie sans cases à cocher, et un champ null qui ne touche jamais au tag existant."
date: "2026-08-29"
keywords: ["architecture", "adr", "id3", "vorbis", "mutagen", "tags", "metadata"]
scope: ["docs", "architecture"]
technologies: ["mutagen", "Python", "ID3", "FLAC"]
---

# 🎯 Contexte

La CLI actuelle traite le MP3 seul et écrit dix champs. Le contrat `Track` de techno-scraper en expose davantage, et une bibliothèque DJ mélange les achats Beatport et Bandcamp, donc plusieurs formats de fichiers.

La couverture des sources est très asymétrique : **Beatport remplit tout le contrat, Bandcamp seulement le socle d'identité** (artistes, titre, album, dates, label, ISRC, numéro de piste, URL, pochette). Ni genre, ni BPM, ni key, ni remixers, ni numéro de catalogue côté Bandcamp.

---

# 🧩 Problème

Quels formats supporter, quels champs écrire, et que faire quand une source ne renseigne pas un champ que le fichier possède déjà ?

---

# 🛠️ Options Envisagées

## Option A : Quatre formats, tout écrire, `null` non destructif

**Description :** MP3, WAV, AIFF et FLAC. Tous les champs renvoyés par l'API sont écrits, sans cases à cocher. Un champ renvoyé à `null` laisse le tag existant intact.

**Avantages :**
- Couvre une bibliothèque DJ réelle, qui mélange les provenances
- **Qui peut le plus peut le moins** : un champ récupéré mais non écrit est une information perdue pour rien
- **Rend le tagging Bandcamp non destructif** : un BPM déjà présent survit à un tagging depuis une source qui ne connaît pas le BPM
- Aucun conflit sur BPM et key : les logiciels DJ les recalculent par analyse audio. Rekordbox ne réécrit même pas le BPM dans le fichier, et Traktor remplace silencieusement BPM et `TKEY` par ses propres valeurs à l'import, sauf décochage manuel dans sa fenêtre d'analyse. On les écrit quand même : ils servent aux lecteurs qui n'analysent pas, et rien n'est perdu quand un logiciel les recalcule
- Aucune interface de sélection de champs à concevoir ni à expliquer

**Inconvénients :**
- Deux tables de correspondance à maintenir (ID3v2 et Vorbis comments)
- Le WAV est un maillon faible : bloc ID3 non standardisé, support inégal selon les lecteurs
- Aucune granularité si l'utilisateur voulait préserver un champ précis
- Les clés hors standard (key, numéro de catalogue, traçabilité de la source) demandent des conventions

**Coût estimé :** Moyen. Deux tables, couvertes par mutagen.

## Option B : MP3 seul, dix champs, comme la CLI

**Description :** Reproduire le périmètre existant.

**Avantages :**
- Une seule table de correspondance, comportement déjà éprouvé
- Aucune question sur les conventions Vorbis ni sur le WAV

**Inconvénients :**
- Laisse de côté les achats Bandcamp en FLAC et les fichiers WAV et AIFF d'une bibliothèque réelle
- Jette des champs que l'API renvoie déjà gratuitement (numéro de catalogue, URL de la fiche, artiste de la sortie, traçabilité)

**Coût estimé :** Nul, périmètre insuffisant.

## Option C : Écriture sélective par cases à cocher

**Description :** L'utilisateur choisit les champs à écrire dans les Settings.

**Avantages :**
- Contrôle fin pour qui a une convention de tagging personnelle

**Inconvénients :**
- Interface à concevoir, à traduire et à expliquer, pour un besoin non exprimé
- Multiplie les combinaisons à tester et les cas de rapport
- Le problème réel qu'elle prétend résoudre (écraser un champ existant par du vide) est déjà réglé par la règle sur `null`

**Coût estimé :** Non négligeable, pour un besoin hypothétique.

---

# 🎉 Décision

**Quatre formats, écriture de tout ce que l'API renvoie, `null` non destructif.**

L'écriture se construit à partir de ce qui est présent, **sans jamais supposer un champ**, puisque la couverture Bandcamp est bien plus pauvre que celle de Beatport.

## Formats et systèmes de tags

| Famille | Système de tags | Formats |
|---|---|---|
| ID3v2 | La table ci-dessous s'applique telle quelle | MP3, AIFF, WAV |
| Vorbis comments | Clés textuelles libres, pochette en `METADATA_BLOCK_PICTURE` | FLAC |

M4A est écarté, absent des circuits d'achat DJ.

Les clés Vorbis suivent **MusicBrainz Picard**, référence de fait des bibliothèques musicales :

| Champ | ID3v2.3 (cible) | Vorbis |
|---|---|---|
| Artiste | TPE1 | `ARTIST` |
| Artiste de la sortie | TPE2 | `ALBUMARTIST` |
| Remixers | TPE4 | `REMIXER` |
| Titre | TIT2 | `TITLE` |
| Album | TALB | `ALBUM` |
| Date | TYER + TDAT | `DATE` |
| Date de la sortie | TORY | `ORIGINALDATE` |
| Genre | TCON | `GENRE` |
| Label | TPUB | `LABEL` |
| Numéro de catalogue | TXXX:CATALOGNUMBER | `CATALOGNUMBER` |
| BPM | TBPM | `BPM` |
| Key | TKEY | `KEY` |
| ISRC | TSRC | `ISRC` |
| Numéro de piste | TRCK | `TRACKNUMBER` |
| URL de la fiche | WOAS | `URL` |
| Traçabilité | TXXX:SOURCE_ID, TXXX:SOURCE | `SOURCE_ID`, `SOURCE` |

Les trois champs sans équivalent Picard (`SOURCE_ID`, `SOURCE`, et l'URL en Vorbis) suivent la convention générale : un `TXXX:X` en ID3 correspond à la clé `X` en Vorbis.

## Correspondance des champs

| Champ API | Tag ID3 | Beatport | Bandcamp | Note |
|---|---|---|---|---|
| `artists[]` | TPE1 (`artist`) | ✅ | ✅ | noms joints |
| `release` (artiste de la sortie) | TPE2 (`albumartist`) | ✅ | ✅ | absent de la CLI actuelle |
| `remixers[]` | TPE4 | ✅ | ❌ | non exposé par EasyID3, à enregistrer |
| `title` + `mix_name` | TIT2 (`title`) | ✅ | partiel | cf. règles |
| `release.title` | TALB (`album`) | ✅ | ✅ | |
| `release_date` | TDRC (`date`) | ✅ | ✅ | date du morceau, fait foi. Écrite par mutagen, convertie en TYER + TDAT au `save(v2_version=3)` |
| `release.release_date` | TDOR (`originaldate`) | ✅ | ✅ | date de la sortie. **Frame v2.4 sans équivalent complet en v2.3**, cf. règles |
| `genre` | TCON (`genre`) | ✅ | ❌ | |
| `label.name` | TPUB (`organization`) | ✅ | ✅ | |
| `release.catalog_number` | TXXX:CATALOGNUMBER | ✅ | ❌ | convention Picard, absent de la CLI actuelle |
| `bpm` | TBPM | ✅ | ❌ | |
| `key` | TKEY | ✅ | ❌ | notation Camelot, non exposé par EasyID3, à enregistrer |
| `isrc` | TSRC | ✅ | ✅ | |
| `track_number` | TRCK | ✅ | ✅ | |
| `url` | WOAS | ✅ | ✅ | lien vers la fiche source, absent de la CLI actuelle |
| `id` + `source` | TXXX:SOURCE_ID, TXXX:SOURCE | ✅ | ✅ | traçabilité, permet un re-tag ciblé sans refaire la recherche |
| `release.artwork_url` | APIC (type 3, front cover) | ✅ | ✅ | téléchargée pendant la phase réseau, mise en cache |

## Règles

- **Titre** : avec `mix_name` (Beatport), on rend « Titre (Mix Name) ». Sans lui (Bandcamp), on prend `title` tel quel, les artistes y écrivant déjà le remix à la main.
- **Remixers** écrits en TPE4 seulement quand la source les fournit séparément. Depuis Bandcamp, l'information reste dans le titre.
- **Un champ `null` ne touche pas au tag existant.**
- **Les tags hors tableau sont laissés intacts**, pas d'effacement global du bloc.
- **Renommage après l'écriture des tags, jamais avant.**
- **Dump JSON des tags d'origine avant réécriture**, avec rollback par run ou par morceau.
- **Version et encodage ID3 explicites, jamais laissés au hasard.** Un fichier téléchargé de n'importe où peut arriver en ID3v2.3 comme en v2.4, avec des chaînes en latin-1 héritées. Réécrire sans fixer la version produit une bibliothèque hétérogène et, selon le lecteur, des accents cassés. **La cible est ID3v2.3**, écrite par `save(v2_version=3)`, justification en notes complémentaires.
- **L'écriture passe par l'objet `ID3` complet, jamais par `EasyID3` seul.** Le tableau ci-dessus impose déjà de descendre au niveau des frames pour TPE4, TKEY et les TXXX, qu'`EasyID3` n'expose pas. Mais la raison est plus profonde : `EasyID3.save(v2_version=3)` n'applique pas `update_to_v23()`, et laisse alors une frame `TDRC` v2.4 vide **à côté** du `TYER` v2.3 attendu ([mutagen#188](https://github.com/quodlibet/mutagen/issues/188)). Le fichier produit est hybride sans que rien ne le signale. Le test associé doit donc vérifier l'**absence** de `TDRC` autant que la présence de `TYER` : contrôler seulement la seconde laisserait passer exactement ce défaut.
- **Deux réglages de `save()` ne se laissent pas au défaut.** Le tableau des champs API est écrit en noms v2.4, ceux que mutagen manipule en mémoire, mais le fichier produit contient les frames v2.3 du tableau de correspondance ci-dessus, `update_to_v23()` faisant la conversion. Deux points à décider explicitement dans `files.py` :
  - **`TDOR` perd sa précision** : la conversion ne reporte que l'année dans `TORY`. Soit on l'assume, soit on double la date complète en `TXXX:ORIGINALDATE`.
  - **`v23_sep` gouverne les artistes multiples** : le défaut `/` les joint en une chaîne, `None` conserve le séparateur null. Le second garde l'information mais écrit un v2.3 non standard, que les lecteurs les plus anciens liront mal. À trancher sur les fichiers de test, c'est exactement le genre de détail que le choix de v2.3 rend visible.

  Les deux cas sont couverts par un test sur les quatre formats.

---

# 🔄 Conséquences

## Positives

- Une bibliothèque mixte est traitée intégralement, quel que soit le format d'achat
- Un tagging depuis Bandcamp n'appauvrit jamais un fichier déjà renseigné
- La traçabilité (`SOURCE_ID`, `SOURCE`) permet un re-tag ciblé sans refaire la recherche
- Aucune interface de sélection à concevoir, traduire ou expliquer

## Négatives

- Deux tables de correspondance à écrire et à tester séparément
- **Le WAV reste incertain en lecture** : le chunk ID3v2 s'écrit correctement, mais rien ne garantit que le lecteur DJ le relise. On écrit quand même, en le signalant dans le rapport.
- Un fichier tagué depuis Bandcamp conserve des champs anciens et faux si le fichier en avait, sans qu'aucune source ne les corrige
- Les frames TPE4 et TKEY ne sont pas exposées par EasyID3 et doivent être enregistrées explicitement
- La cible v2.3 dégrade un champ : la date de sortie perd le jour et le mois. Seule perte réelle du choix de version, les valeurs multiples restant récupérables par `v23_sep=None`

---

# 📝 Notes complémentaires

Le rapport indique **la source retenue et le nombre de champs écrits par morceau**, ce qui rend visibles les fichiers tagués à moitié.

**Version ID3 cible : v2.3, écrite explicitement.** mutagen vise v2.4 et **upgrade silencieusement** les tags v2.3 existants au `save()` : il faut lui passer `v2_version=3`.

v2.4 est pourtant le meilleur format sur le papier. Ce qui tranche est l'état de ses implémentations : « **2.4 is an incomplete specification so each implementation is slightly different** », et le support de Serato répond depuis toujours « it has **always been recommended to use id3 tag version 2.3**. If you are having an issue with other tag version please convert all files to version 2.3 » (28 mars 2014), avec pour contournement d'un bug de genres « **remove any ID3 tags except v.2.3** and rebuild the library ». S'y ajoute Windows, qui n'affiche ni champs ni pochette d'un fichier v2.4 sans modification du registre.

**Rekordbox respecte la version déjà en place**, ce qui rend la décision sûre au lieu de probable : « Rekordbox v6.8.4 seems to use ID3v2.3 too, **if such a tag already exists** in the track » (test du 18 février 2025), le v2.4 n'apparaissant que sur un fichier sans tag. Comme techno-tagger écrit **avant** le logiciel DJ, c'est lui qui fixe la version et Rekordbox s'y conforme.

**Ce que v2.3 coûte**, mesuré et non supposé : la date de sortie perd le jour et le mois, `update_to_v23()` ne reportant que l'année de `TDOR` dans `TORY`. Les valeurs multiples ne sont pas perdues pour autant, `v23_sep=None` conservant le séparateur null. L'unicode non plus, v2.3 l'encodant en UTF-16.

> **Réserve.** Le comportement de Rekordbox est récent et vérifié, la recommandation Serato est constante mais documentée entre 2008 et 2015, et la version qu'écrit Traktor 4 par défaut n'a pas pu être établie.

**Sur le WAV.** mutagen écrit un chunk ID3v2 dans un RIFF/WAVE, et le défaut d'écriture historique sur certains fichiers ([mutagen #496](https://github.com/quodlibet/mutagen/issues/496), ouvert en 2020) est corrigé depuis la PR #517. Le risque résiduel est donc **en lecture, chez les logiciels DJ**, hors de portée de toute bibliothèque Python : Rekordbox stocke la plupart de ses champs dans sa propre base plutôt que dans le fichier, et des incompatibilités de lecture entre logiciels sur les WAV sont documentées. Un test sur Rekordbox reste utile pour savoir quoi écrire dans le rapport, mais il ne conditionne pas l'implémentation. Un échec d'écriture est logué, le fichier reste intact, le run continue.

pytaglib (bindings TagLib C++) couvre aussi WAV et AIFF et gère en plus le chunk RIFF INFO, mais c'est une dépendance native à compiler et à empaqueter avec PyInstaller. mutagen est pur Python, sans dépendance hors bibliothèque standard, ce qui reste décisif pour un binaire distribué.

Références : [MusicBrainz Picard — Tag Mapping](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html), [mutagen — WAVE](https://mutagen.readthedocs.io/en/latest/api/wave.html), [mutagen — ID3 API](https://mutagen.readthedocs.io/en/latest/api/id3.html) (`v23_sep`, `update_to_v23()`), [mutagen — `_tags.py`](https://github.com/quodlibet/mutagen/blob/main/mutagen/id3/_tags.py) (conversion `TDOR` → `TORY`).

Comportement des logiciels DJ : [Mp3tag — Which Rekordbox fields are saved in mp3 tracks?](https://community.mp3tag.de/t/which-rekordbox-fields-are-saved-in-mp3-tracks/67557) (test sur Rekordbox v6.8.4, 18 février 2025 : préservation du v2.3 existant, champs réellement réécrits), [Mp3tag — Traktor Pro 4 tag compatibility](https://community.mp3tag.de/t/native-instrument-traktor-pro-4-v4-1-1-23-tag-compatibility-with-mp3tag/67494) (v4.1.1.23 : frame `PRIV` propriétaire, écrasement silencieux de BPM et `INITIALKEY` à l'analyse).

Recommandation v2.3 dans l'écosystème DJ : [Serato — Genres in ID3 tags are not saved](https://serato.com/forum/discussion/1234629) (réponses du support, mars-avril 2014), [Serato — iD3 Tag V. 2.4 vs. 2.3](https://serato.com/forum/discussion/80050) (2008, sur l'hétérogénéité des implémentations v2.4), [Serato — ID3 2.4 Tags](https://serato.com/forum/discussion/629925) (2012, réécriture par Traktor), [Pioneer DJ — Rekordbox tagging (ID3) and database questions](https://forums.pioneerdj.com/hc/en-us/community/posts/203052319-Rekordbox-tagging-ID3-and-database-questions).
