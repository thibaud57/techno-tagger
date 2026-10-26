"""Enregistrement du scenario de demo : le vrai sidecar, en process, sur le catalogue fictif.

Chaque session lance `run_loop` dans un environnement isole a l'image des tests
d'integration (`tests/conftest.py`, `tests/integration/conftest.py`) : `LOCALAPPDATA` sous la
racine d'enregistrement, trousseau en memoire, faux techno-scraper et faux CDN. Tout
remplacement d'attribut de module est retabli a la sortie de la session (ADR-023).

Les sessions repartent toutes des memes chemins : une commande et ses lignes sont donc
identiques d'une session a l'autre, ce que `assemble` verifie.
"""

import asyncio
import json
import os
import shutil
import sys
import tempfile
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from functools import partial
from itertools import product
from pathlib import Path, PureWindowsPath
from types import MappingProxyType
from typing import TYPE_CHECKING, Final, Literal, assert_never
from unittest.mock import patch

from audio_samples import held_exclusively, held_open, tagged_audio, write_blank_mp3
from cdn_doubles import FakeCdn
from demo_catalogue import (
    BANDCAMP_DEMO_HOST,
    COLD_MERIDIAN,
    GLASS_CORRIDOR,
    LOWLANDS,
    LOWLANDS_RECOVERY_URL,
    PAST_RUN_FOLDER,
    PAST_RUN_TRACKS,
    PLAYLIST_NAME,
    SUB_ROSA,
    TISHINA,
    TRACKS,
    DemoTrack,
    ExtractionCase,
    register_replies,
    resolved_releases,
    search_query,
)
from demo_covers import cover_name, render_covers
from demo_scenario import (
    DEMO_ROOT,
    PAST_RUN_AT,
    PAST_RUN_ID,
    VISITOR_RUN_AT,
    VISITOR_RUN_ID,
    DemoPaths,
    DemoRecordingError,
    Exchange,
    JsonObject,
    Outcome,
    Phase,
    ReplyState,
    Scenario,
    assemble,
    command_key,
    frozen_sources,
    normalize,
)
from memory_keyring import MemoryKeyring, installed
from ndjson_loop import (
    Conversation,
    arbitrate,
    conversation,
    extraction_command,
    recover_by_url,
    start_command,
)
from pydantic import JsonValue, TypeAdapter
from repo_files import REPO
from scraper_responses import BANDCAMP_SEARCH, BEATPORT_SEARCH
from tagging_api import FakeApi, Gate, transports
from vlc_dump import build_dump

from tagger import handlers
from tagger.core.api_key import SERVICE, USERNAME
from tagger.resolution import scraper_client
from tagger.resolution.cache import cache_dir
from tagger.run.plan import plan_dir, purge_plans
from tagger.tags.tag_dump import dump_dir, purge_dumps

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Mapping, Sequence
    from datetime import datetime

DEMO_FOLDER: Final = REPO / "src" / "demo"


@verify(UNIQUE)
class Branch(StrEnum):
    """Suite d'une ecriture en echec : relance puis restauration, ou restauration directe."""

    RETRY_THEN_ROLLBACK = auto()
    ROLLBACK_WITHOUT_RETRY = auto()


type SubRosaOutcome = Literal[
    Outcome.FIRST_BEATPORT, Outcome.SECOND_BEATPORT, Outcome.REFUSED, Outcome.PENDING
]
type TishinaOutcome = Literal[
    Outcome.FIRST_BEATPORT, Outcome.BANDCAMP, Outcome.REFUSED, Outcome.PENDING
]
type LowlandsOutcome = Literal[Outcome.RECOVERED_BY_URL, Outcome.UNRESOLVED]
type _DecisionOutcome = SubRosaOutcome | TishinaOutcome


@dataclass(frozen=True, slots=True)
class Combination:
    """Issues des trois morceaux a decision a la confirmation du run."""

    sub_rosa: SubRosaOutcome
    tishina: TishinaOutcome
    lowlands: LowlandsOutcome


