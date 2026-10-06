# Contrat du détail avant / après : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transporter jusqu'au store du run, pour chaque morceau, ses tags d'origine et les valeurs que l'écriture laissera dans le fichier, champ par champ.

**Architecture:** `files.py` lit en une fois les 16 champs affichables et le commentaire (`read_shown_tags`), dont `read_identity` déduit la requête, et calcule les valeurs après écriture (`after_tags`) et la clé affichée (`shown_key`). Le pipeline garde ces tags sur `TrackRecord.tags_before`. `handlers.py` les traduit en lignes `{field, key, value}` dans `run_started` et `track_resolved`, mirrorées en TypeScript et recopiées par le store. `run_started` porte aussi `folder`, le dossier du run, que la page Tagging compare à celui qu'elle montre.

**Tech Stack:** Python 3.14, mutagen 1.48, pydantic 2, pytest ; Angular 22 et Vitest pour le store. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/07-contrat-detail-avant-apres-design.md`

## Global Constraints

- **Dépend des sub-projects 01 et 02, implémentés avant** : `TagField`, `TAG_FIELDS`, `TagSystem`, `project_tags`, `TagValues`, `_load`, `_id3_values`, `_join`, `_MULTI_VALUE_SEPARATOR` (`", "`), `_ID3_COMMENT` (`"COMM"`), `_VORBIS_COMMENTS` (`("COMMENT", "DESCRIPTION")`).
- **16 lignes dans l'ordre de `TAG_FIELDS`**, `value` nulle quand le champ est absent ; jamais rien d'écrit dans le fichier pour une valeur absente.
- **Après écriture** : valeur du candidat, sinon valeur d'origine gardée ; sans origine lisible, valeur du candidat seule.
- **Clé affichée** : celle que le fichier porte après écriture, `TYER` et `TORY` pour les dates d'un fichier ID3.
- **`read_identity` inchangée en comportement** : `tests/unit/test_files_identity.py` passe sans modification.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides.
- **Gate vert à chaque commit** : `just format-sidecar`, `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`, plus `just format-ui`, `just lint-ui`, `just typecheck-ui` et `just test-ui` quand `src/` change. Commits `type(scope): description`, scope `sidecar` ou `ui`.

## Review Focus

- **Fichier sans aucun tag** (rip brut) : 16 valeurs nulles, aucun commentaire, et la requête retombe sur le nom de fichier comme avant (Task 1, `test_reads_a_file_without_tags_as_empty` ; `test_files_identity.py` inchangé).
- **Plusieurs `TPE1` d'un v2.4** : `Adam Beyer, Bart Skils`, la même chaîne que la colonne Avant de la liste (Task 1, `test_reads_every_field_of_the_table_in_order_with_its_comment`).
- **Champ que le candidat ne fournit pas** (BPM absent de Bandcamp) : la valeur d'origine reste en Après (Task 1, `test_keeps_the_original_value_the_candidate_leaves_out` ; Task 2, test d'intégration).
- **Date d'un MP3** : la clé affichée est `TYER`, celle que le fichier v2.3 portera, pas `TDRC` (Task 1, `test_names_a_field_by_the_key_the_written_file_carries`).
- **Morceau non résolu** : `tags_after` nul, sa ligne garde l'Avant (Task 2, `test_carries_no_tags_after_for_an_unresolved_track`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/files.py` | `ShownTags`, `read_shown_tags`, `read_identity` déduite, `shown_key`, `after_tags`, `tag_system_of`. |
| `sidecar/src/tagger/tagging.py` | `TrackRecord.tags_before`, lecture des morceaux par `read_shown_tags`, `RunStarted.folder`. |
| `sidecar/src/tagger/protocol.py` | `TagValuePayload`, `TagsBeforePayload`, `TrackEntry.tags_before`, `TrackResolved.tags_after`, `RunStarted.folder`. |
| `sidecar/src/tagger/handlers.py` | Traduction en lignes `{field, key, value}`, dossier du run. |
| `sidecar/tests/unit/test_files_shown.py` | Lecture affichée, clés, valeurs après écriture. |
| `sidecar/tests/unit/test_protocol_tagging.py` | Non résolu sans Après, dossier du run. |
| `sidecar/tests/integration/test_ndjson_tagging.py` | Avant et après de bout en bout, dossier du run. |
| `src/app/core/models/protocol.ts` | Miroir. |
| `src/app/core/tagging-run.store.ts`, `.spec.ts` | `tagsBefore`, `tagsAfter` sur la ligne, `folder` du run. |
| `src/app/core/sidecar.service.ts` | `taggingFolder`. |
| `src/fixtures/tagging.ts`, `src/fixtures/url-recovery.ts`, `src/app/core/sidecar.service.spec.ts` | Fixtures complétées. |
| `docs/ARCHITECTURE.md` | § API. |

