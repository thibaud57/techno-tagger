"""Tests du rollback : nom d'origine puis tags d'origine, dump consomme, dernier run."""

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import NamedTuple

import pytest
from audio_samples import held_open
from scraper_responses import track_payload
from tagging_api import tagged_mp3

from tagger import rollback
from tagger.file_failures import FileFailureReason
from tagger.files import (
    OriginalTags,
    TagField,
    TagsWriteError,
    project_tags,
    read_original_tags,
    restore_tags,
    write_tags,
)
from tagger.renaming import rename_track
from tagger.rollback import (
    RollbackFailure,
    RollbackTarget,
    RollbackUnavailableError,
    find_rollback_target,
    roll_back,
)
from tagger.scraper_client import TrackCandidate
from tagger.tag_dump import DumpEntry, TagDump, dump_path, load_dump, save_entries
from tagger.tagging import FailureReason

RUN = "a3f9c1"
WRITTEN_AT = datetime(2026, 10, 5, 21, 14, 3, tzinfo=UTC)
BEATPORT = TrackCandidate.model_validate(track_payload())
ORIGINAL = "01 - untitled.mp3"


class _Written(NamedTuple):
    """Morceau ecrit puis renomme comme par une phase d'ecriture, et son origine."""

    original: Path
    renamed: Path
    origin: OriginalTags
    entry: DumpEntry


def _write(folder: Path, name: str) -> _Written:
    path = tagged_mp3(folder, name, "adam beyer", "your mind")
    origin = read_original_tags(path)
    values = project_tags(BEATPORT)
    write_tags(path, values, None)
    renamed = rename_track(path, values.get(TagField.ARTIST), values.get(TagField.TITLE)).path
    entry = DumpEntry.of(path, origin).model_copy(update={"renamed_path": renamed})
    return _Written(path, renamed, origin, entry)


def _dumped(
    folder: Path, *tracks: _Written, run_id: str = RUN, written_at: datetime = WRITTEN_AT
) -> TagDump:
    entries = {track.original.name: track.entry for track in tracks}
    return save_entries(folder, TagDump(run_id=run_id, created_at=written_at), entries)


def _ignore(_track_id: str, _path: Path) -> None:
    """Le run restaure n'est pas celui qu'affiche l'interface."""


