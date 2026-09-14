"""Execution d'une commande validee : du modele du protocole au metier, puis a
l'evenement.

Separe de `__main__.py` pour que le point d'entree reste le moteur et le routage :
le contrat compte quatre commandes ici et une quinzaine a terme.
"""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from tagger import RELEASE
from tagger.extraction import extract
from tagger.playlists import list_playlists, read_playlist
from tagger.protocol import (
    DiscardedCandidatePayload,
    DuplicatePayload,
    ExtractionFinished,
    ExtractPlaylist,
    FailurePayload,
    ListPlaylists,
    Phase,
    PlaylistEntry,
    PlaylistsListed,
    Progress,
    Version,
)
from tagger.reports import ReportContext, write_extraction_report

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)


def handle_get_version() -> Version:
    """Rend la version du sidecar, comparee a celle de l'interface avant tout run.

    `api_key_configured` reste faux tant que la lecture du trousseau n'est pas
    implementee : elle appartient au sub-project des Settings, et l'extraction par
    playlist n'appelle aucune API.
    """
    return Version(event="version", version=RELEASE, api_key_configured=False)


def handle_list_playlists(command: ListPlaylists) -> PlaylistsListed:
    """Liste les playlists d'un dump VLC pour alimenter le selecteur."""
    listing = list_playlists(command.playlist_path)

    return PlaylistsListed(
        event="playlists_listed",
        playlist_format=listing.playlist_format,
        playlists=tuple(
            PlaylistEntry(
                playlist_id=summary.playlist_id,
                name=summary.name,
                track_count=summary.track_count,
            )
            for summary in listing.playlists
        ),
    )


def handle_extract_playlist(
    command: ExtractPlaylist, on_progress: Callable[[Progress], None]
) -> ExtractionFinished:
    """Lit la playlist, extrait ses morceaux, ecrit le rapport.

    Le module d'extraction ignore le protocole : il recoit un rappel `(traites,
    total)` que ce handler traduit en evenement.
    """
    file_names = read_playlist(command.playlist_path, command.playlist_name)

    def report_progress(processed: int, total: int) -> None:
        on_progress(
            Progress(event="progress", phase=Phase.EXTRACTION, processed=processed, total=total)
        )

    result = extract(
        file_names,
        command.source_folder,
        command.destination_folder,
        mode=command.mode,
        on_progress=report_progress,
    )

    paths = write_extraction_report(
        result,
        ReportContext(
            source_folder=command.source_folder,
            destination_folder=command.destination_folder,
            playlist_path=command.playlist_path,
            playlist_name=command.playlist_name,
            mode=command.mode,
            generated_at=datetime.now(UTC),
        ),
    )
    # Sans compteurs : aucune cle du jeu logfmt fixe ne les porte, et le rapport ecrit
    # juste avant les detaille deja.
    logger.info("extraction finished")

    return ExtractionFinished(
        event="extraction_finished",
        extracted=result.extracted,
        already_present=result.already_present,
        missing=result.missing,
        duplicates=tuple(
            DuplicatePayload(
                file_name=duplicate.file_name,
                kept_path=duplicate.kept_path,
                kept_size=duplicate.kept_size,
                criterion=duplicate.criterion,
                discarded=tuple(
                    DiscardedCandidatePayload(path=candidate.path, size=candidate.size)
                    for candidate in duplicate.discarded
                ),
            )
            for duplicate in result.duplicates
        ),
        failures=tuple(
            FailurePayload(file_name=failure.file_name, reason=failure.reason)
            for failure in result.failures
        ),
        report_path=paths.json_path,
    )
