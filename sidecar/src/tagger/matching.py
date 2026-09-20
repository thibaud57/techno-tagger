"""Construction de la requete d'un morceau et classement de ses candidats.

Fonctions pures, sans IO. Les regles de scoring viennent de la CLI d'origine
(BeatportScrapper-TrackTagger, `scrappers/track_matcher.py`). Le nettoyage, sa
garde et le repli sur le nom de fichier sont decrits en ARCHITECTURE.md § Use-case 2
et dans le spec du sub-project 03 de la Feature 2.
"""

import re
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from pathlib import PurePath
from typing import TYPE_CHECKING, Final

from rapidfuzz import fuzz, utils

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from tagger.scraper_client import TrackCandidate

# Un groupe qui contient l'un de ces mots identifie le morceau et n'est jamais retire.
# Bornes \w plutot que [\w-] : un mot de garde soude par un tiret ("VIP-Mix",
# "Radio-Edit") doit rester reconnu, seule la lettre est un caractere de mot.
# Suffixe -ed / -s sur les seules mentions de version : les distributeurs imposent la
# forme nominale, mais les reeditions ecrivent « (Remastered) » et Beatport « (DJ Tools) ».
_GUARD: Final = re.compile(
    r"(?<!\w)(?:"
    r"(?:re-edit|remix|mix|edit|rework|remaster|version|dub|extended|radio|bootleg"
    r"|vip|live|instrumental|acapella|reprise|tool|loop|intro|outro)(?:ed|s)?"
    r"|feat\.?|ft\.?|featuring|with|pres\.?|vs\.?"
    r")(?!\w)",
    re.IGNORECASE,
)
_DOWNLOAD: Final = re.compile(r"\bfree[\s_-]*(?:dl|download)\b", re.IGNORECASE)
_ENCODING: Final = re.compile(r"\b(?:\d{2,3}\s*kbps|320|flac|wav|mp3)\b", re.IGNORECASE)
_GROUP: Final = re.compile(r"[\[(](?P<content>[^\[\]()]*)[\])]")
_SPACES: Final = re.compile(r"\s+")
# Formes entourees d'espaces seulement, sauf ; et / : « Jay-Z » et « Jax Jones »
# ne doivent jamais etre coupes. Le signe de multiplication n'est pas une faute
# de frappe pour la lettre x : c'est un separateur d'artistes reel, ecrit tel
# quel par certains tags (noqa RUF001/RUF003 ci-dessous et dans les tests).
_ARTIST_SEPARATORS: Final = re.compile(
    r"\s*[;/]\s*|\s+(?:&|and|x|×|vs\.?|feat\.?|ft\.?|featuring)\s+",  # noqa: RUF001
    re.IGNORECASE,
)
_LETTER: Final = re.compile(r"[^\W\d_]")
# Deux chiffres au plus : « 808 State » et « 999999999 » restent des artistes.
_TRACK_NUMBER: Final = re.compile(r"^\d{1,2}(?!\d)\s*[-._)]?\s*")
_FILE_NAME_SEPARATOR: Final = " - "
_EDGE_NOISE: Final = " -_.,;"
_GROUP_DELIMITERS: Final = "()[]"
_ORIGINAL_MIX: Final = "Original Mix"
# Mot entier : sinon "remix" matche dans "Premix" ou "Extremixed".
_REMIX_WORD: Final = re.compile(r"\bremix\b", re.IGNORECASE)
_MAX_SCORE: Final = 100


@verify(UNIQUE)
class QueryOrigin(StrEnum):
    """D'ou vient la requete : les tags du fichier ou son nom."""

    TAGS = auto()
    FILENAME = auto()


@dataclass(frozen=True, slots=True)
class TrackQuery:
    """Artiste et titre nettoyes d'un morceau. Artiste vide : inconnu."""

    artist: str
    title: str
    origin: QueryOrigin

    @property
    def text(self) -> str:
        """Chaine envoyee a techno-scraper."""
        return f"{self.artist} {self.title}".strip()


