"""Construction de la requete d'un morceau et classement de ses candidats.

Fonctions pures, sans IO. Regles et mesures : ARCHITECTURE.md § Use-case 2 et le
spec du sub-project 03 de la Feature 2. Origine des seuils : la CLI
BeatportScrapper-TrackTagger.
"""

import re
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from pathlib import PurePath
from typing import TYPE_CHECKING, Final, NamedTuple

from rapidfuzz import fuzz, process, utils

if TYPE_CHECKING:
    from collections.abc import Sequence

    from tagger.scraper_client import TrackCandidate

# Mots qui rendent un groupe intouchable au nettoyage. Deux familles distinctes : une
# version se compare a celle du candidat, une collaboration fait partie du titre.
# Bornes, suffixes et liste : spec 03 § Garde de version et de collaboration.
_VERSION_WORDS: Final = (
    r"(?:re-edit|remix|mix|edit|rework|remaster|version|dub|extended|radio|bootleg"
    r"|vip|live|instrumental|acapella|reprise|tool|loop|intro|outro)(?:ed|s)?"
)
_COLLABORATION_WORDS: Final = r"feat\.?|ft\.?|featuring|with|pres\.?|vs\.?"
_VERSION_GUARD: Final = re.compile(rf"(?<!\w)(?:{_VERSION_WORDS})(?!\w)", re.IGNORECASE)
_COLLABORATION_GUARD: Final = re.compile(rf"(?<!\w)(?:{_COLLABORATION_WORDS})(?!\w)", re.IGNORECASE)
_GUARD: Final = re.compile(
    rf"(?<!\w)(?:{_VERSION_WORDS}|{_COLLABORATION_WORDS})(?!\w)", re.IGNORECASE
)
_DOWNLOAD: Final = re.compile(r"\bfree[\s_-]*(?:dl|download)\b", re.IGNORECASE)
_ENCODING: Final = re.compile(r"\b(?:\d{2,3}\s*kbps|320|flac|wav|mp3)\b", re.IGNORECASE)
_GROUP: Final = re.compile(r"[\[(](?P<content>[^\[\]()]*)[\])]")
_SPACES: Final = re.compile(r"\s+")
# Entoures d'espaces sauf ; et / : « Jay-Z » ne doit jamais etre coupe. Pas de « & » :
# il appartient au nom du duo bien plus souvent qu'il ne separe deux artistes (« Pig &
# Dan », « Hicky & Kalo »), et Beatport ne joint jamais deux credits ainsi. Le signe de
# multiplication est un vrai separateur, pas une faute de frappe pour x (d'ou le noqa).
_ARTIST_SEPARATORS: Final = re.compile(
    r"\s*[;/]\s*|\s+(?:and|x|×|vs\.?|feat\.?|ft\.?|featuring)\s+",  # noqa: RUF001
    re.IGNORECASE,
)
# Un nom d'artiste porte des parentheses qui le designent, jamais de crochets : releve
# le 2026-09-20 sur 963 credits Beatport, les 22 groupes parenthesees tiennent tous un
# code pays ou de genre (« SOSA (UK) », « Aeon (PSY) »). Seuls les crochets et le bruit
# de tag partent, un fichier mal tague pouvant porter « Adam Beyer (320kbps) ».
_ARTIST_NOISE: Final = re.compile(r"\[[^\[\]]*\]")
# Beatport ecrit l'invite dans le titre (« Biome feat. BCCO ») en plus de le crediter
# dans `artists[]`, la ou un tag de fichier ne le met qu'au champ artiste. Le titre se
# coupe donc a sa mention d'invite, des deux cotes : ce que l'axe artiste score deja
# ne doit ni aider ni penaliser l'axe titre.
_FEATURING: Final = re.compile(
    rf"(?<!\w)(?:feat\.?|ft\.?|featuring)(?!\w)(?:(?!{_VERSION_WORDS}).)*", re.IGNORECASE
)
_AMPERSAND: Final = re.compile(r"\s+&\s+")
# Reste d'un groupe dont le nettoyage a emporte tout le contenu.
_EMPTY_GROUP: Final = re.compile(r"[\[(]\s*[\])]")
_LETTER: Final = re.compile(r"[^\W\d_]")
# Deux chiffres au plus : « 808 State » et « 999999999 » restent des artistes.
_TRACK_NUMBER: Final = re.compile(r"^\d{1,2}(?!\d)\s*[-._)]?\s*")
_FILE_NAME_SEPARATOR: Final = " - "
_EDGE_NOISE: Final = " -_.,;"
_ORIGINAL_MIX: Final = "Original Mix"
# Deux libelles se reconnaissent au-dela de la casse : « Extended Mix » vaut
# « Extended ». Distinct des seuils, qui portent sur l'artiste et le titre.
_VERSION_MATCH_FLOOR: Final = 70
# Mot entier : sinon "remix" matche dans "Premix" ou "Extremixed".
_REMIX_WORD: Final = re.compile(r"\bremix\b", re.IGNORECASE)
# « Pt. 1 » et « Pt. 2 » sont deux morceaux, mais ne different que d'un caractere au score.
_NUMBER: Final = re.compile(r"\d+")
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
        check_thresholds(self.floor, self.ceiling)


