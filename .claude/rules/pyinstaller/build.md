---
paths:
  - "sidecar/build.py"
  - "sidecar/*.spec"
---

# PyInstaller : build du sidecar

## À faire
- Lancer PyInstaller par `uv run` : sinon le binaire embarque les dépendances d'un autre environnement
- Passer par un `.spec` versionné dès le deuxième hidden import : c'est du Python, donc relisible, diffable et commentable
- Construire en `--onedir` et déclarer l'exe en `bundle.externalBin`, le dossier `_internal/` en `bundle.resources` (cf. [ARCHITECTURE.md § Arborescence](../../../docs/ARCHITECTURE.md#arborescence))
- Rester en mode console (`console=True` du `.spec`) : le mode fenêtré détache `stdin`/`stdout` sous Windows et casse le protocole NDJSON
- Déclarer `pyinstaller-hooks-contrib` dans le groupe de dépendances de build : sans lui, sentry-sdk perd ses intégrations, silencieusement ou par `ImportError` selon la version
- Lire le target triple depuis `rustc --print host-tuple` dans `build.py`, jamais en dur et copier le binaire suffixé dans `src-tauri/binaries/`
- Passer `--noconfirm` en CI, sans exception
- Garder `--clean` dans `build.py` : l'analyse repart d'un arbre propre, `_build_info.py` (DSN compris) étant créé puis supprimé à chaque build. C'est aussi le premier réflexe quand un hidden import semble ignoré
- Garder `upx=False` dans le `.spec` et réduire la taille par ses `excludes` sur les paquets non utilisés
- Valider chaque chargement dynamique **sur le binaire figé** : clé keyring lue, event Sentry envoyé, scoring rapidfuzz, ligne NDJSON validée par Pydantic
- Garder `collect_submodules("rapidfuzz")` explicite dans le `.spec` : rapidfuzz n'a aucun hook utile, contrairement à `pydantic` (hook de `pyinstaller-hooks-contrib`, `pydantic-core` tracé par l'analyse statique)

## À éviter
- Empiler les `--hidden-import` en ligne de commande dans `build.py`, ou dupliquer un réglage entre le `.spec` et les flags CLI : illisible, non diffable et les options du `.spec` priment
- Considérer le packaging comme acquis parce que le build a réussi, ou parce qu'un hook est censé couvrir une dépendance : les échecs d'import dynamique n'apparaissent qu'à l'exécution
- Tenter un build Windows depuis Linux : PyInstaller ne cross-compile pas, sans contournement, ni conteneur ni option de ciblage
- Déclarer `[project.scripts]` dans le `pyproject.toml` du sidecar : `uv init --package` le génère, mais le point d'entrée est le script du `.spec` et rien ne consomme la commande console

## Gotchas
- Le `.spec` ne voit pas son dossier sur `sys.path` : il n'importe aucun module voisin, tout partage avec `build.py` passe par `SPEC`, `SPECPATH`, `DISTPATH`, `workpath` ou le nom du fichier
- Tout import par chaîne de caractères échappe à l'analyse statique : sentry-sdk (`importlib`), keyring (entry points), rapidfuzz (extension C++)
- `--debug=imports` est le premier outil face à un `ModuleNotFoundError` propre au binaire ; `build/<nom>/` liste les modules analysés
- Un exécutable non signé est signalé par Defender et SmartScreen : la signature étant écartée par le budget, restent `--onedir` et `upx=False`
- `--onefile` s'auto-extrait dans `%TEMP%` à chaque lancement et un `Process.kill()` côté Tauri ne tue que son bootloader, pas le process Python : d'où `--onedir`
