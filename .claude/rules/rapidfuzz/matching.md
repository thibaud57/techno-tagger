---
paths:
  - "sidecar/src/tagger/matching.py"
---

# RapidFuzz — Scoring & seuils

## À faire
- Passer `processor=utils.default_process` sur **tous** les appels de scoring : depuis la 3.0, aucune fonction ne préprocesse, et mélanger des appels avec et sans processor rend les scores incomparables
- Comparer les artistes un à un, jamais deux listes jointes : meilleur score de chaque artiste de la requête contre les crédits du candidat, puis le plus faible de ces scores. Deux listes jointes s'écroulent dès qu'un tag est incomplet
- Traiter le plancher comme un **ET** sur le score artiste et le score titre, le seuil haut portant sur leur moyenne : un artiste à 95 et un titre à 40 est écarté
- Lire les deux seuils depuis la configuration : les valeurs du code sont des défauts réglables dans les Settings, pas des constantes
- `process.extractOne` pour comparer une chaîne à une liste sur un axe unique, avec `score_cutoff` quand un plancher s'applique (il rend alors `None`). Un ET de plusieurs scores ne s'exprime pas en `score_cutoff`
- Remonter au candidat complet par l'index, troisième élément du tuple rendu
- Consigner le score de chaque candidat dans le rapport : c'est ce qui permet de recalibrer les seuils après les premiers runs réels
- Écarter en amont du scoring un candidat sans mention de remix quand la requête en contient une : cette règle précède le scoring, elle n'en fait pas partie
- Refuser l'auto, sans toucher au score, quand la version ou un nombre du titre diffère de la requête : « Pt. 1 » contre « Pt. 2 » ne coûte qu'un caractère au `ratio`. Zone grise, jamais écarté

## À éviter
- Omettre le `processor` en supposant le comportement de fuzzywuzzy : la casse et la ponctuation des tags ID3 tirent tous les scores vers le bas et les seuils hérités deviennent trop stricts
- `token_set_ratio` comme critère d'auto-validation : il rend 100 dès qu'un candidat contient tous les mots de la requête, remix compris
- Tenir 70 et 90 pour définitifs : ils viennent de la CLI d'origine, qui comparait d'autres chaînes
- Appliquer le nettoyage de requête aux tags écrits : il porte sur la chaîne interrogée uniquement
- Retirer une mention de version ou de featuring au nettoyage : `(Adam Beyer Remix)` et `feat. X` identifient le morceau (cf. [stdlib-donnees.md](../python/stdlib-donnees.md))
- Comparer des scores obtenus avec des scorers différents : même échelle, distributions différentes

## Gotchas
- 3.0.0 : plus aucun préprocessing implicite, `**kwargs` vers le scorer supprimés, et `rapidfuzz.string_metric` remplacé par `rapidfuzz.distance`
- rapidfuzz garde l'échelle de fuzzywuzzy mais pas ses valeurs exactes (Indel similarity partout)
- À score égal, le premier élément de la liste gagne : l'ordre des candidats de l'API compte
- Aucun hook PyInstaller ne couvre rapidfuzz : `collect_submodules("rapidfuzz")` dans le `.spec`, et scoring vérifié sur le binaire figé

## Exemples
```python
# ✅ artistes comparés un à un, processor systématique
# un artiste absent du candidat n'est pas racheté par la présence des autres
score = min(
    process.extractOne(name, credits, scorer=fuzz.ratio,
                       processor=utils.default_process)[1]
    for name in asked_artists
)

# ✅ plancher en ET, seuil haut sur la moyenne
if artist < FLOOR or title < FLOOR:
    return "rejected"
return "auto" if (artist + title) / 2 >= CEILING else "grey_zone"

# ✅ le plancher passé en score_cutoff : None au lieu d'un tuple à score bas
best = process.extractOne(query, choices, scorer=fuzz.ratio,
                          processor=utils.default_process, score_cutoff=FLOOR)

# ❌ processor omis
fuzz.ratio("Adam Beyer", "adam beyer!")
```