---

### Task 1: Lire les tags affichés et calculer l'après

**Files:**
- Modify: `sidecar/src/tagger/files.py` (après `OriginalTags`, `read_identity`, après `project_tags`, helpers `_id3_text` / `_vorbis_text`, constante `IDENTITY_FIELDS`)
- Create: `sidecar/tests/unit/test_files_shown.py`

**Interfaces:**
- Consumes: `TAG_FIELDS`, `TagField`, `TagSystem`, `TagValues`, `IdentityTags`, `_load(path) -> tuple[object, object]`, `_id3_values(tags, frame_id) -> tuple[str, ...]`, `_join(values) -> str`, `_ID3_COMMENT`, `_VORBIS_COMMENTS`, `TagsUnreadableError`, `UnreadableReason`.
- Produces: `files.ShownTags(system: TagSystem, fields: Mapping[TagField, str | None], comment: str | None)` et sa propriété `identity -> IdentityTags` ; `files.read_shown_tags(path: Path) -> ShownTags` (lève `TagsUnreadableError` comme `read_identity`) ; `files.shown_key(field: TagField, system: TagSystem) -> str` ; `files.after_tags(projection: TagValues, before: ShownTags | None) -> Mapping[TagField, str | None]` ; `files.tag_system_of(path: Path) -> TagSystem`.

- [ ] **Step 1: Écrire les tests**

Créer `sidecar/tests/unit/test_files_shown.py` :

