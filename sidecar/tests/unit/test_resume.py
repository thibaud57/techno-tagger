"""Tests de la reprise d'un run interrompu : detection, designation, reconstruction."""

import json
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Final

import pytest
from run_plans import RUN_ID, music, plan_of, save_plan
from scraper_responses import payload_candidate
from tagging_api import CREATED, FakeApi, FakeCdn, run_sources, tagged_mp3
from tagging_records import RECORD, scored_candidate

from tagger.arbitration import Arbitration
from tagger.files import TaggingFolderUnreadableError
from tagger.matching import TrackQuery, build_query
from tagger.resume import (
    InterruptedRun,
    UnreadablePlan,
    detect_interrupted,
    find_plan,
    reopen_run,
)
from tagger.run_files import stamped_name
from tagger.scraper_client import Source
from tagger.tagging import (
    ArbitrationRequired,
    FailureReason,
    PendingArbitration,
    Resolution,
    RunProgress,
    RunStarted,
    SourceList,
    TrackRecord,
    TrackResolved,
    TrackState,
    resolve_run,
)

if TYPE_CHECKING:
    from tagger.scraper_client import TrackCandidate
    from tagger.tagging import RunEvent

OLDER: Final = CREATED - timedelta(days=2)


@pytest.fixture
def plans(tmp_path: Path) -> Path:
    return tmp_path / "plans"


@pytest.fixture
def dumps(tmp_path: Path) -> Path:
    folder = tmp_path / "dumps"
    folder.mkdir()
    return folder


@pytest.fixture
def music_folder(tmp_path: Path) -> Path:
    """Dossier vide, que `music` et `tagged_mp3` remplissent de vrais fichiers."""
    folder = tmp_path / "music"
    folder.mkdir()
    return folder


@pytest.fixture
def folder_with_audio(music_folder: Path) -> Path:
    """Un fichier audio vide suffit a la detection, qui ne lit aucun tag."""
    (music_folder / "a.mp3").touch()
    return music_folder


def _decided(count: int, waiting: int) -> list[TrackRecord]:
    """`count` morceaux tranches puis `waiting` en attente ; aucun fichier : la detection
    ne relit que le dossier du plan."""
    decided = [
        TrackRecord(
            track_id=f"d{n}.mp3", path=Path(f"d{n}.mp3"), identity=RECORD.identity
        ).unresolved(FailureReason.NO_RESULT)
        for n in range(count)
    ]
    pending = [
        TrackRecord(track_id=f"w{n}.mp3", path=Path(f"w{n}.mp3"), identity=RECORD.identity)
        for n in range(waiting)
    ]
    return [*decided, *pending]


def test_finds_no_interrupted_run_without_plans(plans: Path, dumps: Path) -> None:
    detected = detect_interrupted(plans, dumps)

    assert detected is None


def test_sums_up_an_interrupted_run(plans: Path, dumps: Path, folder_with_audio: Path) -> None:
    path = save_plan(plans, plan_of(folder_with_audio, _decided(62, 38)))

    detected = detect_interrupted(plans, dumps)

    assert detected == InterruptedRun(
        path=path,
        run_id=RUN_ID,
        started_at=CREATED,
        folder=folder_with_audio,
        processed=62,
        total=100,
        folder_missing=False,
    )


def test_flags_a_run_whose_folder_is_gone(plans: Path, dumps: Path, tmp_path: Path) -> None:
    path = save_plan(plans, plan_of(tmp_path / "unplugged", _decided(1, 1)))

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, InterruptedRun)
    assert detected.folder_missing
    assert path.exists()


def test_flags_a_run_whose_folder_was_emptied(plans: Path, dumps: Path, music_folder: Path) -> None:
    path = save_plan(plans, plan_of(music_folder, _decided(1, 1)))

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, InterruptedRun)
    assert detected.folder_missing
    assert path.exists()


def test_reports_a_plan_of_another_version(plans: Path, dumps: Path) -> None:
    plans.mkdir()
    path = plans / stamped_name(CREATED, RUN_ID, ".json")
    path.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, UnreadablePlan)
    assert (detected.path, detected.run_id, detected.started_at) == (path, RUN_ID, CREATED)
    assert detected.error.params == {"file": path.name, "found": 2, "expected": 1}


def test_drops_a_plan_whose_files_were_already_written(
    plans: Path,
    dumps: Path,
    folder_with_audio: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    written = save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))
    (dumps / stamped_name(CREATED, RUN_ID, ".json")).write_text("{}", encoding="utf-8")
    older = save_plan(
        plans, plan_of(folder_with_audio, _decided(1, 1), run_id="9e8f7a", started_at=OLDER)
    )

    detected = detect_interrupted(plans, dumps)

    assert not written.exists()
    assert isinstance(detected, InterruptedRun)
    assert detected.path == older
    assert "run plan dropped run=a3f9c1 reason=files_written" in caplog.messages


