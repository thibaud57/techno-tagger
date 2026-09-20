# Construction de la requête et classement des candidats : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire la requête d'un morceau puis classer les candidats d'une source en auto, zone grise ou vide selon les seuils de matching.

**Architecture:** Deux fonctions pures dans `tagger/matching.py`, sans IO. `build_query` part des tags, se replie sur le nom de fichier, nettoie la chaîne sous une garde de version et de collaboration, et normalise les séparateurs d'artistes. `classify` score chaque candidat (règles de la CLI d'origine, plus le titre nu pour une requête sans version) et rend l'issue avec les candidats retenus et tous les scores.

**Tech Stack:** Python 3.14 (`re`, `dataclasses`, `enum`, `pathlib.PurePath`), rapidfuzz 3.14, pytest, Mypy strict, Ruff. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/03-requete-et-scoring-design.md`

## Global Constraints

- **Dépend du sub-project 02** : `tagger.scraper_client.TrackCandidate`, `Credit`, `Source` existent (`TrackCandidate(title, mix_name, artists: tuple[Credit, ...], remixers, ..., source)`).
- **`processor=utils.default_process` sur chaque appel rapidfuzz**, sans exception.
- **Artiste** : `token_sort_ratio` si l'artiste de la requête contient `,` ou `&`, `ratio` sinon. **Titre** : `ratio`.
- **Seuils par défaut** : `floor=70`, `ceiling=90`, invariant `0 <= floor <= ceiling <= 100`. Plancher en ET, score = moyenne, auto à `>= ceiling`.
- **Garde** (mots entiers, casse ignorée) : `mix`, `remix`, `edit`, `version`, `dub`, `extended`, `radio`, `rework`, `bootleg`, `vip`, `live`, `instrumental`, `acapella`, `reprise`, `re-edit`, `remaster`, `feat.`, `ft.`, `featuring`, `with`, `pres.`, `vs.`.
- **Motifs retirés** : `free dl` / `free download` (espace, `-` ou `_` entre les deux), `NNNkbps` (2 ou 3 chiffres), `320`, `flac`, `wav`, `mp3`, et tout groupe `[...]` ou `(...)` sans mot de garde.
- **Séparateurs d'artistes** vers `", "` : `;`, `/`, et entourés d'espaces `&`, `and`, `x`, `X`, `×`, `vs`, `vs.`, `feat.`, `ft.`, `featuring`.
- **Nom de fichier** : `_` vers espace si aucun espace, numéro de piste de 1 ou 2 chiffres en tête retiré, découpe sur le premier `" - "`.
- **Modèles internes** : dataclasses `frozen=True, slots=True`, `StrEnum` avec `@verify(UNIQUE)`, motifs compilés au niveau du module en raw strings.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, pas de fixture, seuils de score testés par des bornes (100, sous le plancher, seuil à 100) et jamais par une valeur flottante exacte.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scope `matching`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/matching.py` | Motifs, nettoyage, `build_query`, seuils, scoring, `classify`. |
| `sidecar/tests/unit/test_matching_query.py` | Nettoyage, gardes, séparateurs, repli, `empty_query`. |
| `sidecar/tests/unit/test_matching_scoring.py` | Chaînes comparées, scorers, garde remix, seuils, classement. |
| `docs/ARCHITECTURE.md` | § Use-case 2 : garde étendue, liste de départ des motifs renvoyée au spec 03. |

---

## Task 1: Construction de la requête

**Files:**
- Modify: `sidecar/src/tagger/matching.py` (remplace le placeholder)
- Modify: `docs/ARCHITECTURE.md` (§ Use-case 2)
- Test: `sidecar/tests/unit/test_matching_query.py`

**Interfaces:**
- Produces:
  - `QueryOrigin(StrEnum)` : `TAGS = "tags"`, `FILENAME = "filename"`
  - `TrackQuery(artist: str, title: str, origin: QueryOrigin)`, propriété `text -> str`
  - `build_query(artist: str, title: str, file_name: str) -> TrackQuery | None` (`None` = `empty_query`)

- [ ] **Step 1: Écrire les tests de requête**

Créer `sidecar/tests/unit/test_matching_query.py` :

