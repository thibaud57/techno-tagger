"""Issue de retour de matching : le depot est public, seul ce que la liste fermee laisse
passer en sort (ADR-014).
"""

import json
import re
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Final
from urllib.parse import parse_qs, unquote_plus, urlsplit

import pytest
from fs_listing import files
from repo_files import REPO
from tagging_records import CREATED, RUN_ID
from tagging_report_samples import COMMENT, HOME_FOLDER, report_of, report_track

from tagger import RELEASE, REPOSITORY_URL
from tagger.core.file_failures import FileFailureReason
from tagger.core.run_files import stamped_name
from tagger.reports.feedback import (
    EXPORT_FIELD,
    ISSUE_TEMPLATE,
    MAX_URL_LENGTH,
    SUMMARY_FIELD,
    VERSION_FIELD,
    FeedbackExportWriteError,
    export_path,
    feedback_issue_url,
    purge_feedback_exports,
    write_feedback_export,
)
from tagger.run.models import FailureReason, Resolution, TrackState

if TYPE_CHECKING:
    from pathlib import Path

TEMPLATE: Final = REPO / ".github" / "ISSUE_TEMPLATE" / ISSUE_TEMPLATE
# Ce que ni l'URL ni l'export ne doivent laisser passer : compte de l'OS, dossier du run,
# sous-dossier d'un morceau et commentaire d'origine.
LEAKS: Final = ("jane", "Private Party", "Night Shift", COMMENT)


def test_the_issue_form_declares_every_field_the_url_fills() -> None:
    """Un `id` absent du formulaire est ignore par GitHub sans erreur : le champ arriverait
    vide et rien ne le signalerait.
    """
    declared = set(re.findall(r"^\s+id:\s*(\S+)\s*$", TEMPLATE.read_text(encoding="utf-8"), re.M))

    assert {VERSION_FIELD, SUMMARY_FIELD, EXPORT_FIELD} <= declared


TRACK_KEYS: Final = {
    "file_before",
    "file_after",
    "truncated",
    "query",
    "source",
    "state",
    "resolution",
    "failure_reason",
    "scores",
    "artist",
    "title",
    "url",
    "tags_before",
    "tags_after",
    "fields_written",
    "artwork_written",
}


def test_the_export_keeps_only_the_closed_list_of_fields(tmp_path: Path) -> None:
    report = report_of(report_track("a.mp3"))

    path = write_feedback_export(tmp_path, report, RELEASE)

    exported = json.loads(path.read_text(encoding="utf-8"))
    assert set(exported) == {"kind", "release", "generated_at", "thresholds", "counts", "tracks"}
    assert exported["release"] == RELEASE
    assert set(exported["tracks"][0]) == TRACK_KEYS


def test_the_export_leaves_out_the_run_folder_its_subfolders_and_the_comment(
    tmp_path: Path,
) -> None:
    report = report_of(report_track("Night Shift/a.mp3"), folder=HOME_FOLDER)

    path = write_feedback_export(tmp_path, report, RELEASE)

    content = path.read_text(encoding="utf-8")
    assert json.loads(content)["tracks"][0]["file_before"] == "a.mp3"
    assert not [part for part in LEAKS if part in content]


def test_the_export_keeps_only_the_name_of_the_renamed_file(tmp_path: Path) -> None:
    track = report_track("Night Shift/a.mp3", file_after="Night Shift/Adam Beyer - Your Mind.mp3")
    report = report_of(track, folder=HOME_FOLDER)

    path = write_feedback_export(tmp_path, report, RELEASE)

    content = path.read_text(encoding="utf-8")
    assert json.loads(content)["tracks"][0]["file_after"] == "Adam Beyer - Your Mind.mp3"
    assert "Night Shift" not in content


def test_a_second_export_of_the_same_run_rewrites_the_same_file(tmp_path: Path) -> None:
    report = report_of(report_track("a.mp3"))
    first = write_feedback_export(tmp_path, report, RELEASE)

    second = write_feedback_export(tmp_path, report, RELEASE)

    assert second == first
    assert files(tmp_path) == [first]


def test_an_export_that_cannot_be_written_names_its_file(tmp_path: Path) -> None:
    blocker = tmp_path / "feedback"
    blocker.write_text("", encoding="utf-8")
    report = report_of(report_track("a.mp3"))

    with pytest.raises(FeedbackExportWriteError) as error:
        write_feedback_export(blocker, report, RELEASE)

    assert error.value.params == {"file": export_path(blocker, report).name}


