"""Tests du plan de run : modele, relecture, enregistrement, purge."""

import asyncio
import json
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from typing import Final

import pytest
from ndjson_loop import held_call
from run_plans import music, plan_of, save_plan
from scraper_responses import track_candidate
from stubs import raising
from tagging_api import CREATED
from tagging_records import RECORD, scored_candidate

from tagger import plan as plan_module
from tagger.file_failures import FileFailureReason
from tagger.matching import DEFAULT_THRESHOLDS, QueryOrigin, TrackQuery
from tagger.plan import (
    PlanRecorder,
    PlanScores,
    PlanTrack,
    RunPlan,
    RunPlanUnreadableError,
    discard_plan,
    load_plan,
    plan_path,
    purge_plans,
)
from tagger.run_files import write_atomically
from tagger.scraper_client import Source
from tagger.tagging import (
    FailureReason,
    LiveRun,
    PendingArbitration,
    Resolution,
    SourceList,
    TrackRecord,
    TrackState,
)

QUERY: Final = TrackQuery("Lior Vance", "Dim Orbit", QueryOrigin.TAGS)
WAITING: Final = replace(RECORD, track_id="e.mp3", path=Path("music/e.mp3"))
AUTO: Final = replace(RECORD, query=QUERY).resolved(
    Resolution.AUTO,
    Source.BEATPORT,
    track_candidate(),
    scored_candidate(artist=96.0, title=92.0),
    Path("cache/artworks/cover.jpg"),
)
HELD: Final = replace(
    RECORD,
    track_id="b.mp3",
    path=Path("music/b.mp3"),
    query=QUERY,
    arbitration=PendingArbitration(
        Source.BANDCAMP,
        (scored_candidate(),),
        beatport_unavailable=False,
        other=SourceList(Source.BEATPORT, (scored_candidate(artist=80.0, title=75.0),)),
    ),
)
BY_URL: Final = replace(RECORD, track_id="c.mp3", path=Path("music/c.mp3")).resolved(
    Resolution.URL, Source.BANDCAMP, track_candidate(track_id="42"), None, None
)
UNRESOLVED: Final = replace(
    RECORD, track_id="d.mp3", path=Path("music/d.mp3"), query=QUERY
).unresolved(FailureReason.NO_RESULT)
UNAVAILABLE: Final = replace(
    RECORD, track_id="f.mp3", path=Path("music/f.mp3"), query=QUERY
).unresolved(FailureReason.SOURCE_UNAVAILABLE)
MUSIC: Final = Path("music")


def test_records_an_automatic_validation_with_its_candidate_and_scores() -> None:
    track = PlanTrack.of(AUTO)

    assert (track.state, track.resolution, track.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BEATPORT,
    )
    assert track.candidate == track_candidate()
    assert track.scores == PlanScores(
        artist=96.0, title=92.0, average=94.0, version_mismatch=False, number_mismatch=False
    )


def test_records_an_arbitration_with_the_list_set_aside() -> None:
    track = PlanTrack.of(HELD)

    assert track.arbitration is not None
    assert track.arbitration.source is Source.BANDCAMP
    assert track.arbitration.other is not None
    assert track.arbitration.other.source is Source.BEATPORT


def test_records_a_recovery_by_url_without_scores() -> None:
    track = PlanTrack.of(BY_URL)

    assert (track.resolution, track.scores) == (Resolution.URL, None)


def test_records_the_reason_of_an_unresolved_track() -> None:
    track = PlanTrack.of(UNRESOLVED)

    assert (track.state, track.failure_reason) == (TrackState.UNRESOLVED, FailureReason.NO_RESULT)


def test_records_a_waiting_track_without_any_decision() -> None:
    track = PlanTrack.of(WAITING)

    assert (track.state, track.arbitration) == (None, None)


def test_keeps_the_tracks_in_the_order_of_the_folder() -> None:
    plan = plan_of(MUSIC, [WAITING, AUTO, HELD])

    assert list(plan.tracks) == ["e.mp3", "a.mp3", "b.mp3"]


def test_counts_as_processed_the_decided_tracks_and_those_awaiting_arbitration() -> None:
    plan = plan_of(MUSIC, [AUTO, HELD, BY_URL, UNRESOLVED, WAITING, UNAVAILABLE])

    processed = plan.processed_count()

    assert processed == 4


def test_names_the_plan_after_its_start_and_run(tmp_path: Path) -> None:
    plan = plan_of(MUSIC, [WAITING])

    path = plan_path(tmp_path, plan)

    assert path == tmp_path / "20261006T211403Z-a3f9c1.json"


