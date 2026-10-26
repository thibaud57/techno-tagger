"""Catalogue fictif de la demo web : une source pour la bibliotheque, le dump VLC, les
reponses du faux techno-scraper, le rattrapage par URL et les pochettes.

Morceaux, labels et references recopies du tableau « Catalogue fictif » de
`docs/superpowers/specs/demo-web-publique/01-pochettes-options.html`. BPM, tonalite, genre,
dates et ISRC sont inventes, coherents par label ; toute URL est sur un domaine reserve
(`.example`), aucun domaine reel ne pouvant etre enregistre par un tiers.

Noms verifies le 2026-10-26 par recherche web restreinte a beatport.com et discogs.com,
chaque artiste et chaque label du catalogue entre guillemets : aucun ne designe un
artiste ou un label existant. Homonymies relevees sans objet : « Kaltwerk » et
« Concrete Halls » sont des titres de morceaux d'autres artistes, « Grauzone » seul est
un groupe suisse, sans label « Grauzone Tonträger ».
"""

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from enum import UNIQUE, StrEnum, auto, verify
from functools import cache
from types import MappingProxyType
from typing import TYPE_CHECKING, Final, NamedTuple, assert_never

from scraper_responses import (
    BANDCAMP_SEARCH,
    BANDCAMP_TRACKS,
    BEATPORT_SEARCH,
    BEATPORT_TRACKS,
    bandcamp_track_payload,
    found,
    ok,
    track_payload,
)

from tagger.resolution.matching import build_query

if TYPE_CHECKING:
    from collections.abc import Mapping

    from tagging_api import FakeApi


@verify(UNIQUE)
class Motif(StrEnum):
    RINGS = "rings"
    WAVES = "waves"
    GRID = "grid"
    DOTS = "dots"


@dataclass(frozen=True, slots=True)
class Label:
    name: str
    background: str
    foreground: str
    hue: int
    motif: Motif


@verify(UNIQUE)
class ExtractionCase(StrEnum):
    EXTRACTED = auto()
    ALREADY_PRESENT = auto()
    DUPLICATE = auto()
    MISSING = auto()
    FAILURE = auto()


@verify(UNIQUE)
class TaggingCase(StrEnum):
    AUTO_BEATPORT = auto()
    BANDCAMP_ONLY = auto()
    TWO_BEATPORT_MIXES = auto()
    WRONG_BEATPORT = auto()
    NOT_FOUND = auto()
    LOCKED_ON_WRITE = auto()


@dataclass(frozen=True, slots=True)
class Release:
    label: Label
    reference: str
    tagging: TaggingCase


@dataclass(frozen=True, slots=True)
class DemoTrack:
    """`release` vaut `None` pour le morceau absent et l'echec d'extraction."""

    artist: str
    title: str
    file_name: str
    extraction: ExtractionCase
    release: Release | None


_CONCRETE_HALLS: Final = Label("Concrete Halls", "#1c1b19", "#e8e2d6", 40, Motif.RINGS)
_FERROUS_RECORDS: Final = Label("Ferrous Records", "#1a1210", "#f0a35c", 22, Motif.WAVES)
_GRAUZONE_TONTRAGER: Final = Label("Grauzone Tonträger", "#12161b", "#9fb4c8", 205, Motif.GRID)
_LUMEN_DRIFT: Final = Label("Lumen Drift", "#15121d", "#b9a3f0", 265, Motif.DOTS)

