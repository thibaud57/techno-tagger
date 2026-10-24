import asyncio
import json
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Final

import pytest
from fs_listing import files
from ndjson_loop import held_call
from run_plans import music, plan_of, save_plan, save_plan_document
from scraper_responses import track_candidate
from stubs import locked_file, raising, spying, unlink_except
from tagging_records import (
    CREATED,
    FIRST_TRACK,
    FOURTH_RUN_ID,
    GLOB_RUN,
    MUSIC,
    RECORD,
    RUN_ID,
    SECOND_RUN_ID,
    SECOND_TRACK,
    THIRD_RUN_ID,
    THIRD_TRACK,
    UNKNOWN_RUN,
    UNREADABLE_CONTENTS,
    awaiting,
    named,
    resolved,
    scored_candidate,
    unresolved,
    waiting,
    write_failed_record,
)

from tagger.core.file_failures import FileFailureReason
from tagger.core.run_files import write_atomically
from tagger.resolution.matching import DEFAULT_THRESHOLDS, MatchingThresholds
from tagger.resolution.scraper_client import Source
from tagger.run import plan as plan_module
from tagger.run.models import (
    FailureReason,
    LiveRun,
    PendingArbitration,
    Resolution,
    Resolved,
    SourceList,
    TrackState,
)
from tagger.run.plan import (
    PlanRecorder,
    PlanScores,
    PlanThresholds,
    PlanTrack,
    RunPlan,
    RunPlanUnreadableError,
    discard_plan,
    find_plan,
    load_plan,
    plan_path,
    purge_plans,
)

if TYPE_CHECKING:
    from tagger.core.identifiers import RunId
    from tagger.run.models import NetworkOutcome, TrackRecord

WAITING: Final = named("e.mp3")
AUTO: Final = resolved(
    RECORD,
    Resolution.AUTO,
    candidate=track_candidate(),
    scored=scored_candidate(artist=96.0, title=92.0),
    artwork=Path("cache/artworks/cover.jpg"),
)
HELD: Final = awaiting(
    named(SECOND_TRACK),
    PendingArbitration(
        Source.BANDCAMP,
        (scored_candidate(),),
        beatport_unavailable=False,
        other=SourceList(Source.BEATPORT, (scored_candidate(artist=80.0, title=75.0),)),
    ),
)
BY_URL: Final = resolved(
    named(THIRD_TRACK),
    Resolution.URL,
    source=Source.BANDCAMP,
    candidate=track_candidate(track_id="42"),
    query=None,
)
UNRESOLVED: Final = unresolved(named("d.mp3"), FailureReason.NO_RESULT)
UNAVAILABLE: Final = unresolved(named("f.mp3"), FailureReason.SOURCE_UNAVAILABLE)
NO_QUERY: Final = unresolved(named("g.mp3"), FailureReason.EMPTY_QUERY, query=None)

# Morceaux ecrits a la main au schema courant : ce que le disque porte, sans passer par le modele.
_QUERY_JSON: Final = {"artist": "Adam Beyer", "title": "Your Mind", "origin": "tags"}
_CANDIDATE_JSON: Final = {
    "id": "1",
    "title": "Your Mind",
    "mix_name": "Original Mix",
    "artists": [{"name": "Adam Beyer"}],
    "source": "beatport",
}


def _scores_json(artist: float, title: float, average: float) -> dict[str, object]:
    return {
        "artist": artist,
        "title": title,
        "average": average,
        "version_mismatch": False,
        "number_mismatch": False,
    }


def _unresolved_json(reason: str, *, with_query: bool = True) -> dict[str, object]:
    track: dict[str, object] = {
        "state": "unresolved",
        "resolution": "none",
        "failure_reason": reason,
    }
    return (track | {"query": _QUERY_JSON}) if with_query else track


