"""Pipeline de resolution d'un run de re-tagging (use-case 2).

Il ignore le protocole NDJSON : les evenements sortent par un rappel, que le handler
traduit. Aucun fichier musical n'est ecrit ici (ADR-010). L'etat du run vit dans `run.models`.
"""

import asyncio
import logging
import secrets
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final, assert_never, override

from tagger.core.identifiers import RunId, TrackId
from tagger.resolution.matching import (
    Auto,
    Classification,
    Empty,
    GreyZone,
    ScoredCandidate,
    TrackQuery,
    build_query,
    classify,
    rank,
)
from tagger.resolution.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    SearchSource,
    Source,
    SourceUnavailableError,
)
from tagger.resolution.sources import ApiKeyRejectedRunError
from tagger.run.models import (
    ArbitrationRequired,
    AwaitingArbitration,
    FailureReason,
    LiveRun,
    PendingArbitration,
    Resolution,
    Resolved,
    Retained,
    RunEvent,
    RunProgress,
    RunStarted,
    TrackRecord,
    TrackResolved,
    Unresolved,
    Verdict,
    Waiting,
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
    run_id = RunId(secrets.token_hex(3))
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


async def read_identities(
    run_id: RunId, folder: Path, paths: tuple[Path, ...]
) -> list[TrackRecord[Waiting]]:
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
            track_id=TrackId(path.relative_to(folder).as_posix()),
            path=path,
            identity=_NO_IDENTITY if tags is None else tags.identity,
            outcome=Waiting(),
            tags_before=tags,
        )
        for path, tags in shown
    ]


def _shown_or_none(
    run_id: RunId, position: int, read: ShownTags | BaseException
) -> ShownTags | None:
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


@dataclass(frozen=True, slots=True)
class _Silent:
    """Source sans reponse exploitable ; `key_rejected` : la cle API est en cause."""

    key_rejected: bool


def _empty_reason(beatport: _Silent | Empty, bandcamp: Empty) -> FailureReason:
    match beatport:
        case _Silent():
            # Beatport n'a jamais repondu : un classement definitif (`no_result`,
            # `below_threshold`) ne serait pas rejoue a la reprise.
            return FailureReason.SOURCE_UNAVAILABLE
        case Empty():
            offered = beatport.had_candidates or bandcamp.had_candidates
            return FailureReason.BELOW_THRESHOLD if offered else FailureReason.NO_RESULT
        case _:
            assert_never(beatport)


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
        event = announced(record.with_outcome(await self._resolve(position, record)))
        self._live.update(event.record)
        self._on_event(event)
        self._processed += 1
        self._on_event(RunProgress(processed=self._processed, total=self._total))

    async def _resolve(self, position: int, record: TrackRecord) -> Verdict:
        identity = record.identity
        query = build_query(identity.artist, identity.title, record.file_name)
        if query is None:
            return self._unresolved(position, None, FailureReason.EMPTY_QUERY)

        beatport = await self._ask(position, Source.BEATPORT, query, allow_auto=True)
        match beatport:
            case Auto(chosen):
                return await self._accept(position, query, Source.BEATPORT, chosen)
            case GreyZone(candidates=candidates):
                return self._hold(
                    position, query, Source.BEATPORT, candidates, beatport_unavailable=False
                )
            case _Silent(key_rejected=True):
                return self._unresolved(position, query, FailureReason.SOURCE_UNAVAILABLE)
            case _Silent() | Empty() as answer:
                return await self._resolve_on_bandcamp(position, query, answer)
            case _:
                assert_never(beatport)

    async def _resolve_on_bandcamp(
        self, position: int, query: TrackQuery, beatport: _Silent | Empty
    ) -> Verdict:
        # Beatport injoignable : Bandcamp ne valide jamais seul (decision du 2026-09-19).
        beatport_unavailable = isinstance(beatport, _Silent)
        bandcamp = await self._ask(
            position, Source.BANDCAMP, query, allow_auto=not beatport_unavailable
        )
        match bandcamp:
            case Auto(chosen):
                return await self._accept(position, query, Source.BANDCAMP, chosen)
            case GreyZone(candidates=candidates):
                return self._hold(
                    position,
                    query,
                    Source.BANDCAMP,
                    candidates,
                    beatport_unavailable=beatport_unavailable,
                )
            case _Silent():
                return self._unresolved(position, query, FailureReason.SOURCE_UNAVAILABLE)
            case Empty():
                return self._unresolved(position, query, _empty_reason(beatport, bandcamp))
            case _:
                assert_never(bandcamp)

    async def _ask(
        self, position: int, source: SearchSource, query: TrackQuery, *, allow_auto: bool
    ) -> Classification | _Silent:
        try:
            found = await self._sources.search(source, query)
        except ApiKeyRejectedError:
            return _Silent(key_rejected=True)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._sources.log_source_failure(position, source, exc)
            return _Silent(key_rejected=False)
        if allow_auto:
            return classify(query, found, self._sources.thresholds)
        return rank(query, found, self._sources.thresholds)

    async def _accept(
        self, position: int, query: TrackQuery, source: Source, chosen: ScoredCandidate
    ) -> Resolved:
        candidate, artwork = await self._sources.retained(position, source, chosen)
        logger.info(
            "candidate retained run=%s track=%d source=%s score=%.0f status=resolved",
            self._sources.run_id,
            position,
            source,
            chosen.score,
        )
        return Resolved(query, Retained(Resolution.AUTO, source, candidate, chosen, artwork))

    def _hold(
        self,
        position: int,
        query: TrackQuery,
        source: Source,
        candidates: tuple[ScoredCandidate, ...],
        *,
        beatport_unavailable: bool,
    ) -> AwaitingArbitration:
        logger.info(
            "arbitration required run=%s track=%d source=%s score=%.0f status=grey_zone",
            self._sources.run_id,
            position,
            source,
            candidates[0].score,
        )
        return AwaitingArbitration(
            query, PendingArbitration(source, candidates, beatport_unavailable)
        )

    def _unresolved(
        self, position: int, query: TrackQuery | None, reason: FailureReason
    ) -> Unresolved:
        logger.info(
            "track unresolved run=%s track=%d status=unresolved reason=%s",
            self._sources.run_id,
            position,
            reason,
        )
        return Unresolved(query, reason)


def announced(record: TrackRecord[Verdict]) -> ArbitrationRequired | TrackResolved:
    """Evenement de l'issue : une attente d'arbitrage n'est pas un morceau regle."""
    outcome = record.outcome
    match outcome:
        case AwaitingArbitration():
            return ArbitrationRequired(record.with_outcome(outcome))
        case Unresolved() | Resolved():
            return TrackResolved(record.with_outcome(outcome))
        case _:
            assert_never(outcome)
