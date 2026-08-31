---
title: "PyInstaller — Empaquetage du sidecar Python"
version: "6.22.2"
description: "Référence technique pour PyInstaller : mode onedir, fichier .spec, hooks et hidden imports, nommage sidecar Tauri, absence de cross-compilation et faux positifs antivirus."
date: "2026-08-29"
keywords: ["pyinstaller", "sidecar", "onedir", "spec", "hooks", "hidden-imports", "windows"]
scope: ["docs"]
technologies: ["Python", "Tauri", "uv", "keyring", "sentry-sdk", "rapidfuzz"]
---

# Description

Empaquette le sidecar Python en binaire Windows autonome : interpréteur et dépendances embarqués, aucune installation de Python requise chez l'utilisateur. Le binaire est ensuite déclaré comme sidecar Tauri et lancé par `spawn()` (cf. [tauri.md](tauri.md)).

Supporte Python 3.8 à 3.15, donc le 3.14 du projet.

Deux contraintes structurent tout le reste : **aucune cross-compilation** (runner Windows obligatoire) et **l'analyse statique ne voit pas les imports dynamiques**, ce qui casse trois des dépendances du projet si rien n'est fait.

---

# Concepts Clés

## `--onedir` et le coût de démarrage

### Description

`--onefile` produit un exécutable unique qui s'auto-extrait dans un dossier temporaire à chaque lancement. `--onedir` produit un dossier dont les fichiers persistent.

### Exemple

```bash
pyinstaller --onedir --console --name tagger --noconfirm --clean sidecar/src/tagger/__main__.py
```

### Points Importants

