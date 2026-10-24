"""Commandes executees directement, sans passer par la boucle NDJSON."""

import asyncio
import json
from contextlib import AsyncExitStack
from dataclasses import replace
from typing import TYPE_CHECKING

import pytest
from audio_samples import tagged_mp3
from ndjson_loop import extraction_command
from pydantic import ValidationError
from stubs import ignore
from tagging_api import FakeApi, must_record, must_record_as, one_track, opened_run
from tagging_records import (
    CREATED,
    FIRST_TRACK,
    RECORD,
    RUN_ID,
    resolved,
    write_failed_record,
    written_record,
)
from vlc_dump import PLAYLIST_MAIN, PLAYLIST_OTHER, TRACKS

from tagger import __version__
from tagger.core.api_key import SERVICE, USERNAME
from tagger.handlers import (
    CurrentRun,
    handle_extract_playlist,
    handle_get_version,
    handle_list_playlists,
    handle_rollback,
    handle_set_api_key,
    tagging_transports,
)
from tagger.protocol import (
    ExtractPlaylist,
    ListPlaylists,
    Phase,
    Progress,
    Rollback,
    RollbackFinished,
    SetApiKey,
    TrackResolved,
)
from tagger.resolution.cache import resolve_host
from tagger.run.arbitration import Arbitration
from tagger.run.models import LiveRun, Resolved
from tagger.run.url_recovery import UrlRecovery
from tagger.tags.files import read_original_tags
from tagger.tags.tag_dump import DumpEntry, TagDump, dump_dir, save_entries

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from memory_keyring import MemoryKeyring

    from tagger.protocol import Event
    from tagger.run.models import TrackRecord


def extract_command(library: Path, dump: Path, destination: Path) -> ExtractPlaylist:
    """Commande `extract_playlist` sur la playlist de test du dump."""
    return ExtractPlaylist.model_validate_json(
        json.dumps(extraction_command(library, dump, destination))
    )


def test_reports_the_sidecar_version() -> None:
    """Version nue, pas `RELEASE` : l'interface la compare a `APP_VERSION`."""
    event = handle_get_version()

    assert event.version == __version__


def test_lists_the_playlists_of_a_dump(vlc_dump: Path) -> None:
    event = handle_list_playlists(ListPlaylists(command="list_playlists", playlist_path=vlc_dump))

    assert {entry.name: entry.track_count for entry in event.playlists} == {
        PLAYLIST_MAIN: len(TRACKS),
        PLAYLIST_OTHER: 1,
    }


def test_extracts_and_writes_a_report(vlc_dump: Path, music_library: Path, tmp_path: Path) -> None:
    command = extract_command(music_library, vlc_dump, tmp_path / "work")

    event = handle_extract_playlist(command, ignore)

    assert event.report_path.is_file()


