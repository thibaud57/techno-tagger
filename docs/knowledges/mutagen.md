---
title: "mutagen — Lecture et écriture des tags audio"
version: "1.48.1"
description: "Référence technique pour mutagen : ID3 vs Vorbis Comments, écriture en ID3v2.3, pochettes APIC et FLAC, tags WAV/AIFF, dump pour rollback et gestion des fichiers verrouillés."
date: "2026-08-29"
keywords: ["mutagen", "id3", "vorbis-comments", "apic", "flac", "wav", "aiff", "tags"]
scope: ["docs"]
technologies: ["Python", "PyInstaller"]
---

# Description

Bibliothèque pure Python de lecture et d'écriture de métadonnées audio, sans dépendance hors bibliothèque standard. Elle couvre les quatre formats du projet, WAV compris, et c'est cette absence de dépendance native qui la fait préférer à pytaglib, lequel imposerait un binaire à empaqueter avec PyInstaller (cf. [ADR-011](../adrs/011-politique-ecriture-tags.md)).

**Projet à cadence de release très faible** : 2 ans et 9 mois séparent la 1.47.0 de la 1.48.0. Un bug découvert ne sera pas corrigé rapidement en amont, il faut prévoir de le contourner.

---

# Concepts Clés

## Deux systèmes de tags, deux tables de correspondance

### Description

ID3 (MP3, WAV, AIFF) est une structure binaire de frames à identifiant de quatre caractères. Vorbis Comments (FLAC) est un dictionnaire clé-valeur libre. Ce ne sont pas deux dialectes du même modèle : le mapping vers le contrat `Track` doit être écrit deux fois.

### Exemple

```python
from mutagen.id3 import ID3, TIT2, TPE1

tags = ID3("track.mp3")
tags["TIT2"] = TIT2(encoding=3, text=["Titre"])   # objet frame, pas une chaîne
tags["TPE1"] = TPE1(encoding=3, text=["Artiste"])

from mutagen.flac import FLAC

audio = FLAC("track.flac")
audio["title"] = "Titre"                           # clé-valeur, rend une liste
audio["artist"] = "Artiste"
```

| Champ `Track` | ID3 | Vorbis Comment |
|---|---|---|
| `title` | `TIT2` | `TITLE` |
| `artists` | `TPE1` | `ARTIST` |
| `release` | `TALB` | `ALBUM` |
| `track_number` | `TRCK` | `TRACKNUMBER` |
| `release_date` | `TDRC` (v2.4) / `TYER`+`TDAT` (v2.3) | `DATE` |
| `label` | `TPUB` | `LABEL` |
| `genre` | `TCON` | `GENRE` |
| `bpm` | `TBPM` | `BPM` |
| `isrc` | `TSRC` | `ISRC` |

### Points Importants

- **`audio["TIT2"]` rend un objet frame, pas une chaîne** : le texte est dans `.text`, qui est une liste
- Côté Vorbis, toute valeur est une **liste** même pour un champ unique
- **`EasyID3` simule une interface clé-valeur par-dessus ID3**, mais ne couvre qu'un sous-ensemble de frames. Pour APIC, les `TXXX` maison ou tout ce qui sort de sa table, il faut retomber sur `ID3` brut
- **Aucune table officielle unifiée ID3 ↔ Vorbis n'existe** côté mutagen : celle du projet est à maintenir à la main, champ par champ
- La 1.48.0 impose Python 3.10 minimum

---

## Écriture en ID3v2.3

### Description

mutagen vise ID3v2.4 par défaut. Le projet écrit en v2.3, mieux lu par l'Explorateur Windows et les lecteurs anciens.

### Exemple

```python
tags.save(v2_version=3)   # sans cet argument : v2.4
```

### Points Importants

- **La conversion v2.4 → v2.3 n'est pas neutre** : le texte UTF-8 est réencodé en UTF-16, les valeurs multiples sont jointes par un séparateur (`v23_sep`, `/` par défaut), et **`TDRC` est éclaté en `TYER` + `TDAT` + `TIME`**
- **Piège historique `EasyID3` + `v2_version=3`** : écrire `audio["date"]` puis sauver produisait une frame `TDRC` vide en plus du `TYER`. Le code actuel gère le cas en interne (sauvegarde des frames v2.4, conversion, restauration), mais **ce correctif est arrivé en cours de vie du projet** : écrire un test qui écrit une date, sauve en v2.3, relit le fichier et vérifie `TYER`
- Le séparateur de valeurs multiples change le rendu d'une chaîne d'artistes : le choisir explicitement plutôt que subir le `/` par défaut
- La conversion ne s'applique qu'à l'écriture : l'objet en mémoire reste en v2.4

