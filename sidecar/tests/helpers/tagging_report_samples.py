"""Run couvrant chaque issue, partage par les tests du rapport de re-tagging."""

from dataclasses import replace
from pathlib import Path
from typing import Final

from scraper_responses import BEATPORT_CANDIDATE
from tagging_records import RECORD, held, scored_candidate

from tagger.core.file_failures import FileFailureReason
from tagger.resolution.matching import QueryOrigin, TrackQuery
from tagger.resolution.scraper_client import Source
from tagger.run.models import FailureReason, Resolution, TaggingRun, TrackRecord, WriteOutcome
from tagger.tags.files import ShownTags, TagField, TagSystem, WrittenTags

FOLDER: Final = Path("music")
QUERY: Final = TrackQuery("Adam Beyer", "Your Mind", QueryOrigin.TAGS)
# Toute la table, absente comprise : `after_tags` lit chaque champ d'origine.
BEFORE: Final = ShownTags(
    system=TagSystem.ID3,
    fields=dict.fromkeys(TagField) | {TagField.ARTIST: "adam beyer", TagField.TITLE: "your mind"},
    comment="ripped from vinyl",
)
WRITTEN_AS: Final = "Adam Beyer - Your Mind (Extended Mix).mp3"


def _record(name: str) -> TrackRecord:
    return replace(RECORD, track_id=name, path=FOLDER / name, query=QUERY, tags_before=BEFORE)


def _resolved(name: str, resolution: Resolution, source: Source) -> TrackRecord:
    return _record(name).resolved(
        resolution, source, BEATPORT_CANDIDATE, scored_candidate(candidate=BEATPORT_CANDIDATE), None
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
HELD: Final = replace(_record("e.mp3"), arbitration=held())
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