@dataclass(frozen=True, slots=True)
class MatchingThresholds:
    """Plancher en ET sur les deux scores, seuil haut sur leur moyenne.

    Defauts herites de la CLI, a recalibrer aux premiers runs reels (ADR-008).
    """

    floor: float = 70
    ceiling: float = 90

    def __post_init__(self) -> None:
        if not 0 <= self.floor <= self.ceiling <= _MAX_SCORE:
            raise ValueError(f"inconsistent thresholds: floor={self.floor} ceiling={self.ceiling}")


DEFAULT_THRESHOLDS: Final = MatchingThresholds()


@dataclass(frozen=True, slots=True)
class ScoredCandidate:
    """Scores d'un candidat, consignes pour le rapport et le recalibrage.

    `artist_score` vaut `None` quand la requete n'a pas d'artiste. `via_bare_title`
    signale un titre qui n'atteint son score que sans son mix : pas d'auto possible.
    """

    candidate: TrackCandidate
    artist_score: float | None
    title_score: float
    score: float
    via_bare_title: bool


@verify(UNIQUE)
class Outcome(StrEnum):
    """Issue du classement des candidats d'une source."""

    AUTO = auto()
    GREY_ZONE = auto()
    EMPTY = auto()


@dataclass(frozen=True, slots=True)
class Classification:
    """`retained` : le candidat valide (auto), les candidats en jeu (zone grise), ou rien."""

    outcome: Outcome
    retained: tuple[ScoredCandidate, ...]
    scored: tuple[ScoredCandidate, ...]


def build_query(artist: str, title: str, file_name: str) -> TrackQuery | None:
    """Requete du morceau, ou `None` quand rien n'est exploitable (`empty_query`).

    Les tags d'abord, le nom de fichier en repli (ARCHITECTURE.md § Requete vide
    apres nettoyage).
    """
    return _from_tags(artist, title) or _from_file_name(file_name)


def _from_tags(artist: str, title: str) -> TrackQuery | None:
    # Un champ que le nettoyage vide reprend sa valeur brute : une requete bruitee
    # vaut mieux qu'une requete vide.
    query_artist = _normalise_artists(_clean(artist)) or _normalise_artists(artist)
    query_title = _clean(title) or title.strip()
    if not (_LETTER.search(query_artist) and _LETTER.search(query_title)):
        return None
    return TrackQuery(query_artist, query_title, QueryOrigin.TAGS)


def _from_file_name(file_name: str) -> TrackQuery | None:
    stem = PurePath(file_name).stem
    if " " not in stem:
        stem = stem.replace("_", " ")
    cleaned = _clean(_TRACK_NUMBER.sub("", stem, count=1))
    if not _LETTER.search(cleaned):
        return None
    artist, separator, title = cleaned.partition(_FILE_NAME_SEPARATOR)
    if not separator:
        return TrackQuery("", cleaned, QueryOrigin.FILENAME)
    return TrackQuery(_normalise_artists(artist), title.strip(), QueryOrigin.FILENAME)


def _clean(text: str) -> str:
    """Retire le bruit de la chaine interrogee, jamais des tags ecrits."""
    text = _DOWNLOAD.sub(" ", text)
    text = _ENCODING.sub(" ", text)
    text = _GROUP.sub(_keep_guarded_group, text)
    return _SPACES.sub(" ", text).strip(_EDGE_NOISE)


def _keep_guarded_group(match: re.Match[str]) -> str:
    return match.group(0) if _GUARD.search(match.group("content")) else " "


def _normalise_artists(artist: str) -> str:
    parts = (part.strip() for part in _ARTIST_SEPARATORS.sub(",", artist).split(","))
    return ", ".join(part for part in parts if part)