```python
"""Tests de la lecture des tags pour l'ecran et des valeurs que l'ecriture laissera."""

from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING

import mutagen
import pytest
from mutagen.id3 import COMM, ID3, TBPM, TIT2, TPE1, WOAS

from tagger.files import (
    TAG_FIELDS,
    ShownTags,
    TagField,
    TagSystem,
    after_tags,
    read_shown_tags,
    shown_key,
    tag_system_of,
)

if TYPE_CHECKING:
    from collections.abc import Callable

URL = "https://adambeyer.bandcamp.com/track/your-mind"


def _shown(**values: str) -> ShownTags:
    fields: dict[TagField, str | None] = dict.fromkeys(TAG_FIELDS)
    fields.update({TagField(name): value for name, value in values.items()})
    return ShownTags(TagSystem.ID3, MappingProxyType(fields), None)


def test_reads_every_field_of_the_table_in_order_with_its_comment(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    tags = ID3()
    tags.add(TPE1(encoding=3, text=["Adam Beyer", "Bart Skils"]))
    tags.add(TIT2(encoding=3, text=["Your Mind"]))
    tags.add(TBPM(encoding=3, text=["130"]))
    tags.add(WOAS(url=URL))
    tags.add(COMM(encoding=3, lang="eng", desc="", text=["Ripped by X"]))
    tags.save(path)

    shown = read_shown_tags(path)

    assert shown.system is TagSystem.ID3
    assert list(shown.fields) == list(TAG_FIELDS)
    assert shown.fields[TagField.ARTIST] == "Adam Beyer, Bart Skils"
    assert (shown.fields[TagField.BPM], shown.fields[TagField.URL]) == ("130", URL)
    assert shown.fields[TagField.ALBUM] is None
    assert shown.comment == "Ripped by X"
    assert (shown.identity.artist, shown.identity.title) == ("Adam Beyer, Bart Skils", "Your Mind")


def test_reads_the_vorbis_comments_of_a_flac(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    audio = mutagen.File(path)
    audio["ARTIST"] = ["Adam Beyer"]
    audio["COMMENT"] = ["Ripped by X"]
    audio.save()

    shown = read_shown_tags(path)

    assert (shown.system, shown.fields[TagField.ARTIST], shown.comment) == (
        TagSystem.VORBIS,
        "Adam Beyer",
        "Ripped by X",
    )


def test_reads_a_file_without_tags_as_empty(blank_audio: Callable[[str], Path]) -> None:
    shown = read_shown_tags(blank_audio("wav"))

    assert set(shown.fields.values()) == {None}
    assert shown.comment is None


@pytest.mark.parametrize(
    ("field", "system", "expected"),
    [
        (TagField.DATE, TagSystem.ID3, "TYER"),
        (TagField.ORIGINAL_DATE, TagSystem.ID3, "TORY"),
        (TagField.CATALOG_NUMBER, TagSystem.ID3, "TXXX:CATALOGNUMBER"),
        (TagField.DATE, TagSystem.VORBIS, "DATE"),
    ],
    ids=["id3-date", "id3-original-date", "id3-txxx", "vorbis-date"],
)
def test_names_a_field_by_the_key_the_written_file_carries(
    field: TagField, system: TagSystem, expected: str
) -> None:
    key = shown_key(field, system)

    assert key == expected


def test_keeps_the_original_value_the_candidate_leaves_out() -> None:
    before = _shown(artist="adam beyer", bpm="130")

    after = after_tags({TagField.ARTIST: "Adam Beyer"}, before)

    assert list(after) == list(TAG_FIELDS)
    assert (after[TagField.ARTIST], after[TagField.BPM], after[TagField.KEY]) == (
        "Adam Beyer",
        "130",
        None,
    )


def test_shows_only_the_candidate_without_original_tags() -> None:
    after = after_tags({TagField.ARTIST: "Adam Beyer"}, None)

    assert (after[TagField.ARTIST], after[TagField.BPM]) == ("Adam Beyer", None)


@pytest.mark.parametrize(
    ("name", "expected"),
    [("track.flac", TagSystem.VORBIS), ("track.FLAC", TagSystem.VORBIS), ("track.aiff", TagSystem.ID3)],
    ids=["flac", "uppercase-flac", "aiff"],
)
def test_tells_the_tag_system_from_the_extension(name: str, expected: TagSystem) -> None:
    system = tag_system_of(Path(name))

    assert system is expected
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_shown.py --no-cov -q`
Expected: FAIL à la collecte, `ImportError: cannot import name 'ShownTags'`

- [ ] **Step 3: Lire les tags affichés**

Dans `sidecar/src/tagger/files.py`, supprimer `IDENTITY_FIELDS`, `_id3_text` et `_vorbis_text`, qui ne servaient qu'à `read_identity`. Après `_ID3_V24`, ajouter :

```python
# L'ecriture passe en v2.3 : les dates y portent ces cles, pas TDRC.
_ID3_V23_KEYS: Final = {TagField.DATE: "TYER", TagField.ORIGINAL_DATE: "TORY"}
```

Après `OriginalTags` :

```python
@dataclass(frozen=True, slots=True)
class ShownTags:
    """Champs affiches, `None` quand absents. Le dump relit le fichier lui-meme (ADR-010)."""

    system: TagSystem
    fields: Mapping[TagField, str | None]
    comment: str | None

    @property
    def identity(self) -> IdentityTags:
        """Artiste et titre de la requete, la meme jointure que la colonne Avant."""
        return IdentityTags(
            artist=self.fields[TagField.ARTIST] or "", title=self.fields[TagField.TITLE] or ""
        )
```

`read_identity` devient :

```python
def read_identity(path: Path) -> IdentityTags:
    """Artiste et titre du fichier, sans jamais l'ecrire."""
    return read_shown_tags(path).identity
```