_SUB_ROSA_OUTCOMES: Final[tuple[SubRosaOutcome, ...]] = (
    Outcome.FIRST_BEATPORT,
    Outcome.SECOND_BEATPORT,
    Outcome.REFUSED,
    Outcome.PENDING,
)
_TISHINA_OUTCOMES: Final[tuple[TishinaOutcome, ...]] = (
    Outcome.FIRST_BEATPORT,
    Outcome.BANDCAMP,
    Outcome.REFUSED,
    Outcome.PENDING,
)
_LOWLANDS_OUTCOMES: Final[tuple[LowlandsOutcome, ...]] = (
    Outcome.RECOVERED_BY_URL,
    Outcome.UNRESOLVED,
)

_INITIAL_OUTCOMES: Final[Mapping[str, Outcome]] = MappingProxyType(
    {
        SUB_ROSA.file_name: Outcome.PENDING,
        TISHINA.file_name: Outcome.PENDING,
        LOWLANDS.file_name: Outcome.UNRESOLVED,
    }
)
_NOTHING_SET: Final[Mapping[str, Outcome]] = MappingProxyType({})
_NO_FIELDS: Final[Mapping[str, JsonValue]] = MappingProxyType({})
# Evenement terminal d'une decision hors phase reseau : la progression du rattrapage.
_URL_RECOVERY: Final[Mapping[str, JsonValue]] = MappingProxyType({"phase": "url_recovery"})
_WRITE: Final[Mapping[str, JsonValue]] = MappingProxyType({"phase": "write"})
_DECISION_ORDER: Final = (SUB_ROSA, TISHINA, LOWLANDS)
_COVERS_BY_TRACK: Final[Mapping[str, str]] = MappingProxyType(
    {track.file_name: f"artworks/{cover_name(release)}" for track, release in resolved_releases()}
)
# Cle factice : `version.api_key_configured` doit etre vrai, aucune requete ne sort.
_DEMO_API_KEY: Final = "demo-key"
_JSON_OBJECT: Final = TypeAdapter[JsonObject](JsonObject)

_SETTINGS_QUERIES: Final[tuple[tuple[JsonObject, str], ...]] = (
    ({"command": "list_runs"}, "runs_listed"),
    ({"command": "get_rollback_target"}, "rollback_target"),
    ({"command": "get_cache_size"}, "cache_size"),
)
_PHASE_QUERIES: Final[tuple[tuple[JsonObject, str], ...]] = (
    *_SETTINGS_QUERIES,
    ({"command": "load_run", "run_id": VISITOR_RUN_ID}, "run_loaded"),
)
_VISITOR_RUN: Final[JsonObject] = {"run_id": VISITOR_RUN_ID}


def combinations() -> tuple[Combination, ...]:
    """Toutes les combinaisons d'issues, dans l'ordre des issues de chaque morceau."""
    return tuple(
        Combination(sub_rosa, tishina, lowlands)
        for sub_rosa, tishina, lowlands in product(
            _SUB_ROSA_OUTCOMES, _TISHINA_OUTCOMES, _LOWLANDS_OUTCOMES
        )
    )


@dataclass(frozen=True, slots=True)
class _Layout:
    """Arborescence d'un profil Windows sous la racine, que la normalisation renomme `DEMO_ROOT`."""

    root: Path

    @property
    def app_data(self) -> Path:
        return self.root / "AppData" / "Local"

    @property
    def vlc_dump(self) -> Path:
        return self.root / "Downloads" / "vlc_media.db"

    @property
    def library(self) -> Path:
        return self.root / "Music" / "Bibliothèque"

    @property
    def destination(self) -> Path:
        return self.root / "Music" / PLAYLIST_NAME

    @property
    def past_folder(self) -> Path:
        return self.root / "Music" / PAST_RUN_FOLDER

    @property
    def app_data_model(self) -> Path:
        return self.root / "models" / "AppData"

    @property
    def extracted_model(self) -> Path:
        return self.root / "models" / PLAYLIST_NAME

    def demo_path(self, path: Path) -> str:
        return str(DEMO_ROOT / PureWindowsPath(path.relative_to(self.root)))

    def demo_paths(self) -> DemoPaths:
        return DemoPaths(
            vlc_dump=self.demo_path(self.vlc_dump),
            library=self.demo_path(self.library),
            destination=self.demo_path(self.destination),
        )


