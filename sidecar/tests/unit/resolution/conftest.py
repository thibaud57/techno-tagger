"""Fixtures des tests de resolution : client techno-scraper et caches."""

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    import httpx2


@pytest.fixture
def requests() -> list[httpx2.Request]:
    """Journal des requetes emises, rempli par le handler du `MockTransport`.

    Une liste neuve par test : c'est la seule fenetre sur ce que le client a emis.
    """
    return []