et, juste après :

```python
def read_shown_tags(path: Path) -> ShownTags:
    """Les 16 champs et le commentaire en une lecture, dont `read_identity` tire la requete.

    La colonne suit le conteneur retenu par mutagen, pas l'extension : a score egal
    `mutagen.File()` departage par nom de classe, un FLAC renomme `.mp3` ressort `unreadable`.
    """
    audio, tags = _load(path)
    match tags:
        case ID3() as id3:
            fields = {
                field: _shown_value(_id3_values(id3, keys.id3)) if keys.id3 in id3 else None
                for field, keys in TAG_FIELDS.items()
            }
            notes = [text for frame in id3.getall(_ID3_COMMENT) for text in frame.text]
            return ShownTags(TagSystem.ID3, MappingProxyType(fields), _shown_value(notes))
        case VCFLACDict() as comments:
            fields = {
                field: _shown_value(comments[keys.vorbis]) if keys.vorbis in comments else None
                for field, keys in TAG_FIELDS.items()
            }
            notes = [text for key in _VORBIS_COMMENTS if key in comments for text in comments[key]]
            return ShownTags(TagSystem.VORBIS, MappingProxyType(fields), _shown_value(notes))
        case None:
            system = TagSystem.VORBIS if isinstance(audio, FLAC) else TagSystem.ID3
            return ShownTags(system, MappingProxyType(dict.fromkeys(TAG_FIELDS)), None)
        case _:
            # Conteneur hors des quatre formats (un WavPack sous `.wav`) : le prendre pour un
            # fichier sans tags masquerait l'echec que le pipeline doit loguer.
            raise TagsUnreadableError(path, UnreadableReason.UNREADABLE)


def _shown_value(values: Iterable[object]) -> str | None:
    return _join(values) or None
```

- [ ] **Step 4: Clé affichée, valeurs après écriture, système d'un fichier illisible**

Après `project_tags` :

```python
def after_tags(projection: TagValues, before: ShownTags | None) -> Mapping[TagField, str | None]:
    """Valeur du candidat, sinon celle d'origine : un champ absent n'efface rien (ADR-011)."""
    return MappingProxyType(
        {
            field: projection.get(field) or (None if before is None else before.fields[field])
            for field in TAG_FIELDS
        }
    )


def shown_key(field: TagField, system: TagSystem) -> str:
    """Cle du champ dans le fichier ecrit, celle que l'ecran affiche."""
    keys = TAG_FIELDS[field]
    if system is TagSystem.VORBIS:
        return keys.vorbis
    return _ID3_V23_KEYS.get(field, keys.id3)


def tag_system_of(path: Path) -> TagSystem:
    """Systeme d'un fichier dont les tags n'ont pas pu etre lus, deduit de l'extension."""
    return TagSystem.VORBIS if path.suffix.lower() == ".flac" else TagSystem.ID3
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_shown.py tests/unit/test_files_identity.py --no-cov -q`
Expected: PASS, `test_files_identity.py` sans aucune modification