@dataclass(frozen=True, slots=True)
class _Gesture:
    """Commande d'un arbitrage ; `sets` porte l'issue que le geste final donne au morceau."""

    command: JsonObject
    until: str
    sets: Mapping[str, Outcome] = _NOTHING_SET
    fields: Mapping[str, JsonValue] = _NO_FIELDS


def record_scenario(workspace: Path) -> Scenario:
    """Enregistre toutes les sessions sous `workspace` et rend le scenario assemble.

    `held_open` et `held_exclusively` ne verrouillent un fichier que sous Windows : ailleurs,
    le scenario perdrait l'echec d'extraction et l'ecriture refusee.
    """
    if sys.platform != "win32":
        message = "recording the demo scenario needs Windows, where a file can be held locked"
        raise DemoRecordingError(message)

    layout = _Layout(workspace.resolve())
    _build_library(layout)
    file_names = tuple(track.file_name for track in TRACKS)
    layout.vlc_dump.parent.mkdir(parents=True)
    build_dump(layout.vlc_dump, tracks=file_names, playlists={PLAYLIST_NAME: file_names})
    _build_past_run(layout)
    sessions = [
        asyncio.run(_extraction_session(layout)),
        *(
            asyncio.run(
                _session(layout, partial(_full_path, combination, branch, layout.destination))
            )
            for combination in combinations()
            for branch in Branch
        ),
        *(
            asyncio.run(_session(layout, partial(_late_decision, combination, last)))
            for combination, last in _late_decisions()
        ),
    ]
    return assemble(sessions, layout.demo_paths())


def write_demo_folder(target: Path, scenario: Scenario, covers: Mapping[str, str]) -> None:
    """Vide puis reecrit `target` : une pochette sortie du catalogue n'y survit pas.

    `newline="\\n"` : sous Windows, l'ecriture en texte poserait du CRLF, la ou `.gitattributes`
    garde l'arbre de travail en LF.
    """
    if target.exists():
        shutil.rmtree(target)
    artworks = target / "artworks"
    artworks.mkdir(parents=True)
    document = json.dumps(
        scenario.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, indent=2
    )
    (target / "scenario.json").write_text(document + "\n", encoding="utf-8", newline="\n")
    for name, svg in covers.items():
        (artworks / name).write_text(svg, encoding="utf-8", newline="\n")


def record_demo_folder(target: Path) -> tuple[Scenario, Mapping[str, str]]:
    """Enregistre dans un dossier temporaire, puis reecrit `target` ; rend ce qui y est ecrit."""
    with tempfile.TemporaryDirectory() as workspace:
        scenario = record_scenario(Path(workspace))
    covers = render_covers()
    write_demo_folder(target, scenario, covers)
    return scenario, covers


def _late_decisions() -> tuple[tuple[Combination, DemoTrack], ...]:
    """Sessions courtes : chaque decision de `last` dans un etat des autres morceaux que l'ordre
    des sessions completes ne traverse pas, le visiteur tranchant dans l'ordre qu'il veut."""
    return tuple(
        (combination, track)
        for combination in combinations()
        for track, outcome in _decisions(combination)
        if outcome is not Outcome.PENDING and not _reached_in_full_path(combination, track)
    )


def _reached_in_full_path(combination: Combination, track: DemoTrack) -> bool:
    """Vrai si les sessions completes tranchent `track` dans cet etat : les morceaux qu'elles
    traitent apres lui y ont encore leur issue de depart."""
    outcomes = outcomes_of(combination)
    return all(
        outcomes[later.file_name] is _INITIAL_OUTCOMES[later.file_name]
        for later in _DECISION_ORDER[_DECISION_ORDER.index(track) + 1 :]
    )


def _decisions(combination: Combination) -> tuple[tuple[DemoTrack, _DecisionOutcome], ...]:
    """Morceaux a decision dans l'ordre des sessions completes."""
    return ((SUB_ROSA, combination.sub_rosa), (TISHINA, combination.tishina))