```python
"""Tests de la construction de la requete : nettoyage, gardes, repli."""

import pytest

from tagger.matching import QueryOrigin, TrackQuery, build_query

GUARD_WORDS = [
    "mix", "remix", "edit", "version", "dub", "extended", "radio", "rework", "bootleg",
    "vip", "live", "instrumental", "acapella", "reprise", "re-edit", "remaster",
]
COLLABORATION_WORDS = ["feat.", "ft.", "featuring", "with", "pres.", "vs."]


def _title(title: str) -> str:
    query = build_query("Adam Beyer", title, "track.mp3")
    assert query is not None
    return query.title


def _artist(artist: str) -> str:
    query = build_query(artist, "Your Mind", "track.mp3")
    assert query is not None
    return query.artist


def test_builds_the_query_from_clean_tags() -> None:
    query = build_query("Adam Beyer", "Your Mind", "track.mp3")

    assert query == TrackQuery(artist="Adam Beyer", title="Your Mind", origin=QueryOrigin.TAGS)
    assert query.text == "Adam Beyer Your Mind"


@pytest.mark.parametrize(
    "title",
    ["Your Mind [FREE DL]", "Your Mind (Free Download)", "Your Mind free_dl"],
    ids=["brackets", "parentheses", "bare"],
)
def test_removes_download_mentions_whatever_their_delimiter(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Your Mind"


@pytest.mark.parametrize(
    "title",
    ["Your Mind (320kbps)", "Your Mind 320", "Your Mind FLAC", "Your Mind [wav]", "Your Mind mp3"],
    ids=["kbps", "bitrate", "flac", "wav", "mp3"],
)
def test_removes_encoding_markers_as_whole_words(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Your Mind"


@pytest.mark.parametrize(
    "title", ["Your Mind [Drumcode]", "Your Mind [HARD TECHNO]"], ids=["label", "genre"]
)
def test_removes_a_free_group_such_as_a_label_or_a_genre(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Your Mind"


@pytest.mark.parametrize("word", GUARD_WORDS)
def test_keeps_a_group_holding_a_version_mention(word: str) -> None:
    title = f"Your Mind (Special {word}) [FREE DL]"

    cleaned = _title(title)

    assert cleaned == f"Your Mind (Special {word})"


@pytest.mark.parametrize("word", COLLABORATION_WORDS)
def test_keeps_a_group_holding_a_collaboration_mention(word: str) -> None:
    title = f"Your Mind ({word} Roisin Murphy) [Drumcode]"

    cleaned = _title(title)

    assert cleaned == f"Your Mind ({word} Roisin Murphy)"


@pytest.mark.parametrize(
    ("artist", "expected"),
    [
        ("Farrago x Amelie Lens", "Farrago, Amelie Lens"),
        ("Adam Beyer X Bart Skils", "Adam Beyer, Bart Skils"),
        ("Amelie Lens × Farrago", "Amelie Lens, Farrago"),
        ("Adam Beyer;Bart Skils", "Adam Beyer, Bart Skils"),
        ("Adam Beyer / Bart Skils", "Adam Beyer, Bart Skils"),
        ("Chase & Status", "Chase, Status"),
        ("Chase and Status", "Chase, Status"),
        ("Adam Beyer vs. Bart Skils", "Adam Beyer, Bart Skils"),
        ("Adam Beyer feat. Roisin Murphy", "Adam Beyer, Roisin Murphy"),
        ("Adam Beyer ft. Roisin Murphy", "Adam Beyer, Roisin Murphy"),
        ("Adam Beyer featuring Roisin Murphy", "Adam Beyer, Roisin Murphy"),
    ],
    ids=["x", "upper-x", "times", "semicolon", "slash", "ampersand", "and", "vs", "feat",
         "ft", "featuring"],
)
def test_normalises_artist_separators_to_a_comma(artist: str, expected: str) -> None:
    normalised = _artist(artist)

    assert normalised == expected


@pytest.mark.parametrize("artist", ["Jay-Z", "Jax Jones", "Axwell"])
def test_never_splits_a_name_without_spaced_separator(artist: str) -> None:
    normalised = _artist(artist)

    assert normalised == artist


def test_falls_back_on_the_raw_tag_when_cleaning_empties_it() -> None:
    query = build_query("Adam Beyer", "[FREE DL]", "track.mp3")

    assert query == TrackQuery(artist="Adam Beyer", title="[FREE DL]", origin=QueryOrigin.TAGS)


def test_falls_back_on_the_file_name_when_a_tag_has_no_letter() -> None:
    query = build_query("", "Your Mind", "adam beyer - your mind.mp3")

    assert query == TrackQuery(
        artist="adam beyer", title="your mind", origin=QueryOrigin.FILENAME
    )


def test_replaces_underscores_in_a_file_name_without_spaces() -> None:
    query = build_query("", "", "adam_beyer_-_your_mind.mp3")

    assert query is not None
    assert (query.artist, query.title) == ("adam beyer", "your mind")


def test_strips_a_leading_track_number_and_the_noise_of_a_file_name() -> None:
    query = build_query("", "", "05 reinier zonneveld - move your body (320kbps).mp3")

    assert query is not None
    assert (query.artist, query.title) == ("reinier zonneveld", "move your body")


@pytest.mark.parametrize(
    ("file_name", "artist"),
    [("999999999 - Title.mp3", "999999999"), ("808 State - Pacific.mp3", "808 State")],
    ids=["nine-digits", "three-digits"],
)
def test_keeps_a_numeric_artist_that_is_not_a_track_number(file_name: str, artist: str) -> None:
    query = build_query("", "", file_name)

    assert query is not None
    assert query.artist == artist


def test_splits_the_file_name_on_the_first_spaced_dash() -> None:
    query = build_query("", "", "Jay-Z - Title.flac")

    assert query is not None
    assert (query.artist, query.title) == ("Jay-Z", "Title")


def test_puts_the_whole_file_name_in_the_title_without_a_spaced_dash() -> None:
    query = build_query("", "", "10-sama-rise.mp3")

    assert query == TrackQuery(artist="", title="sama-rise", origin=QueryOrigin.FILENAME)


@pytest.mark.parametrize(
    "file_name", ["01 - [FREE DL].mp3", "320kbps.mp3"], ids=["free-dl", "bitrate"]
)
def test_returns_no_query_for_a_file_name_reduced_to_noise(file_name: str) -> None:
    query = build_query("", "", file_name)

    assert query is None
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_matching_query.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'QueryOrigin' from 'tagger.matching'`