def check_thresholds(floor: float, ceiling: float) -> None:
    """Bornes des seuils, verifiees ici et nulle part ailleurs.

    La commande `start_tagging` appelle la meme fonction sur sa charge, de facon a
    refuser des seuils incoherents a la validation plutot qu'en plein run.
    """
    if not 0 <= floor <= ceiling <= _MAX_SCORE:
        raise ValueError(f"inconsistent thresholds: floor={floor} ceiling={ceiling}")


DEFAULT_THRESHOLDS: Final = MatchingThresholds()


@dataclass(frozen=True, slots=True)
class ScoredCandidate:
    """Scores d'un candidat, gardes pour le rapport et le recalibrage des seuils.

    `artist_score` vaut `None` sans artiste dans la requete. `version_mismatch` et
    `number_mismatch` bloquent l'auto : seul l'utilisateur tranche entre deux versions d'un
    meme morceau, ou entre deux morceaux que seul un nombre distingue.
    """

    candidate: TrackCandidate
    artist_score: float | None
    title_score: float
    score: float
    version_mismatch: bool
    number_mismatch: bool


class _Parts(NamedTuple):
    """Titre nu et mention de version, la forme sous laquelle les deux cotes se comparent."""

    title: str
    version: str


@dataclass(frozen=True, slots=True)
class _AskedFor:
    """Ce qu'un morceau demande, derive une fois puis compare a chaque candidat."""

    title: str
    version: str
    artists: tuple[str, ...]
    numbers: tuple[int, ...]


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
    # Un titre que le nettoyage vide reprend sa valeur brute, une requete bruitee
    # valant mieux qu'une requete vide.
    query_artist = _normalise_artists(artist)
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
    """Separateurs ramenes a la virgule, crochets retires, parentheses conservees."""
    cleaned = _ENCODING.sub(" ", _DOWNLOAD.sub(" ", _ARTIST_NOISE.sub(" ", artist)))
    cleaned = _EMPTY_GROUP.sub(" ", cleaned)
    parts = (part.strip() for part in _ARTIST_SEPARATORS.sub(",", cleaned).split(","))
    return ", ".join(part for part in parts if part)


def classify(
    query: TrackQuery,
    candidates: Sequence[TrackCandidate],
    thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
    *,
    allow_auto: bool = True,
) -> Classification:
    """Classe les candidats d'une source en auto, zone grise ou vide (spec 03).

    Tri stable : a score egal l'ordre de l'API departage. `allow_auto=False` force la
    zone grise, ce dont le pipeline se sert quand Beatport n'a pas repondu.
    """
    asked = _prepare(query)
    scored: list[ScoredCandidate] = []
    for candidate in candidates:
        bare, in_title = _comparable(candidate.title)
        offered = _Parts(bare, candidate.mix_name or in_title)
        if not _passes_remix_guard(_Parts(asked.title, asked.version), offered):
            continue
        scored.append(_score(asked, candidate, offered))

    every = tuple(scored)
    in_play = sorted(
        (entry for entry in every if _above_floor(entry, thresholds.floor)),
        key=lambda entry: entry.score,
        reverse=True,
    )
    automatic = (
        next(
            (
                entry
                for entry in in_play
                if not (entry.version_mismatch or entry.number_mismatch)
                and entry.score >= thresholds.ceiling
            ),
            None,
        )
        if allow_auto
        else None
    )
    if automatic is not None:
        return Classification(Outcome.AUTO, (automatic,), every)
    if in_play:
        return Classification(Outcome.GREY_ZONE, tuple(in_play), every)
    return Classification(Outcome.EMPTY, (), every)