def test_reloads_the_plan_it_wrote(tmp_path: Path) -> None:
    plan = plan_of(MUSIC, [AUTO, HELD, BY_URL, UNRESOLVED, WAITING])
    path = plan_path(tmp_path, plan)
    path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")

    reloaded = load_plan(path)

    assert reloaded == plan


def test_refuses_a_plan_of_an_unknown_version(tmp_path: Path) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")

    with pytest.raises(RunPlanUnreadableError) as refused:
        load_plan(path)

    assert (refused.value.code, refused.value.params) == (
        "run_plan_unreadable",
        {"file": path.name, "found": 2, "expected": 1},
    )


@pytest.mark.parametrize(
    "content",
    ["{not json", "[]", json.dumps({"schema_version": 1, "run_id": "a3f9c1"})],
    ids=["corrupt", "not-an-object", "invalid-model"],
)
def test_refuses_an_unreadable_plan(tmp_path: Path, content: str) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(RunPlanUnreadableError):
        load_plan(path)


def test_refuses_a_plan_with_inconsistent_thresholds(tmp_path: Path) -> None:
    plan = plan_of(MUSIC, [WAITING])
    path = plan_path(tmp_path, plan)
    inconsistent = plan.model_dump(mode="json") | {"thresholds": {"floor": 95, "ceiling": 80}}
    path.write_text(json.dumps(inconsistent), encoding="utf-8")

    with pytest.raises(RunPlanUnreadableError):
        load_plan(path)


def _live(*records: TrackRecord) -> LiveRun:
    return LiveRun("a3f9c1", MUSIC, records)


def _recorder(folder: Path, live: LiveRun) -> PlanRecorder:
    recorder = PlanRecorder(RunPlan.opened(live, DEFAULT_THRESHOLDS, CREATED), folder)
    live.observe(recorder.record)
    return recorder


def _on_disk(folder: Path, recorder: PlanRecorder) -> RunPlan:
    return load_plan(plan_path(folder, recorder.plan))


def _files(folder: Path) -> list[Path]:
    return list(folder.iterdir())


@pytest.mark.asyncio
async def test_leaves_the_last_state_of_each_track_on_disk(tmp_path: Path) -> None:
    live = _live(replace(RECORD, query=QUERY), WAITING)
    recorder = _recorder(tmp_path, live)
    live.update(replace(HELD, track_id=RECORD.track_id, path=RECORD.path))
    live.update(AUTO)
    live.update(replace(WAITING, query=QUERY).unresolved(FailureReason.BELOW_THRESHOLD))

    await recorder.flush()

    on_disk = _on_disk(tmp_path, recorder)
    assert (on_disk.tracks["a.mp3"].resolution, on_disk.tracks["a.mp3"].arbitration) == (
        Resolution.AUTO,
        None,
    )
    assert on_disk.tracks["e.mp3"].failure_reason is FailureReason.BELOW_THRESHOLD
    assert on_disk.processed_count() == 2


@pytest.mark.asyncio
async def test_merges_a_burst_of_decisions_into_few_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    writes: list[Path] = []

    def counting(path: Path, text: str) -> None:
        writes.append(path)
        write_atomically(path, text)

    monkeypatch.setattr(plan_module, "write_atomically", counting)
    records = music(tmp_path / "music", 20)
    live = _live(*records)
    recorder = _recorder(tmp_path / "plans", live)
    for record in records:
        live.update(record.unresolved(FailureReason.NO_RESULT))

    await recorder.flush()

    assert len(writes) <= 2
    assert _on_disk(tmp_path / "plans", recorder).processed_count() == 20


@pytest.mark.asyncio
async def test_writes_a_change_that_arrives_while_a_write_is_in_flight(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, plan_module, "write_atomically")
    live = _live(replace(RECORD, query=QUERY))
    recorder = _recorder(tmp_path, live)
    first = asyncio.create_task(recorder.flush(), name="first-flush")
    await held.wait_reached()
    live.update(AUTO)
    held.release.set()

    await first

    assert _on_disk(tmp_path, recorder).tracks["a.mp3"].resolution is Resolution.AUTO


@pytest.mark.asyncio
async def test_logs_a_plan_it_cannot_write_without_raising_or_leaking_the_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    full_disk = OSError(28, "No space left", "C:/private/profile/plans/x.json")
    monkeypatch.setattr(plan_module, "write_atomically", raising(full_disk))
    recorder = _recorder(tmp_path, _live(WAITING))

    await recorder.flush()

    assert _files(tmp_path) == []
    assert "run plan not written run=a3f9c1 reason=write_failed errno=28" in caplog.messages
    assert "private" not in caplog.text