- [ ] **Step 3: Implémenter la construction de la requête**

Remplacer tout le contenu de `sidecar/src/tagger/matching.py` :

```python
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
from typing import Final

# Un groupe qui contient l'un de ces mots identifie le morceau et n'est jamais retire.
_GUARD: Final = re.compile(
    r"(?<![\w-])(?:re-edit|remix|mix|edit|version|dub|extended|radio|rework|bootleg|vip"
    r"|live|instrumental|acapella|reprise|remaster|feat\.?|ft\.?|featuring|with|pres\.?"
    r"|vs\.?)(?![\w-])",
    re.IGNORECASE,
)
_DOWNLOAD: Final = re.compile(r"\bfree[\s_-]*(?:dl|download)\b", re.IGNORECASE)
_ENCODING: Final = re.compile(r"\b(?:\d{2,3}\s*kbps|320|flac|wav|mp3)\b", re.IGNORECASE)
_GROUP: Final = re.compile(r"[\[(]([^\[\]()]*)[\])]")
_SPACES: Final = re.compile(r"\s+")
# Formes entourees d'espaces seulement, sauf ; et / : « Jay-Z » et « Jax Jones »
# ne doivent jamais etre coupes.
_ARTIST_SEPARATORS: Final = re.compile(
    r"\s*[;/]\s*|\s+(?:&|and|x|×|vs\.?|feat\.?|ft\.?|featuring)\s+", re.IGNORECASE
)
_LETTER: Final = re.compile(r"[^\W\d_]")
# Deux chiffres au plus : « 808 State » et « 999999999 » restent des artistes.
_TRACK_NUMBER: Final = re.compile(r"^\d{1,2}(?!\d)\s*[-._)]?\s*")
_FILE_NAME_SEPARATOR: Final = " - "
_EDGE_NOISE: Final = " -_.,;"


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
    return match.group(0) if _GUARD.search(match.group(1)) else " "


def _normalise_artists(artist: str) -> str:
    parts = (part.strip() for part in _ARTIST_SEPARATORS.sub(",", artist).split(","))
    return ", ".join(part for part in parts if part)
```

`auto()` d'un `StrEnum` rend le nom en minuscules : `QueryOrigin.TAGS == "tags"`.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_matching_query.py -x -q`
Expected: PASS, 57 tests (paramétrages compris)

- [ ] **Step 5: Mettre ARCHITECTURE.md à jour**