def _prepare(query: TrackQuery) -> _AskedFor:
    """Ce que la requete demande, derive une fois par morceau et non par candidat."""
    title, version = _comparable(query.title)
    artists = tuple(part.strip() for part in query.artist.split(",") if part.strip())
    return _AskedFor(title, version, artists, _numbers(title))


def _comparable(title: str) -> _Parts:
    """Titre nu et version, seul chemin vers la forme comparable.

    Unique pour que requete et candidat subissent le meme traitement : nettoyer un
    seul cote suffit a faire tomber un morceau identique sous le plancher.
    """
    bare, version = _split_version(_clean(title))
    return _Parts(_SPACES.sub(" ", _FEATURING.sub(" ", bare)).strip(_EDGE_NOISE + "(["), version)


def _split_version(title: str) -> _Parts:
    """Detache la version du titre, sans toucher aux groupes de collaboration.

    « (feat. X) » identifie le morceau autant que son nom et reste dans le titre.
    """
    taken: list[str] = []

    def take(match: re.Match[str]) -> str:
        content = match.group("content")
        if _VERSION_GUARD.search(content) is None:
            return match.group(0)
        # Un groupe qui nomme aussi un invite reste une version : « (Extended Mix feat.
        # X) » cede sa mention d'invite, « (A vs B Remix) » garde la sienne, le credit
        # de remix etant le libelle meme de la version. Laisser le groupe entier dans le
        # titre perdait la version et y collait une parenthese jamais fermee.
        if _COLLABORATION_GUARD.search(content):
            # `content` n'a pas de crochet, `_FEATURING` ne peut donc pas en emporter un.
            without_guest = _FEATURING.sub(" ", content).strip()
            if _VERSION_GUARD.search(without_guest) is None:
                return match.group(0)
            taken.append(_SPACES.sub(" ", without_guest))
            return " "
        taken.append(content.strip())
        return " "

    bare = _GROUP.sub(take, title)
    return _Parts(_SPACES.sub(" ", bare).strip(_EDGE_NOISE), " ".join(taken))


def _score(asked: _AskedFor, candidate: TrackCandidate, offered: _Parts) -> ScoredCandidate:
    """Score un candidat : titre et version separement, jamais concatenes."""
    title_score = fuzz.ratio(asked.title, offered.title, processor=utils.default_process)
    mismatch = not _versions_agree(asked.version, offered.version)
    renumbered = asked.numbers != _numbers(offered.title)
    if not asked.artists:
        return ScoredCandidate(candidate, None, title_score, title_score, mismatch, renumbered)
    artist_score = _artist_score(asked.artists, candidate)
    average = (artist_score + title_score) / 2
    return ScoredCandidate(candidate, artist_score, title_score, average, mismatch, renumbered)


def _numbers(title: str) -> tuple[int, ...]:
    """Nombres du titre nu, en valeur : « 01 » et « 1 » designent la meme partie."""
    return tuple(int(number) for number in _NUMBER.findall(title))


def _versions_agree(asked: str, offered: str) -> bool:
    """Deux morceaux portent-ils la meme version ?

    « Original Mix » vaut absence de version, un tag l'omettant presque toujours : une
    requete muette s'accorde donc avec un original, jamais avec un Extended.
    """
    left, right = _normalise_version(asked), _normalise_version(offered)
    if not left or not right:
        return not left and not right
    return fuzz.ratio(left, right, processor=utils.default_process) >= _VERSION_MATCH_FLOOR


def _normalise_version(version: str) -> str:
    stripped = _SPACES.sub(" ", version).strip()
    return "" if stripped.casefold() == _ORIGINAL_MIX.casefold() else stripped


def _artist_score(asked: tuple[str, ...], candidate: TrackCandidate) -> float:
    """Chaque artiste demande doit se retrouver parmi les credits du candidat.

    Le minimum et non la moyenne : un artiste absent est un desaccord que la presence
    des autres ne rachete pas.
    """
    credits = [_normalise_artists(credit.name) for credit in candidate.artists]
    if not credits or not asked:
        return 0.0
    return max(_credits_score(asked, credits), _credits_score(_split_duos(asked), credits))


