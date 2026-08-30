---
paths:
  - "sidecar/src/tagger/matching.py"
---

# RapidFuzz — Scoring & seuils

## À faire
- Passer `processor=utils.default_process` sur **tous** les appels de scoring : depuis la 3.0, aucune fonction ne préprocesse, et mélanger des appels avec et sans processor rend les scores incomparables
- Choisir le scorer explicitement selon la règle métier : `token_sort_ratio` quand la requête artiste contient une virgule ou une esperluette, `ratio` sinon
- Traiter le plancher comme un **ET** sur le score artiste et le score titre, le seuil haut portant sur leur moyenne : un artiste à 95 et un titre à 40 est écarté
- Lire les deux seuils depuis la configuration : les valeurs du code sont des défauts réglables dans les Settings, pas des constantes
- Passer le plancher en `score_cutoff` : `extractOne` rend alors `None`, ce qui est le cas « vide » du pipeline, et le calcul est court-circuité sur les candidats hors-jeu
- Remonter au candidat complet par l'index, troisième élément du tuple rendu
- Consigner le score de chaque candidat dans le rapport : c'est ce qui permet de recalibrer les seuils après les premiers runs réels
- Écarter en amont du scoring un candidat sans mention de remix quand la requête en contient une : cette règle précède le scoring, elle n'en fait pas partie

## À éviter
- Omettre le `processor` en supposant le comportement de fuzzywuzzy : la casse et la ponctuation des tags ID3 tirent tous les scores vers le bas et les seuils hérités deviennent trop stricts
- `token_set_ratio` comme critère d'auto-validation : il rend 100 dès qu'un candidat contient tous les mots de la requête, remix compris
- Reprendre 70 et 90 comme des valeurs définitives : elles viennent de la CLI d'origine, dont les chaînes comparées n'étaient pas celles du contrat actuel
- Appliquer le nettoyage de requête aux tags écrits : il porte sur la chaîne interrogée uniquement
- Retirer une mention de version ou de featuring au nettoyage : `(Adam Beyer Remix)` et `feat. X` identifient le morceau (cf. [stdlib-donnees.md](../python/stdlib-donnees.md))
- Comparer des scores obtenus avec des scorers différents : même échelle, distributions différentes

## Gotchas
- 3.0.0 : plus aucun préprocessing implicite, `**kwargs` vers le scorer supprimés, et `rapidfuzz.string_metric` remplacé par `rapidfuzz.distance`
- Le passage de fuzzywuzzy à rapidfuzz conserve l'échelle mais pas les valeurs exactes : fuzzywuzzy alternait Ratcliff-Obershelp et Levenshtein selon l'installation, rapidfuzz utilise toujours l'Indel similarity
- En cas d'égalité de score, le premier élément de la liste gagne : l'ordre des candidats rendus par l'API a un effet, à consigner si un arbitrage est rejoué
- 3.14.0 corrige `WRatio` pour un ratio de longueur exactement égal à 8.0. La 3.14.6 annoncée abandonne Python 3.10 et les wheels free-threaded 3.13
- Déclarer `collect_submodules("rapidfuzz")` dans le `.spec` : **aucun hook ne couvre rapidfuzz**, son entry point `pyinstaller40` s'appelant `tests` et non `hook-dirs`. L'extension C++ est collectée par l'analyse statique, pas ses cibles SIMD. Vérifier le scoring sur le binaire figé, un échec ne se manifestant que là

## Exemples
```python
# ✅ scorer explicite, processor systématique
scorer = fuzz.token_sort_ratio if ("," in query or "&" in query) else fuzz.ratio
score = scorer(query, candidate, processor=utils.default_process)

# ✅ plancher en ET, seuil haut sur la moyenne
if artist < FLOOR or title < FLOOR:
    return "rejected"
return "auto" if (artist + title) / 2 >= CEILING else "grey_zone"

# ✅ le plancher passé en score_cutoff : None au lieu d'un tuple à score bas
best = process.extractOne(query, choices, scorer=scorer,
                          processor=utils.default_process, score_cutoff=FLOOR)

# ❌ processor omis
fuzz.ratio("Adam Beyer", "adam beyer!")
```