Dans `docs/ARCHITECTURE.md` § Use-case 2, dans le paragraphe **Nettoyage de la requête**, remplacer la phrase « La liste des motifs (mentions de téléchargement, marqueurs d'encodage, numéros de piste, noms de labels) relève de la spec de la feature et se règlera au premier run réel. » par :

```markdown
La liste de départ des motifs (mentions de téléchargement, marqueurs d'encodage, numéro de piste en tête du nom de fichier, groupes entre crochets ou parenthèses sans mention de version ni de collaboration, qui couvrent les labels) est fixée dans le spec du sub-project 03 de la Feature 2, le 2026-09-19, et s'ajustera au premier run réel.
```

Dans la note **Garde absolue** qui suit, remplacer `(\`mix\`, \`remix\`, \`edit\`, \`version\`, \`dub\`, \`extended\`, \`radio\`)` par :

```markdown
(`mix`, `remix`, `edit`, `version`, `dub`, `extended`, `radio`, étendue le 2026-09-19 à `rework`, `bootleg`, `vip`, `live`, `instrumental`, `acapella`, `reprise`, `re-edit`, `remaster` : les groupes sans mention étant retirés, une version absente de cette liste disparaîtrait de la requête)
```

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/matching.py sidecar/tests/unit/test_matching_query.py docs/ARCHITECTURE.md
git commit -m "feat(matching): construire et nettoyer la requete d'un morceau"
```

---

## Task 2: Scoring et classement des candidats

**Files:**
- Modify: `sidecar/src/tagger/matching.py`
- Test: `sidecar/tests/unit/test_matching_scoring.py`

**Interfaces:**
- Consumes: `TrackQuery`, `QueryOrigin` (Task 1) ; `TrackCandidate`, `Credit`, `Source` (sub-project 02)
- Produces:
  - `MatchingThresholds(floor: float = 70, ceiling: float = 90)`, `DEFAULT_THRESHOLDS: Final`
  - `ScoredCandidate(candidate: TrackCandidate, artist_score: float | None, title_score: float, score: float, via_bare_title: bool)`
  - `Outcome(StrEnum)` : `AUTO = "auto"`, `GREY_ZONE = "grey_zone"`, `EMPTY = "empty"`
  - `Classification(outcome: Outcome, retained: tuple[ScoredCandidate, ...], scored: tuple[ScoredCandidate, ...])`
  - `classify(query: TrackQuery, candidates: Sequence[TrackCandidate], thresholds: MatchingThresholds = DEFAULT_THRESHOLDS, *, allow_auto: bool = True) -> Classification`

- [ ] **Step 1: Écrire les tests de classement**

Créer `sidecar/tests/unit/test_matching_scoring.py` :

```python
"""Tests du scoring et du classement des candidats."""

import pytest

from tagger.matching import (
    MatchingThresholds,
    Outcome,
    QueryOrigin,
    TrackQuery,
    classify,
)
from tagger.scraper_client import Credit, Source, TrackCandidate

YOUR_MIND = TrackQuery(artist="Adam Beyer", title="Your Mind", origin=QueryOrigin.TAGS)


def _candidate(
    title: str,
    mix_name: str | None = "Original Mix",
    artists: tuple[str, ...] = ("Adam Beyer",),
    *,
    remixers: tuple[str, ...] = (),
    track_id: str = "1",
) -> TrackCandidate:
    return TrackCandidate(
        id=track_id,
        title=title,
        mix_name=mix_name,
        artists=tuple(Credit(name=name) for name in artists),
        remixers=tuple(Credit(name=name) for name in remixers),
        source=Source.BEATPORT,
    )


def test_compares_the_candidate_title_with_its_mix_name() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind (Extended Mix)", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind", "Extended Mix")])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].title_score == 100


def test_does_not_repeat_a_mix_name_already_in_the_title() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind (Extended Mix)", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind (Extended Mix)", "Extended Mix")])

    assert classification.retained[0].title_score == 100


def test_adds_original_mix_to_a_query_title_without_version() -> None:
    classification = classify(YOUR_MIND, [_candidate("Your Mind", "Original Mix")])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].via_bare_title is False


def test_keeps_a_candidate_matched_on_its_bare_title_in_the_grey_zone() -> None:
    candidates = [_candidate("Your Mind", "Extended Mix"), _candidate("Your Mind", "Radio Edit")]

    classification = classify(YOUR_MIND, candidates)

    assert classification.outcome is Outcome.GREY_ZONE
    assert all(scored.via_bare_title for scored in classification.retained)
    assert all(scored.score == 100 for scored in classification.retained)