- [ ] **Step 6: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout passe.

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/files.py sidecar/tests/unit/test_files_shown.py
git commit -m "feat(sidecar): lire les tags affichés et calculer ce que l'écriture laissera"
```

---

### Task 2: Avant et après dans le flux du run, jusqu'au store

**Files:**
- Modify: `sidecar/src/tagger/tagging.py` (`TrackRecord`, `RunStarted`, `open_run`, `_read_identities`)
- Modify: `sidecar/src/tagger/protocol.py` (avant `TrackEntry`, `TrackEntry`, `RunStarted`, `TrackResolved`)
- Modify: `sidecar/src/tagger/handlers.py` (`_entry`, `_resolved`, `to_protocol_event`)
- Modify: `sidecar/tests/unit/test_protocol_tagging.py`
- Modify: `sidecar/tests/integration/test_ndjson_tagging.py`
- Modify: `src/app/core/models/protocol.ts:170-208`
- Modify: `src/app/core/tagging-run.store.ts`
- Modify: `src/app/core/tagging-run.store.spec.ts`
- Modify: `src/app/core/sidecar.service.ts`
- Modify: `src/fixtures/tagging.ts`, `src/fixtures/url-recovery.ts`
- Modify: `src/app/core/sidecar.service.spec.ts:856-875`

**Interfaces:**
- Consumes: Task 1 (`ShownTags`, `read_shown_tags`, `after_tags`, `shown_key`, `tag_system_of`) ; `files.project_tags`.
- Produces: `TrackRecord.tags_before: ShownTags | None = None` ; `protocol.TagValuePayload(field: TagField, key: str, value: str | None)`, `protocol.TagsBeforePayload(system: TagSystem, comment: str | None, fields: tuple[TagValuePayload, ...])`, `TrackEntry.tags_before: TagsBeforePayload | None`, `TrackResolved.tags_after: tuple[TagValuePayload, ...] | None`, `folder: Path` sur `tagging.RunStarted` et sur `protocol.RunStarted` ; côté TS `TagField`, `TagSystem`, `TagValue`, `TagsBefore`, `TrackEntry.tags_before`, `TrackResolvedEvent.tags_after`, `TaggingTrack.tagsBefore`, `TaggingTrack.tagsAfter`, `RunStartedEvent.folder`, `TaggingRunStore.folder`, `SidecarService.taggingFolder`, fixtures `TAGS_BEFORE`, `TAGS_AFTER`.

- [ ] **Step 1: Écrire les tests sidecar**

Dans `sidecar/tests/integration/test_ndjson_tagging.py`, ajouter `from mutagen.id3 import COMM, ID3, TBPM`, `track_payload` à l'import de `scraper_responses` et `from tagger.files import TAG_FIELDS`, puis :

```python
@pytest.mark.usefixtures("_key")
def test_carries_the_tags_before_and_after_field_by_field(
    run_folder: Path, api: FakeApi
) -> None:
    without_bpm = track_payload(mix_name="Original Mix", bpm=None)
    api.on("/beatport/search", YOUR_MIND, found(without_bpm))
    api.on(ORIGINAL_REFETCH, "*", found(without_bpm))
    tags = ID3(run_folder / "a.mp3")
    tags.add(TBPM(encoding=3, text=["130"]))
    tags.add(COMM(encoding=3, lang="eng", desc="", text=["Ripped by X"]))
    tags.save()

    events = drive(start_tagging(run_folder))

    assert events[0]["folder"] == str(run_folder)
    tracks = events[0]["tracks"]
    assert isinstance(tracks, list)
    before = tracks[0]["tags_before"]
    assert (before["system"], before["comment"]) == ("id3", "Ripped by X")
    assert [row["field"] for row in before["fields"]] == [field.value for field in TAG_FIELDS]
    assert before["fields"][0] == {"field": "artist", "key": "TPE1", "value": "Adam Beyer"}
    assert {"field": "bpm", "key": "TBPM", "value": "130"} in before["fields"]
    resolved = next(
        event
        for event in events
        if event["event"] == "track_resolved" and event["track_id"] == "a.mp3"
    )
    after = resolved["tags_after"]
    assert isinstance(after, list)
    assert {"field": "title", "key": "TIT2", "value": "Your Mind (Original Mix)"} in after
    assert {"field": "bpm", "key": "TBPM", "value": "130"} in after
    assert {"field": "date", "key": "TYER", "value": "2023"} in after
```

Dans `sidecar/tests/unit/test_protocol_tagging.py`, ajouter `from pathlib import Path` aux imports : `test_lists_every_track_of_a_started_run` passe le dossier que `tagging.RunStarted` porte et le vérifie.

```python
def test_lists_every_track_of_a_started_run() -> None:
    event = to_protocol_event(tagging.RunStarted("a3f9c1", Path("D:/Sets"), (_record(),)))

    assert isinstance(event, RunStarted)
    assert event.folder == Path("D:/Sets")
    assert event.tracks[0].track_id == "a.mp3"
    assert event.tracks[0].artist == "Adam Beyer"