def test_skips_a_committed_plan_and_foreign_files(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), committed=True))
    older = save_plan(
        plans, plan_of(folder_with_audio, _decided(1, 1), run_id="9e8f7a", started_at=OLDER)
    )
    (plans / "notes.json").write_text("{", encoding="utf-8")
    (plans / stamped_name(CREATED, "2c3d4e", ".tmp")).write_text("{", encoding="utf-8")

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, InterruptedRun)
    assert detected.path == older


def test_reports_the_newest_plan_first_even_when_unreadable(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), run_id="9e8f7a", started_at=OLDER))
    newest = plans / stamped_name(CREATED, RUN_ID, ".json")
    newest.write_text("{not json", encoding="utf-8")

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, UnreadablePlan)
    assert detected.path == newest


def test_ignores_the_plan_of_the_run_still_open(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))
    older = save_plan(
        plans, plan_of(folder_with_audio, _decided(1, 1), run_id="9e8f7a", started_at=OLDER)
    )

    detected = detect_interrupted(plans, dumps, active_run_id=RUN_ID)

    assert isinstance(detected, InterruptedRun)
    assert detected.path == older


def test_finds_nothing_when_the_only_plan_is_the_run_still_open(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))

    detected = detect_interrupted(plans, dumps, active_run_id=RUN_ID)

    assert detected is None


def test_finds_a_plan_by_its_run(plans: Path, music_folder: Path) -> None:
    path = save_plan(plans, plan_of(music_folder, _decided(1, 1)))

    found = find_plan(plans, RUN_ID)

    assert found == path


def test_finds_no_plan_for_an_unknown_run(plans: Path, music_folder: Path) -> None:
    save_plan(plans, plan_of(music_folder, _decided(1, 1)))

    found = find_plan(plans, "000000")

    assert found is None


def _query(record: TrackRecord) -> TrackQuery:
    query = build_query(record.identity.artist, record.identity.title, record.path.name)
    assert query is not None
    return query


def _auto(record: TrackRecord) -> TrackRecord:
    candidate = payload_candidate()
    return replace(record, query=_query(record)).resolved(
        Resolution.AUTO, Source.BEATPORT, candidate, scored_candidate(candidate=candidate), None
    )


def _held(record: TrackRecord) -> TrackRecord:
    return replace(
        record,
        query=_query(record),
        arbitration=PendingArbitration(
            Source.BEATPORT,
            (scored_candidate(),),
            beatport_unavailable=False,
            other=SourceList(Source.BANDCAMP, (scored_candidate(artist=81.0, title=77.0),)),
        ),
    )


def _refused(record: TrackRecord) -> TrackRecord:
    return replace(record, query=_query(record)).unresolved(FailureReason.USER_REFUSED)


def _silent(record: TrackRecord) -> TrackRecord:
    return replace(record, query=_query(record)).unresolved(FailureReason.SOURCE_UNAVAILABLE)


def _nothing(_event: RunEvent) -> None:
    """Rappel d'un test qui n'observe pas les evenements."""


@pytest.mark.asyncio
async def test_gives_back_the_decisions_of_the_plan(music_folder: Path) -> None:
    auto, held = music(music_folder, 2)
    nested = tagged_mp3(music_folder / "sub", "b.mp3", "Orla Quenby", "Kelvor")
    refused = TrackRecord(track_id="sub/b.mp3", path=nested, identity=RECORD.identity)
    plan = plan_of(music_folder, [_auto(auto), _held(held), _refused(refused)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)

    reopened = {record.track_id: record for record in live.snapshot().tracks}
    assert reopened["t000.mp3"].resolution is Resolution.AUTO
    pending = reopened["t001.mp3"].arbitration
    assert pending is not None
    assert pending.other is not None
    assert (pending.source, pending.other.source) == (Source.BEATPORT, Source.BANDCAMP)
    assert reopened["sub/b.mp3"].failure_reason is FailureReason.USER_REFUSED


@pytest.mark.asyncio
async def test_rebuilds_the_run_on_the_folder_as_it_is_now(
    music_folder: Path, caplog: pytest.LogCaptureFixture
) -> None:
    kept, gone = music(music_folder, 2)
    plan = plan_of(music_folder, [_refused(kept), _refused(gone)])
    gone.path.unlink()
    tagged_mp3(music_folder, "new.mp3", "Dara Winter", "The Weir")

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)

    reopened = {record.track_id: record for record in live.snapshot().tracks}
    assert set(reopened) == {"t000.mp3", "new.mp3"}
    assert reopened["new.mp3"].state is None
    assert "track dropped run=a3f9c1 track=2 reason=file_missing" in caplog.messages


