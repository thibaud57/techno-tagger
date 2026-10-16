"""Un crash survenu pendant le parsing doit deja etre tracable : logging et Sentry
sont donc armes avant que la boucle de commandes ne lise quoi que ce soit.
"""

import io
import re
import sys
import tomllib
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, NamedTuple
from unittest.mock import Mock, patch

import pytest
from repo_files import REPO, read_json
from run_plans import plan_of, save_plan
from tagging_records import RECORD

from tagger import APP_NAME, BUNDLE_IDENTIFIER, RELEASE, __main__, __version__
from tagger.run.plan import plan_dir

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path


class _Startup(NamedTuple):
    run_loop: Mock
    calls: list[str]


def _noting(calls: list[str], name: str) -> Callable[..., None]:
    def note(*_args: object, **_kwargs: object) -> None:
        calls.append(name)

    return note


@pytest.fixture
def startup() -> Iterator[_Startup]:
    """Les etapes du demarrage que ces tests ne veulent pas executer pour de vrai, dans
    l'ordre ou elles sont appelees.
    """
    calls: list[str] = []
    steps = ("setup_logging", "init_sentry", "run_loop")
    with ExitStack() as stack:
        mocks = {
            name: stack.enter_context(
                patch.object(__main__, name, autospec=True, side_effect=_noting(calls, name))
            )
            for name in steps
        }
        yield _Startup(mocks["run_loop"], calls)


def test_logging_and_sentry_are_armed_before_the_loop(startup: _Startup) -> None:
    with (
        patch.object(
            __main__,
            "_purge_old_dumps",
            autospec=True,
            side_effect=_noting(startup.calls, "_purge_old_dumps"),
        ),
        patch.object(
            __main__,
            "_purge_old_plans",
            autospec=True,
            side_effect=_noting(startup.calls, "_purge_old_plans"),
        ),
    ):
        __main__.main()

    assert startup.calls == [
        "setup_logging",
        "init_sentry",
        "_purge_old_dumps",
        "_purge_old_plans",
        "run_loop",
    ]


@pytest.mark.parametrize(
    ("failing", "skipped", "message"),
    [
        ("purge_dumps", "_purge_old_plans", "tag dump purge failed"),
        ("purge_plans", "_purge_old_dumps", "run plan purge failed"),
    ],
    ids=["dumps", "plans"],
)
def test_a_failed_purge_never_stops_the_startup(
    startup: _Startup, caplog: pytest.LogCaptureFixture, failing: str, skipped: str, message: str
) -> None:
    with (
        patch.object(__main__, failing, autospec=True, side_effect=OSError(5, "denied")),
        patch.object(__main__, skipped, autospec=True),
    ):
        __main__.main()

    startup.run_loop.assert_called_once()
    assert message in caplog.messages


@pytest.mark.usefixtures("app_data")
def test_the_startup_purge_removes_the_plans_older_than_thirty_days(tmp_path: Path) -> None:
    started_at = datetime.now(UTC) - timedelta(days=31)
    expired = save_plan(plan_dir(), plan_of(tmp_path, [RECORD], started_at=started_at))

    __main__._purge_old_plans()

    assert not expired.exists()


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


def test_the_application_identity_is_the_same_everywhere() -> None:
    """Le nom et l'identifiant sont recopies a la main dans plusieurs fichiers que rien ne
    synchronise, et chaque divergence est muette : un identifiant desaccorde envoie
    les deux cotes dans deux dossiers de donnees voisins, hors des scopes fs, et un
    nom desaccorde disperse les erreurs sur deux releases Sentry incomparables.
    """
    build = ("projects", f"{APP_NAME}-ui", "architect", "build", "options")
    workflow = (REPO / ".github/workflows/release-please.yml").read_text(encoding="utf-8")
    cargo = tomllib.loads((REPO / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))

    assert read_json("src-tauri/tauri.conf.json", "identifier") == BUNDLE_IDENTIFIER
    assert read_json("src-tauri/tauri.conf.json", "productName") == APP_NAME
    # `tauri dev` lance target/debug/<package.name>.exe, le bundle <productName>.exe :
    # `just stop-app` ne tue les deux que s'ils portent le meme nom.
    assert cargo["package"]["name"] == APP_NAME
    assert f"{APP_NAME}@{__version__}" == RELEASE
    assert read_json("angular.json", *build, "define", "APP_NAME") == f"'{APP_NAME}'"
    assert f"{APP_NAME}@" in str(read_json("package.json", "scripts", "sourcemaps"))
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
    permissions = read_json("src-tauri/capabilities/default.json", "permissions")

    assert isinstance(permissions, list)
    spawn = next(
        p for p in permissions if isinstance(p, dict) and p["identifier"] == "shell:allow-spawn"
    )

    assert read_json("src-tauri/tauri.conf.json", "bundle", "externalBin") == [expected]
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
    projects = read_json("angular.json", "projects")

    assert isinstance(projects, dict)
    project = next(iter(projects))

    assert read_json("package.json", "name") == project
    assert (
        read_json("src-tauri/tauri.conf.json", "build", "frontendDist")
        == f"../dist/{project}/browser"
    )


def test_the_four_manifests_carry_the_same_version() -> None:
    """release-please les propage, rien ne verifie le resultat : desaccordes, sidecar
    et webview remontent deux releases pour une meme livraison.
    """
    cargo = tomllib.loads((REPO / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))

    assert read_json("package.json", "version") == __version__
    assert cargo["package"]["version"] == __version__
    assert read_json(".release-please-manifest.json", ".") == __version__


def _setup_input(action: str, key: str) -> str:
    """Lit une entree `with:` d'une action composite de `.github/actions/`, seul
    endroit des workflows ou vit la version d'un outil. Regex faute de lecteur YAML.
    """
    text = (REPO / f".github/actions/{action}/action.yml").read_text(encoding="utf-8")
    values = re.findall(rf"^\s+{key}:\s*[\"']?([^\"'\s#]+)[\"']?\s*(?:#.*)?$", text, re.MULTILINE)
    assert len(values) == 1, f"{key} attendu une fois dans {action}, trouve {values}"
    return str(values[0])


def _version(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split("."))


def test_uv_build_follows_the_required_uv_minor() -> None:
    """`required-version` est la seule source de la version d'uv (le poste la subit,
    `setup-uv` la lit). Le backend `uv_build` embarque ne sert que si sa version
    satisfait `[build-system]` : un plancher monte par Dependabot au-dessus de ce minor
    fait retelecharger le backend depuis l'index a chaque build, sans erreur.
    """
    manifest = tomllib.loads((REPO / "sidecar/pyproject.toml").read_text(encoding="utf-8"))
    bounds = re.fullmatch(r"uv_build>=([\d.]+),<([\d.]+)", manifest["build-system"]["requires"][0])
    required = re.fullmatch(r">=([\d.]+),<([\d.]+)", manifest["tool"]["uv"]["required-version"])

    assert bounds is not None
    assert required is not None
    assert _version(bounds[1])[:2] == _version(required[1])[:2]
    assert _version(bounds[2])[:2] == _version(required[2])[:2]


def test_the_ci_node_major_is_declared_in_engines() -> None:
    """`engines.node` et le `runtime` de `setup-pnpm` montent ensemble au passage LTS :
    un oubli laisse la CI construire sur une majeure que le projet ne declare pas.
    """
    major = _setup_input("setup-pnpm", "runtime").removeprefix("node@")

    assert f"^{major}." in str(read_json("package.json", "engines", "node"))