def classify(
    query: TrackQuery,
    candidates: Sequence[TrackCandidate],
    thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
    *,
    allow_auto: bool = True,
) -> Classification:
    """Classe les candidats d'une source en auto, zone grise ou vide.

    Le tri est stable : a score egal, l'ordre rendu par l'API departage, comme
    dans la CLI. `allow_auto=False` envoie tout candidat en jeu en zone grise : le
    pipeline s'en sert pour Bandcamp quand Beatport n'a pas pu repondre.
    """
    scored = tuple(
        _score(query, candidate)
        for candidate in candidates
        if _passes_remix_guard(query.title, candidate)
    )
    in_play = sorted(
        (entry for entry in scored if _above_floor(entry, thresholds.floor)),
        key=lambda entry: entry.score,
        reverse=True,
    )
    automatic = (
        next(
            (
                entry
                for entry in in_play
                if not entry.via_bare_title and entry.score >= thresholds.ceiling
            ),
            None,
        )
        if allow_auto
        else None
    )
    if automatic is not None:
        return Classification(Outcome.AUTO, (automatic,), scored)
    if in_play:
        return Classification(Outcome.GREY_ZONE, tuple(in_play), scored)
    return Classification(Outcome.EMPTY, (), scored)


def _score(query: TrackQuery, candidate: TrackCandidate) -> ScoredCandidate:
    if candidate.mix_name:
        # Beatport separe la version du titre. Sans version dans la requete, on
        # compare aussi au titre nu : un Extended seul tomberait sinon sous le
        # plancher (69,6 mesure le 2026-09-19).
        full = fuzz.ratio(
            _query_title(query.title), _candidate_title(candidate), processor=utils.default_process
        )
        bare = _bare_ratio(query, candidate) if _lacks_version(query.title) else 0.0
    else:
        # Bandcamp ne rend jamais de mix_name : la version, s'il y en a une, est deja
        # dans le titre. Le suffixe « (Original Mix) » l'eloignerait a tort.
        full = _bare_ratio(query, candidate)
        bare = 0.0
    title_score = max(full, bare)
    via_bare_title = bare > full
    if not query.artist:
        return ScoredCandidate(candidate, None, title_score, title_score, via_bare_title)
    artist_score = _artist_scorer(query.artist)(
        query.artist, _candidate_artists(candidate), processor=utils.default_process
    )
    score = (artist_score + title_score) / 2
    return ScoredCandidate(candidate, artist_score, title_score, score, via_bare_title)


def _bare_ratio(query: TrackQuery, candidate: TrackCandidate) -> float:
    """Titres comparés nus, sans le suffixe de version d'aucun des deux côtés."""
    return fuzz.ratio(query.title, candidate.title, processor=utils.default_process)


def _above_floor(entry: ScoredCandidate, floor: float) -> bool:
    artist_ok = entry.artist_score is None or entry.artist_score >= floor
    return artist_ok and entry.title_score >= floor


def _passes_remix_guard(query_title: str, candidate: TrackCandidate) -> bool:
    """Regle de la CLI : un remix demande n'est jamais satisfait par un original."""
    if _REMIX_WORD.search(query_title) is None:
        return True
    return _REMIX_WORD.search(_candidate_title(candidate)) is not None


def _lacks_version(title: str) -> bool:
    # Les crochets comptent autant que les parentheses : apres nettoyage, un groupe
    # qui a survecu porte forcement une mention de version ou de collaboration.
    return _REMIX_WORD.search(title) is None and not any(
        delimiter in title for delimiter in _GROUP_DELIMITERS
    )


def _query_title(title: str) -> str:
    return f"{title} ({_ORIGINAL_MIX})" if _lacks_version(title) else title


def _candidate_title(candidate: TrackCandidate) -> str:
    mix_name = candidate.mix_name
    # Casse ignoree : une source qui ecrit « (extended mix) » dans le titre et
    # « Extended Mix » dans le champ se verrait sinon coller la version deux fois.
    if not mix_name or mix_name.casefold() in candidate.title.casefold():
        return candidate.title
    return f"{candidate.title} ({mix_name})"


def _candidate_artists(candidate: TrackCandidate) -> str:
    """Artistes joints comme dans la CLI, remixeurs exclus : ils vivent dans le mix."""
    return ", ".join(credit.name for credit in candidate.artists)


def _artist_scorer(artist: str) -> Callable[..., float]:
    return fuzz.token_sort_ratio if ("," in artist or "&" in artist) else fuzz.ratio