def outcomes_of(combination: Combination) -> Mapping[str, Outcome]:
    """Issues de la combinaison par `track_id`, la forme des etats du scenario."""
    return MappingProxyType(
        {
            SUB_ROSA.file_name: combination.sub_rosa,
            TISHINA.file_name: combination.tishina,
            LOWLANDS.file_name: combination.lowlands,
        }
    )


def _build_library(layout: _Layout) -> None:
    """Bibliotheque et destination de depart : les cas de l'extraction."""
    for track in TRACKS:
        if track.extraction is ExtractionCase.MISSING:
            continue
        tagged_audio(layout.library, track.file_name, track.artist, track.title)
        match track.extraction:
            case ExtractionCase.DUPLICATE:
                # Homonyme plus petit, sans tags : le sidecar garde le plus volumineux.
                duplicates = layout.library / "Doublons"
                duplicates.mkdir(parents=True, exist_ok=True)
                write_blank_mp3(duplicates / track.file_name)
            case ExtractionCase.ALREADY_PRESENT:
                layout.destination.mkdir(parents=True, exist_ok=True)
                (layout.library / track.file_name).copy(layout.destination / track.file_name)
            case ExtractionCase.EXTRACTED | ExtractionCase.FAILURE:
                pass
            case _:
                assert_never(track.extraction)


def _build_past_run(layout: _Layout) -> None:
    """Run ecrit deux mois avant la demo, dont le `LOCALAPPDATA` sert de modele aux sessions."""
    for track in PAST_RUN_TRACKS:
        tagged_audio(layout.past_folder, track.file_name, track.artist, track.title)
    with _environment(layout.app_data, _demo_api(), at=PAST_RUN_AT, run_id=PAST_RUN_ID):
        asyncio.run(_write_past_run(layout.past_folder))
        # Dump passe la retention de 30 jours au jour de la demo : la purge du demarrage le
        # retire, `get_rollback_target` ne propose aucune cible, le rapport reste consultable.
        purge_dumps(dump_dir(), VISITOR_RUN_AT)
        # Sans son dump, un plan confirme passerait pour un run interrompu : la purge du
        # demarrage retire les plans confirmes.
        purge_plans(plan_dir(), VISITOR_RUN_AT)
        # Cache de 30 jours, run vieux de deux mois : servis par le cache, ses morceaux se
        # resoudraient hors des gates, dans un ordre de threads variable. Taille 0 au demarrage.
        shutil.rmtree(cache_dir())
    layout.app_data_model.parent.mkdir()
    layout.app_data.copy(layout.app_data_model)


async def _write_past_run(folder: Path) -> None:
    async with conversation() as talk:
        talk.send(**start_command(folder))
        await talk.expect("run_finished", phase="network")
        talk.send(command="commit_run", run_id=PAST_RUN_ID)
        await talk.expect("run_finished", phase="write")


async def _extraction_session(layout: _Layout) -> tuple[Exchange, ...]:
    """Listage, deux copies puis un deplacement sur une bibliotheque neuve, et le run passe."""
    _reset(layout.app_data, layout.app_data_model)
    extraction = extraction_command(
        layout.library, layout.vlc_dump, layout.destination, PLAYLIST_NAME
    )
    cold_meridian = layout.library / COLD_MERIDIAN.file_name
    async with _recording(layout, _demo_api()) as recorder:
        await recorder.ask(
            {"command": "list_playlists", "playlist_path": str(layout.vlc_dump)},
            "playlists_listed",
        )
        with held_exclusively(cold_meridian):
            for _rank in range(2):
                await recorder.ask(_json(extraction | {"mode": "copy"}), "extraction_finished")
        layout.destination.copy(layout.extracted_model)
        shutil.rmtree(layout.library)
        shutil.rmtree(layout.destination)
        _build_library(layout)
        with held_exclusively(cold_meridian):
            await recorder.ask(_json(extraction | {"mode": "move"}), "extraction_finished")
        await recorder.ask({"command": "load_run", "run_id": PAST_RUN_ID}, "run_loaded")
    return recorder.finished()


