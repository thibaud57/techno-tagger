"""L'image de la demo recopie des valeurs qui vivent ailleurs : chaque copie est gardee ici."""

import re
from typing import TYPE_CHECKING, Final

import pytest
from repo_files import REPO, read_json

if TYPE_CHECKING:
    from pathlib import Path

DOCKERFILE: Final = REPO / "demo/Dockerfile"
NGINX_CONF: Final = REPO / "demo/nginx.conf"
COMPOSE: Final = REPO / "demo/compose.yaml"


def _match(pattern: str, path: Path) -> str:
    found = re.search(pattern, path.read_text(encoding="utf-8"), re.MULTILINE)
    assert found, f"{path.relative_to(REPO)} ne contient pas le motif {pattern!r}"
    return found.group(1)


def _demo_configuration() -> dict[str, object]:
    build = ("projects", "techno-tagger-ui", "architect", "build")
    configuration = read_json("angular.json", *build, "configurations", "demo")
    assert isinstance(configuration, dict)
    return configuration


def _package_field(*keys: str) -> str:
    value = read_json("package.json", *keys)
    assert isinstance(value, str)
    return value


def test_keeps_the_image_node_major_equal_to_package_json_engines() -> None:
    """La CI suit deja `engines` (`test_the_ci_node_major_is_declared_in_engines`)."""
    image_major = _match(r"^FROM node:(\d+)[\d.]*-slim", DOCKERFILE)
    engines_major = re.search(r"\d+", _package_field("engines", "node"))

    assert engines_major
    assert image_major == engines_major.group(0)


def test_installs_the_pnpm_version_pinned_by_dev_engines() -> None:
    pinned = _package_field("devEngines", "packageManager", "version")

    assert _match(r"^ARG PNPM_VERSION=(\S+)$", DOCKERFILE) == pinned


def test_copies_the_output_path_of_the_demo_build_configuration() -> None:
    output_path = _demo_configuration()["outputPath"]

    assert _match(r"^COPY --from=build /app/(\S+)/browser ", DOCKERFILE) == output_path


def test_serves_the_scenario_at_the_path_the_shell_fetches() -> None:
    service = REPO / "src/app/demo/demo-scenario.service.ts"
    fetched = _match(r'^const SCENARIO_URL = "(/demo/scenario\.json)"', service)
    assets = _demo_configuration()["assets"]
    assert isinstance(assets, list)
    assets_output = next(a["output"] for a in assets if a["input"] == "src/demo")

    assert _match(r"^\s*location = (/demo/scenario\.json) ", NGINX_CONF) == fetched
    assert fetched.startswith(f"/{assets_output}/")


def test_serves_exposes_and_probes_the_same_port() -> None:
    listened = _match(r"^\s*listen\s+(\d+);", NGINX_CONF)
    exposed = _match(r'^\s*expose:\s*\[\s*"(\d+)"\s*\]', COMPOSE)
    probed = _match(r"http://127\.0\.0\.1:(\d+)/healthz", COMPOSE)

    assert listened == exposed == probed


@pytest.mark.parametrize(
    "line",
    ["read_only: true", "cap_drop: [ALL]", "no-new-privileges:true", "pids_limit: 64"],
    ids=["read-only", "cap-drop", "no-new-privileges", "pids-limit"],
)
def test_keeps_the_compose_hardened(line: str) -> None:
    assert line in COMPOSE.read_text(encoding="utf-8"), f"compose.yaml a perdu `{line}`"


@pytest.mark.parametrize(
    "key", ["ports:", "volumes:", "privileged"], ids=["ports", "volumes", "privileged"]
)
def test_keeps_the_compose_closed(key: str) -> None:
    assert key not in COMPOSE.read_text(encoding="utf-8"), f"compose.yaml porte `{key}`"