def test_validates_the_original_mix_automatically_when_an_extended_is_also_offered() -> None:
    extended = _candidate("Your Mind", "Extended Mix", track_id="extended")
    original = _candidate("Your Mind", "Original Mix", track_id="original")

    classification = classify(YOUR_MIND, [extended, original])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].candidate.id == "original"


def test_compares_a_candidate_without_mix_name_to_the_query_title_without_suffix() -> None:
    bandcamp = _candidate("Your Mind", mix_name=None)

    classification = classify(YOUR_MIND, [bandcamp])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].via_bare_title is False


def test_never_validates_automatically_when_auto_is_not_allowed() -> None:
    classification = classify(YOUR_MIND, [_candidate("Your Mind")], allow_auto=False)

    assert classification.outcome is Outcome.GREY_ZONE
    assert classification.retained[0].score == 100


def test_joins_candidate_artists_without_remixers() -> None:
    candidate = _candidate("Your Mind", "Original Mix", remixers=("Bart Skils",))

    classification = classify(YOUR_MIND, [candidate])

    assert classification.retained[0].artist_score == 100


def test_uses_token_sort_ratio_for_several_artists() -> None:
    query = TrackQuery("Adam Beyer, Bart Skils", "Your Mind", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind", artists=("Bart Skils", "Adam Beyer"))])

    assert classification.scored[0].artist_score == 100


def test_uses_ratio_for_a_single_artist() -> None:
    query = TrackQuery("Beyer Adam", "Your Mind", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind")])

    artist_score = classification.scored[0].artist_score
    assert artist_score is not None
    assert artist_score < 100


def test_drops_a_candidate_without_remix_when_the_query_holds_one() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind (Bart Skils Remix)", QueryOrigin.TAGS)
    original = _candidate("Your Mind", "Original Mix", track_id="original")
    remix = _candidate("Your Mind", "Bart Skils Remix", track_id="remix")

    classification = classify(query, [original, remix])

    assert [scored.candidate.id for scored in classification.scored] == ["remix"]
    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    "candidate",
    [
        _candidate("Totally Different"),
        _candidate("Your Mind", artists=("Adam Port",)),
    ],
    ids=["title-below-floor", "artist-below-floor"],
)
def test_rejects_a_candidate_below_the_floor_on_either_score(candidate: TrackCandidate) -> None:
    classification = classify(YOUR_MIND, [candidate])

    assert classification.outcome is Outcome.EMPTY
    assert classification.retained == ()


def test_validates_automatically_at_the_ceiling() -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)

    classification = classify(YOUR_MIND, [_candidate("Your Mind")], thresholds)

    assert classification.outcome is Outcome.AUTO


def test_does_not_validate_automatically_below_the_ceiling() -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)

    classification = classify(YOUR_MIND, [_candidate("Your Mind Tonight")], thresholds)

    assert classification.outcome is Outcome.GREY_ZONE


def test_returns_grey_zone_candidates_sorted_by_score() -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)
    tonight = _candidate("Your Mind Tonight", track_id="tonight")
    mindset = _candidate("Your Mindset", track_id="mindset")

    classification = classify(YOUR_MIND, [tonight, mindset], thresholds)

    assert [scored.candidate.id for scored in classification.retained] == ["mindset", "tonight"]


def test_keeps_the_first_candidate_on_a_tie() -> None:
    first = _candidate("Your Mind", track_id="first")
    second = _candidate("Your Mind", track_id="second")

    classification = classify(YOUR_MIND, [first, second])

    assert classification.retained[0].candidate.id == "first"


def test_scores_the_title_only_for_a_query_without_artist() -> None:
    query = TrackQuery("", "Your Mind", QueryOrigin.FILENAME)

    classification = classify(query, [_candidate("Your Mind", artists=("Someone Else",))])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].artist_score is None


def test_records_every_scored_candidate() -> None:
    candidates = [
        _candidate("Your Mind", track_id="match"),
        _candidate("Totally Different", track_id="other-title"),
        _candidate("Your Mind", artists=("Adam Port",), track_id="other-artist"),
    ]

    classification = classify(YOUR_MIND, candidates)

    assert [scored.candidate.id for scored in classification.scored] == [
        "match",
        "other-title",
        "other-artist",
    ]


