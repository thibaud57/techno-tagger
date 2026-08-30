# -*- mode: python ; coding: utf-8 -*-
"""Spec PyInstaller du sidecar, en --onedir.

Ce qui suit est charge dynamiquement, donc invisible a l'analyse statique : une
omission ne se voit qu'a l'execution du binaire, jamais au build.
"""

import tomllib

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

# SPECPATH est fourni par PyInstaller. Le nom vient du manifeste, comme dans
# build.py, qui va ensuite chercher l'executable sous ce meme nom.
PACKAGE = tomllib.loads((Path(SPECPATH) / "pyproject.toml").read_text(encoding="utf-8"))["project"]["name"]

a = Analysis(
    [f"src/{PACKAGE}/__main__.py"],
    pathex=[],
    binaries=[],
    # Redondant avec le `hook-keyring.py` de PyInstaller, garde volontairement : ce
    # hook resout le backend par `collect_submodules("keyring.backends")`, la copie
    # des metadonnees ne fait qu'alimenter la decouverte par entry points. Le jour
    # ou le hook regresse, l'echec est un NoKeyringError visible du seul binaire.
    datas=copy_metadata("keyring"),
    hiddenimports=[
        # Tires par WinVaultKeyring, jamais par une instruction d'import visible.
        # `hook-win32ctypes.core.py` ne couvre que `win32ctypes.core.*`, pas ceux-ci.
        "win32ctypes.pywin32.win32cred",
        "win32ctypes.pywin32.pywintypes",
        # Aucun hook ne couvre rapidfuzz : son entry point pyinstaller40 s'appelle
        # `tests`, pas `hook-dirs`, et hooks-contrib n'en fournit pas. L'analyse
        # statique prend l'extension C++, pas ses cibles SIMD (issue #391).
        *collect_submodules("rapidfuzz"),
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Aucune interface graphique dans le sidecar
        "tkinter",
        "PyQt5",
        "PySide2",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=PACKAGE,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX augmente les faux positifs antivirus, deja un risque sur binaire non signe
    upx=False,
    # --windowed detacherait stdin/stdout sous Windows : sidecar muet, protocole mort
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name=PACKAGE,
)