_HOLLOW_FREQUENCIES: Final = DemoTrack(
    artist="Nadia Kessler",
    title="Hollow Frequencies",
    file_name="Nadia Kessler - Hollow Frequencies.mp3",
    extraction=ExtractionCase.EXTRACTED,
    release=Release(_CONCRETE_HALLS, "CH012", TaggingCase.AUTO_BEATPORT),
)
_SIGNAL_DECAY: Final = DemoTrack(
    artist="Oblique Unit",
    title="Signal Decay",
    file_name="Oblique Unit - Signal Decay.flac",
    extraction=ExtractionCase.EXTRACTED,
    release=Release(_FERROUS_RECORDS, "FER031", TaggingCase.AUTO_BEATPORT),
)
_NIGHT_SHIFT_PROTOCOL: Final = DemoTrack(
    artist="Lena Varga",
    title="Night Shift Protocol",
    file_name="Lena Varga - Night Shift Protocol.mp3",
    extraction=ExtractionCase.EXTRACTED,
    release=Release(_FERROUS_RECORDS, "FER029", TaggingCase.AUTO_BEATPORT),
)
_STAHLREGEN_RELEASE: Final = Release(_GRAUZONE_TONTRAGER, "GZT007", TaggingCase.AUTO_BEATPORT)
_STAHLREGEN: Final = DemoTrack(
    artist="Kaltwerk",
    title="Stahlregen",
    file_name="Kaltwerk - Stahlregen.wav",
    extraction=ExtractionCase.EXTRACTED,
    release=_STAHLREGEN_RELEASE,
)
_FERRUM: Final = DemoTrack(
    artist="Mirela Dragović",
    title="Ferrum",
    file_name="Mirela Dragović - Ferrum.aiff",
    extraction=ExtractionCase.EXTRACTED,
    release=Release(_LUMEN_DRIFT, "LMD004", TaggingCase.BANDCAMP_ONLY),
)
SUB_ROSA: Final = DemoTrack(
    artist="Pale Assembly",
    title="Sub Rosa",
    file_name="Pale Assembly - Sub Rosa.mp3",
    extraction=ExtractionCase.EXTRACTED,
    release=Release(_CONCRETE_HALLS, "CH015", TaggingCase.TWO_BEATPORT_MIXES),
)
TISHINA: Final = DemoTrack(
    artist="Teodor Ilin",
    title="Тишина",
    file_name="Teodor Ilin - Тишина.flac",
    extraction=ExtractionCase.EXTRACTED,
    release=Release(_GRAUZONE_TONTRAGER, "GZT009", TaggingCase.WRONG_BEATPORT),
)
_LOWLANDS_RELEASE: Final = Release(_LUMEN_DRIFT, "LMD006", TaggingCase.NOT_FOUND)
LOWLANDS: Final = DemoTrack(
    artist="Arc Ventral",
    title="Lowlands",
    file_name="Arc Ventral - Lowlands.wav",
    extraction=ExtractionCase.EXTRACTED,
    release=_LOWLANDS_RELEASE,
)
GLASS_CORRIDOR: Final = DemoTrack(
    artist="Sora Tanabe",
    title="Glass Corridor",
    file_name="Sora Tanabe - Glass Corridor.mp3",
    extraction=ExtractionCase.EXTRACTED,
    release=Release(_FERROUS_RECORDS, "FER033", TaggingCase.LOCKED_ON_WRITE),
)
_RITUAL_IV: Final = DemoTrack(
    artist="Hexen Choir",
    title="Ritual IV",
    file_name="Hexen Choir - Ritual IV.aiff",
    extraction=ExtractionCase.ALREADY_PRESENT,
    release=Release(_CONCRETE_HALLS, "CH010", TaggingCase.AUTO_BEATPORT),
)
_EROSION: Final = DemoTrack(
    artist="Basalt Theory",
    title="Erosion",
    file_name="Basalt Theory - Erosion.mp3",
    extraction=ExtractionCase.DUPLICATE,
    release=Release(_GRAUZONE_TONTRAGER, "GZT011", TaggingCase.AUTO_BEATPORT),
)
_AFTERGLOW: Final = DemoTrack(
    artist="Mara Linde",
    title="Afterglow",
    file_name="Mara Linde - Afterglow.mp3",
    extraction=ExtractionCase.MISSING,
    release=None,
)
COLD_MERIDIAN: Final = DemoTrack(
    artist="Cold Meridian",
    title="Pulse Width",
    file_name="Cold Meridian - Pulse Width.flac",
    extraction=ExtractionCase.FAILURE,
    release=None,
)

TRACKS: Final[tuple[DemoTrack, ...]] = (
    _HOLLOW_FREQUENCIES,
    _SIGNAL_DECAY,
    _NIGHT_SHIFT_PROTOCOL,
    _STAHLREGEN,
    _FERRUM,
    SUB_ROSA,
    TISHINA,
    LOWLANDS,
    GLASS_CORRIDOR,
    _RITUAL_IV,
    _EROSION,
    _AFTERGLOW,
    COLD_MERIDIAN,
)
PAST_RUN_TRACKS: Final[tuple[DemoTrack, ...]] = (_HOLLOW_FREQUENCIES, _SIGNAL_DECAY, _STAHLREGEN)

PLAYLIST_NAME: Final = "Set du samedi"
PAST_RUN_FOLDER: Final = "Set de la semaine dernière"
# Hote Bandcamp que le harnais substitue a celui du client, pour un rattrapage sans domaine reel.
BANDCAMP_DEMO_HOST: Final = re.compile(r"[a-z0-9][a-z0-9-]*\.bandcamp\.example")


class _LabelFacts(NamedTuple):
    label_id: str
    isrc_registrant: str
    genre: str


class _ReleaseFacts(NamedTuple):
    """`track_id` : id de la fiche sur la source qui porte la sortie."""

    track_id: str
    artist_id: str
    slug: str
    bpm: int
    key: str
    released: date
    track_number: int


