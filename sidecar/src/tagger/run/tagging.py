"""Pipeline de resolution d'un run de re-tagging (use-case 2).

Orchestre `files`, `matching`, `scraper_client` et `cache` sans rien reimplementer,
et ignore le protocole NDJSON : les evenements sortent par un rappel, que le handler
traduit. Aucun fichier musical n'est ecrit ici (ADR-010). L'etat du run vit dans `models`.
"""

import asyncio
import logging
import secrets
from dataclasses import replace
from typing import TYPE_CHECKING

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
    """Ne s'arrete jamais sur un morceau : seuls trois 403 consecutifs arretent le run.

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

    Les lectures partent en parallele sur le pool de threads : enchainees, plusieurs
    centaines d'ouvertures de fichier tenaient la liste vide pendant des secondes.
    `return_exceptions=True` garde chaque tag illisible local a son morceau, la
    seule erreur qui doive arreter le run etant celle de `list_audio_files`, deja levee.
    """
    reads = await asyncio.gather(
        *(asyncio.to_thread(read_shown_tags, path) for path in paths), return_exceptions=True
    )
    records: list[TrackRecord] = []
    for position, (path, read) in enumerate(zip(paths, reads, strict=True), start=1):
        tags_before: ShownTags | None
        match read:
            case ShownTags():
                identity, tags_before = read.identity, read
            case TagsUnreadableError():
                logger.warning(
                    "tags unreadable, file name used run=%s track=%d reason=%s",
                    run_id,
                    position,
                    read.reason,
                )
                identity, tags_before = IdentityTags(artist="", title=""), None
            case _:
                raise read
        track_id = path.relative_to(folder).as_posix()
        records.append(
            TrackRecord(track_id=track_id, path=path, identity=identity, tags_before=tags_before)
        )
    return records


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

    async def process(self, position: int, record: TrackRecord) -> None:
        done = await self._resolve(position, record)
        self._live.update(done)
        event = ArbitrationRequired(done) if done.arbitration else TrackResolved(done)
        self._on_event(event)
        self._processed += 1
        self._on_event(RunProgress(self._processed, self._total))

    # PLR0911 : une sortie par issue de la cascade (deux sources, trois classements
    # chacune) est plus lisible qu'un decoupage en sous-fonctions qui eclaterait l'etat.
    async def _resolve(self, position: int, record: TrackRecord) -> TrackRecord:  # noqa: PLR0911
        identity = record.identity
        query = build_query(identity.artist, identity.title, record.file_name)
        if query is None:
            return self._unresolved(position, record, FailureReason.EMPTY_QUERY)
        record = replace(record, query=query)

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
            case _:
                # `Outcome.EMPTY` en pratique : `case _` rend le match provablement
                # exhaustif pour mypy, qui sinon signale un retour manquant (StrEnum).
                reason = (
                    FailureReason.BELOW_THRESHOLD if had_candidates else FailureReason.NO_RESULT
                )
                return self._unresolved(position, record, reason)

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
        return replace(
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
