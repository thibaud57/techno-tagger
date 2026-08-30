"""Construit le binaire du sidecar et l'installe la ou Tauri l'attend.

A lancer par `uv run --group build python build.py`. Doit tourner AVANT toute
commande Tauri : beforeDevCommand et beforeBuildCommand ne font que le frontend.
"""

import os
import shutil
import subprocess
import sys
import tomllib
from importlib.metadata import version
from pathlib import Path

SIDECAR = Path(__file__).parent
# Derive du manifeste : un renommage du paquet ne doit pas se propager a la main
# dans les chemins de sortie, la spec et la lecture de version.
PACKAGE = tomllib.loads((SIDECAR / "pyproject.toml").read_text(encoding="utf-8"))["project"]["name"]
DIST = SIDECAR / "dist" / PACKAGE
BINARIES = SIDECAR.parent / "src-tauri" / "binaries"
BUILD_INFO = SIDECAR / "src" / PACKAGE / "_build_info.py"


def write_build_info() -> None:
    """Grave les constantes de build, PyInstaller n'ayant pas d'equivalent au
    `--define` d'esbuild. La version en fait partie : le binaire ne porte aucun
    `tagger.dist-info`, `importlib.metadata` y leverait PackageNotFoundError.
    """
    dsn = os.environ.get("SENTRY_DSN_SIDECAR", "")
    if not dsn:
        print("SENTRY_DSN_SIDECAR absent : binaire sans remontee d'erreurs", file=sys.stderr)

    lines = [
        f"SENTRY_DSN = {dsn!r}",
        f"VERSION = {version(PACKAGE)!r}",
        'ENVIRONMENT = "production"',
    ]
    BUILD_INFO.write_text("\n".join(lines) + "\n", encoding="utf-8")


def target_triple() -> str:
    """Suffixe attendu par Tauri. Un binaire mal suffixe est introuvable au
    lancement, et l'erreur n'oriente pas vers cette cause.
    """
    # S607 assume : rustc vient du PATH, un chemin absolu casserait selon rustup.
    return subprocess.run(
        ["rustc", "--print", "host-tuple"],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def main() -> int:
    suffix = target_triple()

    write_build_info()
    try:
        # S603 assume : le nom de la spec vient du pyproject.toml du depot, pas d'une
        # entree externe. Il est derive et non ecrit en dur pour qu'un renommage du
        # paquet ne laisse pas cet appel pointer sur l'ancien fichier.
        subprocess.run(  # noqa: S603
            [sys.executable, "-m", "PyInstaller", f"{PACKAGE}.spec", "--noconfirm", "--clean"],
            cwd=SIDECAR,
            check=True,
        )
    finally:
        # Sinon le DSN de production reste dans l'arbre source, et le prochain
        # `just dev-sidecar` initialise Sentry pour de bon.
        BUILD_INFO.unlink(missing_ok=True)

    exe = DIST / f"{PACKAGE}.exe"
    if not exe.exists():
        print(f"binaire introuvable apres le build : {exe}", file=sys.stderr)
        return 1

    BINARIES.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exe, BINARIES / f"{PACKAGE}-{suffix}.exe")

    # externalBin ne prend qu'un executable, _internal/ passe par bundle.resources
    internal = BINARIES / "_internal"
    shutil.rmtree(internal, ignore_errors=True)
    shutil.copytree(DIST / "_internal", internal)

    print(f"sidecar installe dans {BINARIES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
