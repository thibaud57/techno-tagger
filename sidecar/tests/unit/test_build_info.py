"""Hors packaging, aucune constante de build n'existe : les valeurs de repli sont
ce qui garantit qu'un lancement depuis les sources ne remonte rien a Sentry.
"""

from tagger.build_info import ENVIRONMENT, SENTRY_DSN, VERSION


def test_hors_packaging_le_dsn_est_vide_donc_le_sdk_inerte() -> None:
    assert SENTRY_DSN == ""


def test_hors_packaging_l_environnement_n_est_pas_production() -> None:
    assert ENVIRONMENT == "development"


def test_la_version_reste_lisible_hors_packaging() -> None:
    assert VERSION
