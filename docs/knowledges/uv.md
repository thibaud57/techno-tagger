---
title: "uv — Gestionnaire de paquets et d'environnement Python"
version: "0.12.7"
description: "Référence technique pour uv : projet et dependency groups, lockfile et politique de versionnement, sync en CI, gestion des versions de Python et exécution des outils."
date: "2026-08-29"
keywords: ["uv", "python", "lockfile", "pep-735", "pyproject", "ci"]
scope: ["docs"]
technologies: ["Python", "PyInstaller", "GitHub Actions", "Renovate"]
---

# Description

Gestionnaire de paquets et d'environnements Python de la zone `sidecar/`. Il tient `pyproject.toml` et `uv.lock`, installe l'interpréteur, et sert de point d'entrée à tous les outils du sidecar (`pytest`, `ruff`, `mypy`, `pyinstaller`).

Le point structurant pour la CI : **le schéma de `uv.lock` fait partie de l'API publique et ne casse qu'en bump mineur.** Toutes les versions patch d'une même mineure garantissent la compatibilité du lockfile, ce qui justifie d'épingler le patch exact plutôt qu'une plage.

---

# Concepts Clés

## Structure du projet

### Description

`pyproject.toml` standard PEP 621, étendu par `[tool.uv]` pour les réglages propres à uv et `[dependency-groups]` pour les dépendances de développement (PEP 735).

### Exemple

```toml
[project]
name = "tagger"
version = "0.1.0"
requires-python = ">=3.14"
dependencies = ["httpx2", "mutagen", "rapidfuzz", "keyring", "sentry-sdk"]

[tool.uv]
package = true
default-groups = ["dev"]

[dependency-groups]
dev = ["pytest", "pytest-asyncio", "pytest-cov", "ruff", "mypy"]
build = ["pyinstaller", "pyinstaller-hooks-contrib"]
```

### Points Importants

- **`[dependency-groups]` n'est pas `[project.optional-dependencies]`** : les groupes ne sont pas publiés avec le paquet, les extras si
- `default-groups` décide de ce qui s'installe sans flag : `dev` par défaut
- **`package = true` installe le projet en editable** : le code du sidecar reste importable pendant le développement sans manipulation de `PYTHONPATH`
- Séparer `build` de `dev` évite d'embarquer PyInstaller dans un environnement de test

---

## `uv.lock` et politique de versionnement

### Description

Le lockfile fige la résolution complète. Son format est couvert par la politique de versionnement d'uv.

### Points Importants

- **Un lockfile ne peut être rejeté qu'entre versions mineures** d'uv : `0.12.0` à `0.12.7` sont interchangeables de ce point de vue
- **D'où l'épinglage du patch exact en CI** : ce n'est pas de la prudence excessive, c'est le seul moyen d'être certain qu'un run futur ne re-résout rien
- `uv.lock` se commite, toujours
- **uv préfère les versions déjà verrouillées** : une nouvelle version disponible en amont ne périme pas le lockfile tant que les contraintes du projet sont satisfaites. Il n'y a donc pas d'upgrade implicite

---

## Installer le lock en CI : `--locked` et `--frozen`

### Description

`uv sync` re-verrouille automatiquement si `pyproject.toml` a changé. En CI, ce comportement est indésirable : on veut installer exactement le lockfile commité, ou échouer.

### Exemple

```bash
uv sync --frozen --all-groups     # installe le lock tel quel, aucune re-résolution
uv sync --locked                  # échoue si le lock devrait être mis à jour
```

### Points Importants

- **`--frozen` installe le lock tel quel** : aucun accès réseau de résolution, mais aucune vérification que ce lock correspond encore au `pyproject.toml` — la reproductibilité qu'il offre suppose un lock déjà à jour, condition que lui-même ne contrôle pas
- **`--locked` échoue explicitement** quand le lock a divergé : préférable quand on veut détecter une dérive plutôt que la subir
- Sans l'un des deux, un `pyproject.toml` modifié sans `uv lock` produit un environnement différent de celui des autres machines
- `--all-groups` inclut `build`, nécessaire au job qui empaquette le sidecar

---

## Exécution des outils

### Description

`uv run` vérifie que le lock et l'environnement sont à jour avant d'exécuter, ce qui garantit que l'outil lancé vient du venv verrouillé.

### Exemple

```bash
uv run pytest
uv run ruff check --fix
uv run mypy src
uv run pyinstaller tagger.spec --noconfirm
```

### Points Importants

- **`uv run pyinstaller` évite le mélange d'environnements**, source classique de `ModuleNotFoundError` dans le binaire gelé (cf. [pyinstaller.md](pyinstaller.md))
- `--frozen` ou `--no-sync` sur `uv run` en CI, pour ne pas déclencher une synchronisation implicite dans un job de build
- `uvx` (alias de `uv tool run`) exécute un outil dans un environnement éphémère : pratique pour un outil ponctuel, à éviter pour ceux du projet, qui doivent être verrouillés