_LABEL_FACTS: Final[Mapping[str, _LabelFacts]] = MappingProxyType(
    {
        _CONCRETE_HALLS.name: _LabelFacts("70001", "CHL", "Techno (Raw / Deep / Hypnotic)"),
        _FERROUS_RECORDS.name: _LabelFacts("70002", "FER", "Techno (Peak Time / Driving)"),
        _GRAUZONE_TONTRAGER.name: _LabelFacts("70003", "GZT", "Hard Techno"),
        _LUMEN_DRIFT.name: _LabelFacts("70004", "LMD", "Ambient / Experimental"),
    }
)

_RELEASE_FACTS: Final[Mapping[str, _ReleaseFacts]] = MappingProxyType(
    {
        "CH012": _ReleaseFacts(
            "91000120", "80001", "hollow-frequencies", 132, "5A", date(2025, 3, 14), 1
        ),
        "FER031": _ReleaseFacts(
            "91000310", "80002", "signal-decay", 138, "8A", date(2025, 9, 5), 1
        ),
        "FER029": _ReleaseFacts(
            "91000290", "80003", "night-shift-protocol", 140, "11A", date(2025, 6, 20), 2
        ),
        "GZT007": _ReleaseFacts("91000070", "80004", "stahlregen", 150, "2A", date(2024, 11, 8), 1),
        "LMD004": _ReleaseFacts("2100004", "80005", "ferrum", 128, "6A", date(2025, 2, 21), 3),
        "CH015": _ReleaseFacts("91000150", "80006", "sub-rosa", 130, "9A", date(2025, 10, 3), 1),
        "GZT009": _ReleaseFacts("2100009", "80007", "tishina", 146, "4A", date(2025, 5, 16), 1),
        "LMD006": _ReleaseFacts("2100006", "80008", "lowlands", 124, "1A", date(2025, 8, 29), 2),
        "FER033": _ReleaseFacts(
            "91000330", "80009", "glass-corridor", 136, "7A", date(2025, 10, 17), 1
        ),
        "CH010": _ReleaseFacts("91000100", "80010", "ritual-iv", 128, "12A", date(2024, 9, 27), 4),
        "GZT011": _ReleaseFacts("91000110", "80011", "erosion", 152, "3A", date(2025, 7, 11), 2),
    }
)

_ORIGINAL_MIX: Final = "Original Mix"
# « Sub Rosa » non versionne valide seul un « Original Mix » : deux autres versions le
# laissent en zone grise, comme `tagging_api.hold_on_beatport`.
_TWO_MIXES: Final = ("Extended Mix", "Dub")
# Un remix d'un artiste du label, ecarte de l'auto par la version : le faux de « Тишина ».
_WRONG_REMIXER: Final = (_STAHLREGEN, _STAHLREGEN_RELEASE)
_WRONG_MIX: Final = f"{_STAHLREGEN.artist} Remix"
# Ecart de designation ISRC entre une sortie et ses autres versions.
_VARIANT_ISRC_STEP: Final = 500


def resolved_releases() -> tuple[tuple[DemoTrack, Release], ...]:
    """Les morceaux porteurs d'une sortie, avec elle, dans l'ordre du catalogue."""
    return tuple((track, release) for track in TRACKS if (release := track.release) is not None)


