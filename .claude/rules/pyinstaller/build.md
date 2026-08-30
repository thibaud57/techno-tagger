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
- Forcer le backend keyring en code : son hook ajoute des imports cachés mais pas les métadonnées que lit la découverte par entry points (cf. [keyring/secrets.md](../keyring/secrets.md))
- Lire le target triple depuis `rustc --print host-tuple` dans `build.py`, jamais en dur, et copier le binaire suffixé dans `src-tauri/binaries/`
- Passer `--noconfirm` en CI, sans exception, et `--clean` quand un hidden import ajouté ne semble pas pris en compte
- Garder `--noupx` et réduire la taille par `--exclude-module` sur les paquets non utilisés
- Valider chaque chargement dynamique **sur le binaire figé** : clé keyring lue, event Sentry envoyé, scoring rapidfuzz exécuté, ligne NDJSON validée par un modèle Pydantic. `rapidfuzz` et `pydantic-core`, les deux extensions natives de la stack, ont un hook mais leur collecte ne se constate qu'à l'exécution

## À éviter
- `--windowed` : le protocole passe par les flux standards
- Empiler les `--hidden-import` en ligne de commande dans `build.py`, ou dupliquer un réglage entre le `.spec` et les flags CLI : illisible, non diffable, et les options du `.spec` priment
- Considérer le packaging comme acquis parce que le build a réussi, ou parce qu'un hook est censé couvrir une dépendance : les échecs d'import dynamique n'apparaissent qu'à l'exécution
- Tenter un build Windows depuis Linux : PyInstaller ne cross-compile pas, sans contournement, ni conteneur ni option de ciblage
- Compter sur `Process.kill()` côté Tauri pour arrêter un sidecar `--onefile` : seul le bootloader est visé, prévoir un arrêt propre par le protocole

## Gotchas
- Tout ce qui s'importe par une chaîne de caractères est invisible à l'analyse statique : c'est la règle qui explique les trois cas du projet (sentry-sdk par `importlib`, keyring par entry points, l'extension C++ de rapidfuzz)
- `--debug=imports` est le premier outil face à un `ModuleNotFoundError` qui n'existe qu'en binaire ; le fichier sous `build/<nom>/` liste les modules analysés
- 6.22.2 corrige la collecte de DLL pour des paquets installés par uv plutôt que pip : la combinaison est maintenue mais demande de suivre les versions
- Un exécutable non signé est régulièrement signalé par Defender et SmartScreen. La seule mitigation fiable est la signature Authenticode, écartée par le budget : `--onedir` et `--noupx` sont ce qui reste, et la mesure appartient à la checklist post-MEP
- La version du sidecar est propagée par release-please via `extra-files` : un bump oublié fausse le tri Sentry et rend une mise à jour invisible
- `--onefile` s'auto-extrait dans `%TEMP%\_MEIxxxxxx` à chaque lancement et ne laisse tuer que son bootloader : le projet est en `--onedir`, dont `externalBin` ne prend que l'exe, `_internal/` passant par `bundle.resources`