def test_emits_progress_for_every_track(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    seen: list[Progress] = []
    command = extract_command(music_library, vlc_dump, tmp_path / "work")

    handle_extract_playlist(command, seen.append)

    assert seen
    assert all(event.phase is Phase.EXTRACTION for event in seen)
    assert seen[-1].processed == seen[-1].total


def test_reports_a_playlist_track_absent_from_the_library_as_missing(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    command = extract_command(music_library, vlc_dump, tmp_path / "work")

    event = handle_extract_playlist(command, ignore)

    assert set(event.missing) == set(TRACKS)
    assert (event.extracted, event.already_present, event.duplicates, event.failures) == (
        (),
        (),
        (),
        (),
    )


@pytest.mark.usefixtures("_key")
def test_reports_whether_an_api_key_is_configured() -> None:
    event = handle_get_version()

    assert event.api_key_configured is True


def test_reports_no_api_key_on_an_empty_keyring() -> None:
    """Premier lancement : c'est ce `False` qui fait bloquer le lancement d'un run."""
    event = handle_get_version()

    assert event.api_key_configured is False


def test_answers_set_api_key_with_a_version_that_reports_the_key(
    memory_keyring: MemoryKeyring,
) -> None:
    command = SetApiKey(command="set_api_key", api_key="k3y-t0k3n")

    event = handle_set_api_key(command)

    assert event.event == "version"
    assert event.api_key_configured is True
    assert memory_keyring.secrets[(SERVICE, USERNAME)] == "k3y-t0k3n"


@pytest.mark.parametrize(
    "api_key", ["", "k3y t0k3n", "clé", "x" * 1281], ids=["empty", "space", "non-ascii", "too-long"]
)
def test_rejects_an_api_key_out_of_format(api_key: str) -> None:
    with pytest.raises(ValidationError):
        SetApiKey(command="set_api_key", api_key=api_key)


def test_accepts_an_api_key_at_the_credential_manager_limit(
    memory_keyring: MemoryKeyring,
) -> None:
    """Au-dela, `CredWrite` echoue : la limite du protocole doit rester sous celle du trousseau."""
    command = SetApiKey(command="set_api_key", api_key="x" * 1280)

    handle_set_api_key(command)

    assert memory_keyring.secrets[(SERVICE, USERNAME)] == "x" * 1280


def test_never_shows_the_api_key_in_the_command_repr() -> None:
    command = SetApiKey(command="set_api_key", api_key="k3y-t0k3n")

    shown = repr(command)

    assert "k3y-t0k3n" not in shown


def test_leaves_the_tagging_transports_to_the_real_network() -> None:
    """Les tests remplacent ce seam en entier : sans ce garde, un resolveur factice
    pose en production ne ferait rien echouer.
    """
    transports = tagging_transports()

    assert transports.api is None
    assert transports.cdn is None
    assert transports.resolve is resolve_host


@pytest.mark.asyncio
async def test_closes_the_client_even_when_closing_is_cancelled(tmp_path: Path) -> None:
    """Sans `finally`, annuler la tache qui attend `close()` sautait `stack.aclose()`."""
    closed = False

    async def record_closed() -> None:
        nonlocal closed
        closed = True

    async def gesture(cancelled_seen: asyncio.Event, released: asyncio.Event) -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled_seen.set()
            await released.wait()
            raise

    stack = AsyncExitStack()
    stack.push_async_callback(record_closed)
    async with opened_run(one_track(tmp_path), FakeApi()) as opened:
        live, sources = opened.live, opened.sources
    arbitration = Arbitration(live, sources, ignore)
    recovery = UrlRecovery(live, sources, ignore)
    current = CurrentRun(stack, live, sources, arbitration, recovery)
    cancelled_seen, released = asyncio.Event(), asyncio.Event()
    current.track(asyncio.create_task(gesture(cancelled_seen, released), name="gesture"))

    close_task = asyncio.create_task(current.close(), name="close")
    async with asyncio.timeout(5):
        await cancelled_seen.wait()
    close_task.cancel()
    released.set()

    with pytest.raises(asyncio.CancelledError):
        async with asyncio.timeout(5):
            await close_task

    assert closed


def _dumped_run(folder: Path) -> LiveRun:
    """Run dont le seul morceau, resolu, a une entree au dump : comme apres une ecriture."""
    path = tagged_mp3(folder, FIRST_TRACK, "adam beyer", "your mind")
    run = TagDump(run_id=RUN_ID, created_at=CREATED, folder=folder)
    save_entries(dump_dir(), run, {FIRST_TRACK: DumpEntry.of(path, read_original_tags(path))})
    return LiveRun(RUN_ID, folder, [resolved(replace(RECORD, path=path))])


async def _rolled_back(live: LiveRun) -> tuple[RollbackFinished, list[Event]]:
    events: list[Event] = []
    command = Rollback(command="rollback", run_id=RUN_ID)

    return await handle_rollback(command, live, events.append), events


@pytest.mark.asyncio
@pytest.mark.usefixtures("app_data")
async def test_skips_the_displayed_track_of_a_dump_entry_it_never_wrote(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    live = _dumped_run(tmp_path / "music")
    before = live.record(FIRST_TRACK)

    finished, events = await _rolled_back(live)

    assert finished.restored == (FIRST_TRACK,)
    assert (events, live.record(FIRST_TRACK)) == ([], before)
    assert (
        "rollback entry on a track not written run=a3f9c1 track=1 status=resolved "
        "reason=not_written"
    ) in caplog.messages


@pytest.mark.asyncio
@pytest.mark.usefixtures("app_data")
@pytest.mark.parametrize(
    "settle",
    [
        written_record,
        lambda record: write_failed_record(record, restorable=True),
    ],
    ids=["written", "write-failed"],
)
async def test_stops_offering_a_restore_for_an_entry_forgotten_without_one(
    tmp_path: Path, settle: Callable[[TrackRecord[Resolved]], TrackRecord]
) -> None:
    live = _dumped_run(tmp_path / "music")
    settled = settle(must_record_as(live, FIRST_TRACK, Resolved))
    live.update(settled)
    settled.path.unlink()

    _finished, events = await _rolled_back(live)

    forgotten = must_record(live, FIRST_TRACK)
    assert (forgotten.state, forgotten.restorable) == (settled.state, False)
    assert [event.restorable for event in events if isinstance(event, TrackResolved)] == [False]
