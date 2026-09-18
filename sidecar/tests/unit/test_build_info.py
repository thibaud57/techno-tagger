"""Hors packaging, aucune constante de build n'existe : les valeurs de repli sont
ce qui garantit qu'un lancement depuis les sources ne remonte rien a Sentry.
"""

from tagger.build_info import ENVIRONMENT, SENTRY_DSN, VERSION


def test_outside_packaging_the_dsn_is_empty_so_the_sdk_stays_inert() -> None:
    assert SENTRY_DSN == ""


def test_outside_packaging_the_environment_is_not_production() -> None:
    assert ENVIRONMENT == "development"


def test_the_version_stays_readable_outside_packaging() -> None:
    assert VERSION