---

## Pochettes : APIC et blocs FLAC

### Description

Deux mécanismes distincts. ID3 embarque une frame `APIC` de type 3 (front cover). FLAC utilise des blocs `PICTURE` natifs du conteneur, ajoutés par `add_picture()`.

### Exemple

```python
from mutagen.id3 import APIC, PictureType

tags.add(APIC(
    encoding=3,
    mime="image/jpeg",
    type=PictureType.COVER_FRONT,   # == 3
    desc="Cover",
    data=image_bytes,
))
tags.save(v2_version=3)
```

```python
from mutagen.flac import FLAC, Picture

audio = FLAC("track.flac")
picture = Picture()
picture.type = 3
picture.mime = "image/jpeg"
picture.data = image_bytes

audio.clear_pictures()    # sinon accumulation à chaque re-tag
audio.add_picture(picture)
audio.save()
```

### Points Importants

- **`clear_pictures()` avant `add_picture()`** : sans ça, un re-run empile les pochettes et fait grossir le fichier
- **La clé d'unicité d'une frame `APIC` est le couple `(type, desc)`** : deux pochettes de même type et même description se remplacent. La 1.48.0 ajoute un attribut `salt` pour forcer la coexistence, non nécessaire ici
- **`METADATA_BLOCK_PICTURE` est le nom du champ Vorbis Comment côté Ogg/Opus**, où l'image est encodée en base64. Pour du FLAC natif, passer par `add_picture()` et ne pas manipuler ce champ à la main
- mutagen peut écrire plusieurs images front cover identiques sans toutes les relire ensuite : dédupliquer côté application plutôt que compter sur la bibliothèque
- **Un échec de pochette n'échoue jamais le morceau** : les tags sont écrits sans image et le rapport le signale

---

## WAV et AIFF

### Description

Les deux formats embarquent un chunk ID3 dans leur conteneur. L'objet `tags` est une instance `ID3` classique : même table de correspondance, même piège de date, même API de pochette que pour le MP3.

### Exemple

```python
from mutagen.wave import WAVE
from mutagen.id3 import TIT2

audio = WAVE("track.wav")
if audio.tags is None:
    audio.add_tags()          # aucun chunk ID3 dans le fichier d'origine
audio.tags["TIT2"] = TIT2(encoding=3, text=["Titre"])
audio.save(v2_version=3)
```

### Points Importants

- **`audio.tags` vaut `None` sur un fichier sans tags** : `add_tags()` avant toute écriture, sinon `TypeError` sur l'indexation
- `AIFF` s'utilise exactement pareil
- Le support WAVE étendu et la gestion des fichiers IFF tronqués datent de la 1.47.0, donc acquis ici
- **C'est la couverture du WAV qui justifie mutagen** : beaucoup de bibliothèques de tags s'arrêtent aux formats compressés

---

## Dump des tags d'origine pour le rollback

### Description

mutagen n'offre aucune API de dump ou de rollback. Le plan de run écrit un JSON des tags d'origine avant toute écriture (cf. [ADR-010](../adrs/010-ecriture-batch-et-plan-de-run.md)), conservé 30 jours.

### Exemple

```python
def dump_tags(path: Path) -> dict[str, list[str]]:
    audio = mutagen.File(path)
    if audio is None or audio.tags is None:
        return {}
    return {key: [str(v) for v in values] for key, values in audio.tags.items()}
```

### Points Importants

- **Ne pas `deepcopy` les objets tags** : certains objets frame ne se copient pas proprement selon la version. Sérialiser vers des types simples
- `pprint()` donne un dump lisible pour les logs, **pas exploitable pour restaurer**
- **Un rollback bit-exact demanderait une copie du fichier brut** avant écriture, mutagen modifiant en place. Le dump JSON restaure les tags, pas l'octet près
- `mutagen.File()` rend `None` quand le format n'est pas reconnu : le cas se traite, il ne lève pas