def test_an_export_that_cannot_be_serialized_names_its_file(tmp_path: Path) -> None:
    report = report_of(report_track("broken-\udc80.mp3"))

    with pytest.raises(FeedbackExportWriteError) as error:
        write_feedback_export(tmp_path, report, RELEASE)

    assert error.value.params == {"file": export_path(tmp_path, report).name}
    assert files(tmp_path) == []


def test_the_purge_removes_an_export_past_the_retention_and_keeps_a_recent_one(
    tmp_path: Path,
) -> None:
    now = datetime(2026, 10, 16, 9, 0, tzinfo=UTC)
    expired = tmp_path / stamped_name(now - timedelta(days=31), "a1b2c3", ".json")
    recent = tmp_path / stamped_name(now - timedelta(days=2), "d4e5f6", ".json")
    for path in (expired, recent):
        path.write_text("{}", encoding="utf-8")

    purge_feedback_exports(tmp_path, now)

    assert files(tmp_path) == [recent]


EXPORT_NAME: Final = stamped_name(CREATED, RUN_ID, ".json")
# Hauteur approximative d'une ligne de la table, en caracteres encodes : la derniere garde ne
# laisse jamais plus de place que cela, sans quoi le remplissage s'est arrete trop tot.
ROW_HEIGHT: Final = 200


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlsplit(url).query)


def _summary(url: str) -> str:
    return _query(url)[SUMMARY_FIELD][0]


def _rows(url: str) -> list[str]:
    """Lignes de la table, en-tete et separateur exclus : seul le fichier d'une ligne ouvre un
    code span.
    """
    return [line for line in _summary(url).splitlines() if line.startswith("| `")]


def _files_listed(url: str) -> list[str]:
    return [row.split(" | ")[0].removeprefix("| ").strip("`") for row in _rows(url)]


