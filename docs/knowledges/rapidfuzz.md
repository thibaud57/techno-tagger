---
title: "RapidFuzz — Scoring de similarité des candidats"
version: "3.14.5"
description: "Référence technique pour RapidFuzz : choix du scorer, processor explicite, seuils, extract/extractOne et différences de comportement avec fuzzywuzzy."
date: "2026-08-29"
keywords: ["rapidfuzz", "fuzzy-matching", "scoring", "fuzzywuzzy", "token-sort-ratio"]
scope: ["docs"]
technologies: ["Python", "PyInstaller"]
---

# Description

Bibliothèque de similarité de chaînes qui score les candidats renvoyés par techno-scraper contre la requête construite depuis les tags. Elle remplace fuzzywuzzy, dont la licence GPL et la dépendance à `python-Levenshtein` posaient problème pour un binaire distribué (cf. [ADR-008](../adrs/008-matching-rapidfuzz-et-agent-ia.md)).

**Licence MIT, wheels Windows précompilées.** Même échelle 0-100 que fuzzywuzzy, ce qui rend les seuils hérités de la CLI réutilisables comme point de départ.

---

# Concepts Clés

## Choix du scorer

### Description

Trois scorers couvrent les cas du projet, du plus strict au plus tolérant. La règle métier est reprise telle quelle de la CLI : `token_sort_ratio` quand l'artiste contient une virgule ou une esperluette, `ratio` sinon.

### Exemple

```python
from rapidfuzz import fuzz, utils

def artist_score(query: str, candidate: str) -> float:
    scorer = fuzz.token_sort_ratio if ("," in query or "&" in query) else fuzz.ratio
    return scorer(query, candidate, processor=utils.default_process)
```

### Points Importants

- **`ratio`** : similarité caractère par caractère, sensible à l'ordre. Le défaut quand la requête est déjà propre
- **`token_sort_ratio`** : trie les mots avant de comparer, donc insensible à l'ordre. C'est ce qu'il faut quand plusieurs artistes sont listés dans un ordre différent selon la source
- **`token_set_ratio`** : compare les ensembles de tokens et rend 100 si l'un est inclus dans l'autre. Le plus tolérant, donc le plus générateur de faux positifs — à ne pas utiliser seul comme critère d'auto-validation
- `WRatio` est le scorer par défaut de `process.extract` : il combine plusieurs ratios avec pondération, pratique mais moins prévisible qu'un choix explicite
- **Un candidat sans mention de remix est écarté quand la requête en contient une** : cette règle est en amont du scoring, pas dedans

---

## Le `processor` n'est plus implicite

### Description

C'est la différence de comportement la plus piégeuse avec fuzzywuzzy. **Depuis RapidFuzz 3.0, aucune fonction de scoring ne préprocesse les chaînes.** Il faut passer `processor` explicitement.

### Exemple

```python
from rapidfuzz import fuzz, utils

fuzz.ratio("Adam Beyer", "adam beyer!")                                  # score dégradé
fuzz.ratio("Adam Beyer", "adam beyer!", processor=utils.default_process) # score attendu
```

### Points Importants

