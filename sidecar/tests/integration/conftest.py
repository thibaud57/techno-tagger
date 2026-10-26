from functools import partial
from typing import TYPE_CHECKING

import pytest
from cdn_doubles import FakeCdn
from ndjson_loop import extraction_command
from scraper_responses import BASIEL, BEATPORT_SEARCH
from tagging_api import FakeApi, knows_your_mind, one_track, transports, two_tracks

from tagger import handlers
from tagger.core.file_failures import FileFailureReason
from tagger.run import writing
from tagger.tags import files
from tagger.tags.files import TagsWriteError

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from tagging_api import Gate


@pytest.fixture(autouse=True)
def app_data(app_data: None) -> None:
    """Dossier de donnees isole pour tout test d'integration : la boucle y ecrit plans,
    dumps, logs et cache sans jamais toucher ceux de la machine.
    """


@pytest.fixture
def cdn() -> FakeCdn:
    """CDN de pochettes simule, que `api` branche sur la boucle."""
    return FakeCdn()


@pytest.fixture(autouse=True)
def api(monkeypatch: pytest.MonkeyPatch, cdn: FakeCdn) -> FakeApi:
    """API/CDN simules, poses pour tout test : un test qui l'oublierait toucherait le vrai
    reseau."""
    fake = FakeApi()
    monkeypatch.setattr(handlers, "tagging_transports", partial(transports, fake, cdn))
    return fake


@pytest.fixture
def folder(tmp_path: Path, api: FakeApi) -> Path:
    """« Your Mind » que Beatport resout d'office : le run finit avec un morceau a ecrire."""
    knows_your_mind(api)
    return one_track(tmp_path)


@pytest.fixture
def unresolved_folder(tmp_path: Path) -> Path:
    """Un morceau qu'aucune route de l'API ne resout : sans reponse enregistree, il finit
    `unresolved`, ou en zone grise si le test pose ses propres routes.
    """
    return one_track(tmp_path)


@pytest.fixture
def two_tracks_folder(tmp_path: Path) -> Path:
    """« Your Mind » en `FIRST_TRACK`, « Basiel » en `SECOND_TRACK`, sans reponse enregistree."""
    return two_tracks(tmp_path)


@pytest.fixture
def basiel_gate(api: FakeApi) -> Gate:
    """Retient la recherche de « Basiel » : le run attend apres le premier morceau."""
    return api.gate(BEATPORT_SEARCH, BASIEL)


@pytest.fixture
def empty_folder(tmp_path: Path) -> Path:
    """Dossier sans morceau : le run qui le vise se termine aussitot."""
    folder = tmp_path / "empty"
    folder.mkdir()
    return folder


@pytest.fixture
def extraction(vlc_dump: Path, music_library: Path, tmp_path: Path) -> dict[str, object]:
    """Champs d'un `extract_playlist` sur la bibliotheque et le dump de test."""
    return extraction_command(music_library, vlc_dump, tmp_path / "work")


@pytest.fixture
def locked_writes(monkeypatch: pytest.MonkeyPatch) -> Callable[[], None]:
    """Ecriture refusee comme un fichier verrouille ; rend de quoi lever le verrou."""

    def locked(path: Path, *_args: object) -> object:
        raise TagsWriteError(path, FileFailureReason.FILE_LOCKED)

    monkeypatch.setattr(writing, "write_tags", locked)
    return lambda: monkeypatch.setattr(writing, "write_tags", files.write_tags)