def test_the_url_opens_the_issue_form_of_the_repository_without_any_label() -> None:
    url = feedback_issue_url(report_of(report_track("a.mp3")), RELEASE, EXPORT_NAME)

    parts = urlsplit(url)
    query = _query(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == f"{REPOSITORY_URL}/issues/new"
    assert query["template"] == [ISSUE_TEMPLATE]
    assert "labels" not in query
    assert query[VERSION_FIELD] == [RELEASE]
    assert query[EXPORT_FIELD] == [f"Drop {EXPORT_NAME} here"]


def test_the_title_carries_the_counts_and_the_release() -> None:
    report = report_of(
        report_track("a.mp3"),
        report_track(
            "b.mp3", TrackState.UNRESOLVED, Resolution.NONE, failure_reason=FailureReason.NO_RESULT
        ),
    )

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _query(url)["title"] == [f"Matching report: 1 written, 1 unresolved ({RELEASE})"]


def test_the_tracks_that_say_the_most_about_matching_come_first() -> None:
    report = report_of(
        report_track("auto-high.mp3", average=97.0),
        report_track("auto-low.mp3", average=72.0),
        report_track(
            "locked.mp3",
            TrackState.WRITE_ERROR,
            failure_reason=FileFailureReason.FILE_LOCKED,
        ),
        report_track("arbitrated.mp3", resolution=Resolution.ARBITRATION),
        report_track("rescued.mp3", resolution=Resolution.URL),
        report_track(
            "missing.mp3",
            TrackState.UNRESOLVED,
            Resolution.NONE,
            failure_reason=FailureReason.NO_RESULT,
        ),
    )

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _files_listed(url) == [
        "missing.mp3",
        "rescued.mp3",
        "arbitrated.mp3",
        "locked.mp3",
        "auto-low.mp3",
        "auto-high.mp3",
    ]


def test_a_rolled_back_or_unprocessed_track_is_counted_but_never_listed() -> None:
    report = report_of(
        report_track("a.mp3"),
        report_track("restored.mp3", TrackState.ROLLED_BACK, None),
        report_track("waiting.mp3", None, None),
    )

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _files_listed(url) == ["a.mp3"]
    assert "rolled back 1, not processed 1" in _summary(url)


def test_a_cell_holding_a_pipe_or_a_line_break_keeps_the_table_whole() -> None:
    report = report_of(report_track("a.mp3", title="Your | Mind\nRemix"))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert "`Adam Beyer - Your \\| Mind Remix`" in _summary(url)
    assert _files_listed(url) == ["a.mp3"]


def test_free_cells_are_code_spans_so_a_mention_or_a_reference_stays_inert() -> None:
    report = report_of(report_track("@jane #12.mp3", title="Your `Mind`"))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    row = _rows(url)[0]
    assert row.startswith("| `@jane #12.mp3` | `")
    assert row.endswith("| `Adam Beyer - Your 'Mind'` |")


def test_a_large_run_stays_within_the_url_budget_and_counts_what_it_leaves_out() -> None:
    tracks = tuple(
        report_track(f"track-{index:03}.mp3", average=70.0 + index % 30) for index in range(500)
    )

    url = feedback_issue_url(report_of(*tracks), RELEASE, EXPORT_NAME)

    listed = _files_listed(url)
    assert MAX_URL_LENGTH - ROW_HEIGHT < len(url) <= MAX_URL_LENGTH
    assert _summary(url).endswith(f"_{500 - len(listed)} more tracks in the attached export._")


PADDINGS: Final = range(0, 60, 3)


@pytest.mark.parametrize("padding", PADDINGS, ids=[f"padding-{padding}" for padding in PADDINGS])
def test_the_line_about_omitted_tracks_counts_in_the_budget(padding: int) -> None:
    """Selon la longueur des lignes, la derniere garde laisse plus ou moins de place : sans la
    reserve de la ligne finale, certaines longueurs depasseraient la borne.
    """
    title = "Your Mind " + "x" * padding
    tracks = tuple(report_track(f"track-{index:03}.mp3", title=title) for index in range(500))

    url = feedback_issue_url(report_of(*tracks), RELEASE, EXPORT_NAME)

    assert len(url) <= MAX_URL_LENGTH


def test_a_run_that_fits_whole_has_no_line_about_omitted_tracks() -> None:
    report = report_of(report_track("a.mp3"), report_track("b.mp3"))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _files_listed(url) == ["a.mp3", "b.mp3"]
    assert "more tracks" not in _summary(url)


def test_non_ascii_titles_are_counted_at_their_encoded_length() -> None:
    tracks = tuple(
        report_track(f"{index:03}.mp3", title="Ñandú 夜明け Ünïcødé") for index in range(200)
    )

    url = feedback_issue_url(report_of(*tracks), RELEASE, EXPORT_NAME)

    assert len(url) <= MAX_URL_LENGTH


def test_a_lone_surrogate_in_a_file_name_still_gives_a_url_within_the_budget() -> None:
    """Windows laisse passer un nom de fichier qui n'est pas de l'UTF-16 valide : il ne doit pas
    faire lever l'encodage de l'URL.
    """
    report = report_of(report_track("broken-\udc80.mp3"))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert len(url) <= MAX_URL_LENGTH
    assert "broken-" in _summary(url)


def test_the_list_stops_at_the_first_row_that_no_longer_fits() -> None:
    """L'ordre de priorite n'est jamais inverse pour caser une ligne plus courte : la ligne
    rattrapee par lien, trop longue pour le budget restant, arrete la liste, et les quarante
    lignes courtes qui suivent ne passent pas devant elle.
    """
    unresolved = tuple(
        report_track(f"unresolved-{index}.mp3", TrackState.UNRESOLVED, Resolution.NONE)
        for index in range(8)
    )
    oversized = report_track("rescued.mp3", resolution=Resolution.URL, title="Extended " * 150)
    short = tuple(report_track(f"{index}.mp3") for index in range(40))

    url = feedback_issue_url(report_of(*unresolved, oversized, *short), RELEASE, EXPORT_NAME)

    assert _files_listed(url) == [track.file_before for track in unresolved]
    assert _summary(url).endswith("_41 more tracks in the attached export._")


def test_a_run_without_any_listable_track_keeps_the_counts_and_no_table() -> None:
    report = report_of(report_track("restored.mp3", TrackState.ROLLED_BACK, None))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _files_listed(url) == []
    assert "| File" not in _summary(url)
    assert "rolled back 1" in _summary(url)


def test_the_url_leaves_out_the_run_folder_its_subfolders_and_the_comment() -> None:
    report = report_of(report_track("Night Shift/a.mp3"), folder=HOME_FOLDER)

    url = unquote_plus(feedback_issue_url(report, RELEASE, EXPORT_NAME))

    assert not [part for part in (str(HOME_FOLDER), *LEAKS) if part in url]