async def _session(
    layout: _Layout, play: Callable[[_Recorder], Awaitable[None]]
) -> tuple[Exchange, ...]:
    """Session du visiteur : demarrage et phase reseau, puis `play`."""
    _reset(layout.app_data, layout.app_data_model)
    _reset(layout.destination, layout.extracted_model)
    api = _demo_api()
    gates = _gates(api)
    async with _recording(layout, api) as recorder:
        await _start(recorder, layout.destination, gates)
        await play(recorder)
    return recorder.finished()


@asynccontextmanager
async def _recording(layout: _Layout, api: FakeApi) -> AsyncIterator[_Recorder]:
    """Session du visiteur sous ses valeurs figees ; `finished()` se lit une fois sortie."""
    with _environment(layout.app_data, api, at=VISITOR_RUN_AT, run_id=VISITOR_RUN_ID):
        async with conversation() as talk:
            yield _Recorder(talk, layout.root)


async def _start(recorder: _Recorder, folder: Path, gates: Sequence[tuple[Gate, ...]]) -> None:
    """Demarrage de l'interface, puis la phase reseau, serialisee morceau par morceau."""
    await recorder.ask({"command": "get_version"}, "version")
    await recorder.ask({"command": "get_interrupted_run"}, "interrupted_run")
    await recorder.settings()
    await recorder.ask(
        _json(start_command(folder)),
        "progress",
        during=partial(_release_in_catalogue_order, recorder.talk, gates),
        enters=Phase.NOT_WRITTEN,
        fields=_URL_RECOVERY,
    )
    await recorder.settings()


async def _full_path(
    combination: Combination, branch: Branch, folder: Path, recorder: _Recorder
) -> None:
    """Le rattrapage vient apres les decisions : sa reponse existe pour toutes leurs issues."""
    for track, outcome in _decisions(combination):
        await _decide(recorder, track, outcome)
    await _recover(recorder, combination.lowlands)
    await _write(recorder, folder, branch)


async def _late_decision(combination: Combination, last: DemoTrack, recorder: _Recorder) -> None:
    """L'autre morceau a decision, puis « Lowlands », puis `last`, sans ecriture."""
    others = [(track, outcome) for track, outcome in _decisions(combination) if track is not last]
    for track, outcome in others:
        await _decide(recorder, track, outcome)
    await _recover(recorder, combination.lowlands)
    await _decide(recorder, last, dict(_decisions(combination))[last])


async def _decide(recorder: _Recorder, track: DemoTrack, outcome: _DecisionOutcome) -> None:
    """Gestes menant a `outcome`, puis les Reglages dans l'etat atteint."""
    gestures = _gestures(track.file_name, outcome)
    for gesture in gestures:
        await recorder.ask(gesture.command, gesture.until, sets=gesture.sets, fields=gesture.fields)
    if gestures:
        await recorder.settings()


async def _recover(recorder: _Recorder, lowlands: LowlandsOutcome) -> None:
    match lowlands:
        case Outcome.RECOVERED_BY_URL:
            await recorder.ask(
                _json(recover_by_url(LOWLANDS_RECOVERY_URL, LOWLANDS.file_name)),
                "progress",
                sets={LOWLANDS.file_name: Outcome.RECOVERED_BY_URL},
                fields=_URL_RECOVERY,
            )
            await recorder.settings()
        case Outcome.UNRESOLVED:
            pass
        case _:
            assert_never(lowlands)


async def _write(recorder: _Recorder, folder: Path, branch: Branch) -> None:
    """« Glass Corridor » tenu ouvert pendant la confirmation, relache avant la relance."""
    with held_open(folder / GLASS_CORRIDOR.file_name):
        await recorder.ask(
            {"command": "commit_run", **_VISITOR_RUN},
            "run_finished",
            enters=Phase.WRITE_FAILED,
            fields=_WRITE,
        )
    await recorder.phase_queries()
    match branch:
        case Branch.RETRY_THEN_ROLLBACK:
            await recorder.ask(
                {"command": "retry_write", **_VISITOR_RUN},
                "run_finished",
                enters=Phase.WRITTEN,
                fields=_WRITE,
            )
            await recorder.phase_queries()
            await _roll_back(recorder, Phase.ROLLED_BACK_AFTER_RETRY)
        case Branch.ROLLBACK_WITHOUT_RETRY:
            await _roll_back(recorder, Phase.ROLLED_BACK_WITHOUT_RETRY)
        case _:
            assert_never(branch)