- **`utils.default_process` fait le minimum attendu** : minuscules, suppression de la ponctuation et des caractères non alphanumériques, trim
- Sans lui, la casse et la ponctuation brutes des tags ID3 biaisent tous les scores vers le bas, et les seuils hérités deviennent trop stricts
- **Le passer partout ou nulle part** : mélanger des appels avec et sans processor rend les scores incomparables entre eux
- Le nettoyage métier de la requête (mentions de téléchargement, marqueurs d'encodage) est une étape distincte, en amont : `default_process` ne fait que normaliser, il ne retire pas `[FREE DL]`

---

## Seuils et zone grise

### Description

Trois états après interrogation d'une source : **auto**, **zone grise**, **vide**. Le plancher s'applique séparément au score artiste et au score titre, le seuil haut à leur moyenne.

### Exemple

```python
FLOOR = 70    # sous ce score sur artiste OU titre, le candidat est écarté
CEILING = 90  # au-dessus de la moyenne des deux, validation automatique

def classify(artist: float, title: float) -> str:
    if artist < FLOOR or title < FLOOR:
        return "rejected"
    return "auto" if (artist + title) / 2 >= CEILING else "grey_zone"
```

### Points Importants

- **Le plancher est un ET, pas une moyenne** : un artiste à 95 et un titre à 40 est écarté, alors que leur moyenne passerait le plancher
- **70 et 90 sont hérités de la CLI, pas transposables tels quels** : le contrat de sortie de l'API a changé, les chaînes comparées ne sont plus les mêmes. À recalibrer aux premiers runs réels
- Le passage de fuzzywuzzy à rapidfuzz est neutre sur l'échelle mais **pas sur les valeurs exactes** : fuzzywuzzy alternait entre Ratcliff-Obershelp (difflib) et Levenshtein selon l'installation, rapidfuzz utilise toujours l'Indel similarity
- Les deux seuils sont réglables dans les Settings : les valeurs codées en dur sont des défauts, pas des constantes

---

## `extract` et `extractOne`

### Description

`extractOne` rend le meilleur candidat, `extract` rend les N meilleurs triés. Le second sert à alimenter la modale d'arbitrage et le rapport.

### Exemple

```python
from rapidfuzz import fuzz, process, utils

best = process.extractOne(
    query,
    [c.title for c in candidates],
    scorer=fuzz.token_sort_ratio,
    processor=utils.default_process,
    score_cutoff=FLOOR,
)
# None si aucun candidat n'atteint le plancher, sinon (texte, score, index)

shortlist = process.extract(query, choices, scorer=fuzz.WRatio, limit=5,
                            processor=utils.default_process)
```

### Points Importants

- **`extractOne` rend `None` sous `score_cutoff`**, pas un tuple à score bas : c'est le cas « vide » du pipeline
- Le troisième élément du tuple est **l'index dans la liste passée**, ce qui permet de remonter au candidat complet
- **En cas d'égalité, le premier élément de la liste gagne** : l'ordre des candidats renvoyés par l'API a donc un effet, à consigner si un arbitrage est rejoué
- `extract_iter` rend un générateur non trié, utile pour ne pas matérialiser une longue liste
- `dedupe` de fuzzywuzzy n'a pas d'équivalent direct

---

## Empaquetage PyInstaller

### Description

RapidFuzz embarque une extension C++ (`_rapidfuzz_cpp`), invisible à l'analyse statique de PyInstaller dans certains cas.

### Exemple

```python
# sidecar/tagger.spec
hiddenimports = ["_rapidfuzz_cpp"]
# ou en CLI : --collect-all rapidfuzz
```

### Points Importants

- **L'existence d'un hook livré par le paquet n'est pas confirmée** : le dossier `__pyinstaller` du dépôt n'expose qu'une entrée `tests`, destinée à la suite de tests de PyInstaller, pas un hook `hiddenimports` pour les utilisateurs finaux
- Une issue ouverte signale un échec à l'exécution en mode `--noconsole`, où `--hidden-import rapidfuzz` seul n'a pas suffi. Le sidecar étant en mode console, ce cas ne s'applique pas directement, mais il indique que le packaging demande une vérification réelle
- **Tester le binaire produit avant de considérer le packaging comme acquis** : un scoring qui échoue seulement dans le binaire gelé est le symptôme
- Wheels précompilées pour cp314 sur Windows, y compris les builds free-threaded

---

# Bonnes Pratiques

## ✅ Recommandations

- **Passer `processor=utils.default_process` sur tous les appels de scoring**, sans exception, pour que les scores restent comparables
- **Choisir le scorer explicitement** selon la règle métier plutôt que de s'en remettre à `WRatio`
- **Consigner le score de chaque candidat dans le rapport** : c'est ce qui permet de recalibrer les seuils après les premiers runs réels
- **Traiter le plancher comme un ET sur les deux scores**, jamais comme une moyenne
- **Tester le scoring dans le binaire PyInstaller**, pas seulement dans l'environnement de développement
- **Garder les seuils dans la configuration**, pas dans le code du scorer

## ❌ Anti-Patterns

- **Omettre le `processor`** en supposant le comportement de fuzzywuzzy : les scores chutent et les seuils deviennent trop stricts
- **Utiliser `token_set_ratio` pour l'auto-validation** : il rend 100 dès qu'un candidat contient tous les mots de la requête, remix compris
- **Reprendre 70 et 90 comme des constantes définitives** : ce sont des points de départ à recalibrer
- **Appliquer le nettoyage de requête aux tags du fichier** : il porte sur la chaîne interrogée, jamais sur ce qui est écrit
- **Retirer une mention de version ou de collaboration au nettoyage** : `(Adam Beyer Remix)` et `feat. X` identifient le morceau, et leur suppression casse la règle qui écarte un candidat sans remix
- **Comparer des scores obtenus avec des scorers différents** : les échelles sont les mêmes, pas les distributions

---

# 🔗 Ressources

## Documentation Officielle

- [RapidFuzz](https://rapidfuzz.github.io/RapidFuzz/)
- [Module fuzz](https://rapidfuzz.github.io/RapidFuzz/Usage/fuzz.html)
- [Module process](https://rapidfuzz.github.io/RapidFuzz/Usage/process.html)
- [Module utils](https://rapidfuzz.github.io/RapidFuzz/Usage/utils.html)

## Ressources Complémentaires

- [Différences d'API avec fuzzywuzzy](https://github.com/rapidfuzz/RapidFuzz/blob/main/api_differences.md)
- [ADR-008 — Matching rapidfuzz et agent IA](../adrs/008-matching-rapidfuzz-et-agent-ia.md)
- [Issue #437 — échec sous PyInstaller en mode noconsole](https://github.com/rapidfuzz/RapidFuzz/issues/437)
