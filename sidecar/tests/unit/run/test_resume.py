import json
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Final

import pytest
from audio_samples import tag, tagged_mp3
from cdn_doubles import FakeCdn
from run_plans import music, plan_of, save_plan
from scraper_responses import ARTWORK_URL, BEATPORT_CANDIDATE
from stubs import ignore
from tagging_api import FakeApi, must_record, run_sources
from tagging_records import CREATED, RECORD, RUN_ID, UNREADABLE_CONTENTS, scored_candidate

from tagger.core.run_files import stamped_name
from tagger.resolution.matching import TrackQuery, build_query
from tagger.resolution.scraper_client import Source
from tagger.run.arbitration import Arbitration
from tagger.run.models import (
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
)
from tagger.run.resume import (
    InterruptedRun,
    UnreadablePlan,
    detect_interrupted,
    reopen_run,
)
from tagger.run.tagging import resolve_run
from tagger.tags.files import IdentityTags, TaggingFolderUnreadableError

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx2

    from tagger.run.models import RunEvent

OLDER: Final = CREATED - timedelta(days=2)
OLDER_RUN: Final = "9e8f7a"


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
    save_plan(plans, plan_of(folder_with_audio, _decided(62, 38)))

    detected = detect_interrupted(plans, dumps)

    assert detected == InterruptedRun(
        run_id=RUN_ID,
        started_at=CREATED,
        folder=folder_with_audio,
        processed=62,
        total=100,
        folder_missing=False,
    )


@pytest.mark.parametrize("emptied", [True, False], ids=["emptied", "gone"])
def test_flags_a_run_whose_folder_is_gone_or_was_emptied(
    plans: Path, dumps: Path, tmp_path: Path, music_folder: Path, emptied: bool
) -> None:
    folder = music_folder if emptied else tmp_path / "unplugged"
    path = save_plan(plans, plan_of(folder, _decided(1, 1)))

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
    assert (detected.run_id, detected.started_at) == (RUN_ID, CREATED)
    assert detected.error.params == {"file": path.name, "found": 2, "expected": 1}


def test_drops_a_plan_whose_files_were_already_written(
    plans: Path,
    dumps: Path,
    folder_with_audio: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    written = save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))
    (dumps / stamped_name(CREATED, RUN_ID, ".json")).write_text("{}", encoding="utf-8")
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), run_id=OLDER_RUN, started_at=OLDER))

    detected = detect_interrupted(plans, dumps)

    assert not written.exists()
    assert isinstance(detected, InterruptedRun)
    assert detected.run_id == OLDER_RUN
    assert "run plan dropped run=a3f9c1 reason=files_written" in caplog.messages


def test_skips_a_committed_plan_and_foreign_files(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), committed=True))
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), run_id=OLDER_RUN, started_at=OLDER))
    (plans / "notes.json").write_text("{", encoding="utf-8")
    (plans / stamped_name(CREATED, "2c3d4e", ".tmp")).write_text("{", encoding="utf-8")

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, InterruptedRun)
    assert detected.run_id == OLDER_RUN


@pytest.mark.parametrize("content", UNREADABLE_CONTENTS)
def test_reports_the_newest_plan_first_even_when_unreadable(
    plans: Path, dumps: Path, folder_with_audio: Path, content: str
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), run_id=OLDER_RUN, started_at=OLDER))
    newest = plans / stamped_name(CREATED, RUN_ID, ".json")
    newest.write_text(content, encoding="utf-8")

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, UnreadablePlan)
    assert detected.run_id == RUN_ID


def test_ignores_the_plan_of_the_run_still_open(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), run_id=OLDER_RUN, started_at=OLDER))

    detected = detect_interrupted(plans, dumps, active_run_id=RUN_ID)

    assert isinstance(detected, InterruptedRun)
    assert detected.run_id == OLDER_RUN


def test_finds_nothing_when_the_only_plan_is_the_run_still_open(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))

    detected = detect_interrupted(plans, dumps, active_run_id=RUN_ID)

    assert detected is None


def _query(record: TrackRecord) -> TrackQuery:
    query = build_query(record.identity.artist, record.identity.title, record.path.name)
    assert query is not None
    return query


def _auto(record: TrackRecord) -> TrackRecord:
    candidate = BEATPORT_CANDIDATE
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