@pytest.mark.asyncio
async def test_replays_the_events_of_a_live_run(music_folder: Path) -> None:
    auto, held, waiting = music(music_folder, 3)
    plan = plan_of(music_folder, [_auto(auto), _held(held), waiting])
    events: list[RunEvent] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        await reopen_run(plan, sources, on_event=events.append)

    assert [type(event) for event in events] == [
        RunStarted,
        TrackResolved,
        ArbitrationRequired,
        RunProgress,
    ]
    assert events[-1] == RunProgress(2, 3)


@pytest.mark.asyncio
async def test_announces_the_run_before_downloading_the_artworks(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])
    events: list[RunEvent] = []
    announced_at_download: list[int] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:

        async def spy(_position: int, _candidate: TrackCandidate) -> None:
            announced_at_download.append(len(events))

        monkeypatch.setattr(sources, "artwork", spy)

        await reopen_run(plan, sources, on_event=events.append)

    assert announced_at_download == [1]
    assert isinstance(events[0], RunStarted)


@pytest.mark.asyncio
async def test_downloads_again_the_artwork_of_a_resolved_track(music_folder: Path) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)

    reopened = live.record("t000.mp3")
    assert reopened is not None
    assert reopened.artwork is not None


@pytest.mark.asyncio
async def test_keeps_a_track_resolved_when_its_artwork_is_unavailable(
    music_folder: Path,
) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])
    cdn = FakeCdn()
    release = payload_candidate().release
    assert release is not None
    assert release.artwork_url is not None
    cdn.refused.add(release.artwork_url)

    async with run_sources(music_folder, FakeApi(), RUN_ID, cdn=cdn) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)

    reopened = live.record("t000.mp3")
    assert reopened is not None
    assert (reopened.state, reopened.artwork) == (TrackState.RESOLVED, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("emptied", [True, False], ids=["emptied", "gone"])
async def test_refuses_to_reopen_a_folder_with_nothing_left_to_resume(
    music_folder: Path, tmp_path: Path, emptied: bool
) -> None:
    (gone,) = music(music_folder, 1)
    plan = plan_of(music_folder if emptied else tmp_path / "unplugged", [_refused(gone)])
    gone.path.unlink()
    events: list[RunEvent] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        with pytest.raises(TaggingFolderUnreadableError):
            await reopen_run(plan, sources, on_event=events.append)

    assert events == []


@pytest.mark.asyncio
async def test_leaves_a_track_whose_source_did_not_answer_to_the_network(
    music_folder: Path,
) -> None:
    refused, silent = music(music_folder, 2)
    plan = plan_of(music_folder, [_refused(refused), _silent(silent)])
    events: list[RunEvent] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=events.append)

    reopened = live.record("t001.mp3")
    assert reopened is not None
    assert reopened.state is None
    assert events[-1] == RunProgress(1, 2)


@pytest.mark.asyncio
async def test_a_reopened_arbitration_can_still_be_decided(music_folder: Path) -> None:
    (held,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_held(held)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)
        desk = Arbitration(live, sources, lambda _event: None)

        await desk.choose("t000.mp3", Source.BEATPORT, 0)

    decided = live.record("t000.mp3")
    assert decided is not None
    assert (decided.state, decided.resolution) == (TrackState.RESOLVED, Resolution.ARBITRATION)


@pytest.mark.asyncio
async def test_resumes_a_run_left_at_62_out_of_100(music_folder: Path) -> None:
    records = music(music_folder, 100)
    decided = [_auto(records[0]), _held(records[1]), *map(_refused, records[2:62])]
    plan = plan_of(music_folder, [*decided, *records[62:]])
    api = FakeApi()
    events: list[RunEvent] = []

    async with run_sources(music_folder, api, RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=events.append)
        await resolve_run(live, sources, on_event=events.append)

    searched = [
        request.url.params.get("q")
        for request in api.requests
        if request.url.path == "/beatport/search"
    ]
    assert sorted(searched) == sorted(_query(record).text for record in records[62:])
    progress = [event for event in events if isinstance(event, RunProgress)]
    assert (progress[0], progress[-1]) == (RunProgress(62, 100), RunProgress(100, 100))
    held = live.record("t001.mp3")
    assert held is not None
    assert held.arbitration is not None
    assert held.arbitration.other is not None