@pytest.mark.parametrize(
    ("floor", "ceiling"), [(95, 90), (-1, 90), (70, 101)], ids=["inverted", "negative", "over"]
)
def test_rejects_inconsistent_thresholds(floor: float, ceiling: float) -> None:
    with pytest.raises(ValueError, match="inconsistent thresholds"):
        MatchingThresholds(floor=floor, ceiling=ceiling)
```

Scores mesurés avec rapidfuzz 3.14, `default_process`, le 2026-09-19 : « Your Mind (Original Mix) » contre « Your Mind Tonight (Original Mix) » 85,2, contre « Your Mindset (Original Mix) » 93,9, contre « Totally Different (Original Mix) » 66,7 ; « Adam Beyer » contre « Adam Port » 63,2. Les tests n'en dépendent que par leur ordre et par le plancher.

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_matching_scoring.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'MatchingThresholds' from 'tagger.matching'`

- [ ] **Step 3: Implémenter le scoring et le classement**

Dans `sidecar/src/tagger/matching.py`, compléter les imports :

```python
import re
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from pathlib import PurePath
from typing import TYPE_CHECKING, Final

from rapidfuzz import fuzz, utils

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from tagger.scraper_client import TrackCandidate
```

Ajouter après `_EDGE_NOISE` :

```python
_ORIGINAL_MIX: Final = "Original Mix"
_REMIX: Final = "remix"
```

Ajouter après `TrackQuery` :

```python
@dataclass(frozen=True, slots=True)
class MatchingThresholds:
    """Plancher en ET sur les deux scores, seuil haut sur leur moyenne.

    Defauts herites de la CLI, a recalibrer aux premiers runs reels (ADR-008).
    """

    floor: float = 70
    ceiling: float = 90

    def __post_init__(self) -> None:
        if not 0 <= self.floor <= self.ceiling <= 100:
            raise ValueError(
                f"inconsistent thresholds: floor={self.floor} ceiling={self.ceiling}"
            )


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
```

Ajouter à la fin du fichier :

```python
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
    automatic = next(
        (
            entry
            for entry in in_play
            if allow_auto and not entry.via_bare_title and entry.score >= thresholds.ceiling
        ),
        None,
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
        bare = (
            fuzz.ratio(query.title, candidate.title, processor=utils.default_process)
            if _lacks_version(query.title)
            else 0.0
        )
    else:
        # Bandcamp ne rend jamais de mix_name : la version, s'il y en a une, est deja
        # dans le titre. Le suffixe « (Original Mix) » l'eloignerait a tort.
        full = fuzz.ratio(query.title, candidate.title, processor=utils.default_process)
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


def _above_floor(entry: ScoredCandidate, floor: float) -> bool:
    artist_ok = entry.artist_score is None or entry.artist_score >= floor
    return artist_ok and entry.title_score >= floor


def _passes_remix_guard(query_title: str, candidate: TrackCandidate) -> bool:
    """Regle de la CLI : un remix demande n'est jamais satisfait par un original."""
    if _REMIX not in query_title.casefold():
        return True
    return _REMIX in _candidate_title(candidate).casefold()


def _lacks_version(title: str) -> bool:
    return _REMIX not in title.casefold() and "(" not in title and ")" not in title


def _query_title(title: str) -> str:
    return f"{title} ({_ORIGINAL_MIX})" if _lacks_version(title) else title


def _candidate_title(candidate: TrackCandidate) -> str:
    mix_name = candidate.mix_name
    if not mix_name or mix_name in candidate.title:
        return candidate.title
    return f"{candidate.title} ({mix_name})"


def _candidate_artists(candidate: TrackCandidate) -> str:
    """Artistes joints comme dans la CLI, remixeurs exclus : ils vivent dans le mix."""
    return ", ".join(credit.name for credit in candidate.artists)


def _artist_scorer(artist: str) -> Callable[..., float]:
    return fuzz.token_sort_ratio if ("," in artist or "&" in artist) else fuzz.ratio
```

`sorted(..., reverse=True)` reste stable : deux candidats de même score gardent l'ordre de l'API.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_matching_scoring.py tests/unit/test_matching_query.py -x -q`
Expected: PASS, 79 tests (22 de classement, paramétrages compris, plus les 57 de la Task 1)

- [ ] **Step 5: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/matching.py sidecar/tests/unit/test_matching_scoring.py
git commit -m "feat(matching): scorer et classer les candidats d'une source"
```
