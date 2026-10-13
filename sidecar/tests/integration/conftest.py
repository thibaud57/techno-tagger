"""Fixtures propres aux tests d'integration : API simulee et dossiers de run."""

from typing import TYPE_CHECKING

import httpx2
import pytest
from scraper_responses import YOUR_MIND
from tagging_api import ORIGINAL, FakeApi, FakeCdn, found, one_track, public_resolver

from tagger import handlers

if TYPE_CHECKING:
    from pathlib import Path


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeApi:
    """API/CDN simules ; resolveur remplace aussi, sinon `ArtworkFetcher` ferait un vrai DNS."""
    fake = FakeApi()
    cdn = FakeCdn()
    monkeypatch.setattr(
        handlers,
        "tagging_transports",
        lambda: handlers.TaggingTransports(
            httpx2.MockTransport(fake.gated_handler),
            httpx2.MockTransport(cdn.handler),
            public_resolver,
        ),
    )
    return fake


@pytest.fixture
def folder(tmp_path: Path, app_data: None, api: FakeApi) -> Path:
    """« Your Mind » que Beatport resout d'office : le run finit avec un morceau a ecrire."""
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    return one_track(tmp_path)


@pytest.fixture
def unresolved_folder(tmp_path: Path, app_data: None) -> Path:
    """Un morceau qu'aucune route de l'API ne resout : sans reponse enregistree, il finit
    `unresolved`, ou en zone grise si le test pose ses propres routes.
    """
    return one_track(tmp_path)


@pytest.fixture
def empty_folder(tmp_path: Path) -> Path:
    """Dossier sans morceau : le run qui le vise se termine aussitot."""
    folder = tmp_path / "empty"
    folder.mkdir()
    return folder
