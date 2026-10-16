from pathlib import Path

import pytest
from fs_listing import names
from stubs import failing_first, raising

from tagger.core.file_failures import FileFailureReason
from tagger.playlists.extraction import (
    DestinationFolderUnwritableError,
    ExtractionFailure,
    ExtractionMode,
    SourceFolderUnreadableError,
    extract,
)


def test_copies_the_requested_tracks(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["alpha.mp3"], music_library, destination)

    assert (destination / "alpha.mp3").is_file()
    assert result.extracted == ("alpha.mp3",)


@pytest.mark.parametrize(
    ("mode", "source_kept"),
    [(ExtractionMode.COPY, True), (ExtractionMode.MOVE, False)],
    ids=["copy", "move"],
)
def test_keeps_the_source_file_only_when_copying(
    music_library: Path, tmp_path: Path, mode: ExtractionMode, source_kept: bool
) -> None:
    destination = tmp_path / "work"

    extract(["alpha.mp3"], music_library, destination, mode=mode)

    assert (music_library / "albums" / "alpha.mp3").exists() is source_kept
    assert (destination / "alpha.mp3").is_file()


def test_creates_the_destination_folder(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work" / "nested"

    extract(["alpha.mp3"], music_library, destination)

    assert destination.is_dir()


def test_raises_before_creating_the_destination(tmp_path: Path) -> None:
    """L'ordre des deux etapes est la garantie : indexer la source leve avant que le
    dossier destination ne soit cree, donc un run impossible ne laisse rien derriere lui.
    """
    destination = tmp_path / "work"

    with pytest.raises(SourceFolderUnreadableError):
        extract(["alpha.mp3"], tmp_path / "absent", destination)

    assert not destination.exists()


def test_finds_a_track_whatever_the_case_used(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["delta.MP3"], music_library, destination)

    assert result.extracted == ("delta.MP3",)
    assert len(names(destination)) == 1


@pytest.mark.parametrize("mode", list(ExtractionMode), ids=str)
def test_a_name_asked_twice_is_extracted_once_then_already_present(
    music_library: Path, tmp_path: Path, mode: ExtractionMode
) -> None:
    """`beta.mp3` a des homonymes : en deplacement, la seconde occurrence redepartagerait
    des candidats dont le retenu a quitte la source. Les categories exclusives partitionnent
    les morceaux demandes, un meme nom ne peut pas sortir extrait et en echec.
    """
    result = extract(["beta.mp3", "beta.mp3"], music_library, tmp_path / "work", mode=mode)

    assert result.extracted == ("beta.mp3",)
    assert result.already_present == ("beta.mp3",)
    assert result.failures == ()
    assert len(result.duplicates) == 1


def test_records_the_duplicate_it_resolved(music_library: Path, tmp_path: Path) -> None:
    result = extract(["beta.mp3"], music_library, tmp_path / "work")

    assert len(result.duplicates) == 1
    assert result.duplicates[0].file_name == "beta.mp3"


def test_never_overwrites_an_existing_destination_file(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"
    destination.mkdir()
    (destination / "alpha.mp3").write_bytes(b"already retagged")

    result = extract(["alpha.mp3"], music_library, destination)

    assert (destination / "alpha.mp3").read_bytes() == b"already retagged"
    assert result.already_present == ("alpha.mp3",)
    assert result.extracted == ()


def test_returns_an_empty_result_and_no_destination_folder_for_an_empty_playlist(
    music_library: Path, tmp_path: Path
) -> None:
    destination = tmp_path / "work"

    result = extract([], music_library, destination)

    assert result.extracted == ()
    assert result.missing == ()
    assert not destination.exists()


def test_moves_nothing_when_the_destination_is_the_source(music_library: Path) -> None:
    result = extract(["alpha.mp3"], music_library, music_library, mode=ExtractionMode.MOVE)

    assert (music_library / "albums" / "alpha.mp3").is_file()
    assert not (music_library / "alpha.mp3").exists()
    assert result.already_present == ("alpha.mp3",)
    assert result.extracted == ()


def test_ignores_a_destination_nested_in_the_source_on_a_second_run(
    music_library: Path,
) -> None:
    destination = music_library / "_export"
    extract(["alpha.mp3"], music_library, destination)

    result = extract(["alpha.mp3"], music_library, destination)

    assert result.already_present == ("alpha.mp3",)
    assert result.duplicates == ()


def test_records_a_missing_track_and_carries_on(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["absent.mp3", "alpha.mp3"], music_library, destination)

    assert result.missing == ("absent.mp3",)
    assert result.extracted == ("alpha.mp3",)


def test_records_a_failed_copy_and_carries_on(
    music_library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "copy", raising(PermissionError(13, "Permission denied")))

    result = extract(["alpha.mp3"], music_library, tmp_path / "work")

    assert result.failures == (ExtractionFailure("alpha.mp3", FileFailureReason.PERMISSION_DENIED),)


def test_a_failed_copy_does_not_stop_the_following_tracks(
    music_library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "copy", failing_first(Path.copy, OSError(28, "No space left")))

    result = extract(["alpha.mp3", "delta.mp3"], music_library, tmp_path / "work")

    assert result.failures[0].reason is FileFailureReason.DISK_FULL
    assert result.extracted == ("delta.mp3",)


def test_records_a_homonym_vanished_since_indexing_and_carries_on(
    music_library: Path, tmp_path: Path
) -> None:
    """L'index est un instantane : le fichier disparait apres le premier morceau."""
    vanished = music_library / "singles" / "beta.mp3"

    result = extract(
        ["alpha.mp3", "beta.mp3"],
        music_library,
        tmp_path / "work",
        on_progress=lambda _processed, _total: vanished.unlink(missing_ok=True),
    )

    assert result.failures == (ExtractionFailure("beta.mp3", FileFailureReason.FILE_MISSING),)
    assert result.extracted == ("alpha.mp3",)


def test_reports_progress_once_per_track(music_library: Path, tmp_path: Path) -> None:
    seen: list[tuple[int, int]] = []

    extract(
        ["alpha.mp3", "absent.mp3", "delta.mp3"],
        music_library,
        tmp_path / "work",
        on_progress=lambda processed, total: seen.append((processed, total)),
    )

    assert seen == [(1, 3), (2, 3), (3, 3)]


def test_a_destination_that_cannot_be_created_becomes_a_business_error(
    music_library: Path, tmp_path: Path
) -> None:
    occupied = tmp_path / "work"
    occupied.write_bytes(b"")

    with pytest.raises(DestinationFolderUnwritableError) as raised:
        extract(["alpha.mp3"], music_library, occupied)

    assert raised.value.code == "destination_folder_unwritable"
    assert raised.value.params == {"folder": "work"}