CURRENT_SCHEMA_TRACKS: Final = {
    "never.mp3": {},
    "held.mp3": {
        "query": _QUERY_JSON,
        "arbitration": {
            "source": "bandcamp",
            "candidates": [
                {"candidate": _CANDIDATE_JSON, "scores": _scores_json(96.4, 91.6, 94.0)}
            ],
            "beatport_unavailable": False,
            "other": {
                "source": "beatport",
                "candidates": [
                    {"candidate": _CANDIDATE_JSON, "scores": _scores_json(80.0, 75.0, 77.5)}
                ],
            },
        },
    },
    "unresolved.mp3": _unresolved_json("no_result"),
    "unavailable.mp3": _unresolved_json("source_unavailable"),
    "empty-query.mp3": _unresolved_json("empty_query", with_query=False),
    "auto.mp3": {
        "state": "resolved",
        "resolution": "auto",
        "source": "beatport",
        "query": _QUERY_JSON,
        "candidate": _CANDIDATE_JSON,
        "scores": _scores_json(96.0, 92.0, 94.0),
    },
    "by-url.mp3": {
        "state": "resolved",
        "resolution": "url",
        "source": "bandcamp",
        "candidate": _CANDIDATE_JSON | {"id": "42"},
    },
}


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

    assert list(plan.tracks) == [WAITING.track_id, FIRST_TRACK, SECOND_TRACK]


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


def test_reads_a_plan_written_by_the_current_schema(tmp_path: Path) -> None:
    path = save_plan_document(tmp_path, CURRENT_SCHEMA_TRACKS)

    restored = {
        track_id: track.applied_to(RECORD).outcome
        for track_id, track in load_plan(path).tracks.items()
    }

    assert restored == {
        "never.mp3": WAITING.outcome,
        "held.mp3": HELD.outcome,
        "unresolved.mp3": UNRESOLVED.outcome,
        "unavailable.mp3": UNAVAILABLE.outcome,
        "empty-query.mp3": NO_QUERY.outcome,
        "auto.mp3": _without_artwork(AUTO).outcome,
        "by-url.mp3": BY_URL.outcome,
    }


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
    [
        *UNREADABLE_CONTENTS,
        pytest.param(json.dumps({"schema_version": 1, "run_id": RUN_ID}), id="invalid-model"),
    ],
)
def test_refuses_an_unreadable_plan_without_naming_a_version(tmp_path: Path, content: str) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(RunPlanUnreadableError) as error:
        load_plan(path)

    assert error.value.found is None


def test_refuses_a_plan_with_inconsistent_thresholds(tmp_path: Path) -> None:
    plan = plan_of(MUSIC, [WAITING])
    path = plan_path(tmp_path, plan)
    inconsistent = plan.model_dump(mode="json") | {"thresholds": {"floor": 95, "ceiling": 80}}
    path.write_text(json.dumps(inconsistent), encoding="utf-8")

    with pytest.raises(RunPlanUnreadableError):
        load_plan(path)


def _fields(record: TrackRecord[NetworkOutcome], **broken: object) -> dict[str, object]:
    """Champs a plat d'un morceau coherent, dont `broken` n'en casse qu'un."""
    return PlanTrack.of(record).model_dump(mode="json") | broken


@pytest.mark.parametrize(
    "fields",
    [
        _fields(AUTO, candidate=None),
        _fields(AUTO, resolution="none"),
        _fields(AUTO, failure_reason="no_result"),
        _fields(AUTO, state="written"),
        _fields(UNRESOLVED, failure_reason=None),
        _fields(HELD, query=None),
        _fields(WAITING, resolution="auto"),
        _fields(WAITING, query=_QUERY_JSON),
    ],
    ids=[
        "resolved-without-candidate",
        "resolved-with-resolution-none",
        "resolved-with-a-reason",
        "written-state",
        "unresolved-without-reason",
        "arbitration-without-query",
        "resolution-without-state",
        "query-alone",
    ],
)
def test_refuses_a_plan_with_an_incoherent_track(tmp_path: Path, fields: dict[str, object]) -> None:
    path = save_plan_document(tmp_path, {"a.mp3": fields})

    with pytest.raises(RunPlanUnreadableError) as refused:
        load_plan(path)

    assert "matches no outcome" in str(refused.value.__cause__)


def _live(*records: TrackRecord) -> LiveRun:
    return LiveRun(RUN_ID, MUSIC, records)


def _recorder(folder: Path, live: LiveRun) -> PlanRecorder:
    recorder = PlanRecorder(RunPlan.opened(live, DEFAULT_THRESHOLDS, CREATED), folder)
    live.observe(recorder.record)
    return recorder


def _on_disk(folder: Path) -> RunPlan:
    path = find_plan(folder, RUN_ID)
    assert path is not None
    return load_plan(path)


