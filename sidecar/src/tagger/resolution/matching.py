"""Construction de la requete d'un morceau et classement de ses candidats.

Fonctions pures, sans IO. Regles et mesures : ARCHITECTURE.md § Use-case 2 et le
spec du sub-project 03 de la Feature 2.
"""

import re
from copy import replace
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from pathlib import PurePath
from typing import TYPE_CHECKING, Final, NamedTuple

from rapidfuzz import fuzz, process, utils

if TYPE_CHECKING:
    from collections.abc import Sequence

    from tagger.resolution.scraper_client import TrackCandidate

# Mots qui rendent un groupe intouchable au nettoyage. Deux familles distinctes : une
# version se compare a celle du candidat, une collaboration fait partie du titre.
# Bornes, suffixes et liste : § Garde de version et de collaboration du meme spec.
# Jumeau cote techno-scraper (`shared/normalize/`, ADR-012 de techno-scraper), qui nettoie
# la sortie des sources la ou ce module nettoie la requete : une correction sur une brique
# commune se reporte de l'autre cote, les politiques restent distinctes.
_REMIX_WORDS: Final = r"remix|rmx"
_VERSION_WORDS: Final = (
    rf"(?:re-edit|{_REMIX_WORDS}|mix|edit|rework|remaster|version|dub|extended|radio|bootleg"
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
# Dan », « Hicky & Kalo »). Le signe de multiplication est un vrai separateur, pas une
# faute de frappe pour x.
_ARTIST_SEPARATORS: Final = re.compile(
    r"\s*[;/]\s*|\s+(?:and|x|×|vs\.?|feat\.?|ft\.?|featuring)\s+",
    re.IGNORECASE,
)
# Un nom d'artiste porte des parentheses qui le designent, jamais de crochets : releve
# le 2026-09-20 sur 963 credits Beatport, les 22 groupes parenthesees tiennent tous un
# code pays ou de genre (« SOSA (UK) », « Lumo (PSY) »). Seuls les crochets et le bruit
# de tag partent, un fichier mal tague pouvant porter « Adam Beyer (320kbps) ».
_ARTIST_NOISE: Final = re.compile(r"\[[^\[\]]*\]")
# Un tag peut ecrire l'invite dans le titre (« Biome feat. BCCO ») en plus du champ artiste :
# le titre de la requete se coupe a sa mention, l'axe artiste le scorant deja. Premier mot
# toujours pris, arret devant un mot de version entier seulement (« feat. Dubfire »).
_FEATURING: Final = re.compile(
    rf"(?<!\w)(?:feat\.?|ft\.?|featuring)(?!\w)\s*\S*(?:(?!{_VERSION_GUARD.pattern}).)*",
    re.IGNORECASE,
)
_AMPERSAND: Final = re.compile(r"\s+&\s+")
# Reste d'un groupe dont le nettoyage a emporte tout le contenu.
_EMPTY_GROUP: Final = re.compile(r"[\[(]\s*[\])]")
_LETTER: Final = re.compile(r"[^\W\d_]")
# Deux chiffres au plus : « 808 State » et « 999999999 » restent des artistes.
_TRACK_NUMBER: Final = re.compile(r"^\d{1,2}(?!\d)\s*[-._)]?\s*")
_FILE_NAME_SEPARATOR: Final = " - "
_EDGE_NOISE: Final = " -_.,;"
# « (Original) » nomme l'original comme « Original Mix » : aucune version demandee.
_ORIGINALS: Final = frozenset({"original", "original mix"})
# Deux libelles se reconnaissent au-dela de la casse : « Extended Mix » vaut
# « Extended ». Distinct des seuils, qui portent sur l'artiste et le titre.
_VERSION_MATCH_FLOOR: Final = 70
# Mot entier : sinon "remix" matche dans "Premix" ou "Extremixed".
_REMIX_WORD: Final = re.compile(rf"\b(?:{_REMIX_WORDS})\b", re.IGNORECASE)
# « Pt. 1 » et « Pt. 2 » sont deux morceaux mais ne different que d'un caractere au score.
# Toute divergence compte, un nombre ajoute d'un seul cote compris : « Fernhollow » face a
# « Fernhollow 1 » (meme morceau, desambigue par Beatport) passe en zone grise a tort. Cout
# assume du choix inverse, ou « Minimal Nation 2 » se validerait seul sur « Minimal Nation » :
# un arbitrage coute une seconde, un mauvais tag ecrit sans relecture un fichier.
_NUMBER: Final = re.compile(r"\d+")
_MAX_SCORE: Final = 100


@verify(UNIQUE)
class QueryOrigin(StrEnum):
    TAGS = auto()
    FILENAME = auto()


@dataclass(frozen=True, slots=True, kw_only=True)
class TrackQuery:
    """Artiste et titre nettoyes d'un morceau. Artiste vide : inconnu."""

    artist: str
    title: str
    origin: QueryOrigin

    @property
    def text(self) -> str:
        """Chaine envoyee a techno-scraper : sans les groupes que `title` garde pour le scoring."""
        return f"{self.artist} {_clean(self.title) or self.title}".strip()


@dataclass(frozen=True, slots=True, kw_only=True)
class MatchingThresholds:
    """Plancher en ET sur les deux scores, seuil haut sur leur moyenne.

    Defauts herites de la CLI, a recalibrer aux premiers runs reels (ADR-008).
    """

    floor: float = 70
    ceiling: float = 90

    def __post_init__(self) -> None:
        check_thresholds(self.floor, self.ceiling)


def check_thresholds(floor: float, ceiling: float) -> None:
    """Bornes des seuils, verifiees ici seulement.

    Les modeles de charge et de plan l'appellent pour refuser des seuils incoherents
    a la validation plutot qu'en plein run.
    """
    if not 0 <= floor <= ceiling <= _MAX_SCORE:
        raise ValueError(f"inconsistent thresholds: floor={floor} ceiling={ceiling}")


DEFAULT_THRESHOLDS: Final = MatchingThresholds()


@dataclass(frozen=True, slots=True, kw_only=True)
class ScoredCandidate:
    """Scores d'un candidat, gardes pour le rapport et le recalibrage des seuils.

    `artist_score` vaut `None` sans artiste dans la requete. Les deux `_mismatch` nomment la
    cause pour le rapport ; la classification lit `blocks_auto`, qu'une troisieme cause
    n'oblige pas a rouvrir.
    """

    candidate: TrackCandidate
    artist_score: float | None
    title_score: float
    score: float
    version_mismatch: bool
    number_mismatch: bool

    @property
    def blocks_auto(self) -> bool:
        """Seul l'utilisateur tranche entre deux versions d'un meme morceau, ou entre deux
        morceaux que seul un nombre distingue. Le candidat reste en lice, sans son score."""
        return self.version_mismatch or self.number_mismatch


class _Parts(NamedTuple):
    """Titre nu et mention de version, la forme sous laquelle les deux cotes se comparent."""

    title: str
    version: str


@dataclass(frozen=True, slots=True, kw_only=True)
class _AskedFor:
    """Ce qu'un morceau demande, derive une fois puis compare a chaque candidat."""

    title: str
    version: str
    artists: tuple[str, ...]
    numbers: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class Auto:
    """Candidat valide d'office ; `scored` garde tous les candidats notes pour le rapport."""

    chosen: ScoredCandidate
    scored: tuple[ScoredCandidate, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class GreyZone:
    """Candidats en jeu pour l'utilisateur, meilleur score en tete."""

    candidates: tuple[ScoredCandidate, ...]
    scored: tuple[ScoredCandidate, ...]


@dataclass(frozen=True, slots=True)
class Empty:
    """Aucun candidat en jeu ; `had_candidates` distingue `below_threshold` de `no_result`."""

    scored: tuple[ScoredCandidate, ...]
    had_candidates: bool


type Classification = Auto | GreyZone | Empty


def build_query(artist: str, title: str, file_name: str) -> TrackQuery | None:
    """Requete du morceau, ou `None` quand rien n'est exploitable (`empty_query`)."""
    return _from_tags(artist, title) or _from_file_name(file_name)


def _from_tags(artist: str, title: str) -> TrackQuery | None:
    # Un titre que le nettoyage vide reprend sa valeur brute, une requete bruitee
    # valant mieux qu'une requete vide.
    query_artist = _normalise_artists(artist)
    query_title = _clean(title, keep_parentheses=True) or title.strip()
    if not (_LETTER.search(query_artist) and _LETTER.search(query_title)):
        return None
    return TrackQuery(artist=query_artist, title=query_title, origin=QueryOrigin.TAGS)


def _from_file_name(file_name: str) -> TrackQuery | None:
    stem = PurePath(file_name).stem
    if " " not in stem:
        stem = stem.replace("_", " ")
    cleaned = _clean(_TRACK_NUMBER.sub("", stem, count=1), keep_parentheses=True)
    if not _LETTER.search(cleaned):
        return None
    artist, separator, title = cleaned.partition(_FILE_NAME_SEPARATOR)
    if not separator:
        return TrackQuery(artist="", title=cleaned, origin=QueryOrigin.FILENAME)
    return TrackQuery(
        artist=_normalise_artists(artist), title=title.strip(), origin=QueryOrigin.FILENAME
    )


def _clean(text: str, *, keep_parentheses: bool = False) -> str:
    """Retire le bruit d'une chaine interrogee ou comparee, jamais des tags ecrits.

    `keep_parentheses` : une parenthese porte une version, un crochet un label ou un genre.
    """
    text = _DOWNLOAD.sub(" ", text)
    text = _ENCODING.sub(" ", text)
    keep = _keep_parenthesized_group if keep_parentheses else _keep_guarded_group
    text = _GROUP.sub(keep, text)
    return _SPACES.sub(" ", _EMPTY_GROUP.sub(" ", text)).strip(_EDGE_NOISE)


def _keep_guarded_group(match: re.Match[str]) -> str:
    return match.group(0) if _GUARD.search(match.group("content")) else " "


def _keep_parenthesized_group(match: re.Match[str]) -> str:
    return match.group(0) if match.group(0).startswith("(") else _keep_guarded_group(match)


def _normalise_artists(artist: str) -> str:
    """Separateurs ramenes a la virgule, crochets retires, parentheses conservees."""
    cleaned = _ENCODING.sub(" ", _DOWNLOAD.sub(" ", _ARTIST_NOISE.sub(" ", artist)))
    cleaned = _EMPTY_GROUP.sub(" ", cleaned)
    parts = (part.strip() for part in _ARTIST_SEPARATORS.sub(",", cleaned).split(","))
    return ", ".join(part for part in parts if part)


def rank(
    query: TrackQuery,
    candidates: Sequence[TrackCandidate],
    thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
) -> GreyZone | Empty:
    """Tri stable : a score egal, l'ordre de l'API departage.

    Jamais d'auto, ce dont le pipeline se sert quand Beatport n'a pas repondu.
    """
    asked = _prepare(query)
    every = tuple(
        entry
        for candidate in candidates
        if (entry := _score_candidate(asked, candidate)) is not None
    )
    in_play = sorted(
        (entry for entry in every if _above_floor(entry, thresholds.floor)),
        key=lambda entry: entry.score,
        reverse=True,
    )
    if not in_play:
        # Le garde-fou remix compte : la source a repondu, rien n'a passe.
        return Empty(every, had_candidates=bool(candidates))
    return GreyZone(candidates=tuple(in_play), scored=every)


def classify(
    query: TrackQuery,
    candidates: Sequence[TrackCandidate],
    thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
) -> Classification:
    """`rank`, dont le premier candidat sans ecart au-dessus du seuil haut est valide d'office."""
    ranked = rank(query, candidates, thresholds)
    if isinstance(ranked, Empty):
        return ranked
    automatic = next(
        (
            entry
            for entry in ranked.candidates
            if not entry.blocks_auto and entry.score >= thresholds.ceiling
        ),
        None,
    )
    return ranked if automatic is None else Auto(automatic, ranked.scored)


def _score_candidate(asked: _AskedFor, candidate: TrackCandidate) -> ScoredCandidate | None:
    """`None` quand le garde-fou remix ecarte le candidat."""
    # Candidat deja normalise par techno-scraper : un groupe que son titre garde (« PATT
    # (Party All The Time) ») est un sous-titre, retire des deux cotes. Sans quoi la
    # requete le prendrait pour une version et bloquerait un morceau identique.
    title, subtitle = _split_version(_clean(candidate.title, keep_parentheses=True))
    offered = _Parts(title, candidate.mix_name or "")
    if not _passes_remix_guard(_Parts(asked.title, asked.version), offered):
        return None
    version = _without_subtitle(asked.version, subtitle)
    return _score(replace(asked, version=version), candidate, offered)


def _prepare(query: TrackQuery) -> _AskedFor:
    """Titre nu, version et invite se separent ici, sur le tag local que techno-scraper ne
    voit jamais : le candidat arrive deja sous cette forme.
    """
    bare, version = _split_version(_clean(query.title, keep_parentheses=True))
    title = _SPACES.sub(" ", _FEATURING.sub(" ", bare)).strip(_EDGE_NOISE + "([")
    artists = tuple(part.strip() for part in query.artist.split(",") if part.strip())
    return _AskedFor(title=title, version=version, artists=artists, numbers=_numbers(title))


def _split_version(title: str) -> _Parts:
    """Detache la version du titre, sans toucher aux groupes de collaboration.

    « (feat. X) » n'est pas une version et reste dans le titre.
    """
    taken: list[str] = []

    def take(match: re.Match[str]) -> str:
        content = match.group("content")
        if _VERSION_GUARD.search(content) is None:
            if _COLLABORATION_GUARD.search(content):
                return match.group(0)
            # « (CY's Cosmic Jorney) » : perdue, la version laisserait l'original valider seul.
            taken.append(content.strip())
            return " "
        # Un groupe qui nomme aussi un invite reste une version : « (Extended Mix feat. X) »
        # cede sa mention d'invite, « (A vs B Remix) » garde la sienne (le credit de remix est
        # le libelle de la version). Le laisser dans le titre perdrait la version et y collerait
        # une parenthese jamais fermee.
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
    """Titre et version se comparent separement, jamais concatenes."""
    title_score = fuzz.ratio(asked.title, offered.title, processor=utils.default_process)
    mismatch = not _versions_agree(asked.version, offered.version)
    renumbered = asked.numbers != _numbers(offered.title)
    artist_score = _artist_score(asked.artists, candidate) if asked.artists else None
    score = title_score if artist_score is None else (artist_score + title_score) / 2
    return ScoredCandidate(
        candidate=candidate,
        artist_score=artist_score,
        title_score=title_score,
        score=score,
        version_mismatch=mismatch,
        number_mismatch=renumbered,
    )


def _numbers(title: str) -> tuple[int, ...]:
    """Nombres du titre nu, en valeur : « 01 » et « 1 » designent la meme partie."""
    return tuple(int(number) for number in _NUMBER.findall(title))


def _versions_agree(asked: str, offered: str) -> bool:
    """« Original Mix » vaut absence de version, un tag l'omettant presque toujours : une
    requete muette s'accorde donc avec un original, jamais avec un Extended.
    """
    left, right = _normalise_version(asked), _normalise_version(offered)
    if not left or not right:
        return not left and not right
    return fuzz.ratio(left, right, processor=utils.default_process) >= _VERSION_MATCH_FLOOR


def _without_subtitle(version: str, subtitle: str) -> str:
    return re.sub(re.escape(subtitle), " ", version, flags=re.IGNORECASE) if subtitle else version


def _normalise_version(version: str) -> str:
    stripped = _SPACES.sub(" ", version).strip()
    return "" if stripped.casefold() in _ORIGINALS else stripped


def _artist_score(asked: tuple[str, ...], candidate: TrackCandidate) -> float:
    """Chaque artiste demande doit se retrouver parmi les credits du candidat.

    Le minimum et non la moyenne : un artiste absent est un desaccord que la presence
    des autres ne rachete pas. Les credits arrivent decoupes par techno-scraper et se
    comparent tels quels.
    """
    credits = [credit.name for credit in candidate.artists]
    if not credits:
        return 0.0
    return max(_credits_score(asked, credits), _credits_score(_split_duos(asked), credits))


def _split_duos(asked: tuple[str, ...]) -> tuple[str, ...]:
    """Seconde lecture d'une esperluette : celle qui separe deux artistes.

    « A & B » nomme un duo (« Pig & Dan ») ou deux artistes joints par un logiciel, ce que
    la chaine seule ne dit pas : les deux lectures sont scorees, la meilleure gagne, la
    facon dont la source credite tranchant, jamais une regle devinee.
    """
    return tuple(part.strip() for name in asked for part in _AMPERSAND.split(name) if part.strip())


def _credits_score(asked: tuple[str, ...], credits: list[str]) -> float:
    return min(_best_credit(name, credits) for name in asked)


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
    """Titre tel que l'ADR-011 l'ecrit : titre et mix, que techno-scraper rend separes.

    Distinct de la forme comparee par le scoring (`classify`) : afficher et scorer ne
    demandent pas la meme chaine.
    """
    if not candidate.mix_name:
        return candidate.title
    return f"{candidate.title} ({candidate.mix_name})"


def credited_artists(candidate: TrackCandidate) -> str:
    """Artistes joints comme dans la CLI, remixeurs exclus : ils vivent dans le mix."""
    return ", ".join(credit.name for credit in candidate.artists)
