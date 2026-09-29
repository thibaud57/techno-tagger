---
paths:
  - "sidecar/src/tagger/files.py"
---

# mutagen — Écriture des tags

## À faire
- Maintenir la table de correspondance ID3 ↔ Vorbis dans un seul module : aucune table officielle unifiée n'existe en amont, ID3 et Vorbis Comments ne sont pas deux dialectes du même modèle
- Sauver en `save(v2_version=3)` : mutagen vise v2.4 par défaut, mal lu par l'Explorateur Windows
- Lire le texte d'une frame ID3 par `.text` (une liste), et toute valeur Vorbis comme une liste même pour un champ unique
- `clear_pictures()` avant `add_picture()` sur FLAC, sans quoi un re-run empile les pochettes ; sur ID3, l'unicité d'une `APIC` tient au couple `(type, desc)`
- `audio.add_tags()` quand `audio.tags is None` : c'est le cas d'un WAV ou d'un AIFF sans chunk ID3, sinon l'indexation lève `TypeError`
- Sérialiser le dump des tags d'origine vers des types simples avant toute écriture (rollback du plan de run, cf. [ADR-010](../../../docs/adrs/010-ecriture-batch-et-plan-de-run.md))
- Capturer `MutagenError` et `OSError` ensemble, fichier par fichier, et lire `__cause__` pour distinguer un `PermissionError` (fichier verrouillé par un lecteur) d'une corruption réelle
- Annuler le renommage d'un fichier dont l'écriture a échoué : le motif de renommage relit les tags fraîchement écrits

## À éviter
- `save()` sans `v2_version=3`
- Traiter `audio["TIT2"]` comme une chaîne : c'est un objet frame
- Utiliser `EasyID3` pour tout : sa table ne couvre ni les pochettes ni les champs maison
- Manipuler `METADATA_BLOCK_PICTURE` à la main sur un FLAC natif : `add_picture()` est l'API du conteneur
- Envelopper le lot entier dans un seul `try` : un fichier verrouillé annulerait l'écriture de tous les autres
- Écraser un champ existant avec une valeur nulle de la source : un `bpm` absent chez Bandcamp ne doit pas effacer celui du fichier
- `deepcopy` des objets frame pour le dump : certains ne se copient pas proprement selon la version

## Gotchas
- La conversion v2.4 → v2.3 n'est pas neutre : UTF-8 repasse en UTF-16, les valeurs multiples sont jointes par `v23_sep` (à choisir explicitement), `TDRC` est éclaté en `TYER` + `TDAT` + `TIME`
- `EasyID3` avec `v2_version=3` peut produire une frame `TDRC` vide en plus du `TYER` : asserter sur le fichier relu, pas sur le retour de l'API
- 1.48.0 : l'attribut `salt` d'`APIC` change la `HashKey` en `APIC:<desc><salt>`, donc l'unicité
- WAV : seul le chunk ID3v2 est supporté (pas RIFF/INFO), écrit `id3 ` en minuscules que d'autres logiciels peuvent ignorer
- `mutagen.File()` rend `None` sur un format non reconnu, il ne lève pas : le cas se traite

## Exemples
```python
# ✅ ID3 : objets frame, sauvegarde en v2.3
tags = ID3(path)
tags["TIT2"] = TIT2(encoding=3, text=[title])
tags.add(APIC(encoding=3, mime="image/jpeg", type=PictureType.COVER_FRONT, desc="Cover", data=image))
tags.save(v2_version=3)

# ✅ FLAC : purge avant ajout, sinon accumulation
audio.clear_pictures()
audio.add_picture(picture)

# ✅ un échec par fichier, jamais par lot
try:
    audio.save(v2_version=3)
except (MutagenError, OSError) as exc:
    cause = getattr(exc, "__cause__", None) or exc
    plan.mark_failed(track, "file_locked" if isinstance(cause, PermissionError) else "write_error")

# ❌ le texte d'une frame pris pour une chaîne
title = tags["TIT2"]
```