@pytest.mark.asyncio
async def test_retries_a_failed_write_on_the_next_flush(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        plan_module, "write_atomically", raising(OSError(28, "No space left on device"))
    )
    recorder = _recorder(tmp_path, _live(WAITING))
    await recorder.flush()
    monkeypatch.setattr(plan_module, "write_atomically", write_atomically)

    await recorder.flush()

    assert _on_disk(tmp_path, recorder).run_id == "a3f9c1"


@pytest.mark.asyncio
async def test_confirms_the_plan_on_disk(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))

    await recorder.commit()

    assert _on_disk(tmp_path, recorder).committed


@pytest.mark.asyncio
async def test_confirms_without_raising_when_the_plan_cannot_be_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        plan_module, "write_atomically", raising(OSError(28, "No space left on device"))
    )
    recorder = _recorder(tmp_path, _live(AUTO))

    await recorder.commit()

    assert recorder.plan.committed


@pytest.mark.asyncio
async def test_stops_recording_once_committed(tmp_path: Path) -> None:
    live = _live(AUTO)
    recorder = _recorder(tmp_path, live)
    await recorder.commit()
    live.update(AUTO.write_failed(FileFailureReason.FILE_LOCKED, restorable=False))

    await recorder.flush()

    assert _on_disk(tmp_path, recorder).tracks["a.mp3"].state is TrackState.RESOLVED


@pytest.mark.asyncio
async def test_reopens_a_committed_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))
    await recorder.commit()

    await recorder.reopen()

    assert not _on_disk(tmp_path, recorder).committed


@pytest.mark.asyncio
async def test_discarding_deletes_the_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(WAITING))
    await recorder.flush()

    await recorder.discard()

    assert _files(tmp_path) == []


@pytest.mark.asyncio
async def test_records_nothing_once_discarded(tmp_path: Path) -> None:
    live = _live(replace(RECORD, query=QUERY))
    recorder = _recorder(tmp_path, live)
    await recorder.discard()
    live.update(AUTO)

    await recorder.flush()

    assert _files(tmp_path) == []


@pytest.mark.asyncio
async def test_discarding_keeps_a_committed_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))
    await recorder.commit()

    await recorder.discard()

    assert _on_disk(tmp_path, recorder).committed


def test_discards_a_plan_file(tmp_path: Path) -> None:
    path = save_plan(tmp_path, plan_of(MUSIC, [WAITING]))

    discard_plan(path)

    assert not path.exists()


def test_logs_a_plan_file_it_cannot_discard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    path = save_plan(tmp_path, plan_of(MUSIC, [WAITING]))
    monkeypatch.setattr(Path, "unlink", raising(PermissionError(13, "Permission denied")))

    discard_plan(path)

    assert path.exists()
    assert "run plan not discarded run=a3f9c1 reason=unlink_failed" in caplog.messages


def _plan_file(folder: Path, age: timedelta, run_id: str, *, committed: bool = False) -> Path:
    plan = plan_of(MUSIC, [WAITING], run_id=run_id, started_at=CREATED - age, committed=committed)
    return save_plan(folder, plan)


def test_purges_the_plans_that_will_never_be_resumed(tmp_path: Path) -> None:
    committed = _plan_file(tmp_path, timedelta(days=1), "1b2c3d", committed=True)
    open_recent = _plan_file(tmp_path, timedelta(days=3), "4d5e6f")
    open_expired = _plan_file(tmp_path, timedelta(days=31), "7a8b9c")
    unknown_version = tmp_path / "20261003T000000Z-9e8f7a.json"
    unknown_version.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")
    orphan = tmp_path / "20261006T000000Z-2c3d4e.tmp"
    orphan.write_text("{", encoding="utf-8")
    foreign = [tmp_path / "notes.json", tmp_path / "notes.tmp"]
    for path in foreign:
        path.write_text("{}", encoding="utf-8")

    purge_plans(tmp_path, CREATED)

    assert set(tmp_path.iterdir()) == {open_recent, unknown_version, *foreign}
    assert not committed.exists()
    assert not open_expired.exists()
    assert not orphan.exists()


def test_purge_ignores_a_missing_folder(tmp_path: Path) -> None:
    purge_plans(tmp_path / "plans", CREATED)

    assert not (tmp_path / "plans").exists()


def test_purge_carries_on_after_a_plan_it_cannot_delete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    locked = _plan_file(tmp_path, timedelta(days=40), "1b2c3d")
    expired = _plan_file(tmp_path, timedelta(days=35), "9e8f7a")
    real_unlink = Path.unlink

    def unlink_unless_locked(self: Path, missing_ok: bool = False) -> None:
        if self == locked:
            raise PermissionError(13, "Permission denied")
        real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", unlink_unless_locked)

    purge_plans(tmp_path, CREATED)

    assert locked.exists()
    assert not expired.exists()
    assert "run plan not purged run=1b2c3d reason=unlink_failed" in caplog.messages
