---
paths:
  - "sidecar/build.py"
  - "sidecar/*.spec"
---

# PyInstaller — Build du sidecar

## À faire
- Lancer PyInstaller par `uv run` : sinon le binaire embarque les dépendances d'un autre environnement
- Passer par un `.spec` versionné dès le deuxième hidden import : c'est du Python, donc relisible, diffable et commentable
- Construire en `--onedir` et déclarer l'exe en `bundle.externalBin`, le dossier `_internal/` en `bundle.resources` ([ARCHITECTURE.md § Arborescence](../../../docs/ARCHITECTURE.md#arborescence))
- Rester en mode console : `--windowed` détache `stdin`/`stdout` sous Windows et casse le protocole NDJSON
- Déclarer `pyinstaller-hooks-contrib` dans le groupe de dépendances de build : sans lui, sentry-sdk perd ses intégrations, silencieusement ou par `ImportError` selon la version
- Forcer le backend keyring en code : `hook-keyring.py` résout le backend par `collect_submodules` et `copy_metadata`, mais `set_keyring()` reste la ceinture, une régression du hook ne se voyant que dans le binaire figé (cf. [keyring/secrets.md](../keyring/secrets.md))
- Lire le target triple depuis `rustc --print host-tuple` dans `build.py`, jamais en dur, et copier le binaire suffixé dans `src-tauri/binaries/`
- Passer `--noconfirm` en CI, sans exception
- Garder `--clean` systématique dans `build.py` : le runner de CI n'a aucun cache PyInstaller ni `build/` à vider, le coût y est nul, et l'analyse repart d'un arbre propre alors que `_build_info.py` est créé puis supprimé à chaque build, DSN de production compris. Le coût réel est local, sur les builds répétés. `--clean` reste par ailleurs le premier réflexe quand un hidden import ajouté ne semble pas pris en compte
- Garder `--noupx` et réduire la taille par `--exclude-module` sur les paquets non utilisés
- Valider chaque chargement dynamique **sur le binaire figé** : clé keyring lue, event Sentry envoyé, scoring rapidfuzz exécuté, ligne NDJSON validée par un modèle Pydantic. Trois cas distincts : `pydantic` a un hook (`hook-pydantic.py` de `pyinstaller-hooks-contrib`) qui collecte ses sous-modules ; `pydantic-core`, l'extension native qu'il embarque, n'a pas de hook propre et n'en a pas besoin, l'analyse statique la traçant via les imports de `pydantic` ; `rapidfuzz`, l'autre extension native de la stack, n'a aucun hook du tout, son entry point `pyinstaller40` pointant vers sa suite de tests et non vers des `hiddenimports` — `collect_submodules("rapidfuzz")` est donc explicite dans le `.spec`

## À éviter
- `--windowed` : le protocole passe par les flux standards
- Empiler les `--hidden-import` en ligne de commande dans `build.py`, ou dupliquer un réglage entre le `.spec` et les flags CLI : illisible, non diffable, et les options du `.spec` priment
- Considérer le packaging comme acquis parce que le build a réussi, ou parce qu'un hook est censé couvrir une dépendance : les échecs d'import dynamique n'apparaissent qu'à l'exécution
- Tenter un build Windows depuis Linux : PyInstaller ne cross-compile pas, sans contournement, ni conteneur ni option de ciblage
- Compter sur `Process.kill()` côté Tauri pour arrêter un sidecar `--onefile` : seul le bootloader est visé, prévoir un arrêt propre par le protocole

## Gotchas
- Le `.spec` reçoit `SPEC`, `SPECPATH`, `DISTPATH` et `workpath` de PyInstaller, mais **pas** son dossier sur `sys.path` : il ne peut importer aucun module voisin sous l'entry point `pyinstaller`, qui retire `sys.path[0]` quand c'est `Scripts`. Toute valeur partagée avec `build.py` passe par ces globals ou par le nom du fichier
- Tout ce qui s'importe par une chaîne de caractères est invisible à l'analyse statique : c'est la règle qui explique les trois cas du projet (sentry-sdk par `importlib`, keyring par entry points, l'extension C++ de rapidfuzz)
- `--debug=imports` est le premier outil face à un `ModuleNotFoundError` qui n'existe qu'en binaire ; le fichier sous `build/<nom>/` liste les modules analysés
- 6.22.2 corrige la collecte de DLL pour des paquets installés par uv plutôt que pip : la combinaison est maintenue mais demande de suivre les versions
- Un exécutable non signé est régulièrement signalé par Defender et SmartScreen. La seule mitigation fiable est la signature Authenticode, écartée par le budget : `--onedir` et `--noupx` sont ce qui reste, et la mesure appartient à la checklist post-MEP
- La version du sidecar est propagée par release-please via `extra-files` : un bump oublié fausse le tri Sentry et rend une mise à jour invisible
- `--onefile` s'auto-extrait dans `%TEMP%\_MEIxxxxxx` à chaque lancement et ne laisse tuer que son bootloader : le projet est en `--onedir`, dont `externalBin` ne prend que l'exe, `_internal/` passant par `bundle.resources`