async def _roll_back(recorder: _Recorder, enters: Phase) -> None:
    """Le run entier : `track_id` nul, la restauration d'un seul morceau est hors scenario."""
    await recorder.ask(
        {"command": "rollback", "track_id": None, **_VISITOR_RUN},
        "rollback_finished",
        enters=enters,
    )
    await recorder.phase_queries()


def _gestures(track_id: str, outcome: _DecisionOutcome) -> tuple[_Gesture, ...]:
    """Gestes qui menent a `outcome` ; un refus de Beatport y repasse par « Revenir a Beatport »."""
    match outcome:
        case Outcome.PENDING:
            return ()
        case Outcome.FIRST_BEATPORT:
            return (_conclude(track_id, "beatport", 0, outcome),)
        case Outcome.SECOND_BEATPORT:
            return (_conclude(track_id, "beatport", 1, outcome),)
        case Outcome.BANDCAMP:
            return (*_back_to_beatport(track_id), _conclude(track_id, "bandcamp", 0, outcome))
        case Outcome.REFUSED:
            return (*_back_to_beatport(track_id), _conclude(track_id, "bandcamp", None, outcome))
        case _:
            assert_never(outcome)


def _conclude(track_id: str, source: str, candidate: int | None, outcome: Outcome) -> _Gesture:
    """Geste final, dont la reponse pose l'issue du morceau."""
    return _Gesture(
        _json(arbitrate(source, candidate, track_id)),
        "progress",
        MappingProxyType({track_id: outcome}),
        _URL_RECOVERY,
    )


def _back_to_beatport(track_id: str) -> tuple[_Gesture, ...]:
    """Refus de Beatport, retour a sa liste, puis refus de nouveau : la liste Bandcamp s'affiche."""
    refusal = _Gesture(
        _json(arbitrate("beatport", None, track_id)), "progress", fields=_URL_RECOVERY
    )
    switch = _Gesture(
        {"command": "switch_arbitration_source", "track_id": track_id, "source": "beatport"},
        "arbitration_updated",
    )
    return (refusal, switch, refusal)


class _Recorder:
    """Dialogue d'une session : chaque commande, et les lignes recues jusqu'a son evenement
    terminal, deviennent un `Exchange` ; issues et phase suivent ce que les reponses posent."""

    def __init__(self, talk: Conversation, root: Path) -> None:
        self.talk = talk
        self._root = root
        self._exchanges: list[Exchange] = []
        self._consumed = 0
        self._outcomes: Mapping[str, Outcome] = _INITIAL_OUTCOMES
        self._phase = Phase.IDLE

    async def ask(
        self,
        command: JsonObject,
        until: str,
        *,
        stateful: bool = False,
        sets: Mapping[str, Outcome] = _NOTHING_SET,
        enters: Phase | None = None,
        during: Callable[[], Awaitable[None]] | None = None,
        fields: Mapping[str, JsonValue] = _NO_FIELDS,
    ) -> None:
        """Reponse sans etat avant le lancement du run, avec etat ensuite, sauf `stateful`.

        Les gestes d'arbitrage aussi dependent de l'etat : la progression du rattrapage qui suit
        chaque decision compte les morceaux a rattraper du run entier, refus anterieurs compris.
        """
        events = self.talk.events
        start = self._consumed
        if len(events) != start:
            stray = [event["event"] for event in events[start:]]
            message = f"lines received before {command_key(command)}: {stray}"
            raise DemoRecordingError(message)
        self.talk.send(**command)
        try:
            if during is not None:
                await during()
            terminal = await self.talk.expect(until, **fields)
        except TimeoutError as error:
            received = [event["event"] for event in events[start:]]
            message = f"no {until} after {command_key(command)}, received {received}"
            raise DemoRecordingError(message) from error
        end = next(index for index in range(start, len(events)) if events[index] is terminal) + 1
        with_state = stateful or self._phase is not Phase.IDLE
        self._exchanges.append(
            Exchange(
                command=self._normalized(command),
                lines=tuple(self._normalized(_json(event)) for event in events[start:end]),
                state=ReplyState(self._outcomes, self._phase) if with_state else None,
                sets=sets,
                enters=enters,
            )
        )
        self._consumed = end
        self._outcomes = MappingProxyType({**self._outcomes, **sets})
        self._phase = enters or self._phase

    async def settings(self) -> None:
        """Les requetes de la page Reglages, avec l'etat courant."""
        for command, until in _SETTINGS_QUERIES:
            await self.ask(command, until, stateful=True)

    async def phase_queries(self) -> None:
        """Historique, recapitulatif, cible de restauration et cache apres une etape d'ecriture."""
        for command, until in _PHASE_QUERIES:
            await self.ask(command, until, stateful=True)

    def finished(self) -> tuple[Exchange, ...]:
        """Session fermee : une ligne recue apres le dernier evenement terminal serait perdue."""
        stray = [event["event"] for event in self.talk.events[self._consumed :]]
        if stray:
            message = f"lines after the last expected event: {stray}"
            raise DemoRecordingError(message)
        return tuple(self._exchanges)

    def _normalized(self, message: JsonObject) -> JsonObject:
        return normalize(message, recording_root=self._root, covers_by_track=_COVERS_BY_TRACK)


