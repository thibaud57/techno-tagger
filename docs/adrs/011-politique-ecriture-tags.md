---
title: "ADR-011 : Politique d'écriture des tags"
status: "accepted"
description: "Quatre formats supportés via mutagen, écriture de tout ce que l'API renvoie sans cases à cocher, et un champ null qui ne touche jamais au tag existant."
date: "2026-10-11"
keywords: ["architecture", "adr", "id3", "vorbis", "mutagen", "tags", "metadata"]
scope: ["docs", "architecture"]
technologies: ["mutagen", "Python", "ID3", "FLAC"]
---

# 🎯 Contexte

La CLI actuelle traite le MP3 seul et écrit dix champs. Le contrat `Track` de techno-scraper en expose davantage, et une bibliothèque DJ mélange les achats Beatport et Bandcamp, donc plusieurs formats de fichiers.

La couverture des sources est très asymétrique : **Beatport remplit tout le contrat, Bandcamp seulement le socle d'identité** (artistes, titre, album, dates, label, ISRC, numéro de piste, URL, pochette). Ni genre, ni BPM, ni key, ni remixers, ni numéro de catalogue côté Bandcamp. **Précision 2026-09-30** : depuis la normalisation des champs texte de techno-scraper (son ADR-012), Bandcamp rend aussi les remixeurs et le numéro de catalogue quand le titre les porte.

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
- Jette des champs que l'API renvoie déjà gratuitement (numéro de catalogue, URL de la fiche, traçabilité)

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
| Vorbis comments | Clés textuelles libres, pochette en bloc PICTURE natif du FLAC, posé par `add_picture()` (`METADATA_BLOCK_PICTURE` est le champ propre à Ogg) | FLAC |

M4A est écarté, absent des circuits d'achat DJ.

Les clés Vorbis suivent **MusicBrainz Picard**, référence de fait des bibliothèques musicales :

| Champ | ID3v2.3 (cible) | Vorbis |
|---|---|---|
| Artiste | TPE1 | `ARTIST` |
| Artiste de la sortie | TPE2 | `ALBUMARTIST` |
| Remixers | TPE4 | `REMIXER` |
| Titre | TIT2 | `TITLE` |
| Album | TALB | `ALBUM` |
| Date | TYER | `DATE` |
| Genre | TCON | `GENRE` |
| Label | TPUB | `LABEL` |
| Numéro de catalogue | TXXX:CATALOGNUMBER | `CATALOGNUMBER` |
| BPM | TBPM | `BPM` |
| Key | TKEY | `KEY` et `INITIALKEY`, même valeur (ajout du 2026-10-23 : rekordbox ne lit que le second, VirtualDJ préfère le premier, cf. [knowledges/rekordbox.md](../knowledges/rekordbox.md)) |
| ISRC | TSRC | `ISRC` |
| Numéro de piste | TRCK | `TRACKNUMBER` |
| URL de la fiche | WOAS | `URL` |
| Traçabilité | TXXX:SOURCE_ID, TXXX:SOURCE | `SOURCE_ID`, `SOURCE` |