@pytest.mark.asyncio
async def test_leaves_the_last_state_of_each_track_on_disk(tmp_path: Path) -> None:
    live = _live(RECORD, WAITING)
    recorder = _recorder(tmp_path, live)
    live.update(replace(HELD, track_id=RECORD.track_id, path=RECORD.path))
    live.update(AUTO)
    live.update(unresolved(WAITING, FailureReason.BELOW_THRESHOLD))

    await recorder.flush()

    on_disk = _on_disk(tmp_path)
    assert (on_disk.tracks[FIRST_TRACK].resolution, on_disk.tracks[FIRST_TRACK].arbitration) == (
        Resolution.AUTO,
        None,
    )
    assert on_disk.tracks[WAITING.track_id].failure_reason is FailureReason.BELOW_THRESHOLD
    assert on_disk.processed_count() == 2


@pytest.mark.asyncio
async def test_merges_a_burst_of_decisions_into_few_writes(
    music_folder: Path, plans: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    writes: list[Path] = []
    monkeypatch.setattr(plan_module, "write_atomically", spying(write_atomically, writes))
    records = music(music_folder, 20)
    live = _live(*records)
    recorder = _recorder(plans, live)
    for record in records:
        live.update(unresolved(record, FailureReason.NO_RESULT))

    await recorder.flush()

    assert len(writes) <= 2
    assert _on_disk(plans).processed_count() == 20


@pytest.mark.asyncio
async def test_writes_a_change_that_arrives_while_a_write_is_in_flight(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, plan_module, "write_atomically")
    live = _live(RECORD)
    recorder = _recorder(tmp_path, live)
    first = asyncio.create_task(recorder.flush(), name="first-flush")
    await held.wait_reached()
    live.update(AUTO)
    held.release.set()

    await first

    assert _on_disk(tmp_path).tracks[FIRST_TRACK].resolution is Resolution.AUTO


@pytest.mark.asyncio
async def test_logs_a_plan_it_cannot_write_without_raising_or_leaking_the_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    full_disk = OSError(28, "No space left", "C:/private/profile/plans/x.json")
    monkeypatch.setattr(plan_module, "write_atomically", raising(full_disk))
    recorder = _recorder(tmp_path, _live(WAITING))

    await recorder.flush()

    assert files(tmp_path) == []
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

    assert _on_disk(tmp_path).run_id == RUN_ID


@pytest.mark.asyncio
async def test_confirms_the_plan_on_disk(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))

    await recorder.commit()

    assert _on_disk(tmp_path).committed


@pytest.mark.asyncio
async def test_keeps_the_confirmation_to_write_when_the_plan_cannot_be_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        plan_module, "write_atomically", raising(OSError(28, "No space left on device"))
    )
    recorder = _recorder(tmp_path, _live(AUTO))
    await recorder.commit()
    monkeypatch.setattr(plan_module, "write_atomically", write_atomically)

    await recorder.flush()

    assert _on_disk(tmp_path).committed


@pytest.mark.asyncio
async def test_stops_recording_once_committed(tmp_path: Path) -> None:
    live = _live(AUTO)
    recorder = _recorder(tmp_path, live)
    await recorder.commit()
    live.update(write_failed_record(AUTO, FileFailureReason.FILE_LOCKED))

    await recorder.flush()

    assert _on_disk(tmp_path).tracks[FIRST_TRACK].state is TrackState.RESOLVED


@pytest.mark.asyncio
async def test_reopens_a_committed_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))
    await recorder.commit()

    await recorder.reopen()

    assert not _on_disk(tmp_path).committed


@pytest.mark.asyncio
async def test_discarding_deletes_the_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(WAITING))
    await recorder.flush()

    await recorder.discard()

    assert files(tmp_path) == []


@pytest.mark.asyncio
async def test_records_nothing_once_discarded(tmp_path: Path) -> None:
    live = _live(RECORD)
    recorder = _recorder(tmp_path, live)
    await recorder.discard()
    live.update(AUTO)

    await recorder.flush()

    assert files(tmp_path) == []


@pytest.mark.asyncio
async def test_discarding_keeps_a_committed_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))
    await recorder.commit()

    await recorder.discard()

    assert _on_disk(tmp_path).committed


