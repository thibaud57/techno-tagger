"""Un crash survenu pendant le parsing doit deja etre tracable : logging et Sentry
sont donc armes avant que la boucle de commandes ne lise quoi que ce soit.
"""

import io
import json
import sys
import tomllib
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import Mock, patch

from tagger import APP_NAME, BUNDLE_IDENTIFIER, RELEASE, __main__, __version__

if TYPE_CHECKING:
    import pytest


def test_logging_and_sentry_are_armed_before_the_loop() -> None:
    parent = Mock()
    with (
        patch.object(__main__, "setup_logging", autospec=True) as setup,
        patch.object(__main__, "init_sentry", autospec=True) as sentry,
        patch.object(__main__, "run_loop", autospec=True) as run_loop,
    ):
        parent.attach_mock(setup, "setup_logging")
        parent.attach_mock(sentry, "init_sentry")
        parent.attach_mock(run_loop, "run_loop")

        __main__.main()

    order = [call[0] for call in parent.mock_calls]
    assert order == ["setup_logging", "init_sentry", "run_loop"]


def test_the_protocol_streams_are_forced_to_utf8(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tauri lance le sidecar avec des pipes, que Windows ouvre en cp1252 : un seul
    titre hors latin-1 tuerait le run des la premiere ligne lue ou ecrite.
    """
    stdin = io.TextIOWrapper(io.BytesIO(b""), encoding="cp1252")
    stdout = io.TextIOWrapper(io.BytesIO(), encoding="cp1252")
    monkeypatch.setattr(sys, "stdin", stdin)
    monkeypatch.setattr(sys, "stdout", stdout)

    __main__._force_utf8_streams()

    assert stdin.encoding == "utf-8"
    assert stdout.encoding == "utf-8"


def test_the_protocol_stream_ends_lines_with_lf_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """Le plugin shell de Tauri coupe ses lignes sur `\\r` seul quand un chunk de 8 Ko
    tombe avant le `\\n` : un CRLF tronque l'evenement et fait partir un evenement
    parasite vide. Le wrapper traduit `\\n` en `os.linesep` tant qu'on ne fixe pas
    `newline`, et rien dans le protocole ne le montre en developpement.
    """
    raw = io.BytesIO()
    stdout = io.TextIOWrapper(raw, encoding="cp1252", newline="\r\n")
    monkeypatch.setattr(sys, "stdout", stdout)

    __main__._force_utf8_streams()
    stdout.write('{"type":"ready"}\n')
    stdout.flush()

    assert raw.getvalue() == b'{"type":"ready"}\n'


def test_the_log_folder_follows_the_bundle_identifier(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tauri compose `appLocalDataDir()` avec l'identifiant du bundle, pas avec le
    nom de l'application : le sidecar ecrirait sinon hors des scopes de la webview.
    """
    monkeypatch.setenv("LOCALAPPDATA", "C:/Users/x/AppData/Local")

    result = __main__.log_dir()

    assert result == Path("C:/Users/x/AppData/Local") / BUNDLE_IDENTIFIER / "logs"


REPO = Path(__file__).parents[3]


def _at(path: str, *keys: str) -> object:
    """Descend une suite de cles dans un JSON du depot. Les `assert isinstance` sont
    le narrowing qu'exige mypy strict, `json.loads` ne rendant que des `object`.
    """
    node: object = json.loads((REPO / path).read_text(encoding="utf-8"))
    for key in keys:
        assert isinstance(node, dict)
        node = node[key]
    return node


def test_the_application_identity_is_the_same_everywhere() -> None:
    """Le nom et l'identifiant sont recopies a la main dans cinq fichiers que rien ne
    synchronise, et chaque divergence est muette : un identifiant desaccorde envoie
    les deux cotes dans deux dossiers de donnees voisins, hors des scopes fs, et un
    nom desaccorde disperse les erreurs sur deux releases Sentry incomparables.
    """
    build = ("projects", f"{APP_NAME}-ui", "architect", "build", "options")
    workflow = (REPO / ".github/workflows/release-please.yml").read_text(encoding="utf-8")
    cargo = tomllib.loads((REPO / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))

    assert _at("src-tauri/tauri.conf.json", "identifier") == BUNDLE_IDENTIFIER
    assert _at("src-tauri/tauri.conf.json", "productName") == APP_NAME
    # `tauri dev` lance target/debug/<package.name>.exe, le bundle <productName>.exe :
    # `just stop-app` ne tue les deux que s'ils portent le meme nom.
    assert cargo["package"]["name"] == APP_NAME
    assert f"{APP_NAME}@{__version__}" == RELEASE
    assert _at("angular.json", *build, "define", "APP_NAME") == f"'{APP_NAME}'"
    assert f"{APP_NAME}@" in str(_at("package.json", "scripts", "sourcemaps"))
    assert f"release: {APP_NAME}@" in workflow


def _sidecar_name() -> str:
    """`project.name` est la source dont build.py derive deja le nom du binaire."""
    manifest = tomllib.loads((REPO / "sidecar/pyproject.toml").read_text(encoding="utf-8"))
    name = manifest["project"]["name"]
    assert isinstance(name, str)
    return name


def test_the_sidecar_binary_name_is_the_same_on_both_sides() -> None:
    """`externalBin` et le scope de la capability se lisent a deux endroits : une
    divergence laisse passer `cargo check`, `just lint-tauri` et `just build`, et ne
    se voit qu'au premier spawn chez l'utilisateur, en SidecarNotAllowed.
    """
    expected = f"binaries/{_sidecar_name()}"
    permissions = _at("src-tauri/capabilities/default.json", "permissions")

    assert isinstance(permissions, list)
    spawn = next(
        p for p in permissions if isinstance(p, dict) and p["identifier"] == "shell:allow-spawn"
    )

    assert _at("src-tauri/tauri.conf.json", "bundle", "externalBin") == [expected]
    assert [entry["name"] for entry in spawn["allow"]] == [expected]


def test_the_sidecar_process_is_killed_under_its_real_name() -> None:
    """Le hook NSIS et `just stop-app` tuent le sidecar par nom de processus, en
    dur : renomme, il survivrait a l'installeur et verrouillerait son propre
    fichier pendant l'ecrasement, sans qu'aucun build ne le signale.
    """
    process = f"{_sidecar_name()}.exe"
    hook = (REPO / "src-tauri/installer-hooks.nsh").read_text(encoding="utf-8")
    justfile = (REPO / "Justfile").read_text(encoding="utf-8")

    assert f'KillProcessCurrentUser "{process}"' in hook
    # `//IM` : le Justfile tourne sous Git Bash, ou MSYS convertirait `/IM` en chemin
    assert f"taskkill //IM {process}" in justfile
    assert f"taskkill //IM {APP_NAME}.exe" in justfile


def test_the_angular_project_name_is_the_same_in_the_three_manifests() -> None:
    """Aucun `outputPath` n'est declare : Angular derive `dist/<projet>/` de son nom
    de projet. `frontendDist` et le script sourcemaps, qui lit `name` par
    `$npm_package_name`, pointent ce dossier par une chaine recopiee a la main.
    """
    projects = _at("angular.json", "projects")

    assert isinstance(projects, dict)
    project = next(iter(projects))

    assert _at("package.json", "name") == project
    assert _at("src-tauri/tauri.conf.json", "build", "frontendDist") == f"../dist/{project}/browser"


def test_the_four_manifests_carry_the_same_version() -> None:
    """release-please les propage, rien ne verifie le resultat : desaccordes, sidecar
    et webview remontent deux releases pour une meme livraison.
    """
    cargo = tomllib.loads((REPO / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))

    assert _at("package.json", "version") == __version__
    assert cargo["package"]["version"] == __version__
    assert _at(".release-please-manifest.json", ".") == __version__