@pytest.mark.asyncio
async def test_gives_back_the_decisions_of_the_plan(music_folder: Path) -> None:
    auto, held = music(music_folder, 2)
    nested = tagged_mp3(music_folder / "sub", "b.mp3", "Amelie Lens", "Basiel")
    identity = IdentityTags(artist="Amelie Lens", title="Basiel")
    refused = TrackRecord(track_id="sub/b.mp3", path=nested, identity=identity)
    plan = plan_of(music_folder, [_auto(auto), _held(held), _refused(refused)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=ignore)

    reopened = {record.track_id: record for record in live.snapshot().tracks}
    assert reopened["t000.mp3"].resolution is Resolution.AUTO
    pending = reopened["t001.mp3"].arbitration
    assert pending is not None
    assert pending.other is not None
    assert (pending.source, pending.other.source) == (Source.BEATPORT, Source.BANDCAMP)
    assert reopened["sub/b.mp3"].failure_reason is FailureReason.USER_REFUSED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "decide", [_auto, _held, _refused], ids=["resolved", "arbitrated", "refused"]
)
async def test_sends_a_retagged_file_back_to_the_network(
    music_folder: Path, decide: Callable[[TrackRecord], TrackRecord]
) -> None:
    (record,) = music(music_folder, 1)
    plan = plan_of(music_folder, [decide(record)])
    tag(record.path, artist=["Sara Landry"], title=["The Void"])
    events: list[RunEvent] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=events.append)

    retagged = must_record(live, "t000.mp3")
    assert (retagged.state, retagged.failure_reason, retagged.candidate, retagged.arbitration) == (
        None,
        None,
        None,
        None,
    )
    assert events[-1] == RunProgress(processed=0, total=1)


@pytest.mark.asyncio
async def test_rebuilds_the_run_on_the_folder_as_it_is_now(
    music_folder: Path, caplog: pytest.LogCaptureFixture
) -> None:
    kept, gone = music(music_folder, 2)
    plan = plan_of(music_folder, [_refused(kept), _refused(gone)])
    gone.path.unlink()
    tagged_mp3(music_folder, "new.mp3", "Sara Landry", "The Void")

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=ignore)

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
    assert events[-1] == RunProgress(processed=2, total=3)


class _NotingCdn(FakeCdn):
    """Note combien d'evenements le run avait emis a chaque telechargement de pochette."""

    def __init__(self, events: list[RunEvent]) -> None:
        super().__init__()
        self._events = events
        self.announced: list[int] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.announced.append(len(self._events))
        return super().handler(request)


@pytest.mark.asyncio
async def test_announces_the_run_before_downloading_the_artworks(music_folder: Path) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])
    events: list[RunEvent] = []
    cdn = _NotingCdn(events)

    async with run_sources(music_folder, FakeApi(), RUN_ID, cdn=cdn) as sources:
        await reopen_run(plan, sources, on_event=events.append)

    assert cdn.announced == [1]
    assert isinstance(events[0], RunStarted)


@pytest.mark.asyncio
async def test_downloads_again_the_artwork_of_a_resolved_track(music_folder: Path) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=ignore)

    reopened = must_record(live, "t000.mp3")
    assert reopened.artwork is not None


@pytest.mark.asyncio
async def test_keeps_a_track_resolved_when_its_artwork_is_unavailable(
    music_folder: Path,
) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])
    cdn = FakeCdn()
    cdn.refused.add(ARTWORK_URL)

    async with run_sources(music_folder, FakeApi(), RUN_ID, cdn=cdn) as sources:
        live = await reopen_run(plan, sources, on_event=ignore)

    reopened = must_record(live, "t000.mp3")
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

    reopened = must_record(live, "t001.mp3")
    assert reopened.state is None
    assert events[-1] == RunProgress(processed=1, total=2)


@pytest.mark.asyncio
async def test_a_reopened_arbitration_can_still_be_decided(music_folder: Path) -> None:
    (held,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_held(held)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=ignore)
        desk = Arbitration(live, sources, ignore)

        await desk.choose("t000.mp3", Source.BEATPORT, 0)

    decided = must_record(live, "t000.mp3")
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

    assert api.searched() == {_query(record).text for record in records[62:]}
    assert api.paths().count("/beatport/search") == 38
    progress = [event for event in events if isinstance(event, RunProgress)]
    assert (progress[0], progress[-1]) == (
        RunProgress(processed=62, total=100),
        RunProgress(processed=100, total=100),
    )
    held = must_record(live, "t001.mp3")
    assert held.arbitration is not None
    assert held.arbitration.other is not None
