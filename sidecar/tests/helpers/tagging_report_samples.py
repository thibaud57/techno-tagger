"""Run couvrant chaque issue, partage par les tests du rapport de re-tagging."""

from dataclasses import replace
from pathlib import Path
from typing import Final

from scraper_responses import payload_candidate
from tagging_records import RECORD, scored_candidate

from tagger.file_failures import FileFailureReason
from tagger.files import ShownTags, TagField, TagSystem, WrittenTags
from tagger.matching import QueryOrigin, TrackQuery
from tagger.scraper_client import Source
from tagger.tagging import (
    FailureReason,
    PendingArbitration,
    Resolution,
    TaggingRun,
    TrackRecord,
    WriteOutcome,
)

FOLDER: Final = Path("music")
QUERY: Final = TrackQuery("Lior Vance", "Dim Orbit", QueryOrigin.TAGS)
# Toute la table, absente comprise : `after_tags` lit chaque champ d'origine.
BEFORE: Final = ShownTags(
    system=TagSystem.ID3,
    fields=dict.fromkeys(TagField) | {TagField.ARTIST: "lior vance", TagField.TITLE: "dim orbit"},
    comment="ripped from vinyl",
)
CANDIDATE: Final = payload_candidate()
WRITTEN_AS: Final = "Lior Vance - Dim Orbit (Extended Mix).mp3"


def _record(name: str) -> TrackRecord:
    return replace(RECORD, track_id=name, path=FOLDER / name, query=QUERY, tags_before=BEFORE)


def _resolved(name: str, resolution: Resolution, source: Source) -> TrackRecord:
    return _record(name).resolved(
        resolution, source, CANDIDATE, scored_candidate(candidate=CANDIDATE), None
    )


WRITTEN: Final = _resolved("a.mp3", Resolution.AUTO, Source.BEATPORT).written_to(
    FOLDER / WRITTEN_AS,
    WriteOutcome(WrittenTags((TagField.ARTIST, TagField.TITLE), artwork=True), truncated=True),
)
FAILED: Final = _resolved("b.mp3", Resolution.ARBITRATION, Source.BANDCAMP).write_failed(
    FileFailureReason.FILE_LOCKED, restorable=False
)
UNRESOLVED: Final = _record("c.mp3").unresolved(FailureReason.NO_RESULT)
WAITING: Final = _record("d.mp3")
HELD: Final = replace(
    _record("e.mp3"),
    arbitration=PendingArbitration(
        Source.BEATPORT, (scored_candidate(),), beatport_unavailable=False
    ),
)
# Ecrit puis restaure : `rolled_back` efface la source et le candidat, la resolution reste.
ROLLED_BACK: Final = (
    _resolved("f.mp3", Resolution.AUTO, Source.BEATPORT)
    .written_to(
        FOLDER / "f - renamed.mp3",
        WriteOutcome(WrittenTags((TagField.ARTIST,), artwork=False), truncated=False),
    )
    .rolled_back(FOLDER / "f.mp3")
)
RUN: Final = TaggingRun("a3f9c1", FOLDER, (WRITTEN, FAILED, UNRESOLVED, WAITING, HELD, ROLLED_BACK))