---

## Versions de Python

### Description

uv installe et épingle l'interpréteur lui-même, indépendamment du Python système.

### Exemple

```bash
uv python install 3.14
uv python pin 3.14        # écrit .python-version
```

### Points Importants

- **`.python-version` et `requires-python` ne servent pas à la même chose** : le premier fixe l'interpréteur de développement, le second déclare la plage supportée par le projet. Le premier doit rester dans la plage du second
- Python 3.14 est en support Tier 1 chez uv, donc testé en continu
- `uv python upgrade 3.14` monte au dernier patch de la mineure
- L'interpréteur installé par uv est celui qu'embarquera PyInstaller : sa version décide des wheels utilisées

---

# Commandes Clés

## Gestion des dépendances

### Description

Ajout, retrait et verrouillage. Toute modification passe par uv, jamais par une édition manuelle du lock.

### Syntaxe

```bash
uv add httpx2                       # dépendance de production
uv add --dev pytest                 # groupe dev
uv add --group build pyinstaller    # groupe nommé
uv remove rapidfuzz
uv lock                             # régénère le lock depuis pyproject.toml
uv lock --check                     # vérifie sa fraîcheur, exit non nul si périmé
uv lock --upgrade-package httpx2    # upgrade ciblé
```

### Points Importants

- **`uv remove` retire aussi les transitives devenues orphelines** : le lock rétrécit, c'est normal
- **`uv lock --check` est le bon garde-fou de pre-commit** : il ne modifie rien et signale une divergence
- `--upgrade-package` cible une dépendance sans toucher au reste, contrairement à `--upgrade`

## Environnement et exécution

### Description

Installation locale et en CI, exécution des outils.

### Syntaxe

```bash
uv sync                             # local : re-lock si besoin puis installe
uv sync --locked --all-groups       # CI : échoue si le lock a dérivé, tous les groupes
uv run <outil>                      # exécute dans le venv verrouillé
uv build                            # sdist + wheel dans dist/
```

### Points Importants

- **`uv build` ne produit pas le binaire du sidecar** : c'est PyInstaller qui s'en charge, lancé par `uv run`
- `uv sync` supprime les paquets absents du lock, sauf avec `--inexact`
- Le venv est géré par uv (`managed = true` par défaut) : ne pas créer de venv à la main à côté

---

# Bonnes Pratiques

## ✅ Recommandations

- **Épingler le patch exact d'uv en CI** (`version: "0.12.7"` dans l'action de setup), la compatibilité du lock n'étant garantie qu'au sein d'une mineure
- **Utiliser `uv sync --locked` en CI**, jamais `uv sync` nu
- **Lancer tous les outils par `uv run`**, PyInstaller compris
- **Séparer les groupes `dev` et `build`** : un job de test n'a pas besoin de PyInstaller
- **Commiter `uv.lock` à chaque changement de dépendance**, dans le même commit que le `pyproject.toml`
- **Ajouter `uv lock --check` au pipeline** pour détecter un `pyproject.toml` modifié sans re-lock

## ❌ Anti-Patterns

- **Éditer `uv.lock` à la main** : il se régénère, il ne se corrige pas
- **`uv sync` sans `--locked` en CI** : une re-résolution silencieuse rend le build non reproductible
- **Épingler uv sur une plage ou sur `latest`** : un bump mineur peut rejeter le lock commité
- **Lancer `pytest` ou `pyinstaller` hors de `uv run`** : l'outil peut venir d'un autre environnement
- **Confondre `.python-version` et `requires-python`** : le premier est une préférence locale, le second un contrat
- **Créer un venv manuellement à côté** de celui géré par uv

---

# 🔗 Ressources

## Documentation Officielle

- [uv](https://docs.astral.sh/uv/)
- [Politique de versionnement](https://docs.astral.sh/uv/reference/policies/versioning/)
- [Sync et lock](https://docs.astral.sh/uv/concepts/projects/sync/) · [Dépendances](https://docs.astral.sh/uv/concepts/projects/dependencies/)
- [Versions de Python](https://docs.astral.sh/uv/concepts/python-versions/)
- [Intégration GitHub Actions](https://docs.astral.sh/uv/guides/integration/github/) · [Intégration Renovate](https://docs.astral.sh/uv/guides/integration/renovate/)

## Ressources Complémentaires

- [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv)
- [pyinstaller.md](pyinstaller.md) — build du sidecar via `uv run`
- [VERSIONS.md](../VERSIONS.md) — versions épinglées du projet