```

Puis, après `test_renders_the_artist_and_the_title_a_source_will_write` :

```python
def test_carries_no_tags_after_for_an_unresolved_track() -> None:
    record = _record(state=TrackState.UNRESOLVED, resolution=Resolution.NONE)

    event = to_protocol_event(tagging.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.tags_after is None
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_tagging.py tests/unit/test_protocol_tagging.py --no-cov -q`
Expected: FAIL, `KeyError: 'tags_before'`, `AttributeError: 'TrackResolved' object has no attribute 'tags_after'` et `TypeError` à la construction de `tagging.RunStarted` avec le dossier

- [ ] **Step 3: Garder les tags d'origine sur le morceau**

Dans `sidecar/src/tagger/tagging.py`, l'import de `tagger.files` remplace `read_identity`, qui n'y sert plus, par `ShownTags` et `read_shown_tags` (`IdentityTags` reste importé). `TrackRecord` gagne, après `written` :

```python
    # Pour l'affichage seul, `None` si illisibles : le dump relit le fichier.
    tags_before: ShownTags | None = None
```

Dans `_read_identities`, la lecture devient `asyncio.to_thread(read_shown_tags, path)`, et le `match` :

```python
        match read:
            case ShownTags():
                identity, tags_before = read.identity, read
            case TagsUnreadableError():
                logger.warning(
                    "tags unreadable, file name used run=%s track=%d reason=%s",
                    run_id,
                    position,
                    read.reason,
                )
                identity, tags_before = IdentityTags(artist="", title=""), None
            case _:
                raise read
        track_id = path.relative_to(folder).as_posix()
        records.append(
            TrackRecord(track_id=track_id, path=path, identity=identity, tags_before=tags_before)
        )
```

`RunStarted` porte le dossier du run, que l'interface compare à celui qu'elle montre (sub-project 10) :

```python
@dataclass(frozen=True, slots=True)
class RunStarted:
    """Tous les morceaux du run avec leur identite lue, avant le premier appel reseau."""

    run_id: str
    folder: Path
    tracks: tuple[TrackRecord, ...]
```

et `open_run` émet `RunStarted(run_id, folder, tuple(records))`.

- [ ] **Step 4: Déclarer le contrat**

Dans `sidecar/src/tagger/protocol.py`, ajouter `from tagger.files import TagField, TagSystem` aux imports, puis avant `TrackEntry` :

```python
class TagValuePayload(BaseModel):
    """Une ligne du detail, `value` nulle si le champ est absent."""

    model_config = ConfigDict(frozen=True)

    field: TagField
    key: str
    value: str | None


class TagsBeforePayload(BaseModel):
    """Tags d'origine lus a l'ouverture, dans l'ordre de la table."""

    model_config = ConfigDict(frozen=True)

    system: TagSystem
    comment: str | None
    fields: tuple[TagValuePayload, ...]
```

`TrackEntry` gagne `tags_before: TagsBeforePayload | None` après `title`, et `TrackResolved` gagne, après `artwork_path` :

```python
    # Nul pour un non resolu.
    tags_after: tuple[TagValuePayload, ...] | None = None
```

`RunStarted` gagne `folder: Path` après `run_id` : le dossier du run, que l'interface compare à celui qu'elle montre (sub-project 10).

- [ ] **Step 5: Traduire en lignes**

Dans `sidecar/src/tagger/handlers.py`, ajouter `TagsBeforePayload` et `TagValuePayload` à l'import de `tagger.protocol`, `from tagger.files import after_tags, project_tags, shown_key, tag_system_of` aux imports, et sous `TYPE_CHECKING` `from collections.abc import Callable, Mapping` ainsi que `from tagger.files import ShownTags, TagField, TagSystem`. `_entry` devient :

```python
def _entry(record: TrackRecord) -> TrackEntry:
    before = record.tags_before
    return TrackEntry(
        track_id=record.track_id,
        file_name=record.file_name,
        artist=record.identity.artist,
        title=record.identity.title,
        tags_before=None if before is None else _tags_before(before),
    )


def _tags_before(shown: ShownTags) -> TagsBeforePayload:
    return TagsBeforePayload(
        system=shown.system, comment=shown.comment, fields=_rows(shown.fields, shown.system)
    )


def _tags_after(record: TrackRecord, candidate: TrackCandidate) -> tuple[TagValuePayload, ...]:
    """Sans origine lisible, le systeme se deduit de l'extension."""
    before = record.tags_before
    system = tag_system_of(record.path) if before is None else before.system
    return _rows(after_tags(project_tags(candidate), before), system)


def _rows(
    values: Mapping[TagField, str | None], system: TagSystem
) -> tuple[TagValuePayload, ...]:
    return tuple(
        TagValuePayload(field=field, key=shown_key(field, system), value=value)
        for field, value in values.items()
    )
```

Dans `_resolved`, après `artwork_path=record.artwork,` :

```python
        tags_after=None if candidate is None else _tags_after(record, candidate),
```

Dans `to_protocol_event`, le cas `tagging.RunStarted()` ajoute `folder=event.folder,` après `run_id=event.run_id,`.

- [ ] **Step 6: Vérifier que les tests sidecar passent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_tagging.py tests/unit/test_protocol_tagging.py tests/unit/test_files_identity.py --no-cov -q`
Expected: PASS

- [ ] **Step 7: Mirrorer le contrat**

Dans `src/app/core/models/protocol.ts`, avant `TrackEntry` :

```ts
/** Champs de la table des tags ecrits (ADR-011). */
export type TagField =
  | "artist"
  | "remixer"
  | "title"
  | "album"
  | "date"
  | "original_date"
  | "genre"
  | "label"
  | "catalog_number"
  | "bpm"
  | "key"
  | "isrc"
  | "track_number"
  | "url"
  | "source_id"
  | "source"

export type TagSystem = "id3" | "vorbis"

/** Une ligne du detail : `key` est celle du fichier ecrit, `value` nulle si absente. */
export interface TagValue {
  readonly field: TagField
  readonly key: string
  readonly value: string | null
}

/** Tags d'origine, nuls quand le fichier etait illisible a l'ouverture du run. */
export interface TagsBefore {
  readonly system: TagSystem
  readonly comment: string | null
  readonly fields: readonly TagValue[]
}
```

`TrackEntry` gagne `readonly tags_before: TagsBefore | null` après `title`. `TrackResolvedEvent` gagne après `artwork_path` :

```ts
  /** Nul pour un non resolu. */
  readonly tags_after: readonly TagValue[] | null
```

`RunStartedEvent` gagne `readonly folder: string` après `run_id`, avec le commentaire `/** Dossier du run tel que le sidecar le lit. */`.

- [ ] **Step 8: Exposer avant, après et dossier du run dans le store**

Dans `src/app/core/tagging-run.store.ts`, importer `TagValue` et `TagsBefore`. `TaggingTrack` gagne, après `artworkPath` :

```ts
  readonly tagsBefore: TagsBefore | null
  readonly tagsAfter: readonly TagValue[] | null
```

`pending` recopie `tagsBefore: entry.tags_before` et pose `tagsAfter: null` ; `resolved` ajoute `tagsAfter: event.tags_after`.

Le store garde aussi le dossier du run :

```ts
  private readonly _folder = signal<string | null>(null)
```

```ts
  /** Nul jusqu'a `run_started`. */
  readonly folder = this._folder.asReadonly()
```

`started` pose `this._folder.set(event.folder)` et `reset()` `this._folder.set(null)`. Dans `src/app/core/sidecar.service.ts`, après `taggingRunId` : `readonly taggingFolder = this.taggingRun.folder`.

- [ ] **Step 9: Compléter les fixtures**

Dans `src/fixtures/tagging.ts`, importer `TagValue` et `TagsBefore`, puis :

```ts
export const TAGS_BEFORE: TagsBefore = {
  system: "id3",
  comment: "Ripped by X",
  fields: [
    { field: "artist", key: "TPE1", value: "adam beyer" },
    { field: "bpm", key: "TBPM", value: "130" },
  ],
}

export const TAGS_AFTER: readonly TagValue[] = [
  { field: "artist", key: "TPE1", value: "Adam Beyer" },
  { field: "bpm", key: "TBPM", value: "130" },
]
```

`RUN_STARTED` gagne `folder: "C:/Sets"` et ses deux morceaux `tags_before: null`, `TRACK_RESOLVED` gagne `tags_after: null`, `PENDING_TRACK` gagne `tagsBefore: null, tagsAfter: null`. Dans `src/fixtures/url-recovery.ts`, `resolvedByUrl` gagne `tags_after: null`. Dans `src/app/core/sidecar.service.spec.ts`, les deux morceaux `c.mp3` et `d.mp3` gagnent `tags_before: null`.

- [ ] **Step 10: Écrire la spec du store**

Dans `src/app/core/tagging-run.store.spec.ts`, importer `TAGS_AFTER` et `TAGS_BEFORE` des fixtures, puis après le test « updates a track with its state, source, names, scores and artwork » :

```ts
  it("exposes the tags before from the start and the tags after once resolved", () => {
    store.reset()
    store.started({
      ...RUN_STARTED,
      tracks: [
        {
          track_id: "a.mp3",
          file_name: "a.mp3",
          artist: "Adam Beyer",
          title: "Your Mind",
          tags_before: TAGS_BEFORE,
        },
      ],
    })
    const started = store.tracks()[0]

    store.resolved({ ...TRACK_RESOLVED, tags_after: TAGS_AFTER })

    expect(started?.tagsBefore).toEqual(TAGS_BEFORE)
    expect(started?.tagsAfter).toBeNull()
    expect(store.tracks()[0]?.tagsAfter).toEqual(TAGS_AFTER)
  })

  it("keeps the folder of the run from its start and forgets it on reset", () => {
    store.reset()
    store.started(RUN_STARTED)
    const started = store.folder()

    store.reset()

    expect(started).toBe("C:/Sets")
    expect(store.folder()).toBeNull()
  })
```

- [ ] **Step 11: Vérifier que tout passe**

Run: `just typecheck-ui && just test-ui`
Expected: PASS

- [ ] **Step 12: Lancer le gate**

Run: `just format-ui && just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe.

- [ ] **Step 13: Commit**

```bash
git add sidecar/src/tagger/tagging.py sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/tests/unit/test_protocol_tagging.py sidecar/tests/integration/test_ndjson_tagging.py src/app/core/models/protocol.ts src/app/core/tagging-run.store.ts src/app/core/tagging-run.store.spec.ts src/app/core/sidecar.service.ts src/fixtures/tagging.ts src/fixtures/url-recovery.ts src/app/core/sidecar.service.spec.ts
git commit -m "feat(sidecar): tags avant et après de chaque morceau dans le flux du run"
```

---

### Task 3: Contrat du détail dans l'architecture

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ API, lignes `run_started` et `track_resolved` du tableau des événements)

- [ ] **Step 1: Documenter le contrat livré**

Charger `Skill[architecture-doc]` avant d'éditer. Dans `docs/ARCHITECTURE.md` § API :
- `run_started` : ajouter « le dossier du run (`folder`), que l'interface compare à celui qu'elle montre, et, par morceau, `tags_before` : système de tags, commentaire et les 16 champs de la table dans son ordre, chacun avec la clé du fichier écrit (`TYER` et `TORY` pour les dates ID3) et sa valeur, nulle si absente ; nul si les tags étaient illisibles » ;
- `track_resolved` : ajouter « `tags_after` : les 16 valeurs que le fichier contiendra après écriture, valeur du candidat sinon valeur d'origine gardée ; nul pour un non résolu ».

- [ ] **Step 2: Vérifier le rendu**

Run: `just format-ui && just lint-ui`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(sidecar): contrat du détail avant / après"
```
