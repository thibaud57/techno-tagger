"""Construit le binaire du sidecar et l'installe la ou Tauri l'attend.

A lancer par `uv run --group build python build.py`. Doit tourner AVANT toute
commande Tauri : beforeDevCommand et beforeBuildCommand ne font que le frontend.
"""

import shutil
import subprocess
import sys
from pathlib import Path

SIDECAR = Path(__file__).parent
DIST = SIDECAR / "dist" / "tagger"
BINARIES = SIDECAR.parent / "src-tauri" / "binaries"


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
    subprocess.run(
        [sys.executable, "-m", "PyInstaller", "tagger.spec", "--noconfirm", "--clean"],
        cwd=SIDECAR,
        check=True,
    )

    exe = DIST / "tagger.exe"
    if not exe.exists():
        print(f"binaire introuvable apres le build : {exe}", file=sys.stderr)
        return 1

    BINARIES.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exe, BINARIES / f"tagger-{target_triple()}.exe")

    # externalBin ne prend qu'un executable, _internal/ passe par bundle.resources
    internal = BINARIES / "_internal"
    shutil.rmtree(internal, ignore_errors=True)
    shutil.copytree(DIST / "_internal", internal)

    print(f"sidecar installe dans {BINARIES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