def _split_duos(asked: tuple[str, ...]) -> tuple[str, ...]:
    """Seconde lecture d'une esperluette : celle qui separe deux artistes.

    « A & B » nomme un duo (« Pig & Dan ») ou deux artistes qu'un logiciel a joints, et
    la chaine seule ne le dit pas. Les deux lectures sont donc scorees et la meilleure
    gagne : c'est la façon dont la source credite qui tranche, jamais une regle devinee.
    """
    return tuple(part.strip() for name in asked for part in _AMPERSAND.split(name) if part.strip())


def _credits_score(asked: tuple[str, ...], credits: list[str]) -> float:
    return min(_best_credit(name, credits) for name in asked) if asked else 0.0


def _best_credit(name: str, credits: list[str]) -> float:
    """Meilleur score du nom contre les credits : un axe unique, donc `extractOne`.

    L'ecart a la rule rapidfuzz que le spec assume porte sur le candidat entier, ou
    deux scores se combinent en ET ; il ne couvre pas cette recherche-ci.
    """
    best = process.extractOne(name, credits, scorer=fuzz.ratio, processor=utils.default_process)
    return float(best[1]) if best else 0.0


def _above_floor(entry: ScoredCandidate, floor: float) -> bool:
    artist_ok = entry.artist_score is None or entry.artist_score >= floor
    return artist_ok and entry.title_score >= floor


def _passes_remix_guard(asked: _Parts, offered: _Parts) -> bool:
    """Un remix demande n'est jamais satisfait par un original (regle de la CLI).

    Titre et version examines separement de chaque cote, jamais recolles : un remix
    s'annonce aussi bien dans un groupe que nu au bout du titre.
    """
    if not _mentions_remix(asked):
        return True
    return _mentions_remix(offered)


def _mentions_remix(parts: _Parts) -> bool:
    return any(_REMIX_WORD.search(part) is not None for part in parts)


def full_title(candidate: TrackCandidate) -> str:
    """Titre tel que l'ADR-011 l'ecrit : titre et mix.

    Distinct de la forme comparee par le scoring, qui separe au contraire titre et
    version (`_comparable`) : afficher et scorer ne demandent pas la meme chaine.
    """
    mix_name = candidate.mix_name
    if not mix_name or _mentions(candidate.title, mix_name):
        return candidate.title
    completed = _complete_partial_mention(candidate.title, mix_name)
    if completed is not None:
        return completed
    return f"{candidate.title} ({mix_name})"


def _prefixes(mix_name: str, opening: str) -> bool:
    """Mot entier et en tete : « Dub » annonce « Dub Mix », jamais « Sunset Dub Edit »,
    ou la source a place sa propre annotation.
    """
    guard = re.compile(rf"^{re.escape(opening)}(?!\w)", re.IGNORECASE)
    return guard.search(mix_name) is not None


def _mentions(title: str, mix_name: str) -> bool:
    """Mot entier : un mix court ne doit pas matcher un fragment d'un autre mot
    (« Dub » dans « Dubplate »).
    """
    guard = re.compile(rf"(?<!\w){re.escape(mix_name)}(?!\w)", re.IGNORECASE)
    return guard.search(title) is not None


def _complete_partial_mention(title: str, mix_name: str) -> str | None:
    """Complete un groupe du titre qui n'annonce la version qu'a moitie.

    Les deux sources separent titre et version, donc un titre en « (Extended) » avec un
    `mix_name` « Extended Mix » sort du contrat : sans ce traitement, le tag recevrait
    « Song (Extended) (Extended Mix) ».

    Seul le groupe qui prefixe la version est traite : ailleurs « Extended » est un mot
    ordinaire, et « (Live) » contre « Extended Mix » nomme une autre version.
    """
    for group in _GROUP.finditer(title):
        inner = group.group("content").strip()
        if inner and _prefixes(mix_name, inner):
            return f"{title[: group.start()]}({mix_name}){title[group.end() :]}"
    return None


def credited_artists(candidate: TrackCandidate) -> str:
    """Artistes joints comme dans la CLI, remixeurs exclus : ils vivent dans le mix."""
    return ", ".join(credit.name for credit in candidate.artists)
