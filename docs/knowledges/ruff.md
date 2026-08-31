---
title: "Ruff — Linter et formatter du sidecar"
version: "0.16.5"
description: "Référence technique pour Ruff : configuration dans pyproject.toml, jeu de règles par défaut passé à 413 en 0.16.0, select vs extend-select et ordre lint/format."
date: "2026-08-29"
keywords: ["ruff", "lint", "format", "pyproject", "regles", "pre-commit"]
scope: ["docs"]
technologies: ["Python", "uv", "Mypy", "GitHub Actions"]
---

# Description

Linter et formatter du sidecar, en un seul binaire. Il remplace la combinaison flake8 + isort + Black + pyupgrade.

**Le point à connaître avant tout autre : la 0.16.0 fait passer le jeu de règles par défaut de 59 à 413 règles**, premier changement du set par défaut depuis la 0.1.0. Une configuration copiée d'un projet antérieur produit un diff massif au premier `ruff check`, sans qu'une ligne de code ait bougé.

---

# Concepts Clés

## Configuration dans `pyproject.toml`

### Description

Trois tables : réglages globaux, règles de lint, options du formatter.

### Exemple

```toml
[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F"]          # jeu explicite, cf. ci-dessous
extend-select = ["B", "ASYNC", "SIM"]     # ajouts par-dessus

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101"]                     # assert autorisé dans les tests
"__init__.py" = ["F401"]                  # ré-exports
```

### Points Importants

- **`select` remplace entièrement le jeu actif**, `extend-select` s'y ajoute : les confondre change tout le comportement
- **Ne pas poser `target-version`** : Ruff le dérive de `project.requires-python`, la clé en ferait une seconde source à synchroniser
- `per-file-ignores` évite de désactiver une règle globalement pour un seul dossier
- Les règles `preview` changent sans préavis entre patchs : laisser `preview` désactivé

---

## Le jeu par défaut de la 0.16.0

### Description

Sans `select` explicite, Ruff applique désormais 413 règles au lieu de 59. La 0.16.0 retire aussi 18 règles du jeu par défaut (dont `E401`, `E402`, `E701`, `F403`, `F405`), sans qu'elles soient dépréciées.

### Exemple

```toml
# Retrouver le comportement d'avant la 0.16.0
[tool.ruff.lint]
select = ["E4", "E7", "E9", "F"]
```

### Points Importants

- **Un `pyproject.toml` sans `select` hérite du nouveau jeu** : c'est le cas qui produit des centaines de violations sur du code inchangé
- Le retrait des 18 règles n'a pas été documenté dans les notes de rupture : une règle qui « ne se déclenche plus » après montée de version vient peut-être de là
- **Déclarer `select` explicitement est le seul moyen de maîtriser ce que le linter vérifie**, indépendamment des défauts de la version installée
- **Épingler la version de Ruff** (en CI comme en pre-commit) évite qu'un changement de défaut arrive sans être décidé

---

## Ordre lint puis format

### Description

Les corrections automatiques du linter peuvent nécessiter un reformatage : le formatter passe après.

### Exemple

```bash
uv run ruff check --fix
uv run ruff format
```

### Points Importants

- **L'ordre inverse laisse du code corrigé mais mal formaté**
- `ruff format` est compatible Black à plus de 99,9 % sur du code déjà formaté par Black : la migration ne produit pas de diff significatif
- En pre-commit, le hook `ruff-check --fix` se place avant `ruff-format`, et avant tout autre formatter

---

## Corrections sûres et non sûres

### Description

`--fix` n'applique que les corrections marquées sûres. `--unsafe-fixes` élargit à celles qui peuvent changer le comportement.

### Points Importants

- **`--unsafe-fixes` ne s'utilise pas en aveugle** : par définition, ces corrections peuvent modifier ce que le code fait
- Sur du code couvert par des tests, un passage ponctuel reste envisageable, relu diff en main
- **Jamais `--fix` dans un job CI** : la CI vérifie, elle ne corrige pas, sinon des régressions se committent silencieusement

---

# Commandes Clés

## Vérification et correction

### Description

Le cycle courant, en local et en CI.

### Syntaxe

```bash
uv run ruff check                 # vérifie
uv run ruff check --fix           # corrige ce qui est sûr
uv run ruff check --diff          # aperçu sans écrire
uv run ruff check --statistics    # violations agrégées par règle
uv run ruff format                # formate
uv run ruff format --check        # échoue si un fichier doit être reformaté
```

### Points Importants

- **Codes de sortie** : 0 rien à signaler, 1 violations restantes, 2 erreur de configuration. Distinguer les deux derniers en CI
- `--statistics` est l'outil pour cadrer une montée de version : il montre quelles règles produisent le diff avant d'y toucher
- `--output-format github` produit des annotations natives dans les logs GitHub Actions
- `--exit-non-zero-on-fix` fait échouer un job qui aurait corrigé quelque chose, utile pour interdire le `--fix` implicite

---

# Bonnes Pratiques

## ✅ Recommandations

- **Déclarer `select` explicitement** plutôt que de dépendre du jeu par défaut de la version installée
- **Épingler la version de Ruff** en CI et en pre-commit, et laisser Renovate proposer la montée
- **Lancer `ruff check --fix` puis `ruff format`**, dans cet ordre
- **Cadrer une montée de version par `--statistics`** avant de regarder le diff
- **Utiliser `per-file-ignores`** pour les tests et les `__init__.py` plutôt que de désactiver globalement
- **Laisser Ruff au style et aux bugs locaux**, et Mypy à la cohérence de types : les deux dans le même pipeline

## ❌ Anti-Patterns

- **Copier une configuration Ruff d'un projet antérieur à la 0.16.0** sans `select` : diff massif garanti
- **Confondre `select` et `extend-select`** : le premier écrase, le second ajoute
- **`--fix` dans un job CI** : la CI vérifie, elle ne réécrit pas le code
- **`--unsafe-fixes` sur un lot large** sans relire le diff
- **Activer `preview`** : les règles y changent entre deux patchs
- **Ajouter Black ou isort à côté** : Ruff couvre les deux, et deux formatters se contredisent

---

# 🔗 Ressources

## Documentation Officielle

- [Ruff — configuration](https://docs.astral.sh/ruff/configuration/)
- [Linter](https://docs.astral.sh/ruff/linter/) · [Formatter](https://docs.astral.sh/ruff/formatter/) · [Réglages](https://docs.astral.sh/ruff/settings/)
- [Compatibilité avec Black](https://docs.astral.sh/ruff/formatter/black/)
- [Versionnement](https://docs.astral.sh/ruff/versioning/)

## Ressources Complémentaires

- [Annonce Ruff 0.16.0](https://astral.sh/blog/ruff-v0.16.0)
- [ruff-pre-commit](https://github.com/astral-sh/ruff-pre-commit)
- [mypy.md](mypy.md) — répartition des responsabilités
