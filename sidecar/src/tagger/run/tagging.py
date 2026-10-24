"""Pipeline de resolution d'un run de re-tagging (use-case 2).

Il ignore le protocole NDJSON : les evenements sortent par un rappel, que le handler
traduit. Aucun fichier musical n'est ecrit ici (ADR-010). L'etat du run vit dans `run.models`.
"""

import asyncio
import copy
import logging
import secrets
from typing import TYPE_CHECKING, Final, assert_never, override

from tagger.resolution.matching import Outcome, ScoredCandidate, build_query, classify
from tagger.resolution.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
)
from tagger.resolution.sources import ApiKeyRejectedRunError
from tagger.run.models import (
    ArbitrationRequired,
    FailureReason,
    LiveRun,
    PendingArbitration,
    Resolution,
    RunEvent,
    RunProgress,
    RunStarted,
    TrackRecord,
    TrackResolved,
)
from tagger.tags.files import (
    IdentityTags,
    ShownTags,
    TagsUnreadableError,
    list_audio_files,
    read_shown_tags,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from tagger.resolution.sources import RunSources

logger = logging.getLogger(__name__)

# Tags illisibles : la requete se rabat sur le nom de fichier.
_NO_IDENTITY: Final = IdentityTags(artist="", title="")


async def open_run(folder: Path, *, on_event: Callable[[RunEvent], None]) -> LiveRun:
    """Liste les fichiers et lit leur identite, avant tout appel reseau."""
    paths = await asyncio.to_thread(list_audio_files, folder)
    run_id = secrets.token_hex(3)
    records = await read_identities(run_id, folder, paths)
    on_event(RunStarted(run_id, folder, tuple(records)))
    return LiveRun(run_id, folder, records)


async def resolve_run(
    live: LiveRun, sources: RunSources, *, on_event: Callable[[RunEvent], None]
) -> None:
    """Ne s'arrete jamais sur un morceau : seuls `API_KEY_REJECTION_LIMIT` 403 consecutifs
    arretent le run.

    Un morceau deja traite (run repris) n'est jamais renvoye a l'API : la progression part du
    nombre deja traite, sur le total du run.
    """
    tracks = live.snapshot().tracks
    waiting = [record for record in tracks if not record.decided]
    runner = _Runner(len(tracks), sources, live, on_event, processed=len(tracks) - len(waiting))
    try:
        async with asyncio.TaskGroup() as group:
            for record in waiting:
                position = live.position(record.track_id)
                group.create_task(runner.process(position, record), name=f"track:{position}")
    except* ApiKeyRejectedRunError:
        raise ApiKeyRejectedRunError from None


async def read_identities(run_id: str, folder: Path, paths: tuple[Path, ...]) -> list[TrackRecord]:
    """Identites lues avant tout appel reseau : la liste s'affiche entiere des le depart.

    Les lectures partent en parallele sur le pool de threads : enchainees, plusieurs centaines
    d'ouvertures tenaient la liste vide pendant des secondes. `return_exceptions=True` garde
    chaque tag illisible local a son morceau, seule `list_audio_files` devant arreter le run.
    """
    reads = await asyncio.gather(
        *(asyncio.to_thread(read_shown_tags, path) for path in paths), return_exceptions=True
    )
    shown = (
        (path, _shown_or_none(run_id, position, read))
        for position, (path, read) in enumerate(zip(paths, reads, strict=True), start=1)
    )
    return [
        TrackRecord(
            track_id=path.relative_to(folder).as_posix(),
            path=path,
            identity=_NO_IDENTITY if tags is None else tags.identity,
            tags_before=tags,
        )
        for path, tags in shown
    ]


def _shown_or_none(run_id: str, position: int, read: ShownTags | BaseException) -> ShownTags | None:
    match read:
        case ShownTags():
            return read
        case TagsUnreadableError():
            logger.warning(
                "tags unreadable, file name used run=%s track=%d reason=%s",
                run_id,
                position,
                read.reason,
            )
            return None
        case _:
            raise read


class _Runner:
    """Etat partage par les taches d'un run : compteur et acces aux sources."""

    def __init__(
        self,
        total: int,
        sources: RunSources,
        live: LiveRun,
        on_event: Callable[[RunEvent], None],
        *,
        processed: int,
    ) -> None:
        self._total = total
        self._sources = sources
        self._live = live
        self._on_event = on_event
        self._processed = processed

    @override
    def __repr__(self) -> str:
        return f"_Runner(processed={self._processed}, total={self._total})"

    async def process(self, position: int, record: TrackRecord) -> None:
        done = await self._resolve(position, record)
        self._live.update(done)
        event = ArbitrationRequired(done) if done.arbitration else TrackResolved(done)
        self._on_event(event)
        self._processed += 1
        self._on_event(RunProgress(processed=self._processed, total=self._total))

    # PLR0911, PLR0912 : une sortie par issue de la cascade (deux sources, trois classements
    # chacune) est plus lisible qu'un decoupage en sous-fonctions qui eclaterait l'etat.
    async def _resolve(self, position: int, record: TrackRecord) -> TrackRecord:  # noqa: PLR0911, PLR0912
        identity = record.identity
        query = build_query(identity.artist, identity.title, record.file_name)
        if query is None:
            return self._unresolved(position, record, FailureReason.EMPTY_QUERY)
        record = copy.replace(record, query=query)

        beatport_unavailable = False
        had_candidates = False
        try:
            found = await self._sources.search(Source.BEATPORT, query)
        except ApiKeyRejectedError:
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._sources.log_source_failure(position, Source.BEATPORT, exc)
            beatport_unavailable = True
        else:
            had_candidates = bool(found)
            classification = classify(query, found, self._sources.thresholds)
            match classification.outcome:
                case Outcome.AUTO:
                    return await self._accept(
                        position, record, Source.BEATPORT, classification.retained[0]
                    )
                case Outcome.GREY_ZONE:
                    return self._hold(
                        position,
                        record,
                        Source.BEATPORT,
                        classification.retained,
                        beatport_unavailable=False,
                    )
                case Outcome.EMPTY:
                    pass
                case _:
                    assert_never(classification.outcome)

        try:
            found = await self._sources.search(Source.BANDCAMP, query)
        except ApiKeyRejectedError:
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._sources.log_source_failure(position, Source.BANDCAMP, exc)
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        had_candidates = had_candidates or bool(found)
        # Beatport injoignable : Bandcamp ne valide jamais seul (decision du 2026-09-19).
        classification = classify(
            query, found, self._sources.thresholds, allow_auto=not beatport_unavailable
        )
        match classification.outcome:
            case Outcome.AUTO:
                return await self._accept(
                    position, record, Source.BANDCAMP, classification.retained[0]
                )
            case Outcome.GREY_ZONE:
                return self._hold(
                    position,
                    record,
                    Source.BANDCAMP,
                    classification.retained,
                    beatport_unavailable=beatport_unavailable,
                )
            case Outcome.EMPTY:
                # Beatport n'a jamais repondu : un classement definitif (`no_result`,
                # `below_threshold`) ne serait pas rejoue a la reprise.
                reason = (
                    FailureReason.SOURCE_UNAVAILABLE
                    if beatport_unavailable
                    else FailureReason.BELOW_THRESHOLD
                    if had_candidates
                    else FailureReason.NO_RESULT
                )
                return self._unresolved(position, record, reason)
            case _:
                assert_never(classification.outcome)

    async def _accept(
        self, position: int, record: TrackRecord, source: Source, chosen: ScoredCandidate
    ) -> TrackRecord:
        candidate, artwork = await self._sources.retained(position, source, chosen)
        logger.info(
            "candidate retained run=%s track=%d source=%s score=%.0f status=resolved",
            self._sources.run_id,
            position,
            source,
            chosen.score,
        )
        return record.resolved(Resolution.AUTO, source, candidate, chosen, artwork)

    def _hold(
        self,
        position: int,
        record: TrackRecord,
        source: Source,
        candidates: tuple[ScoredCandidate, ...],
        *,
        beatport_unavailable: bool,
    ) -> TrackRecord:
        logger.info(
            "arbitration required run=%s track=%d source=%s score=%.0f status=grey_zone",
            self._sources.run_id,
            position,
            source,
            candidates[0].score,
        )
        return copy.replace(
            record, arbitration=PendingArbitration(source, candidates, beatport_unavailable)
        )

    def _unresolved(self, position: int, record: TrackRecord, reason: FailureReason) -> TrackRecord:
        logger.info(
            "track unresolved run=%s track=%d status=unresolved reason=%s",
            self._sources.run_id,
            position,
            reason,
        )
        return record.unresolved(reason)
