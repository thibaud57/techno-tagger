---
feature: "Feature 5 — Écriture des tags et renommage"
subproject: "contrat-detail-avant-apres"
goal: "Transporter jusqu'au store du run, pour chaque morceau, ses tags d'origine et les valeurs que l'écriture laissera dans le fichier, champ par champ"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["01-ecriture-tags-design.md", "02-dump-tags-origine-design.md"]
date: "2026-10-06"
---

# Contrat du détail avant / après

## Scope

Couvre la lecture des 16 champs de la table et du commentaire à l'ouverture du run, en une seule lecture par fichier dont l'identité de la requête est déduite. Couvre aussi le calcul des valeurs après écriture (valeur du candidat, sinon valeur d'origine gardée), les champs `tags_before` de `run_started` et `tags_after` de `track_resolved`, le dossier du run (`folder` de `run_started`), leur miroir TypeScript, et leur exposition par le store du run avec les fixtures.

Exclut le composant de la ligne dépliée, les libellés des champs et le rendu d'une valeur absente (sub-project 09), ainsi que la pochette en grand, déjà portée par `artwork_path`.

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer un test d'intégration où `run_started` porte les 16 champs d'origine du morceau avec leur clé et son commentaire, et où `track_resolved` porte les 16 valeurs après écriture, BPM d'origine gardé compris, ainsi qu'une spec du store qui les expose sur la ligne.

## Dependencies

- `01-ecriture-tags-design.md` (statut: draft) : `TagField`, `TAG_FIELDS`, `project_tags`, séparateur des valeurs multiples, commentaires supprimés à l'écriture
- `02-dump-tags-origine-design.md` (statut: draft) : `TagSystem`, `_id3_values` (URL de `WOAS`), lecture des champs de la table

## Files touched

- **À modifier** : `sidecar/src/tagger/files.py` (`ShownTags`, `read_shown_tags`, `read_identity` qui s'appuie dessus, `after_tags`, `shown_key`, `tag_system_of`)
- **À modifier** : `sidecar/src/tagger/tagging.py` (`TrackRecord.tags_before`, lecture des morceaux par `read_shown_tags`, `RunStarted.folder`)
- **À modifier** : `sidecar/src/tagger/protocol.py` (`TagValuePayload`, `TagsBeforePayload`, `TrackEntry.tags_before`, `TrackResolved.tags_after`, `RunStarted.folder`)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`_entry`, `_resolved`, `to_protocol_event`)
- **À créer** : `sidecar/tests/unit/test_files_shown.py` (lecture affichée et valeurs après écriture)
- **À modifier** : `sidecar/tests/unit/test_protocol_tagging.py` (non résolu sans Après, dossier du run)
- **À modifier** : `sidecar/tests/integration/test_ndjson_tagging.py` (avant et après champ par champ, dossier du run)
- **À modifier** : `src/app/core/models/protocol.ts` (`TagField`, `TagSystem`, `TagValue`, `TagsBefore`, `TrackEntry.tags_before`, `TrackResolvedEvent.tags_after`, `RunStartedEvent.folder`)
- **À modifier** : `src/app/core/tagging-run.store.ts` (`TaggingTrack.tagsBefore`, `tagsAfter`, `folder` du run)
- **À modifier** : `src/app/core/tagging-run.store.spec.ts` (exposition des champs et du dossier)
- **À modifier** : `src/app/core/sidecar.service.ts` (`taggingFolder`)
- **À modifier** : `src/fixtures/tagging.ts`, `src/fixtures/url-recovery.ts` et chaque fixture typée `TrackEntry`, `TrackResolvedEvent` ou `TaggingTrack` des specs Angular (nouveaux champs requis)
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : `run_started`, `track_resolved`)

## Architecture approach

- **Une lecture par fichier** : `read_shown_tags(path)` charge le fichier une fois (`_load`) et rend `ShownTags(system, fields, comment)`, les 16 champs joints par le séparateur des valeurs multiples (« , »), `None` pour un champ absent. `read_identity` en déduit artiste et titre, à l'identique (même jointure, même refus d'un conteneur hors des quatre formats), ce que ses tests existants gardent
- **Commentaire** : tous les `COMM` en ID3, `COMMENT` et `DESCRIPTION` en Vorbis, joints ; `None` sans commentaire. Seulement à l'affichage : le dump ne le garde pas (02)
- **Clé affichée** : celle que le fichier portera après écriture, `TAG_FIELDS` du système, sauf les deux dates d'un fichier ID3, écrites `TYER` et `TORY` en v2.3 (01). `shown_key(field, system)` la donne, la table restant dans `files.py` seul
- **Valeurs après écriture** : `after_tags(projection, before)`, à côté de `project_tags` : la valeur du candidat, sinon la valeur d'origine, que l'écriture ne touche pas (null non destructif, ADR-011). Ce que l'écran montre est ce que l'écriture laisse. Les clés s'y ajoutent à la traduction en événement, par `shown_key`
- **Tags illisibles à l'ouverture** : `tags_before` nul, `tags_after` réduit aux valeurs du candidat, système déduit de l'extension par `tag_system_of(path)` (`.flac` en Vorbis, le reste en ID3)
- **Ordre et clés côté sidecar** : 16 lignes dans l'ordre de `TAG_FIELDS`, chacune `{field, key, value}` ; l'interface n'a ni table ni règle de fusion à recopier (CLAUDE.md, tout le métier dans le sidecar)
- **Contrat** : `TrackEntry.tags_before: TagsBeforePayload | None` (`system`, `comment`, `fields`) et `TrackResolved.tags_after: tuple[TagValuePayload, ...] | None`, nul pour un non résolu. `after` (artiste et titre de la colonne Après) reste tel quel. Événements construits par le sidecar, ni `strict` ni `forbid` (ADR-022, `.claude/rules/pydantic/modeles.md`)
- **Le dump ne s'appuie pas sur cette lecture** : il relit le fichier juste avant l'écriture (ADR-010), le fichier ayant pu changer entre l'ouverture et la confirmation
- **Dossier du run** : `RunStarted` du pipeline et `run_started` portent `folder`, le dossier tel que `Path` le sérialise. Le store l'expose (`folder`, nul avant `run_started` et après `reset`) et le service le ré-expose en `taggingFolder` : la page Tagging (10) le compare au dossier choisi pour savoir si le run affiché est encore celui de ce dossier, sans rien décider
- **Miroir TypeScript** manuel (ADR-005, `.claude/rules/typescript/types.md`) ; le store recopie les deux champs sur `TaggingTrack` sans rien calculer (`.claude/rules/angular/signals.md`, `.claude/rules/angular/services.md`, `.claude/rules/angular/tests.md`)
- Autres rules : `.claude/rules/mutagen/tags.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/pattern-matching.md`, `.claude/rules/pytest/tests.md`