- **Le mode retenu est `--onedir`** (cf. [ADR-015](../adrs/015-cibles-distribution-windows.md)) : `externalBin` ne prend que l'exe suffixé, le dossier `_internal/` passant par `bundle.resources` **en forme objet** (`{ "binaries/_internal": "_internal" }`). Le bootloader `--onedir` cherche ce dossier à côté de l'exe : toute autre forme de déclaration le range ailleurs dans le bundle et le binaire ne démarre pas
- **Le prix est une arborescence visible à côté de l'exécutable** : `_internal/` doit rester solidaire du binaire (cf. puce précédente sur `bundle.resources` en forme objet). C'est `--onefile` qui extrait dans `%TEMP%\_MEIxxxxxx` à chaque lancement puis nettoie à la sortie ; `--onedir` n'auto-extrait rien, ce qui est précisément ce qui le rend sept fois plus rapide au démarrage (335 ms contre 2282 ms, cf. [PRODUCTION.md § Performance](../PRODUCTION.md))
- `sys._MEIPASS` : en `--onedir`, chemin du dossier `_internal` du bundle (donc pas d'extraction, chemin fixe posé par le bundle Tauri) ; en `--onefile`, chemin du dossier temporaire créé par le bootloader. Le projet étant en `--onedir`, `_MEIPASS` désigne chez nous `_internal`, nécessaire pour lire un fichier de données embarqué
- **`Process.kill()` côté Tauri ne cible que le bootloader** en mode onefile, un mode que le projet n'utilise pas : prévoir un arrêt propre par le protocole plutôt que par un kill

---

## Mode console obligatoire

### Description

Le protocole du sidecar passe par `stdin` et `stdout`. `--windowed` détache les handles standards sous Windows.

### Exemple

```bash
pyinstaller --console ...     # correct
pyinstaller --windowed ...    # casse le protocole NDJSON
```

### Points Importants

- **`--windowed` casse la communication avec Tauri** : les flux ne sont plus de vrais handles
- `--console` est le mode par défaut, mais l'expliciter documente la contrainte
- Une issue connue de RapidFuzz signale précisément un échec en mode `--noconsole` : le mode console écarte aussi ce cas

---

## Le fichier `.spec`

### Description

Dès qu'il y a plusieurs hidden imports et hooks à empiler, un `.spec` versionné vaut mieux qu'une ligne de commande qui grossit.

### Exemple

```bash
pyi-makespec --onedir --console --name tagger sidecar/src/tagger/__main__.py
# puis édition du .spec, et ensuite :
pyinstaller tagger.spec --noconfirm --clean
```

```python
# tagger.spec — extrait
from PyInstaller.utils.hooks import collect_submodules, copy_metadata

a = Analysis(
    ['src/tagger/__main__.py'],
    datas=copy_metadata('keyring'),
    hiddenimports=[
        'win32ctypes.pywin32.win32cred',
        'win32ctypes.pywin32.pywintypes',
        *collect_submodules('rapidfuzz'),
    ],
    excludes=['tkinter', 'PyQt5', 'PySide2', 'mypy'],
)
```

### Points Importants

- **Les options du `.spec` priment sur les flags CLI** quand les deux sont donnés : ne pas dupliquer les réglages aux deux endroits
- Un `.spec` est du Python : il se relit, se diffe et se commente, contrairement à une commande de trente flags
- **`--noconfirm` est nécessaire en CI**, sinon PyInstaller demande confirmation avant d'écraser `dist/`
- `--clean` vide le cache et `build/`. Passé systématiquement par `build.py`, comme dans les commandes ci-dessus : gratuit en CI, où le runner est neuf, et il garantit que l'analyse ne réutilise rien qui concerne `_build_info.py`, créé puis supprimé à chaque build. Reste aussi le réflexe quand un hidden import ajouté ne semble pas pris en compte

---

## Hooks et imports dynamiques

### Description

Trois dépendances du projet chargent du code par un mécanisme invisible à l'analyse statique. Chacune a sa réponse.

### Exemple

| Dépendance | Mécanisme | Réponse |
|---|---|---|
| `sentry-sdk` | intégrations chargées par `importlib` | hook de `pyinstaller-hooks-contrib`, **dépendance à déclarer explicitement** |
| `keyring` | backends découverts par entry points | hook `hook-keyring.py` (submodules + métadonnées) **et** **`keyring.set_keyring()`** au démarrage, en défense en profondeur |
| `rapidfuzz` | extensions C++ sous le package (`fuzz_cpp`, `process_cpp_impl`, `utils_cpp`, `metrics_cpp`, dont les cibles SIMD) | `collect_submodules("rapidfuzz")`, le paquet n'exposant aucun module top-level à hidden-importer seul |
| `mutagen` | pur Python, imports statiques | aucune action attendue, à confirmer par un build |

### Points Importants

- **`pyinstaller-hooks-contrib` doit être une dépendance déclarée du groupe de build** : sans lui, sentry-sdk perd ses intégrations, silencieusement ou par `ImportError` selon la version
- **Le hook réel est `PyInstaller/hooks/hook-keyring.py`**, et il fait déjà les deux : `collect_submodules('keyring.backends')` et `copy_metadata('keyring')`. Le forçage explicite du backend par `set_keyring()` reste la solution confirmée par les mainteneurs pour court-circuiter entièrement la découverte, pas un correctif à un hook lacunaire (cf. [keyring.md](keyring.md))
- **Aucun hook ne couvre rapidfuzz** : son entry point `pyinstaller40` s'appelle `tests`, pas `hook-dirs`, et `pyinstaller-hooks-contrib` n'en fournit pas non plus. `collect_submodules("rapidfuzz")` est donc explicite dans le `.spec`, pas délégué à un hook
- La règle générale : **tout ce qui s'importe par une chaîne de caractères est invisible** à PyInstaller

---

## Nommage sidecar Tauri

### Description

Tauri attend un binaire suffixé par le target triple, qu'il retire à l'exécution. Le script de build fait la copie.

### Exemple

```python
# sidecar/build.py — extrait
triple = subprocess.run(["rustc", "--print", "host-tuple"],
                        capture_output=True, text=True, check=True).stdout.strip()
shutil.copy("dist/tagger.exe", f"../src-tauri/binaries/tagger-{triple}.exe")
```

### Points Importants

- **Lire le triple plutôt que le coder en dur** : `x86_64-pc-windows-msvc` est le cas courant, mais il vient de la toolchain, pas d'une constante
- Le fichier va dans `src-tauri/binaries/`, chemin déclaré dans `externalBin`
- **Un binaire sans suffixe est introuvable au lancement**, avec un message qui n'oriente pas vers cette cause
- Le build du sidecar précède toujours `tauri build`

---

## Pas de cross-compilation

### Description

PyInstaller embarque l'interpréteur natif de la plateforme hôte et analyse ses dépendances binaires. Un `.exe` Windows ne se produit que sur Windows.

### Exemple

```yaml
# .github/workflows/release.yml — extrait
jobs:
  build:
    runs-on: windows-latest   # obligatoire, pas un choix de confort
```

### Points Importants

- **Aucun contournement** : ni conteneur, ni option de ciblage
- Le runner Windows sert donc à la fois au sidecar et au build Tauri, ce qui simplifie le workflow
- La 6.22.2 corrige spécifiquement la collecte de DLL pour des paquets installés par **uv** plutôt que pip : la combinaison est maintenue, mais elle demande de suivre les versions
- `uv run pyinstaller ...` garantit que le binaire et les dépendances embarquées viennent du venv verrouillé

---

## Taille du binaire et faux positifs antivirus

### Description

Un exécutable non signé est régulièrement signalé par Windows Defender et SmartScreen : le comportement d'auto-extraction ressemble à celui d'un packer.

### Exemple

```bash
pyinstaller --onedir --console --noupx \
  --exclude-module tkinter --exclude-module PyQt5 --exclude-module PySide2 --exclude-module mypy \
  ...
```

### Points Importants

- **`--noupx` réduit les faux positifs** au prix d'un binaire plus gros : le compromis penche vers la détection pour un outil distribué
- `--exclude-module` sur les paquets non utilisés est le levier principal de taille
- **L'atténuation retenue est `--onedir`, pas la signature de code** : le certificat Authenticode est écarté par le budget nul, et `--onedir` supprime l'auto-extraction qui déclenche les heuristiques, lequel a par ailleurs sa propre signature (cf. [ADR-015](../adrs/015-cibles-distribution-windows.md))
- Signaler un faux positif à l'éditeur antivirus fonctionne, avec quelques jours de délai : ce n'est pas une solution de release

---

# Commandes Clés

## Build du sidecar

### Description

Le cycle complet, tel qu'appelé par `build.py` en local comme en CI.

### Syntaxe

```bash
uv run pyinstaller tagger.spec --noconfirm --clean
uv run pyi-makespec --onedir --console --name tagger src/tagger/__main__.py
uv run pyinstaller --onedir --console --name tagger --noconfirm \
  --collect-submodules rapidfuzz --collect-all sentry_sdk src/tagger/__main__.py
```

### Points Importants

- **Toujours passer par `uv run`** : sinon PyInstaller peut être celui d'un autre environnement, et le binaire embarque les mauvaises dépendances
- `--noconfirm` en CI, sans exception
- `pyi-makespec` ne construit rien : il génère le `.spec` à éditer

## Diagnostic

### Description

Quand le binaire échoue à l'exécution alors que le code fonctionne en développement.

### Syntaxe

```bash
uv run pyinstaller --debug=imports tagger.spec   # trace les imports au runtime
uv run pyinstaller --log-level=DEBUG tagger.spec # verbosité de l'analyse
```

### Points Importants

- **`--debug=imports` est le premier outil** face à un `ModuleNotFoundError` qui n'existe qu'en binaire
- Le fichier de build sous `build/<nom>/` liste les modules analysés : c'est là qu'on vérifie qu'un hidden import a bien été pris
- Un échec qui ne se produit que dans le binaire est presque toujours un import dynamique manquant

---

# Bonnes Pratiques

## ✅ Recommandations

- **Passer par un `.spec` versionné** dès le deuxième hidden import
- **Déclarer `pyinstaller-hooks-contrib` explicitement** dans le groupe de dépendances de build
- **Lancer PyInstaller via `uv run`** pour garantir le venv verrouillé
- **Lire le target triple depuis `rustc`** dans `build.py`, jamais en dur
- **Tester le binaire produit sur chaque dépendance à chargement dynamique** : clé keyring lue, event Sentry envoyé, scoring rapidfuzz exécuté
- **Garder `--noupx`** et réduire la taille par `--exclude-module`

## ❌ Anti-Patterns

- **`--windowed`** : détache `stdin`/`stdout` et casse le protocole
- **Empiler les `--hidden-import` en ligne de commande** dans `build.py` : illisible et non diffable
- **Supposer qu'une dépendance est couverte par un hook** sans avoir lancé le binaire
- **Tenter un build Windows depuis Linux** : PyInstaller ne cross-compile pas
- **Compter sur `Process.kill()` pour arrêter le sidecar onefile** : seul le bootloader est visé
- **Lancer `pyinstaller` hors de `uv run`** : le binaire embarque alors un autre environnement
- **Considérer le packaging comme terminé parce que le build a réussi** : les échecs d'import dynamique n'apparaissent qu'à l'exécution

---

# 🔗 Ressources

## Documentation Officielle

- [PyInstaller](https://pyinstaller.org/en/stable/)
- [Usage](https://pyinstaller.org/en/stable/usage.html) · [Spec files](https://pyinstaller.org/en/stable/spec-files.html) · [Hooks](https://pyinstaller.org/en/stable/hooks.html)
- [Common issues and pitfalls](https://pyinstaller.org/en/stable/common-issues-and-pitfalls.html)
- [pyinstaller-hooks-contrib](https://github.com/pyinstaller/pyinstaller-hooks-contrib)

## Ressources Complémentaires

- [ADR-005 — Sidecar Python et protocole NDJSON](../adrs/005-sidecar-python-protocole-ndjson.md)
- [ADR-015 — Cibles de distribution Windows](../adrs/015-cibles-distribution-windows.md)
- [Tauri — Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- [keyring.md](keyring.md) · [sentry.md](sentry.md) · [rapidfuzz.md](rapidfuzz.md)