---

## Fichiers verrouillés et erreurs

### Description

Sur Windows, un fichier ouvert dans un lecteur (Rekordbox, VLC) est verrouillé en écriture. C'est le mode de panne le plus courant de la phase d'écriture (cf. [ARCHITECTURE.md § Robustesse](../ARCHITECTURE.md#-robustesse--modes-de-panne)).

### Exemple

```python
from mutagen import MutagenError

try:
    audio.save(v2_version=3)
except (MutagenError, OSError) as exc:
    cause = getattr(exc, "__cause__", None) or exc
    reason = "file_locked" if isinstance(cause, PermissionError) else "write_error"
    plan.mark_failed(track, reason)   # le run continue sur les suivants
```

### Points Importants

- **`MutagenError` n'enveloppe pas systématiquement les erreurs OS** : un `PermissionError` peut remonter nu selon le point d'échec (ouverture ou `save()`). Capturer les deux
- Depuis la 1.48.0, `MutagenError` préserve `__cause__` : c'est ce qui permet de distinguer un fichier verrouillé (`PermissionError`, errno 13) d'une corruption réelle
- **Envelopper chaque fichier individuellement**, jamais le lot : un fichier en échec ne doit pas interrompre l'écriture des suivants
- Le motif de renommage vient après l'écriture, puisqu'il relit les tags fraîchement écrits : un échec d'écriture doit aussi annuler le renommage de ce fichier

---

# Bonnes Pratiques

## ✅ Recommandations

- **Écrire un test qui écrit une date, sauve en `v2_version=3`, relit et vérifie `TYER`** : le comportement a changé en cours de vie de mutagen
- **Appeler `clear_pictures()` avant `add_picture()`** sur FLAC, et vérifier le couple `(type, desc)` sur ID3
- **Vérifier `audio.tags is None` et appeler `add_tags()`** avant d'écrire sur WAV ou AIFF
- **Capturer `MutagenError` et `OSError` ensemble**, par fichier, et lire `__cause__` pour nommer la raison dans le rapport
- **Sérialiser le dump d'origine vers des types simples**, pas vers des objets frame
- **Maintenir la table ID3 ↔ Vorbis dans un seul module**, aucune correspondance officielle n'existant en amont

## ❌ Anti-Patterns

- **`save()` sans `v2_version=3`** : le fichier part en v2.4, mal lu par l'Explorateur Windows
- **Traiter `audio["TIT2"]` comme une chaîne** : c'est un objet frame dont le texte est une liste
- **Utiliser `EasyID3` pour tout** : sa table ne couvre ni les pochettes ni les champs maison
- **Manipuler `METADATA_BLOCK_PICTURE` à la main sur un FLAC** : `add_picture()` est l'API du conteneur
- **Envelopper le lot entier dans un seul `try`** : un fichier verrouillé annulerait l'écriture de tous les autres
- **Compter sur un correctif amont** pour un bug découvert : la cadence de release ne le permet pas
- **Écraser un champ existant avec une valeur nulle de la source** : un `bpm` absent chez Bandcamp ne doit pas effacer celui du fichier

---

# 🔗 Ressources

## Documentation Officielle

- [mutagen](https://mutagen.readthedocs.io/en/latest/)
- [Guide ID3](https://mutagen.readthedocs.io/en/latest/user/id3.html)
- [API ID3](https://mutagen.readthedocs.io/en/latest/api/id3.html)
- [FLAC](https://mutagen.readthedocs.io/en/latest/api/flac.html) · [WAVE](https://mutagen.readthedocs.io/en/latest/api/wave.html) · [AIFF](https://mutagen.readthedocs.io/en/latest/api/aiff.html)
- [Changelog](https://mutagen.readthedocs.io/en/latest/changelog.html)

## Ressources Complémentaires

- [ADR-010 — Écriture batch et plan de run](../adrs/010-ecriture-batch-et-plan-de-run.md)
- [ADR-011 — Politique d'écriture des tags](../adrs/011-politique-ecriture-tags.md)
- [Issue #188 — EasyID3 et ID3v2.3](https://github.com/quodlibet/mutagen/issues/188)
- [Issue #302 — pochettes front cover multiples](https://github.com/quodlibet/mutagen/issues/302)