@pytest.mark.asyncio
async def test_gives_a_renamed_file_back_its_name_and_tags(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    _dumped(tmp_path / "dumps", track)
    restored: list[tuple[str, Path]] = []

    summary = await roll_back(
        tmp_path / "dumps", RUN, None, lambda track_id, path: restored.append((track_id, path))
    )

    assert (summary.restored, summary.failed) == ((ORIGINAL,), ())
    assert restored == [(ORIGINAL, track.original)]
    assert not track.renamed.exists()
    assert read_original_tags(track.original) == track.origin


@pytest.mark.asyncio
async def test_leaves_a_track_whose_original_name_is_taken_untouched(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    dump = _dumped(tmp_path / "dumps", track)
    track.original.write_bytes(b"newcomer")
    written = read_original_tags(track.renamed)

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert summary.failed == (
        RollbackFailure(ORIGINAL, track.renamed.name, FailureReason.NAME_TAKEN),
    )
    assert read_original_tags(track.renamed) == written
    assert track.original.read_bytes() == b"newcomer"
    assert load_dump(dump_path(tmp_path / "dumps", dump)).entries.keys() == {ORIGINAL}


@pytest.mark.asyncio
async def test_reports_a_file_gone_under_both_names(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    _dumped(tmp_path / "dumps", track)
    track.renamed.unlink()

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert summary.failed == (
        RollbackFailure(ORIGINAL, track.renamed.name, FailureReason.FILE_MISSING),
    )


@pytest.mark.asyncio
async def test_leaves_the_tags_of_a_locked_file_untouched(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    _dumped(tmp_path / "dumps", track)
    written = read_original_tags(track.renamed)

    with held_open(track.renamed):
        summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert [failure.reason for failure in summary.failed] == [FailureReason.FILE_LOCKED]
    assert read_original_tags(track.renamed) == written


@pytest.mark.asyncio
async def test_replays_a_track_whose_tags_failed_after_its_name_came_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    dump = _dumped(tmp_path / "dumps", track)
    calls = 0

    def fail_once(path: Path, tags: OriginalTags) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise TagsWriteError(path, FileFailureReason.FILE_LOCKED)
        restore_tags(path, tags)

    monkeypatch.setattr(rollback, "restore_tags", fail_once)

    first = await roll_back(tmp_path / "dumps", RUN, None, _ignore)
    name_back = track.original.is_file() and not track.renamed.exists()
    kept = set(load_dump(dump_path(tmp_path / "dumps", dump)).entries)
    second = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert first.failed == (RollbackFailure(ORIGINAL, ORIGINAL, FailureReason.FILE_LOCKED),)
    assert (name_back, kept) == (True, {ORIGINAL})
    assert (second.restored, second.failed) == ((ORIGINAL,), ())
    assert read_original_tags(track.original) == track.origin


@pytest.mark.asyncio
async def test_restores_a_file_already_back_under_its_name(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    _dumped(tmp_path / "dumps", track)
    track.renamed.rename(track.original)

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert summary.restored == (ORIGINAL,)
    assert read_original_tags(track.original) == track.origin


@pytest.mark.asyncio
async def test_gives_names_back_in_the_reverse_order_of_the_writing(tmp_path: Path) -> None:
    music = tmp_path / "music"
    first = _write(music, "a.mp3")
    # Le second morceau prend, une fois le premier renomme, le nom d'origine de celui-ci.
    second_original = tagged_mp3(music, "b.mp3", "adam beyer", "your mind")
    second_origin = read_original_tags(second_original)
    second_renamed = second_original.rename(first.original)
    second_entry = DumpEntry.of(second_original, second_origin).model_copy(
        update={"renamed_path": second_renamed}
    )
    _dumped(
        tmp_path / "dumps",
        first,
        _Written(second_original, second_renamed, second_origin, second_entry),
    )

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert summary.failed == ()
    assert summary.restored == ("b.mp3", "a.mp3")


@pytest.mark.asyncio
async def test_forgets_restored_and_vanished_tracks_and_keeps_the_others(tmp_path: Path) -> None:
    music = tmp_path / "music"
    restorable, vanished, taken = (_write(music, name) for name in ("a.mp3", "b.mp3", "c.mp3"))
    dump = _dumped(tmp_path / "dumps", restorable, vanished, taken)
    vanished.renamed.unlink()
    taken.original.write_bytes(b"newcomer")

    await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert load_dump(dump_path(tmp_path / "dumps", dump)).entries.keys() == {"c.mp3"}


@pytest.mark.asyncio
async def test_keeps_the_dump_entry_of_a_track_whose_whole_folder_is_gone(tmp_path: Path) -> None:
    music = tmp_path / "music"
    track = _write(music, ORIGINAL)
    dump = _dumped(tmp_path / "dumps", track)
    shutil.rmtree(music)

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert [failure.reason for failure in summary.failed] == [FailureReason.FILE_MISSING]
    assert load_dump(dump_path(tmp_path / "dumps", dump)).entries.keys() == {ORIGINAL}


@pytest.mark.asyncio
async def test_deletes_the_dump_once_every_track_is_restored(tmp_path: Path) -> None:
    dump = _dumped(tmp_path / "dumps", _write(tmp_path / "music", ORIGINAL))

    await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert not dump_path(tmp_path / "dumps", dump).exists()


@pytest.mark.asyncio
async def test_rolls_back_a_single_track_only(tmp_path: Path) -> None:
    music = tmp_path / "music"
    first, second = _write(music, "a.mp3"), _write(music, "b.mp3")
    dump = _dumped(tmp_path / "dumps", first, second)

    summary = await roll_back(tmp_path / "dumps", RUN, "a.mp3", _ignore)

    assert summary.restored == ("a.mp3",)
    assert second.renamed.is_file()
    assert load_dump(dump_path(tmp_path / "dumps", dump)).entries.keys() == {"b.mp3"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("run_id", "track_id"),
    [("000000", None), (RUN, "absent.mp3")],
    ids=["run-without-dump", "track-absent-from-dump"],
)
async def test_refuses_what_the_dump_cannot_restore(
    tmp_path: Path, run_id: str, track_id: str | None
) -> None:
    _dumped(tmp_path / "dumps", _write(tmp_path / "music", ORIGINAL))

    with pytest.raises(RollbackUnavailableError) as error:
        await roll_back(tmp_path / "dumps", run_id, track_id, _ignore)

    assert error.value.params == {"run_id": run_id, "track_id": track_id}


def test_targets_the_newest_run_left_to_restore(tmp_path: Path) -> None:
    music = tmp_path / "music"
    _dumped(
        tmp_path / "dumps",
        _write(music, "a.mp3"),
        run_id="b7e2d4",
        written_at=WRITTEN_AT - timedelta(days=1),
    )
    _dumped(tmp_path / "dumps", _write(music, "b.mp3"), _write(music, "c.mp3"))

    target = find_rollback_target(tmp_path / "dumps")

    assert target == RollbackTarget(run_id=RUN, written_at=WRITTEN_AT, folder=music, tracks=2)


def test_targets_the_folder_of_the_first_track_without_a_common_one(tmp_path: Path) -> None:
    music = tmp_path / "music"
    first, second = _write(music, "a.mp3"), _write(music, "b.mp3")
    elsewhere = second.entry.model_copy(update={"path": Path("D:/elsewhere/b.mp3")})
    _dumped(tmp_path / "dumps", first, second._replace(entry=elsewhere))

    target = find_rollback_target(tmp_path / "dumps")

    assert target is not None
    assert target.folder == music


@pytest.mark.asyncio
async def test_targets_the_previous_run_once_the_newest_is_restored(tmp_path: Path) -> None:
    music = tmp_path / "music"
    _dumped(
        tmp_path / "dumps",
        _write(music, "a.mp3"),
        run_id="b7e2d4",
        written_at=WRITTEN_AT - timedelta(days=1),
    )
    _dumped(tmp_path / "dumps", _write(music, "b.mp3"))
    await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    target = find_rollback_target(tmp_path / "dumps")

    assert target is not None
    assert target.run_id == "b7e2d4"


def test_skips_an_unreadable_dump(tmp_path: Path) -> None:
    _dumped(tmp_path / "dumps", _write(tmp_path / "music", ORIGINAL))
    (tmp_path / "dumps" / "20261006T080000Z-b7e2d4.json").write_text("{", encoding="utf-8")

    target = find_rollback_target(tmp_path / "dumps")

    assert target is not None
    assert target.run_id == RUN


def test_targets_nothing_without_a_dump(tmp_path: Path) -> None:
    target = find_rollback_target(tmp_path / "dumps")

    assert target is None