def _slug(text: str) -> str:
    """Sous-domaine Bandcamp d'un artiste : ASCII, minuscules, tirets."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def _bandcamp_url(track: DemoTrack, release: Release) -> str:
    slug = _RELEASE_FACTS[release.reference].slug
    return f"https://{_slug(track.artist)}.bandcamp.example/track/{slug}"


LOWLANDS_RECOVERY_URL: Final[str] = _bandcamp_url(LOWLANDS, _LOWLANDS_RELEASE)


def register_replies(api: FakeApi) -> None:
    """Reponses des recherches, des relectures de fiche et du rattrapage de « Lowlands ».

    Les cles `q` sont la requete que le sidecar construit des tags du morceau. Une
    recherche sans reponse enregistree rend une page vide : c'est le « rien trouve ».
    """
    for track, release in resolved_releases():
        _register(api, track, release)


def _register(api: FakeApi, track: DemoTrack, release: Release) -> None:
    query = search_query(track)
    match release.tagging:
        case TaggingCase.AUTO_BEATPORT | TaggingCase.LOCKED_ON_WRITE:
            _on_beatport(api, query, _beatport_payload(track, release))
        case TaggingCase.BANDCAMP_ONLY:
            _on_bandcamp(api, query, track, release)
        case TaggingCase.TWO_BEATPORT_MIXES:
            first, second = _TWO_MIXES
            _on_beatport(
                api,
                query,
                _beatport_payload(track, release, mix_name=first),
                _beatport_payload(track, release, mix_name=second, variant=1),
            )
        case TaggingCase.WRONG_BEATPORT:
            remix = _beatport_payload(
                track, release, mix_name=_WRONG_MIX, remixers=(_WRONG_REMIXER,), variant=1
            )
            _on_beatport(api, query, remix)
            _on_bandcamp(api, query, track, release)
        case TaggingCase.NOT_FOUND:
            _on_bandcamp_page(api, track, release)
        case _:
            assert_never(release.tagging)


@cache
def search_query(track: DemoTrack) -> str:
    """Requete que le sidecar tire des tags poses par `tagged_audio` : cle des reponses du
    faux techno-scraper et de leurs gates."""
    query = build_query(track.artist, track.title, track.file_name)
    assert query is not None, f"{track.file_name} has no usable query"
    return query.text


def _on_beatport(api: FakeApi, query: str, *payloads: dict[str, object]) -> None:
    """La recherche Beatport ne rend pas `track_number`, la relecture par id le rend."""
    searched = (payload | {"track_number": None} for payload in payloads)
    api.on(BEATPORT_SEARCH, query, found(*searched))
    for payload in payloads:
        api.on(f"{BEATPORT_TRACKS}/{payload['id']}", "*", ok(payload))


def _on_bandcamp(api: FakeApi, query: str, track: DemoTrack, release: Release) -> None:
    """La recherche Bandcamp ne rend ni date, ni label, ni ISRC, ni numero de piste."""
    searched = _bandcamp_payload(track, release) | {
        "label": None,
        "isrc": None,
        "track_number": None,
        "release": _release_payload(track, release) | {"release_date": None},
    }
    api.on(BANDCAMP_SEARCH, query, found(searched))
    _on_bandcamp_page(api, track, release)


def _on_bandcamp_page(api: FakeApi, track: DemoTrack, release: Release) -> None:
    api.on(BANDCAMP_TRACKS, _bandcamp_url(track, release), ok(_bandcamp_payload(track, release)))


def _credit(track: DemoTrack, release: Release) -> dict[str, object]:
    artist_id = _RELEASE_FACTS[release.reference].artist_id
    return {"id": artist_id, "name": track.artist, "kind": "artist", "social_links": []}


def _label_payload(label: Label) -> dict[str, object]:
    return {"id": _LABEL_FACTS[label.name].label_id, "name": label.name, "kind": "label"}


def _release_payload(track: DemoTrack, release: Release) -> dict[str, object]:
    label_id = _LABEL_FACTS[release.label.name].label_id
    return {
        "id": f"{label_id}{release.reference[-3:]}",
        "title": track.title,
        "source_title": track.title,
        "catalog_number": release.reference,
        "release_date": _RELEASE_FACTS[release.reference].released.isoformat(),
        "artwork_url": f"https://artwork.example/{release.reference}.jpg",
    }


def _isrc(release: Release, variant: int) -> str:
    """Code pays `ZZ`, reserve aux usages hors attribution."""
    registrant = _LABEL_FACTS[release.label.name].isrc_registrant
    year = _RELEASE_FACTS[release.reference].released.year % 100
    designation = int(release.reference[-3:]) + variant * _VARIANT_ISRC_STEP
    return f"ZZ{registrant}{year:02d}{designation:05d}"


def _beatport_payload(
    track: DemoTrack,
    release: Release,
    *,
    mix_name: str = _ORIGINAL_MIX,
    remixers: tuple[tuple[DemoTrack, Release], ...] = (),
    variant: int = 0,
) -> dict[str, object]:
    """Fiche Beatport complete ; `variant` donne a une autre version son id et son ISRC."""
    facts = _RELEASE_FACTS[release.reference]
    track_id = str(int(facts.track_id) + variant)
    return track_payload(
        id=track_id,
        title=track.title,
        source_title=track.title,
        mix_name=mix_name,
        artists=[_credit(track, release)],
        remixers=[_credit(*remixer) for remixer in remixers],
        release=_release_payload(track, release),
        label=_label_payload(release.label),
        genre=_LABEL_FACTS[release.label.name].genre,
        bpm=facts.bpm,
        key=facts.key,
        isrc=_isrc(release, variant),
        track_number=facts.track_number,
        url=f"https://beatport.example/track/{facts.slug}/{track_id}",
        source="beatport",
    )


def _bandcamp_payload(track: DemoTrack, release: Release) -> dict[str, object]:
    """Fiche Bandcamp relue par URL : ni BPM, ni tonalite, ni genre ; label d'un compte de label."""
    facts = _RELEASE_FACTS[release.reference]
    return bandcamp_track_payload(
        id=facts.track_id,
        title=track.title,
        source_title=track.title,
        artists=[_credit(track, release)],
        remixers=[],
        release=_release_payload(track, release),
        label=_label_payload(release.label),
        genre=None,
        bpm=None,
        key=None,
        isrc=_isrc(release, 0),
        track_number=facts.track_number,
        url=_bandcamp_url(track, release),
    )