def test_finds_a_plan_by_its_run(tmp_path: Path) -> None:
    path = save_plan(tmp_path, plan_of(MUSIC, [WAITING]))
    save_plan(tmp_path, plan_of(MUSIC, [WAITING], run_id=SECOND_RUN_ID))

    found = find_plan(tmp_path, RUN_ID)

    assert found == path


@pytest.mark.parametrize("run_id", [UNKNOWN_RUN, GLOB_RUN], ids=["unknown-run", "glob-pattern"])
def test_finds_no_plan_for_an_unknown_run(tmp_path: Path, run_id: RunId) -> None:
    save_plan(tmp_path, plan_of(MUSIC, [WAITING]))

    found = find_plan(tmp_path, run_id)

    assert found is None


def test_discards_a_plan_file(tmp_path: Path) -> None:
    path = save_plan(tmp_path, plan_of(MUSIC, [WAITING]))

    discard_plan(path)

    assert not path.exists()


def test_logs_a_plan_file_it_cannot_discard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    path = save_plan(tmp_path, plan_of(MUSIC, [WAITING]))
    monkeypatch.setattr(Path, "unlink", locked_file())

    discard_plan(path)

    assert path.exists()
    assert "run plan not discarded run=a3f9c1 reason=unlink_failed" in caplog.messages


def _plan_file(folder: Path, age: timedelta, run_id: RunId, *, committed: bool = False) -> Path:
    plan = plan_of(MUSIC, [WAITING], run_id=run_id, started_at=CREATED - age, committed=committed)
    return save_plan(folder, plan)


def test_purges_the_plans_that_will_never_be_resumed(tmp_path: Path) -> None:
    committed = _plan_file(tmp_path, timedelta(days=1), THIRD_RUN_ID, committed=True)
    open_recent = _plan_file(tmp_path, timedelta(days=3), FOURTH_RUN_ID)
    open_expired = _plan_file(tmp_path, timedelta(days=31), RUN_ID)
    unknown_version = tmp_path / "20261003T000000Z-9e8f7a.json"
    unknown_version.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")
    orphan = tmp_path / "20261006T000000Z-2c3d4e.tmp"
    orphan.write_text("{", encoding="utf-8")
    foreign = [tmp_path / "notes.json", tmp_path / "notes.tmp"]
    for path in foreign:
        path.write_text("{}", encoding="utf-8")

    purge_plans(tmp_path, CREATED)

    assert set(files(tmp_path)) == {open_recent, unknown_version, *foreign}
    assert not committed.exists()
    assert not open_expired.exists()
    assert not orphan.exists()


def test_purge_ignores_a_missing_folder(plans: Path) -> None:
    purge_plans(plans, CREATED)

    assert not plans.exists()


def test_purge_carries_on_after_a_plan_it_cannot_delete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    locked = _plan_file(tmp_path, timedelta(days=40), THIRD_RUN_ID)
    expired = _plan_file(tmp_path, timedelta(days=35), SECOND_RUN_ID)

    monkeypatch.setattr(Path, "unlink", unlink_except(locked))

    purge_plans(tmp_path, CREATED)

    assert locked.exists()
    assert not expired.exists()
    assert f"run plan not purged run={THIRD_RUN_ID} reason=unlink_failed" in caplog.messages


@pytest.mark.parametrize(
    "record",
    [AUTO, HELD, BY_URL, UNRESOLVED, WAITING],
    ids=["auto", "held", "by-url", "unresolved", "waiting"],
)
def test_gives_back_the_decision_it_recorded(record: TrackRecord[NetworkOutcome]) -> None:
    restored = PlanTrack.of(record).applied_to(waiting(record))

    assert restored == _without_artwork(record)


def _without_artwork(record: TrackRecord) -> TrackRecord:
    """Le plan ne garde aucune pochette : elle se retelecharge a la reprise."""
    outcome = record.outcome
    if not isinstance(outcome, Resolved):
        return record
    return record.with_outcome(replace(outcome, retained=replace(outcome.retained, artwork=None)))


def test_gives_back_the_thresholds_of_the_run() -> None:
    thresholds = PlanThresholds(floor=60, ceiling=85)

    restored = thresholds.to_matching()

    assert restored == MatchingThresholds(floor=60, ceiling=85)