## Acceptance criteria

### Scénario 1 : avant et après d'un morceau résolu
**GIVEN** un MP3 tagué `adam beyer` / `your mind [FREE DL]`, BPM 130, commentaire `Ripped by X`, que Beatport résout par un candidat sans BPM
**WHEN** le run s'ouvre puis le morceau est résolu
**THEN** `run_started` porte `tags_before` en `id3` avec les 16 champs dans l'ordre de la table (artiste `adam beyer` sous `TPE1`, remixeur nul, BPM `130`) et le commentaire `Ripped by X`
**AND** `track_resolved` porte `tags_after` : artiste `Adam Beyer`, BPM `130` gardé, date sous la clé `TYER`
**AND** `run_started` porte aussi `folder`, le dossier du run

### Scénario 2 : morceau non résolu
**GIVEN** un morceau sans résultat sur les deux sources
**WHEN** il est tranché non résolu
**THEN** `track_resolved` porte `tags_after` nul, et son `tags_before` reste celui de `run_started`

### Scénario 3 : store
**GIVEN** un `run_started` puis un `track_resolved` portant avant et après
**WHEN** le store les reçoit
**THEN** la ligne du morceau expose `tagsBefore` dès le départ et `tagsAfter` une fois résolue

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_files_shown.py` :
  - un MP3 rend les 16 champs dans l'ordre de la table, joints, l'URL de `WOAS` et le commentaire
  - un FLAC rend les clés Vorbis et son `COMMENT`
  - un fichier sans tags rend 16 valeurs nulles et aucun commentaire
  - les dates d'un fichier ID3 portent `TYER` et `TORY`
  - après écriture : la valeur du candidat remplace l'origine, une valeur absente du candidat garde l'origine, sans origine la ligne reste nulle

### Integration
- `sidecar/tests/integration/test_ndjson_tagging.py` :
  - `run_started` porte `tags_before` et `folder`, `track_resolved` porte `tags_after` champ par champ

### Unit (Angular)
- `src/app/core/tagging-run.store.spec.ts` :
  - la ligne expose `tagsBefore` à `run_started`, `tagsAfter` à `track_resolved`
  - le store garde le dossier du run jusqu'au `reset`

## Edge cases

- **Tags illisibles à l'ouverture** (fichier verrouillé) : `tags_before` nul ; `tags_after` réduit au candidat, le fichier pouvant être lisible à la confirmation
- **Valeurs multiples d'un v2.4** (deux `TPE1`) : jointes en `A, B`, comme la colonne Avant de la liste
- **Date complète d'un v2.3** (`TYER` + `TDAT`) : relue par mutagen en `2023-06-16` côté avant, `2023` côté après
- **Commentaires techniques** (`iTunNORM` et autres `COMM` à description) : montrés aussi, l'écriture les supprime tous
- **Valeur absente** : jamais rien d'écrit dans le fichier ; à l'écran, la convention de DESIGN.md § Sans valeur, appliquée par le sub-project 09

## Architectural decisions

### Décision : valeur après écriture d'un champ que le candidat ne fournit pas
**Options envisagées :**
- **A. La valeur gardée** : Après montre ce que le fichier contiendra, BPM d'origine compris
- **B. Rien** : Après ne montre que l'apport de la source, au risque de lire un champ vidé
**Choix : A**
**Rationale :**
- Choix du propriétaire : l'écran montre exactement ce que l'écriture laisse

### Décision : commentaire dans le détail
**Options envisagées :**
- **A. Ligne Commentaire quand le fichier en porte un**, Après toujours vide
- **B. Les 16 champs seulement**, suppression implicite
**Choix : A**
**Rationale :**
- Choix du propriétaire : rien n'est supprimé sans avoir été vu, d'autant que le dump ne garde pas les commentaires

### Décision : lignes du détail et écarts à la maquette
**Options envisagées :**
- **A. Les 16 champs écrits** : pas de ligne « Artiste de la sortie » (`TPE2`, non écrit), date à l'année, source, identifiant et URL sur trois lignes, remixeur, année d'origine et numéro de piste en plus
- **B. Les 12 lignes de `TrackDetail`** de la maquette
**Choix : A**
**Rationale :**
- Le détail montre ce que l'écriture fait, et la table des champs écrits est tranchée au sub-project 01 ; une ligne `TPE2` ou une date complète annonceraient une écriture qui n'a pas lieu