Les trois champs sans équivalent Picard (`SOURCE_ID`, `SOURCE`, et l'URL en Vorbis) suivent la convention générale : un `TXXX:X` en ID3 correspond à la clé `X` en Vorbis.

## Correspondance des champs

| Champ API | Tag ID3 | Beatport | Bandcamp | Note |
|---|---|---|---|---|
| `artists[]` | TPE1 (`artist`) | ✅ | ✅ | noms joints |
| - | TPE2 (`albumartist`) | ❌ | ❌ | le contrat ne rend pas d'artiste de sortie (`release` : id, title, source_title, catalog_number, release_date, artwork_url) : source à définir, non écrit tant qu'elle ne l'est pas |
| `remixers[]` | TPE4 | ✅ | partiel | non exposé par EasyID3, à enregistrer ; Bandcamp : seulement si le titre nomme le remixeur (cf. Contexte) |
| `title` + `mix_name` | TIT2 (`title`) | ✅ | ✅ | cf. règles |
| `release.title` | TALB (`album`) | ✅ | ✅ | |
| `release.release_date` | TDRC (`date`) | ✅ | ✅ | seule date du contrat, celle de la sortie (`Track` n'en porte aucune à la racine), écrite uniquement dans ce champ (cf. la précision du 2026-10-11). Année seule, convertie en `TYER` par `update_to_v23()` |
| `genre` | TCON (`genre`) | ✅ | ❌ | |
| `label.name` | TPUB (`organization`) | ✅ | ✅ | |
| `release.catalog_number` | TXXX:CATALOGNUMBER | ✅ | partiel | convention Picard, absent de la CLI actuelle ; Bandcamp : seulement si le titre de la sortie le porte (cf. Contexte) |
| `bpm` | TBPM | ✅ | ❌ | |
| `key` | TKEY | ✅ | ❌ | notation Camelot, non exposé par EasyID3, à enregistrer |
| `isrc` | TSRC | ✅ | ✅ | |
| `track_number` | TRCK | ✅ | ✅ | |
| `url` | WOAS | ✅ | ✅ | lien vers la fiche source, absent de la CLI actuelle |
| `id` + `source` | TXXX:SOURCE_ID, TXXX:SOURCE | ✅ | ✅ | traçabilité, permet un re-tag ciblé sans refaire la recherche |
| `release.artwork_url` | APIC (type 3, front cover) | ✅ | ✅ | téléchargée pendant la phase réseau, mise en cache |

## Règles

- **Titre** : avec `mix_name` (Beatport), on rend « Titre (Mix Name) ». **Précision 2026-09-30** : techno-scraper rend la version à part (`mix_name`) pour les trois sources depuis sa normalisation des champs texte (son ADR-012) ; `title` ne porte plus de version et la composition `Titre (Mix Name)` vaut partout.
- **Remixers** écrits en TPE4 seulement quand la source les fournit séparément, ce que Bandcamp fait aussi depuis l'ADR-012 de techno-scraper (cf. Contexte).
- **Un champ `null` ne touche pas au tag existant.**
- **Les tags hors tableau sont laissés intacts**, pas d'effacement global du bloc, sauf les commentaires, les images et les frames v2.4 sans équivalent v2.3 (cf. les précisions des 2026-10-06 et 2026-10-07).
- **Renommage après l'écriture des tags, jamais avant.**
- **Dump JSON des tags d'origine avant réécriture**, avec rollback par run ou par morceau.
- **Version et encodage ID3 explicites, jamais laissés au hasard.** Un fichier téléchargé de n'importe où peut arriver en ID3v2.3 comme en v2.4, avec des chaînes en latin-1 héritées. Réécrire sans fixer la version produit une bibliothèque hétérogène et selon le lecteur, des accents cassés. **La cible est ID3v2.3**, écrite par `update_to_v23()` puis `save(v2_version=3)`, justification en notes complémentaires.
- **L'écriture passe par l'objet `ID3` complet, jamais par `EasyID3` seul.** Le tableau ci-dessus impose déjà de descendre au niveau des frames pour TPE4, TKEY et les TXXX, qu'`EasyID3` n'expose pas. Mais la raison est plus profonde : `EasyID3.save(v2_version=3)` n'applique pas `update_to_v23()`, et laisse alors une frame `TDRC` v2.4 vide **à côté** du `TYER` v2.3 attendu ([mutagen#188](https://github.com/quodlibet/mutagen/issues/188)). Le fichier produit est hybride sans que rien ne le signale. Le test associé doit donc vérifier l'**absence** de `TDRC` autant que la présence de `TYER` : contrôler seulement la seconde laisserait passer exactement ce défaut.
- **`v23_sep` ne se laisse pas au défaut.** Le tableau des champs API est écrit en noms v2.4, ceux que mutagen manipule en mémoire, mais le fichier produit contient les frames v2.3 du tableau de correspondance ci-dessus, `update_to_v23()` faisant la conversion. `v23_sep` gouverne les artistes multiples : le défaut `/` les joint en une chaîne, `None` conserve le séparateur null. Le second garde l'information mais écrit un v2.3 non standard, que les lecteurs les plus anciens liront mal. À trancher sur les fichiers de test, c'est exactement le genre de détail que le choix de v2.3 rend visible, et le cas est couvert par un test sur les quatre formats.

  **Tranché le 2026-10-06** : chaque champ s'écrit en une seule chaîne, artistes et remixeurs joints par « , », donc `v23_sep` ne s'applique pas ; la date se réduit à l'année sur les quatre formats.
- **Précision 2026-10-06 : écriture en place.** mutagen écrit dans le fichier, sans copie voisine : quelques secondes pour 100 morceaux, là où une copie recopierait 6 Go pour 100 WAV de 60 Mo et doublerait l'espace disque. Fichier absent, verrou et droits échouent avant toute écriture sur le disque, le premier à la lecture du fichier, les deux autres à son ouverture en écriture dans `save()` ; une panne en pleine écriture peut abîmer le fichier, le dump restaurant les tags et non l'audio.
- **Précision 2026-10-06 : une seule image.** Avec une pochette, toutes les images du fichier sont retirées puis la pochette est posée en recto ; sans pochette lisible, le recto existant est gardé, à défaut la première image et les autres sont retirées.
- **Précision 2026-10-06 : aucun commentaire.** `COMM` en ID3, `COMMENT` et `DESCRIPTION` en Vorbis sont retirés à chaque écriture. Les autres tags hors tableau restent intacts : Serato et Traktor rangent cue points et beatgrids dans des frames `GEOB` et `PRIV`.
- **Précision 2026-10-06 : `update_to_v23()` est obligatoire.** Constaté sur mutagen 1.48.1 : `save(v2_version=3)` seul écrit un en-tête v2.3 mais laisse `TDRC` (et un `TDOR` déjà présent) sur le disque, que seul `update_to_v23()` convertit en `TYER` (et `TORY`). Le piège n'est donc pas propre à `EasyID3`.
- **Précision 2026-10-07 : `update_to_v23()` retire des frames hors tableau.** Mesuré sur mutagen 1.48.1 en réécrivant un MP3 v2.4 : les frames v2.4 sans équivalent v2.3 disparaissent, soit `TSOP`, `TSOA`, `TSOT` (ordres de tri), `TDRL`, `TMOO`, `TDEN`, `TDTG` et `TPRO`. `RVA2` est conservé et `TIPL` devient `IPLS`. Les données Serato et Traktor (`GEOB`, `PRIV`, `POPM`) sont conservées. C'est une exception écrite à « les tags hors tableau sont laissés intacts », assumée par le choix de v2.3.
- **Précision 2026-10-11 : pas d'année d'origine.** Le contrat techno-scraper ne rend qu'une date, celle de la sortie (`release.release_date`). L'écrire aussi en année d'origine (`TORY` en ID3 v2.3, `ORIGINALDATE` en Vorbis) dupliquait la valeur et la rendait fausse pour une réédition, dont l'année devenait « année d'origine ». Seule l'Année (`TYER`, `DATE`) est écrite, et le détail avant / après n'affiche aucun champ d'origine. Un `TORY` ou un `ORIGINALDATE` déjà présent dans un fichier relève des tags hors tableau : jamais touché. `update_to_v23()` continue de convertir un `TDOR` existant en `TORY`, ce qui est un effet de mutagen et non une écriture du projet.

---

# 🔄 Conséquences

## Positives

- Une bibliothèque mixte est traitée intégralement, quel que soit le format d'achat
- Un tagging depuis Bandcamp n'appauvrit jamais un fichier déjà renseigné
- La traçabilité (`SOURCE_ID`, `SOURCE`) permet un re-tag ciblé sans refaire la recherche

## Négatives

- Deux tables de correspondance à écrire et à tester séparément
- **Le WAV reste incertain en lecture** : le chunk ID3v2 s'écrit correctement, mais rien ne garantit que le lecteur DJ le relise. On écrit quand même, en le signalant dans le rapport.
- Un fichier tagué depuis Bandcamp conserve des champs anciens et faux si le fichier en avait, sans qu'aucune source ne les corrige
- Les frames TPE4 et TKEY ne sont pas exposées par EasyID3 et doivent être enregistrées explicitement
- La cible v2.3 et l'année seule font perdre à la date de sortie le jour et le mois, sur les quatre formats. Les valeurs multiples sont tranchées le 2026-10-06 : une seule chaîne par champ, jointe par « , », `v23_sep` sans objet
- **Un rollback ne rend ni les commentaires ni les pochettes** retirés par l'écriture : le dump ne les garde pas, choix acté par la spec du dump des tags d'origine. **La pochette posée par l'écriture reste donc après un rollback**, y compris sur un fichier qui n'en avait pas : retirer l'image seulement dans ce cas ferait deux comportements pour un gain marginal, écarté le 2026-10-13. La confirmation de la restauration le dit

---

# 📝 Notes complémentaires

Le rapport indique **la source retenue et le nombre de champs écrits par morceau**, ce qui rend visibles les fichiers tagués à moitié.

**Version ID3 cible : v2.3, écrite explicitement.** mutagen vise v2.4 et **upgrade silencieusement** les tags v2.3 existants au `save()` : il faut lui passer `v2_version=3`.

v2.4 est pourtant le meilleur format sur le papier. Ce qui tranche est l'état de ses implémentations : « **2.4 is an incomplete specification so each implementation is slightly different** », et le support de Serato répond depuis toujours « it has **always been recommended to use id3 tag version 2.3**. If you are having an issue with other tag version please convert all files to version 2.3 » (28 mars 2014), avec pour contournement d'un bug de genres « **remove any ID3 tags except v.2.3** and rebuild the library ». S'y ajoute Windows, qui n'affiche ni champs ni pochette d'un fichier v2.4 sans modification du registre.

**Rekordbox respecte la version déjà en place**, ce qui rend la décision sûre au lieu de probable : « Rekordbox v6.8.4 seems to use ID3v2.3 too, **if such a tag already exists** in the track » (test du 18 février 2025), le v2.4 n'apparaissant que sur un fichier sans tag. Comme techno-tagger écrit **avant** le logiciel DJ, c'est lui qui fixe la version et Rekordbox s'y conforme.

**Ce que v2.3 coûte**, mesuré et non supposé : la date de sortie perd le jour et le mois, l'année seule étant écrite dans `TYER`. L'unicode ne l'est pas, v2.3 l'encodant en UTF-16. Les valeurs multiples sont tranchées le 2026-10-06 : une seule chaîne par champ, `v23_sep` ne s'applique pas.

> **Réserve.** Le comportement de Rekordbox est récent et vérifié, la recommandation Serato est constante mais documentée entre 2008 et 2015, et la version qu'écrit Traktor 4 par défaut n'a pas pu être établie.

**Sur le WAV.** mutagen écrit un chunk ID3v2 dans un RIFF/WAVE et le défaut d'écriture historique sur certains fichiers ([mutagen #496](https://github.com/quodlibet/mutagen/issues/496), ouvert en 2020) est corrigé depuis la PR #517. Le risque résiduel est donc **en lecture, chez les logiciels DJ**, hors de portée de toute bibliothèque Python : Rekordbox stocke la plupart de ses champs dans sa propre base plutôt que dans le fichier et des incompatibilités de lecture entre logiciels sur les WAV sont documentées. Un test sur Rekordbox reste utile pour savoir quoi écrire dans le rapport, mais il ne conditionne pas l'implémentation. Un échec d'écriture est logué et le run continue ; l'écriture se fait en place, donc le fichier reste intact pour les échecs courants (verrou, droits, fichier absent), qui surviennent avant toute écriture sur le disque.

pytaglib (bindings TagLib C++) couvre aussi WAV et AIFF et gère en plus le chunk RIFF INFO, mais c'est une dépendance native à compiler et à empaqueter avec PyInstaller. mutagen est pur Python, sans dépendance hors bibliothèque standard, ce qui reste décisif pour un binaire distribué.

Références : [MusicBrainz Picard : Tag Mapping](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html), [mutagen : WAVE](https://mutagen.readthedocs.io/en/latest/api/wave.html), [mutagen : ID3 API](https://mutagen.readthedocs.io/en/latest/api/id3.html) (`v23_sep`, `update_to_v23()`), [mutagen : `_tags.py`](https://github.com/quodlibet/mutagen/blob/main/mutagen/id3/_tags.py) (conversion `TDOR` → `TORY`).

Comportement des logiciels DJ : [Mp3tag : Which Rekordbox fields are saved in mp3 tracks?](https://community.mp3tag.de/t/which-rekordbox-fields-are-saved-in-mp3-tracks/67557) (test sur Rekordbox v6.8.4, 18 février 2025 : préservation du v2.3 existant, champs réellement réécrits), [Mp3tag : Traktor Pro 4 tag compatibility](https://community.mp3tag.de/t/native-instrument-traktor-pro-4-v4-1-1-23-tag-compatibility-with-mp3tag/67494) (v4.1.1.23 : frame `PRIV` propriétaire, écrasement silencieux de BPM et `INITIALKEY` à l'analyse).

Recommandation v2.3 dans l'écosystème DJ : [Serato : Genres in ID3 tags are not saved](https://serato.com/forum/discussion/1234629) (réponses du support, mars-avril 2014), [Serato : iD3 Tag V. 2.4 vs. 2.3](https://serato.com/forum/discussion/80050) (2008, sur l'hétérogénéité des implémentations v2.4), [Serato : ID3 2.4 Tags](https://serato.com/forum/discussion/629925) (2012, réécriture par Traktor), [Pioneer DJ : Rekordbox tagging (ID3) and database questions](https://forums.pioneerdj.com/hc/en-us/community/posts/203052319-Rekordbox-tagging-ID3-and-database-questions).