async def _release_in_catalogue_order(
    talk: Conversation, gates: Sequence[tuple[Gate, ...]]
) -> None:
    """Un morceau a la fois, dans l'ordre du catalogue : l'ordre des lignes reste celui que le
    sidecar emet, sans reordonner apres coup."""
    for processed, track_gates in enumerate(gates, start=1):
        for gate in track_gates:
            gate.release.set()
        await talk.expect("progress", phase="tagging", processed=processed)


def _gates(api: FakeApi) -> tuple[tuple[Gate, ...], ...]:
    """Recherches Beatport puis Bandcamp de chaque morceau extrait, dans l'ordre du catalogue."""
    return tuple(
        (api.gate(BEATPORT_SEARCH, query), api.gate(BANDCAMP_SEARCH, query))
        for query in (search_query(track) for track in TRACKS if _extracted(track))
    )


def _extracted(track: DemoTrack) -> bool:
    return track.extraction not in {ExtractionCase.MISSING, ExtractionCase.FAILURE}


def _demo_api() -> FakeApi:
    api = FakeApi()
    register_replies(api)
    return api


@contextmanager
def _environment(app_data: Path, api: FakeApi, *, at: datetime, run_id: str) -> Iterator[None]:
    """Environnement d'une session, valeurs figees comprises, retabli a la sortie."""
    backend = MemoryKeyring()
    backend.set_password(SERVICE, USERNAME, _DEMO_API_KEY)
    with (
        installed(backend),
        patch.dict(os.environ, {"LOCALAPPDATA": str(app_data)}),
        patch.object(handlers, "tagging_transports", partial(transports, api, FakeCdn())),
        patch.object(scraper_client, "_BANDCAMP_HOST", BANDCAMP_DEMO_HOST),
        # Les gates tiennent leur place du semaphore : a 3 places, la recherche du morceau
        # suivant dans l'ordre du catalogue attendrait une place que rien ne libere.
        patch.object(scraper_client, "BEATPORT_CONCURRENCY", len(TRACKS)),
        frozen_sources(at=at, run_id=run_id),
    ):
        yield


def _reset(target: Path, model: Path) -> None:
    """Copie neuve du modele, aux memes chemins : les commandes restent identiques."""
    if target.exists():
        shutil.rmtree(target)
    model.copy(target)


def _json(message: Mapping[str, object]) -> JsonObject:
    """Ligne ou commande ramenee au type JSON du scenario, a la frontiere."""
    return _JSON_OBJECT.validate_python(message)
